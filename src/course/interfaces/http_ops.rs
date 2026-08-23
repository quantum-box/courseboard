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
    caddie_rank_fee_gateway, catalog_gateway, credentials, ops_gateway, reservation_gateway,
    CaddieAssignmentDto, CaddieDto, ItemsResponse,
};
use crate::course::domain::{
    parse_weekday, weekday_key, AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport,
    AutoAssignResult, AvailabilityDeadline, AvailabilityQuery, CaddieAvailability,
    CaddieCourseMembership, CaddieId, CaddiePatch, CaddieRank, CaddieRankFees, CaddieRating,
    CaddieRecommendation, CaddieShift, CaddieSupply, CourseError, CourseId, DayCaddieSupply,
    GolfCatalogGateway, PayrollSummary, RecommendationQuery, ReplaceCaddieMemberships,
    ReservationId, ShiftEdit, ShiftPolicy, ShiftSpan, UnfiledRequest, UpsertCaddie,
    UpsertCaddieAssignment, UpsertCaddieAvailability, YearMonth, MAX_CONSECUTIVE_WORK_DAYS,
    MAX_ROUNDS_PER_SHIFT,
};
use crate::course::usecase::{
    AutoAssignCaddiesUseCase, CreateCaddieAssignmentUseCase, CreateCaddieUseCase,
    DeleteCaddieAvailabilityUseCase, DeleteCaddieUseCase, ExportPayrollCsvUseCase,
    GenerateCaddieShiftsUseCase, GeneratedMonth, GetAttendanceSnapshotUseCase,
    GetAvailabilityDeadlineUseCase, GetCaddieRankFeesUseCase, GetCaddieSupplyUseCase,
    GetCourseCaddieSupplyUseCase, GetPayrollSummaryUseCase, GetShiftRulesUseCase,
    ListAttendancePeriodSnapshotsUseCase, ListCaddieAvailabilitiesUseCase,
    ListCaddieMembershipsUseCase, ListCaddieRatingsUseCase, ListCaddieRecommendationsUseCase,
    ListCaddieShiftsUseCase, ListCourseReinforcementsUseCase, ListUnsubmittedCaddiesUseCase,
    NameCaddieForRound, ReinforcementCandidate, ReplaceCaddieMembershipsUseCase,
    ReplaceCaddieRankFeesUseCase, ShiftPlanMode, UpdateCaddieAssignmentUseCase,
    UpdateCaddieShiftUseCase, UpdateCaddieUseCase, UpdateShiftRulesUseCase,
    UpsertAvailabilityDeadlineUseCase, UpsertCaddieAvailabilityUseCase,
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
        (status = 409, description = "Field resource conflict", body = ErrorBody),
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

/// DELETE /v1/course/caddie-profiles/:id
#[utoipa::path(
    delete,
    path = "/v1/course/caddie-profiles/{id}",
    tag = "course-ops",
    params(("id" = String, Path, description = "Caddie profile ID")),
    responses(
        (status = 204, description = "Caddie deleted"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Caddie not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_caddie(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(caddie_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::try_new(caddie_id).map_err(AppError::from)?;
    let use_case = DeleteCaddieUseCase::new(ops_gateway(&state));
    use_case
        .execute(credentials, &caddie_id)
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
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

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NameCaddieForRoundRequest {
    pub caddie_profile_id: String,
    pub reservation_id: String,
    pub scheduled_at: DateTime<Utc>,
    /// How long the round holds the caddie. Falls back to a full round.
    #[serde(default)]
    pub duration_minutes: Option<i32>,
    #[serde(default)]
    pub assignment_role: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// POST /v1/course/caddie-assignments
#[utoipa::path(
    post,
    path = "/v1/course/caddie-assignments",
    tag = "course-ops",
    request_body = NameCaddieForRoundRequest,
    responses(
        (status = 201, description = "Caddie named for the round", body = CaddieAssignmentDto),
        (status = 400, description = "The round or the caddie cannot take it", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Caddie not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_caddie_assignment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<NameCaddieForRoundRequest>,
) -> Result<(StatusCode, Json<CaddieAssignmentDto>), AppError> {
    let credentials = credentials(&state, &headers)?;
    let timezone = catalog_gateway(&state)
        .get_tenant_timezone(credentials)
        .await
        .map_err(AppError::from)?;
    let use_case =
        CreateCaddieAssignmentUseCase::new(ops_gateway(&state), caddie_rank_fee_gateway(&state));
    let assignment = use_case
        .execute(
            credentials,
            NameCaddieForRound {
                caddie_id: CaddieId::try_new(body.caddie_profile_id).map_err(AppError::from)?,
                reservation_id: ReservationId::try_new(body.reservation_id)
                    .map_err(AppError::from)?,
                scheduled_at: body.scheduled_at,
                duration_minutes: body.duration_minutes,
                assignment_role: body.assignment_role,
                notes: body.notes,
            },
            &timezone,
        )
        .await
        .map_err(AppError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(CaddieAssignmentDto::from(&assignment)),
    ))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_rounds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attendance_status: Option<String>,
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
            remaining_rounds: value.remaining_rounds(),
            attendance_status: value.attendance_status().map(str::to_string),
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
    /// The course the round tees off from. Given, the candidates are the
    /// caddies confirmed onto that course for the day.
    pub golf_course_id: Option<String>,
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
    let timezone = catalog_gateway(&state)
        .get_tenant_timezone(credentials)
        .await
        .map_err(AppError::from)?;
    let use_case =
        ListCaddieRecommendationsUseCase::new(ops_gateway(&state), state.caddie_shifts());
    let items = use_case
        .execute(
            credentials,
            RecommendationQuery {
                reservation_id: ReservationId::from_optional(query.reservation_id),
                golf_course_id: CourseId::from_optional(query.golf_course_id),
                scheduled_at: query.scheduled_at,
                player_count: query.player_count,
                include_rookie_pairing: query.include_rookie_pairing,
                limit: query.limit,
            },
            &timezone,
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
    let timezone = catalog_gateway(&state)
        .get_tenant_timezone(credentials)
        .await
        .map_err(AppError::from)?;
    let use_case = GetAttendanceSnapshotUseCase::new(ops_gateway(&state));
    let report = use_case
        .execute(credentials, query.date, &timezone)
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

/// Carried when the month's filing deadline has passed and caddies remain
/// who never filed a shift request for it. Does not block the run.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineWarningDto {
    pub deadline_date: NaiveDate,
    pub unsubmitted_caddie_names: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AutoAssignResultDto {
    pub dry_run: bool,
    pub assigned: Vec<AutoAssignPlanItemDto>,
    pub skipped: Vec<AutoAssignSkippedDto>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub deadline_warning: Option<DeadlineWarningDto>,
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
            deadline_warning: value.deadline_warning().map(|warning| DeadlineWarningDto {
                deadline_date: warning.deadline_date(),
                unsubmitted_caddie_names: warning.unsubmitted_caddie_names().to_vec(),
            }),
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
    let use_case = AutoAssignCaddiesUseCase::new(
        ops_gateway(&state),
        reservation_gateway(&state),
        catalog_gateway(&state),
        state.availability_deadlines(),
        state.caddie_shifts(),
        caddie_rank_fee_gateway(&state),
    );
    let result = use_case
        .execute(credentials, body.date, body.dry_run)
        .await
        .map_err(AppError::from)?;
    Ok(Json(AutoAssignResultDto::from(result)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityDeadlineDto {
    pub year_month: String,
    pub deadline_date: NaiveDate,
}

impl From<AvailabilityDeadline> for AvailabilityDeadlineDto {
    fn from(value: AvailabilityDeadline) -> Self {
        Self {
            year_month: value.year_month().as_string(),
            deadline_date: value.deadline_date(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAvailabilityDeadlineRequest {
    pub deadline_date: NaiveDate,
}

fn parse_year_month(raw: &str) -> Result<YearMonth, AppError> {
    YearMonth::parse(raw).map_err(AppError::from)
}

/// GET /v1/course/caddie-availability-deadlines/:year_month
#[utoipa::path(
    get,
    path = "/v1/course/caddie-availability-deadlines/{year_month}",
    tag = "course-ops",
    params(("year_month" = String, Path, description = "YYYY-MM")),
    responses(
        (status = 200, description = "The month's filing deadline, or null if unset", body = Option<AvailabilityDeadlineDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_availability_deadline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(year_month): Path<String>,
) -> Result<Json<Option<AvailabilityDeadlineDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let year_month = parse_year_month(&year_month)?;
    let use_case = GetAvailabilityDeadlineUseCase::new(state.availability_deadlines());
    let deadline = use_case
        .execute(credentials, year_month)
        .await
        .map_err(AppError::from)?;
    Ok(Json(deadline.map(AvailabilityDeadlineDto::from)))
}

/// PUT /v1/course/caddie-availability-deadlines/:year_month
#[utoipa::path(
    put,
    path = "/v1/course/caddie-availability-deadlines/{year_month}",
    tag = "course-ops",
    params(("year_month" = String, Path, description = "YYYY-MM")),
    request_body = UpsertAvailabilityDeadlineRequest,
    responses(
        (status = 200, description = "The saved deadline", body = AvailabilityDeadlineDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn upsert_availability_deadline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(year_month): Path<String>,
    Json(body): Json<UpsertAvailabilityDeadlineRequest>,
) -> Result<Json<AvailabilityDeadlineDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let year_month = parse_year_month(&year_month)?;
    let deadline = AvailabilityDeadline::try_new(year_month, body.deadline_date);
    let use_case = UpsertAvailabilityDeadlineUseCase::new(state.availability_deadlines());
    let saved = use_case
        .execute(credentials, deadline)
        .await
        .map_err(AppError::from)?;
    Ok(Json(AvailabilityDeadlineDto::from(saved)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnsubmittedCaddieDto {
    pub caddie_profile_id: String,
    pub display_name: String,
}

/// GET /v1/course/caddie-availability-submissions/:year_month
#[utoipa::path(
    get,
    path = "/v1/course/caddie-availability-submissions/{year_month}",
    tag = "course-ops",
    params(("year_month" = String, Path, description = "YYYY-MM")),
    responses(
        (status = 200, description = "Active caddies who filed no shift request for the month", body = ItemsResponse<UnsubmittedCaddieDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_unsubmitted_caddies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(year_month): Path<String>,
) -> Result<Json<ItemsResponse<UnsubmittedCaddieDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let year_month = parse_year_month(&year_month)?;
    let use_case = ListUnsubmittedCaddiesUseCase::new(ops_gateway(&state));
    let unsubmitted = use_case
        .execute(credentials, year_month)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: unsubmitted
            .into_iter()
            .map(|caddie| UnsubmittedCaddieDto {
                caddie_profile_id: caddie.id().as_str().to_string(),
                display_name: caddie.display_name().to_string(),
            })
            .collect(),
    }))
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
    /// The rank the round fee was read off.
    pub rank: String,
    /// What one round pays this caddie.
    pub round_fee: i64,
    /// True when `roundFee` is the caddie's own rather than their rank's.
    pub fee_overridden: bool,
    /// `roundFee` × `assignedRounds`.
    pub fee_total: i64,
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
                    rank: row.rank().as_str().to_string(),
                    round_fee: row.round_fee(),
                    fee_overridden: row.fee_overridden(),
                    fee_total: row.fee_total(),
                    currency: row.currency().to_string(),
                    open_clock_in: row.open_clock_in(),
                    rounds_without_clock_in: row.rounds_without_clock_in(),
                })
                .collect(),
        }
    }
}

/// What one round pays at each rank.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieRankFeesDto {
    pub a: i64,
    pub b: i64,
    pub c: i64,
    pub d: i64,
    pub currency: String,
}

impl From<CaddieRankFees> for CaddieRankFeesDto {
    fn from(value: CaddieRankFees) -> Self {
        Self {
            a: value.fee_for(CaddieRank::A),
            b: value.fee_for(CaddieRank::B),
            c: value.fee_for(CaddieRank::C),
            d: value.fee_for(CaddieRank::D),
            currency: value.currency().to_string(),
        }
    }
}

/// GET /v1/course/caddie-rank-fees
#[utoipa::path(
    get,
    path = "/v1/course/caddie-rank-fees",
    tag = "course-ops",
    responses(
        (status = 200, description = "Per-round fee by rank", body = CaddieRankFeesDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_caddie_rank_fees(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CaddieRankFeesDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let fees = GetCaddieRankFeesUseCase::new(ops_gateway(&state), caddie_rank_fee_gateway(&state))
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieRankFeesDto::from(fees)))
}

/// PUT /v1/course/caddie-rank-fees
#[utoipa::path(
    put,
    path = "/v1/course/caddie-rank-fees",
    tag = "course-ops",
    request_body = CaddieRankFeesDto,
    responses(
        (status = 200, description = "Stored per-round fee by rank", body = CaddieRankFeesDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_caddie_rank_fees(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CaddieRankFeesDto>,
) -> Result<Json<CaddieRankFeesDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let fees =
        CaddieRankFees::try_new(request.a, request.b, request.c, request.d, request.currency)
            .map_err(AppError::from)?;
    let stored = ReplaceCaddieRankFeesUseCase::new(caddie_rank_fee_gateway(&state))
        .execute(credentials, fees)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieRankFeesDto::from(stored)))
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
    let timezone = catalog_gateway(&state)
        .get_tenant_timezone(credentials)
        .await
        .map_err(AppError::from)?;
    let use_case =
        GetPayrollSummaryUseCase::new(ops_gateway(&state), caddie_rank_fee_gateway(&state));
    let summary = use_case
        .execute(credentials, &query.year_month, &timezone)
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
    let timezone = catalog_gateway(&state)
        .get_tenant_timezone(credentials)
        .await
        .map_err(AppError::from)?;
    let use_case =
        ExportPayrollCsvUseCase::new(ops_gateway(&state), caddie_rank_fee_gateway(&state));
    let csv = use_case
        .execute(credentials, &query.year_month, &timezone)
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

// ─── Confirmed shifts ─────────────────────────────────────────────────────────

/// One caddie's confirmed day, including the course they work it on.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieShiftDto {
    pub caddie_profile_id: String,
    pub date: NaiveDate,
    /// `null` when the day is off, or when the caddie has no main course yet
    /// and nobody has placed them by hand.
    pub golf_course_id: Option<String>,
    pub is_working: bool,
    /// `full_day` / `morning` / `afternoon`.
    pub span: String,
    pub rounds_capacity: i32,
    /// `generated` / `edited` / `pinned`.
    pub origin: String,
    pub note: Option<String>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

impl From<&CaddieShift> for CaddieShiftDto {
    fn from(value: &CaddieShift) -> Self {
        Self {
            caddie_profile_id: value.caddie_id().to_string(),
            date: value.date(),
            golf_course_id: value.course_id().map(ToString::to_string),
            is_working: value.is_working(),
            span: value.span().as_str().to_string(),
            rounds_capacity: value.rounds_capacity(),
            origin: value.origin().as_str().to_string(),
            note: value.note().map(ToString::to_string),
            updated_by: value.updated_by().map(ToString::to_string),
            updated_at: value.updated_at(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ShiftRangeQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// What one run over a month produced.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedMonthDto {
    pub year_month: String,
    pub days_written: u64,
    /// Days left exactly as the desk had pinned them.
    pub pinned_kept: u64,
    /// Caddies confirmed to work but placed nowhere, by name.
    pub unplaced: Vec<String>,
    /// Days turned into rest days to keep nobody working more than six in a
    /// row, as the Labour Standards Act requires.
    pub statutory_rest_days: u64,
    /// Caddies still over that limit, by name. Only pinned days can do it.
    pub overworked: Vec<String>,
    pub deadline_warning: Option<DeadlineWarningDto>,
}

impl From<GeneratedMonth> for GeneratedMonthDto {
    fn from(value: GeneratedMonth) -> Self {
        Self {
            year_month: value.year_month().as_string(),
            days_written: value.days_written(),
            pinned_kept: value.pinned_kept() as u64,
            unplaced: value.unplaced().to_vec(),
            statutory_rest_days: value.statutory_rest_days() as u64,
            overworked: value.overworked().to_vec(),
            deadline_warning: value.deadline_warning().map(|warning| DeadlineWarningDto {
                deadline_date: warning.deadline_date(),
                unsubmitted_caddie_names: warning.unsubmitted_caddie_names().to_vec(),
            }),
        }
    }
}

/// A month planned but not written: the summary the desk reads, and every day
/// it would confirm. The board draws these so the run can be checked before it
/// replaces a month of everybody's working days.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPlanPreviewDto {
    pub summary: GeneratedMonthDto,
    pub shifts: Vec<CaddieShiftDto>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCaddieShiftRequest {
    pub is_working: bool,
    /// `full_day` / `morning` / `afternoon`.
    pub span: String,
    pub rounds_capacity: i32,
    /// Where they work it. Must be a course the caddie has a membership for,
    /// main or sub — a sub membership is what permits the move.
    #[serde(default)]
    pub golf_course_id: Option<String>,
    /// Hold this day against the next monthly run and against course moves.
    #[serde(default)]
    pub pinned: bool,
    /// Required when the caddie filed this day off.
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub updated_by: Option<String>,
}

/// GET /v1/course/caddie-shifts
#[utoipa::path(
    get,
    path = "/v1/course/caddie-shifts",
    tag = "course-ops",
    params(ShiftRangeQuery),
    responses(
        (status = 200, description = "Confirmed shifts in the range", body = inline(ItemsResponse<CaddieShiftDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ShiftRangeQuery>,
) -> Result<Json<ItemsResponse<CaddieShiftDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddieShiftsUseCase::new(state.caddie_shifts());
    let shifts = use_case
        .execute(credentials, params.from, params.to)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: shifts.iter().map(CaddieShiftDto::from).collect(),
    }))
}

/// POST /v1/course/caddie-shift-plans/:year_month/preview
#[utoipa::path(
    post,
    path = "/v1/course/caddie-shift-plans/{year_month}/preview",
    tag = "course-ops",
    params(("year_month" = String, Path, description = "YYYY-MM")),
    responses(
        (status = 200, description = "The month as the run would confirm it. Nothing was written", body = ShiftPlanPreviewDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn preview_caddie_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(year_month): Path<String>,
) -> Result<Json<ShiftPlanPreviewDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let year_month = parse_year_month(&year_month)?;
    let use_case = GenerateCaddieShiftsUseCase::new(
        catalog_gateway(&state),
        ops_gateway(&state),
        state.caddie_shifts(),
        state.availability_deadlines(),
        state.shift_rules(),
    );
    let planned = use_case
        .execute(credentials, year_month, ShiftPlanMode::Preview)
        .await
        .map_err(AppError::from)?;
    let shifts = planned.shifts().iter().map(CaddieShiftDto::from).collect();
    Ok(Json(ShiftPlanPreviewDto {
        summary: GeneratedMonthDto::from(planned),
        shifts,
    }))
}

/// POST /v1/course/caddie-shift-plans/:year_month
#[utoipa::path(
    post,
    path = "/v1/course/caddie-shift-plans/{year_month}",
    tag = "course-ops",
    params(("year_month" = String, Path, description = "YYYY-MM")),
    responses(
        (status = 200, description = "The month was confirmed from the filed requests", body = GeneratedMonthDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn generate_caddie_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(year_month): Path<String>,
) -> Result<Json<GeneratedMonthDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let year_month = parse_year_month(&year_month)?;
    let use_case = GenerateCaddieShiftsUseCase::new(
        catalog_gateway(&state),
        ops_gateway(&state),
        state.caddie_shifts(),
        state.availability_deadlines(),
        state.shift_rules(),
    );
    let generated = use_case
        .execute(credentials, year_month, ShiftPlanMode::Apply)
        .await
        .map_err(AppError::from)?;
    Ok(Json(GeneratedMonthDto::from(generated)))
}

/// PUT /v1/course/caddie-shifts/:caddie_profile_id/:date
#[utoipa::path(
    put,
    path = "/v1/course/caddie-shifts/{caddie_profile_id}/{date}",
    tag = "course-ops",
    params(
        ("caddie_profile_id" = String, Path, description = "Caddie profile ID"),
        ("date" = String, Path, description = "YYYY-MM-DD"),
    ),
    request_body = UpdateCaddieShiftRequest,
    responses(
        (status = 200, description = "The confirmed day as it now stands", body = CaddieShiftDto),
        (status = 400, description = "The caddie cannot work that course, or the day was filed off without a reason", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_caddie_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((caddie_profile_id, date)): Path<(String, NaiveDate)>,
    Json(body): Json<UpdateCaddieShiftRequest>,
) -> Result<Json<CaddieShiftDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let caddie_id = CaddieId::try_new(caddie_profile_id).map_err(AppError::from)?;
    let edit = ShiftEdit {
        is_working: body.is_working,
        span: ShiftSpan::parse(&body.span),
        rounds_capacity: body.rounds_capacity,
        course_id: CourseId::from_optional(body.golf_course_id),
        pinned: body.pinned,
        note: body.note,
    };
    let use_case = UpdateCaddieShiftUseCase::new(ops_gateway(&state), state.caddie_shifts());
    let shift = use_case
        .execute(credentials, &caddie_id, date, edit, body.updated_by)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieShiftDto::from(&shift)))
}

/// One course's caddie day: who is on it, and how much of it is sold.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CourseCaddieSupplyDto {
    pub golf_course_id: String,
    pub course_name: String,
    pub working_caddies: i64,
    /// Rounds the caddies placed here can take between them.
    pub rounds_capacity: i64,
    pub caddie_attached_groups: i64,
    /// Caddies here who are not pinned, so the desk could send them elsewhere.
    pub movable_caddies: i64,
    /// Rounds still coverable. Negative means the course is short.
    pub shortfall: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DayCaddieSupplyDto {
    pub date: NaiveDate,
    pub courses: Vec<CourseCaddieSupplyDto>,
    /// Confirmed to work but placed on no course, so covering nothing.
    pub unplaced_caddies: i64,
}

impl From<DayCaddieSupply> for DayCaddieSupplyDto {
    fn from(value: DayCaddieSupply) -> Self {
        Self {
            date: value.date(),
            courses: value
                .courses()
                .iter()
                .map(|course| CourseCaddieSupplyDto {
                    golf_course_id: course.course_id().to_string(),
                    course_name: course.course_name().to_string(),
                    working_caddies: course.working_caddies(),
                    rounds_capacity: course.rounds_capacity(),
                    caddie_attached_groups: course.caddie_attached_groups(),
                    movable_caddies: course.movable_caddies(),
                    shortfall: course.shortfall(),
                })
                .collect(),
            unplaced_caddies: value.unplaced_caddies(),
        }
    }
}

/// GET /v1/course/caddie-course-supply
#[utoipa::path(
    get,
    path = "/v1/course/caddie-course-supply",
    tag = "course-ops",
    params(SupplyQueryParams),
    responses(
        (status = 200, description = "The day counted course by course", body = DayCaddieSupplyDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_course_caddie_supply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<SupplyQueryParams>,
) -> Result<Json<DayCaddieSupplyDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetCourseCaddieSupplyUseCase::new(
        state.caddie_shifts(),
        reservation_gateway(&state),
        catalog_gateway(&state),
    );
    let supply = use_case
        .execute(credentials, params.date)
        .await
        .map_err(AppError::from)?;
    Ok(Json(DayCaddieSupplyDto::from(supply)))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ReinforcementQueryParams {
    pub date: NaiveDate,
    /// The course that is short.
    pub golf_course_id: String,
}

/// One caddie who could cover a short course today.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReinforcementDto {
    pub caddie_profile_id: String,
    pub display_name: String,
    /// Where they stand now. `null` means confirmed to work but unplaced.
    pub from_golf_course_id: Option<String>,
    pub rounds_capacity: i32,
    pub span: String,
    /// The short course is this caddie's own main course.
    pub returns_home: bool,
}

impl From<ReinforcementCandidate> for ReinforcementDto {
    fn from(value: ReinforcementCandidate) -> Self {
        Self {
            caddie_profile_id: value.caddie_id.to_string(),
            display_name: value.display_name,
            from_golf_course_id: value.from_course_id.map(|id| id.to_string()),
            rounds_capacity: value.rounds_capacity,
            span: value.span.as_str().to_string(),
            returns_home: value.returns_home,
        }
    }
}

/// GET /v1/course/caddie-reinforcements
#[utoipa::path(
    get,
    path = "/v1/course/caddie-reinforcements",
    tag = "course-ops",
    params(ReinforcementQueryParams),
    responses(
        (status = 200, description = "Caddies who could be moved to the course", body = inline(ItemsResponse<ReinforcementDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_reinforcements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ReinforcementQueryParams>,
) -> Result<Json<ItemsResponse<ReinforcementDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let course_id = CourseId::try_new(params.golf_course_id).map_err(AppError::from)?;
    let use_case = ListCourseReinforcementsUseCase::new(ops_gateway(&state), state.caddie_shifts());
    let candidates = use_case
        .execute(credentials, &course_id, params.date)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: candidates.into_iter().map(ReinforcementDto::from).collect(),
    }))
}

/// The club's shift-planning rules.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShiftRulesDto {
    /// Weekdays to keep clear of rest days, `mon`..`sun`. Empty means the plan
    /// may rest anybody on any day. A preference, not a ban: the consecutive-
    /// day limit wins when the window holds nothing else.
    pub avoided_rest_weekdays: Vec<String>,
    /// Days in a row anybody may be confirmed to work.
    pub max_consecutive_work_days: i64,
    /// Rounds a caddie may be given in a day, whatever their profile says.
    pub max_rounds_per_day: i32,
    /// Rest days promised over a calendar month. 0 leaves the consecutive-day
    /// limit as the only rule.
    pub min_rest_days_per_month: i64,
    /// `working` or `off`: how a day nobody filed a request for is confirmed.
    pub unfiled_request: String,
    /// The statutory ceiling on `maxConsecutiveWorkDays`, sent so the screens
    /// can say why a larger number is refused.
    pub statutory_max_consecutive_work_days: i64,
    /// The ceiling on `maxRoundsPerDay`: there is no daylight for a third.
    pub max_rounds_ceiling: i32,
}

impl From<ShiftPolicy> for ShiftRulesDto {
    fn from(value: ShiftPolicy) -> Self {
        Self {
            avoided_rest_weekdays: value
                .weekdays()
                .into_iter()
                .map(|weekday| weekday_key(weekday).to_string())
                .collect(),
            max_consecutive_work_days: value.max_consecutive_work_days(),
            max_rounds_per_day: value.max_rounds_per_day(),
            min_rest_days_per_month: value.min_rest_days_per_month(),
            unfiled_request: value.unfiled_request().as_str().to_string(),
            statutory_max_consecutive_work_days: MAX_CONSECUTIVE_WORK_DAYS,
            max_rounds_ceiling: MAX_ROUNDS_PER_SHIFT,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShiftRulesRequest {
    /// `mon`..`sun`. An empty list protects nothing.
    pub avoided_rest_weekdays: Vec<String>,
    /// Above the statutory ceiling is refused rather than clamped: a club
    /// asking for eight days in a row has misread the rule, and silently
    /// storing six would leave it thinking it got eight.
    pub max_consecutive_work_days: i64,
    pub max_rounds_per_day: i32,
    pub min_rest_days_per_month: i64,
    /// `working` or `off`.
    pub unfiled_request: String,
}

/// GET /v1/course/caddie-shift-rules
#[utoipa::path(
    get,
    path = "/v1/course/caddie-shift-rules",
    tag = "course-ops",
    responses(
        (status = 200, description = "The club's shift-planning rules", body = ShiftRulesDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_shift_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ShiftRulesDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetShiftRulesUseCase::new(state.shift_rules());
    let policy = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ShiftRulesDto::from(policy)))
}

/// PUT /v1/course/caddie-shift-rules
#[utoipa::path(
    put,
    path = "/v1/course/caddie-shift-rules",
    tag = "course-ops",
    request_body = UpdateShiftRulesRequest,
    responses(
        (status = 200, description = "The saved rules", body = ShiftRulesDto),
        (status = 400, description = "An unknown weekday", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_shift_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateShiftRulesRequest>,
) -> Result<Json<ShiftRulesDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    // A typo would otherwise be stored and silently ignored every month.
    let mut weekdays = Vec::with_capacity(body.avoided_rest_weekdays.len());
    for raw in &body.avoided_rest_weekdays {
        let weekday = parse_weekday(raw.trim())
            .ok_or(CourseError::BadRequest("weekdays are mon..sun"))
            .map_err(AppError::from)?;
        weekdays.push(weekday);
    }
    if body.max_consecutive_work_days < 1
        || body.max_consecutive_work_days > MAX_CONSECUTIVE_WORK_DAYS
    {
        return Err(AppError::from(CourseError::BadRequest(
            "連続勤務の上限は1日以上6日以下です。労働基準法で週に1日は休みが必要なため、6日を超える設定はできません",
        )));
    }
    if body.max_rounds_per_day < 1 || body.max_rounds_per_day > MAX_ROUNDS_PER_SHIFT {
        return Err(AppError::from(CourseError::BadRequest(
            "1日の最大ラウンド数は1組または2組です",
        )));
    }
    if !(0..=31).contains(&body.min_rest_days_per_month) {
        return Err(AppError::from(CourseError::BadRequest(
            "月の最低休日数は0日以上31日以下です",
        )));
    }
    let policy = ShiftPolicy::new(weekdays)
        .with_max_consecutive_work_days(body.max_consecutive_work_days)
        .with_max_rounds_per_day(body.max_rounds_per_day)
        .with_min_rest_days_per_month(body.min_rest_days_per_month)
        .with_unfiled_request(UnfiledRequest::parse(&body.unfiled_request));
    let use_case = UpdateShiftRulesUseCase::new(state.shift_rules());
    let saved = use_case
        .execute(credentials, policy)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ShiftRulesDto::from(saved)))
}
