//! Configuration for the fields printed on a golf reception sheet.
//!
//! The sheet is a CourseBoard concern.  Field owns the generic customer
//! columns, but the decision about which of those columns a golf course puts
//! on its paper (and which golf-specific questions it adds) belongs here.  A
//! custom field is deliberately stored in this table rather than Field's
//! custom-field registry so the reception desk can run without opening Field
//! admin (ADR-0005, ADR-0009, ADR-0010).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::CourseError;

/// Built-in customer columns that may appear on a reception sheet.
///
/// `name` is special: Field cannot create a customer without it, so it is
/// always enabled and required.  The other defaults preserve the original
/// CourseBoard reception sheet; date, sex, and address are opt-in.
pub const STANDARD_RECEPTION_FIELD_KEYS: &[&str] = &[
    "name",
    "name_kana",
    "phone",
    "email",
    "birth_date",
    "sex",
    "address",
];

pub const MAX_RECEPTION_FIELD_KEY_LENGTH: usize = 64;
pub const MAX_RECEPTION_FIELD_LABEL_LENGTH: usize = 120;
pub const MAX_RECEPTION_FIELD_OPTIONS: usize = 50;
pub const MAX_RECEPTION_FIELD_OPTION_LENGTH: usize = 120;

/// Whether a configured item is backed by one of Field's standard columns or
/// is a golf-specific question kept in CourseBoard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReceptionFieldKind {
    Standard,
    Custom,
}

impl ReceptionFieldKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Custom => "custom",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value {
            "standard" => Ok(Self::Standard),
            "custom" => Ok(Self::Custom),
            _ => Err(CourseError::Provider(
                "database contains an invalid reception field kind".to_string(),
            )),
        }
    }
}

impl std::fmt::Display for ReceptionFieldKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// The type sent to the generic OCR reader and used to validate a submitted
/// answer.  `text` is used for standard sex because Field accepts the tenant's
/// own vocabulary; a club may still make a custom sex question a select.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReceptionFieldType {
    Text,
    Tel,
    Email,
    Date,
    Select,
    Boolean,
    Address,
}

impl ReceptionFieldType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Tel => "tel",
            Self::Email => "email",
            Self::Date => "date",
            Self::Select => "select",
            Self::Boolean => "boolean",
            Self::Address => "address",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value {
            "text" => Ok(Self::Text),
            "tel" => Ok(Self::Tel),
            "email" => Ok(Self::Email),
            "date" => Ok(Self::Date),
            "select" => Ok(Self::Select),
            "boolean" => Ok(Self::Boolean),
            "address" => Ok(Self::Address),
            _ => Err(CourseError::Provider(
                "database contains an invalid reception field type".to_string(),
            )),
        }
    }
}

impl std::fmt::Display for ReceptionFieldType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A validated setting supplied by the settings screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceptionFieldInput {
    pub field_key: String,
    pub kind: ReceptionFieldKind,
    pub field_type: ReceptionFieldType,
    pub enabled: bool,
    pub required: bool,
    pub label: Option<String>,
    pub sort_order: i32,
    pub options: Vec<String>,
}

/// A tenant's reception field definition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerReceptionField {
    pub tenant_id: String,
    pub field_key: String,
    pub kind: ReceptionFieldKind,
    pub field_type: ReceptionFieldType,
    pub enabled: bool,
    pub required: bool,
    /// `None` means the built-in wording for a standard field, or the field
    /// key for a custom field.
    pub label: Option<String>,
    pub sort_order: i32,
    pub options: Vec<String>,
}

impl CustomerReceptionField {
    /// Build a setting after validating both the built-in and custom-field
    /// contracts.  The same constructor is used by PUT and by repository row
    /// tests, so malformed settings cannot enter through either boundary.
    pub fn try_new(
        tenant_id: impl Into<String>,
        input: ReceptionFieldInput,
    ) -> Result<Self, CourseError> {
        let tenant_id = tenant_id.into();
        if tenant_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }
        if input.field_key.trim() != input.field_key
            || input.field_key.is_empty()
            || input.field_key.chars().count() > MAX_RECEPTION_FIELD_KEY_LENGTH
        {
            return Err(CourseError::BadRequest("invalid reception field key"));
        }

        let label = normalize_label(input.label)?;
        let options = normalize_options(input.options, input.field_type)?;
        if input.sort_order < 0 {
            return Err(CourseError::BadRequest(
                "reception field sort order must be non-negative",
            ));
        }

