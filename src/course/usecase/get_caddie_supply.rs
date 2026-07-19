//! GetCaddieSupplyUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{CaddieSupply, CourseError, GatewayCredentials, GolfOpsGateway};

pub struct GetCaddieSupplyUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetCaddieSupplyUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        safety_buffer: Option<i64>,
    ) -> Result<CaddieSupply, CourseError> {
        self.ops
            .get_caddie_supply(credentials, date, safety_buffer)
            .await
    }
}
