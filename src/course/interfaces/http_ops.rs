//! Axum handlers for caddie operations under `/v1/course/*`.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header::CONTENT_TYPE, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::openapi::ErrorBody;

use super::http::{
    catalog_gateway, credentials, ops_gateway, reservation_gateway, CaddieAssignmentDto, CaddieDto,
    ItemsResponse,
};
use crate::course::domain::{
    AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AutoAssignResult,
    AvailabilityQuery, CaddieAvailability, CaddieCourseMembership, CaddieId, CaddiePatch,
    CaddieRating, CaddieRecommendation, CaddieSupply, PayrollSummary, RecommendationQuery,
    ReplaceCaddieMemberships, ReservationId, UpsertCaddie, UpsertCaddieAssignment,
    UpsertCaddieAvailability,
};
use crate::course::usecase::{
    AutoAssignCaddiesUseCase, CreateCaddieUseCase, DeleteCaddieAvailabilityUseCase,
    ExportPayrollCsvUseCase, GetAttendanceSnapshotUseCase, GetCaddieSupplyUseCase,
    GetPayrollSummaryUseCase, ListAttendancePeriodSnapshotsUseCase,
    ListCaddieAvailabilitiesUseCase, ListCaddieMembershipsUseCase, ListCaddieRatingsUseCase,
    ListCaddieRecommendationsUseCase, ReplaceCaddieMembershipsUseCase,
    UpdateCaddieAssignmentUseCase, UpdateCaddieUseCase, UpsertCaddieAvailabilityUseCase,
};
use crate::{AppError, AppState};

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCaddieRequest {
    pub display_name: String,
    pub skill_level: String,
    #[serde(default)]
    pub rank: Option<String>,
    pub base_fee_amount: i64,
    #[serde(default)]
    pub currency: Option<String>,
    /// Staff member this caddie is a role of. Leave the staff fields unset to
    /// register a staff member named `displayName` and link that one.
    #[serde(default)]
    pub staff_id: Option<String>,
    #[serde(default)]
    pub staff_reference_type: Option<String>,
    #[serde(default)]
    pub staff_reference_id: Option<String>,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub employment_status: Option<String>,
    #[serde(default)]
    pub max_rounds_per_day: Option<i32>,
    #[serde(default)]
    pub monthly_contract_rounds: Option<i32>,
    #[serde(default)]
    pub can_two_rounds: Option<bool>,
    #[serde(default)]
    pub desired_income: Option<i32>,
}

fn default_true() -> bool {
    true
}

/// PATCH body: every field is optional so an omitted field means "leave as is".
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchCaddieRequest {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub skill_level: Option<String>,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default)]
    pub base_fee_amount: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub staff_id: Option<String>,
    #[serde(default)]
    pub staff_reference_type: Option<String>,
    #[serde(default)]
    pub staff_reference_id: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub employment_status: Option<String>,
    #[serde(default)]
    pub max_rounds_per_day: Option<i32>,
    #[serde(default)]
    pub monthly_contract_rounds: Option<i32>,
    #[serde(default)]
    pub can_two_rounds: Option<bool>,
    #[serde(default)]
    pub desired_income: Option<i32>,
}

impl From<PatchCaddieRequest> for CaddiePatch {
    fn from(body: PatchCaddieRequest) -> Self {
        Self {
            display_name: body.display_name,
            skill_level: body.skill_level,
            rank: body.rank,
            base_fee_amount: body.base_fee_amount,
            currency: body.currency,
            staff_id: body.staff_id,
            staff_reference_type: body.staff_reference_type,
            staff_reference_id: body.staff_reference_id,
            active: body.active,
            employment_status: body.employment_status,
            max_rounds_per_day: body.max_rounds_per_day,
            monthly_contract_rounds: body.monthly_contract_rounds,
            can_two_rounds: body.can_two_rounds,
            desired_income: body.desired_income,
        }
    }
}

fn parse_upsert_caddie(body: UpsertCaddieRequest) -> Result<UpsertCaddie, AppError> {
    UpsertCaddie::try_new(
        body.display_name,
        body.skill_level,
        body.rank.unwrap_or_else(|| "C".into()),
        body.base_fee_amount,
        body.currency,
        body.staff_id,
        body.staff_reference_type,
        body.staff_reference_id,
        body.active,
        body.employment_status,
        body.max_rounds_per_day,
        body.monthly_contract_rounds,
        body.can_two_rounds,
        body.desired_income,
    )
    .map_err(AppError::from)
}

