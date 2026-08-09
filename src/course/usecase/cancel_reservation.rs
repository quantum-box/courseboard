//! CancelReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Cancels a booking from the desk — a caller who cannot make their tee time.
//! The reason the desk types is passed through to Field; Field cannot store
//! one yet (PLT-3297), so today it is only carried, not kept.

use std::sync::Arc;

use crate::course::domain::{CourseError, GatewayCredentials, ReservationGateway, ReservationId};

/// Long enough for a sentence, short enough that the field stays a note.
const MAX_REASON_CHARS: usize = 500;

pub struct CancelReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
}

impl CancelReservationUseCase {
    pub fn new(reservations: Arc<dyn ReservationGateway>) -> Self {
        Self { reservations }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        reason: Option<&str>,
    ) -> Result<(), CourseError> {
        if reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }
        let reason = reason.map(str::trim).filter(|value| !value.is_empty());
        if reason.is_some_and(|value| value.chars().count() > MAX_REASON_CHARS) {
            return Err(CourseError::BadRequest(
                "the cancellation reason is too long",
            ));
        }
        self.reservations
            .cancel_reservation(credentials, reservation_id, reason)
            .await
    }
}
