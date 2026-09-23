//! ListCaddieAvailabilitiesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    AvailabilityQuery, CaddieAvailability, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct ListCaddieAvailabilitiesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddieAvailabilitiesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: AvailabilityQuery,
    ) -> Result<Vec<CaddieAvailability>, CourseError> {
        credentials
            .require(actions::LIST_CADDIE_AVAILABILITY)
            .await?;
        self.ops
            .list_caddie_availabilities(credentials, query)
            .await
    }
}
