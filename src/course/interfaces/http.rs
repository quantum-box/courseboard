//! Axum handlers for `/v1/course/*`.
//!
//! Handlers stay thin: parse request → call use case → map domain → response DTO.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::openapi::ErrorBody;

use crate::course::domain::{
    AvailabilityRule, Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieId, CaddieStaff,
    Course, CourseError, CourseId, GatewayCredentials, GenerationSummary, ProductSlot,
    ReservationProduct, ReservationServiceId, Resource, TeeSheet, TeeSheetItem, TeeSheetQuery,
    UpsertCourse, UpsertReservationProduct,
};
use crate::course::infrastructure::{
    FieldGolfCatalogGateway, FieldGolfCommercialGateway, FieldGolfOpsGateway,
    FieldReservationGateway,
};
use crate::course::usecase::{
    CreateCourseUseCase, DeleteCourseUseCase, GenerateCourseTimeSlotsUseCase,
    GetCourseScheduleUseCase, GetTeeSheetUseCase, LinkCourseResourceUseCase,
    ListCaddieAssignmentsUseCase, ListCaddiesUseCase, ListCoursesUseCase, ListProductSlotsUseCase,
    ListReservationProductsUseCase, ListResourcesUseCase, ReplaceCourseScheduleUseCase,
    ReplaceProductSlotsUseCase, UpdateCourseUseCase, UpsertReservationProductUseCase,
};
use crate::{AppError, AppState};

// ─── Shared helpers ───────────────────────────────────────────────────────────

pub(crate) fn catalog_gateway(state: &AppState) -> Arc<FieldGolfCatalogGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldGolfCatalogGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

pub(crate) fn ops_gateway(state: &AppState) -> Arc<FieldGolfOpsGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldGolfOpsGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

pub(crate) fn reservation_gateway(state: &AppState) -> Arc<FieldReservationGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldReservationGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

pub(crate) fn commercial_gateway(state: &AppState) -> Arc<FieldGolfCommercialGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldGolfCommercialGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

pub(crate) fn credentials<'a>(
    state: &'a AppState,
    headers: &'a HeaderMap,
) -> Result<GatewayCredentials<'a>, AppError> {
    // Inbound Authorization was already verified by require_valid_token.
    // Forward the login bearer unless an optional static Field override is set.
    let authorization = if let Some(value) = state
        .cancellation_fee_config
        .field_upstream_authorization
        .as_deref()
    {
        value
    } else {
        bearer_authorization(headers)?
    };
    Ok(GatewayCredentials {
        authorization,
        operator_id: operator_id(headers)?,
        platform_id: optional_header(headers, "x-platform-id"),
    })
}

fn optional_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn bearer_authorization(headers: &HeaderMap) -> Result<&str, AppError> {
    let value = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    if !value.starts_with("Bearer ") || value["Bearer ".len()..].trim().is_empty() {
        return Err(AppError::Unauthorized);
    }
    Ok(value)
}

