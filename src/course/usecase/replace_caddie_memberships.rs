//! ReplaceCaddieMembershipsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieCourseMembership, CaddieId, CourseError, GatewayCredentials, GolfOpsGateway,
    ReplaceCaddieMemberships,
};

pub struct ReplaceCaddieMembershipsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ReplaceCaddieMembershipsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        input: ReplaceCaddieMemberships,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
        credentials.require(actions::MANAGE_CADDIES).await?;
        self.ops
            .replace_caddie_memberships(credentials, caddie_id, input)
            .await
    }
}
