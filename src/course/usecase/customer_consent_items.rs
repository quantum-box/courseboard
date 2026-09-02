//! Manage Field-owned consent definitions from CourseBoard settings.

use std::sync::Arc;

use crate::course::domain::{
    actions, active_reception_consent_definitions, reception_sheet_schema_for_fields_and_consents,
    CourseError, CreateCustomerConsentItem, CustomerConsentCatalogGateway, CustomerConsentItem,
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
