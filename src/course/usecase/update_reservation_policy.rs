//! UpdateReservationPolicyUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, ReservationPolicy,
    UpdateReservationPolicy,
};

pub struct UpdateReservationPolicyUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl UpdateReservationPolicyUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateReservationPolicy,
    ) -> Result<ReservationPolicy, CourseError> {
        self.commercial
            .update_reservation_policy(credentials, input)
            .await
    }
}
