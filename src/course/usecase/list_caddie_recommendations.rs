//! ListCaddieRecommendationsUseCase: one use case, one public entrypoint (`execute`).
//!
//! Ranking used to be a straight proxy to Field. Field's query never joined
//! attendance, so a caddie who had not clocked in was offered exactly as
//! readily as one already on the tee — the QA report's "0 working, three
//! candidates". Golf operations belong here (ADR-0005), so the ordering is
//! computed from the roster, ratings, the day's assignments and the attendance
//! snapshot CourseBoard already reads.

use std::collections::HashMap;
use std::sync::Arc;

use crate::course::domain::{
    course_day_bounds, rank_caddies, shift_covers_tee_time, widen_for_utc_date_filter,
    AttendanceState, AvailabilityQuery, AvailabilityStatus, CaddieAssignmentQuery, CaddiePlacement,
    CaddieRecommendation, CaddieShift, CaddieShiftGateway, CourseError, GatewayCredentials,
    GolfOpsGateway, RankingCandidate, RankingOptions, RecommendationQuery,
};

/// Minutes east of UTC for the course clock, as everywhere else in this product.
const JST_OFFSET_MINUTES: i64 = 9 * 60;

pub struct ListCaddieRecommendationsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
}

impl ListCaddieRecommendationsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, shifts: Arc<dyn CaddieShiftGateway>) -> Self {
        Self { ops, shifts }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: RecommendationQuery,
    ) -> Result<Vec<CaddieRecommendation>, CourseError> {
        // The day being planned, which is also the day attendance is read for.
        let date = query
            .scheduled_at
            .map(|at| (at + chrono::Duration::minutes(JST_OFFSET_MINUTES)).date_naive())
            .unwrap_or_else(|| {
                (chrono::Utc::now() + chrono::Duration::minutes(JST_OFFSET_MINUTES)).date_naive()
            });

        let window = widen_for_utc_date_filter(date, date);
        let (roster, ratings, assignments, attendance, availabilities, confirmed) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_ratings(credentials, None),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
                    reservation_id: None,
                },
            ),
            self.ops.get_attendance_snapshot(credentials, Some(date)),
            self.ops.list_caddie_availabilities(
                credentials,
                AvailabilityQuery {
                    caddie_id: None,
                    from: Some(date),
                    to: Some(date),
                    date: None,
                },
            ),
            self.shifts.list_shifts(credentials.operator_id, date, date),
        )?;

        // Who stands where today. A day the month was never confirmed for
        // leaves this empty, and the ranking then offers the whole roster as
        // it did before placements existed.
        let shift_by_caddie: HashMap<&str, &CaddieShift> = confirmed
            .iter()
            .filter(|shift| shift.date() == date)
            .map(|shift| (shift.caddie_id().as_str(), shift))
            .collect();

        let mut rating_totals: HashMap<String, (f64, i64)> = HashMap::new();
        for rating in &ratings {
            let entry = rating_totals
                .entry(rating.caddie_id().to_string())
                .or_insert((0.0, 0));
            entry.0 += rating.score() as f64;
            entry.1 += 1;
        }

        // Field filters on the UTC date, so the day was fetched wide; count only
        // what actually falls inside the course's own day.
        let (day_start, day_end) = course_day_bounds(date, date);
        let mut rounds_today: HashMap<String, i64> = HashMap::new();
        for assignment in assignments.iter().filter(|assignment| {
            let at = assignment.scheduled_at();
            day_start <= at && at < day_end
        }) {
            *rounds_today
                .entry(assignment.caddie_id().to_string())
                .or_insert(0) += 1;
        }

        let attendance_by_caddie: HashMap<String, AttendanceState> = attendance
            .items()
            .iter()
            .map(|row| {
                (
                    row.caddie_id().to_string(),
                    AttendanceState::parse(row.attendance_status()),
                )
            })
            .collect();

        let availability_by_caddie: HashMap<String, AvailabilityStatus> = availabilities
            .iter()
            .map(|row| (row.caddie_id().to_string(), row.status()))
            .collect();

        let candidates: Vec<RankingCandidate> = roster
            .caddies()
            .iter()
            // A retired or suspended caddie cannot take the round at all, so
            // offering them as a candidate is not a low-ranked suggestion but a
            // wrong one. Attendance only orders the people who could work
            // today; the roster decides who those are.
            .filter(|caddie| caddie.is_assignable())
            // A day confirmed as off is not a candidate, and a caddie standing
            // on another course cannot walk this round — moving them is the
            // balance board's job, not a suggestion to be ranked low.
            .filter(|caddie| {
                shift_by_caddie
                    .get(caddie.id().as_str())
                    .map(|shift| shift.is_working())
                    .unwrap_or(true)
            })
            .filter(|caddie| {
                let placement = match shift_by_caddie.get(caddie.id().as_str()) {
                    Some(shift) => match shift.course_id() {
                        Some(course_id) => CaddiePlacement::On(course_id.clone()),
                        None => CaddiePlacement::Unplaced,
                    },
                    None => CaddiePlacement::Unconfirmed,
                };
                placement.covers(query.golf_course_id.as_ref())
            })
            // Same for somebody who filed for the day off. Asked about a
            // specific tee time, a half-day request is judged too; asked about
            // the day as a whole, it cannot be, so it stays in.
            .filter(|caddie| {
                shift_covers_tee_time(
                    availability_by_caddie.get(caddie.id().as_str()).copied(),
                    query.scheduled_at,
                    JST_OFFSET_MINUTES,
                )
            })
            .map(|caddie| {
                let id = caddie.id().to_string();
                let (total, count) = rating_totals.get(&id).copied().unwrap_or((0.0, 0));
                RankingCandidate {
                    rating_average: (count > 0).then(|| total / count as f64),
                    rating_count: count,
                    rounds_assigned_today: rounds_today.get(&id).copied().unwrap_or(0),
                    max_rounds_per_day: caddie.max_rounds_per_day(),
                    // Missing from the snapshot reads as not clocked in: the
                    // snapshot is what a clock-in writes to.
                    attendance: attendance_by_caddie
                        .get(&id)
                        .copied()
                        .unwrap_or(AttendanceState::NotClocked),
                    display_name: caddie.display_name().to_string(),
                    skill_level: caddie.skill_level(),
                    caddie_id: id,
                }
            })
            .collect();

        let ranked = rank_caddies(
            &candidates,
            RankingOptions {
                player_count: query.player_count,
                include_rookie_pairing: query.include_rookie_pairing,
                limit: query.limit.map(|value| value as usize),
            },
        );

        Ok(ranked
            .into_iter()
            .map(|item| {
                CaddieRecommendation::reconstitute(
                    item.caddie_id,
                    item.display_name,
                    item.skill_level,
                    item.rating_average,
                    item.rating_count,
                    item.rounds_assigned,
                    Some(item.remaining_rounds),
                    Some(item.attendance.as_str().to_string()),
                    item.score,
                    item.recommended_role,
                    item.pairing_display_name,
                    item.reasons,
                )
            })
            .collect())
    }
}