        match input.kind {
            ReceptionFieldKind::Standard => {
                let Some((expected_type, _default_label, _default_order)) =
                    standard_spec(&input.field_key)
                else {
                    return Err(CourseError::BadRequest("unknown standard reception field"));
                };
                if input.field_type != expected_type || !options.is_empty() {
                    return Err(CourseError::BadRequest(
                        "standard reception field has an invalid type or options",
                    ));
                }
                if input.field_key == "name" && (!input.enabled || !input.required) {
                    return Err(CourseError::BadRequest(
                        "customer name reception field must be enabled and required",
                    ));
                }
            }
            ReceptionFieldKind::Custom => {
                if standard_spec(&input.field_key).is_some()
                    || reception_ocr_key_is_reserved(&input.field_key)
                    || !valid_custom_key(&input.field_key)
                {
                    return Err(CourseError::BadRequest(
                        "custom reception field key is invalid or reserved",
                    ));
                }
                if !matches!(
                    input.field_type,
                    ReceptionFieldType::Text
                        | ReceptionFieldType::Date
                        | ReceptionFieldType::Select
                        | ReceptionFieldType::Boolean
                ) {
                    return Err(CourseError::BadRequest(
                        "custom reception field type is not supported",
                    ));
                }
            }
        }

        Ok(Self {
            tenant_id,
            field_key: input.field_key,
            kind: input.kind,
            field_type: input.field_type,
            enabled: input.enabled,
            required: input.required,
            label,
            sort_order: input.sort_order,
            options,
        })
    }

    /// The setting to return when a tenant has never saved one.
    pub fn default_for(tenant_id: impl Into<String>, field_key: &str) -> Option<Self> {
        let (field_type, _label, sort_order) = standard_spec(field_key)?;
        Some(Self {
            tenant_id: tenant_id.into(),
            field_key: field_key.to_string(),
            kind: ReceptionFieldKind::Standard,
            field_type,
            enabled: default_enabled(field_key),
            required: field_key == "name",
            label: None,
            sort_order,
            options: Vec::new(),
        })
    }

    /// The complete list for a tenant: stored rows plus any standard fields
    /// introduced after the tenant last opened settings.  Custom rows are
    /// retained even when a future build adds another standard field.
    pub fn merge_with_defaults(
        tenant_id: &str,
        stored: impl IntoIterator<Item = Self>,
    ) -> Vec<Self> {
        let mut by_key = BTreeMap::new();
        for mut field in stored {
            // A legacy row cannot turn the customer name off.  This also
            // makes GET safe if a row was written by an older build.
            if field.field_key == "name" {
                field.kind = ReceptionFieldKind::Standard;
                field.field_type = ReceptionFieldType::Text;
                field.enabled = true;
                field.required = true;
                field.options.clear();
            }
            by_key.insert(field.field_key.clone(), field);
        }
        for key in STANDARD_RECEPTION_FIELD_KEYS {
            if !by_key.contains_key(*key) {
                if let Some(field) = Self::default_for(tenant_id, key) {
                    by_key.insert((*key).to_string(), field);
                }
            }
        }

        let mut fields: Vec<Self> = by_key.into_values().collect();
        fields.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.field_key.cmp(&right.field_key))
        });
        fields
    }

    pub fn effective_label(&self) -> &str {
        self.label.as_deref().unwrap_or_else(|| {
            standard_spec(&self.field_key)
                .map(|(_, label, _)| label)
                .unwrap_or(self.field_key.as_str())
        })
    }

    pub fn demands_a_value(&self) -> bool {
        self.enabled && self.required
    }
}

fn standard_spec(key: &str) -> Option<(ReceptionFieldType, &'static str, i32)> {
    Some(match key {
        "name" => (ReceptionFieldType::Text, "氏名", 0),
        "name_kana" => (ReceptionFieldType::Text, "氏名のふりがな（カタカナ）", 1),
        "phone" => (ReceptionFieldType::Tel, "電話番号", 2),
        "email" => (ReceptionFieldType::Email, "メールアドレス", 3),
        "birth_date" => (ReceptionFieldType::Date, "生年月日", 4),
        "sex" => (ReceptionFieldType::Text, "性別", 5),
        "address" => (ReceptionFieldType::Address, "住所", 6),
        _ => return None,
    })
}

fn default_enabled(key: &str) -> bool {
    matches!(key, "name" | "name_kana" | "phone" | "email")
}

fn valid_custom_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

fn reception_ocr_key_is_reserved(key: &str) -> bool {
    matches!(
        key,
        "address_postal_code" | "address_state" | "address_city" | "address1" | "address2"
    ) || super::reception_consent(key).is_some()
}

fn normalize_label(label: Option<String>) -> Result<Option<String>, CourseError> {
    let Some(label) = label else { return Ok(None) };
    let label = label.trim().to_string();
    if label.chars().count() > MAX_RECEPTION_FIELD_LABEL_LENGTH {
        return Err(CourseError::BadRequest("reception field label is too long"));
    }
    Ok((!label.is_empty()).then_some(label))
}

