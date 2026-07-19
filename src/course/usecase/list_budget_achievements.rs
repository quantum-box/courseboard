//! ListBudgetAchievementsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    BudgetAchievement, CourseError, GatewayCredentials, GolfCommercialGateway,
};

pub struct ListBudgetAchievementsUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl ListBudgetAchievementsUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<BudgetAchievement>, CourseError> {
        self.commercial
            .list_budget_achievements(credentials, from, to)
            .await
    }
}
