//! ExportPayrollCsvUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{CourseError, GatewayCredentials, GolfOpsGateway};

pub struct ExportPayrollCsvUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ExportPayrollCsvUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        self.ops.export_payroll_csv(credentials, year_month).await
    }
}
