//! ExportPayrollCsvUseCase: one use case, one public entrypoint (`execute`).
//!
//! Field used to render this file. It cannot any more: the amounts are priced
//! off a rank table Field does not have (ADR-0005), so a Field-rendered export
//! would disagree with the screen it was downloaded from — the worst possible
//! failure for a payroll sheet, because both look right on their own. The file
//! is built from the same summary the screen shows.

use std::sync::Arc;

use crate::course::domain::{payroll_csv, CourseError, GatewayCredentials, GolfOpsGateway};

use super::GetPayrollSummaryUseCase;

pub struct ExportPayrollCsvUseCase {
    summary: GetPayrollSummaryUseCase,
}

impl ExportPayrollCsvUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self {
            summary: GetPayrollSummaryUseCase::new(ops),
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        Ok(payroll_csv(
            &self.summary.execute(credentials, year_month).await?,
        ))
    }
}
