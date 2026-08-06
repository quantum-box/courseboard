//! AutoAssignCaddiesUseCase: one use case, one public entrypoint (`execute`).
//!
//! This used to be a straight proxy to Field. Field's planner never read
//! attendance, so it would fill a tee time with a caddie who had not clocked
//! in, and it wrote its reasons as Japanese sentences compiled into the binary
//! — an operator reading the app in English got Japanese.
//!
//! Planning the day is golf operations (ADR-0005), and every input is already
//! something CourseBoard reads: the day's reservations, the roster, the
//! assignments already on the board, what the caddies said about the day, and
//! the attendance snapshot.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    plan_auto_assignments, AssignmentStatus, AttendanceState, AutoAssignCandidate,
    AutoAssignPlanItem, AutoAssignResult, AutoAssignSkippedItem, AutoAssignSlot, AvailabilityQuery,
    CaddieAssignmentQuery, CourseError, GatewayCredentials, GolfOpsGateway, PayrollPeriod,
    ReservationGateway, UpsertCaddieAssignment,
};

/// Marks the rows this use case wrote, so an operator reading the assignment
/// list can tell a planned round from one somebody placed by hand.
const AUTO_ASSIGNED_NOTE: &str = "auto_assigned";

pub struct AutoAssignCaddiesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    reservations: Arc<dyn ReservationGateway>,
}

impl AutoAssignCaddiesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, reservations: Arc<dyn ReservationGateway>) -> Self {
        Self { ops, reservations }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError> {
        // The contract balance is a monthly figure, so the month around the day
        // being planned is read alongside the day itself.
        let month = PayrollPeriod::for_date(date);

        let (reservations, roster, day_assignments, month_assignments, availabilities, attendance) =
            tokio::try_join!(
                self.reservations.list_reservations(credentials),
                self.ops.list_caddie_roster(credentials),
                self.ops.list_caddie_assignments(
                    credentials,
                    CaddieAssignmentQuery {
                        caddie_id: None,
                        from: Some(date),
                        to: Some(date),
                    },
                ),
                self.ops.list_caddie_assignments(
                    credentials,
                    CaddieAssignmentQuery {
                        caddie_id: None,
                        from: Some(month.start_date()),
                        to: Some(month.end_date()),
                    },
                ),
                self.ops.list_caddie_availabilities(
                    credentials,
                    AvailabilityQuery {
                        caddie_id: None,
                        from: None,
                        to: None,
                        date: Some(date),
                    },
                ),
                self.ops.get_attendance_snapshot(credentials, Some(date)),
            )?;

        // A round that is already on the board holds its caddie; a cancelled one
        // does not, and neither does it count towards anybody's contract.
        let live = |status: AssignmentStatus| status != AssignmentStatus::Cancelled;

        let mut rounds_today: HashMap<String, i64> = HashMap::new();
        let mut taken_reservations: Vec<String> = Vec::new();
        for assignment in day_assignments.iter().filter(|a| live(a.status())) {
            *rounds_today
                .entry(assignment.caddie_id().to_string())
                .or_insert(0) += 1;
            if let Some(reservation_id) = assignment.reservation_id() {
                taken_reservations.push(reservation_id.to_string());
            }
        }

        let mut rounds_this_month: HashMap<String, i64> = HashMap::new();
        for assignment in month_assignments.iter().filter(|a| live(a.status())) {
            *rounds_this_month
                .entry(assignment.caddie_id().to_string())
                .or_insert(0) += 1;
        }

        let availability_by_caddie: HashMap<String, (_, bool)> = availabilities
            .iter()
            .map(|row| {
                (
                    row.caddie_id().to_string(),
                    (row.status(), row.two_round_request()),
                )
            })
            .collect();

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

        let candidates: Vec<AutoAssignCandidate> = roster
            .caddies()
            .iter()
            .map(|caddie| {
                let id = caddie.id().to_string();
                let availability = availability_by_caddie.get(&id);
                AutoAssignCandidate {
                    display_name: caddie.display_name().to_string(),
                    is_active: caddie.is_active(),
                    can_two_rounds: caddie.can_two_rounds(),
                    max_rounds_per_day: caddie.max_rounds_per_day(),
                    monthly_contract_rounds: caddie.monthly_contract_rounds(),
                    rounds_done_this_month: rounds_this_month.get(&id).copied().unwrap_or(0),
                    rounds_assigned_today: rounds_today.get(&id).copied().unwrap_or(0),
                    rating_average: caddie.rating_average(),
                    availability: availability.map(|(status, _)| *status),
                    two_round_request: availability.is_some_and(|(_, requested)| *requested),
                    // Missing from the snapshot reads as not clocked in: the
                    // snapshot is what a clock-in writes to.
                    attendance: attendance_by_caddie
                        .get(&id)
                        .copied()
                        .unwrap_or(AttendanceState::NotClocked),
                    caddie_id: id,
                }
            })
            .collect();

        // Only the day's rounds that still need somebody. A reservation that
        // already has a caddie is left exactly as the operator left it.
        let slots: Vec<AutoAssignSlot> = reservations
            .iter()
            .filter(|reservation| reservation.starts_at().date_naive() == date)
            .filter(|reservation| !reservation.status().eq_ignore_ascii_case("cancelled"))
            .filter(|reservation| !taken_reservations.contains(&reservation.id().to_string()))
            .map(|reservation| AutoAssignSlot {
                reservation_id: reservation.id().to_string(),
                starts_at: reservation.starts_at(),
            })
            .collect();

        let plan = plan_auto_assignments(&slots, &candidates);

        if !dry_run {
            for item in &plan.assigned {
                self.ops
                    .create_caddie_assignment(
                        credentials,
                        UpsertCaddieAssignment {
                            caddie_id: item.caddie_id.clone().into(),
                            reservation_id: Some(item.reservation_id.clone().into()),
                            round_reference: None,
                            scheduled_at: item.scheduled_at,
                            status: Some(AssignmentStatus::Assigned.as_str().to_string()),
                            assignment_role: Some("primary".to_string()),
                            fee_amount: None,
                            fee_currency: None,
                            recommendation_score: None,
                            notes: Some(AUTO_ASSIGNED_NOTE.to_string()),
                        },
                    )
                    .await?;
            }
        }

        Ok(AutoAssignResult::new(
            dry_run,
            plan.assigned
                .into_iter()
                .map(|item| {
                    AutoAssignPlanItem::reconstitute(
                        item.reservation_id,
                        item.scheduled_at,
                        item.caddie_id,
                        item.caddie_display_name,
                        item.rationale,
                    )
                })
                .collect(),
            plan.skipped
                .into_iter()
                .map(|item| AutoAssignSkippedItem::new(item.reservation_id, item.reason))
                .collect(),
        ))
    }
}
