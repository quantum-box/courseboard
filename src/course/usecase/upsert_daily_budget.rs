//! UpsertDailyBudgetUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, DailyBudget, GatewayCredentials, GolfCommercialGateway, UpsertDailyBudget,
};

pub struct UpsertDailyBudgetUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl UpsertDailyBudgetUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertDailyBudget,
    ) -> Result<DailyBudget, CourseError> {
        self.commercial
            .upsert_daily_budget(credentials, input)
            .await
    }
}
