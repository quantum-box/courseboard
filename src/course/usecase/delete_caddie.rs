//! DeleteCaddieUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{CaddieId, CourseError, GatewayCredentials, GolfOpsGateway};

pub struct DeleteCaddieUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl DeleteCaddieUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_CADDIES).await?;
        self.ops.delete_caddie(credentials, caddie_id).await
    }
}
