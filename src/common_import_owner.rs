//! Field owns source/validation checkpoints. CourseBoard owns reservation-count
//! validation, staging, and the atomic facility-wide replacement.
use crate::course::domain::{
    actions, Course, CourseError, GolfCatalogGateway, ReservationReportMigrationGateway,
    ReservationReportRow,
};
use crate::course::infrastructure::MySqlReservationReportRepository;
use crate::course::interfaces::http::{caller_bearer, catalog_gateway, operator_id};
use crate::course::interfaces::http_reservation_report::reservation_report_credentials;
use crate::course::usecase::reservation_report_import::{
    normalize_course_key, parse_reservation_report_with_limit, parse_tabular_count,
    parse_tabular_date, parse_tabular_day_part, ReservationReportCourseMapping,
};
use crate::{AppError, AppState, CallerPrincipal};
use axum::{
    extract::{Extension, Path, State},
    http::HeaderMap,
    Json,
};
use base64::Engine;
use calamine::{open_workbook_auto_from_rs, Reader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerRequest {
    job_id: String,
    actor_id: String,
    source_sha256: String,
    options: Value,
    input: Value,
}
#[derive(Deserialize)]
struct Table {
    headers: Vec<String>,
    rows: Vec<TableRow>,
}
#[derive(Deserialize)]
struct TableRow {
    source_row_number: usize,
    values: Vec<String>,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash(value: &Value) -> Result<String, AppError> {
    Ok(digest(&serde_json::to_vec(value).map_err(|_| {
        AppError::BadRequest("invalid import object")
    })?))
}
fn database(error: sqlx::Error) -> AppError {
    AppError::from(CourseError::Provider(error.to_string()))
}
fn mappings(options: &Value) -> Result<Vec<ReservationReportCourseMapping>, AppError> {
    let values: HashMap<String, String> = serde_json::from_value(
        options
            .get("courseMappings")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .map_err(|_| AppError::BadRequest("courseMappings is invalid"))?;
    let mut ids = HashSet::new();
    let mut sources = HashSet::new();
    values
        .into_iter()
        .map(|(key, id)| {
            let key = normalize_course_key(&key);
            let id = id.trim().to_owned();
            if key.is_empty()
                || key.chars().count() > 255
                || id.chars().count() > 64
                || !sources.insert(key.clone())
                || (!id.is_empty() && !ids.insert(id.clone()))
            {
                return Err(AppError::BadRequest(
                    "source facilities and courses must be mapped uniquely",
                ));
            }
            Ok(ReservationReportCourseMapping::new(key, id))
        })
        .collect()
}
fn year(options: &Value) -> Result<i32, AppError> {
    options["year"]
        .as_i64()
        .and_then(|n| i32::try_from(n).ok())
        .filter(|n| (1..=9999).contains(n))
        .ok_or(AppError::BadRequest("year must be between 1 and 9999"))
}
async fn courses(
    state: &AppState,
    headers: &HeaderMap,
    request: &OwnerRequest,
) -> Result<Vec<Course>, AppError> {
    let credentials = reservation_report_credentials(state.course_authorizer(), headers)?;
    credentials
        .require(actions::IMPORT_RESERVATION_REPORTS)
        .await?;
    let courses = catalog_gateway(state).list_courses(credentials).await?;
    let active: HashSet<_> = courses
        .iter()
        .filter(|c| c.is_active())
        .map(|c| c.id().as_str())
        .collect();
    if mappings(&request.options)?.iter().any(|m| {
        m.golf_course_id
            .as_ref()
            .is_some_and(|id| !active.contains(id.as_str()))
    }) {
        return Err(AppError::BadRequest(
            "course mapping must target an active tenant course",
        ));
    }
    Ok(courses)
}
async fn check_job(
    state: &AppState,
    headers: &HeaderMap,
    request: &OwnerRequest,
    expected_total: Option<usize>,
) -> Result<(), AppError> {
    let base = state
        .cancellation_fee_config
        .field_api_url
        .as_deref()
        .ok_or(AppError::BadRequest("Field API is unavailable"))?;
    let response = state
        .http_client
        .get(format!(
            "{}/v1/bridge/data-jobs/{}",
            base.trim_end_matches('/'),
            request.job_id
        ))
        .header("Authorization", caller_bearer(headers)?)
        .header("x-operator-id", operator_id(headers)?)
        .header(
            "x-platform-id",
            request.options["platformId"].as_str().unwrap_or_default(),
        )
        .send()
        .await
        .map_err(|e| AppError::from(CourseError::Provider(e.to_string())))?;
    if !response.status().is_success() {
        return Err(AppError::Forbidden);
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Provider(e.to_string()))?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err(AppError::Provider("Field job exceeds its bound".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    let job: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Provider("invalid Field job".into()))?;
    if job["objectKey"] != "courseboardReservationReports"
        || job["kind"] != "import"
        || job["status"] != "running"
        || job["actorId"] != request.actor_id
        || job["sourceSha256"] != request.source_sha256
        || job["importOptions"] != request.options
        || expected_total.is_some_and(|total| {
            job["processed"].as_u64() != Some(total as u64)
                || job["total"].as_u64() != Some(total as u64)
        })
    {
        return Err(AppError::Conflict(
            "the import is not executing the validated source",
        ));
    }
    Ok(())
}

#[utoipa::path(post,path="/v1/course/common-import-owner/{operation}",params(("operation"=String,Path,description="source, validate, ready, stage, or finish")),request_body=OwnerRequest,responses((status=200,body=Value),(status=400,body=crate::course::interfaces::openapi::ErrorBody),(status=403,body=crate::course::interfaces::openapi::ErrorBody),(status=409,body=crate::course::interfaces::openapi::ErrorBody)),security(("bearer_auth"=[])),tag="course")]
pub async fn handle(
    State(state): State<AppState>,
    Extension(principal): Extension<CallerPrincipal>,
    headers: HeaderMap,
    Path(operation): Path<String>,
    Json(request): Json<OwnerRequest>,
) -> Result<Json<Value>, AppError> {
    let subject = principal
        .subject
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or(AppError::Forbidden)?;
    let tenant = operator_id(&headers)?;
    if request.job_id.len() > 64
        || !request.job_id.starts_with("dtj_")
        || !request
            .job_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        || request.source_sha256.len() != 64
        || !request.source_sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || request.options["sourceApp"] != "courseboard"
        || request.actor_id.len() > 255
    {
        return Err(AppError::BadRequest("invalid common-import identity"));
    }
    year(&request.options)?;
    if operation == "stage" || operation == "finish" {
        reservation_report_credentials(state.course_authorizer(), &headers)?
            .require("field:ExecuteBridgeDrafts")
            .await?;
    }
    let current_courses = courses(&state, &headers, &request).await?;
    if operation == "source" {
        return Ok(Json(source(&request)?));
    }
    let repository = MySqlReservationReportRepository::new(state.common_import_pool.clone());
    let legacy = if operation == "finish" && !repository.has_rows(tenant).await? {
        check_job(&state, &headers, &request, None).await?;
        state
            .reservation_report_gateway()
            .list_legacy_entries(
                reservation_report_credentials(state.course_authorizer(), &headers)?,
                &current_courses,
            )
            .await?
    } else {
        Vec::new()
    };
    let options_hash = hash(&request.options)?;
    let mut tx = state.common_import_pool.begin().await.map_err(database)?;
    sqlx::query("INSERT INTO courseboard_common_import_jobs (tenant_id,job_id,subject,actor_id,source_sha256,options_hash) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE job_id=job_id")
        .bind(tenant).bind(&request.job_id).bind(subject).bind(&request.actor_id).bind(&request.source_sha256).bind(&options_hash)
        .execute(&mut *tx).await.map_err(database)?;
    let job=sqlx::query("SELECT subject,actor_id,source_sha256,options_hash,status,result_json FROM courseboard_common_import_jobs WHERE tenant_id=? AND job_id=? FOR UPDATE")
        .bind(tenant).bind(&request.job_id).fetch_one(&mut *tx).await.map_err(database)?;
    if job.try_get::<String, _>("subject").map_err(database)? != subject
        || job.try_get::<String, _>("actor_id").map_err(database)? != request.actor_id
        || job
            .try_get::<String, _>("source_sha256")
            .map_err(database)?
            != request.source_sha256
        || job.try_get::<String, _>("options_hash").map_err(database)? != options_hash
    {
        return Err(AppError::Forbidden);
    }
    let status: String = job.try_get("status").map_err(database)?;
    let response = match operation.as_str() {
        "validate" => {
            if status != "validating" {
                return Err(AppError::Conflict("import validation is already closed"));
            }
            let table: Table = serde_json::from_value(request.input.clone())
                .map_err(|_| AppError::BadRequest("invalid import table"))?;
            if table.rows.len() > 500 || table.headers.len() > 256 {
                return Err(AppError::BadRequest("import page exceeds its bound"));
            }
            let mut rows = Vec::new();
            let mut errors = Vec::new();
            for row in &table.rows {
                match normalized(&request, &table, row) {
                    Ok(object) => {
                        let source = object["sourceCourseKey"].as_str().unwrap_or_default();
                        let bucket = object["bucket"].as_str().unwrap_or_default();
                        let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM courseboard_common_import_facilities WHERE tenant_id=? AND job_id=? AND source_course_key=?")
                            .bind(tenant).bind(&request.job_id).bind(source).fetch_one(&mut *tx).await.map_err(database)?;
                        if exists == 0 {
                            let before = facility_hash(&mut tx, tenant, source, bucket).await?;
                            sqlx::query("INSERT INTO courseboard_common_import_facilities (tenant_id,job_id,source_course_key,bucket,before_hash) VALUES (?,?,?,?,?)")
                                .bind(tenant).bind(&request.job_id).bind(source).bind(bucket).bind(before).execute(&mut *tx).await.map_err(database)?;
                        }
                        let identity = identity(&object)?;
                        let object_hash = hash(&object)?;
                        sqlx::query("INSERT INTO courseboard_common_import_rows (tenant_id,job_id,identity_hash,source_row_number,object_json,object_hash,source_course_key,bucket,golf_course_id,report_date,day_part) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE identity_hash=identity_hash")
                            .bind(tenant).bind(&request.job_id).bind(&identity).bind(row.source_row_number as u64).bind(&object).bind(&object_hash)
                            .bind(object["sourceCourseKey"].as_str()).bind(object["bucket"].as_str()).bind(object["golfCourseId"].as_str())
                            .bind(object["date"].as_str()).bind(object["dayPart"].as_str())
                            .execute(&mut *tx).await.map_err(database)?;
                        let stored=sqlx::query("SELECT source_row_number,object_hash FROM courseboard_common_import_rows WHERE tenant_id=? AND job_id=? AND identity_hash=?")
                            .bind(tenant).bind(&request.job_id).bind(identity).fetch_one(&mut *tx).await.map_err(database)?;
                        if stored
                            .try_get::<u64, _>("source_row_number")
                            .map_err(database)?
                            != row.source_row_number as u64
                            || stored
                                .try_get::<String, _>("object_hash")
                                .map_err(database)?
                                != object_hash
                        {
                            errors.push(json!({"rowNumber":row.source_row_number,"message":"施設・日付・午前午後が重複しています"}));
                            continue;
                        }
                        let warnings = if object["caddieAttachedGroupCount"].as_i64()
                            > object["groupCount"].as_i64()
                        {
                            vec![
                                json!({"message":"キャディ付き組数が組数を超えています。原表を確認してください。"}),
                            ]
                        } else {
                            vec![]
                        };
                        rows.push(json!({"number":row.source_row_number,"object":object,"id":null,"beforeHash":null,"warnings":warnings,"outcome":null,"error":null}));
                    }
                    Err(error) => errors.push(
                        json!({"rowNumber":row.source_row_number,"message":error.to_string()}),
                    ),
                }
            }
            json!({"rows":rows,"errors":errors})
        }
        "ready" => {
            if status != "validating" && status != "ready" {
                return Err(AppError::Conflict("validation is already closed"));
            }
            let total = request.input["total"]
                .as_u64()
                .filter(|n| *n > 0)
                .ok_or(AppError::BadRequest("invalid import total"))?;
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM courseboard_common_import_rows WHERE tenant_id=? AND job_id=?")
                .bind(tenant).bind(&request.job_id).fetch_one(&mut *tx).await.map_err(database)?;
            if count as u64 != total {
                return Err(AppError::Conflict("full validation is incomplete"));
            }
            for mapping in mappings(&request.options)? {
                let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM courseboard_common_import_rows WHERE tenant_id=? AND job_id=? AND source_course_key=?")
                    .bind(tenant).bind(&request.job_id).bind(&mapping.source_course_key).fetch_one(&mut *tx).await.map_err(database)?;
                if count == 0 {
                    return Err(AppError::BadRequest(
                        "course mapping names a facility absent from the source",
                    ));
                }
            }
            sqlx::query("UPDATE courseboard_common_import_jobs SET status='ready' WHERE tenant_id=? AND job_id=?")
                .bind(tenant).bind(&request.job_id).execute(&mut *tx).await.map_err(database)?;
            json!({})
        }
        "stage" => {
            if status == "committed" {
                json!({})
            } else {
                check_job(&state, &headers, &request, None).await?;
                if status != "ready" {
                    return Err(AppError::Conflict(
                        "full validation must finish before staging",
                    ));
                }
                let object = &request.input["row"]["object"];
                let matched: i64=sqlx::query_scalar("SELECT COUNT(*) FROM courseboard_common_import_rows WHERE tenant_id=? AND job_id=? AND identity_hash=? AND object_hash=? AND source_row_number=?")
                    .bind(tenant).bind(&request.job_id).bind(identity(object)?).bind(hash(object)?)
                    .bind(request.input["row"]["number"].as_u64().ok_or(AppError::BadRequest("invalid source row"))?)
                    .fetch_one(&mut *tx).await.map_err(database)?;
                if matched != 1 {
                    return Err(AppError::Conflict(
                        "the confirmed row changed after validation",
                    ));
                }
                sqlx::query("UPDATE courseboard_common_import_rows SET staged=TRUE WHERE tenant_id=? AND job_id=? AND identity_hash=?")
                    .bind(tenant).bind(&request.job_id).bind(identity(object)?).execute(&mut *tx).await.map_err(database)?;
                json!({})
            }
        }
        "finish" => {
            if status == "committed" {
                job.try_get::<Option<Value>, _>("result_json")
                    .map_err(database)?
                    .unwrap_or_else(|| json!({}))
            } else {
                let total = request.input["total"]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .filter(|n| *n > 0)
                    .ok_or(AppError::BadRequest("invalid import total"))?;
                check_job(&state, &headers, &request, Some(total)).await?;
                let (count, staged): (i64,i64) = sqlx::query_as("SELECT COUNT(*),COALESCE(SUM(staged),0) FROM courseboard_common_import_rows WHERE tenant_id=? AND job_id=?")
                    .bind(tenant).bind(&request.job_id).fetch_one(&mut *tx).await.map_err(database)?;
                if status != "ready" || count as usize != total || staged as usize != total {
                    return Err(AppError::Conflict("not every validated row is staged"));
                }
                let mut after = String::new();
                loop {
                    let facilities = sqlx::query("SELECT source_course_key,bucket,before_hash FROM courseboard_common_import_facilities WHERE tenant_id=? AND job_id=? AND source_course_key>? ORDER BY source_course_key LIMIT 100")
                        .bind(tenant).bind(&request.job_id).bind(&after).fetch_all(&mut *tx).await.map_err(database)?;
                    if facilities.is_empty() {
                        break;
                    }
                    for facility in facilities {
                        after = facility.try_get("source_course_key").map_err(database)?;
                        let bucket: String = facility.try_get("bucket").map_err(database)?;
                        if facility_hash(&mut tx, tenant, &after, &bucket).await?
                            != facility
                                .try_get::<String, _>("before_hash")
                                .map_err(database)?
                        {
                            return Err(AppError::Conflict("予約表集計が検証後に変更されています。新しいプレビューを作成してください。"));
                        }
                    }
                }
                repository
                    .seed_common_legacy(&mut tx, tenant, &legacy)
                    .await?;
                let summary = repository
                    .commit_common_import(&mut tx, tenant, &request.job_id, &request.source_sha256)
                    .await?;
                let result = json!({"createdCount":summary.created_count,"updatedCount":summary.updated_count,"unchangedCount":summary.unchanged_count,
                    "audit":{"jobId":request.job_id,"actorId":request.actor_id,"subject":subject,"sourceSha256":request.source_sha256}});
                sqlx::query("UPDATE courseboard_common_import_jobs SET status='committed',result_json=? WHERE tenant_id=? AND job_id=?")
                    .bind(&result).bind(tenant).bind(&request.job_id).execute(&mut *tx).await.map_err(database)?;
                result
            }
        }
        _ => return Err(AppError::BadRequest("unknown owner operation")),
    };
    tx.commit().await.map_err(database)?;
    Ok(Json(response))
}

fn normalized(request: &OwnerRequest, table: &Table, row: &TableRow) -> Result<Value, AppError> {
    if row.source_row_number == 0 {
        return Err(AppError::BadRequest("source row number is required"));
    }
    let aliases: [(&str, &[&str]); 5] = [
        ("facilityName", &["facilityName", "施設名", "ゴルフ場"]),
        ("date", &["date", "日付"]),
        ("dayPart", &["dayPart", "時間帯", "午前・午後"]),
        ("groupCount", &["groupCount", "組数"]),
        (
            "caddieAttachedGroupCount",
            &["caddieAttachedGroupCount", "キャディ付き組数", "キャ付"],
        ),
    ];
    let mut values = HashMap::new();
    let mut used = HashSet::new();
    for (target, aliases) in aliases {
        let explicit = request.options["columnMappings"][target]
            .as_str()
            .filter(|s| !s.trim().is_empty());
        let index = table
            .headers
            .iter()
            .position(|h| {
                explicit.map_or_else(|| aliases.contains(&h.as_str()), |source| h == source)
            })
            .ok_or(AppError::BadRequest(
                "every reservation field must have a source column",
            ))?;
        if !used.insert(index) {
            return Err(AppError::BadRequest(
                "column mappings must use distinct source columns",
            ));
        }
        values.insert(
            target,
            row.values
                .get(index)
                .map(String::as_str)
                .unwrap_or_default(),
        );
    }
    let name = values["facilityName"].trim();
    let key = normalize_course_key(name);
    if key.chars().count() > 255 || name.chars().count() > 255 {
        return Err(AppError::BadRequest("facility name exceeds 255 characters"));
    }
    let date = parse_tabular_date(values["date"], year(&request.options)?)?;
    let part = parse_tabular_day_part(values["dayPart"])?;
    let groups = parse_tabular_count(values["groupCount"], "groupCount")?;
    let caddies = parse_tabular_count(
        values["caddieAttachedGroupCount"],
        "caddieAttachedGroupCount",
    )?;
    ReservationReportRow::new(key.clone(), name, date, part, groups, caddies)?;
    let golf_course_id = mappings(&request.options)?
        .into_iter()
        .find(|m| m.source_course_key == key)
        .and_then(|m| m.golf_course_id.map(|id| id.as_str().to_owned()));
    let bucket = golf_course_id
        .clone()
        .unwrap_or_else(|| format!("unlinked:{key}"));
    Ok(
        json!({"bucket":bucket,"golfCourseId":golf_course_id,"sourceCourseKey":key,"sourceCourseName":name,"date":date,"dayPart":part.as_str(),"groupCount":groups,"caddieAttachedGroupCount":caddies}),
    )
}
fn identity(object: &Value) -> Result<String, AppError> {
    let key = object["sourceCourseKey"]
        .as_str()
        .ok_or(AppError::BadRequest("invalid facility"))?;
    Ok(digest(
        format!(
            "{}:{}:{}",
            key,
            object["date"]
                .as_str()
                .ok_or(AppError::BadRequest("invalid date"))?,
            object["dayPart"]
                .as_str()
                .ok_or(AppError::BadRequest("invalid day part"))?
        )
        .as_bytes(),
    ))
}
fn source(request: &OwnerRequest) -> Result<Value, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.input["contentBase64"].as_str().unwrap_or_default())
        .map_err(|_| AppError::BadRequest("invalid source encoding"))?;
    if bytes.len() > 32 * 1024 * 1024 || digest(&bytes) != request.source_sha256 {
        return Err(AppError::Conflict("source file identity changed"));
    }
    validate_excel_container(&bytes)?;
    let workbook = open_workbook_auto_from_rs(std::io::Cursor::new(&bytes))
        .map_err(|_| AppError::BadRequest("invalid Excel file"))?;
    if !workbook
        .sheet_names()
        .iter()
        .any(|name| name == "日別予約状況")
    {
        return Ok(json!({"contentBase64":null}));
    }
    let report = parse_reservation_report_with_limit(
        &bytes,
        year(&request.options)?,
        request.input["filename"].as_str(),
        32 * 1024 * 1024,
    )?;
    let mut csv = String::from(
        "facilityName,date,dayPart,groupCount,caddieAttachedGroupCount,__bridgeSourceRowNumber\n",
    );
    for row in report.rows() {
        let name = format!("\"{}\"", row.source_course_name().replace('"', "\"\""));
        csv.push_str(&format!(
            "{name},{},{},{},{},{}\n",
            row.date(),
            row.day_part().as_str(),
            row.group_count(),
            row.caddie_attached_group_count(),
            row.source_row_number()
                .ok_or(AppError::BadRequest("workbook source row is missing"))?
        ));
    }
    Ok(json!({"contentBase64":base64::engine::general_purpose::STANDARD.encode(csv)}))
}

fn validate_excel_container(bytes: &[u8]) -> Result<(), AppError> {
    if !bytes.starts_with(b"PK") {
        return Ok(());
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| AppError::BadRequest("invalid Excel container"))?;
    if archive.len() > 2_048 {
        return Err(AppError::BadRequest("Excel contains too many entries"));
    }
    let mut size = 0u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| AppError::BadRequest("invalid Excel entry"))?;
        size = size
            .checked_add(entry.size())
            .ok_or(AppError::BadRequest("Excel size overflow"))?;
        if size > 64 * 1024 * 1024 {
            return Err(AppError::BadRequest("expanded Excel exceeds 64 MiB"));
        }
    }
    Ok(())
}

