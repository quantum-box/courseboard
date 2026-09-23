//! Reading and arranging the fields printed on a reception sheet.

use std::collections::HashSet;
use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    active_reception_consent_definitions, reception_sheet_schema_for_fields_and_consents,
    CourseError, CustomerConsentCatalogGateway, CustomerReceptionField,
    CustomerReceptionFieldsGateway, CustomerReceptionOcrGateway, GatewayCredentials,
    ReceptionFieldInput, ReceptionFormProposal, ReceptionSheet,
};

/// Returns the saved settings merged with the built-in standard fields.
pub struct GetCustomerReceptionFieldsUseCase {
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
}

impl GetCustomerReceptionFieldsUseCase {
    pub fn new(fields: Arc<dyn CustomerReceptionFieldsGateway>) -> Self {
        Self { fields }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<CustomerReceptionField>, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        Ok(CustomerReceptionField::merge_with_defaults(
            credentials.operator_id,
            stored,
        ))
    }
}

/// Validates and replaces a tenant's reception-field settings.
pub struct ReplaceCustomerReceptionFieldsUseCase {
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
    consents: Arc<dyn CustomerConsentCatalogGateway>,
}

impl ReplaceCustomerReceptionFieldsUseCase {
    pub fn new(
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
        consents: Arc<dyn CustomerConsentCatalogGateway>,
    ) -> Self {
        Self { fields, consents }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        inputs: Vec<ReceptionFieldInput>,
    ) -> Result<Vec<CustomerReceptionField>, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        let mut keys = HashSet::with_capacity(inputs.len());
        let mut fields = Vec::with_capacity(inputs.len());
        for input in inputs {
            if !keys.insert(input.field_key.clone()) {
                return Err(CourseError::BadRequest(
                    "reception field keys must be unique",
                ));
            }
            fields.push(CustomerReceptionField::try_new(
                credentials.operator_id,
                input,
            )?);
        }
        let effective =
            CustomerReceptionField::merge_with_defaults(credentials.operator_id, fields.clone());
        // Refuse an unusable configuration at PUT time instead of letting the
        // next scan fail against Field's twenty-column items limit. Address
        // counts as five OCR columns even though it is one setting in the UI.
        let catalog = self.consents.list_consent_items(credentials, false).await?;
        let consents = active_reception_consent_definitions(&catalog);
        reception_sheet_schema_for_fields_and_consents(&effective, &consents)?;
        self.fields
            .replace_customer_reception_fields(credentials.operator_id, &fields)
            .await?;
        Ok(effective)
    }
}

/// Proposes reception-field settings from a blank sheet without writing them.
///
/// Analysis is a settings-management operation, so it uses the same action as
/// PUT. The gateway owns the Field contract and maps its response into the
/// CourseBoard field model before this use case returns it.
pub struct AnalyzeCustomerReceptionFieldsUseCase {
    analyzer: Arc<dyn CustomerReceptionOcrGateway>,
}

