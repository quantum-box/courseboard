//! Reception-sheet customer creation.
//!
//! This path is intentionally separate from `CreateCustomerUseCase`. Manual
//! and booking-ledger forms keep their existing StoreKit customer gateway;
//! reception sheets use Field's ERP create capability so standard extended
//! columns and consents travel in one request. Golf-specific custom values are
//! written locally only after the upstream customer exists.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::NaiveDate;
use serde_json::{json, Value};

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerReceptionCreateGateway, CustomerReceptionField,
    CustomerReceptionFieldsGateway, CustomerReceptionValuesGateway, CustomerRegistrationGateway,
    CustomerRegistrationSource, GatewayCredentials, NewCustomerRegistration,
    ReceptionConsentAnswer, ReceptionCustomerInput, ReceptionFieldKind, ReceptionFieldType,
};

use super::create_customer::{
    refuse_without_the_required_declaration, CustomerProvenance, RegisteredCustomer,
};

pub struct CreateReceptionCustomerUseCase {
    customers: Arc<dyn CustomerReceptionCreateGateway>,
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
    values: Arc<dyn CustomerReceptionValuesGateway>,
    registrations: Arc<dyn CustomerRegistrationGateway>,
}

impl CreateReceptionCustomerUseCase {
    pub fn new(
        customers: Arc<dyn CustomerReceptionCreateGateway>,
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
        values: Arc<dyn CustomerReceptionValuesGateway>,
        registrations: Arc<dyn CustomerRegistrationGateway>,
    ) -> Self {
        Self {
            customers,
            fields,
            values,
            registrations,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: ReceptionCustomerInput,
        provenance: CustomerProvenance,
        consents: &[ReceptionConsentAnswer],
    ) -> Result<RegisteredCustomer, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        if provenance.source != CustomerRegistrationSource::ReceptionSheet {
            return Err(CourseError::BadRequest(
                "reception customer creation requires a reception sheet source",
            ));
        }

        // Read the settings before Field is touched. The current tenant
        // configuration is the authority even when a browser tab has been
        // open since yesterday.
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        let fields = CustomerReceptionField::merge_with_defaults(credentials.operator_id, stored);
        validate_reception_customer(&fields, &input)?;
        refuse_without_the_required_declaration(consents)?;

        // The ERP endpoint records these consents together with the customer;
        // unlike the StoreKit path there is no second consent request to
        // duplicate the append-only declaration.
        let created = self
            .customers
            .create_reception_customer(credentials, &input, consents)
            .await?;

        let entry = NewCustomerRegistration::new(
            created.id().clone(),
            provenance.source,
            provenance.registered_by,
            provenance.source_row_index,
        );
        if let Err(error) = self
            .registrations
            .record_customer_registration(credentials.operator_id, &entry)
            .await
        {
            tracing::warn!(
                error = %error,
                customer_id = created.id().as_str(),
                "reception customer was created but its provenance could not be recorded"
            );
        }

        let custom_values = values_to_persist(&fields, &input.custom_fields);
        let custom_fields_recorded = if custom_values.is_empty() {
            true
        } else {
            match self
                .values
                .record_customer_reception_values(
                    credentials.operator_id,
                    created.id(),
                    &custom_values,
                )
                .await
            {
                Ok(()) => true,
                Err(error) => {
                    // The upstream customer is already real. Returning a
                    // failure here would make the desk submit the sheet a
                    // second time, creating a duplicate. The explicit flag
                    // lets the UI retry custom-value filing separately.
                    tracing::error!(
                        error = %error,
                        customer_id = created.id().as_str(),
                        "reception customer was created but custom values could not be recorded"
                    );
                    false
                }
            }
        };

        Ok(RegisteredCustomer {
            customer: created,
            consents_recorded: true,
            custom_fields_recorded,
        })
    }
}

