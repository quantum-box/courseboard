//! UpdateCaddieAssignmentUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    AssignmentId, CaddieAssignment, CourseError, GatewayCredentials, GolfOpsGateway,
    UpsertCaddieAssignment,
};

pub struct UpdateCaddieAssignmentUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl UpdateCaddieAssignmentUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        assignment_id: &AssignmentId,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError> {
        self.ops
            .update_caddie_assignment(credentials, assignment_id, input)
            .await
    }
}
