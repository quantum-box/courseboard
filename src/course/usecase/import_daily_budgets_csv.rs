//! ImportDailyBudgetsCsvUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{CourseError, DailyBudget, GatewayCredentials, GolfCommercialGateway};

pub struct ImportDailyBudgetsCsvUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl ImportDailyBudgetsCsvUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        csv: &str,
    ) -> Result<Vec<DailyBudget>, CourseError> {
        credentials.require(actions::MANAGE_BUDGETS).await?;
        self.commercial
            .import_daily_budgets_csv(credentials, csv)
            .await
    }
}
