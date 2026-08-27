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

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDate, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    parse_tenant_timezone, placement_for_shift, plan_caddie_assignments, tenant_date_at,
    tenant_day_bounds, widen_for_utc_date_filter, AttendanceState, AutoAssignResult,
    AvailabilityDeadline, AvailabilityDeadlineGateway, AvailabilityQuery, AvailabilityStatus,
    CaddieAssignmentQuery, CaddieRankFeeGateway, CaddieRoster, CaddieShift, CaddieShiftGateway,
    CourseError, DeadlineWarning, GatewayCredentials, GolfCatalogGateway, GolfOpsGateway,
    PlanOptions, PlannableCaddie, PlannableRound, ReservationGateway, TeeSheetItem, TeeSheetQuery,
    UpsertCaddieAssignment, YearMonth,
};

use super::caddie_rank_fees::read_caddie_rank_fees;
use crate::course::usecase::GetTeeSheetUseCase;

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
    deadlines: Arc<dyn AvailabilityDeadlineGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
}

impl AutoAssignCaddiesUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        deadlines: Arc<dyn AvailabilityDeadlineGateway>,
        shifts: Arc<dyn CaddieShiftGateway>,
        rank_fees: Arc<dyn CaddieRankFeeGateway>,
    ) -> Self {
        Self {
            ops,
            reservations,
            catalog,
            deadlines,
            shifts,
            rank_fees,
        }
    }

    /// A filing-deadline warning for the month `date` falls in, if the
    /// deadline has passed and assignable caddies remain who never filed a
    /// request anywhere in that month.
    ///
    /// Not a block: the desk may already know why someone is missing from the
    /// list. It only makes a gap that would otherwise default silently to
    /// "available" visible before the day is staffed from it.
    async fn deadline_warning(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        today: NaiveDate,
        roster: &CaddieRoster,
    ) -> Result<Option<DeadlineWarning>, CourseError> {
        let year_month = YearMonth::from_date(date);
        let deadline = self
            .deadlines
            .get_deadline(credentials.operator_id, year_month)
            .await?;
        let Some(deadline) = deadline else {
            return Ok(None);
        };
        if !deadline.has_passed(today) {
            return Ok(None);
        }
        let (month_start, month_end) = year_month.bounds();
        let availabilities = self
            .ops
            .list_caddie_availabilities(
                credentials,
                AvailabilityQuery {
                    caddie_id: None,
                    from: Some(month_start),
                    to: Some(month_end),
                    date: None,
                },
            )
            .await?;
        let submitted: HashSet<&str> = availabilities
            .iter()
            .map(|availability| availability.caddie_id().as_str())
            .collect();
        let unsubmitted_names: Vec<String> = roster
            .caddies()
            .iter()
            .filter(|caddie| caddie.is_assignable())
            .filter(|caddie| !submitted.contains(caddie.id().as_str()))
            .map(|caddie| caddie.display_name().to_string())
            .collect();
        Ok(build_deadline_warning(&deadline, unsubmitted_names))
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_ASSIGNMENTS)
            .await?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let timezone_id = parse_tenant_timezone(&timezone)?;
        let today = tenant_date_at(Utc::now(), &timezone)?;
        let window = widen_for_utc_date_filter(date, date);
        let sheet = GetTeeSheetUseCase::new(self.reservations.clone(), self.catalog.clone())
            .execute(
                credentials,
                TeeSheetQuery {
                    date,
                    to: None,
                    golf_course_id: None,
                },
            )
            .await?;

        let (roster, assignments, attendance, availabilities, confirmed) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
                    reservation_id: None,
                },
            ),
            self.ops
                .get_attendance_snapshot(credentials, Some(date), &timezone),
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

        // Where the confirmed month put each caddie. A day nobody confirmed
        // leaves this empty, and the plan then behaves exactly as it did
        // before placements existed.
        let shift_by_caddie: HashMap<&str, &CaddieShift> = confirmed
            .iter()
            .filter(|shift| shift.date() == date)
            .map(|shift| (shift.caddie_id().as_str(), shift))
            .collect();

        let (day_start, day_end) = tenant_day_bounds(date, date, &timezone)?;
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
                    course_id: Some(item.golf_course_id().clone()),
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
            // A day confirmed as off is not a candidate, whatever the request
            // behind it said — the desk may have changed it either way.
            .filter(|caddie| {
                shift_by_caddie
                    .get(caddie.id().as_str())
                    .map(|shift| shift.is_working())
                    .unwrap_or(true)
            })
            .map(|caddie| {
                let id = caddie.id().as_str();
                let committed: Vec<_> = live
                    .iter()
                    .filter(|assignment| assignment.caddie_id().as_str() == id)
                    .collect();
                PlannableCaddie {
                    placement: placement_for_shift(shift_by_caddie.get(id).copied()),
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
                timezone: timezone_id,
                dry_run,
            },
        );
        let deadline_warning = self
            .deadline_warning(credentials, date, today, &roster)
            .await?;
        let plan = plan.with_deadline_warning(deadline_warning);

        if dry_run {
            return Ok(plan);
        }

        // What each round pays, so Field's own record of it agrees with the
        // payroll sheet rather than reading 0 for every caddie who is simply
        // paid by their rank.
        let rank_fees =
            read_caddie_rank_fees(self.ops.as_ref(), self.rank_fees.as_ref(), credentials).await?;
        let fees: HashMap<&str, (i64, String)> = roster
            .caddies()
            .iter()
            .map(|caddie| {
                (
                    caddie.id().as_str(),
                    (
                        rank_fees.round_fee_for(caddie.rank(), caddie.base_fee_amount()),
                        caddie.currency().to_string(),
                    ),
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

/// Pure decision: whether a filing-deadline warning should attach to the
/// plan, given who has not filed. Kept separate from `deadline_warning` so
/// the "does this warning make sense" question can be tested without a
/// gateway or the system clock.
fn build_deadline_warning(
    deadline: &AvailabilityDeadline,
    unsubmitted_caddie_names: Vec<String>,
) -> Option<DeadlineWarning> {
    if unsubmitted_caddie_names.is_empty() {
        return None;
    }
    Some(DeadlineWarning::new(
        deadline.deadline_date(),
        unsubmitted_caddie_names,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn a_deadline() -> AvailabilityDeadline {
        AvailabilityDeadline::try_new(
            YearMonth::parse("2026-08").unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
        )
    }

    #[test]
    fn nobody_left_unsubmitted_means_no_warning() {
        assert!(build_deadline_warning(&a_deadline(), Vec::new()).is_none());
    }

    #[test]
    fn unsubmitted_caddies_are_carried_by_name_with_the_deadline_date() {
        let warning =
            build_deadline_warning(&a_deadline(), vec!["Sato".into(), "Tanaka".into()]).unwrap();
        assert_eq!(
            warning.deadline_date(),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap()
        );
        assert_eq!(
            warning.unsubmitted_caddie_names(),
            &["Sato".to_string(), "Tanaka".to_string()]
        );
    }

    #[test]
    fn the_course_day_starts_the_evening_before_in_utc() {
        // 2026-08-08 in JST runs from 15:00 UTC on the 7th. A guard built on
        // the UTC date would not see the 07:00 round that this plan is mostly
        // about, and would put a second caddie on a group that already has one.
        let date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let (start, end) = tenant_day_bounds(date, date, "Asia/Tokyo").unwrap();

        assert_eq!(start, Utc.with_ymd_and_hms(2026, 8, 7, 15, 0, 0).unwrap());
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 8, 8, 15, 0, 0).unwrap());

        // 07:00 JST on the 8th — the case Field's own date filter drops.
        let morning = Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap();
        assert!(start <= morning && morning < end);
    }

    #[test]
    fn deadline_today_uses_the_tenant_date_during_the_jst_midnight_window() {
        let instant = Utc.with_ymd_and_hms(2026, 8, 10, 15, 30, 0).unwrap();
        let deadline = AvailabilityDeadline::try_new(
            YearMonth::parse("2026-09").unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
        );

        let tenant_today = tenant_date_at(instant, "Asia/Tokyo").unwrap();
        assert_eq!(tenant_today, NaiveDate::from_ymd_opt(2026, 8, 11).unwrap());
        assert!(deadline.has_passed(tenant_today));
        assert!(!deadline.has_passed(instant.date_naive()));
    }

    #[test]
    fn deadline_today_changes_when_the_tenant_timezone_changes() {
        let instant = Utc.with_ymd_and_hms(2026, 8, 10, 15, 30, 0).unwrap();
        let deadline = AvailabilityDeadline::try_new(
            YearMonth::parse("2026-09").unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
        );

        let tokyo_today = tenant_date_at(instant, "Asia/Tokyo").unwrap();
        let honolulu_today = tenant_date_at(instant, "Pacific/Honolulu").unwrap();
        assert_eq!(tokyo_today, NaiveDate::from_ymd_opt(2026, 8, 11).unwrap());
        assert_eq!(
            honolulu_today,
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap()
        );
        assert!(deadline.has_passed(tokyo_today));
        assert!(!deadline.has_passed(honolulu_today));
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
            Vec::new(),
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
