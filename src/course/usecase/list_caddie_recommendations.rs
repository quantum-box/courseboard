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
    rank_caddies, AttendanceState, CaddieAssignmentQuery, CaddieRecommendation, CourseError,
    GatewayCredentials, GolfOpsGateway, RankingCandidate, RankingOptions, RecommendationQuery,
};

pub struct ListCaddieRecommendationsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddieRecommendationsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: RecommendationQuery,
    ) -> Result<Vec<CaddieRecommendation>, CourseError> {
        // The day being planned, which is also the day attendance is read for.
        let date = query
            .scheduled_at
            .map(|at| at.date_naive())
            .unwrap_or_else(|| chrono::Utc::now().date_naive());

        let (roster, ratings, assignments, attendance) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_ratings(credentials, None),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(date),
                    to: Some(date),
                },
            ),
            self.ops.get_attendance_snapshot(credentials, Some(date)),
        )?;

        let mut rating_totals: HashMap<String, (f64, i64)> = HashMap::new();
        for rating in &ratings {
            let entry = rating_totals
                .entry(rating.caddie_id().to_string())
                .or_insert((0.0, 0));
            entry.0 += rating.score() as f64;
            entry.1 += 1;
        }

        let mut rounds_today: HashMap<String, i64> = HashMap::new();
        for assignment in &assignments {
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

        let candidates: Vec<RankingCandidate> = roster
            .caddies()
            .iter()
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
                    item.score,
                    item.recommended_role,
                    item.pairing_display_name,
                    item.reasons,
                )
            })
            .collect())
    }
}
