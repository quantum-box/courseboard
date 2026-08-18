//! ListCaddieMembershipsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieCourseMembership, CaddieId, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct ListCaddieMembershipsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddieMembershipsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
        credentials.require(actions::LIST_CADDIES).await?;
        self.ops
            .list_caddie_memberships(credentials, caddie_id)
            .await
    }
}
