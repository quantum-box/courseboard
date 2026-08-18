//! ListDailyBudgetsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, DailyBudget, DailyBudgetQuery, GatewayCredentials, GolfCommercialGateway,
};

pub struct ListDailyBudgetsUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl ListDailyBudgetsUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: DailyBudgetQuery,
    ) -> Result<Vec<DailyBudget>, CourseError> {
        credentials.require(actions::LIST_BUDGETS).await?;
        self.commercial.list_daily_budgets(credentials, query).await
    }
}
