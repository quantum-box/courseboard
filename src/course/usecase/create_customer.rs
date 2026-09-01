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
    required_reception_consents, CourseError, Customer, CustomerConsentGateway, CustomerGateway,
    CustomerRegistrationGateway, CustomerRegistrationSource, GatewayCredentials, NewCustomer,
    NewCustomerRegistration, ReceptionConsentAnswer,
};

/// Where this creation came from, as the screen that asked for it knows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerProvenance {
    pub source: CustomerRegistrationSource,
    /// The signed-in caller's subject, when the token carried one.
    pub registered_by: Option<String>,
    /// Which line of the reception sheet, zero-based.
    pub source_row_index: Option<u32>,
}

/// What a registration produced, beyond the ledger entry itself.
///
/// The consent flag exists because the two writes cannot be one. StoreKit's
/// customer create has no consents, so the record is filed by a second request
/// to Field's ERP surface, and that request can fail on its own. Telling the
/// desk the whole registration failed would send them to register the visitor
/// again — that is how a duplicate is made — so the customer is returned and
/// the gap is reported instead, for the desk to retry.
#[derive(Debug, Clone)]
pub struct RegisteredCustomer {
    pub customer: Customer,
    /// `false` when the sheet carried answered boxes that Field did not take.
    pub consents_recorded: bool,
    /// `false` when reception-only custom values could not be persisted after
    /// the customer was created. The customer remains valid and must not be
    /// registered again.
    pub custom_fields_recorded: bool,
}

pub struct CreateCustomerUseCase {
    customers: Arc<dyn CustomerGateway>,
    registrations: Arc<dyn CustomerRegistrationGateway>,
    consents: Arc<dyn CustomerConsentGateway>,
}

impl CreateCustomerUseCase {
    pub fn new(
        customers: Arc<dyn CustomerGateway>,
        registrations: Arc<dyn CustomerRegistrationGateway>,
        consents: Arc<dyn CustomerConsentGateway>,
    ) -> Self {
        Self {
            customers,
            registrations,
            consents,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: NewCustomer,
        provenance: CustomerProvenance,
        consents: &[ReceptionConsentAnswer],
    ) -> Result<Customer, CourseError> {
        self.execute_with_consents(credentials, input, provenance, consents)
            .await
            .map(|registered| registered.customer)
    }

    pub async fn execute_with_consents(
        &self,
        credentials: GatewayCredentials<'_>,
        input: NewCustomer,
        provenance: CustomerProvenance,
        consents: &[ReceptionConsentAnswer],
    ) -> Result<RegisteredCustomer, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        // Refused before anything is written. A visitor whose declaration is
        // missing must not reach the ledger at all: created first and refused
        // afterwards, the desk is left with a customer they were told not to
        // have.
        //
        // Only for a sheet. Someone typed in at the counter has no paper to
        // have ticked, and the customer screen does not ask for consents —
        // requiring one there would close the manual path entirely.
        if provenance.source == CustomerRegistrationSource::ReceptionSheet {
            refuse_without_the_required_declaration(consents)?;
        }
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

        let consents_recorded = match self
            .consents
            .record_consents(credentials, created.id(), consents)
            .await
        {
            Ok(()) => true,
            Err(error) => {
                // Same reasoning as the provenance above, with a louder log:
                // an unfiled declaration is a compliance gap, not a missing
                // convenience. The desk is told so it can retry the consents
                // rather than the visitor.
                tracing::error!(
                    error = %error,
                    customer_id = created.id().as_str(),
                    "customer was created but their consents could not be recorded"
                );
                false
            }
        };

        Ok(RegisteredCustomer {
            customer: created,
            consents_recorded,
            custom_fields_recorded: true,
        })
    }
}

