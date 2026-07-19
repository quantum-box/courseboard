//! GetMonthlySettlementUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, MonthlySettlement,
};

pub struct GetMonthlySettlementUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl GetMonthlySettlementUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<MonthlySettlement, CourseError> {
        self.commercial
            .get_monthly_settlement(credentials, year_month)
            .await
    }
}
