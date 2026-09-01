//! Reading and arranging the fields printed on a reception sheet.

use std::collections::HashSet;
use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    reception_sheet_schema_for_fields, CourseError, CustomerReceptionField,
    CustomerReceptionFieldsGateway, GatewayCredentials, ReceptionFieldInput,
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
}

impl ReplaceCustomerReceptionFieldsUseCase {
    pub fn new(fields: Arc<dyn CustomerReceptionFieldsGateway>) -> Self {
        Self { fields }
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
        reception_sheet_schema_for_fields(&effective)?;
        self.fields
            .replace_customer_reception_fields(credentials.operator_id, &fields)
            .await?;
        Ok(effective)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        ReceptionFieldKind, ReceptionFieldType, STANDARD_RECEPTION_FIELD_KEYS,
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
        let fields = ReplaceCustomerReceptionFieldsUseCase::new(gateway.clone())
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
        let error = ReplaceCustomerReceptionFieldsUseCase::new(gateway.clone())
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
        let error = ReplaceCustomerReceptionFieldsUseCase::new(gateway.clone())
            .execute(credentials(), inputs)
            .await
            .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
        assert!(gateway.replaced.lock().unwrap().is_empty());
    }
}
