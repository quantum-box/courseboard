//! Field generic-OCR client for the reception desk.
//!
//! `POST /v1/field/ocr/{entity}/draft` reads a document against a form schema
//! the caller supplies, and answers with a draft keyed by field key. Field
//! stores neither the document nor the provider output; this gateway keeps that
//! property by forwarding bytes straight through and holding nothing.
//!
//! CourseBoard supplies the schema rather than the browser: what a golf
//! reception sheet has on it is golf knowledge (ADR-0005), and a schema the UI
//! could vary is a schema nobody can reproduce when a read comes back wrong.
//!
//! The visitor is drafted as `consumer` — Field's individual-customer entity,
//! the same record `/v1/storekit/customers` writes.

use std::collections::{BTreeMap, HashSet};

use async_trait::async_trait;
use serde::Deserialize;

use crate::course::domain::{
    reception_sheet_schema_for_fields, CourseError, CustomerReceptionField,
    CustomerReceptionOcrGateway, GatewayCredentials, ReceptionDraft, ReceptionDraftRow,
    ReceptionFieldInput, ReceptionFieldKind, ReceptionFieldType, ReceptionFormProposal,
    ReceptionReaderFailure, ReceptionSheet, RECEPTION_CONSENTS, RECEPTION_OCR_ENTITY_KEY,
    RECEPTION_ROWS_KEY, RECEPTION_ROW_EMAIL, RECEPTION_ROW_NAME, RECEPTION_ROW_NAME_KANA,
    RECEPTION_ROW_PHONE, STANDARD_RECEPTION_FIELD_KEYS,
};

use super::field_gateway::{
    field_send_multipart_classified, normalize_base_url, urlencoding_path, FieldStatusFailure,
};

/// Reads reception sheets through Field's generic document reader.
pub struct FieldCustomerReceptionGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldCustomerReceptionGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl CustomerReceptionOcrGateway for FieldCustomerReceptionGateway {
    async fn draft_reception(
        &self,
        credentials: GatewayCredentials<'_>,
        sheet: ReceptionSheet,
        fields: &[CustomerReceptionField],
    ) -> Result<ReceptionDraft, CourseError> {
        let schema =
            serde_json::to_string(&reception_sheet_schema_for_fields(fields)?).map_err(|_| {
                CourseError::Provider("reception sheet schema is not serializable".into())
            })?;
        let media_type = sheet.media_type();
        let part = reqwest::multipart::Part::bytes(sheet.into_bytes())
            // The desk's own filename is deliberately not forwarded: a scanner
            // names files after the machine and the minute, and upstream has no
            // use for either.
            .file_name(media_type.upload_filename())
            .mime_str(media_type.content_type())
            .map_err(|_| CourseError::BadRequest("reception sheet file type is invalid"))?;
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("schema", schema);
        let path = format!(
            "/v1/field/ocr/{}/draft",
            urlencoding_path(RECEPTION_OCR_ENTITY_KEY)
        );
        let response: FieldGenericOcrDraft = field_send_multipart_classified(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            form,
            reader_failure,
        )
        .await?;
        Ok(map_draft(response, fields))
    }

    async fn analyze_reception_form(
        &self,
        credentials: GatewayCredentials<'_>,
        sheet: ReceptionSheet,
    ) -> Result<ReceptionFormProposal, CourseError> {
        let media_type = sheet.media_type();
        let part = reqwest::multipart::Part::bytes(sheet.into_bytes())
            // The scanner's filename is deliberately not forwarded: Field has
            // no use for it and it may contain operator or visitor data.
            .file_name(media_type.upload_filename())
            .mime_str(media_type.content_type())
            .map_err(|_| CourseError::BadRequest("reception sheet file type is invalid"))?;
        let response: FieldReceptionFormProposal = super::field_gateway::field_send_multipart(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/membership/reception-fields/analysis",
            credentials,
            reqwest::multipart::Form::new().part("file", part),
        )
        .await?;
        Ok(map_form_proposal(credentials.operator_id, response))
    }
}

