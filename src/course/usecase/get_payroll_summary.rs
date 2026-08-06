//! GetPayrollSummaryUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{CourseError, GatewayCredentials, GolfOpsGateway, PayrollSummary};

pub struct GetPayrollSummaryUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetPayrollSummaryUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<PayrollSummary, CourseError> {
        self.ops.get_payroll_summary(credentials, year_month).await
    }
}
