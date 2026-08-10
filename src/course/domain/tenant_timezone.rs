//! Tenant-wide timezone stored in the golf extension config.

use serde_json::Value;

/// Compatibility default for tenants whose config predates the timezone key.
pub const DEFAULT_TIMEZONE: &str = "Asia/Tokyo";

/// Resolve the tenant timezone from the shared golf extension config.
///
/// The fallback keeps pre-SCC-6 tenants operational without a data rewrite.
/// Once the key exists, its value is the source of truth; course master values
/// are deliberately not consulted here.
pub fn tenant_timezone_from_config(config: &Value) -> String {
    config
        .get("timezone")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TIMEZONE)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn configured_tenant_timezone_is_resolved() {
        assert_eq!(
            tenant_timezone_from_config(&json!({ "timezone": "Europe/Berlin" })),
            "Europe/Berlin"
        );
    }

    #[test]
    fn pre_timezone_config_keeps_the_compatibility_default() {
        assert_eq!(tenant_timezone_from_config(&json!({})), DEFAULT_TIMEZONE);
        assert_eq!(
            tenant_timezone_from_config(&json!({ "timezone": "  " })),
            DEFAULT_TIMEZONE
        );
    }
}
