//! ListCaddieRatingsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CaddieId, CaddieRating, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct ListCaddieRatingsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddieRatingsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: Option<&CaddieId>,
    ) -> Result<Vec<CaddieRating>, CourseError> {
        self.ops.list_caddie_ratings(credentials, caddie_id).await
    }
}
