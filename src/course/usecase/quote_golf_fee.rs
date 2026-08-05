//! QuoteGolfFeeUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    party_tax, prepare_fee_quote, quote_fee, CourseError, FeeQuote, FeeQuoteRequest,
    GolfTaxGateway, SimulatedPlayer, DEFAULT_PREFECTURE,
};

/// Price one round for the operator: play fees plus golf course tax.
pub struct QuoteGolfFeeUseCase {
    tax: Arc<dyn GolfTaxGateway>,
}

impl QuoteGolfFeeUseCase {
    pub fn new(tax: Arc<dyn GolfTaxGateway>) -> Self {
        Self { tax }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        request: FeeQuoteRequest,
    ) -> Result<FeeQuote, CourseError> {
        let input = prepare_fee_quote(&request)?;
        let rule = self
            .tax
            .find_rule_by_green_fee(tenant_id, DEFAULT_PREFECTURE, input.green_fee())
            .await?
            .ok_or(CourseError::BadRequest(
                "no golf course tax rule matches this tenant, prefecture, and green fee",
            ))?;
        quote_fee(
            &input,
            party_tax(&rule, &[SimulatedPlayer::representative()]),
        )
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
    }

    fn rule() -> TaxRuleSnapshot {
        TaxRuleSnapshot {
            course_grade: "B".to_string(),
            fee: 600,
            minor_exempt_under_age: 18,
            senior_exempt_min_age: 70,
            disability_cert_exempt: true,
            senior_reduced_min_age: None,
            senior_reduced_percent: None,
        }
    }

    fn request() -> FeeQuoteRequest {
        FeeQuoteRequest {
            green_fee: 9_000.0,
            num_holes: 18,
            cart_fee: Some(1_500.0),
            caddy_fee: None,
        }
    }

    #[tokio::test]
    async fn quotes_play_fees_plus_tax() {
        let usecase = QuoteGolfFeeUseCase::new(Arc::new(StubTax(Some(rule()))));
        let quote = usecase.execute("tn_test", request()).await.expect("quote");

        assert_eq!(quote.course_grade(), "B");
        assert_eq!(quote.tax_amount(), 600);
        assert_eq!(quote.total(), 11_100);
        assert_eq!(quote.breakdown().len(), 1);
    }

    #[tokio::test]
    async fn rejects_when_no_tax_rule_matches() {
        let usecase = QuoteGolfFeeUseCase::new(Arc::new(StubTax(None)));
        let error = usecase.execute("tn_test", request()).await.unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[tokio::test]
    async fn rejects_invalid_input_before_touching_the_gateway() {
        let usecase = QuoteGolfFeeUseCase::new(Arc::new(StubTax(None)));
        let error = usecase
            .execute(
                "tn_test",
                FeeQuoteRequest {
                    num_holes: 27,
                    ..request()
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            CourseError::BadRequest("numHoles must be 9 or 18")
        ));
    }
}