/// POST /v1/course/caddie-profiles
#[utoipa::path(
    post,
    path = "/v1/course/caddie-profiles",
    tag = "course-ops",
    request_body = UpsertCaddieRequest,
    responses(
        (status = 201, description = "Caddie created", body = CaddieDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_caddie(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertCaddieRequest>,
) -> Result<(StatusCode, Json<CaddieDto>), AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = parse_upsert_caddie(body)?;
    let use_case = CreateCaddieUseCase::new(ops_gateway(&state));
    let caddie = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok((StatusCode::CREATED, Json(CaddieDto::from(&caddie))))
}

/// PATCH /v1/course/caddie-profiles/:id
#[utoipa::path(
    patch,
    path = "/v1/course/caddie-profiles/{id}",
    tag = "course-ops",
    params(("id" = String, Path, description = "Caddie profile ID")),
    request_body = PatchCaddieRequest,
    responses(
        (status = 200, description = "Caddie updated", body = CaddieDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Caddie not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_caddie(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(caddie_id): Path<String>,
    Json(body): Json<PatchCaddieRequest>,
) -> Result<Json<CaddieDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::try_new(caddie_id).map_err(AppError::from)?;
    let use_case = UpdateCaddieUseCase::new(ops_gateway(&state));
    let caddie = use_case
        .execute(credentials, &caddie_id, CaddiePatch::from(body))
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieDto::from(&caddie)))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCaddieAssignmentRequest {
    pub caddie_profile_id: String,
    #[serde(default)]
    pub reservation_id: Option<String>,
    #[serde(default)]
    pub round_reference: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub assignment_role: Option<String>,
    #[serde(default)]
    pub fee_amount: Option<i64>,
    #[serde(default)]
    pub fee_currency: Option<String>,
    #[serde(default)]
    pub recommendation_score: Option<i32>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// PATCH /v1/course/caddie-assignments/:id
#[utoipa::path(
    patch,
    path = "/v1/course/caddie-assignments/{id}",
    tag = "course-ops",
    params(("id" = String, Path, description = "Assignment ID")),
    request_body = UpsertCaddieAssignmentRequest,
    responses(
        (status = 200, description = "Assignment updated", body = CaddieAssignmentDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_caddie_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(assignment_id): Path<String>,
    Json(body): Json<UpsertCaddieAssignmentRequest>,
) -> Result<Json<CaddieAssignmentDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let assignment_id = AssignmentId::try_new(assignment_id).map_err(AppError::from)?;
    let input = UpsertCaddieAssignment::try_new(
        body.caddie_profile_id,
        body.reservation_id,
        body.round_reference,
        body.scheduled_at,
        body.status,
        body.assignment_role,
        body.fee_amount,
        body.fee_currency,
        body.recommendation_score,
        body.notes,
    )
    .map_err(AppError::from)?;
    let use_case = UpdateCaddieAssignmentUseCase::new(ops_gateway(&state));
    let assignment = use_case
        .execute(credentials, &assignment_id, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieAssignmentDto::from(&assignment)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MembershipDto {
    pub id: String,
    pub caddie_profile_id: String,
    pub golf_course_id: String,
    pub is_primary: bool,
}

impl From<&CaddieCourseMembership> for MembershipDto {
    fn from(value: &CaddieCourseMembership) -> Self {
        Self {
            id: value.id().to_string(),
            caddie_profile_id: value.caddie_id().to_string(),
            golf_course_id: value.golf_course_id().to_string(),
            is_primary: value.is_primary(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceMembershipsRequest {
    pub course_ids: Vec<String>,
    #[serde(default)]
    pub primary_course_id: Option<String>,
}

/// GET /v1/course/caddie-profiles/:id/courses
#[utoipa::path(
    get,
    path = "/v1/course/caddie-profiles/{id}/courses",
    tag = "course-ops",
    params(("id" = String, Path, description = "Caddie profile ID")),
    responses(
        (status = 200, description = "List caddie course memberships", body = inline(ItemsResponse<MembershipDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_memberships(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(caddie_id): Path<String>,
) -> Result<Json<ItemsResponse<MembershipDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::try_new(caddie_id).map_err(AppError::from)?;
    let use_case = ListCaddieMembershipsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(credentials, &caddie_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(MembershipDto::from).collect(),
    }))
}

/// PUT /v1/course/caddie-profiles/:id/courses
#[utoipa::path(
    put,
    path = "/v1/course/caddie-profiles/{id}/courses",
    tag = "course-ops",
    params(("id" = String, Path, description = "Caddie profile ID")),
    request_body = ReplaceMembershipsRequest,
    responses(
        (status = 200, description = "Memberships replaced", body = inline(ItemsResponse<MembershipDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_caddie_memberships(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(caddie_id): Path<String>,
    Json(body): Json<ReplaceMembershipsRequest>,
) -> Result<Json<ItemsResponse<MembershipDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::try_new(caddie_id).map_err(AppError::from)?;
    let input = ReplaceCaddieMemberships::try_new(body.course_ids, body.primary_course_id)
        .map_err(AppError::from)?;
    let use_case = ReplaceCaddieMembershipsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(credentials, &caddie_id, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(MembershipDto::from).collect(),
    }))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityDto {
    pub id: String,
    pub caddie_profile_id: String,
    pub date: NaiveDate,
    pub status: String,
    pub two_round_request: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

impl From<&CaddieAvailability> for AvailabilityDto {
    fn from(value: &CaddieAvailability) -> Self {
        Self {
            id: value.id().to_string(),
            caddie_profile_id: value.caddie_id().to_string(),
            date: value.date(),
            status: value.status().as_str().to_string(),
            two_round_request: value.two_round_request(),
            health_note: value.health_note().map(str::to_string),
            updated_at: value.updated_at(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityQueryParams {
    pub caddie_profile_id: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAvailabilityRequest {
    pub caddie_profile_id: String,
    pub date: NaiveDate,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub two_round_request: Option<bool>,
    #[serde(default)]
    pub health_note: Option<String>,
}

/// GET /v1/course/caddie-availabilities
#[utoipa::path(
    get,
    path = "/v1/course/caddie-availabilities",
    tag = "course-ops",
    params(AvailabilityQueryParams),
    responses(
        (status = 200, description = "List caddie availabilities", body = inline(ItemsResponse<AvailabilityDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_availabilities(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AvailabilityQueryParams>,
) -> Result<Json<ItemsResponse<AvailabilityDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddieAvailabilitiesUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(
            credentials,
            AvailabilityQuery {
                caddie_id: CaddieId::from_optional(query.caddie_profile_id),
                from: query.from,
                to: query.to,
                date: query.date,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(AvailabilityDto::from).collect(),
    }))
}

/// POST /v1/course/caddie-availabilities
#[utoipa::path(
    post,
    path = "/v1/course/caddie-availabilities",
    tag = "course-ops",
    request_body = UpsertAvailabilityRequest,
    responses(
        (status = 201, description = "Availability upserted", body = AvailabilityDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn upsert_caddie_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertAvailabilityRequest>,
) -> Result<(StatusCode, Json<AvailabilityDto>), AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = UpsertCaddieAvailability::try_new(
        body.caddie_profile_id,
        body.date,
        body.status.unwrap_or_else(|| "available".into()),
        body.two_round_request.unwrap_or(false),
        body.health_note,
    )
    .map_err(AppError::from)?;
    let use_case = UpsertCaddieAvailabilityUseCase::new(ops_gateway(&state));
    let item = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok((StatusCode::CREATED, Json(AvailabilityDto::from(&item))))
}

/// DELETE /v1/course/caddie-availabilities/:caddie_id/:date
#[utoipa::path(
    delete,
    path = "/v1/course/caddie-availabilities/{caddie_id}/{date}",
    tag = "course-ops",
    params(
        ("caddie_id" = String, Path, description = "Caddie profile ID"),
        ("date" = String, Path, description = "Availability date (YYYY-MM-DD)"),
    ),
    responses(
        (status = 204, description = "Availability deleted"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_caddie_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((caddie_id, date)): Path<(String, NaiveDate)>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::try_new(caddie_id).map_err(AppError::from)?;
    let use_case = DeleteCaddieAvailabilityUseCase::new(ops_gateway(&state));
    use_case
        .execute(credentials, &caddie_id, date)
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationDto {
    pub caddie_profile_id: String,
    pub display_name: String,
    pub skill_level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating_average: Option<f64>,
    pub rating_count: i64,
    pub rounds_assigned: i64,
    pub recommendation_score: i32,
    pub recommended_role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing_display_name: Option<String>,
    pub rationale: Vec<String>,
}

impl From<&CaddieRecommendation> for RecommendationDto {
    fn from(value: &CaddieRecommendation) -> Self {
        Self {
            caddie_profile_id: value.caddie_id().to_string(),
            display_name: value.display_name().to_string(),
            skill_level: value.skill_level().as_str().to_string(),
            rating_average: value.rating_average(),
            rating_count: value.rating_count(),
            rounds_assigned: value.rounds_assigned(),
            recommendation_score: value.recommendation_score(),
            recommended_role: value.recommended_role().to_string(),
            pairing_display_name: value.pairing_display_name().map(str::to_string),
            rationale: value.rationale().to_vec(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationQueryParams {
    pub reservation_id: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub player_count: Option<i32>,
    #[serde(default)]
    pub include_rookie_pairing: bool,
    pub limit: Option<u32>,
}

/// GET /v1/course/caddie-recommendations
#[utoipa::path(
    get,
    path = "/v1/course/caddie-recommendations",
    tag = "course-ops",
    params(RecommendationQueryParams),
    responses(
        (status = 200, description = "List caddie recommendations", body = inline(ItemsResponse<RecommendationDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_recommendations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RecommendationQueryParams>,
) -> Result<Json<ItemsResponse<RecommendationDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddieRecommendationsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(
            credentials,
            RecommendationQuery {
                reservation_id: ReservationId::from_optional(query.reservation_id),
                scheduled_at: query.scheduled_at,
                player_count: query.player_count,
                include_rookie_pairing: query.include_rookie_pairing,
                limit: query.limit,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(RecommendationDto::from).collect(),
    }))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceSnapshotDto {
    pub caddie_profile_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<String>,
    pub attendance_status: String,
    pub today_assignments: i64,
    pub rounds_without_clock_in_today: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceReportDto {
    pub date: NaiveDate,
    pub items: Vec<AttendanceSnapshotDto>,
}

impl From<AttendanceSnapshotReport> for AttendanceReportDto {
    fn from(value: AttendanceSnapshotReport) -> Self {
        Self {
            date: value.date(),
            items: value
                .items()
                .iter()
                .map(|item| AttendanceSnapshotDto {
                    caddie_profile_id: item.caddie_id().to_string(),
                    display_name: item.display_name().to_string(),
                    staff_id: item.staff_id().map(str::to_string),
                    attendance_status: item.attendance_status().to_string(),
                    today_assignments: item.today_assignments(),
                    rounds_without_clock_in_today: item.rounds_without_clock_in_today(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceQueryParams {
    pub date: Option<NaiveDate>,
}

/// GET /v1/course/caddie-attendance-snapshot
#[utoipa::path(
    get,
    path = "/v1/course/caddie-attendance-snapshot",
    tag = "course-ops",
    params(AttendanceQueryParams),
    responses(
        (status = 200, description = "Attendance snapshot", body = AttendanceReportDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_attendance_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AttendanceQueryParams>,
) -> Result<Json<AttendanceReportDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetAttendanceSnapshotUseCase::new(ops_gateway(&state));
    let report = use_case
        .execute(credentials, query.date)
        .await
        .map_err(AppError::from)?;
    Ok(Json(AttendanceReportDto::from(report)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttendancePeriodSnapshotDto {
    pub caddie_profile_id: String,
    pub date: NaiveDate,
    pub attendance_status: String,
}

impl From<&AttendancePeriodSnapshot> for AttendancePeriodSnapshotDto {
    fn from(value: &AttendancePeriodSnapshot) -> Self {
        Self {
            caddie_profile_id: value.caddie_id().to_string(),
            date: value.date(),
            attendance_status: value.attendance_status().to_string(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct AttendancePeriodQueryParams {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// GET /v1/course/caddie-attendance-snapshots
#[utoipa::path(
    get,
    path = "/v1/course/caddie-attendance-snapshots",
    tag = "course-ops",
    params(AttendancePeriodQueryParams),
    responses(
        (status = 200, description = "Attendance snapshots for an inclusive period", body = inline(ItemsResponse<AttendancePeriodSnapshotDto>)),
        (status = 400, description = "Invalid attendance period", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_attendance_period_snapshots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AttendancePeriodQueryParams>,
) -> Result<Json<ItemsResponse<AttendancePeriodSnapshotDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListAttendancePeriodSnapshotsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(credentials, query.from, query.to)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items
            .iter()
            .map(AttendancePeriodSnapshotDto::from)
            .collect(),
    }))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieSupplyDto {
    pub date: NaiveDate,
    pub available_caddies: i64,
    pub two_round_capable: i64,
    pub caddie_supply: i64,
    pub morning_capacity: i64,
    pub afternoon_capacity: i64,
    pub safety_buffer: i64,
    pub caddie_attached_cap: i64,
    pub current_caddie_attached: i64,
    pub remaining: i64,
}

impl From<&CaddieSupply> for CaddieSupplyDto {
    fn from(value: &CaddieSupply) -> Self {
        Self {
            date: value.date(),
            available_caddies: value.available_caddies(),
            two_round_capable: value.two_round_capable(),
            caddie_supply: value.caddie_supply(),
            morning_capacity: value.morning_capacity(),
            afternoon_capacity: value.afternoon_capacity(),
            safety_buffer: value.safety_buffer(),
            caddie_attached_cap: value.caddie_attached_cap(),
            current_caddie_attached: value.current_caddie_attached(),
            remaining: value.remaining(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct SupplyQueryParams {
    pub date: NaiveDate,
    pub safety_buffer: Option<i64>,
}

/// GET /v1/course/caddie-supply
#[utoipa::path(
    get,
    path = "/v1/course/caddie-supply",
    tag = "course-ops",
    params(SupplyQueryParams),
    responses(
        (status = 200, description = "Caddie supply summary", body = CaddieSupplyDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_caddie_supply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SupplyQueryParams>,
) -> Result<Json<CaddieSupplyDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetCaddieSupplyUseCase::new(
        ops_gateway(&state),
        catalog_gateway(&state),
        reservation_gateway(&state),
    );
    let supply = use_case
        .execute(credentials, query.date, query.safety_buffer)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieSupplyDto::from(&supply)))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoAssignRequest {
    pub date: NaiveDate,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoAssignPlanItemDto {
    pub reservation_id: String,
    pub scheduled_at: DateTime<Utc>,
    pub caddie_profile_id: String,
    pub caddie_display_name: String,
    pub rationale: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoAssignSkippedDto {
    pub reservation_id: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoAssignResultDto {
    pub dry_run: bool,
    pub assigned: Vec<AutoAssignPlanItemDto>,
    pub skipped: Vec<AutoAssignSkippedDto>,
}

impl From<AutoAssignResult> for AutoAssignResultDto {
    fn from(value: AutoAssignResult) -> Self {
        Self {
            dry_run: value.dry_run(),
            assigned: value
                .assigned()
                .iter()
                .map(|item| AutoAssignPlanItemDto {
                    reservation_id: item.reservation_id().to_string(),
                    scheduled_at: item.scheduled_at(),
                    caddie_profile_id: item.caddie_id().to_string(),
                    caddie_display_name: item.caddie_display_name().to_string(),
                    rationale: item.rationale().to_vec(),
                })
                .collect(),
            skipped: value
                .skipped()
                .iter()
                .map(|item| AutoAssignSkippedDto {
                    reservation_id: item.reservation_id().to_string(),
                    reason: item.reason().to_string(),
                })
                .collect(),
        }
    }
}

/// POST /v1/course/caddie-auto-assignments
#[utoipa::path(
    post,
    path = "/v1/course/caddie-auto-assignments",
    tag = "course-ops",
    request_body = AutoAssignRequest,
    responses(
        (status = 200, description = "Auto-assignment plan", body = AutoAssignResultDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn auto_assign_caddies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AutoAssignRequest>,
) -> Result<Json<AutoAssignResultDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = AutoAssignCaddiesUseCase::new(ops_gateway(&state), reservation_gateway(&state));
    let result = use_case
        .execute(credentials, body.date, body.dry_run)
        .await
        .map_err(AppError::from)?;
    Ok(Json(AutoAssignResultDto::from(result)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayrollPeriodDto {
    pub year_month: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayrollRowDto {
    pub caddie_profile_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<String>,
    pub worked_minutes: i64,
    pub shifted_minutes: i64,
    pub assigned_rounds: i64,
    pub confirmed_fee_total: i64,
    pub currency: String,
    pub open_clock_in: bool,
    pub rounds_without_clock_in: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayrollSummaryDto {
    pub period: PayrollPeriodDto,
    pub items: Vec<PayrollRowDto>,
}

impl From<&PayrollSummary> for PayrollSummaryDto {
    fn from(value: &PayrollSummary) -> Self {
        Self {
            period: PayrollPeriodDto {
                year_month: value.period().year_month().to_string(),
                start_date: value.period().start_date(),
                end_date: value.period().end_date(),
            },
            items: value
                .items()
                .iter()
                .map(|row| PayrollRowDto {
                    caddie_profile_id: row.caddie_id().to_string(),
                    display_name: row.display_name().to_string(),
                    staff_id: row.staff_id().map(str::to_string),
                    worked_minutes: row.worked_minutes(),
                    shifted_minutes: row.shifted_minutes(),
                    assigned_rounds: row.assigned_rounds(),
                    confirmed_fee_total: row.confirmed_fee_total(),
                    currency: row.currency().to_string(),
                    open_clock_in: row.open_clock_in(),
                    rounds_without_clock_in: row.rounds_without_clock_in(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[schema(as = OpsYearMonthQuery)]
#[serde(rename_all = "camelCase")]
pub struct YearMonthQuery {
    pub year_month: String,
}

/// GET /v1/course/caddie-payroll-summary
#[utoipa::path(
    get,
    path = "/v1/course/caddie-payroll-summary",
    tag = "course-ops",
    params(YearMonthQuery),
    responses(
        (status = 200, description = "Payroll summary", body = PayrollSummaryDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_payroll_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<YearMonthQuery>,
) -> Result<Json<PayrollSummaryDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetPayrollSummaryUseCase::new(ops_gateway(&state));
    let summary = use_case
        .execute(credentials, &query.year_month)
        .await
        .map_err(AppError::from)?;
    Ok(Json(PayrollSummaryDto::from(&summary)))
}

/// GET /v1/course/caddie-payroll-summary/export.csv
#[utoipa::path(
    get,
    path = "/v1/course/caddie-payroll-summary/export.csv",
    tag = "course-ops",
    params(YearMonthQuery),
    responses(
        (status = 200, description = "Payroll CSV export", content_type = "text/csv"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn export_payroll_csv(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<YearMonthQuery>,
) -> Result<impl IntoResponse, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ExportPayrollCsvUseCase::new(ops_gateway(&state));
    let csv = use_case
        .execute(credentials, &query.year_month)
        .await
        .map_err(AppError::from)?;
    Ok(csv_response(csv))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RatingDto {
    pub id: String,
    pub caddie_profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation_id: Option<String>,
    pub customer_id: String,
    pub score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
}

impl From<&CaddieRating> for RatingDto {
    fn from(value: &CaddieRating) -> Self {
        Self {
            id: value.id().to_string(),
            caddie_profile_id: value.caddie_id().to_string(),
            assignment_id: value.assignment_id().map(ToString::to_string),
            reservation_id: value.reservation_id().map(ToString::to_string),
            customer_id: value.customer_id().to_string(),
            score: value.score(),
            comment: value.comment().map(str::to_string),
            created_at: value.created_at(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct RatingsQueryParams {
    pub caddie_profile_id: Option<String>,
}

/// GET /v1/course/caddie-ratings
#[utoipa::path(
    get,
    path = "/v1/course/caddie-ratings",
    tag = "course-ops",
    params(RatingsQueryParams),
    responses(
        (status = 200, description = "List caddie ratings", body = inline(ItemsResponse<RatingDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_ratings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RatingsQueryParams>,
) -> Result<Json<ItemsResponse<RatingDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::from_optional(query.caddie_profile_id);
    let use_case = ListCaddieRatingsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(credentials, caddie_id.as_ref())
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(RatingDto::from).collect(),
    }))
}

fn csv_response(csv: String) -> impl IntoResponse {
    (
        StatusCode::OK,
        [(
            CONTENT_TYPE,
            HeaderValue::from_static("text/csv; charset=utf-8"),
        )],
        Bytes::from(csv),
    )
}
