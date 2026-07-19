//! UpdateCaddieUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    Caddie, CaddieId, CourseError, GatewayCredentials, GolfOpsGateway, UpsertCaddie,
};

pub struct UpdateCaddieUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl UpdateCaddieUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        self.ops.update_caddie(credentials, caddie_id, input).await
    }
}
