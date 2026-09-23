//! SimulateGreenFeeRangeUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    prepare_range_simulation, project_row, summarize_range, CourseError, GolfPricingSettings,
    GolfTaxGateway, RangeRow, RangeRowInput, RangeSimulation, RangeSimulationRequest,
};

/// Project revenue, tax, and profit for a booking period at the average green fee.
pub struct SimulateGreenFeeRangeUseCase {
    tax: Arc<dyn GolfTaxGateway>,
}

impl SimulateGreenFeeRangeUseCase {
    pub fn new(tax: Arc<dyn GolfTaxGateway>) -> Self {
        Self { tax }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        settings: &GolfPricingSettings,
        request: RangeSimulationRequest,
    ) -> Result<RangeSimulation, CourseError> {
        let input = prepare_range_simulation(&request)?;
        let green_fee = input.avg_green_fee();
        let rule = super::quote_golf_fee::resolve_tax_rule(
            self.tax.as_ref(),
            tenant_id,
            settings,
            green_fee,
        )
        .await?;

        let row: RangeRow = project_row(
            &RangeRowInput {
                green_fee,
                base_visitors: input.visitors_midpoint(),
                base_green_fee: green_fee,
                price_elasticity: settings.price_elasticity,
                taxable_ratio: settings.taxable_ratio,
                fixed_cost: settings.fixed_cost,
                variable_cost_per_visitor: settings.variable_cost_per_visitor,
            },
            &rule,
        );

        summarize_range(&input, settings.taxable_ratio, vec![row])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::TaxRuleSnapshot;
    use async_trait::async_trait;

    struct StubTax(Option<TaxRuleSnapshot>);

    #[async_trait]
    impl GolfTaxGateway for StubTax {
        async fn find_rule_by_green_fee(
            &self,
            _tenant_id: &str,
            _prefecture: &str,
            _green_fee: i64,
        ) -> Result<Option<TaxRuleSnapshot>, CourseError> {
            Ok(self.0.clone())
        }

        async fn find_rule_by_grade(
            &self,
            _tenant_id: &str,
            _prefecture: &str,
            _course_grade: &str,
        ) -> Result<Option<TaxRuleSnapshot>, CourseError> {
            Ok(self.0.clone())
        }
    }

    /// A course that has told us where it is, so the lookup can happen.
    fn settings() -> GolfPricingSettings {
        GolfPricingSettings {
            prefecture: Some("hokkaido".to_string()),
            ..GolfPricingSettings::default()
        }
    }

    fn rule() -> TaxRuleSnapshot {
        TaxRuleSnapshot {
            course_grade: "A".to_string(),
            fee: 800,
            minor_exempt_under_age: 18,
            senior_exempt_min_age: 70,
            disability_cert_exempt: true,
            senior_reduced_min_age: None,
            senior_reduced_percent: None,
        }
    }

    fn request() -> RangeSimulationRequest {
        RangeSimulationRequest {
            date_from: "2026-08-01".to_string(),
            date_to: "2026-08-31".to_string(),
            num_visitors_min: 100,
            num_visitors_max: 200,
            avg_green_fee: 12_000.0,
        }
    }

    #[tokio::test]
    async fn projects_the_period_at_the_average_green_fee() {
        let usecase = SimulateGreenFeeRangeUseCase::new(Arc::new(StubTax(Some(rule()))));
        let simulation = usecase
            .execute("tn_test", &settings(), request())
            .await
            .expect("simulation");

        assert_eq!(simulation.projected_revenue_min(), 1_200_000);
        assert_eq!(simulation.projected_revenue_max(), 2_400_000);
        // 200 visitors * 0.85 taxable share * 800 JPY per taxable visitor.
        assert_eq!(simulation.tax_total(), 136_000);
        assert_eq!(simulation.rows().len(), 1);
        assert_eq!(simulation.period_label(), "2026-08-01 - 2026-08-31");
    }

    #[tokio::test]
    async fn rejects_when_no_tax_rule_matches() {
        let usecase = SimulateGreenFeeRangeUseCase::new(Arc::new(StubTax(None)));
        let error = usecase
            .execute("tn_test", &settings(), request())
            .await
            .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[tokio::test]
    async fn rejects_invalid_input_before_touching_the_gateway() {
        let usecase = SimulateGreenFeeRangeUseCase::new(Arc::new(StubTax(None)));
        let error = usecase
            .execute(
                "tn_test",
                &settings(),
                RangeSimulationRequest {
                    date_to: "2026-07-01".to_string(),
                    ..request()
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            CourseError::BadRequest("dateTo must be on or after dateFrom")
        ));
    }
}
