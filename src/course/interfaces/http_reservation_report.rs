//! HTTP adapters for importing and listing daily reservation-count snapshots.

use std::collections::HashMap;

use axum::{
    extract::{Multipart, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::http::{bearer_authorization, catalog_gateway, operator_id};
use crate::course::domain::{ExternalReservationReportEntry, GatewayCredentials};
use crate::course::usecase::{
    normalized_reservation_report_fingerprint, ImportReservationReportUseCase,
    ListReservationReportEntriesUseCase, PreviewReservationReportUseCase,
    ReservationReportCourseMapping, ReservationReportPreview,
};
use crate::{AppError, AppState};

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportFacilityDto {
    pub source_course_key: String,
    pub source_course_name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportRowDto {
    pub source_course_key: String,
    pub source_course_name: String,
    pub date: NaiveDate,
    pub day_part: String,
    pub group_count: i64,
    pub caddie_attached_group_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportTotalsDto {
    pub facility_count: i64,
    pub row_count: i64,
    pub group_count: i64,
    pub caddie_attached_group_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportPreviewResponse {
    pub source_system: String,
    pub source_file_sha256: String,
    pub normalized_fingerprint: String,
    pub facilities: Vec<ReservationReportFacilityDto>,
    pub rows: Vec<ReservationReportRowDto>,
    pub totals: ReservationReportTotalsDto,
    /// Half-days worth comparing against the original report. Every one of
    /// them still imports.
    pub review: Vec<ReservationReportReviewDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis: Option<ReservationReportAnalysisDto>,
}

/// One row the report contradicts itself on.
///
/// Only one kind so far — more caddie-attached groups than groups — but it is
/// named rather than implied so a second kind does not have to change the shape
/// the screen reads.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportReviewDto {
    /// `caddieExceedsGroups`.
    pub kind: String,
    pub source_course_name: String,
    pub date: NaiveDate,
    pub day_part: String,
    pub group_count: i64,
    pub caddie_attached_group_count: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportAnalysisDto {
    pub source_type: String,
    pub sheet_names: Vec<String>,
    pub selected_sheet: Option<String>,
    pub header_row: Option<usize>,
    pub headers: Vec<String>,
    pub mapping: ReservationReportMappingDto,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportMappingDto {
    pub mode: String,
    pub fields: Vec<ReservationReportMappingFieldDto>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportMappingFieldDto {
    pub source: String,
    pub target: String,
    pub required: bool,
    pub confidence: f64,
    pub explanation: String,
    pub samples: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportImportResponse {
    pub created_count: i64,
    pub updated_count: i64,
    pub unchanged_count: i64,
    pub totals: ReservationReportTotalsDto,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportEntryDto {
    pub id: String,
    pub source_course_key: String,
    pub source_course_name: String,
    /// Null when the source facility has no honest one-course mapping.
    pub golf_course_id: Option<String>,
    pub date: NaiveDate,
    pub day_part: String,
    pub group_count: i64,
    pub caddie_attached_group_count: i64,
    pub source_file_sha256: String,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportEntriesResponse {
    pub items: Vec<ReservationReportEntryDto>,
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationReportEntriesQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

fn preview_response(preview: ReservationReportPreview) -> ReservationReportPreviewResponse {
    let report = preview.report();
    let totals = report.totals();
    ReservationReportPreviewResponse {
        source_system: report.source_system().to_string(),
        source_file_sha256: report.source_file_sha256().to_string(),
        normalized_fingerprint: normalized_reservation_report_fingerprint(
            report,
            preview.tabular_analysis(),
        ),
        facilities: report
            .facilities()
            .iter()
            .map(|facility| ReservationReportFacilityDto {
                source_course_key: facility.source_course_key().to_string(),
                source_course_name: facility.source_course_name().to_string(),
            })
            .collect(),
        rows: report.rows().iter().map(row_response).collect(),
        totals: totals_response(totals),
        review: report
            .rows_needing_review()
            .into_iter()
            .map(review_response)
            .collect(),
        analysis: preview.tabular_analysis().map(analysis_response),
    }
}

fn reservation_report_credentials<'a>(
    authorizer: &'a dyn crate::course::domain::CourseAuthorizer,
    headers: &'a HeaderMap,
) -> Result<GatewayCredentials<'a>, AppError> {
    let platform_id = headers
        .get("x-platform-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(AppError::BadRequest("x-platform-id header is required"))?;
    Ok(GatewayCredentials {
        // This endpoint processes a user-selected file. Always preserve the
        // verified user's bearer instead of replacing it with a static token.
        authorization: bearer_authorization(headers)?,
        caller_bearer: super::http::caller_bearer(headers)?,
        operator_id: operator_id(headers)?,
        platform_id: Some(platform_id),
        authorizer,
    })
}

fn analysis_response(
    analysis: &crate::course::domain::TabularAnalyzeResult,
) -> ReservationReportAnalysisDto {
    ReservationReportAnalysisDto {
        source_type: analysis.source_type().to_string(),
        sheet_names: analysis.sheet_names().to_vec(),
        selected_sheet: analysis.selected_sheet().map(str::to_string),
        header_row: analysis.header_row(),
        headers: analysis.headers().to_vec(),
        mapping: ReservationReportMappingDto {
            mode: analysis.mapping().mode().to_string(),
            fields: analysis
                .mapping()
                .fields()
                .iter()
                .map(|field| ReservationReportMappingFieldDto {
                    source: field.source().to_string(),
                    target: field.target().to_string(),
                    required: field.required(),
                    confidence: field.confidence(),
                    explanation: field.explanation().to_string(),
                    samples: field.samples().to_vec(),
                })
                .collect(),
            notes: analysis.mapping().notes().map(str::to_string),
        },
        warnings: analysis.warnings().to_vec(),
    }
}

fn review_response(
    row: &crate::course::domain::ReservationReportRow,
) -> ReservationReportReviewDto {
    ReservationReportReviewDto {
        kind: "caddieExceedsGroups".to_string(),
        source_course_name: row.source_course_name().to_string(),
        date: row.date(),
        day_part: row.day_part().as_str().to_string(),
        group_count: row.group_count(),
        caddie_attached_group_count: row.caddie_attached_group_count(),
    }
}

fn row_response(row: &crate::course::domain::ReservationReportRow) -> ReservationReportRowDto {
    ReservationReportRowDto {
        source_course_key: row.source_course_key().to_string(),
        source_course_name: row.source_course_name().to_string(),
        date: row.date(),
        day_part: row.day_part().as_str().to_string(),
        group_count: row.group_count(),
        caddie_attached_group_count: row.caddie_attached_group_count(),
    }
}

fn totals_response(
    totals: crate::course::domain::ReservationReportTotals,
) -> ReservationReportTotalsDto {
    ReservationReportTotalsDto {
        facility_count: totals.facility_count,
        row_count: totals.row_count,
        group_count: totals.group_count,
        caddie_attached_group_count: totals.caddie_attached_group_count,
    }
}

fn entry_response(entry: &ExternalReservationReportEntry) -> ReservationReportEntryDto {
    ReservationReportEntryDto {
        id: entry.id().unwrap_or_default().to_string(),
        source_course_key: entry.source_course_key().to_string(),
        source_course_name: entry.source_course_name().to_string(),
        golf_course_id: entry.golf_course_id().map(ToString::to_string),
        date: entry.date(),
        day_part: entry.day_part().as_str().to_string(),
        group_count: entry.group_count(),
        caddie_attached_group_count: entry.caddie_attached_group_count(),
        source_file_sha256: entry.source_file_sha256().to_string(),
        updated_at: entry.updated_at(),
    }
}

struct UploadedReservationReport {
    bytes: Vec<u8>,
    filename: Option<String>,
    year: i32,
    mappings: Option<HashMap<String, String>>,
    column_mappings: Option<HashMap<String, String>>,
    normalized_fingerprint: Option<String>,
}

async fn read_upload(mut multipart: Multipart) -> Result<UploadedReservationReport, AppError> {
    let mut bytes = None;
    let mut filename = None;
    let mut year = None;
    let mut mappings = None;
    let mut column_mappings = None;
    let mut normalized_fingerprint = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::BadRequest("invalid multipart request"))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                filename = field.file_name().map(ToString::to_string);
                let value = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::BadRequest("invalid reservation report file"))?;
                bytes = Some(value.to_vec());
            }
            "year" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| AppError::BadRequest("year is required"))?;
                year = Some(
                    value
                        .trim()
                        .parse::<i32>()
                        .map_err(|_| AppError::BadRequest("year is invalid"))?,
                );
            }
            "courseMappings" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| AppError::BadRequest("courseMappings is invalid"))?;
                mappings = Some(
                    serde_json::from_str::<HashMap<String, String>>(&value)
                        .map_err(|_| AppError::BadRequest("courseMappings is invalid"))?,
                );
            }
            "columnMappings" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| AppError::BadRequest("columnMappings is invalid"))?;
                column_mappings = Some(
                    serde_json::from_str::<HashMap<String, String>>(&value)
                        .map_err(|_| AppError::BadRequest("columnMappings is invalid"))?,
                );
            }
            "normalizedFingerprint" => {
                let value = field
                    .text()
                    .await
                    .map_err(|_| AppError::BadRequest("normalizedFingerprint is invalid"))?;
                normalized_fingerprint = Some(value.trim().to_string());
            }
            _ => return Err(AppError::BadRequest("unknown multipart field")),
        }
    }
    let bytes = bytes.ok_or(AppError::BadRequest("file is required"))?;
    let year = year.ok_or(AppError::BadRequest("year is required"))?;
    Ok(UploadedReservationReport {
        bytes,
        filename,
        year,
        mappings,
        column_mappings,
        normalized_fingerprint,
    })
}

