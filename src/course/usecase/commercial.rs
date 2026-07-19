//! Commercial golf operations use cases.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    BudgetAchievement, CourseError, DailyBudget, DailyBudgetQuery, ExtensionStatus,
    GatewayCredentials, GolfCommercialGateway, MonthlySettlement, ReservationPolicy,
    UpdateExtensionConfig, UpdateReservationPolicy, UpsertDailyBudget,
};

macro_rules! commercial_use_case {
    ($name:ident) => {
        pub struct $name {
            commercial: Arc<dyn GolfCommercialGateway>,
        }

        impl $name {
            pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
                Self { commercial }
            }
        }
    };
}

commercial_use_case!(GetReservationPolicyUseCase);
commercial_use_case!(UpdateReservationPolicyUseCase);
commercial_use_case!(ListDailyBudgetsUseCase);
commercial_use_case!(UpsertDailyBudgetUseCase);
commercial_use_case!(ImportDailyBudgetsCsvUseCase);
commercial_use_case!(ListBudgetAchievementsUseCase);
commercial_use_case!(GetMonthlySettlementUseCase);
commercial_use_case!(ExportMonthlySettlementCsvUseCase);
commercial_use_case!(GetExtensionStatusUseCase);
commercial_use_case!(UpdateExtensionConfigUseCase);

impl GetReservationPolicyUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<ReservationPolicy, CourseError> {
        self.commercial.get_reservation_policy(credentials).await
    }
}

impl UpdateReservationPolicyUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateReservationPolicy,
    ) -> Result<ReservationPolicy, CourseError> {
        self.commercial
            .update_reservation_policy(credentials, input)
            .await
    }
}

impl ListDailyBudgetsUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: DailyBudgetQuery,
    ) -> Result<Vec<DailyBudget>, CourseError> {
        self.commercial.list_daily_budgets(credentials, query).await
    }
}

impl UpsertDailyBudgetUseCase {
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

impl ImportDailyBudgetsCsvUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        csv: &str,
    ) -> Result<Vec<DailyBudget>, CourseError> {
        self.commercial
            .import_daily_budgets_csv(credentials, csv)
            .await
    }
}

impl ListBudgetAchievementsUseCase {
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

impl GetMonthlySettlementUseCase {
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

impl ExportMonthlySettlementCsvUseCase {
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

impl GetExtensionStatusUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<ExtensionStatus>, CourseError> {
        self.commercial.get_extension_status(credentials).await
    }
}

impl UpdateExtensionConfigUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateExtensionConfig,
    ) -> Result<(), CourseError> {
        self.commercial
            .update_extension_config(credentials, input)
            .await
    }
}
