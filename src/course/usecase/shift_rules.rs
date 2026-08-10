//! Reading and setting the club's shift-planning rules.
//!
//! Two entry points rather than one file each: they are the get and set of a
//! single setting, and splitting them would leave two files that only make
//! sense read together.

use std::sync::Arc;

use crate::course::domain::{CourseError, ShiftPolicy, ShiftRulesGateway};

pub struct GetShiftRulesUseCase {
    rules: Arc<dyn ShiftRulesGateway>,
}

impl GetShiftRulesUseCase {
    pub fn new(rules: Arc<dyn ShiftRulesGateway>) -> Self {
        Self { rules }
    }

    pub async fn execute(&self, tenant_id: &str) -> Result<ShiftPolicy, CourseError> {
        self.rules.get_shift_policy(tenant_id).await
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
        tenant_id: &str,
        policy: ShiftPolicy,
    ) -> Result<ShiftPolicy, CourseError> {
        self.rules.upsert_shift_policy(tenant_id, &policy).await
    }
}
