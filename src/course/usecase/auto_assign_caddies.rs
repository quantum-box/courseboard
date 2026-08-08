//! AutoAssignCaddiesUseCase: one use case, one public entrypoint (`execute`).
//!
//! The plan used to be asked of Field, which could not draw one: whether a
//! booking is played with a caddie is decided by the plan behind it, and that
//! plan lives in CourseBoard's extension config. Field answered `assigned: []`
//! for a board full of caddie-attached rounds, every single time — the button
//! ran, reported nothing to do, and left the day unstaffed.
//!
//! Golf operations belong here (ADR-0005), so the day is planned from the
//! tee-sheet, the roster, the shift requests and the standing assignments this
//! side already reads, and only the resulting rows are written upstream.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDate, Utc};

use crate::course::domain::{
    course_day_bounds, plan_caddie_assignments, widen_for_utc_date_filter, AttendanceState,
    AutoAssignResult, AvailabilityQuery, AvailabilityStatus, CaddieAssignmentQuery, CourseError,
    GatewayCredentials, GolfCatalogGateway, GolfOpsGateway, PlanOptions, PlannableCaddie,
    PlannableRound, ReservationGateway, TeeSheetItem, TeeSheetQuery, UpsertCaddieAssignment,
};
use crate::course::usecase::GetTeeSheetUseCase;

/// Minutes east of UTC for the course clock. Every course in this product runs
/// on JST, and the tee-sheet already renders its day against the same offset.
const JST_OFFSET_MINUTES: i64 = 9 * 60;

/// What a freshly planned assignment is written as.
const ASSIGNED_STATUS: &str = "assigned";
const PRIMARY_ROLE: &str = "primary";

/// The tee-sheet carries its start as the offset-bearing string the screens
/// render; the planner needs the instant behind it.
fn round_starts_at(item: &TeeSheetItem) -> Result<DateTime<Utc>, CourseError> {
    DateTime::parse_from_rfc3339(item.tee_time())
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| CourseError::Provider("the tee sheet built an unreadable tee time".into()))
}

pub struct AutoAssignCaddiesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl AutoAssignCaddiesUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self {
            ops,
            reservations,
            catalog,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError> {
        let window = widen_for_utc_date_filter(date, date);
        let sheet = GetTeeSheetUseCase::new(self.reservations.clone(), self.catalog.clone())
            .execute(
                credentials,
                TeeSheetQuery {
                    date,
                    golf_course_id: None,
                },
            )
            .await?;

        let (roster, assignments, attendance, availabilities) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
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
        )?;

        let (day_start, day_end) = course_day_bounds(date, date);
        let live: Vec<_> = assignments
            .iter()
            .filter(|assignment| assignment.holds_the_round())
            .filter(|assignment| {
                let at = assignment.scheduled_at();
                day_start <= at && at < day_end
            })
            .collect();

        // A round that already has somebody on it is not work for this run, and
        // planning it again would put a second caddie on one group.
        let rounds: Vec<PlannableRound> = sheet
            .items()
            .iter()
            .filter(|item| item.requires_caddie())
            .filter(|item| {
                !live
                    .iter()
                    .any(|assignment| assignment.covers_reservation(item.id()))
            })
            .map(|item| {
                Ok(PlannableRound {
                    reservation_id: item.id().clone(),
                    starts_at: round_starts_at(item)?,
                    duration_minutes: Some(item.duration_minutes()),
                    player_count: item.party_size(),
                })
            })
            .collect::<Result<Vec<_>, CourseError>>()?;

        if rounds.is_empty() {
            return Ok(AutoAssignResult::new(dry_run, Vec::new(), Vec::new()));
        }

        let attendance_by_caddie: HashMap<&str, AttendanceState> = attendance
            .items()
            .iter()
            .map(|row| {
                (
                    row.caddie_id().as_str(),
                    AttendanceState::parse(row.attendance_status()),
                )
            })
            .collect();
        let availability_by_caddie: HashMap<&str, AvailabilityStatus> = availabilities
            .iter()
            .map(|row| (row.caddie_id().as_str(), row.status()))
            .collect();

