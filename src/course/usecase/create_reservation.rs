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

/// A round is a day's work at most; anything longer is a typo or an attack.
const MAX_DURATION_MINUTES: i64 = 24 * 60;

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
        // Bounded, not just positive: chrono panics well before i64 runs out,
        // so an absurd number would abort the request instead of answering 400.
        if input.duration_minutes <= 0 || input.duration_minutes > MAX_DURATION_MINUTES {
            return Err(CourseError::BadRequest(
                "duration must be between 1 minute and 24 hours",
            ));
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
        match self.commercial.get_reservation_policy(credentials).await {
            Ok(policy) => {
                let from_policy = policy.reservation_type_id().trim().to_string();
                if !from_policy.is_empty() {
                    return Ok(from_policy);
                }
            }
            // Only "there is no policy" falls through — Field answers that as a
            // 404. A timeout or a 5xx is a real upstream failure, and swallowing
            // it would book the round under whichever type happened to be first.
            Err(CourseError::NotFound(_)) => {}
            Err(CourseError::UpstreamClient { status: 404, .. }) => {}
            Err(error) => return Err(error),
        }
        self.reservations
            .list_reservation_type_ids(credentials)
            .await?
            .into_iter()
            .next()
            .ok_or(CourseError::BadRequest(
                "この施設ではまだ予約を受け付ける準備ができていません。導入担当にご連絡ください",
            ))
    }
}
