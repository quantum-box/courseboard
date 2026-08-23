//! ListBudgetAchievementsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    build_budget_achievements, daily_actuals, BudgetAchievement, CourseError, DailyBudgetQuery,
    GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway, ReservationGateway,
};

pub struct ListBudgetAchievementsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    reservations: Arc<dyn ReservationGateway>,
}

impl ListBudgetAchievementsUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        reservations: Arc<dyn ReservationGateway>,
    ) -> Self {
        Self {
            catalog,
            commercial,
            reservations,
        }
    }

    /// The day's targets against the day's takings, worked out here rather
    /// than asked of Field (ADR-0005 Phase 1).
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<BudgetAchievement>, CourseError> {
        credentials.require(actions::LIST_BUDGETS).await?;
        if to < from {
            return Err(CourseError::BadRequest(
                "the end of the period must not precede its start",
            ));
        }
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let timezone = timezone.parse().map_err(|_| {
            CourseError::Provider(format!("tenant timezone `{timezone}` is not a known zone"))
        })?;
        let budgets = self
            .commercial
            .list_daily_budgets(
                credentials,
                DailyBudgetQuery {
                    golf_course_id: None,
                    from: Some(from),
                    to: Some(to),
                },
            )
            .await?;
        // Field's reservation list has no period filter yet (PLT-3858), so the
        // window is cut here. Every booking is fetched to do it, which is the
        // same shape the tee sheet and the ledger already live with.
        let reservations = self.reservations.list_reservations(credentials).await?;
        let products = self.catalog.list_reservation_products(credentials).await?;
        let actuals: Vec<_> = daily_actuals(&reservations, &products, timezone)
            .into_iter()
            .filter(|actual| actual.date >= from && actual.date <= to)
            .collect();
        Ok(build_budget_achievements(&budgets, &actuals))
    }
}
