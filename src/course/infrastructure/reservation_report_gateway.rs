//! Field extension-config gateway for daily reservation-count snapshots.
//!
//! Field's extension-config contract has no `store` scope. Reports are kept in
//! the tenant config and partitioned by CourseBoard course id inside the
//! extension-owned JSON object.

use std::collections::BTreeMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::field_gateway::{
    field_send_json, field_send_multipart, field_send_unit, normalize_base_url, urlencoding_path,
};
use crate::course::domain::{
    Course, CourseError, ExternalReservationReportEntry, GatewayCredentials,
    ReservationReportAnalyzeGateway, ReservationReportDayPart, ReservationReportEntryQuery,
    ReservationReportGateway, ReservationReportUpsertSummary, TabularAnalyzeMapping,
    TabularAnalyzeMappingField, TabularAnalyzeResult, TabularAnalyzeRow,
    TABULAR_RESERVATION_REPORT_SOURCE,
};

const CONFIG_PATH: &str = "/v1/erp/extensions/golf_course/config";
const TABULAR_ANALYZE_PATH: &str = "/v1/erp/extensions/golf-course/tabular/analyze";
const REPORT_KEY: &str = "courseBoardReservationReport";
const COURSES_KEY: &str = "courses";
const ROWS_KEY: &str = "rows";

