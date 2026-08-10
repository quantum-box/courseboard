//! CreateCaddieAssignmentUseCase: one use case, one public entrypoint (`execute`).
//!
//! Naming a caddie by hand is the other half of planning a day: the automatic
//! run covers the ordinary case, and the desk still has to put a specific
//! person on a specific group — a request from the customer, a swap on the
//! morning, a round the plan could not fill.
//!
//! The checks are the same ones the planner applies to itself (ADR-0005 puts
//! them on this side). Skipping them here would let the desk create by hand the
//! exact states the planner refuses to create: two caddies on one group, or one
//! caddie on two groups that overlap.

use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};

use crate::course::domain::{
    parse_tenant_timezone, shift_covers_tee_time, tenant_date_at, tenant_day_bounds,
    widen_for_utc_date_filter, AvailabilityQuery, CaddieAssignment, CaddieAssignmentQuery,
    CaddieId, CourseError, GatewayCredentials, GolfOpsGateway, ReservationId,
    UpsertCaddieAssignment,
};

/// How long the new round holds its caddie when the caller does not say.
const DEFAULT_ROUND_MINUTES: i64 = 270;

const ASSIGNED_STATUS: &str = "assigned";
const PRIMARY_ROLE: &str = "primary";

/// What the desk asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameCaddieForRound {
    pub caddie_id: CaddieId,
    pub reservation_id: ReservationId,
    pub scheduled_at: DateTime<Utc>,
    pub duration_minutes: Option<i32>,
    pub assignment_role: Option<String>,
    pub notes: Option<String>,
}

pub struct CreateCaddieAssignmentUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl CreateCaddieAssignmentUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: NameCaddieForRound,
        timezone: &str,
    ) -> Result<CaddieAssignment, CourseError> {
        let timezone_id = parse_tenant_timezone(timezone)?;
        let date = tenant_date_at(input.scheduled_at, timezone)?;
        let window = widen_for_utc_date_filter(date, date);

        let (roster, assignments, availabilities, rank_fees) = tokio::try_join!(
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
            self.ops.list_caddie_availabilities(
                credentials,
                AvailabilityQuery {
                    caddie_id: None,
                    from: Some(date),
                    to: Some(date),
                    date: None,
                },
            ),
            self.ops.get_caddie_rank_fees(credentials),
        )?;

        let caddie = roster
            .caddies()
            .iter()
            .find(|caddie| caddie.id() == &input.caddie_id)
            .ok_or(CourseError::NotFound("caddie"))?;
        if !caddie.is_assignable() {
            return Err(CourseError::BadRequest(
                "this caddie is not taking rounds; set them back to active on the roster first",
            ));
        }

        if !shift_covers_tee_time(
            availabilities
                .iter()
                .find(|row| row.caddie_id() == &input.caddie_id)
                .map(|row| row.status()),
            Some(input.scheduled_at),
            timezone_id,
        ) {
            return Err(CourseError::BadRequest(
                "this caddie's shift for the day does not cover that tee time",
            ));
        }

        let (day_start, day_end) = tenant_day_bounds(date, date, timezone)?;
        let live: Vec<&CaddieAssignment> = assignments
            .iter()
            .filter(|assignment| assignment.holds_the_round())
            .filter(|assignment| {
                let at = assignment.scheduled_at();
                day_start <= at && at < day_end
            })
            .collect();

        if live
            .iter()
            .any(|assignment| assignment.covers_reservation(&input.reservation_id))
        {
            return Err(CourseError::BadRequest(
                "this group already has a caddie; cancel that assignment before naming another",
            ));
        }

        let ends_at = input.scheduled_at
            + Duration::minutes(
                input
                    .duration_minutes
                    .filter(|value| *value > 0)
                    .map(i64::from)
                    .unwrap_or(DEFAULT_ROUND_MINUTES),
            );
        if live.iter().any(|assignment| {
            assignment.caddie_id() == &input.caddie_id
                && overlaps(
                    input.scheduled_at,
                    ends_at,
                    assignment.scheduled_at(),
                    assignment.scheduled_at() + Duration::minutes(assignment.occupied_minutes()),
                )
        }) {
            return Err(CourseError::BadRequest(
                "this caddie is already out on a round that overlaps that tee time",
            ));
        }

        self.ops
            .create_caddie_assignment(
                credentials,
                UpsertCaddieAssignment {
                    caddie_id: input.caddie_id,
                    reservation_id: Some(input.reservation_id),
                    round_reference: None,
                    scheduled_at: input.scheduled_at,
                    status: Some(ASSIGNED_STATUS.to_string()),
                    assignment_role: Some(
                        input
                            .assignment_role
                            .unwrap_or_else(|| PRIMARY_ROLE.to_string()),
                    ),
                    // What the round pays, so Field's own record of it agrees
                    // with the payroll sheet rather than reading 0 for every
                    // caddie who is simply paid by their rank.
                    fee_amount: Some(
                        rank_fees.round_fee_for(caddie.rank(), caddie.base_fee_amount()),
                    ),
                    fee_currency: Some(caddie.currency().to_string()),
                    recommendation_score: None,
                    notes: input.notes,
                },
            )
            .await
    }
}

fn overlaps(
    left_start: DateTime<Utc>,
    left_end: DateTime<Utc>,
    right_start: DateTime<Utc>,
    right_end: DateTime<Utc>,
) -> bool {
    left_start < right_end && right_start < left_end
}
