//! AutoAssignCaddiesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{AutoAssignResult, CourseError, GatewayCredentials, GolfOpsGateway};

pub struct AutoAssignCaddiesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl AutoAssignCaddiesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError> {
        self.ops
            .auto_assign_caddies(credentials, date, dry_run)
            .await
    }
}
