//! ListCaddieAssignmentsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CaddieAssignment, CaddieAssignmentQuery, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct ListCaddieAssignmentsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddieAssignmentsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: CaddieAssignmentQuery,
    ) -> Result<Vec<CaddieAssignment>, CourseError> {
        self.ops.list_caddie_assignments(credentials, query).await
    }
}
