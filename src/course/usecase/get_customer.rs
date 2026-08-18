//! GetCustomerUseCase: one use case, one public entrypoint (`execute`).
//!
//! Reading one person out of the ledger by id, which is what a customer's own
//! page is drawn from. Distinct from a search: a search answers with candidates
//! and may answer with none, while this is asked about somebody already
//! identified, so not finding them is an error rather than an empty list.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, Customer, CustomerGateway, CustomerId, GatewayCredentials,
};

pub struct GetCustomerUseCase {
    customers: Arc<dyn CustomerGateway>,
}

impl GetCustomerUseCase {
    pub fn new(customers: Arc<dyn CustomerGateway>) -> Self {
        Self { customers }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<Customer, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        self.customers.get_customer(credentials, customer_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{CustomerSearchQuery, NewCustomer};

    #[derive(Default)]
    struct StubCustomers {
        asked: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl CustomerGateway for StubCustomers {
        async fn search_customers(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: &CustomerSearchQuery,
        ) -> Result<Vec<Customer>, CourseError> {
            unreachable!("a customer page reads by id, never by name")
        }

        async fn get_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            customer_id: &CustomerId,
        ) -> Result<Customer, CourseError> {
            self.asked.lock().unwrap().push(customer_id.to_string());
            Ok(Customer::reconstitute(
                customer_id.clone(),
                "本田 康彦",
                None,
                None,
                None,
            ))
        }

        async fn create_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewCustomer,
        ) -> Result<Customer, CourseError> {
            unreachable!("not used by this test")
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    #[tokio::test]
    async fn a_customer_page_reads_the_person_it_was_opened_for() {
        let gateway = Arc::new(StubCustomers::default());
        let customer = GetCustomerUseCase::new(gateway.clone())
            .execute(credentials(), &CustomerId::new("cus_1"))
            .await
            .unwrap();
        assert_eq!(customer.name(), "本田 康彦");
        assert_eq!(*gateway.asked.lock().unwrap(), vec!["cus_1".to_string()]);
    }
}
