//! CreateCaddieUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    Caddie, CourseError, GatewayCredentials, GolfOpsGateway, UpsertCaddie,
};

pub struct CreateCaddieUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl CreateCaddieUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        input.require_staff_link()?;
        self.ops.create_caddie(credentials, input).await
    }
}
