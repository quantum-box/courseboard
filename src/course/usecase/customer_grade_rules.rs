//! Reading and arranging the ladder a club sorts its regulars by.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerGradeRules, CustomerGradeRulesGateway, GatewayCredentials,
};

pub struct GetCustomerGradeRulesUseCase {
    grades: Arc<dyn CustomerGradeRulesGateway>,
}

impl GetCustomerGradeRulesUseCase {
    pub fn new(grades: Arc<dyn CustomerGradeRulesGateway>) -> Self {
        Self { grades }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CustomerGradeRules, CourseError> {
        // The ladder exists to read a customer, so the action that opens a
        // customer is the one that reads it.
        credentials.require(actions::LIST_CUSTOMERS).await?;
        self.grades
            .get_customer_grade_rules(credentials.operator_id)
            .await
    }
}

pub struct ReplaceCustomerGradeRulesUseCase {
    grades: Arc<dyn CustomerGradeRulesGateway>,
}

impl ReplaceCustomerGradeRulesUseCase {
    pub fn new(grades: Arc<dyn CustomerGradeRulesGateway>) -> Self {
        Self { grades }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        rules: CustomerGradeRules,
    ) -> Result<CustomerGradeRules, CourseError> {
        // Deciding what makes somebody a good customer is a decision about
        // customers, not about bookings.
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        self.grades
            .replace_customer_grade_rules(credentials.operator_id, &rules)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::CustomerGradeRule;

    #[derive(Default)]
    struct StubGrades {
        saved: Mutex<Vec<(String, CustomerGradeRules)>>,
        answer: CustomerGradeRules,
    }

    #[async_trait]
    impl CustomerGradeRulesGateway for StubGrades {
        async fn get_customer_grade_rules(
            &self,
            _tenant_id: &str,
        ) -> Result<CustomerGradeRules, CourseError> {
            Ok(self.answer.clone())
        }

        async fn replace_customer_grade_rules(
            &self,
            tenant_id: &str,
            rules: &CustomerGradeRules,
        ) -> Result<CustomerGradeRules, CourseError> {
            self.saved
                .lock()
                .unwrap()
                .push((tenant_id.to_string(), rules.clone()));
            Ok(rules.clone())
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    #[tokio::test]
    async fn a_club_that_has_set_no_ladder_reads_back_empty_rather_than_failing() {
        let rules = GetCustomerGradeRulesUseCase::new(Arc::new(StubGrades::default()))
            .execute(credentials())
            .await
            .unwrap();
        assert!(rules.is_empty());
    }

    #[tokio::test]
    async fn the_ladder_is_saved_against_the_tenant_that_arranged_it() {
        let gateway = Arc::new(StubGrades::default());
        let ladder = CustomerGradeRules::try_new(vec![CustomerGradeRule::try_new(
            "ゴールド",
            24,
            Some(15_000),
            None,
        )
        .unwrap()])
        .unwrap();
        ReplaceCustomerGradeRulesUseCase::new(gateway.clone())
            .execute(credentials(), ladder.clone())
            .await
            .unwrap();

        let saved = gateway.saved.lock().unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].0, "tenant-1");
        assert_eq!(saved[0].1, ladder);
    }
}
