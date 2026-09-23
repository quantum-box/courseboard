//! GetReservationPolicyUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, ReservationPolicy,
};

pub struct GetReservationPolicyUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl GetReservationPolicyUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<ReservationPolicy>, CourseError> {
        credentials
            .require(actions::LIST_RESERVATION_POLICY)
            .await?;
        self.commercial.get_reservation_policy(credentials).await
    }
}