async fn facility_hash(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    tenant: &str,
    source: &str,
    bucket: &str,
) -> Result<String, AppError> {
    let mut digest = Sha256::new();
    let mut after = 0i64;
    loop {
        let rows=sqlx::query("SELECT id,JSON_OBJECT('bucket',bucket,'course',golf_course_id,'sourceSystem',source_system,'sourceKey',source_course_key,'name',source_course_name,'date',CAST(report_date AS CHAR),'part',day_part,'groups',group_count,'caddies',caddie_attached_group_count,'sha',source_file_sha256,'updated',CAST(updated_at AS CHAR)) AS snapshot FROM golf_reservation_report_rows WHERE tenant_id=? AND (source_course_key=? OR bucket=?) AND id>? ORDER BY id LIMIT 100 FOR UPDATE")
            .bind(tenant).bind(source).bind(bucket).bind(after).fetch_all(&mut **tx).await.map_err(database)?;
        if rows.is_empty() {
            break;
        }
        for row in rows {
            after = row.try_get("id").map_err(database)?;
            let value: Value = row.try_get("snapshot").map_err(database)?;
            let bytes = serde_json::to_vec(&value)
                .map_err(|_| AppError::BadRequest("invalid facility snapshot"))?;
            digest.update((bytes.len() as u64).to_be_bytes());
            digest.update(bytes);
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
#[path = "common_import_owner_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "common_import_owner_db_tests.rs"]
mod db_tests;
