//! ExportPayrollCsvUseCase: one use case, one public entrypoint (`execute`).
//!
//! Field used to render this file. It cannot any more: the amounts are priced
//! off a rank table Field does not have (ADR-0005), so a Field-rendered export
//! would disagree with the screen it was downloaded from — the worst possible
//! failure for a payroll sheet, because both look right on their own. The file
//! is built from the same summary the screen shows.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    payroll_csv, CaddieRankFeeGateway, CourseError, GatewayCredentials, GolfOpsGateway,
};

use super::GetPayrollSummaryUseCase;

pub struct ExportPayrollCsvUseCase {
    summary: GetPayrollSummaryUseCase,
}

impl ExportPayrollCsvUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, rank_fees: Arc<dyn CaddieRankFeeGateway>) -> Self {
        Self {
            summary: GetPayrollSummaryUseCase::new(ops, rank_fees),
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
        timezone: &str,
    ) -> Result<String, CourseError> {
        credentials.require(actions::LIST_PAYROLL).await?;
        Ok(payroll_csv(
            &self
                .summary
                .execute(credentials, year_month, timezone)
                .await?,
        ))
    }
}