pub(crate) fn operator_id(headers: &HeaderMap) -> Result<&str, AppError> {
    let value = headers
        .get("x-operator-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(AppError::BadRequest("x-operator-id header is required"))?;
    Ok(value)
}

impl From<CourseError> for AppError {
    fn from(value: CourseError) -> Self {
        match value {
            CourseError::Unauthorized => AppError::Unauthorized,
            CourseError::BadRequest(message) => AppError::BadRequest(message),
            CourseError::UpstreamClient { status, message } => match StatusCode::from_u16(status) {
                Ok(status) if status.is_client_error() => {
                    AppError::UpstreamClient { status, message }
                }
                _ => AppError::Provider(format!(
                    "Field API returned invalid client status {status}: {message}"
                )),
            },
            CourseError::NotFound(message) => AppError::NotFound(message),
            CourseError::Provider(message) => AppError::Provider(message),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemsResponse<T: ToSchema> {
    pub items: Vec<T>,
}

// ─── Tee sheet ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct TeeSheetQueryParams {
    pub date: NaiveDate,
    pub golf_course_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeeSheetItemDto {
    pub id: String,
    pub reservation_number: String,
    pub reservation_service_id: Option<String>,
    pub display_name: Option<String>,
    pub golf_course_id: String,
    pub course_name: String,
    /// Course the booked plan is sold on, when it names one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_course_id: Option<String>,
    /// True when the booking sits on a course its plan is not sold on.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub course_mismatch: bool,
    pub tee_time: String,
    pub duration_minutes: i32,
    pub play_type: String,
    pub party_size: i32,
    pub party_name: String,
    pub status: String,
    pub holes: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeeSheetResponse {
    pub date: NaiveDate,
    pub timezone: String,
    pub day_start: String,
    pub day_end: String,
    pub items: Vec<TeeSheetItemDto>,
    /// Catalog lookups that failed while building this board. Non-empty means
    /// the rows are present but some of their detail is a fallback.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unavailable: Vec<String>,
}

impl From<&TeeSheetItem> for TeeSheetItemDto {
    fn from(value: &TeeSheetItem) -> Self {
        Self {
            id: value.id().to_string(),
            reservation_number: value.reservation_number().to_string(),
            reservation_service_id: value.reservation_service_id().map(str::to_string),
            display_name: value.display_name().map(str::to_string),
            golf_course_id: value.golf_course_id().to_string(),
            course_name: value.course_name().to_string(),
            expected_course_id: value.expected_course_id().map(ToString::to_string),
            course_mismatch: value.course_mismatch(),
            tee_time: value.tee_time().to_string(),
            duration_minutes: value.duration_minutes(),
            play_type: value.play_type().as_str().to_string(),
            party_size: value.party_size(),
            party_name: value.party_name().to_string(),
            status: value.status().as_str().to_string(),
            holes: value.holes(),
            notes: value.notes().map(str::to_string),
        }
    }
}

impl From<TeeSheet> for TeeSheetResponse {
    fn from(value: TeeSheet) -> Self {
        Self {
            date: value.date(),
            timezone: value.timezone().to_string(),
            day_start: value.day_start().to_string(),
            day_end: value.day_end().to_string(),
            items: value.items().iter().map(TeeSheetItemDto::from).collect(),
            unavailable: value.unavailable().to_vec(),
        }
    }
}

/// GET /v1/course/tee-sheet
#[utoipa::path(
    get,
    path = "/v1/course/tee-sheet",
    tag = "course",
    params(TeeSheetQueryParams),
    responses(
        (status = 200, description = "Tee sheet for the requested date", body = TeeSheetResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_tee_sheet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TeeSheetQueryParams>,
) -> Result<Json<TeeSheetResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let reservations = reservation_gateway(&state);
    let catalog = catalog_gateway(&state);
    let use_case = GetTeeSheetUseCase::new(reservations, catalog);
    let sheet = use_case
        .execute(
            credentials,
            TeeSheetQuery {
                date: query.date,
                golf_course_id: CourseId::from_optional(query.golf_course_id),
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(TeeSheetResponse::from(sheet)))
}

// ─── Courses ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CourseDto {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name: Option<String>,
    pub hole_count: i32,
    pub timezone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_hours_json: Option<BusinessHoursDto>,
    pub start_interval_minutes: i32,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BusinessHoursDto {
    pub open: String,
    pub close: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCourseRequest {
    pub name: String,
    pub short_name: Option<String>,
    pub hole_count: i32,
    pub timezone: String,
    pub start_interval_minutes: i32,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

impl From<&Course> for CourseDto {
    fn from(value: &Course) -> Self {
        let business_hours_json = match (value.business_hours_open(), value.business_hours_close())
        {
            (Some(open), Some(close)) => Some(BusinessHoursDto {
                open: open.to_string(),
                close: close.to_string(),
            }),
            _ => None,
        };
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            short_name: value.short_name().map(str::to_string),
            hole_count: value.hole_count().get(),
            timezone: value.timezone().to_string(),
            business_hours_json,
            start_interval_minutes: value.start_interval_minutes().get(),
            is_active: value.is_active(),
            created_at: value.created_at(),
            updated_at: value.updated_at(),
        }
    }
}

fn parse_upsert_course(body: UpsertCourseRequest) -> Result<UpsertCourse, AppError> {
    UpsertCourse::try_new(
        body.name,
        body.short_name,
        body.hole_count,
        body.timezone,
        body.start_interval_minutes,
        body.is_active,
    )
    .map_err(AppError::from)
}

/// GET /v1/course/courses
#[utoipa::path(
    get,
    path = "/v1/course/courses",
    tag = "course",
    responses(
        (status = 200, description = "List golf courses", body = inline(ItemsResponse<CourseDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_courses(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<CourseDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCoursesUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(CourseDto::from).collect(),
    }))
}

/// POST /v1/course/courses
#[utoipa::path(
    post,
    path = "/v1/course/courses",
    tag = "course",
    request_body = UpsertCourseRequest,
    responses(
        (status = 201, description = "Course created", body = CourseDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertCourseRequest>,
) -> Result<(StatusCode, Json<CourseDto>), AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = parse_upsert_course(body)?;
    let use_case = CreateCourseUseCase::new(catalog_gateway(&state));
    let course = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok((StatusCode::CREATED, Json(CourseDto::from(&course))))
}

/// PATCH /v1/course/courses/:id
#[utoipa::path(
    patch,
    path = "/v1/course/courses/{id}",
    tag = "course",
    params(("id" = String, Path, description = "Course ID")),
    request_body = UpsertCourseRequest,
    responses(
        (status = 200, description = "Course updated", body = CourseDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(course_id): Path<String>,
    Json(body): Json<UpsertCourseRequest>,
) -> Result<Json<CourseDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let course_id = CourseId::try_new(course_id).map_err(AppError::from)?;
    let input = parse_upsert_course(body)?;
    let use_case = UpdateCourseUseCase::new(catalog_gateway(&state));
    let course = use_case
        .execute(credentials, &course_id, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CourseDto::from(&course)))
}

/// DELETE /v1/course/courses/:id
#[utoipa::path(
    delete,
    path = "/v1/course/courses/{id}",
    tag = "course",
    params(("id" = String, Path, description = "Course ID")),
    responses(
        (status = 204, description = "Course deleted"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(course_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let course_id = CourseId::try_new(course_id).map_err(AppError::from)?;
    let use_case = DeleteCourseUseCase::new(catalog_gateway(&state));
    use_case
        .execute(credentials, &course_id)
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Resources ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDto {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation_resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub golf_course_id: Option<String>,
    pub resource_kind: String,
    pub active: bool,
}

impl From<&Resource> for ResourceDto {
    fn from(value: &Resource) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            reservation_resource_id: value.reservation_resource_id().map(ToString::to_string),
            golf_course_id: value.golf_course_id().map(ToString::to_string),
            resource_kind: value.kind().as_str().to_string(),
            active: value.is_active(),
        }
    }
}

/// GET /v1/course/resources
#[utoipa::path(
    get,
    path = "/v1/course/resources",
    tag = "course",
    responses(
        (status = 200, description = "List resources", body = inline(ItemsResponse<ResourceDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<ResourceDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListResourcesUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ResourceDto::from).collect(),
    }))
}

/// POST /v1/course/courses/:id/resource
#[utoipa::path(
    post,
    path = "/v1/course/courses/{id}/resource",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    responses(
        (status = 200, description = "The course's reservation resource", body = ResourceDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Course not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn link_course_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ResourceDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = LinkCourseResourceUseCase::new(catalog_gateway(&state));
    let resource = use_case
        .execute(credentials, &CourseId::new(id))
        .await
        .map_err(AppError::from)?;
    Ok(Json(ResourceDto::from(&resource)))
}

// ─── Course schedule and inventory ────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityRuleDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Sunday is 0, as everywhere else in CourseBoard.
    pub weekday: u8,
    pub start_time: String,
    pub end_time: String,
    /// Groups that may be out at once. Never a party size.
    pub capacity: i32,
    pub slot_interval_minutes: i32,
}

impl From<&AvailabilityRule> for AvailabilityRuleDto {
    fn from(value: &AvailabilityRule) -> Self {
        Self {
            id: value.id().map(str::to_string),
            weekday: value.weekday(),
            start_time: value.start_time().to_string(),
            end_time: value.end_time().to_string(),
            capacity: value.capacity(),
            slot_interval_minutes: value.slot_interval_minutes(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceCourseScheduleRequest {
    pub rules: Vec<AvailabilityRuleDto>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCourseTimeSlotsRequest {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Work out the same plan without writing it.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerationSummaryDto {
    pub created: i64,
    pub updated: i64,
    pub deactivated: i64,
    pub unchanged: i64,
}

impl From<GenerationSummary> for GenerationSummaryDto {
    fn from(value: GenerationSummary) -> Self {
        Self {
            created: value.created,
            updated: value.updated,
            deactivated: value.deactivated,
            unchanged: value.unchanged,
        }
    }
}

/// GET /v1/course/courses/:id/schedule
#[utoipa::path(
    get,
    path = "/v1/course/courses/{id}/schedule",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    responses(
        (status = 200, description = "Weekly opening schedule", body = inline(ItemsResponse<AvailabilityRuleDto>)),
        (status = 400, description = "Course is not linked to a resource", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_course_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ItemsResponse<AvailabilityRuleDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let gateway = catalog_gateway(&state);
    let use_case = GetCourseScheduleUseCase::new(gateway.clone(), gateway);
    let rules = use_case
        .execute(credentials, &CourseId::new(id))
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: rules.iter().map(AvailabilityRuleDto::from).collect(),
    }))
}

/// PUT /v1/course/courses/:id/schedule
#[utoipa::path(
    put,
    path = "/v1/course/courses/{id}/schedule",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    request_body = ReplaceCourseScheduleRequest,
    responses(
        (status = 200, description = "Schedule replaced", body = inline(ItemsResponse<AvailabilityRuleDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_course_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ReplaceCourseScheduleRequest>,
) -> Result<Json<ItemsResponse<AvailabilityRuleDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let rules = body
        .rules
        .into_iter()
        .map(|rule| {
            AvailabilityRule::try_new(
                rule.id,
                rule.weekday,
                rule.start_time,
                rule.end_time,
                rule.capacity,
                rule.slot_interval_minutes,
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    let gateway = catalog_gateway(&state);
    let use_case = ReplaceCourseScheduleUseCase::new(gateway.clone(), gateway);
    let saved = use_case
        .execute(credentials, &CourseId::new(id), rules)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: saved.iter().map(AvailabilityRuleDto::from).collect(),
    }))
}

/// POST /v1/course/courses/:id/time-slots/generate
#[utoipa::path(
    post,
    path = "/v1/course/courses/{id}/time-slots/generate",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    request_body = GenerateCourseTimeSlotsRequest,
    responses(
        (status = 200, description = "Inventory generated", body = GenerationSummaryDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn generate_course_time_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<GenerateCourseTimeSlotsRequest>,
) -> Result<Json<GenerationSummaryDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let gateway = catalog_gateway(&state);
    let use_case = GenerateCourseTimeSlotsUseCase::new(gateway.clone(), gateway);
    let summary = use_case
        .execute(
            credentials,
            &CourseId::new(id),
            body.from,
            body.to,
            body.dry_run,
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(GenerationSummaryDto::from(summary)))
}

// ─── Reservation products ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationProductDto {
    pub id: String,
    pub tenant_id: String,
    pub extension_key: String,
    pub reservation_service_id: String,
    pub display_name: Option<String>,
    pub play_type: String,
    pub hole_count: i32,
    pub expected_duration_minutes: i32,
    pub golf_course_id: Option<String>,
    /// Players allowed in one group; falls back to the reservation policy.
    pub max_players_per_group: Option<i32>,
}

impl From<&ReservationProduct> for ReservationProductDto {
    fn from(value: &ReservationProduct) -> Self {
        Self {
            id: value.id().to_string(),
            tenant_id: value
                .tenant_id()
                .map(ToString::to_string)
                .unwrap_or_default(),
            extension_key: "golf_course".to_string(),
            reservation_service_id: value.reservation_service_id().to_string(),
            display_name: value.display_name().map(str::to_string),
            play_type: value.play_type().as_str().to_string(),
            hole_count: value.hole_count().get(),
            expected_duration_minutes: value.expected_duration_minutes().get(),
            golf_course_id: value.golf_course_id().map(ToString::to_string),
            max_players_per_group: value.max_players_per_group(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertReservationProductRequest {
    pub display_name: Option<String>,
    pub play_type: String,
    pub hole_count: Option<i32>,
    pub expected_duration_minutes: Option<i32>,
    pub golf_course_id: Option<String>,
    pub max_players_per_group: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductSlotDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub weekday: u8,
    pub start_time: String,
    pub end_time: String,
    pub max_groups: i32,
    pub max_players: i32,
}

impl From<&ProductSlot> for ProductSlotDto {
    fn from(value: &ProductSlot) -> Self {
        Self {
            id: value.id().map(ToString::to_string),
            weekday: value.weekday(),
            start_time: value.start_time().to_string(),
            end_time: value.end_time().to_string(),
            max_groups: value.max_groups(),
            max_players: value.max_players(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceProductSlotsRequest {
    pub slots: Vec<ProductSlotDto>,
}

/// GET /v1/course/reservation-products
#[utoipa::path(
    get,
    path = "/v1/course/reservation-products",
    tag = "course",
    responses(
        (status = 200, description = "List reservation products", body = inline(ItemsResponse<ReservationProductDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_reservation_products(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<ReservationProductDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListReservationProductsUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ReservationProductDto::from).collect(),
    }))
}

/// POST /v1/course/reservation-products/:service_id
#[utoipa::path(
    post,
    path = "/v1/course/reservation-products/{service_id}",
    tag = "course",
    params(("service_id" = String, Path, description = "Reservation service ID")),
    request_body = UpsertReservationProductRequest,
    responses(
        (status = 200, description = "Reservation product upserted", body = ReservationProductDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn upsert_reservation_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(body): Json<UpsertReservationProductRequest>,
) -> Result<Json<ReservationProductDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = UpsertReservationProduct::try_new(
        service_id,
        body.display_name,
        body.play_type,
        body.hole_count.unwrap_or(18),
        body.expected_duration_minutes.unwrap_or(270),
        body.golf_course_id,
        body.max_players_per_group,
    )
    .map_err(AppError::from)?;
    let use_case = UpsertReservationProductUseCase::new(catalog_gateway(&state));
    let product = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationProductDto::from(&product)))
}

/// GET /v1/course/reservation-products/:service_id/slots
#[utoipa::path(
    get,
    path = "/v1/course/reservation-products/{service_id}/slots",
    tag = "course",
    params(("service_id" = String, Path, description = "Reservation service ID")),
    responses(
        (status = 200, description = "List product slots", body = inline(ItemsResponse<ProductSlotDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_product_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
) -> Result<Json<ItemsResponse<ProductSlotDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let service_id = ReservationServiceId::try_new(service_id).map_err(AppError::from)?;
    let use_case = ListProductSlotsUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials, &service_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ProductSlotDto::from).collect(),
    }))
}

/// PUT /v1/course/reservation-products/:service_id/slots
#[utoipa::path(
    put,
    path = "/v1/course/reservation-products/{service_id}/slots",
    tag = "course",
    params(("service_id" = String, Path, description = "Reservation service ID")),
    request_body = ReplaceProductSlotsRequest,
    responses(
        (status = 200, description = "Product slots replaced", body = inline(ItemsResponse<ProductSlotDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_product_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(body): Json<ReplaceProductSlotsRequest>,
) -> Result<Json<ItemsResponse<ProductSlotDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let service_id = ReservationServiceId::try_new(service_id).map_err(AppError::from)?;
    let slots = body
        .slots
        .into_iter()
        .map(|slot| {
            ProductSlot::reconstitute(
                slot.id,
                slot.weekday,
                slot.start_time,
                slot.end_time,
                slot.max_groups,
                slot.max_players,
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let use_case = ReplaceProductSlotsUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials, &service_id, slots)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ProductSlotDto::from).collect(),
    }))
}

// ─── Caddies / assignments ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieDto {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<String>,
    pub active: bool,
    pub skill_level: String,
    pub rank: String,
    pub employment_status: String,
    pub base_fee_amount: i64,
    pub currency: String,
    pub max_rounds_per_day: i32,
    pub can_two_rounds: bool,
    pub monthly_contract_rounds: i32,
    pub desired_income: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating_average: Option<f64>,
    pub rating_count: i64,
}

impl From<&Caddie> for CaddieDto {
    fn from(value: &Caddie) -> Self {
        Self {
            id: value.id().to_string(),
            display_name: value.display_name().to_string(),
            staff_id: value.staff_id().map(str::to_string),
            active: value.is_active(),
            skill_level: value.skill_level().as_str().to_string(),
            rank: value.rank().as_str().to_string(),
            employment_status: value.employment_status().to_string(),
            base_fee_amount: value.base_fee_amount(),
            currency: value.currency().to_string(),
            max_rounds_per_day: value.max_rounds_per_day(),
            can_two_rounds: value.can_two_rounds(),
            monthly_contract_rounds: value.monthly_contract_rounds(),
            desired_income: value.desired_income(),
            rating_average: value.rating_average(),
            rating_count: value.rating_count(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieStaffDto {
    pub id: String,
    pub name: String,
    pub active: bool,
}

impl From<&CaddieStaff> for CaddieStaffDto {
    fn from(value: &CaddieStaff) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            active: value.is_active(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieRosterResponse {
    pub items: Vec<CaddieDto>,
    pub staff: Vec<CaddieStaffDto>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieAssignmentDto {
    pub id: String,
    /// Kept as `caddieProfileId` for Timeline / Caddies UI compatibility.
    pub caddie_profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_reference: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<i32>,
    pub status: String,
    pub assignment_role: String,
    pub fee_amount: i64,
    pub fee_currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl From<&CaddieAssignment> for CaddieAssignmentDto {
    fn from(value: &CaddieAssignment) -> Self {
        Self {
            id: value.id().to_string(),
            caddie_profile_id: value.caddie_id().to_string(),
            reservation_id: value.reservation_id().map(ToString::to_string),
            round_reference: value.round_reference().map(str::to_string),
            scheduled_at: value.scheduled_at(),
            duration_minutes: value.duration_minutes(),
            status: value.status_label().to_string(),
            assignment_role: value.role_label().to_string(),
            fee_amount: value.fee_amount(),
            fee_currency: value.fee_currency().to_string(),
            notes: value.notes().map(str::to_string),
        }
    }
}

/// GET /v1/course/caddie-profiles
#[utoipa::path(
    get,
    path = "/v1/course/caddie-profiles",
    tag = "course-ops",
    responses(
        (status = 200, description = "List caddie profiles and reusable staff index", body = CaddieRosterResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddies(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CaddieRosterResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddiesUseCase::new(ops_gateway(&state));
    let roster = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieRosterResponse {
        items: roster.caddies().iter().map(CaddieDto::from).collect(),
        staff: roster.staff().iter().map(CaddieStaffDto::from).collect(),
    }))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct CaddieAssignmentQueryParams {
    pub caddie_profile_id: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

/// GET /v1/course/caddie-assignments
#[utoipa::path(
    get,
    path = "/v1/course/caddie-assignments",
    tag = "course-ops",
    params(CaddieAssignmentQueryParams),
    responses(
        (status = 200, description = "List caddie assignments", body = inline(ItemsResponse<CaddieAssignmentDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CaddieAssignmentQueryParams>,
) -> Result<Json<ItemsResponse<CaddieAssignmentDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddieAssignmentsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(
            credentials,
            CaddieAssignmentQuery {
                caddie_id: CaddieId::from_optional(query.caddie_profile_id),
                from: query.from,
                to: query.to,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(CaddieAssignmentDto::from).collect(),
    }))
}
