//! ChangeReservationPlanUseCase: one use case, one public entrypoint (`execute`).
//!
//! Moves an existing booking onto another plan — the self-play round the desk
//! took over the phone that turns out to want a caddie. The plan decides how
//! long the round takes and how many it seats, so the end time is recomputed
//! and a party that no longer fits is refused rather than quietly truncated.

use std::sync::Arc;

use chrono::Duration;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, Reservation, ReservationGateway,
    ReservationId, ReservationServiceId, VisitCheckinGateway,
};

/// Why this booking's plan can no longer change, if it cannot (SCC-9).
///
/// The plan is what a booking is priced and staffed on: self or caddie, and how
/// long the round holds the tee. Changing it once money has been taken rewrites
/// the ground under an amount already collected — the monthly close, the sales
/// target and the caddie fees would all disagree with what was settled. Once
/// the group has checked in the round is under way: a caddie already placed
/// would be left without a group, or a caddie asked for who cannot appear on
/// the spot. Which of those the desk meant is not a call this can make, so it
/// refuses and says why.
///
/// A deposit is money taken, so any amount counts. Field's payment state is
/// passed through as a string CourseBoard does not interpret, so the amount is
/// what is read, not the state.
fn plan_change_blocked(reservation: &Reservation, checked_in: bool) -> Option<&'static str> {
    let status = reservation.status();
    if reservation.billing().is_cancelled() || status == "cancelled" {
        return Some("a cancelled booking keeps the plan it was cancelled under");
    }
    if matches!(status, "completed" | "no_show") {
        return Some("the round is over; its plan is what it was played or missed under");
    }
    if checked_in || matches!(status, "checked_in" | "on_course") {
        return Some("the group has checked in; the plan cannot change under a round in progress");
    }
    if reservation.billing().paid_amount > 0 {
        return Some("money has been taken against this booking under its current plan");
    }
    None
}

pub struct ChangeReservationPlanUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    checkins: Arc<dyn VisitCheckinGateway>,
}

impl ChangeReservationPlanUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        checkins: Arc<dyn VisitCheckinGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
            checkins,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        service_id: &ReservationServiceId,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        if reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }
        if service_id.trim().is_empty() {
            return Err(CourseError::BadRequest("plan is required"));
        }

        let reservation = self
            .reservations
            .get_reservation(credentials, reservation_id)
            .await?;

        // Arrivals are CourseBoard's own record, not Field's, so they are read
        // here rather than off the reservation.
        let checked_in = !self
            .checkins
            .list_reservation_checkins(credentials.operator_id, reservation_id)
            .await?
            .is_empty();
        if let Some(reason) = plan_change_blocked(&reservation, checked_in) {
            return Err(CourseError::Conflict(reason));
        }

        let products = self.catalog.list_reservation_products(credentials).await?;
        let product = products
            .iter()
            .find(|product| product.reservation_service_id() == service_id)
            .ok_or(CourseError::NotFound("plan not found"))?;

        // A plan sold on another course would put the round on a tee sheet the
        // desk is not looking at, the same rule the booking sheet applies when
        // it filters the list.
        if let Some(course_id) = reservation.golf_course_id() {
            if !product.is_sold_on(course_id) {
                return Err(CourseError::BadRequest(
                    "the plan is not sold on this booking's course",
                ));
            }
        }

        // Shrinking the plan under the group already booked would leave players
        // with no seat. Which of them to drop is not a call this can make.
        if let Some(max_players) = product.max_players_per_group() {
            if reservation.quantity() > max_players {
                return Err(CourseError::BadRequest(
                    "the plan seats fewer players than this booking has",
                ));
            }
        }

        let ends_at = reservation.starts_at()
            + Duration::minutes(i64::from(product.fallback_duration_minutes()));
        self.reservations
            .update_reservation_plan(credentials, reservation_id, service_id, ends_at)
            .await
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;
    use crate::course::domain::ReservationBilling;

    fn booking(status: &str, paid_amount: i64) -> Reservation {
        let starts_at = Utc.with_ymd_and_hms(2026, 9, 25, 0, 0, 0).unwrap();
        Reservation::reconstitute(
            "res-1",
            "R-1",
            Some("svc-self".to_string()),
            None,
            Some("本田会".to_string()),
            status,
            starts_at,
            starts_at + chrono::Duration::minutes(270),
            4,
            Some("course-1".to_string()),
            None,
        )
        .with_billing(ReservationBilling {
            paid_amount,
            ..ReservationBilling::default()
        })
    }

    #[test]
    fn an_unpaid_booking_nobody_has_arrived_for_can_change_plan() {
        // The case PR #194 added the route for: a self round taken over the
        // phone that turns out to want a caddie.
        assert_eq!(plan_change_blocked(&booking("confirmed", 0), false), None);
        assert_eq!(plan_change_blocked(&booking("requested", 0), false), None);
    }

    #[test]
    fn money_taken_keeps_the_plan_it_was_taken_under() {
        // A deposit is money taken too; any amount counts.
        assert!(plan_change_blocked(&booking("confirmed", 1), false).is_some());
        assert!(plan_change_blocked(&booking("confirmed", 48_000), false).is_some());
    }

    #[test]
    fn a_group_that_has_checked_in_keeps_its_plan() {
        // CourseBoard's own arrival record, and Field's status, both count.
        assert!(plan_change_blocked(&booking("confirmed", 0), true).is_some());
        assert!(plan_change_blocked(&booking("checked_in", 0), false).is_some());
        assert!(plan_change_blocked(&booking("on_course", 0), false).is_some());
    }

    #[test]
    fn a_round_that_is_over_or_cancelled_keeps_its_plan() {
        for status in ["completed", "no_show", "cancelled"] {
            assert!(
                plan_change_blocked(&booking(status, 0), false).is_some(),
                "{status}"
            );
        }
        let mut cancelled = booking("confirmed", 0);
        cancelled = cancelled.with_billing(ReservationBilling {
            cancelled_at: Some(Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap()),
            ..ReservationBilling::default()
        });
        assert!(plan_change_blocked(&cancelled, false).is_some());
    }
}
