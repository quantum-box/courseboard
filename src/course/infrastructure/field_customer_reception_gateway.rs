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

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::Deserialize;

use crate::course::domain::{
    reception_sheet_schema, CourseError, CustomerReceptionOcrGateway, GatewayCredentials,
    ReceptionDraft, ReceptionDraftRow, ReceptionSheet, RECEPTION_OCR_ENTITY_KEY,
    RECEPTION_ROWS_KEY, RECEPTION_ROW_EMAIL, RECEPTION_ROW_NAME, RECEPTION_ROW_NAME_KANA,
    RECEPTION_ROW_PHONE,
};

use super::field_gateway::{field_send_multipart, normalize_base_url, urlencoding_path};

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
    ) -> Result<ReceptionDraft, CourseError> {
        let schema = serde_json::to_string(&reception_sheet_schema()).map_err(|_| {
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
        let response: FieldGenericOcrDraft = field_send_multipart(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            form,
        )
        .await?;
        Ok(map_draft(response))
    }
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

fn map_draft(response: FieldGenericOcrDraft) -> ReceptionDraft {
    let rows = response
        .fields
        .get(RECEPTION_ROWS_KEY)
        .and_then(serde_json::Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    ReceptionDraftRow::new(
                        column(row, RECEPTION_ROW_NAME),
                        column(row, RECEPTION_ROW_NAME_KANA),
                        column(row, RECEPTION_ROW_PHONE),
                        column(row, RECEPTION_ROW_EMAIL),
                    )
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

#[cfg(test)]
mod tests {
    use super::*;

    fn draft_from(json: serde_json::Value) -> ReceptionDraft {
        map_draft(serde_json::from_value(json).expect("field draft shape"))
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

    #[test]
    fn the_schema_sent_upstream_is_the_golf_reception_sheet() {
        let schema = serde_json::to_value(reception_sheet_schema()).unwrap();
        assert_eq!(schema[0]["key"], RECEPTION_ROWS_KEY);
        assert_eq!(schema[0]["itemFields"][0]["key"], RECEPTION_ROW_NAME);
    }
}
