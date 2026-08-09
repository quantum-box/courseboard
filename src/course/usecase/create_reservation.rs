//! CreateReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Lets the desk book an empty tee time straight from the ledger, for a
//! walk-in or phone booking that never went through a customer-facing
//! channel. The reservation type is read off the tenant's own policy rather
//! than asked for: Field requires one on every booking and offers no way to
//! create one, so the desk has only the one the tenant already set up.

use std::sync::Arc;

use chrono::{Duration, NaiveDate};

use crate::course::domain::{
    parse_jst_tee_time, CourseError, CourseId, GatewayCredentials, GolfCommercialGateway,
    NewReservation, PartyDetails, ReservationGateway, ReservationId,
};

pub struct CreateReservationInput {
    pub golf_course_id: CourseId,
    pub reservation_service_id: Option<String>,
    pub date: NaiveDate,
    /// Wall clock on the course's own day, e.g. `"07:14"`.
    pub tee_time: String,
    pub duration_minutes: i64,
    pub quantity: i32,
    pub customer_name: String,
}

pub struct CreateReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl CreateReservationUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
    ) -> Self {
        Self {
            reservations,
            commercial,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: CreateReservationInput,
    ) -> Result<ReservationId, CourseError> {
        let customer_name = input.customer_name.trim();
        if customer_name.is_empty() {
            return Err(CourseError::BadRequest("customer name is required"));
        }
        if input.quantity <= 0 {
            return Err(CourseError::BadRequest("quantity must be positive"));
        }
        if input.duration_minutes <= 0 {
            return Err(CourseError::BadRequest("duration must be positive"));
        }

        let starts_at = parse_jst_tee_time(input.date, &input.tee_time)?;
        let ends_at = starts_at + Duration::minutes(input.duration_minutes);

        let reservation_type_id = self.reservation_type_id(credentials).await?;

        let new_reservation = NewReservation {
            reservation_type_id,
            reservation_service_id: input.reservation_service_id,
            starts_at,
            ends_at,
            quantity: input.quantity,
            customer_name: customer_name.to_string(),
            golf_course_id: input.golf_course_id,
            party: PartyDetails::try_new(None, None, None, Vec::new())?,
            seed_key: None,
        };

        self.reservations
            .create_reservation(credentials, &new_reservation)
            .await
    }

    /// The reservation type every Field booking needs.
    ///
    /// The club's policy names one, but a tenant can be operating without a
    /// policy row — the ledger works fine without one, so a booking should
    /// too. Falling back to the tenant's own reservation type keeps the desk
    /// working instead of stopping it on a setting it never chose.
    async fn reservation_type_id(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<String, CourseError> {
        if let Ok(policy) = self.commercial.get_reservation_policy(credentials).await {
            let from_policy = policy.reservation_type_id().trim().to_string();
            if !from_policy.is_empty() {
                return Ok(from_policy);
            }
        }
        self.reservations
            .list_reservation_type_ids(credentials)
            .await?
            .into_iter()
            .next()
            .ok_or(CourseError::BadRequest(
                "this tenant has no reservation type, and Field offers no way to create one; \
                 add one in Field before booking",
            ))
    }
}
