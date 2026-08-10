//! ExportMonthlySettlementCsvUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway,
};

pub struct ExportMonthlySettlementCsvUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl ExportMonthlySettlementCsvUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
    ) -> Self {
        Self {
            catalog,
            commercial,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        self.commercial
            .export_monthly_settlement_csv(credentials, year_month, &timezone)
            .await
    }
}
