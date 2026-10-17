//! Manage Field-owned consent definitions from CourseBoard settings.

use std::sync::Arc;

use crate::course::domain::{
    actions, active_reception_consent_definitions, next_terms_version,
    reception_sheet_schema_for_fields_and_consents, CourseError, CreateCustomerConsentItem,
    CustomerConsentCatalogGateway, CustomerConsentItem, CustomerConsentItemPatch,
    CustomerReceptionField, CustomerReceptionFieldsGateway, GatewayCredentials,
};

pub struct ListCustomerConsentItemsUseCase {
    catalog: Arc<dyn CustomerConsentCatalogGateway>,
}

impl ListCustomerConsentItemsUseCase {
    pub fn new(catalog: Arc<dyn CustomerConsentCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        include_inactive: bool,
    ) -> Result<Vec<CustomerConsentItem>, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        let mut items = self
            .catalog
            .list_consent_items(credentials, include_inactive)
            .await?;
        items.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.consent_key.cmp(&right.consent_key))
        });
        Ok(items)
    }
}

pub struct CreateCustomerConsentItemUseCase {
    catalog: Arc<dyn CustomerConsentCatalogGateway>,
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
}

impl CreateCustomerConsentItemUseCase {
    pub fn new(
        catalog: Arc<dyn CustomerConsentCatalogGateway>,
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
    ) -> Self {
        Self { catalog, fields }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        item: CreateCustomerConsentItem,
    ) -> Result<CustomerConsentItem, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        // Include inactive definitions for key uniqueness: Field keys remain
        // reserved after deactivation and a retry must not create a shadow.
        let catalog = self.catalog.list_consent_items(credentials, true).await?;
        if catalog
            .iter()
            .any(|existing| existing.consent_key == item.consent_key)
        {
            return Err(CourseError::BadRequest("consent key already exists"));
        }
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        let fields = CustomerReceptionField::merge_with_defaults(credentials.operator_id, stored);
        let mut consents = active_reception_consent_definitions(&catalog);
        consents.push(crate::course::domain::ReceptionConsentDefinition::new(
            item.consent_key.clone(),
            item.label.clone(),
            item.body.clone(),
            item.required,
            item.sort_order,
        ));
        reception_sheet_schema_for_fields_and_consents(&fields, &consents)?;
        self.catalog.create_consent_item(credentials, &item).await
    }
}

/// Edits a consent definition's wording, required flag, or visibility.
pub struct UpdateCustomerConsentItemUseCase {
    catalog: Arc<dyn CustomerConsentCatalogGateway>,
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
}

impl UpdateCustomerConsentItemUseCase {
    pub fn new(
        catalog: Arc<dyn CustomerConsentCatalogGateway>,
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
    ) -> Self {
        Self { catalog, fields }
    }

    /// `edit.terms_version` is ignored: the version follows the wording and is
    /// decided here, so an operator cannot reword terms under an old version.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        id: &str,
        edit: CustomerConsentItemPatch,
    ) -> Result<CustomerConsentItem, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        let catalog = self.catalog.list_consent_items(credentials, true).await?;
        let existing = catalog
            .iter()
            .find(|item| item.id == id)
            .ok_or(CourseError::NotFound("consent item not found"))?;

        let mut patch = CustomerConsentItemPatch::default();
        if let Some(label) = edit.label {
            let label = label.trim();
            if label.is_empty() {
                return Err(CourseError::BadRequest("consent label is required"));
            }
            if label != existing.label {
                patch.label = Some(label.to_string());
            }
        }
        if let Some(body) = edit.body {
            let body = body
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty());
            if body != existing.body {
                patch.body = Some(body);
            }
        }
        patch.required = edit
            .required
            .filter(|required| *required != existing.required);
        patch.active = edit.active.filter(|active| *active != existing.active);
        if patch.label.is_some() || patch.body.is_some() {
            patch.terms_version = Some(next_terms_version(&existing.terms_version));
        }
        if patch == CustomerConsentItemPatch::default() {
            return Ok(existing.clone());
        }

        let edited = CustomerConsentItem {
            label: patch
                .label
                .clone()
                .unwrap_or_else(|| existing.label.clone()),
            body: patch.body.clone().unwrap_or_else(|| existing.body.clone()),
            required: patch.required.unwrap_or(existing.required),
            active: patch.active.unwrap_or(existing.active),
            ..existing.clone()
        };
        let after: Vec<CustomerConsentItem> = catalog
            .iter()
            .map(|item| {
                if item.id == id {
                    edited.clone()
                } else {
                    item.clone()
                }
            })
            .collect();
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        let fields = CustomerReceptionField::merge_with_defaults(credentials.operator_id, stored);
        reception_sheet_schema_for_fields_and_consents(
            &fields,
            &active_reception_consent_definitions(&after),
        )?;
        self.catalog
            .update_consent_item(credentials, id, &patch)
            .await
    }
}

/// Stops offering a consent on the reception screen. Field keeps the
/// definition for the consent trail, so it can be shown again later.
pub struct DeactivateCustomerConsentItemUseCase {
    catalog: Arc<dyn CustomerConsentCatalogGateway>,
}