/// Refuses a sheet whose required declaration is not a yes.
///
/// An unread box counts as missing. The reader drops a tick it cannot resolve,
/// so "not read" and "not ticked" arrive the same way, and treating either as
/// agreement would file a declaration the visitor never made.
pub(crate) fn refuse_without_the_required_declaration(
    consents: &[ReceptionConsentAnswer],
) -> Result<(), CourseError> {
    for required in required_reception_consents() {
        let agreed = consents
            .iter()
            .any(|answer| answer.key == required.key && answer.accepted == Some(true));
        if !agreed {
            return Err(CourseError::BadRequest(
                "the reception sheet's required declaration is not ticked",
            ));
        }
    }
    Ok(())
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

    #[derive(Default)]
    struct StubConsents {
        recorded: Mutex<Vec<(String, Vec<ReceptionConsentAnswer>)>>,
        fails: bool,
    }

    #[async_trait]
    impl CustomerConsentGateway for StubConsents {
        async fn record_consents(
            &self,
            _credentials: GatewayCredentials<'_>,
            customer_id: &CustomerId,
            answers: &[ReceptionConsentAnswer],
        ) -> Result<(), CourseError> {
            if self.fails {
                return Err(CourseError::Provider("field down".into()));
            }
            self.recorded
                .lock()
                .unwrap()
                .push((customer_id.as_str().to_string(), answers.to_vec()));
            Ok(())
        }
    }

    fn ticked() -> Vec<ReceptionConsentAnswer> {
        vec![ReceptionConsentAnswer {
            key: crate::course::domain::CONSENT_ANTISOCIAL_AND_COURSE_TERMS,
            accepted: Some(true),
        }]
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
        let created = CreateCustomerUseCase::new(
            gateway.clone(),
            registrations.clone(),
            Arc::new(StubConsents::default()),
        )
        .execute(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            from_a_sheet(),
            &ticked(),
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
        CreateCustomerUseCase::new(
            Arc::new(StubCustomers::default()),
            registrations.clone(),
            Arc::new(StubConsents::default()),
        )
        .execute(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            from_a_sheet(),
            &ticked(),
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
        let created = CreateCustomerUseCase::new(
            Arc::new(StubCustomers::default()),
            registrations,
            Arc::new(StubConsents::default()),
        )
        .execute(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            from_a_sheet(),
            &ticked(),
        )
        .await;
        assert!(created.is_ok());
    }

    /// The declaration is what the sheet itself marks 「必ず☑をご記入下さい」.
    /// A row registered without it puts someone in the ledger the club has no
    /// record of having asked, which is the whole point of the box.
    #[tokio::test]
    async fn a_sheet_whose_declaration_is_not_ticked_is_refused() {
        let gateway = Arc::new(StubCustomers::default());
        let result = CreateCustomerUseCase::new(
            gateway.clone(),
            Arc::new(StubRegistrations::default()),
            Arc::new(StubConsents::default()),
        )
        .execute(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            from_a_sheet(),
            &[ReceptionConsentAnswer {
                key: crate::course::domain::CONSENT_ANTISOCIAL_AND_COURSE_TERMS,
                accepted: None,
            }],
        )
        .await;
        assert!(matches!(result, Err(CourseError::BadRequest(_))));
        // Refused before the write, so there is no customer to clean up.
        assert!(gateway.created.lock().unwrap().is_empty());
    }

    /// The counter's own form does not ask for consents, and there is no paper
    /// behind it. Requiring the declaration there would close the manual path.
    #[tokio::test]
    async fn someone_typed_in_at_the_counter_needs_no_sheet() {
        let created = CreateCustomerUseCase::new(
            Arc::new(StubCustomers::default()),
            Arc::new(StubRegistrations::default()),
            Arc::new(StubConsents::default()),
        )
        .execute(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            CustomerProvenance {
                source: CustomerRegistrationSource::Manual,
                registered_by: None,
                source_row_index: None,
            },
            &[],
        )
        .await;
        assert!(created.is_ok());
    }

    #[tokio::test]
    async fn what_the_sheet_said_is_filed_against_the_new_customer() {
        let consents = Arc::new(StubConsents::default());
        CreateCustomerUseCase::new(
            Arc::new(StubCustomers::default()),
            Arc::new(StubRegistrations::default()),
            consents.clone(),
        )
        .execute(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            from_a_sheet(),
            &ticked(),
        )
        .await
        .unwrap();

        let recorded = consents.recorded.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].0, "cus_new");
        assert_eq!(recorded[0].1, ticked());
    }

    /// Field being unreachable must not read as "the registration failed".
    /// The visitor is already in the ledger; sending the desk to do it again
    /// is how the same person is registered twice. The gap is reported so the
    /// consents can be retried on their own.
    #[tokio::test]
    async fn a_consent_that_could_not_be_filed_is_reported_not_thrown() {
        let registered = CreateCustomerUseCase::new(
            Arc::new(StubCustomers::default()),
            Arc::new(StubRegistrations::default()),
            Arc::new(StubConsents {
                recorded: Mutex::new(Vec::new()),
                fails: true,
            }),
        )
        .execute_with_consents(
            credentials(),
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            from_a_sheet(),
            &ticked(),
        )
        .await
        .expect("the customer still exists");
        assert_eq!(registered.customer.id(), &CustomerId::new("cus_new"));
        assert!(!registered.consents_recorded);
    }
}
