//! CreateCustomerUseCase: one use case, one public entrypoint (`execute`).
//!
//! Puts a person into the ledger because the desk looked at the candidates and
//! decided none of them is this person. Deliberately not find-or-create: the
//! decision has already been made upstream, and repeating it here would let a
//! same-name stranger be handed back instead of the new visitor.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, Customer, CustomerGateway, GatewayCredentials, NewCustomer,
};

pub struct CreateCustomerUseCase {
    customers: Arc<dyn CustomerGateway>,
}

impl CreateCustomerUseCase {
    pub fn new(customers: Arc<dyn CustomerGateway>) -> Self {
        Self { customers }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: NewCustomer,
    ) -> Result<Customer, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        self.customers.create_customer(credentials, &input).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{CustomerId, CustomerSearchQuery};

    #[derive(Default)]
    struct StubCustomers {
        created: Mutex<Vec<NewCustomer>>,
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
            input: &NewCustomer,
        ) -> Result<Customer, CourseError> {
            self.created.lock().unwrap().push(input.clone());
            Ok(Customer::reconstitute(
                "cus_new",
                input.name.clone(),
                input.name_kana.clone(),
                input.email.clone(),
                input.phone.clone(),
            ))
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
    async fn a_walk_in_with_nothing_but_a_name_gets_a_ledger_entry() {
        let gateway = Arc::new(StubCustomers::default());
        let created = CreateCustomerUseCase::new(gateway.clone())
            .execute(
                credentials(),
                NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(created.id(), &CustomerId::new("cus_new"));
        assert_eq!(created.email(), None);
        assert_eq!(gateway.created.lock().unwrap().len(), 1);
    }
}