impl DeactivateCustomerConsentItemUseCase {
    pub fn new(catalog: Arc<dyn CustomerConsentCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        id: &str,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        self.catalog.deactivate_consent_item(credentials, id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct StubFields;

    #[async_trait]
    impl CustomerReceptionFieldsGateway for StubFields {
        async fn list_customer_reception_fields(
            &self,
            _tenant_id: &str,
        ) -> Result<Vec<CustomerReceptionField>, CourseError> {
            Ok(Vec::new())
        }

        async fn replace_customer_reception_fields(
            &self,
            _tenant_id: &str,
            _fields: &[CustomerReceptionField],
        ) -> Result<(), CourseError> {
            unreachable!("not used by these use cases")
        }
    }

    #[derive(Default)]
    struct StubCatalog {
        patches: Mutex<Vec<(String, CustomerConsentItemPatch)>>,
        deactivated: Mutex<Vec<String>>,
    }

    fn cart_terms() -> CustomerConsentItem {
        CustomerConsentItem {
            id: "mci_cart".to_string(),
            consent_key: "golf_cart_terms_acknowledgement".to_string(),
            label: "カート利用約款を遵守します。".to_string(),
            body: None,
            required: false,
            terms_version: "1".to_string(),
            active: true,
            sort_order: 0,
        }
    }

    #[async_trait]
    impl CustomerConsentCatalogGateway for StubCatalog {
        async fn list_consent_items(
            &self,
            _credentials: GatewayCredentials<'_>,
            _include_inactive: bool,
        ) -> Result<Vec<CustomerConsentItem>, CourseError> {
            Ok(vec![cart_terms()])
        }

        async fn create_consent_item(
            &self,
            _credentials: GatewayCredentials<'_>,
            _item: &CreateCustomerConsentItem,
        ) -> Result<CustomerConsentItem, CourseError> {
            unreachable!("not used by these use cases")
        }

        async fn update_consent_item(
            &self,
            _credentials: GatewayCredentials<'_>,
            id: &str,
            patch: &CustomerConsentItemPatch,
        ) -> Result<CustomerConsentItem, CourseError> {
            self.patches
                .lock()
                .unwrap()
                .push((id.to_string(), patch.clone()));
            Ok(cart_terms())
        }

        async fn deactivate_consent_item(
            &self,
            _credentials: GatewayCredentials<'_>,
            id: &str,
        ) -> Result<(), CourseError> {
            self.deactivated.lock().unwrap().push(id.to_string());
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

    fn update(catalog: &Arc<StubCatalog>) -> UpdateCustomerConsentItemUseCase {
        UpdateCustomerConsentItemUseCase::new(catalog.clone(), Arc::new(StubFields))
    }

    #[tokio::test]
    async fn new_wording_moves_to_the_next_terms_version() {
        let catalog = Arc::new(StubCatalog::default());
        update(&catalog)
            .execute(
                credentials(),
                "mci_cart",
                CustomerConsentItemPatch {
                    label: Some(" 乗用カート利用約款を遵守します。 ".to_string()),
                    body: Some(Some("必ず□をご記入下さい。".to_string())),
                    required: Some(true),
                    terms_version: Some("1".to_string()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let patches = catalog.patches.lock().unwrap();
        assert_eq!(
            patches.as_slice(),
            [(
                "mci_cart".to_string(),
                CustomerConsentItemPatch {
                    label: Some("乗用カート利用約款を遵守します。".to_string()),
                    body: Some(Some("必ず□をご記入下さい。".to_string())),
                    required: Some(true),
                    terms_version: Some("2".to_string()),
                    active: None,
                },
            )]
        );
    }

    #[tokio::test]
    async fn a_required_flag_change_keeps_the_terms_version() {
        let catalog = Arc::new(StubCatalog::default());
        update(&catalog)
            .execute(
                credentials(),
                "mci_cart",
                CustomerConsentItemPatch {
                    label: Some("カート利用約款を遵守します。".to_string()),
                    body: Some(Some("  ".to_string())),
                    required: Some(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();

        let patches = catalog.patches.lock().unwrap();
        assert_eq!(
            patches[0].1,
            CustomerConsentItemPatch {
                required: Some(true),
                ..Default::default()
            }
        );
    }

    #[tokio::test]
    async fn an_unchanged_edit_does_not_call_field() {
        let catalog = Arc::new(StubCatalog::default());
        let item = update(&catalog)
            .execute(
                credentials(),
                "mci_cart",
                CustomerConsentItemPatch {
                    label: Some("カート利用約款を遵守します。".to_string()),
                    active: Some(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(item, cart_terms());
        assert!(catalog.patches.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_blank_label_or_unknown_item_is_refused() {
        let catalog = Arc::new(StubCatalog::default());
        let blank = update(&catalog)
            .execute(
                credentials(),
                "mci_cart",
                CustomerConsentItemPatch {
                    label: Some("  ".to_string()),
                    ..Default::default()
                },
            )
            .await;
        assert!(matches!(blank, Err(CourseError::BadRequest(_))));
        let missing = update(&catalog)
            .execute(
                credentials(),
                "mci_gone",
                CustomerConsentItemPatch::default(),
            )
            .await;
        assert!(matches!(missing, Err(CourseError::NotFound(_))));
        assert!(catalog.patches.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn deactivation_goes_to_field() {
        let catalog = Arc::new(StubCatalog::default());
        DeactivateCustomerConsentItemUseCase::new(catalog.clone())
            .execute(credentials(), "mci_cart")
            .await
            .unwrap();
        assert_eq!(catalog.deactivated.lock().unwrap().as_slice(), ["mci_cart"]);
    }
}
