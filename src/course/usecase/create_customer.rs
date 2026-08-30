//! CreateCustomerUseCase: one use case, one public entrypoint (`execute`).
//!
//! Puts a person into the ledger because the desk looked at the candidates and
//! decided none of them is this person. Deliberately not find-or-create: the
//! decision has already been made upstream, and repeating it here would let a
//! same-name stranger be handed back instead of the new visitor.
//!
//! The ledger entry is Field's; how it came to exist is ours. A reception sheet
//! is read a group at a time and deliberately keeps same-name rows rather than
//! dropping them, so two Yamada Taro a week apart is a normal outcome and the
//! only way back to the paper is what gets written here (ADR-0009).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, Customer, CustomerGateway, CustomerRegistrationGateway, GatewayCredentials,
    NewCustomer, NewCustomerRegistration,
};

/// Where this creation came from, as the screen that asked for it knows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerProvenance {
    pub source: crate::course::domain::CustomerRegistrationSource,
    /// The signed-in caller's subject, when the token carried one.
    pub registered_by: Option<String>,
    /// Which line of the reception sheet, zero-based.
    pub source_row_index: Option<u32>,
}

pub struct CreateCustomerUseCase {
    customers: Arc<dyn CustomerGateway>,
    registrations: Arc<dyn CustomerRegistrationGateway>,
}

impl CreateCustomerUseCase {
    pub fn new(
        customers: Arc<dyn CustomerGateway>,
        registrations: Arc<dyn CustomerRegistrationGateway>,
    ) -> Self {
        Self {
            customers,
            registrations,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: NewCustomer,
        provenance: CustomerProvenance,
    ) -> Result<Customer, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        let created = self.customers.create_customer(credentials, &input).await?;

        let entry = NewCustomerRegistration::new(
            created.id().clone(),
            provenance.source,
            provenance.registered_by,
            provenance.source_row_index,
        );
        // The customer exists upstream by now. Failing the request because
        // CourseBoard could not write down how it happened would tell the desk
        // the registration failed and send them to do it again, which is how a
        // duplicate is made. The provenance is lost; the person is not.
        if let Err(error) = self
            .registrations
            .record_customer_registration(credentials.operator_id, &entry)
            .await
        {
            tracing::warn!(
                error = %error,
                customer_id = created.id().as_str(),
                "customer was created but its provenance could not be recorded"
            );
        }

        Ok(created)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        CustomerId, CustomerRegistration, CustomerRegistrationSource, CustomerSearchQuery,
    };

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

    #[derive(Default)]
    struct StubRegistrations {
        recorded: Mutex<Vec<NewCustomerRegistration>>,
        fails: bool,
    }

    #[async_trait]
    impl CustomerRegistrationGateway for StubRegistrations {
        async fn record_customer_registration(
            &self,
            _tenant_id: &str,
            entry: &NewCustomerRegistration,
        ) -> Result<(), CourseError> {
            if self.fails {
                return Err(CourseError::Provider("db down".into()));
            }
            self.recorded.lock().unwrap().push(entry.clone());
            Ok(())
        }

        async fn get_customer_registration(
            &self,
            _tenant_id: &str,
            _customer_id: &CustomerId,
        ) -> Result<Option<CustomerRegistration>, CourseError> {
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

    fn from_a_sheet() -> CustomerProvenance {
        CustomerProvenance {
            source: CustomerRegistrationSource::ReceptionSheet,
            registered_by: Some("user-1".to_string()),
            source_row_index: Some(2),
        }
    }

    #[tokio::test]
    async fn a_walk_in_with_nothing_but_a_name_gets_a_ledger_entry() {
        let gateway = Arc::new(StubCustomers::default());
        let registrations = Arc::new(StubRegistrations::default());
        let created = CreateCustomerUseCase::new(gateway.clone(), registrations.clone())
            .execute(
                credentials(),
                NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
                from_a_sheet(),
            )
            .await
            .unwrap();
        assert_eq!(created.id(), &CustomerId::new("cus_new"));
        assert_eq!(created.email(), None);
        assert_eq!(gateway.created.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn the_sheet_and_the_line_it_came_off_are_written_down() {
        let registrations = Arc::new(StubRegistrations::default());
        CreateCustomerUseCase::new(Arc::new(StubCustomers::default()), registrations.clone())
            .execute(
                credentials(),
                NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
                from_a_sheet(),
            )
            .await
            .unwrap();

        let recorded = registrations.recorded.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(
            recorded[0].source(),
            CustomerRegistrationSource::ReceptionSheet
        );
        assert_eq!(recorded[0].source_row_index(), Some(2));
        assert_eq!(recorded[0].registered_by(), Some("user-1"));
    }

    #[tokio::test]
    async fn losing_the_provenance_does_not_lose_the_customer() {
        // Otherwise the desk is told the registration failed for someone who
        // is already in the ledger, and registers them a second time.
        let registrations = Arc::new(StubRegistrations {
            recorded: Mutex::new(Vec::new()),
            fails: true,
        });
        let created = CreateCustomerUseCase::new(Arc::new(StubCustomers::default()), registrations)
            .execute(
                credentials(),
                NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
                from_a_sheet(),
            )
            .await;
        assert!(created.is_ok());
    }
}
