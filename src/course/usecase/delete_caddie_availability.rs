//! DeleteCaddieAvailabilityUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{CaddieId, CourseError, GatewayCredentials, GolfOpsGateway};

pub struct DeleteCaddieAvailabilityUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl DeleteCaddieAvailabilityUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        date: NaiveDate,
    ) -> Result<(), CourseError> {
        self.ops
            .delete_caddie_availability(credentials, caddie_id, date)
            .await
    }
}