        let caddies: Vec<PlannableCaddie> = roster
            .caddies()
            .iter()
            .filter(|caddie| caddie.is_assignable())
            .map(|caddie| {
                let id = caddie.id().as_str();
                let committed: Vec<_> = live
                    .iter()
                    .filter(|assignment| assignment.caddie_id().as_str() == id)
                    .collect();
                PlannableCaddie {
                    caddie_id: id.to_string(),
                    display_name: caddie.display_name().to_string(),
                    skill_level: caddie.skill_level(),
                    rating_average: caddie.rating_average(),
                    rating_count: caddie.rating_count(),
                    max_rounds_per_day: caddie.max_rounds_per_day(),
                    rounds_assigned_today: committed.len() as i64,
                    attendance: attendance_by_caddie
                        .get(id)
                        .copied()
                        .unwrap_or(AttendanceState::NotClocked),
                    availability: availability_by_caddie.get(id).copied(),
                    busy: committed
                        .iter()
                        .map(|assignment| {
                            let start = assignment.scheduled_at();
                            (
                                start,
                                start + Duration::minutes(assignment.occupied_minutes()),
                            )
                        })
                        .collect(),
                }
            })
            .collect();

        let plan = plan_caddie_assignments(
            &rounds,
            &caddies,
            PlanOptions {
                utc_offset_minutes: JST_OFFSET_MINUTES,
                dry_run,
            },
        );

        if dry_run {
            return Ok(plan);
        }

        let fees: HashMap<&str, (i64, String)> = roster
            .caddies()
            .iter()
            .map(|caddie| {
                (
                    caddie.id().as_str(),
                    (caddie.base_fee_amount(), caddie.currency().to_string()),
                )
            })
            .collect();

        // Written one at a time and in plan order. A partial write is visible on
        // the board and can be re-run; a batch that half-failed would leave the
        // operator unable to tell which rounds are covered.
        for item in plan.assigned() {
            let (fee_amount, fee_currency) = fees
                .get(item.caddie_id().as_str())
                .cloned()
                .unwrap_or((0, "JPY".to_string()));
            self.ops
                .create_caddie_assignment(
                    credentials,
                    UpsertCaddieAssignment {
                        caddie_id: item.caddie_id().clone(),
                        reservation_id: Some(item.reservation_id().clone()),
                        round_reference: None,
                        scheduled_at: item.scheduled_at(),
                        status: Some(ASSIGNED_STATUS.to_string()),
                        assignment_role: Some(PRIMARY_ROLE.to_string()),
                        fee_amount: Some(fee_amount),
                        fee_currency: Some(fee_currency),
                        recommendation_score: None,
                        notes: None,
                    },
                )
                .await?;
        }

        Ok(plan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn the_course_day_starts_the_evening_before_in_utc() {
        // 2026-08-08 in JST runs from 15:00 UTC on the 7th. A guard built on
        // the UTC date would not see the 07:00 round that this plan is mostly
        // about, and would put a second caddie on a group that already has one.
        let date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let (start, end) = course_day_bounds(date, date);

        assert_eq!(start, Utc.with_ymd_and_hms(2026, 8, 7, 15, 0, 0).unwrap());
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 8, 8, 15, 0, 0).unwrap());

        // 07:00 JST on the 8th — the case Field's own date filter drops.
        let morning = Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap();
        assert!(start <= morning && morning < end);
    }

    #[test]
    fn a_tee_time_is_read_back_from_the_sheets_own_offset_string() {
        let item = TeeSheetItem::new(
            "rsv_1",
            "RSV-1",
            None,
            None,
            "golfcrs_1",
            "Course",
            None,
            "2026-08-08T07:00:00+09:00",
            270,
            crate::course::domain::PlayType::Caddie,
            4,
            "Party",
            crate::course::domain::TeeSheetStatus::Confirmed,
            18,
            None,
        );

        assert_eq!(
            round_starts_at(&item).expect("tee time"),
            Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap()
        );
    }
}
