//! Axum handlers for commercial golf ops under `/v1/course/*`.

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header::CONTENT_TYPE, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::openapi::ErrorBody;
use serde_json::Value;

use super::http::{commercial_gateway, credentials, ItemsResponse};
use crate::course::domain::{
    BudgetAchievement, CourseId, DailyBudget, DailyBudgetQuery, ExtensionStatus, MonthlySettlement,
    ReservationPolicy, UpdateExtensionConfig, UpdateReservationPolicy, UpsertDailyBudget,
};
use crate::course::usecase::{
    ExportMonthlySettlementCsvUseCase, GetExtensionStatusUseCase, GetMonthlySettlementUseCase,
    GetReservationPolicyUseCase, ImportDailyBudgetsCsvUseCase, ListBudgetAchievementsUseCase,
    ListDailyBudgetsUseCase, UpdateExtensionConfigUseCase, UpdateReservationPolicyUseCase,
    UpsertDailyBudgetUseCase,
};
use crate::{AppError, AppState};

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationPolicyDto {
    pub tenant_id: String,
    pub reservation_type_id: String,
    pub default_holes: i32,
    pub max_players_per_tee_time: i32,
    pub cart_policy: String,
    pub member_deposit_bps: i32,
    pub guest_deposit_bps: i32,
    pub cutoff_hours: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub policy_hooks_json: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub metadata_json: Option<Value>,
}

