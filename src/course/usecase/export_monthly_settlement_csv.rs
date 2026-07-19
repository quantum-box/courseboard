//! ExportMonthlySettlementCsvUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{CourseError, GatewayCredentials, GolfCommercialGateway};

pub struct ExportMonthlySettlementCsvUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl ExportMonthlySettlementCsvUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        self.commercial
            .export_monthly_settlement_csv(credentials, year_month)
            .await
    }
}