fn normalize_options(
    options: Vec<String>,
    field_type: ReceptionFieldType,
) -> Result<Vec<String>, CourseError> {
    if field_type != ReceptionFieldType::Select && !options.is_empty() {
        return Err(CourseError::BadRequest(
            "reception field options require select type",
        ));
    }
    if options.len() > MAX_RECEPTION_FIELD_OPTIONS {
        return Err(CourseError::BadRequest("too many reception field options"));
    }
    let mut normalized = Vec::with_capacity(options.len());
    for option in options {
        let option = option.trim().to_string();
        if option.is_empty() || option.chars().count() > MAX_RECEPTION_FIELD_OPTION_LENGTH {
            return Err(CourseError::BadRequest("invalid reception field option"));
        }
        if normalized.contains(&option) {
            return Err(CourseError::BadRequest(
                "reception field options must be unique",
            ));
        }
        normalized.push(option);
    }
    if field_type == ReceptionFieldType::Select && normalized.is_empty() {
        return Err(CourseError::BadRequest(
            "select reception field needs options",
        ));
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standard(key: &str, enabled: bool, required: bool) -> ReceptionFieldInput {
        let field_type = standard_spec(key).unwrap().0;
        ReceptionFieldInput {
            field_key: key.to_string(),
            kind: ReceptionFieldKind::Standard,
            field_type,
            enabled,
            required,
            label: None,
            sort_order: standard_spec(key).unwrap().2,
            options: Vec::new(),
        }
    }

    #[test]
    fn defaults_keep_the_original_reception_fields_and_make_name_fixed() {
        let fields = CustomerReceptionField::merge_with_defaults("tenant-1", Vec::new());
        assert_eq!(
            fields
                .iter()
                .map(|field| field.field_key.as_str())
                .collect::<Vec<_>>(),
            STANDARD_RECEPTION_FIELD_KEYS
        );
        assert!(fields[0].enabled);
        assert!(fields[0].required);
        assert!(fields[1].enabled);
        assert!(!fields[4].enabled);
        assert_eq!(fields[6].effective_label(), "住所");
    }

    #[test]
    fn stored_custom_fields_survive_the_default_merge() {
        let custom = CustomerReceptionField::try_new(
            "tenant-1",
            ReceptionFieldInput {
                field_key: "golf_membership_type".to_string(),
                kind: ReceptionFieldKind::Custom,
                field_type: ReceptionFieldType::Select,
                enabled: true,
                required: true,
                label: Some("会員区分".to_string()),
                sort_order: 1,
                options: vec!["正会員".to_string(), "平日会員".to_string()],
            },
        )
        .unwrap();
        let fields = CustomerReceptionField::merge_with_defaults("tenant-1", [custom]);
        assert_eq!(fields.len(), STANDARD_RECEPTION_FIELD_KEYS.len() + 1);
        let custom = fields
            .iter()
            .find(|field| field.field_key == "golf_membership_type")
            .unwrap();
        assert_eq!(custom.effective_label(), "会員区分");
        assert_eq!(custom.options, ["正会員", "平日会員"]);
    }

    #[test]
    fn name_cannot_be_disabled_or_optional() {
        let error = CustomerReceptionField::try_new("tenant-1", standard("name", false, false))
            .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn custom_select_requires_unique_options() {
        let error = CustomerReceptionField::try_new(
            "tenant-1",
            ReceptionFieldInput {
                field_key: "membership_type".to_string(),
                kind: ReceptionFieldKind::Custom,
                field_type: ReceptionFieldType::Select,
                enabled: true,
                required: false,
                label: None,
                sort_order: 7,
                options: vec!["会員".to_string(), "会員".to_string()],
            },
        )
        .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn reserved_and_malformed_custom_keys_are_rejected() {
        for key in [
            "name",
            "Name",
            "member-type",
            "",
            "address1",
            "address_postal_code",
            super::super::CONSENT_CART_TERMS,
        ] {
            let error = CustomerReceptionField::try_new(
                "tenant-1",
                ReceptionFieldInput {
                    field_key: key.to_string(),
                    kind: ReceptionFieldKind::Custom,
                    field_type: ReceptionFieldType::Text,
                    enabled: true,
                    required: false,
                    label: None,
                    sort_order: 0,
                    options: Vec::new(),
                },
            )
            .unwrap_err();
            assert!(matches!(error, CourseError::BadRequest(_)), "{key:?}");
        }
    }

    #[test]
    fn custom_fields_only_allow_types_the_settings_ui_and_field_reader_share() {
        let error = CustomerReceptionField::try_new(
            "tenant-1",
            ReceptionFieldInput {
                field_key: "home_address".to_string(),
                kind: ReceptionFieldKind::Custom,
                field_type: ReceptionFieldType::Address,
                enabled: true,
                required: false,
                label: None,
                sort_order: 7,
                options: Vec::new(),
            },
        )
        .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }
}