impl From<&ReservationPolicy> for ReservationPolicyDto {
    fn from(value: &ReservationPolicy) -> Self {
        Self {
            tenant_id: value.tenant_id().to_string(),
            reservation_type_id: value.reservation_type_id().to_string(),
            default_holes: value.default_holes(),
            max_players_per_tee_time: value.max_players_per_tee_time(),
            cart_policy: value.cart_policy().to_string(),
            member_deposit_bps: value.member_deposit_bps(),
            guest_deposit_bps: value.guest_deposit_bps(),
            cutoff_hours: value.cutoff_hours(),
            policy_hooks_json: value.policy_hooks_json().cloned(),
            metadata_json: value.metadata_json().cloned(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReservationPolicyRequest {
    #[serde(default)]
    pub reservation_type_id: Option<String>,
    #[serde(default)]
    pub default_holes: Option<i32>,
    #[serde(default)]
    pub max_players_per_tee_time: Option<i32>,
    #[serde(default)]
    pub cart_policy: Option<String>,
    #[serde(default)]
    pub member_deposit_bps: Option<i32>,
    #[serde(default)]
    pub guest_deposit_bps: Option<i32>,
    #[serde(default)]
    pub cutoff_hours: Option<i32>,
    #[serde(default)]
    #[schema(value_type = Option<Object>)]
    pub policy_hooks_json: Option<Value>,
    #[serde(default)]
    #[schema(value_type = Option<Object>)]
    pub metadata_json: Option<Value>,
}

/// GET /v1/course/reservation-policy
#[utoipa::path(
    get,
    path = "/v1/course/reservation-policy",
    tag = "course-commercial",
    responses(
        (status = 200, description = "Reservation policy", body = ReservationPolicyDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_reservation_policy(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ReservationPolicyDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetReservationPolicyUseCase::new(commercial_gateway(&state));
    let policy = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationPolicyDto::from(&policy)))
}

/// PATCH /v1/course/reservation-policy
#[utoipa::path(
    patch,
    path = "/v1/course/reservation-policy",
    tag = "course-commercial",
    request_body = UpdateReservationPolicyRequest,
    responses(
        (status = 200, description = "Reservation policy updated", body = ReservationPolicyDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_reservation_policy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateReservationPolicyRequest>,
) -> Result<Json<ReservationPolicyDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = UpdateReservationPolicy {
        reservation_type_id: body.reservation_type_id,
        default_holes: body.default_holes,
        max_players_per_tee_time: body.max_players_per_tee_time,
        cart_policy: body.cart_policy,
        member_deposit_bps: body.member_deposit_bps,
        guest_deposit_bps: body.guest_deposit_bps,
        cutoff_hours: body.cutoff_hours,
        policy_hooks_json: body.policy_hooks_json,
        metadata_json: body.metadata_json,
    };
    let use_case = UpdateReservationPolicyUseCase::new(commercial_gateway(&state));
    let policy = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationPolicyDto::from(&policy)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DailyBudgetDto {
    pub id: String,
    pub golf_course_id: String,
    pub date: NaiveDate,
    pub target_revenue: i64,
    pub target_average_spend: i64,
    pub target_caddy_attached_ratio: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

impl From<&DailyBudget> for DailyBudgetDto {
    fn from(value: &DailyBudget) -> Self {
        Self {
            id: value.id().to_string(),
            golf_course_id: value.golf_course_id().to_string(),
            date: value.date(),
            target_revenue: value.target_revenue(),
            target_average_spend: value.target_average_spend(),
            target_caddy_attached_ratio: value.target_caddy_attached_ratio(),
            updated_at: value.updated_at(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct DailyBudgetQueryParams {
    pub golf_course_id: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDailyBudgetRequest {
    pub golf_course_id: String,
    pub date: NaiveDate,
    pub target_revenue: i64,
    pub target_average_spend: i64,
    pub target_caddy_attached_ratio: f64,
}

/// GET /v1/course/daily-budgets
#[utoipa::path(
    get,
    path = "/v1/course/daily-budgets",
    tag = "course-commercial",
    params(DailyBudgetQueryParams),
    responses(
        (status = 200, description = "List daily budgets", body = inline(ItemsResponse<DailyBudgetDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_daily_budgets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DailyBudgetQueryParams>,
) -> Result<Json<ItemsResponse<DailyBudgetDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListDailyBudgetsUseCase::new(commercial_gateway(&state));
    let items = use_case
        .execute(
            credentials,
            DailyBudgetQuery {
                golf_course_id: CourseId::from_optional(query.golf_course_id),
                from: query.from,
                to: query.to,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(DailyBudgetDto::from).collect(),
    }))
}

/// POST /v1/course/daily-budgets
#[utoipa::path(
    post,
    path = "/v1/course/daily-budgets",
    tag = "course-commercial",
    request_body = UpsertDailyBudgetRequest,
    responses(
        (status = 200, description = "Daily budget upserted", body = DailyBudgetDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn upsert_daily_budget(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertDailyBudgetRequest>,
) -> Result<Json<DailyBudgetDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = UpsertDailyBudget::try_new(
        body.golf_course_id,
        body.date,
        body.target_revenue,
        body.target_average_spend,
        body.target_caddy_attached_ratio,
    )
    .map_err(AppError::from)?;
    let use_case = UpsertDailyBudgetUseCase::new(commercial_gateway(&state));
    let budget = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(DailyBudgetDto::from(&budget)))
}

/// POST /v1/course/daily-budgets/import
#[utoipa::path(
    post,
    path = "/v1/course/daily-budgets/import",
    tag = "course-commercial",
    request_body(content = String, description = "CSV payload", content_type = "text/csv"),
    responses(
        (status = 200, description = "Imported daily budgets", body = inline(ItemsResponse<DailyBudgetDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn import_daily_budgets_csv(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ItemsResponse<DailyBudgetDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let csv = std::str::from_utf8(&body).map_err(|_| AppError::BadRequest("CSV must be UTF-8"))?;
    let use_case = ImportDailyBudgetsCsvUseCase::new(commercial_gateway(&state));
    let items = use_case
        .execute(credentials, csv)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(DailyBudgetDto::from).collect(),
    }))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BudgetAchievementDto {
    pub date: NaiveDate,
    pub target_revenue: i64,
    pub actual_revenue: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revenue_achievement_rate: Option<f64>,
    pub target_average_spend: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_average_spend: Option<i64>,
    pub target_caddy_attached_ratio: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_caddy_attached_ratio: Option<f64>,
    pub reservation_count: i64,
    pub player_count: i64,
}

impl From<&BudgetAchievement> for BudgetAchievementDto {
    fn from(value: &BudgetAchievement) -> Self {
        Self {
            date: value.date(),
            target_revenue: value.target_revenue(),
            actual_revenue: value.actual_revenue(),
            revenue_achievement_rate: value.revenue_achievement_rate(),
            target_average_spend: value.target_average_spend(),
            actual_average_spend: value.actual_average_spend(),
            target_caddy_attached_ratio: value.target_caddy_attached_ratio(),
            actual_caddy_attached_ratio: value.actual_caddy_attached_ratio(),
            reservation_count: value.reservation_count(),
            player_count: value.player_count(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct AchievementQueryParams {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

/// GET /v1/course/daily-budgets/achievement
#[utoipa::path(
    get,
    path = "/v1/course/daily-budgets/achievement",
    tag = "course-commercial",
    params(AchievementQueryParams),
    responses(
        (status = 200, description = "Budget achievements", body = inline(ItemsResponse<BudgetAchievementDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_budget_achievements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AchievementQueryParams>,
) -> Result<Json<ItemsResponse<BudgetAchievementDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListBudgetAchievementsUseCase::new(commercial_gateway(&state));
    let items = use_case
        .execute(credentials, query.from, query.to)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(BudgetAchievementDto::from).collect(),
    }))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySettlementDto {
    pub period: SettlementPeriodDto,
    pub reservations: SettlementReservationsDto,
    pub caddie_fees: SettlementCaddieFeesDto,
    pub cancellations: SettlementCancellationsDto,
    pub square: SettlementSquareDto,
    pub drilldown: SettlementDrilldownDto,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementPeriodDto {
    pub year_month: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementReservationsDto {
    pub gross_amount: i64,
    pub collected_amount: i64,
    pub refunded_amount: i64,
    pub payment_pending_amount: i64,
    pub reservation_count: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementCaddieFeesDto {
    pub total: i64,
    pub assignment_count: i64,
    pub currency: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementCancellationsDto {
    pub fee_outstanding_amount: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementSquareDto {
    pub payments_total: i64,
    pub refunds_total: i64,
    pub unreconciled_lines: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnpaidCancellationDto {
    pub reservation_id: String,
    pub reservation_number: String,
    pub cancellation_fee_amount: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_url: Option<String>,
    pub link_issued: bool,
    pub payment_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invoice_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementDrilldownDto {
    pub reservation_ids: Vec<String>,
    pub unpaid_cancellation_reservation_ids: Vec<String>,
    pub unpaid_cancellation_items: Vec<UnpaidCancellationDto>,
}

impl From<&MonthlySettlement> for MonthlySettlementDto {
    fn from(value: &MonthlySettlement) -> Self {
        Self {
            period: SettlementPeriodDto {
                year_month: value.period().year_month().to_string(),
                start_date: value.period().start_date(),
                end_date: value.period().end_date(),
            },
            reservations: SettlementReservationsDto {
                gross_amount: value.reservations_gross_amount(),
                collected_amount: value.reservations_collected_amount(),
                refunded_amount: value.reservations_refunded_amount(),
                payment_pending_amount: value.reservations_payment_pending_amount(),
                reservation_count: value.reservation_count(),
            },
            caddie_fees: SettlementCaddieFeesDto {
                total: value.caddie_fees_total(),
                assignment_count: value.caddie_assignment_count(),
                currency: value.caddie_fees_currency().to_string(),
            },
            cancellations: SettlementCancellationsDto {
                fee_outstanding_amount: value.cancellations_fee_outstanding_amount(),
                count: value.cancellations_count(),
            },
            square: SettlementSquareDto {
                payments_total: value.square_payments_total(),
                refunds_total: value.square_refunds_total(),
                unreconciled_lines: value.square_unreconciled_lines(),
                warning: value.square_warning().map(str::to_string),
            },
            drilldown: SettlementDrilldownDto {
                reservation_ids: value
                    .reservation_ids()
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                unpaid_cancellation_reservation_ids: value
                    .unpaid_cancellation_reservation_ids()
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                unpaid_cancellation_items: value
                    .unpaid_cancellation_items()
                    .iter()
                    .map(|item| UnpaidCancellationDto {
                        reservation_id: item.reservation_id().to_string(),
                        reservation_number: item.reservation_number().to_string(),
                        cancellation_fee_amount: item.cancellation_fee_amount(),
                        checkout_url: item.checkout_url().map(str::to_string),
                        link_issued: item.link_issued(),
                        payment_status: item.payment_status().to_string(),
                        invoice_id: item.invoice_id().map(str::to_string),
                    })
                    .collect(),
            },
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[schema(as = CommercialYearMonthQuery)]
#[serde(rename_all = "camelCase")]
pub struct YearMonthQuery {
    pub year_month: String,
}

/// GET /v1/course/monthly-settlement
#[utoipa::path(
    get,
    path = "/v1/course/monthly-settlement",
    tag = "course-commercial",
    params(YearMonthQuery),
    responses(
        (status = 200, description = "Monthly settlement", body = MonthlySettlementDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_monthly_settlement(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<YearMonthQuery>,
) -> Result<Json<MonthlySettlementDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetMonthlySettlementUseCase::new(commercial_gateway(&state));
    let report = use_case
        .execute(credentials, &query.year_month)
        .await
        .map_err(AppError::from)?;
    Ok(Json(MonthlySettlementDto::from(&report)))
}

/// GET /v1/course/monthly-settlement/export.csv
#[utoipa::path(
    get,
    path = "/v1/course/monthly-settlement/export.csv",
    tag = "course-commercial",
    params(YearMonthQuery),
    responses(
        (status = 200, description = "Monthly settlement CSV export", content_type = "text/csv"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn export_monthly_settlement_csv(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<YearMonthQuery>,
) -> Result<impl IntoResponse, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ExportMonthlySettlementCsvUseCase::new(commercial_gateway(&state));
    let csv = use_case
        .execute(credentials, &query.year_month)
        .await
        .map_err(AppError::from)?;
    Ok((
        StatusCode::OK,
        [(
            CONTENT_TYPE,
            HeaderValue::from_static("text/csv; charset=utf-8"),
        )],
        Bytes::from(csv),
    ))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatusDto {
    pub extension_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_json: Option<Value>,
    pub validation: ExtensionValidationDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionValidationDto {
    pub valid: bool,
    pub errors: Vec<String>,
}

impl From<&ExtensionStatus> for ExtensionStatusDto {
    fn from(value: &ExtensionStatus) -> Self {
        Self {
            extension_key: value.extension_key().to_string(),
            name: value.name().map(str::to_string),
            version: value.version().map(str::to_string),
            registry_status: value.registry_status().map(str::to_string),
            tenant_status: value.tenant_status().map(str::to_string),
            config_version: value.config_version(),
            config_json: value.config_json().cloned(),
            validation: ExtensionValidationDto {
                valid: value.validation_valid(),
                errors: value.validation_errors().to_vec(),
            },
            updated_at: value.updated_at(),
        }
    }
}

/// GET /v1/course/extension-status
#[utoipa::path(
    get,
    path = "/v1/course/extension-status",
    tag = "course-commercial",
    responses(
        (status = 200, description = "Extension status", body = Option<ExtensionStatusDto>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_extension_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<ExtensionStatusDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = GetExtensionStatusUseCase::new(commercial_gateway(&state));
    let status = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(status.as_ref().map(ExtensionStatusDto::from)))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExtensionConfigRequest {
    pub scope_type: String,
    pub config_json: Value,
}

/// PATCH /v1/course/config
#[utoipa::path(
    patch,
    path = "/v1/course/config",
    tag = "course-commercial",
    request_body = UpdateExtensionConfigRequest,
    responses(
        (status = 204, description = "Extension config updated"),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_extension_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateExtensionConfigRequest>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = UpdateExtensionConfig::try_new(body.scope_type, body.config_json)
        .map_err(AppError::from)?;
    let use_case = UpdateExtensionConfigUseCase::new(commercial_gateway(&state));
    use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}