/// The blank-form analyzer's built-in vocabulary is wider than CourseBoard's
/// reception model. Keep this adapter explicit so Field-only concepts (for
/// example a subject or a plan) cannot accidentally become golf settings.
const FIELD_STANDARD_TO_COURSE: &[(&str, &str)] = &[
    ("customer_name_kana", "name_kana"),
    ("customer_email", "email"),
    ("customer_phone", "phone"),
    ("customer_birth_date", "birth_date"),
    ("customer_sex", "sex"),
    ("customer_address", "address"),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldReceptionFormProposal {
    #[serde(default)]
    fields: Vec<FieldProposedReceptionField>,
    #[serde(default)]
    custom_fields: Vec<FieldProposedCustomField>,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    preview_image: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldProposedReceptionField {
    #[serde(default)]
    field_key: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    required: bool,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldProposedCustomField {
    #[serde(default)]
    entity_type: String,
    #[serde(default)]
    field_key: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    field_type: String,
    #[serde(default)]
    required: bool,
    #[serde(default)]
    options: Vec<String>,
}

fn map_form_proposal(
    tenant_id: &str,
    response: FieldReceptionFormProposal,
) -> ReceptionFormProposal {
    // Keep CourseBoard's fixed name row in the proposal even though Field's
    // analyzer intentionally omits it. This gives the settings UI the same
    // current DTO shape as GET while still preventing upstream from changing
    // the invariant.
    let mut fields = CustomerReceptionField::default_for(tenant_id, "name")
        .into_iter()
        .collect::<Vec<_>>();
    let mut seen_keys: HashSet<String> = HashSet::new();
    seen_keys.insert("name".to_string());
    let mut warnings = response.warnings;

    for proposed in response.fields {
        let field_key = proposed.field_key.trim();
        let display_label = proposed
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .unwrap_or(field_key);
        // Field deliberately omits the applicant's name, but keep this guard
        // in case an older/newer Field version sends it back. CourseBoard's
        // name is an invariant and must never be changed by analysis.
        if matches!(field_key, "customer_name" | "name") {
            continue;
        }
        let Some(course_key) = map_standard_field_key(field_key) else {
            // Field returns its complete built-in table, including disabled
            // keys that were not found on this form. Only an enabled
            // unsupported key is a proposal that needs an operator warning;
            // otherwise every analysis would warn about all Field-only
            // subject/plan columns even when the paper has none.
            if proposed.enabled && !display_label.is_empty() {
                warnings.push(unsupported_analysis_warning(display_label));
            }
            continue;
        };
        if !seen_keys.insert(course_key.to_string()) {
            warnings.push(duplicate_analysis_warning(course_key));
            continue;
        }
        let Some(mut field) = CustomerReceptionField::default_for(tenant_id, course_key) else {
            // Keep the adapter fail-closed if a standard is added to the
            // mapping before the local model receives its default definition.
            warnings.push(unsupported_analysis_warning(display_label));
            continue;
        };
        field.enabled = proposed.enabled;
        field.required = proposed.enabled && proposed.required;
        if let Some(label) = proposed
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
        {
            if label.chars().count() <= crate::course::domain::MAX_RECEPTION_FIELD_LABEL_LENGTH {
                field.label = Some(label.to_string());
            } else {
                warnings.push(format!(
                    "「{label}」は受付票項目名が長すぎるため、標準の呼称を使います。"
                ));
            }
        }
        fields.push(field);
    }

    let custom_sort_start = STANDARD_RECEPTION_FIELD_KEYS.len() as i32;
    for (index, proposed) in response.custom_fields.into_iter().enumerate() {
        let label = proposal_label(&proposed.label, &proposed.field_key);
        if proposed.entity_type.trim() != "consumer" {
            warnings.push(unsupported_analysis_warning(&label));
            continue;
        }
        let Some(field_type) = map_custom_field_type(proposed.field_type.trim()) else {
            warnings.push(unsupported_analysis_warning(&label));
            continue;
        };
        let key = proposed.field_key.trim();
        // Keep Field's customer namespace reserved for its standard columns;
        // a custom suggestion using that prefix would be rejected by the UI
        // and could shadow a future standard key.
        if key.is_empty() || key.starts_with("customer_") {
            warnings.push(unsupported_analysis_warning(&label));
            continue;
        }
        if !seen_keys.insert(key.to_string()) {
            warnings.push(duplicate_analysis_warning(key));
            continue;
        }
        let input = ReceptionFieldInput {
            field_key: key.to_string(),
            kind: ReceptionFieldKind::Custom,
            field_type,
            enabled: true,
            required: proposed.required,
            label: (!proposed.label.trim().is_empty()).then(|| proposed.label.clone()),
            sort_order: custom_sort_start.saturating_add(index as i32),
            options: proposed.options,
        };
        match CustomerReceptionField::try_new(tenant_id, input) {
            Ok(field) => fields.push(field),
            Err(_) => warnings.push(unsupported_analysis_warning(&label)),
        }
    }

    fields.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.field_key.cmp(&right.field_key))
    });
    ReceptionFormProposal {
        fields,
        warnings,
        preview_image: response.preview_image,
    }
}

