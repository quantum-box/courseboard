//! ReassignCaddieAssignmentUseCase: one use case, one public entrypoint (`execute`).
//!
//! Moving a round that is already placed: the same group to another caddie, or
//! the same caddie to another group, on the day the desk is working. It is the
//! ordinary morning correction — somebody comes in late, a customer asks for a
//! particular caddie, two groups swap starts — and until now the only way
//! through it was to cancel the round and name somebody again, which loses the
//! row and everything filed against it.
//!
//! Deliberately one day wide. Every check here reads the day as a whole —
//! who is out, who is on other work, whose shift covers the tee time — and a
//! move that crossed midnight would be judged against the wrong day's answers.
//! It is also not a decision the day board is asking for.
//!
//! The checks are the ones naming a caddie already applies
//! ([`super::caddie_round_guards`]), minus the row being moved: a round must
//! not be refused for occupying the group it is being moved off.

use std::sync::Arc;

use chrono::{DateTime, NaiveDate, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    parse_tenant_timezone, tenant_date_at, widen_for_utc_date_filter, AssignmentId,
    AvailabilityQuery, CaddieAssignment, CaddieAssignmentQuery, CaddieDutyGateway, CaddieId,
    CaddieRankFeeGateway, CourseError, GatewayCredentials, GolfOpsGateway, ReservationId,
    UpsertCaddieAssignment,
};

use super::caddie_rank_fees::read_caddie_rank_fees;
use super::caddie_round_guards::{check_round_can_be_walked, live_rounds_on, PlacedRound};

/// What the desk changed. Anything left unset stays as it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoveTheRound {
    pub assignment_id: AssignmentId,
    /// The day board this was asked from. The round has to be on it.
    pub date: NaiveDate,
    pub caddie_id: Option<CaddieId>,
    pub reservation_id: Option<ReservationId>,
    /// The new group's tee time. Required when the group changes, since that is
    /// what the overlap and shift checks are made against.
    pub scheduled_at: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
}

pub struct ReassignCaddieAssignmentUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
    duties: Arc<dyn CaddieDutyGateway>,
}

impl ReassignCaddieAssignmentUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        rank_fees: Arc<dyn CaddieRankFeeGateway>,
        duties: Arc<dyn CaddieDutyGateway>,
    ) -> Self {
        Self {
            ops,
            rank_fees,
            duties,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: MoveTheRound,
        timezone: &str,
    ) -> Result<CaddieAssignment, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_ASSIGNMENTS)
            .await?;
        let timezone_id = parse_tenant_timezone(timezone)?;
        let date = input.date;
        let window = widen_for_utc_date_filter(date, date);

        let (roster, assignments, availabilities, rank_fees, on_duty) = tokio::try_join!(
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
            read_caddie_rank_fees(self.ops.as_ref(), self.rank_fees.as_ref(), credentials),
            self.duties
                .list_duty_assignments(credentials.operator_id, date, date),
        )?;

        let live = live_rounds_on(&assignments, date, timezone)?;

        // Read off the day, not by id: a row that belongs to another day is not
        // this board's to move, and the answers every check below is made
        // against were fetched for this one.
        let current = live
            .iter()
            .find(|assignment| assignment.id() == &input.assignment_id)
            .copied()
            .ok_or(CourseError::NotFound("assignment"))?;

        let caddie_id = input
            .caddie_id
            .unwrap_or_else(|| current.caddie_id().clone());
        let reservation_id =
            match input
                .reservation_id
                .or_else(|| current.reservation_id().cloned())
            {
                Some(reservation_id) => reservation_id,
                // A row filed against a round reference rather than a booking has
                // no group to move between, and inventing one here would file the
                // caddie against a booking nobody made.
                None => return Err(CourseError::BadRequest(
                    "this assignment is not against a booking, so there is no group to move it to",
                )),
            };
        // The round reference is the label of the round this row was filed
        // against. Moved to another group it names the wrong one, and the day
        // board reads it in place of the booking — so it goes with the group
        // it belonged to.
        let moved_group = current.reservation_id() != Some(&reservation_id);
        let round_reference = if moved_group {
            None
        } else {
            current.round_reference().map(str::to_string)
        };
        let scheduled_at = input.scheduled_at.unwrap_or_else(|| current.scheduled_at());
        if tenant_date_at(scheduled_at, timezone)? != date {
            return Err(CourseError::BadRequest(
                "a round can only be moved within the same day",
            ));
        }

        let duration_minutes = input
            .duration_minutes
            .or_else(|| i32::try_from(current.occupied_minutes()).ok());

        let caddie = check_round_can_be_walked(
            &roster,
            &live,
            &availabilities,
            &on_duty,
            &PlacedRound {
                caddie_id: &caddie_id,
                reservation_id: &reservation_id,
                scheduled_at,
                date,
                duration_minutes,
                moving: Some(&input.assignment_id),
            },
            timezone_id,
        )?;

        self.ops
            .update_caddie_assignment(
                credentials,
                &input.assignment_id,
                UpsertCaddieAssignment {
                    caddie_id,
                    reservation_id: Some(reservation_id),
                    round_reference,
                    scheduled_at,
                    // Where the round stands is not what a move decides. A
                    // completed round moved off a mistyped group is still
                    // completed.
                    status: Some(current.status_label().to_string()),
                    assignment_role: Some(current.role_label().to_string()),
                    // Recomputed, because the round may have changed hands: a
                    // rank A caddie taking over a rank C caddie's group is paid
                    // their own rate, and the payroll sheet reads this row.
                    fee_amount: Some(
                        rank_fees.round_fee_for(caddie.rank(), caddie.base_fee_amount()),
                    ),
                    fee_currency: Some(caddie.currency().to_string()),
                    recommendation_score: None,
                    notes: current.notes().map(str::to_string),
                },
            )
            .await
    }
}
