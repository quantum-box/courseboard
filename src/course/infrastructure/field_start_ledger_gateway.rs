//! Field generic-OCR jobs for the start ledger PDF.
//!
//! Same job protocol as the reception sheet (create → Storage PUT → confirm →
//! advance until completed), but under its own entity key and with the
//! schema from [`start_ledger_schema`]. Field reads each PDF page with
//! Tachyon AI OCR against that schema and appends the rows; CourseBoard
//! never sees the bytes.

use chrono::NaiveDate;

use crate::course::domain::{
    player_column, start_ledger_schema, CourseError, GatewayCredentials, ReceptionOcrJobSheet,
    ReceptionOcrJobSheets, ReceptionOcrJobStatus, ReceptionOcrJobUpload, StartLedgerDraft,
    StartLedgerOcrGateway, StartLedgerOcrJob, StartLedgerOcrJobCreated, StartLedgerOcrStep,
    StartLedgerRow, StartLedgerRowPlayer, COLUMN_COURSE, COLUMN_GROUP_NAME, COLUMN_PLAN,
    COLUMN_PLAY_STYLE, COLUMN_REMARKS, COLUMN_REPRESENTATIVE, COLUMN_TEE_TIME,
    START_LEDGER_DATE_KEY, START_LEDGER_OCR_ENTITY_KEY, START_LEDGER_PARTIES_KEY,
    START_LEDGER_PLAYER_COLUMNS,
};

use super::field_customer_reception_gateway::{
    reader_failure, reception_job_step_timeout, FieldCreateOcrJobResponse, FieldGenericOcrDraft,
    FieldOcrJobResponse,
};
use super::field_gateway::{
    field_send_json_classified, field_send_json_classified_with_timeout, normalize_base_url,
    urlencoding_path,
};

pub struct FieldStartLedgerGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldStartLedgerGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }

    fn job_path(job_id: &str) -> String {
        format!(
            "/v1/field/ocr/{}/jobs/{}",
            urlencoding_path(START_LEDGER_OCR_ENTITY_KEY),
            urlencoding_path(job_id)
        )
    }

    async fn send(
        &self,
        credentials: GatewayCredentials<'_>,
        method: reqwest::Method,
        path: &str,
    ) -> Result<StartLedgerOcrJob, CourseError> {
        let response: FieldOcrJobResponse = field_send_json_classified(
            &self.client,
            &self.base_url,
            method,
            path,
            credentials,
            None,
            reader_failure,
        )
        .await?;
        map_job(response)
    }
}

#[async_trait::async_trait]
impl StartLedgerOcrGateway for FieldStartLedgerGateway {
    async fn create_job(
        &self,
        credentials: GatewayCredentials<'_>,
        idempotency_key: &str,
        sheets: &ReceptionOcrJobSheets,
    ) -> Result<StartLedgerOcrJobCreated, CourseError> {
        // No `sourceApp`: that switches on reception page metering, which
        // Field only accepts for the reception schema.
        let body = serde_json::json!({
            "idempotencyKey": idempotency_key,
            "schema": start_ledger_schema(),
            "documents": sheets
                .iter()
                .map(|sheet: &ReceptionOcrJobSheet| serde_json::json!({
                    "contentType": sheet.content_type(),
                    "size": sheet.size(),
                    "sha256": sheet.sha256(),
                }))
                .collect::<Vec<_>>(),
        });
        let path = format!(
            "/v1/field/ocr/{}/jobs",
            urlencoding_path(START_LEDGER_OCR_ENTITY_KEY)
        );
        let response: FieldCreateOcrJobResponse = field_send_json_classified(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            Some(&body),
            reader_failure,
        )
        .await?;
        Ok(StartLedgerOcrJobCreated {
            job: map_job(response.job)?,
            uploads: response
                .uploads
                .into_iter()
                .map(|upload| ReceptionOcrJobUpload {
                    storage_key: upload.storage_key,
                    upload_url: upload.upload_url,
                    expires_at: upload.expires_at,
                })
                .collect(),
        })
    }

    async fn step_job(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
        step: StartLedgerOcrStep,
    ) -> Result<StartLedgerOcrJob, CourseError> {
        let path = format!("{}/{}", Self::job_path(job_id), step.as_str());
        let response: FieldOcrJobResponse = field_send_json_classified_with_timeout(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            None,
            reader_failure,
            reception_job_step_timeout(step.as_str()),
        )
        .await?;
        map_job(response)
    }