/// POST /v1/course/reservation-report-imports/preview
#[utoipa::path(
    post,
    path = "/v1/course/reservation-report-imports/preview",
    tag = "course",
    responses(
        (status = 200, description = "Parsed reservation report preview", body = ReservationReportPreviewResponse),
        (status = 400, description = "Invalid workbook or multipart request", body = super::openapi::ErrorBody),
        (status = 401, description = "Unauthorized", body = super::openapi::ErrorBody)
    ),
    security(("bearer_auth" = []))
)]
pub async fn preview_reservation_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<ReservationReportPreviewResponse>, AppError> {
    super::http::bearer_authorization(&headers)?;
    let credentials = reservation_report_credentials(state.course_authorizer(), &headers)?;
    let upload = read_upload(multipart).await?;
    let preview = PreviewReservationReportUseCase::execute_with_fallback(
        credentials,
        state.reservation_report_gateway().as_ref(),
        &upload.bytes,
        upload.year,
        upload.filename.as_deref(),
        upload.column_mappings.as_ref(),
    )
    .await
    .map_err(AppError::from)?;
    Ok(Json(preview_response(preview)))
}

/// POST /v1/course/reservation-report-imports
#[utoipa::path(
    post,
    path = "/v1/course/reservation-report-imports",
    tag = "course",
    responses(
        (status = 200, description = "Imported reservation report", body = ReservationReportImportResponse),
        (status = 400, description = "Invalid workbook, mapping, or multipart request", body = super::openapi::ErrorBody),
        (status = 409, description = "The analyzed report changed; preview it again", body = super::openapi::ErrorBody),
        (status = 401, description = "Unauthorized", body = super::openapi::ErrorBody),
        (status = 424, description = "Course catalog provider error", body = super::openapi::ErrorBody)
    ),
    security(("bearer_auth" = []))
)]
pub async fn import_reservation_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<ReservationReportImportResponse>, AppError> {
    super::http::bearer_authorization(&headers)?;
    let credentials = reservation_report_credentials(state.course_authorizer(), &headers)?;
    let upload = read_upload(multipart).await?;
    let preview = PreviewReservationReportUseCase::execute_with_fallback(
        credentials,
        state.reservation_report_gateway().as_ref(),
        &upload.bytes,
        upload.year,
        upload.filename.as_deref(),
        upload.column_mappings.as_ref(),
    )
    .await
    .map_err(AppError::from)?;
    let report = preview.report();
    if preview.tabular_analysis().is_some()
        && upload
            .column_mappings
            .as_ref()
            .is_none_or(HashMap::is_empty)
    {
        return Err(AppError::BadRequest(
            "columnMappings is required for analyzed table imports",
        ));
    }
    let actual_fingerprint =
        normalized_reservation_report_fingerprint(report, preview.tabular_analysis());
    match (
        preview.tabular_analysis(),
        upload.normalized_fingerprint.as_deref(),
    ) {
        (Some(_), None | Some("")) => {
            return Err(AppError::BadRequest(
                "normalizedFingerprint is required for analyzed table imports",
            ));
        }
        (_, Some(expected_fingerprint)) if expected_fingerprint != actual_fingerprint => {
            return Err(AppError::Conflict(
                "the report changed while it was being analyzed; preview it again",
            ));
        }
        _ => {}
    }
    let mappings = upload
        .mappings
        .unwrap_or_default()
        .into_iter()
        .map(|(source_course_key, golf_course_id)| {
            ReservationReportCourseMapping::new(source_course_key, golf_course_id)
        })
        .collect::<Vec<_>>();
    let use_case = ImportReservationReportUseCase::new(
        state.reservation_report_gateway(),
        catalog_gateway(&state),
    );
    let summary = use_case
        .execute(credentials, report, &mappings)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationReportImportResponse {
        created_count: summary.created_count,
        updated_count: summary.updated_count,
        unchanged_count: summary.unchanged_count,
        totals: totals_response(report.totals()),
    }))
}

