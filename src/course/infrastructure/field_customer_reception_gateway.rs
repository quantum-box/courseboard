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
    ReceptionDraft, ReceptionDraftRow, ReceptionReaderFailure, ReceptionSheet,
    RECEPTION_OCR_ENTITY_KEY, RECEPTION_ROWS_KEY, RECEPTION_ROW_EMAIL, RECEPTION_ROW_NAME,
    RECEPTION_ROW_NAME_KANA, RECEPTION_ROW_PHONE,
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
        Ok(map_draft(response))
    }
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
    use super::super::field_gateway::field_error_code;
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
        let schema = serde_json::to_value(reception_sheet_schema()).unwrap();
        assert_eq!(schema[0]["key"], RECEPTION_ROWS_KEY);
        assert_eq!(schema[0]["itemFields"][0]["key"], RECEPTION_ROW_NAME);
    }
}