const TABULAR_TARGET_SCHEMA: &str = r#"[
  {
    "key":"facilityName",
    "description":"Golf course or facility name for this reservation-count row",
    "required":true,
    "aliases":["facility","facility_name","施設","施設名","コース","コース名"]
  },
  {
    "key":"date",
    "description":"Reservation date in the operator-selected year",
    "required":true,
    "aliases":["reservation_date","日付","予約日","営業日"]
  },
  {
    "key":"dayPart",
    "description":"Day part: morning or afternoon",
    "required":true,
    "aliases":["day_part","時間帯","午前午後","AMPM"]
  },
  {
    "key":"groupCount",
    "description":"Non-negative number of reserved groups",
    "required":true,
    "aliases":["group_count","組数","予約組数"]
  },
  {
    "key":"caddieAttachedGroupCount",
    "description":"Non-negative number of reserved groups with a caddie",
    "required":true,
    "aliases":["caddie_attached_group_count","キャディ付組数","キャディ付き組数","ｷｬ付組数"]
  }
]"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldTabularAnalyzeResponse {
    #[serde(default = "default_tabular_source_type")]
    source_type: String,
    #[serde(default)]
    sheet_names: Vec<String>,
    #[serde(default)]
    selected_sheet: Option<String>,
    #[serde(default)]
    header_row: Option<usize>,
    headers: Vec<String>,
    #[serde(default)]
    rows: Vec<FieldTabularAnalyzeRow>,
    mapping: FieldTabularAnalyzeMapping,
    #[serde(default)]
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldTabularAnalyzeRow {
    source_row_number: usize,
    #[serde(default)]
    values: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldTabularAnalyzeMapping {
    mode: String,
    #[serde(default)]
    fields: Vec<FieldTabularAnalyzeMappingField>,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldTabularAnalyzeMappingField {
    source: String,
    target: String,
    #[serde(default)]
    required: bool,
    #[serde(default)]
    confidence: f64,
    #[serde(default)]
    explanation: String,
    #[serde(default)]
    samples: Vec<Value>,
}

fn default_tabular_source_type() -> String {
    TABULAR_RESERVATION_REPORT_SOURCE.to_string()
}

pub struct FieldReservationReportGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldReservationReportGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }

    async fn read_scope_config(
        &self,
        credentials: GatewayCredentials<'_>,
        scope_type: &str,
        scope_id: Option<&str>,
    ) -> Result<Option<Value>, CourseError> {
        let mut path = format!("{CONFIG_PATH}?scopeType={}", urlencoding_path(scope_type));
        if let Some(scope_id) = scope_id {
            path.push_str("&scopeId=");
            path.push_str(&urlencoding_path(scope_id));
        }
        match field_send_json(
            &self.client,
            &self.base_url,
            Method::GET,
            &path,
            credentials,
            None,
        )
        .await
        {
            Ok(value) => Ok(Some(extract_config(value)?)),
            Err(CourseError::UpstreamClient { status: 404, .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn write_tenant_config(
        &self,
        credentials: GatewayCredentials<'_>,
        config: &Value,
    ) -> Result<(), CourseError> {
        let body = json!({
            "scopeType": "tenant",
            "configJson": config,
        });
        field_send_unit(
            &self.client,
            &self.base_url,
            Method::PATCH,
            CONFIG_PATH,
            credentials,
            Some(&body),
        )
        .await
    }
}

#[async_trait]
impl ReservationReportGateway for FieldReservationReportGateway {
    async fn upsert_entries(
        &self,
        credentials: GatewayCredentials<'_>,
        entries: &[ExternalReservationReportEntry],
        courses: &[Course],
    ) -> Result<ReservationReportUpsertSummary, CourseError> {
        if entries.is_empty() {
            return Err(CourseError::BadRequest(
                "reservation report contains no rows",
            ));
        }
        let mut grouped: BTreeMap<&str, Vec<&ExternalReservationReportEntry>> = BTreeMap::new();
        for entry in entries {
            grouped
                .entry(entry.golf_course_id().as_str())
                .or_default()
                .push(entry);
        }

        let source_keys: std::collections::HashSet<&str> = entries
            .iter()
            .map(|entry| entry.source_course_key())
            .collect();
        let current = self
            .read_scope_config(credentials, "tenant", None)
            .await?
            .unwrap_or_else(|| json!({}));
        let mut next = object_config(&current)?;
        let mut report_root = report_object(next.get(REPORT_KEY))?;
        let mut course_reports = report_root
            .remove(COURSES_KEY)
            .map(|value| {
                value.as_object().cloned().ok_or(CourseError::Provider(
                    "reservation report courses config is not an object".into(),
                ))
            })
            .transpose()?
            .unwrap_or_default();
        let mut summary = ReservationReportUpsertSummary::default();

        // Clean and rebuild every active course in memory, then commit the
        // tenant config once so a multi-course import cannot partially persist.
        for course in courses.iter().filter(|course| course.is_active()) {
            let golf_course_id = course.id().as_str();
            let target_entries = grouped.get(golf_course_id);
            let mut report = report_object(course_reports.get(golf_course_id))?;
            let mut row_map = report
                .remove(ROWS_KEY)
                .map(|rows| {
                    rows.as_object().cloned().ok_or(CourseError::Provider(
                        "reservation report rows config is not an object".into(),
                    ))
                })
                .transpose()?
                .unwrap_or_default();
            let original_row_map = row_map.clone();
            row_map.retain(|_, value| {
                !value
                    .get("sourceCourseKey")
                    .and_then(Value::as_str)
                    .is_some_and(|key| source_keys.contains(key))
            });

            let first_entry = target_entries.and_then(|entries| entries.first().copied());
            for entry in target_entries.into_iter().flatten() {
                let key = row_key(entry.date(), entry.day_part());
                let previous = original_row_map.get(&key).cloned();
                let unchanged = previous
                    .as_ref()
                    .map(|value| row_matches_entry(value, entry))
                    .unwrap_or(false);
                if unchanged {
                    summary.unchanged_count += 1;
                    row_map.insert(key, previous.expect("unchanged row exists"));
                    continue;
                }
                let updated_at = Utc::now();
                row_map.insert(key, entry_value(entry, updated_at));
                if previous.is_some() {
                    summary.updated_count += 1;
                } else {
                    summary.created_count += 1;
                }
            }
            if row_map != original_row_map {
                if let Some(first) = first_entry {
                    report.insert(
                        "sourceSystem".into(),
                        Value::String(first.source_system().into()),
                    );
                    report.insert(
                        "sourceCourseKey".into(),
                        Value::String(first.source_course_key().into()),
                    );
                    report.insert(
                        "sourceCourseName".into(),
                        Value::String(first.source_course_name().into()),
                    );
                    report.insert(
                        "sourceFileSha256".into(),
                        Value::String(first.source_file_sha256().into()),
                    );
                    report.insert("updatedAt".into(), Value::String(Utc::now().to_rfc3339()));
                }
            }
            report.insert(ROWS_KEY.into(), Value::Object(row_map));
            if report
                .get(ROWS_KEY)
                .and_then(Value::as_object)
                .is_some_and(Map::is_empty)
            {
                course_reports.remove(golf_course_id);
            } else {
                course_reports.insert(golf_course_id.to_string(), Value::Object(report));
            }
        }

        report_root.insert(COURSES_KEY.into(), Value::Object(course_reports));
        next.insert(REPORT_KEY.into(), Value::Object(report_root));
        let next = Value::Object(next);
        if next != current {
            self.write_tenant_config(credentials, &next).await?;
        }
        Ok(summary)
    }

    async fn list_entries(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: &[Course],
        query: ReservationReportEntryQuery,
    ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
        let query = query.validate()?;
        let config = self
            .read_scope_config(credentials, "tenant", None)
            .await?
            .unwrap_or_else(|| json!({}));
        let report_root = report_object(config.get(REPORT_KEY))?;
        let course_reports = match report_root.get(COURSES_KEY) {
            None | Some(Value::Null) => None,
            Some(Value::Object(reports)) => Some(reports),
            Some(_) => {
                return Err(CourseError::Provider(
                    "reservation report courses config is not an object".into(),
                ));
            }
        };
        let mut entries = Vec::new();
        for course in courses.iter().filter(|course| course.is_active()) {
            let Some(report) = course_reports.and_then(|reports| reports.get(course.id().as_str()))
            else {
                continue;
            };
            let Some(rows) = report.get(ROWS_KEY).and_then(Value::as_object) else {
                return Err(CourseError::Provider(
                    "reservation report rows config is not an object".into(),
                ));
            };
            for (key, value) in rows {
                let (date, day_part) = parse_row_key(key)?;
                if query.from.is_some_and(|from| date < from)
                    || query.to.is_some_and(|to| date > to)
                {
                    continue;
                }
                let source_course_key = required_string(value, "sourceCourseKey")?;
                let source_course_name = required_string(value, "sourceCourseName")?;
                let source_file_sha256 = required_string(value, "sourceFileSha256")?;
                let group_count = required_i64(value, "groupCount")?;
                let caddie_count = required_i64(value, "caddieAttachedGroupCount")?;
                let updated_at = value
                    .get("updatedAt")
                    .and_then(Value::as_str)
                    .and_then(|raw| raw.parse::<DateTime<Utc>>().ok());
                let entry = ExternalReservationReportEntry::reconstitute(
                    format!("{}:{key}", course.id()),
                    source_course_key,
                    source_course_name,
                    course.id().clone(),
                    date,
                    day_part,
                    group_count,
                    caddie_count,
                    source_file_sha256,
                    updated_at,
                )
                .map_err(|_| {
                    CourseError::Provider("reservation report row values are invalid".into())
                })?;
                entries.push(entry);
            }
        }
        entries.sort_by_key(|entry| {
            (
                entry.date(),
                entry.source_course_key().to_string(),
                entry.day_part().as_str().to_string(),
            )
        });
        Ok(entries)
    }
}

#[async_trait]
impl ReservationReportAnalyzeGateway for FieldReservationReportGateway {
    async fn analyze_tabular(
        &self,
        credentials: GatewayCredentials<'_>,
        bytes: &[u8],
        filename: Option<&str>,
        year: i32,
    ) -> Result<TabularAnalyzeResult, CourseError> {
        let filename = filename.unwrap_or("reservation-report");
        let content_type = match filename
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_ascii_lowercase())
            .as_deref()
        {
            Some("csv") => "text/csv",
            Some("xls") => "application/vnd.ms-excel",
            Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Some("pdf") => "application/pdf",
            _ => {
                return Err(CourseError::BadRequest(
                    "reservation report must be a csv, xls, xlsx, or pdf file",
                ))
            }
        };
        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name(filename.to_string())
            .mime_str(content_type)
            .map_err(|_| CourseError::BadRequest("reservation report file type is invalid"))?;
        let context = format!("CourseBoard daily reservation report. The operator selected year {year}. Map each row to facilityName, date, dayPart, groupCount, and caddieAttachedGroupCount. Preserve source rows and do not infer individual reservations.");
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("context", context)
            .text("targetSchema", TABULAR_TARGET_SCHEMA)
            .text("mappingMode", "auto");
        let response: FieldTabularAnalyzeResponse = field_send_multipart(
            &self.client,
            &self.base_url,
            Method::POST,
            TABULAR_ANALYZE_PATH,
            credentials,
            form,
        )
        .await?;
        let mapping_fields = response
            .mapping
            .fields
            .into_iter()
            .map(|field| {
                TabularAnalyzeMappingField::new(
                    field.source,
                    field.target,
                    field.required,
                    field.confidence,
                    field.explanation,
                    field.samples.into_iter().map(tabular_value_text).collect(),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mapping = TabularAnalyzeMapping::new(
            response.mapping.mode,
            mapping_fields,
            response.mapping.notes,
        )?;
        let rows = response
            .rows
            .into_iter()
            .map(|row| {
                TabularAnalyzeRow::new(
                    row.source_row_number,
                    row.values.into_iter().map(tabular_value_text).collect(),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        TabularAnalyzeResult::new(
            response.source_type,
            response.sheet_names,
            response.selected_sheet,
            response.header_row,
            response.headers,
            rows,
            mapping,
            response.warnings,
        )
    }
}

fn tabular_value_text(value: Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value,
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        other => serde_json::to_string(&other).unwrap_or_default(),
    }
}

fn extract_config(value: Value) -> Result<Value, CourseError> {
    let value = if let Some(config) = value.get("configJson") {
        config.clone()
    } else if let Some(items) = value.get("items").and_then(Value::as_array) {
        items
            .first()
            .and_then(|item| item.get("configJson"))
            .cloned()
            .unwrap_or_else(|| json!({}))
    } else {
        value
    };
    if value.is_null() {
        Ok(json!({}))
    } else if value.is_object() {
        Ok(value)
    } else {
        Err(CourseError::Provider(
            "Field extension config is not an object".into(),
        ))
    }
}

fn object_config(config: &Value) -> Result<Map<String, Value>, CourseError> {
    config.as_object().cloned().ok_or(CourseError::Provider(
        "Field extension config is not an object".into(),
    ))
}

fn report_object(value: Option<&Value>) -> Result<Map<String, Value>, CourseError> {
    match value {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(value)) => Ok(value.clone()),
        Some(_) => Err(CourseError::Provider(
            "reservation report config is not an object".into(),
        )),
    }
}

fn entry_value(entry: &ExternalReservationReportEntry, updated_at: DateTime<Utc>) -> Value {
    json!({
        "sourceSystem": entry.source_system(),
        "sourceCourseKey": entry.source_course_key(),
        "sourceCourseName": entry.source_course_name(),
        "golfCourseId": entry.golf_course_id().as_str(),
        "date": entry.date().to_string(),
        "dayPart": entry.day_part().as_str(),
        "groupCount": entry.group_count(),
        "caddieAttachedGroupCount": entry.caddie_attached_group_count(),
        "sourceFileSha256": entry.source_file_sha256(),
        "updatedAt": updated_at.to_rfc3339(),
    })
}

fn row_matches_entry(value: &Value, entry: &ExternalReservationReportEntry) -> bool {
    value.get("sourceSystem").and_then(Value::as_str) == Some(entry.source_system())
        && value.get("sourceCourseKey").and_then(Value::as_str) == Some(entry.source_course_key())
        && value.get("sourceCourseName").and_then(Value::as_str) == Some(entry.source_course_name())
        && value.get("golfCourseId").and_then(Value::as_str)
            == Some(entry.golf_course_id().as_str())
        && value.get("date").and_then(Value::as_str) == Some(entry.date().to_string().as_str())
        && value.get("dayPart").and_then(Value::as_str) == Some(entry.day_part().as_str())
        && value.get("groupCount").and_then(Value::as_i64) == Some(entry.group_count())
        && value
            .get("caddieAttachedGroupCount")
            .and_then(Value::as_i64)
            == Some(entry.caddie_attached_group_count())
        && value.get("sourceFileSha256").and_then(Value::as_str) == Some(entry.source_file_sha256())
}

fn row_key(date: NaiveDate, day_part: ReservationReportDayPart) -> String {
    format!("{date}:{}", day_part.as_str())
}

fn parse_row_key(value: &str) -> Result<(NaiveDate, ReservationReportDayPart), CourseError> {
    let (date, day_part) = value.split_once(':').ok_or(CourseError::Provider(
        "reservation report row key is invalid".into(),
    ))?;
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| CourseError::Provider("reservation report row date is invalid".into()))?;
    let day_part = ReservationReportDayPart::parse(day_part)
        .map_err(|_| CourseError::Provider("reservation report row day part is invalid".into()))?;
    Ok((date, day_part))
}

fn required_string(value: &Value, key: &str) -> Result<String, CourseError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CourseError::Provider(format!("reservation report field `{key}` is invalid"))
        })
}

fn required_i64(value: &Value, key: &str) -> Result<i64, CourseError> {
    value.get(key).and_then(Value::as_i64).ok_or_else(|| {
        CourseError::Provider(format!("reservation report field `{key}` is invalid"))
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use axum::{
        extract::{Multipart, Query, State},
        http::{HeaderMap, StatusCode},
        routing::{get, post},
        Json, Router,
    };

    use super::*;
    use crate::course::domain::{CourseId, ReservationReportRow};

    #[derive(Default)]
    struct ConfigState {
        tenant: Mutex<Value>,
        patches: Mutex<Vec<Value>>,
    }

    fn test_credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer test-token",
            operator_id: "tenant-test",
            platform_id: Some("platform-test"),
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    async fn spawn_field_server(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test Field API");
        let addr = listener.local_addr().expect("test Field API address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test Field API");
        });
        format!("http://{addr}")
    }

    async fn get_config(
        State(state): State<Arc<ConfigState>>,
        Query(query): Query<HashMap<String, String>>,
    ) -> (StatusCode, Json<Value>) {
        assert_eq!(query.get("scopeType").map(String::as_str), Some("tenant"));
        assert!(!query.contains_key("scopeId"));
        (
            StatusCode::OK,
            Json(json!({
                "configJson": state.tenant.lock().expect("tenant lock").clone()
            })),
        )
    }

    async fn patch_config(
        State(state): State<Arc<ConfigState>>,
        Json(body): Json<Value>,
    ) -> (StatusCode, Json<Value>) {
        assert_eq!(body["scopeType"], "tenant");
        assert!(body.get("scopeId").is_none());
        let mut patches = state.patches.lock().expect("patch lock");
        patches.push(body.clone());
        drop(patches);
        *state.tenant.lock().expect("tenant lock") = body["configJson"].clone();
        (StatusCode::OK, Json(json!({ "ok": true })))
    }

    async fn analyze_tabular(
        headers: HeaderMap,
        mut multipart: Multipart,
    ) -> (StatusCode, Json<Value>) {
        assert_eq!(
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer test-token")
        );
        assert_eq!(
            headers
                .get("x-operator-id")
                .and_then(|value| value.to_str().ok()),
            Some("tenant-test")
        );
        assert_eq!(
            headers
                .get("x-platform-id")
                .and_then(|value| value.to_str().ok()),
            Some("platform-test")
        );
        let mut fields = HashMap::new();
        while let Some(field) = multipart.next_field().await.expect("multipart field") {
            let name = field.name().unwrap_or_default().to_string();
            fields.insert(name, field.bytes().await.expect("multipart bytes").to_vec());
        }
        let mut names = fields.keys().cloned().collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec!["context", "file", "mappingMode", "targetSchema"]
        );
        assert_eq!(fields["mappingMode"], b"auto");
        let target_schema: Value =
            serde_json::from_slice(&fields["targetSchema"]).expect("target schema JSON");
        let target_fields = target_schema.as_array().expect("target schema array");
        assert_eq!(target_fields.len(), 5);
        assert_eq!(target_fields[0]["key"], "facilityName");
        assert!(target_fields.iter().all(|field| field["required"] == true));
        (
            StatusCode::OK,
            Json(json!({
                "sourceType": "xlsx",
                "sheetNames": ["Sheet1"],
                "selectedSheet": "Sheet1",
                "headerRow": 1,
                "headers": ["Facility", "Date", "Part", "Groups", "Caddie groups"],
                "rows": [{
                    "sourceRowNumber": 2,
                    "values": ["東", "2026-07-18", "morning", 8, 3]
                }],
                "mapping": {
                    "mode": "ai",
                    "fields": [
                        {"source":"Facility","target":"facilityName","required":true,"confidence":0.9,"explanation":"name","samples":["東"]},
                        {"source":"Date","target":"date","required":true,"confidence":0.9,"explanation":"date","samples":["2026-07-18"]},
                        {"source":"Part","target":"dayPart","required":true,"confidence":0.9,"explanation":"part","samples":["morning"]},
                        {"source":"Groups","target":"groupCount","required":true,"confidence":0.9,"explanation":"groups","samples":[8]},
                        {"source":"Caddie groups","target":"caddieAttachedGroupCount","required":true,"confidence":0.9,"explanation":"caddie","samples":[3]}
                    ],
                    "notes": "review"
                },
                "warnings": ["check the mapped columns"]
            })),
        )
    }

    fn entry() -> ExternalReservationReportEntry {
        let row = ReservationReportRow::new(
            "真駒内",
            "真駒内\n36H",
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            ReservationReportDayPart::Morning,
            3,
            1,
        )
        .unwrap();
        ExternalReservationReportEntry::new(&row, CourseId::new("course-1"), "hash")
    }

    fn active_course(id: &str) -> Course {
        Course::reconstitute(
            id,
            "テストコース",
            None,
            18,
            "Asia/Tokyo",
            10,
            true,
            None,
            None,
            None,
            None,
        )
    }

    #[test]
    fn config_rows_are_keyed_by_date_and_day_part_and_preserve_identity() {
        let value = entry_value(&entry(), Utc::now());
        assert_eq!(value["sourceCourseKey"], "真駒内");
        assert_eq!(
            row_key(
                NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
                ReservationReportDayPart::Morning,
            ),
            "2026-07-01:morning"
        );
        assert!(row_matches_entry(&value, &entry()));
    }

    #[tokio::test]
    async fn upsert_is_idempotent_and_keeps_the_tenant_config_base() {
        let state = Arc::new(ConfigState {
            tenant: Mutex::new(json!({
                "requiredField": "kept",
                "reservationProducts": [{"id": "product-1"}]
            })),
            ..Default::default()
        });
        let app = Router::new()
            .route(CONFIG_PATH, get(get_config).patch(patch_config))
            .with_state(state.clone());
        let base_url = spawn_field_server(app).await;
        let gateway = FieldReservationReportGateway::new(reqwest::Client::new(), Some(&base_url));
        let credentials = test_credentials();
        let first_entry = entry();

        let first = gateway
            .upsert_entries(
                credentials,
                std::slice::from_ref(&first_entry),
                &[active_course("course-1")],
            )
            .await
            .expect("first import");
        assert_eq!(first.created_count, 1);
        assert_eq!(first.updated_count, 0);
        assert_eq!(first.unchanged_count, 0);

        let stored = state.tenant.lock().expect("tenant lock").clone();
        assert_eq!(stored["requiredField"], "kept");
        assert_eq!(stored["reservationProducts"][0]["id"], "product-1");
        assert_eq!(
            stored[REPORT_KEY][COURSES_KEY]["course-1"][ROWS_KEY]["2026-07-01:morning"]
                ["sourceFileSha256"],
            "hash"
        );

        let second = gateway
            .upsert_entries(
                credentials,
                std::slice::from_ref(&first_entry),
                &[active_course("course-1")],
            )
            .await
            .expect("idempotent import");
        assert_eq!(second.created_count, 0);
        assert_eq!(second.updated_count, 0);
        assert_eq!(second.unchanged_count, 1);
        assert_eq!(state.patches.lock().expect("patch lock").len(), 1);

        let changed = ExternalReservationReportEntry::reconstitute(
            "",
            "真駒内",
            "真駒内\n36H",
            CourseId::new("course-1"),
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            ReservationReportDayPart::Morning,
            4,
            1,
            "new-hash",
            None,
        )
        .expect("changed entry");
        let updated = gateway
            .upsert_entries(
                credentials,
                std::slice::from_ref(&changed),
                &[active_course("course-1")],
            )
            .await
            .expect("updated import");
        assert_eq!(updated.created_count, 0);
        assert_eq!(updated.updated_count, 1);
        assert_eq!(updated.unchanged_count, 0);
        assert_eq!(state.patches.lock().expect("patch lock").len(), 2);

        let course = Course::reconstitute(
            "course-1",
            "真駒内",
            None,
            36,
            "Asia/Tokyo",
            10,
            true,
            None,
            None,
            None,
            None,
        );
        let listed = gateway
            .list_entries(
                credentials,
                &[course],
                ReservationReportEntryQuery {
                    from: None,
                    to: None,
                },
            )
            .await
            .expect("list imported entries");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].group_count(), 4);
        assert_eq!(listed[0].source_file_sha256(), "new-hash");

        let remapped = ExternalReservationReportEntry::reconstitute(
            "",
            "真駒内",
            "真駒内\n36H",
            CourseId::new("course-2"),
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            ReservationReportDayPart::Morning,
            4,
            1,
            "new-hash",
            None,
        )
        .expect("remapped entry");
        gateway
            .upsert_entries(
                credentials,
                std::slice::from_ref(&remapped),
                &[active_course("course-1"), active_course("course-2")],
            )
            .await
            .expect("remap import");
        let listed_after_remap = gateway
            .list_entries(
                credentials,
                &[active_course("course-1"), active_course("course-2")],
                ReservationReportEntryQuery {
                    from: None,
                    to: None,
                },
            )
            .await
            .expect("list after remap");
        assert_eq!(listed_after_remap.len(), 1);
        assert_eq!(listed_after_remap[0].golf_course_id().as_str(), "course-2");
    }

    #[tokio::test]
    async fn multi_course_import_commits_once_in_tenant_scope() {
        let state = Arc::new(ConfigState::default());
        let app = Router::new()
            .route(CONFIG_PATH, get(get_config).patch(patch_config))
            .with_state(state.clone());
        let base_url = spawn_field_server(app).await;
        let gateway = FieldReservationReportGateway::new(reqwest::Client::new(), Some(&base_url));
        let first = entry();
        let second_row = ReservationReportRow::new(
            "滝の",
            "滝の",
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            ReservationReportDayPart::Morning,
            2,
            0,
        )
        .unwrap();
        let second =
            ExternalReservationReportEntry::new(&second_row, CourseId::new("course-2"), "hash");

        gateway
            .upsert_entries(
                test_credentials(),
                &[first, second],
                &[active_course("course-1"), active_course("course-2")],
            )
            .await
            .expect("multi-course import");

        assert_eq!(state.patches.lock().expect("patch lock").len(), 1);
        let tenant = state.tenant.lock().expect("tenant lock");
        assert!(tenant[REPORT_KEY][COURSES_KEY]["course-1"][ROWS_KEY].is_object());
        assert!(tenant[REPORT_KEY][COURSES_KEY]["course-2"][ROWS_KEY].is_object());
    }

    #[tokio::test]
    async fn list_entries_rejects_malformed_report_containers() {
        let cases = [
            (
                json!({ REPORT_KEY: "invalid" }),
                "reservation report config is not an object",
            ),
            (
                json!({ REPORT_KEY: { COURSES_KEY: [] } }),
                "reservation report courses config is not an object",
            ),
        ];

        for (tenant_config, expected_message) in cases {
            let state = Arc::new(ConfigState {
                tenant: Mutex::new(tenant_config),
                ..Default::default()
            });
            let app = Router::new()
                .route(CONFIG_PATH, get(get_config).patch(patch_config))
                .with_state(state);
            let base_url = spawn_field_server(app).await;
            let gateway =
                FieldReservationReportGateway::new(reqwest::Client::new(), Some(&base_url));

            let error = gateway
                .list_entries(
                    test_credentials(),
                    &[active_course("course-1")],
                    ReservationReportEntryQuery {
                        from: None,
                        to: None,
                    },
                )
                .await
                .expect_err("malformed report config must fail");

            assert!(matches!(
                error,
                CourseError::Provider(message) if message == expected_message
            ));
        }
    }

    #[tokio::test]
    async fn tabular_analyze_forwards_multipart_and_maps_the_response() {
        let app = Router::new()
            .route(TABULAR_ANALYZE_PATH, post(analyze_tabular))
            .with_state(Arc::new(ConfigState::default()));
        let base_url = spawn_field_server(app).await;
        let gateway = FieldReservationReportGateway::new(reqwest::Client::new(), Some(&base_url));
        let result = gateway
            .analyze_tabular(
                test_credentials(),
                b"facility,date,part,groups,caddie",
                Some("report.csv"),
                2026,
            )
            .await
            .expect("tabular analysis");
        assert_eq!(result.source_type(), "xlsx");
        assert_eq!(result.headers().len(), 5);
        assert_eq!(result.rows()[0].values()[3], "8");
        assert_eq!(result.mapping().mode(), "ai");
        assert_eq!(result.mapping().fields().len(), 5);
        assert_eq!(result.warnings(), &["check the mapped columns"]);
    }
}
