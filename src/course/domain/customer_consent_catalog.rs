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

/// What CourseBoard sends Field to change a consent definition. `None`
/// leaves that field as it is; `body: Some(None)` clears the body.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CustomerConsentItemPatch {
    pub label: Option<String>,
    pub body: Option<Option<String>>,
    pub required: Option<bool>,
    pub terms_version: Option<String>,
    pub active: Option<bool>,
}

/// The terms version after the wording of a consent changed.
///
/// Field snapshots the version on every recorded consent, so new wording must
/// carry a new version or past records would appear to cover text the visitor
/// never saw. Numeric versions count up; anything else gets a revision suffix.
pub fn next_terms_version(current: &str) -> String {
    let current = current.trim();
    match current.parse::<u32>() {
        Ok(number) => (number + 1).to_string(),
        Err(_) if current.is_empty() => "1".to_string(),
        Err(_) => format!("{current}.1"),
    }
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

#[cfg(test)]
mod terms_version_tests {
    use super::next_terms_version;

    #[test]
    fn numeric_versions_count_up_and_others_get_a_revision() {
        assert_eq!(next_terms_version("1"), "2");
        assert_eq!(next_terms_version(" 9 "), "10");
        assert_eq!(next_terms_version("2024-04"), "2024-04.1");
        assert_eq!(next_terms_version(""), "1");
    }
}
