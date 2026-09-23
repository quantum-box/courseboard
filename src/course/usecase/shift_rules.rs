//! Reading and setting the club's shift-planning rules.
//!
//! Two entry points rather than one file each: they are the get and set of a
//! single setting, and splitting them would leave two files that only make
//! sense read together.

use std::sync::Arc;

use crate::course::domain::{
    actions, CourseError, GatewayCredentials, ShiftPolicy, ShiftRulesGateway,
};

pub struct GetShiftRulesUseCase {
    rules: Arc<dyn ShiftRulesGateway>,
}

impl GetShiftRulesUseCase {
    pub fn new(rules: Arc<dyn ShiftRulesGateway>) -> Self {
        Self { rules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<ShiftPolicy, CourseError> {
        credentials.require(actions::LIST_SHIFTS).await?;
        self.rules.get_shift_policy(credentials.operator_id).await
    }
}

pub struct UpdateShiftRulesUseCase {
    rules: Arc<dyn ShiftRulesGateway>,
}

impl UpdateShiftRulesUseCase {
    pub fn new(rules: Arc<dyn ShiftRulesGateway>) -> Self {
        Self { rules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        policy: ShiftPolicy,
    ) -> Result<ShiftPolicy, CourseError> {
        credentials.require(actions::MANAGE_SHIFTS).await?;
        self.rules
            .upsert_shift_policy(credentials.operator_id, &policy)
            .await
    }
}
