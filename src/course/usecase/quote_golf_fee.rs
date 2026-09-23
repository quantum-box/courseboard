//! QuoteGolfFeeUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    party_tax, prepare_fee_quote, quote_fee, CourseError, FeeQuote, FeeQuoteRequest,
    GolfPricingSettings, GolfTaxGateway, SimulatedPlayer,
};

/// Resolve the tax rule for a course, preferring the grade the prefecture
/// assigned it over the bracket its green fee happens to fall in.
///
/// Shared with the range projection so both price the same round the same way.
pub(crate) async fn resolve_tax_rule(
    tax: &dyn GolfTaxGateway,
    tenant_id: &str,
    settings: &GolfPricingSettings,
    green_fee: i64,
) -> Result<crate::course::domain::TaxRuleSnapshot, CourseError> {
    let Some(prefecture) = settings.prefecture.as_deref() else {
        return Err(CourseError::BadRequest(
            "this course has no prefecture set, so its golf course tax cannot be looked up",
        ));
    };
    let rule = match settings.tax_grade.as_deref() {
        Some(grade) => tax.find_rule_by_grade(tenant_id, prefecture, grade).await?,
        None => {
            tax.find_rule_by_green_fee(tenant_id, prefecture, green_fee)
                .await?
        }
    };
    rule.ok_or(CourseError::BadRequest(
        "no golf course tax rule matches this course's prefecture and grade",
    ))
}

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
        settings: &GolfPricingSettings,
        request: FeeQuoteRequest,
    ) -> Result<FeeQuote, CourseError> {
        let input = prepare_fee_quote(&request)?;
        let rule =
            resolve_tax_rule(self.tax.as_ref(), tenant_id, settings, input.green_fee()).await?;
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
        let quote = usecase
            .execute("tn_test", &settings(), request())
            .await
            .expect("quote");

        assert_eq!(quote.course_grade(), "B");
        assert_eq!(quote.tax_amount(), 600);
        assert_eq!(quote.total(), 11_100);
        assert_eq!(quote.breakdown().len(), 1);
    }

    #[tokio::test]
    async fn refuses_to_price_a_course_that_has_not_said_where_it_is() {
        // The prefecture used to be pinned to Hokkaido, so a course elsewhere
        // priced against a schedule that could not apply to it.
        let usecase = QuoteGolfFeeUseCase::new(Arc::new(StubTax(Some(rule()))));
        let error = usecase
            .execute("tn_test", &GolfPricingSettings::default(), request())
            .await
            .unwrap_err();
        assert!(
            matches!(error, CourseError::BadRequest(message) if message.contains("prefecture"))
        );
    }

    #[tokio::test]
    async fn prefers_the_grade_the_prefecture_assigned_over_the_fee_bracket() {
        // Which grade a course sits in is the prefecture's decision; the green
        // fee only stands in for it when nobody has told us.
        struct GradeOnly;
        #[async_trait]
        impl GolfTaxGateway for GradeOnly {
            async fn find_rule_by_green_fee(
                &self,
                _t: &str,
                _p: &str,
                _f: i64,
            ) -> Result<Option<TaxRuleSnapshot>, CourseError> {
                Ok(None)
            }
            async fn find_rule_by_grade(
                &self,
                _t: &str,
                _p: &str,
                grade: &str,
            ) -> Result<Option<TaxRuleSnapshot>, CourseError> {
                Ok(Some(TaxRuleSnapshot {
                    course_grade: grade.to_string(),
                    ..rule()
                }))
            }
        }
        let settings = GolfPricingSettings {
            tax_grade: Some("7".to_string()),
            ..settings()
        };
        let quote = QuoteGolfFeeUseCase::new(Arc::new(GradeOnly))
            .execute("tn_test", &settings, request())
            .await
            .expect("quote");
        assert_eq!(quote.course_grade(), "7");
    }

    #[tokio::test]
    async fn rejects_when_no_tax_rule_matches() {
        let usecase = QuoteGolfFeeUseCase::new(Arc::new(StubTax(None)));
        let error = usecase
            .execute("tn_test", &settings(), request())
            .await
            .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[tokio::test]
    async fn rejects_invalid_input_before_touching_the_gateway() {
        let usecase = QuoteGolfFeeUseCase::new(Arc::new(StubTax(None)));
        let error = usecase
            .execute(
                "tn_test",
                &settings(),
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