    async fn get_job(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<StartLedgerOcrJob, CourseError> {
        self.send(credentials, reqwest::Method::GET, &Self::job_path(job_id))
            .await
    }

    async fn cancel_job(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<StartLedgerOcrJob, CourseError> {
        self.send(
            credentials,
            reqwest::Method::DELETE,
            &Self::job_path(job_id),
        )
        .await
    }
}

fn map_job(response: FieldOcrJobResponse) -> Result<StartLedgerOcrJob, CourseError> {
    let status = ReceptionOcrJobStatus::parse(&response.status).ok_or_else(|| {
        CourseError::Provider(format!(
            "Field OCR job answered an unknown status {}",
            response.status
        ))
    })?;
    Ok(StartLedgerOcrJob {
        id: response.id,
        status,
        completed_units: response.completed_units,
        total_units: response.total_units,
        draft: map_draft(response.draft),
        failure_code: response.failure_code,
        expires_at: response.expires_at,
    })
}

/// An unreadable page echoes every key with null: that is an empty draft with
/// warnings, never a decoding failure.
fn map_draft(draft: FieldGenericOcrDraft) -> StartLedgerDraft {
    let date = draft
        .fields
        .get(START_LEDGER_DATE_KEY)
        .and_then(serde_json::Value::as_str)
        .and_then(|value| NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok());
    let rows = draft
        .fields
        .get(START_LEDGER_PARTIES_KEY)
        .and_then(serde_json::Value::as_array)
        .map(|rows| rows.iter().map(map_row).collect())
        .unwrap_or_default();
    StartLedgerDraft {
        date,
        rows,
        warnings: draft.warnings,
    }
}

fn map_row(row: &serde_json::Value) -> StartLedgerRow {
    let column = |key: &str| {
        row.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    StartLedgerRow {
        course: column(COLUMN_COURSE),
        tee_time: column(COLUMN_TEE_TIME),
        play_style: column(COLUMN_PLAY_STYLE),
        representative: column(COLUMN_REPRESENTATIVE),
        group_name: column(COLUMN_GROUP_NAME),
        players: (0..START_LEDGER_PLAYER_COLUMNS)
            .map(|index| StartLedgerRowPlayer {
                tag: column(&player_column(index, "Tag")),
                number: column(&player_column(index, "Number")),
                name: column(&player_column(index, "Name")),
            })
            .collect(),
        plan: column(COLUMN_PLAN),
        remarks: column(COLUMN_REMARKS),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer token",
            operator_id: "tn_1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    #[test]
    fn a_read_maps_columns_and_the_printed_date() {
        let draft: FieldGenericOcrDraft = serde_json::from_value(serde_json::json!({
            "fields": {
                "date": "2026-11-07",
                "parties": [{
                    "course": "空沼OUT", "teeTime": "08:45", "playStyle": "キャディ",
                    "representative": "菊池 芳彦", "groupName": "菊池 芳彦 様",
                    "player1Tag": "共通", "player1Number": "1", "player1Name": "丹治 敦",
                    "plan": "早期予約133", "remarks": null
                }]
            },
            "warnings": ["読み取れない項目があります。"]
        }))
        .unwrap();
        let mapped = map_draft(draft);
        assert_eq!(mapped.date, NaiveDate::from_ymd_opt(2026, 11, 7));
        assert_eq!(mapped.rows.len(), 1);
        assert_eq!(mapped.rows[0].course.as_deref(), Some("空沼OUT"));
        assert_eq!(mapped.rows[0].players.len(), START_LEDGER_PLAYER_COLUMNS);
        assert_eq!(mapped.rows[0].players[0].name.as_deref(), Some("丹治 敦"));
        assert_eq!(mapped.rows[0].players[1], StartLedgerRowPlayer::default());
        assert_eq!(mapped.warnings.len(), 1);
    }

    #[test]
    fn an_unreadable_page_is_an_empty_draft() {
        let draft: FieldGenericOcrDraft = serde_json::from_value(
            serde_json::json!({"fields": {"date": null, "parties": null}, "warnings": []}),
        )
        .unwrap();
        let mapped = map_draft(draft);
        assert_eq!(mapped.date, None);
        assert!(mapped.rows.is_empty());
    }

    #[tokio::test]
    async fn create_sends_the_ledger_schema_under_its_own_entity_without_reception_metering() {
        let app = Router::new().route(
            "/v1/field/ocr/courseboardStartLedger/jobs",
            post(|Json(body): Json<serde_json::Value>| async move {
                assert!(body.get("sourceApp").is_none());
                assert_eq!(body["schema"][1]["key"], "parties");
                assert_eq!(body["documents"][0]["contentType"], "application/pdf");
                Json(serde_json::json!({
                    "id": "ocr_1", "status": "uploading",
                    "uploads": [{"storageKey": "k", "uploadUrl": "https://storage/put", "expiresAt": "2026-11-07T00:00:00Z"}]
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let gateway = FieldStartLedgerGateway::new(
            reqwest::Client::new(),
            Some(&format!("http://{address}")),
        );
        let sheets = ReceptionOcrJobSheets::try_new(vec![ReceptionOcrJobSheet::try_new(
            "application/pdf",
            10,
        )
        .unwrap()])
        .unwrap();
        let created = gateway
            .create_job(credentials(), "key-1", &sheets)
            .await
            .unwrap();
        assert_eq!(created.job.id, "ocr_1");
        assert_eq!(created.job.status, ReceptionOcrJobStatus::Uploading);
        assert_eq!(created.uploads[0].upload_url, "https://storage/put");
    }
}
