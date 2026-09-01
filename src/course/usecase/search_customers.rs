//! SearchCustomersUseCase: one use case, one public entrypoint (`execute`).
//!
//! What the desk does before writing a booking down: type part of a name or a
//! phone number and see who in the ledger that might be. The answer is a list
//! of candidates and stays a list — picking the right person is the desk's job,
//! and a use case that guessed would attach someone else's history to a round.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, Customer, CustomerGateway, CustomerSearchQuery, GatewayCredentials,
};

pub struct SearchCustomersUseCase {
    customers: Arc<dyn CustomerGateway>,
}

impl SearchCustomersUseCase {
    pub fn new(customers: Arc<dyn CustomerGateway>) -> Self {
        Self { customers }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: CustomerSearchQuery,
    ) -> Result<Vec<Customer>, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        self.customers.search_customers(credentials, &query).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{CustomerId, NewCustomer};

    #[derive(Default)]
    struct StubCustomers {
        seen: Mutex<Vec<CustomerSearchQuery>>,
        answer: Vec<Customer>,
    }

    #[async_trait]
    impl CustomerGateway for StubCustomers {
        async fn search_customers(
            &self,
            _credentials: GatewayCredentials<'_>,
            query: &CustomerSearchQuery,
        ) -> Result<Vec<Customer>, CourseError> {
            self.seen.lock().unwrap().push(query.clone());
            Ok(self.answer.clone())
        }

        async fn get_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &CustomerId,
        ) -> Result<Customer, CourseError> {
            unreachable!("not used by this use case")
        }

        async fn create_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewCustomer,
        ) -> Result<Customer, CourseError> {
            unreachable!("not used by this use case")
        }

        async fn delete_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &CustomerId,
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
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
    async fn two_people_sharing_a_name_both_come_back_rather_than_one_being_chosen() {
        let gateway = Arc::new(StubCustomers {
            answer: vec![
                Customer::reconstitute("cus_1", "本田 康彦", None, None, None),
                Customer::reconstitute("cus_2", "本田 康彦", None, None, Some("090-0000".into())),
            ],
            ..StubCustomers::default()
        });
        let found = SearchCustomersUseCase::new(gateway)
            .execute(
                credentials(),
                CustomerSearchQuery::try_new(Some("本田".into()), None, None, None).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(found.len(), 2);
    }
}
