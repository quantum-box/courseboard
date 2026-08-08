//! UpdateReservationPartyUseCase: one use case, one public entrypoint (`execute`).
//!
//! Replaces the competition, group number, and named players the desk keeps on
//! one booking. The gateway is responsible for merging into the reservation's
//! existing custom fields; this case only decides what a valid party is.

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, PartyDetails, ReservationGateway, ReservationId,
};

pub struct UpdateReservationPartyUseCase {
    reservations: Arc<dyn ReservationGateway>,
}

impl UpdateReservationPartyUseCase {
    pub fn new(reservations: Arc<dyn ReservationGateway>) -> Self {
        Self { reservations }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        party: PartyDetails,
    ) -> Result<PartyDetails, CourseError> {
        if reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }
        self.reservations
            .update_reservation_party(credentials, reservation_id, &party)
            .await
    }
}
