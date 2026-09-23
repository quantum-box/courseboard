//! Tenant consent definitions owned by Field.

use serde::Serialize;

use super::ReceptionConsentDefinition;

/// One Field membership consent item exposed to CourseBoard reception flows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerConsentItem {
    pub id: String,
    pub consent_key: String,
    pub label: String,
    pub body: Option<String>,
    pub required: bool,
    pub terms_version: String,
    pub active: bool,
    pub sort_order: i32,
}

/// A new Field consent definition reviewed from an OCR proposal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateCustomerConsentItem {
    pub consent_key: String,
    pub label: String,
    pub body: Option<String>,
    pub required: bool,
    pub terms_version: String,
    pub sort_order: i32,
}

impl CustomerConsentItem {
    pub fn prompt(&self) -> &str {
        self.body
            .as_deref()
            .filter(|body| !body.trim().is_empty())
            .unwrap_or(&self.label)
    }

    pub fn reception_definition(&self) -> ReceptionConsentDefinition {
        ReceptionConsentDefinition::new(
            self.consent_key.clone(),
            self.label.clone(),
            self.body.clone(),
            self.required,
            self.sort_order,
        )
    }
}

pub fn active_reception_consent_definitions(
    items: &[CustomerConsentItem],
) -> Vec<ReceptionConsentDefinition> {
    items
        .iter()
        .filter(|item| item.active)
        .map(CustomerConsentItem::reception_definition)
        .collect()
}
