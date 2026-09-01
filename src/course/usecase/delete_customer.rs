//! DeleteCustomerUseCase: remove one person from the active customer ledger.
//!
//! Field owns the ledger and implements deletion as deactivation. CourseBoard
//! deliberately does not cascade into reservations, visits, or local audit
//! records: those remain historical facts even after the person stops appearing
//! in customer searches.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{CourseError, CustomerGateway, CustomerId, GatewayCredentials};

pub struct DeleteCustomerUseCase {
    customers: Arc<dyn CustomerGateway>,
}

impl DeleteCustomerUseCase {
    pub fn new(customers: Arc<dyn CustomerGateway>) -> Self {
        Self { customers }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        self.customers
            .delete_customer(credentials, customer_id)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{Customer, CustomerSearchQuery, NewCustomer};

    #[derive(Default)]
    struct StubCustomers {
        deleted: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl CustomerGateway for StubCustomers {
        async fn search_customers(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: &CustomerSearchQuery,
        ) -> Result<Vec<Customer>, CourseError> {
            unreachable!("not used by this use case")
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
            customer_id: &CustomerId,
        ) -> Result<(), CourseError> {
            self.deleted.lock().unwrap().push(customer_id.to_string());
            Ok(())
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
    async fn removes_only_the_requested_customer_from_the_active_ledger() {
        let gateway = Arc::new(StubCustomers::default());
        DeleteCustomerUseCase::new(gateway.clone())
            .execute(credentials(), &CustomerId::new("cus_1"))
            .await
            .unwrap();

        assert_eq!(*gateway.deleted.lock().unwrap(), vec!["cus_1"]);
    }
}