impl AnalyzeCustomerReceptionFieldsUseCase {
    pub fn new(analyzer: Arc<dyn CustomerReceptionOcrGateway>) -> Self {
        Self { analyzer }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        sheet: ReceptionSheet,
    ) -> Result<ReceptionFormProposal, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        self.analyzer
            .analyze_reception_form(credentials, sheet)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        CreateCustomerConsentItem, CustomerConsentItem, ReceptionFieldKind, ReceptionFieldType,
        RECEPTION_CONSENTS, STANDARD_RECEPTION_FIELD_KEYS,
    };

    #[derive(Default)]
    struct StubFields {
        stored: Mutex<Vec<CustomerReceptionField>>,
        replaced: Mutex<Vec<Vec<CustomerReceptionField>>>,
    }

    #[async_trait]
    impl CustomerReceptionFieldsGateway for StubFields {
        async fn list_customer_reception_fields(
            &self,
            _tenant_id: &str,
        ) -> Result<Vec<CustomerReceptionField>, CourseError> {
            Ok(self.stored.lock().unwrap().clone())
        }

        async fn replace_customer_reception_fields(
            &self,
            _tenant_id: &str,
            fields: &[CustomerReceptionField],
        ) -> Result<(), CourseError> {
            self.replaced.lock().unwrap().push(fields.to_vec());
            Ok(())
        }
    }

    #[derive(Default)]
    struct StubConsents;

    #[async_trait]
    impl CustomerConsentCatalogGateway for StubConsents {
        async fn list_consent_items(
            &self,
            _credentials: GatewayCredentials<'_>,
            _include_inactive: bool,
        ) -> Result<Vec<CustomerConsentItem>, CourseError> {
            Ok(RECEPTION_CONSENTS
                .iter()
                .enumerate()
                .map(|(index, consent)| CustomerConsentItem {
                    id: format!("consent-{index}"),
                    consent_key: consent.key.to_string(),
                    label: consent.label.to_string(),
                    body: Some(consent.prompt.to_string()),
                    required: consent.required,
                    terms_version: "1".to_string(),
                    active: true,
                    sort_order: index as i32,
                })
                .collect())
        }

        async fn create_consent_item(
            &self,
            _credentials: GatewayCredentials<'_>,
            _item: &CreateCustomerConsentItem,
        ) -> Result<CustomerConsentItem, CourseError> {
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

    fn custom() -> ReceptionFieldInput {
        ReceptionFieldInput {
            field_key: "golf_membership_type".to_string(),
            kind: ReceptionFieldKind::Custom,
            field_type: ReceptionFieldType::Select,
            enabled: true,
            required: false,
            label: Some("会員区分".to_string()),
            sort_order: 7,
            options: vec!["正会員".to_string(), "平日会員".to_string()],
        }
    }

    #[tokio::test]
    async fn get_returns_standard_defaults_when_a_tenant_has_not_saved_settings() {
        let fields = GetCustomerReceptionFieldsUseCase::new(Arc::new(StubFields::default()))
            .execute(credentials())
            .await
            .unwrap();
        assert_eq!(
            fields
                .iter()
                .filter(|field| field.kind == ReceptionFieldKind::Standard)
                .map(|field| field.field_key.as_str())
                .collect::<Vec<_>>(),
            STANDARD_RECEPTION_FIELD_KEYS
        );
    }

    #[tokio::test]
    async fn put_validates_and_replaces_custom_settings() {
        let gateway = Arc::new(StubFields::default());
        let fields =
            ReplaceCustomerReceptionFieldsUseCase::new(gateway.clone(), Arc::new(StubConsents))
                .execute(credentials(), vec![custom()])
                .await
                .unwrap();
        assert_eq!(fields.len(), STANDARD_RECEPTION_FIELD_KEYS.len() + 1);
        let replaced = gateway.replaced.lock().unwrap();
        assert_eq!(replaced.len(), 1);
        assert_eq!(replaced[0][0].field_key, "golf_membership_type");
    }

    #[tokio::test]
    async fn put_rejects_duplicate_keys_before_writing() {
        let gateway = Arc::new(StubFields::default());
        let error =
            ReplaceCustomerReceptionFieldsUseCase::new(gateway.clone(), Arc::new(StubConsents))
                .execute(credentials(), vec![custom(), custom()])
                .await
                .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
        assert!(gateway.replaced.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn put_rejects_more_columns_than_field_can_read() {
        let gateway = Arc::new(StubFields::default());
        let inputs = (0..14)
            .map(|index| ReceptionFieldInput {
                field_key: format!("custom_{index}"),
                kind: ReceptionFieldKind::Custom,
                field_type: ReceptionFieldType::Text,
                enabled: true,
                required: false,
                label: None,
                sort_order: 7 + index,
                options: Vec::new(),
            })
            .collect();
        let error =
            ReplaceCustomerReceptionFieldsUseCase::new(gateway.clone(), Arc::new(StubConsents))
                .execute(credentials(), inputs)
                .await
                .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
        assert!(gateway.replaced.lock().unwrap().is_empty());
    }
}