/// GET /v1/course/reservation-report-entries
#[utoipa::path(
    get,
    path = "/v1/course/reservation-report-entries",
    tag = "course",
    params(ReservationReportEntriesQuery),
    responses(
        (status = 200, description = "Imported reservation report entries", body = ReservationReportEntriesResponse),
        (status = 400, description = "Invalid date range", body = super::openapi::ErrorBody),
        (status = 401, description = "Unauthorized", body = super::openapi::ErrorBody)
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_reservation_report_entries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReservationReportEntriesQuery>,
) -> Result<Json<ReservationReportEntriesResponse>, AppError> {
    super::http::bearer_authorization(&headers)?;
    let credentials = reservation_report_credentials(state.course_authorizer(), &headers)?;
    let use_case = ListReservationReportEntriesUseCase::new(
        state.reservation_report_gateway(),
        catalog_gateway(&state),
    );
    let entries = use_case
        .execute(credentials, query.from, query.to)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationReportEntriesResponse {
        items: entries.iter().map(entry_response).collect(),
    }))
}

#[cfg(test)]
mod tests {
    use axum::http::{header::AUTHORIZATION, HeaderValue};

    use super::*;

    #[test]
    fn unlinked_entry_response_keeps_the_facility_and_uses_null_course_id() {
        let row = crate::course::domain::ReservationReportRow::new(
            "facility-a",
            "Facility A",
            NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
            crate::course::domain::ReservationReportDayPart::Morning,
            6,
            2,
        )
        .unwrap();
        let entry = ExternalReservationReportEntry::new(
            &row,
            Option::<crate::course::domain::CourseId>::None,
            "synthetic-hash",
        )
        .with_persistence_metadata("unlinked:facility-a:2026-08-20:morning", None);

        let dto = entry_response(&entry);
        assert_eq!(dto.source_course_key, "facility-a");
        assert_eq!(dto.source_course_name, "Facility A");
        assert_eq!(dto.golf_course_id, None);
        assert_eq!(dto.group_count, 6);
        let json = serde_json::to_value(dto).expect("entry response serializes");
        assert!(json["golfCourseId"].is_null());
    }

    #[test]
    fn import_credentials_preserve_user_bearer_and_require_platform() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer user-token"));
        headers.insert("x-operator-id", HeaderValue::from_static("operator-1"));
        assert!(matches!(
            reservation_report_credentials(&crate::course::infrastructure::ALLOW_ALL, &headers),
            Err(AppError::BadRequest("x-platform-id header is required"))
        ));

        headers.insert("x-platform-id", HeaderValue::from_static("platform-1"));
        let credentials =
            reservation_report_credentials(&crate::course::infrastructure::ALLOW_ALL, &headers)
                .unwrap();
        assert_eq!(credentials.authorization, "Bearer user-token");
        assert_eq!(credentials.operator_id, "operator-1");
        assert_eq!(credentials.platform_id, Some("platform-1"));
    }
}
