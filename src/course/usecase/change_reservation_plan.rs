//! ChangeReservationPlanUseCase: one use case, one public entrypoint (`execute`).
//!
//! Moves an existing booking onto another plan — the self-play round the desk
//! took over the phone that turns out to want a caddie. The plan decides how
//! long the round takes and how many it seats, so the end time is recomputed
//! and a party that no longer fits is refused rather than quietly truncated.

use std::sync::Arc;

use chrono::Duration;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, ReservationGateway, ReservationId,
    ReservationServiceId,
};

pub struct ChangeReservationPlanUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ChangeReservationPlanUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        service_id: &ReservationServiceId,
    ) -> Result<(), CourseError> {
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