fn map_standard_field_key(field_key: &str) -> Option<&'static str> {
    FIELD_STANDARD_TO_COURSE
        .iter()
        .find_map(|(field, course)| (*field == field_key).then_some(*course))
}

fn map_custom_field_type(field_type: &str) -> Option<ReceptionFieldType> {
    match field_type {
        "text" => Some(ReceptionFieldType::Text),
        "date" => Some(ReceptionFieldType::Date),
        "select" => Some(ReceptionFieldType::Select),
        "boolean" => Some(ReceptionFieldType::Boolean),
        _ => None,
    }
}

fn proposal_label(label: &str, field_key: &str) -> String {
    let label = label.trim();
    if label.is_empty() {
        field_key.trim().to_string()
    } else {
        label.to_string()
    }
}

fn unsupported_analysis_warning(label: &str) -> String {
    format!(
        "「{}」はCourseBoardの受付票項目として保存できないため、取り込みません。",
        proposal_label(label, "この項目")
    )
}

fn duplicate_analysis_warning(key: &str) -> String {
    format!(
        "「{}」は受付票項目として重複しているため、最初の候補だけ取り込みます。",
        proposal_label(key, "この項目")
    )
}

/// Separates "the reader was not available" from everything else Field can
/// refuse with.
///
/// Until PLT-4033 Field answered an upstream OCR failure with 200, an empty
/// draft and the same warning a blurry photo gets, so a desk whose provider
/// had run out of credit re-photographed a sheet nothing was wrong with. Field
/// now answers 402 / 429 / 503 for that, and this is what stops the reason
/// from being flattened back into a generic upstream error on the way to the
/// screen.
///
/// Field's message is deliberately not carried across. It is English written
/// for a Field operator, and the desk's copy is the screen's to write; the
/// class is all that has to survive. Nor is the provider's own body ever
/// available to carry — Field does not copy it, because it can echo the
/// document that was read.
fn reader_failure(failure: &FieldStatusFailure<'_>) -> Option<CourseError> {
    ReceptionReaderFailure::classify(failure.status.as_u16(), failure.code.as_deref())
        .map(CourseError::ReceptionReaderFailed)
}

/// Field's draft shape. `fields` is keyed by the schema's own keys: a rows
/// field comes back as an array of objects, a scalar as a string or null.
///
/// Values stay untyped here because an unreadable document is answered by
/// echoing every schema key with an empty value — `null` where this gateway
/// asked for rows. That is a normal answer with warnings attached, not a
/// decoding failure, and a stricter type would turn it into a 424.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldGenericOcrDraft {
    #[serde(default)]
    fields: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    warnings: Vec<String>,
}

fn map_draft(response: FieldGenericOcrDraft, fields: &[CustomerReceptionField]) -> ReceptionDraft {
    let rows = response
        .fields
        .get(RECEPTION_ROWS_KEY)
        .and_then(serde_json::Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    let draft = ReceptionDraftRow::new(
                        column(row, RECEPTION_ROW_NAME),
                        column(row, RECEPTION_ROW_NAME_KANA),
                        column(row, RECEPTION_ROW_PHONE),
                        column(row, RECEPTION_ROW_EMAIL),
                    )
                    .with_configured_fields(fields, row);
                    RECEPTION_CONSENTS.iter().fold(draft, |draft, consent| {
                        draft.with_consent_tick(consent.key, tick_column(row, consent.key))
                    })
                })
                .collect()
        })
        // A reader that answered with no rows at all is not an error: the
        // warnings say why, and the desk types the group in beside the scan.
        .unwrap_or_default();
    ReceptionDraft::new(rows, response.warnings)
}

