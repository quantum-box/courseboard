//! ListBudgetAchievementsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    BudgetAchievement, CourseError, GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway,
};

pub struct ListBudgetAchievementsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl ListBudgetAchievementsUseCase {
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
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<BudgetAchievement>, CourseError> {
        credentials.require(actions::LIST_BUDGETS).await?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        self.commercial
            .list_budget_achievements(credentials, from, to, &timezone)
            .await
    }
}
