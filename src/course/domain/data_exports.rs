//! Declared application-owned data sources for Field's generic export renderer.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

use super::{actions, CourseError, GatewayCredentials};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DataExportField {
    pub field: String,
    pub label: String,
}
#[derive(Debug, Clone, Deserialize)]
pub struct DataExportObject {
    pub key: String,
    pub label: String,
    pub table: String,
    pub action: String,
    pub fields: Vec<DataExportField>,
}
impl DataExportObject {
    pub fn required_action(&self) -> &'static str {
        match self.action.as_str() {
            "LIST_CUSTOMERS" => actions::LIST_CUSTOMERS,
            "LIST_TEE_SHEET" => actions::LIST_TEE_SHEET,
            "LIST_RESERVATION_REPORTS" => actions::LIST_RESERVATION_REPORTS,
            "LIST_SHIFTS" => actions::LIST_SHIFTS,
            "LIST_CADDIE_AVAILABILITY" => actions::LIST_CADDIE_AVAILABILITY,
            "LIST_CADDIE_ASSIGNMENTS" => actions::LIST_CADDIE_ASSIGNMENTS,
            "LIST_CADDIE_RANK_FEES" => actions::LIST_CADDIE_RANK_FEES,
            "LIST_MEMBERSHIP" => actions::LIST_MEMBERSHIP,
            "LIST_SLOT_OVERRIDES" => actions::LIST_SLOT_OVERRIDES,
            "LIST_COURSES" => actions::LIST_COURSES,
            "LIST_PRODUCTS" => actions::LIST_PRODUCTS,
            "LIST_CADDIES" => actions::LIST_CADDIES,
            "LIST_PAYROLL" => actions::LIST_PAYROLL,
            "LIST_SETTLEMENT" => actions::LIST_SETTLEMENT,
            "CALCULATE_FEES" => actions::CALCULATE_FEES,
            _ => panic!("unclassified export object"),
        }
    }
}
pub fn data_export_objects() -> &'static [DataExportObject] {
    static OBJECTS: LazyLock<Vec<DataExportObject>> = LazyLock::new(|| {
        serde_json::from_str(include_str!("data_export_objects.json"))
            .expect("valid export catalogue")
    });
    &OBJECTS
}

#[async_trait]
pub trait DataExportGateway: Send + Sync {
    async fn custom_fields(&self, tenant_id: &str) -> Result<Vec<DataExportField>, CourseError>;
    async fn rows(
        &self,
        credentials: GatewayCredentials<'_>,
        object: &DataExportObject,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Value>, CourseError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_source_is_classified_and_declares_only_safe_sql_identifiers() {
        let mut keys = std::collections::HashSet::new();
        for object in data_export_objects() {
            assert!(keys.insert(&object.key));
            assert!(actions::READ_ONLY.contains(&object.required_action()));
            assert!(!object.fields.is_empty());
            for identifier in std::iter::once(object.table.as_str())
                .chain(object.fields.iter().map(|field| field.field.as_str()))
            {
                assert!(identifier.bytes().all(|byte| byte.is_ascii_alphanumeric()
                    || byte == b'_'
                    || (object.table == "computed" && byte == b'.')));
                assert!(
                    !["public_token", "stripe_client_secret", "payment_url"].contains(&identifier)
                );
            }
        }
    }
}