fn column(row: &serde_json::Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

/// A tick box as the reader answered it.
///
/// Field validates `boolean` columns and drops anything it cannot resolve, so
/// a real answer arrives as a JSON boolean. It is also read as the strings
/// `"true"` / `"false"`, because that is the wire form the reader is prompted
/// with and a stricter reading here would turn a correct answer into an unread
/// box. Anything else — an empty string for a box that was never inked, a
/// stray 「✓」 — stays `None`, which the desk sees as a question.
fn tick_column(row: &serde_json::Value, key: &str) -> Option<bool> {
    match row.get(key)? {
        serde_json::Value::Bool(ticked) => Some(*ticked),
        serde_json::Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::field_gateway::field_error_code;
    use super::*;
    use crate::course::domain::{
        CONSENT_ANTISOCIAL_AND_COURSE_TERMS, CONSENT_CART_TERMS, CONSENT_MARKETING_CONTACT,
    };

    fn draft_from(json: serde_json::Value) -> ReceptionDraft {
        map_draft(
            serde_json::from_value(json).expect("field draft shape"),
            &crate::course::domain::CustomerReceptionField::merge_with_defaults(
                "test-tenant",
                Vec::new(),
            ),
        )
    }

    fn draft_from_with_fields(
        json: serde_json::Value,
        fields: &[CustomerReceptionField],
    ) -> ReceptionDraft {
        map_draft(
            serde_json::from_value(json).expect("field draft shape"),
            fields,
        )
    }

    #[test]
    fn blank_form_standard_fields_are_mapped_to_courseboard_keys() {
        let proposal = map_form_proposal(
            "test-tenant",
            serde_json::from_value(serde_json::json!({
                "fields": [
                    { "fieldKey": "customer_name_kana", "enabled": true, "required": true, "label": "フリガナ" },
                    { "fieldKey": "customer_phone", "enabled": true, "required": false, "label": "連絡先" },
                    { "fieldKey": "customer_email", "enabled": false, "required": true, "label": null },
                    { "fieldKey": "customer_birth_date", "enabled": true, "required": false, "label": "生年月日" },
                    { "fieldKey": "customer_sex", "enabled": true, "required": false, "label": "性別" },
                    { "fieldKey": "customer_address", "enabled": true, "required": true, "label": "住所" },
                    { "fieldKey": "subject_name", "enabled": true, "required": false, "label": "ペット名" }
                ],
                "warnings": [],
                "previewImage": "data:image/jpeg;base64,abc"
            }))
            .expect("field proposal shape"),
        );

        let field = |key: &str| {
            proposal
                .fields
                .iter()
                .find(|field| field.field_key == key)
                .unwrap_or_else(|| panic!("missing {key}"))
        };
        assert!(field("name_kana").enabled);
        assert!(field("name_kana").required);
        assert_eq!(field("name_kana").effective_label(), "フリガナ");
        assert_eq!(field("phone").effective_label(), "連絡先");
        assert!(!field("email").enabled);
        // A disabled upstream field cannot become required locally.
        assert!(!field("email").required);
        assert!(field("address").required);
        assert!(proposal
            .warnings
            .iter()
            .any(|warning| warning.contains("ペット名")));
        assert_eq!(
            proposal.preview_image.as_deref(),
            Some("data:image/jpeg;base64,abc")
        );
        // Field never owns CourseBoard's fixed name setting; the adapter
        // returns it unchanged for the UI's complete settings shape.
        let name = field("name");
        assert!(name.enabled);
        assert!(name.required);
    }

    #[test]
    fn consumer_custom_fields_are_validated_and_subject_or_number_fields_warn() {
        let proposal = map_form_proposal(
            "test-tenant",
            serde_json::from_value(serde_json::json!({
                "fields": [],
                "customFields": [
                    {
                        "entityType": "consumer",
                        "fieldKey": "membership_type",
                        "label": "会員区分",
                        "fieldType": "select",
                        "required": true,
                        "options": ["正会員", "平日会員"]
                    },
                    {
                        "entityType": "consumer",
                        "fieldKey": "birthday_number",
                        "label": "受付番号",
                        "fieldType": "number",
                        "required": false,
                        "options": []
                    },
                    {
                        "entityType": "customer_subject",
                        "fieldKey": "breed",
                        "label": "犬種",
                        "fieldType": "text",
                        "required": false,
                        "options": []
                    }
                ],
                "warnings": ["原本を確認してください。"]
            }))
            .expect("field proposal shape"),
        );

        let custom = proposal
            .fields
            .iter()
            .find(|field| field.field_key == "membership_type")
            .expect("consumer custom field is mapped");
        assert_eq!(custom.kind, ReceptionFieldKind::Custom);
        assert_eq!(custom.field_type, ReceptionFieldType::Select);
        assert!(custom.enabled);
        assert!(custom.required);
        assert_eq!(custom.options, ["正会員", "平日会員"]);
        assert_eq!(custom.effective_label(), "会員区分");
        assert!(proposal
            .warnings
            .iter()
            .any(|warning| warning.contains("受付番号")));
        assert!(proposal
            .warnings
            .iter()
            .any(|warning| warning.contains("犬種")));
        assert!(proposal
            .warnings
            .iter()
            .any(|warning| warning == "原本を確認してください。"));
    }

    #[test]
    fn a_read_group_becomes_rows_in_sheet_order() {
        let draft = draft_from(serde_json::json!({
            "fields": {
                "visitors": [
                    {
                        "name": "本田 康彦",
                        "name_kana": "ホンダ ヤスヒコ",
                        "phone": "090-1234-5678",
                        "email": "honda@example.com"
                    },
                    { "name": "西村 隆", "name_kana": null, "phone": null, "email": null }
                ]
            },
            "manualApprovalRequired": true,
            "warnings": []
        }));
        assert_eq!(draft.rows().len(), 2);
        assert_eq!(draft.rows()[0].name(), Some("本田 康彦"));
        assert_eq!(draft.rows()[0].email(), Some("honda@example.com"));
        assert_eq!(draft.rows()[1].name(), Some("西村 隆"));
        assert_eq!(draft.rows()[1].phone(), None);
    }

    #[test]
    fn custom_values_follow_the_fields_visitors_entity_and_row_keys() {
        let custom = CustomerReceptionField::try_new(
            "test-tenant",
            crate::course::domain::ReceptionFieldInput {
                field_key: "membership_type".to_string(),
                kind: crate::course::domain::ReceptionFieldKind::Custom,
                field_type: crate::course::domain::ReceptionFieldType::Select,
                enabled: true,
                required: false,
                label: Some("会員区分".to_string()),
                sort_order: 7,
                options: vec!["正会員".to_string(), "平日会員".to_string()],
            },
        )
        .unwrap();
        let boolean = CustomerReceptionField::try_new(
            "test-tenant",
            crate::course::domain::ReceptionFieldInput {
                field_key: "cart_required".to_string(),
                kind: crate::course::domain::ReceptionFieldKind::Custom,
                field_type: crate::course::domain::ReceptionFieldType::Boolean,
                enabled: true,
                required: false,
                label: Some("カート利用".to_string()),
                sort_order: 8,
                options: Vec::new(),
            },
        )
        .unwrap();
        let fields = CustomerReceptionField::merge_with_defaults("test-tenant", [custom, boolean]);
        let draft = draft_from_with_fields(
            serde_json::json!({
                "fields": {
                    "visitors": [{
                        "name": "本田 康彦",
                        "membership_type": "正会員",
                        "cart_required": false
                    }]
                },
                "warnings": []
            }),
            &fields,
        );
        assert_eq!(draft.rows()[0].name(), Some("本田 康彦"));
        assert_eq!(draft.rows()[0].custom_fields()["membership_type"], "正会員");
        assert_eq!(draft.rows()[0].custom_fields()["cart_required"], false);
    }

    fn accepted(draft: &ReceptionDraft, row: usize, key: &str) -> Option<bool> {
        draft.rows()[row]
            .consents()
            .iter()
            .find(|answer| answer.key == key)
            .unwrap_or_else(|| panic!("{key} is missing from the row"))
            .accepted
    }

    /// The declaration reads straight through, but the marketing box does not:
    /// the paper says 「不要の場合はチェック」, so a tick has to reach Field as a
    /// refusal. Recording it as printed would mail the people who opted out.
    #[test]
    fn the_opt_out_box_is_stored_the_other_way_round() {
        let draft = draft_from(serde_json::json!({
            "fields": {
                "visitors": [{
                    "name": "本田 康彦",
                    "golf_antisocial_and_course_terms": true,
                    "golf_cart_terms": false,
                    "golf_marketing_contact": true
                }]
            },
            "manualApprovalRequired": true,
            "warnings": []
        }));
        assert_eq!(
            accepted(&draft, 0, CONSENT_ANTISOCIAL_AND_COURSE_TERMS),
            Some(true)
        );
        assert_eq!(accepted(&draft, 0, CONSENT_CART_TERMS), Some(false));
        assert_eq!(accepted(&draft, 0, CONSENT_MARKETING_CONTACT), Some(false));
        assert!(draft.rows()[0].has_required_consents());
    }

    /// The reader is prompted to answer `"true"` / `"false"`, and Field passes
    /// that through for `boolean` columns. Reading only JSON booleans here
    /// would turn a correct answer into an unread box.
    #[test]
    fn a_tick_answered_as_text_still_counts() {
        let draft = draft_from(serde_json::json!({
            "fields": {
                "visitors": [{
                    "name": "本田 康彦",
                    "golf_antisocial_and_course_terms": "TRUE",
                    "golf_marketing_contact": "false"
                }]
            },
            "manualApprovalRequired": true,
            "warnings": []
        }));
        assert_eq!(
            accepted(&draft, 0, CONSENT_ANTISOCIAL_AND_COURSE_TERMS),
            Some(true)
        );
        assert_eq!(accepted(&draft, 0, CONSENT_MARKETING_CONTACT), Some(true));
    }

    /// A box the reader could not make out is a question for the desk, not a
    /// refusal. Filed as `false`, the required declaration would look like the
    /// visitor declined rather than like the copy was faint.
    #[test]
    fn a_box_the_reader_could_not_make_out_stays_unanswered() {
        let draft = draft_from(serde_json::json!({
            "fields": {
                "visitors": [{
                    "name": "本田 康彦",
                    "golf_antisocial_and_course_terms": "",
                    "golf_cart_terms": "✓"
                }]
            },
            "manualApprovalRequired": true,
            "warnings": []
        }));
        assert_eq!(
            accepted(&draft, 0, CONSENT_ANTISOCIAL_AND_COURSE_TERMS),
            None
        );
        assert_eq!(accepted(&draft, 0, CONSENT_CART_TERMS), None);
        assert!(!draft.rows()[0].has_required_consents());
    }

    /// A sheet without any consent columns — an older format, or a read that
    /// lost them — still yields rows, with every box open for the desk.
    #[test]
    fn a_sheet_with_no_boxes_read_still_lists_every_consent() {
        let draft = draft_from(serde_json::json!({
            "fields": { "visitors": [{ "name": "本田 康彦" }] },
            "manualApprovalRequired": true,
            "warnings": []
        }));
        assert_eq!(draft.rows()[0].consents().len(), RECEPTION_CONSENTS.len());
        assert!(draft.rows()[0]
            .consents()
            .iter()
            .all(|answer| answer.accepted.is_none()));
        assert!(!draft.rows()[0].has_required_consents());
    }

    #[test]
    fn a_column_the_reader_could_not_make_out_is_absent_not_blank() {
        let draft = draft_from(serde_json::json!({
            "fields": { "visitors": [{ "name": "本田 康彦", "phone": "   " }] },
            "manualApprovalRequired": true,
            "warnings": []
        }));
        assert_eq!(draft.rows()[0].phone(), None);
        assert_eq!(draft.rows()[0].name_kana(), None);
    }

    #[test]
    fn warnings_survive_so_the_desk_is_told_to_check_the_original() {
        let draft = draft_from(serde_json::json!({
            "fields": { "visitors": [] },
            "manualApprovalRequired": true,
            "warnings": ["読み取れない項目があります。"]
        }));
        assert!(draft.rows().is_empty());
        assert_eq!(draft.warnings(), ["読み取れない項目があります。"]);
    }

    #[test]
    fn an_unreadable_sheet_comes_back_as_scalars_and_still_decodes() {
        // Field answers an unavailable reader by echoing the schema keys with
        // empty values; for a rows field that is `[]`, but a scalar `null` has
        // to decode too rather than failing the whole response.
        let draft = draft_from(serde_json::json!({
            "fields": { "visitors": null },
            "manualApprovalRequired": true,
            "warnings": ["書類を読み取れませんでした。"]
        }));
        assert!(draft.rows().is_empty());
        assert_eq!(draft.warnings().len(), 1);
    }

    fn failure_for(status: u16, body: &str) -> Option<CourseError> {
        reader_failure(&FieldStatusFailure {
            status: reqwest::StatusCode::from_u16(status).unwrap(),
            code: field_error_code(body),
            body,
        })
    }

    /// The incident this whole path exists for: upstream billing lapses, and
    /// the desk must be told to go to the billing screen rather than back to
    /// the scanner.
    #[test]
    fn an_upstream_that_is_out_of_credit_is_a_billing_failure_not_a_bad_scan() {
        let failure = failure_for(
            402,
            r#"{"code":"PAYMENT_REQUIRED","message":"document extraction is unavailable until upstream billing is linked and funded"}"#,
        );
        assert!(matches!(
            failure,
            Some(CourseError::ReceptionReaderFailed(
                ReceptionReaderFailure::BillingUnsatisfied
            ))
        ));
    }

    #[test]
    fn a_rate_limited_reader_is_the_one_the_desk_can_answer_by_waiting() {
        let failure = failure_for(
            429,
            r#"{"code":"TOO_MANY_REQUESTS","message":"document extraction is rate limited upstream"}"#,
        );
        assert!(matches!(
            failure,
            Some(CourseError::ReceptionReaderFailed(
                ReceptionReaderFailure::RateLimited
            ))
        ));
    }

    /// Field folds an upstream 401/403/5xx into its own 503 rather than
    /// forwarding it, so that whole family arrives here as one class.
    #[test]
    fn a_reader_that_is_down_arrives_as_one_class_however_it_failed() {
        let failure = failure_for(
            503,
            r#"{"code":"SERVICE_UNAVAILABLE","message":"document extraction upstream is unreachable"}"#,
        );
        assert!(matches!(
            failure,
            Some(CourseError::ReceptionReaderFailed(
                ReceptionReaderFailure::Unavailable
            ))
        ));
    }

    /// A refusal that is about this request, not the reader. Claiming it would
    /// send the desk to check a billing screen over a bug on this side.
    #[test]
    fn a_request_field_rejected_is_left_to_the_shared_mapping() {
        assert!(failure_for(
            400,
            r#"{"code":"BAD_REQUEST","message":"schema is invalid"}"#
        )
        .is_none());
        assert!(failure_for(401, r#"{"code":"UNAUTHORIZED","message":"token expired"}"#).is_none());
        assert!(failure_for(413, "").is_none());
    }

    /// The whole path, over a real socket: Field's status and `code` have to
    /// survive the send helper to reach the classifier at all. The unit tests
    /// above pin what the classifier decides; this pins that it is asked.
    #[tokio::test]
    async fn a_field_402_reaches_the_desk_as_a_billing_failure_not_a_provider_error() {
        use axum::{routing::post, Json, Router};

        let app = Router::new().route(
            "/v1/field/ocr/consumer/draft",
            post(|| async {
                (
                    axum::http::StatusCode::PAYMENT_REQUIRED,
                    Json(serde_json::json!({
                        "code": "PAYMENT_REQUIRED",
                        "message": "Insufficient balance. Required: $0.003861, Available: $0",
                    })),
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock Field");
        let address = listener.local_addr().expect("mock Field address");
        tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve mock Field");
        });

        let gateway = FieldCustomerReceptionGateway::new(
            reqwest::Client::new(),
            Some(&format!("http://{address}")),
        );
        let error = gateway
            .draft_reception(
                GatewayCredentials {
                    authorization: "Bearer test-token",
                    operator_id: "operator-test",
                    platform_id: Some("platform-test"),
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                ReceptionSheet::try_new(vec![0xff, 0xd8, 0xff, 0x00], "image/jpeg").expect("sheet"),
                &crate::course::domain::CustomerReceptionField::merge_with_defaults(
                    "operator-test",
                    Vec::new(),
                ),
            )
            .await
            .expect_err("an unpaid reader cannot draft");

        assert!(matches!(
            error,
            CourseError::ReceptionReaderFailed(ReceptionReaderFailure::BillingUnsatisfied)
        ));
        // Upstream's own words never cross. This one is real: the same
        // PAYMENT_REQUIRED arrives both as an exhausted balance and as an
        // unlinked account, in English written for whoever holds the provider
        // contract. The desk needs to be sent to the same billing screen
        // either way, and the sentence that does that is the screen's to
        // write.
        assert!(!error.to_string().contains("Insufficient balance"));
        assert!(!error.to_string().contains("$0.003861"));
    }

    #[test]
    fn the_schema_sent_upstream_is_the_golf_reception_sheet() {
        let schema = serde_json::to_value(crate::course::domain::reception_sheet_schema()).unwrap();
        assert_eq!(schema[0]["key"], RECEPTION_ROWS_KEY);
        assert_eq!(schema[0]["itemFields"][0]["key"], RECEPTION_ROW_NAME);
    }
}
