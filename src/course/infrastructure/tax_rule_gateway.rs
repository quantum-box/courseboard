//! Adapter exposing CourseBoard's own tax-rule storage as a domain port.
//!
//! Unlike the Field gateways in this module, this one reads CourseBoard's own
//! MySQL tables (`golf_tax_rules` / `golf_grade_thresholds`). Golf pricing is
//! CourseBoard-owned data; see
//! `docs/src/architecture/decisions/ADR-0005-golf-domain-ownership.md`.

use std::sync::Arc;

use async_trait::async_trait;

use crate::course::domain::{CourseError, GolfTaxGateway, TaxRuleSnapshot};
use crate::MySqlTaxRuleRepository;

pub struct CourseboardTaxGateway {
    rules: Arc<MySqlTaxRuleRepository>,
}

impl CourseboardTaxGateway {
    pub fn new(rules: Arc<MySqlTaxRuleRepository>) -> Self {
        Self { rules }
    }
}

#[async_trait]
impl GolfTaxGateway for CourseboardTaxGateway {
    async fn find_rule_by_green_fee(
        &self,
        tenant_id: &str,
        prefecture: &str,
        green_fee: i64,
    ) -> Result<Option<TaxRuleSnapshot>, CourseError> {
        self.rules
            .find_rule_by_green_fee(tenant_id, prefecture, green_fee)
            .await
            .map_err(|error| CourseError::Provider(error.to_string()))
    }
}