/// Validates all settings and submitted values before the ERP create call.
fn validate_reception_customer(
    fields: &[CustomerReceptionField],
    input: &ReceptionCustomerInput,
) -> Result<(), CourseError> {
    validate_reception_custom_values(fields, &input.custom_fields)?;

    for field in fields
        .iter()
        .filter(|field| field.kind == ReceptionFieldKind::Standard && field.enabled)
    {
        let value = standard_value(&field.field_key, input);
        match value {
            Some(value) => validate_configured_value(field, &value)?,
            None if field.required => {
                return Err(CourseError::BadRequest(
                    "required reception field is missing",
                ))
            }
            None => {}
        }
    }

    for field in fields
        .iter()
        .filter(|field| field.kind == ReceptionFieldKind::Standard && !field.enabled)
    {
        if standard_value(&field.field_key, input).is_some_and(|value| !is_missing_value(&value)) {
            return Err(CourseError::BadRequest(
                "reception field is disabled for this tenant",
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_reception_custom_values(
    fields: &[CustomerReceptionField],
    values: &BTreeMap<String, Value>,
) -> Result<(), CourseError> {
    let mut configured_custom_keys = BTreeMap::new();
    for field in fields {
        if field.kind == ReceptionFieldKind::Custom {
            configured_custom_keys.insert(field.field_key.as_str(), field);
        }
    }

    // A stale screen must not silently submit a custom key that the current
    // tenant no longer has. This also prevents standard keys being smuggled
    // through the local custom-value table.
    for key in values.keys() {
        let Some(field) = configured_custom_keys.get(key.as_str()) else {
            return Err(CourseError::BadRequest("unknown reception custom field"));
        };
        if !field.enabled {
            return Err(CourseError::BadRequest(
                "reception field is disabled for this tenant",
            ));
        }
        let value = values.get(key).expect("key came from map");
        validate_configured_value(field, value)?;
    }

    for field in fields
        .iter()
        .filter(|field| field.kind == ReceptionFieldKind::Custom && field.enabled && field.required)
    {
        if values.get(&field.field_key).is_none_or(is_missing_value) {
            return Err(CourseError::BadRequest(
                "required reception field is missing",
            ));
        }
    }
    Ok(())
}

fn standard_value(key: &str, input: &ReceptionCustomerInput) -> Option<Value> {
    match key {
        "name" => Some(Value::String(input.customer.name.clone())),
        "name_kana" => input
            .customer
            .name_kana
            .as_ref()
            .map(|value| Value::String(value.clone())),
        "phone" => input
            .customer
            .phone
            .as_ref()
            .map(|value| Value::String(value.clone())),
        "email" => input
            .customer
            .email
            .as_ref()
            .map(|value| Value::String(value.clone())),
        "birth_date" => input
            .birth_date
            .map(|value| Value::String(value.format("%Y-%m-%d").to_string())),
        "sex" => input.sex.as_ref().map(|value| Value::String(value.clone())),
        "address" => input.address.as_ref().map(|address| {
            json!({
                "postalCode": address.postal_code,
                "state": address.state,
                "city": address.city,
                "address1": address.address1,
                "address2": address.address2,
            })
        }),
        _ => None,
    }
}

fn validate_configured_value(
    field: &CustomerReceptionField,
    value: &Value,
) -> Result<(), CourseError> {
    if is_missing_value(value) {
        if field.required {
            return Err(CourseError::BadRequest(
                "required reception field is missing",
            ));
        }
        return Ok(());
    }

    match field.field_type {
        ReceptionFieldType::Text | ReceptionFieldType::Tel | ReceptionFieldType::Email => {
            if !value.is_string() {
                return Err(CourseError::BadRequest(
                    "reception field value must be text",
                ));
            }
        }
        ReceptionFieldType::Date => {
            let Some(raw) = value.as_str() else {
                return Err(CourseError::BadRequest(
                    "reception date field value must be YYYY-MM-DD",
                ));
            };
            NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| {
                CourseError::BadRequest("reception date field value must be YYYY-MM-DD")
            })?;
        }
        ReceptionFieldType::Select => {
            let Some(raw) = value.as_str() else {
                return Err(CourseError::BadRequest(
                    "reception select field value must be text",
                ));
            };
            if !field.options.iter().any(|option| option == raw) {
                return Err(CourseError::BadRequest(
                    "reception select field value is not an option",
                ));
            }
        }
        ReceptionFieldType::Boolean => {
            if !value.is_boolean() {
                return Err(CourseError::BadRequest(
                    "reception boolean field value must be boolean",
                ));
            }
        }
        ReceptionFieldType::Address => {
            if !value.is_object() {
                return Err(CourseError::BadRequest(
                    "reception address field value must be an object",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn values_to_persist(
    fields: &[CustomerReceptionField],
    values: &BTreeMap<String, Value>,
) -> BTreeMap<String, Value> {
    values
        .iter()
        .filter(|(key, value)| {
            fields.iter().any(|field| {
                field.kind == ReceptionFieldKind::Custom
                    && field.enabled
                    && field.field_key == key.as_str()
            }) && !is_missing_value(value)
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn is_missing_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(value) => value.trim().is_empty(),
        Value::Object(value) => value.values().all(is_missing_value),
        Value::Array(value) => value.is_empty(),
        Value::Bool(_) | Value::Number(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        required_reception_consents, Customer, CustomerId, NewCustomer, ReceptionFieldInput,
        ReceptionFieldKind, ReceptionFieldType, STANDARD_RECEPTION_FIELD_KEYS,
    };

    #[derive(Default)]
    struct StubCreate {
        calls: Mutex<usize>,
    }

    #[async_trait]
    impl CustomerReceptionCreateGateway for StubCreate {
        async fn create_reception_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: &ReceptionCustomerInput,
            _consents: &[ReceptionConsentAnswer],
        ) -> Result<Customer, CourseError> {
            *self.calls.lock().unwrap() += 1;
            Ok(Customer::reconstitute(
                "cus_reception",
                input.customer.name.clone(),
                input.customer.name_kana.clone(),
                input.customer.email.clone(),
                input.customer.phone.clone(),
            ))
        }
    }

    #[derive(Default)]
    struct StubFields {
        stored: Vec<CustomerReceptionField>,
    }

    #[async_trait]
    impl CustomerReceptionFieldsGateway for StubFields {
        async fn list_customer_reception_fields(
            &self,
            _tenant_id: &str,
        ) -> Result<Vec<CustomerReceptionField>, CourseError> {
            Ok(self.stored.clone())
        }

        async fn replace_customer_reception_fields(
            &self,
            _tenant_id: &str,
            _fields: &[CustomerReceptionField],
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
        }
    }

    #[derive(Default)]
    struct StubValues {
        fail: bool,
        seen: Mutex<Vec<BTreeMap<String, Value>>>,
    }

    #[async_trait]
    impl CustomerReceptionValuesGateway for StubValues {
        async fn record_customer_reception_values(
            &self,
            _tenant_id: &str,
            _customer_id: &crate::course::domain::CustomerId,
            values: &BTreeMap<String, Value>,
        ) -> Result<(), CourseError> {
            self.seen.lock().unwrap().push(values.clone());
            if self.fail {
                Err(CourseError::Provider("local db down".to_string()))
            } else {
                Ok(())
            }
        }
    }

    #[derive(Default)]
    struct StubRegistrations;

    #[async_trait]
    impl CustomerRegistrationGateway for StubRegistrations {
        async fn record_customer_registration(
            &self,
            _tenant_id: &str,
            _entry: &NewCustomerRegistration,
        ) -> Result<(), CourseError> {
            Ok(())
        }

        async fn get_customer_registration(
            &self,
            _tenant_id: &str,
            _customer_id: &CustomerId,
        ) -> Result<Option<crate::course::domain::CustomerRegistration>, CourseError> {
            unreachable!("not used by this use case")
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer caller",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    fn provenance() -> CustomerProvenance {
        CustomerProvenance {
            source: CustomerRegistrationSource::ReceptionSheet,
            registered_by: None,
            source_row_index: Some(0),
        }
    }

    fn input(custom_fields: BTreeMap<String, Value>) -> ReceptionCustomerInput {
        ReceptionCustomerInput::new(
            NewCustomer::try_new("本田 康彦", None, None, None).unwrap(),
            None,
            None,
            None,
            custom_fields,
        )
    }

    fn custom_field() -> CustomerReceptionField {
        CustomerReceptionField::try_new(
            "tenant-1",
            ReceptionFieldInput {
                field_key: "membership_type".to_string(),
                kind: ReceptionFieldKind::Custom,
                field_type: ReceptionFieldType::Select,
                enabled: true,
                required: true,
                label: Some("会員区分".to_string()),
                sort_order: 7,
                options: vec!["正会員".to_string()],
            },
        )
        .unwrap()
    }

    fn required_consent() -> Vec<ReceptionConsentAnswer> {
        vec![ReceptionConsentAnswer {
            key: required_reception_consents().next().unwrap().key,
            accepted: Some(true),
        }]
    }

    #[tokio::test]
    async fn settings_are_validated_before_the_erp_write() {
        let create = Arc::new(StubCreate::default());
        let usecase = CreateReceptionCustomerUseCase::new(
            create.clone(),
            Arc::new(StubFields {
                stored: vec![custom_field()],
            }),
            Arc::new(StubValues::default()),
            Arc::new(StubRegistrations),
        );
        let error = usecase
            .execute(
                credentials(),
                input(BTreeMap::from([(
                    "membership_type".to_string(),
                    json!("平日会員"),
                )])),
                provenance(),
                &required_consent(),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
        assert_eq!(*create.calls.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn custom_value_failure_returns_the_customer_with_a_false_flag() {
        let values = Arc::new(StubValues {
            fail: true,
            seen: Mutex::new(Vec::new()),
        });
        let registered = CreateReceptionCustomerUseCase::new(
            Arc::new(StubCreate::default()),
            Arc::new(StubFields {
                stored: vec![custom_field()],
            }),
            values.clone(),
            Arc::new(StubRegistrations),
        )
        .execute(
            credentials(),
            input(BTreeMap::from([(
                "membership_type".to_string(),
                json!("正会員"),
            )])),
            provenance(),
            &required_consent(),
        )
        .await
        .unwrap();
        assert_eq!(registered.customer.id(), &CustomerId::new("cus_reception"));
        assert!(!registered.custom_fields_recorded);
        assert_eq!(values.seen.lock().unwrap().len(), 1);
        assert_eq!(values.seen.lock().unwrap()[0]["membership_type"], "正会員");
        assert_eq!(STANDARD_RECEPTION_FIELD_KEYS.len(), 7);
    }
}
