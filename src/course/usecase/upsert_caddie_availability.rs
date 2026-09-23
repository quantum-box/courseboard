//! UpsertCaddieAvailabilityUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieAvailability, CourseError, GatewayCredentials, GolfOpsGateway, UpsertCaddieAvailability,
};

pub struct UpsertCaddieAvailabilityUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl UpsertCaddieAvailabilityUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddieAvailability,
    ) -> Result<CaddieAvailability, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_AVAILABILITY)
            .await?;
        self.ops
            .upsert_caddie_availability(credentials, input)
            .await
    }
}
