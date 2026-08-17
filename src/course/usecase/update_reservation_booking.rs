//! UpdateReservationBookingUseCase: one use case, one public entrypoint (`execute`).
//!
//! Corrects the two things a booking is taken with — who it is for and how many
//! are playing. Both are entered on the phone and both change afterwards: a
//! four-ball turns up as three, a name was written down wrong. Neither is golf
//! group detail, so this writes the generic booking's own fields and leaves the
//! party where it is.

use std::sync::Arc;

use crate::course::domain::{
    CourseError, CustomerId, GatewayCredentials, GolfCatalogGateway, ReservationBookingUpdate,
    ReservationGateway, ReservationId,
};

pub struct UpdateReservationBookingInput {
    pub customer_name: String,
    pub customer_id: Option<CustomerId>,
    pub quantity: i32,
}

pub struct UpdateReservationBookingUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl UpdateReservationBookingUseCase {
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
        input: UpdateReservationBookingInput,
    ) -> Result<(), CourseError> {
        if reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }
        let customer_name = input.customer_name.trim();
        if customer_name.is_empty() {
            return Err(CourseError::BadRequest("customer name is required"));
        }
        if input.quantity <= 0 {
            return Err(CourseError::BadRequest("quantity must be positive"));
        }

        let reservation = self
            .reservations
            .get_reservation(credentials, reservation_id)
            .await?;

        // The plan's seat limit is the club's rule, so it is checked here and
        // not only in the sheet: the same cap the booking form applies when the
        // round is first sold has to survive the round being re-counted.
        if let Some(service_id) = reservation.service_id() {
            let products = self.catalog.list_reservation_products(credentials).await?;
            if let Some(max_players) = products
                .iter()
                .find(|product| product.reservation_service_id() == service_id)
                .and_then(|product| product.max_players_per_group())
            {
                if input.quantity > max_players {
                    return Err(CourseError::BadRequest(
                        "the plan seats fewer players than this booking has",
                    ));
                }
            }
        }

        self.reservations
            .update_reservation_booking(
                credentials,
                reservation_id,
                &ReservationBookingUpdate {
                    customer_name: customer_name.to_string(),
                    customer_id: input.customer_id,
                    quantity: input.quantity,
                },
            )
            .await
    }
}
