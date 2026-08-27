//! Axum handlers for `/v1/course/customers`.
//!
//! The desk works the customer ledger from CourseBoard, never from Field admin
//! (ADR-0005): looking someone up and adding a first-time visitor happen while
//! a booking is being taken, in the same screen, and a flow that sends the desk
//! to another product mid-call is a flow nobody follows.
//!
//! Handlers stay thin: parse request → call use case → map domain → response DTO.

use std::sync::Arc;

use axum::{
    extract::{Multipart, Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::http::{credentials, reservation_gateway, ItemsResponse};
use super::openapi::ErrorBody;

use crate::course::domain::{
    AssignMembershipPlan, Customer, CustomerGradeRule, CustomerGradeRules, CustomerId,
    CustomerMembership, CustomerSearchQuery, CustomerVisit, MemberDiscount, MembershipDiscount,
    MembershipDiscounts, MembershipDiscountsGateway, MembershipPlan, MembershipPlanId,
    MembershipPlayWindow, MembershipPlayWindows, MembershipPlayWindowsGateway, NewCustomer,
    PlayableDays, ReceptionDraftRow, ReceptionSheet, SetMemberNumber, UpsertMembershipPlan,
};
use crate::course::infrastructure::{
    FieldCustomerGateway, FieldCustomerReceptionGateway, FieldMembershipGateway,
};
use crate::course::usecase::{
    AssignMembershipPlanUseCase, CreateCustomerUseCase, CreateMembershipPlanUseCase,
    CustomerVisitReport, DraftCustomerReceptionUseCase, GetCustomerGradeRulesUseCase,
    GetCustomerMembershipUseCase, GetCustomerUseCase, GetCustomerVisitsUseCase,
    ListMembershipPlansUseCase, ReplaceCustomerGradeRulesUseCase, SearchCustomersUseCase,
    SetMemberNumberUseCase, UpdateMembershipPlanUseCase,
};
use crate::{AppError, AppState};

fn customer_gateway(state: &AppState) -> Arc<FieldCustomerGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldCustomerGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

fn reception_gateway(state: &AppState) -> Arc<FieldCustomerReceptionGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldCustomerReceptionGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

pub(crate) fn membership_gateway(state: &AppState) -> Arc<FieldMembershipGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldMembershipGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDto {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_kana: Option<String>,
    /// Absent for anyone booked by phone or at the counter, which is most of
    /// them. Not a sign of an incomplete record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
}

impl From<&Customer> for CustomerDto {
    fn from(value: &Customer) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            name_kana: value.name_kana().map(str::to_string),
            email: value.email().map(str::to_string),
            phone: value.phone().map(str::to_string),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct CustomerSearchParams {
    /// Partial match against the name or its kana reading.
    #[serde(default)]
    pub name: Option<String>,
    /// Partial match against the phone number; separators are ignored.
    #[serde(default)]
    pub phone: Option<String>,
    /// Exact match.
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

/// GET /v1/course/customers
///
/// Candidates for what the desk typed, never a single resolved person: two
/// members share a surname and a household shares a phone number, and choosing
/// between them is the desk's call.
#[utoipa::path(
    get,
    path = "/v1/course/customers",
    tag = "course",
    params(CustomerSearchParams),
    responses(
        (status = 200, description = "Matching customers", body = ItemsResponse<CustomerDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn search_customers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CustomerSearchParams>,
) -> Result<Json<ItemsResponse<CustomerDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let query = CustomerSearchQuery::try_new(params.name, params.phone, params.email, params.limit)
        .map_err(AppError::from)?;
    let found = SearchCustomersUseCase::new(customer_gateway(&state))
        .execute(credentials, query)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: found.iter().map(CustomerDto::from).collect(),
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerRequest {
    pub name: String,
    #[serde(default)]
    pub name_kana: Option<String>,
    /// Optional, and usually absent. A visitor who gave a name over the phone
    /// belongs in the ledger as much as a member with a full record does.
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
}

/// GET /v1/course/customers/{customer_id}
///
/// One person, for their own page in the ledger. Unlike a search this is asked
/// about somebody already identified, so an id nobody holds is an error rather
/// than an empty list.
#[utoipa::path(
    get,
    path = "/v1/course/customers/{customer_id}",
    tag = "course",
    params(("customer_id" = String, Path, description = "Customer id")),
    responses(
        (status = 200, description = "Customer", body = CustomerDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_customer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
) -> Result<Json<CustomerDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let customer_id = CustomerId::try_new(customer_id).map_err(AppError::from)?;
    let customer = GetCustomerUseCase::new(customer_gateway(&state))
        .execute(credentials, &customer_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CustomerDto::from(&customer)))
}

/// POST /v1/course/customers
///
/// Adds someone the desk has decided is not already in the ledger. No
/// find-or-create: the candidates were already on screen when they decided.
#[utoipa::path(
    post,
    path = "/v1/course/customers",
    tag = "course",
    request_body = CreateCustomerRequest,
    responses(
        (status = 200, description = "Created customer", body = CustomerDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_customer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateCustomerRequest>,
) -> Result<Json<CustomerDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = NewCustomer::try_new(
        request.name,
        request.name_kana,
        request.email,
        request.phone,
    )
    .map_err(AppError::from)?;
    let created = CreateCustomerUseCase::new(customer_gateway(&state))
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CustomerDto::from(&created)))
}

// ─── Visit history ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomerVisitDto {
    pub reservation_id: String,
    pub reservation_number: String,
    pub starts_at: DateTime<Utc>,
    /// The course played. Absent on a booking taken before the group was put
    /// on a course, which the screen shows as a blank rather than a guess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub course_id: Option<String>,
    pub players: i32,
    pub amount: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// `visited`, `upcoming`, `no_show`, `cancelled`, or `other`.
    pub kind: String,
    /// Field's own status. Worth showing only for `other`, where `kind` has
    /// nothing to say.
    pub status: String,
}

impl From<&CustomerVisit> for CustomerVisitDto {
    fn from(value: &CustomerVisit) -> Self {
        Self {
            reservation_id: value.id().to_string(),
            reservation_number: value.reservation_number().to_string(),
            starts_at: value.starts_at(),
            course_id: value.course_id().map(ToString::to_string),
            players: value.players(),
            amount: value.amount(),
            currency: value.currency().map(str::to_string),
            kind: value.kind().as_str().to_string(),
            status: value.status().to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomerVisitSummaryDto {
    pub visits: u32,
    /// Rounds sold across those visits: a foursome counts four.
    pub players: i64,
    pub total_amount: i64,
    /// Visits carrying no money, excluded from `spendPerPlayer`. Reported so
    /// the screen can name what the average left out.
    pub unpriced_visits: u32,
    /// Absent when no visit has money on it — an unknown average, not zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spend_per_player: Option<i64>,
    pub cancelled: u32,
    pub no_shows: u32,
    pub upcoming: u32,
    /// Absent whenever `truncated` is true: the oldest row read is not the
    /// first round this person played.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_visit_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_visit_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomerVisitHistoryDto {
    pub items: Vec<CustomerVisitDto>,
    pub summary: CustomerVisitSummaryDto,
    /// Reading gave up before the end of the history. The figures are then a
    /// partial count rather than a lifetime, and the screen must say so.
    pub truncated: bool,
    /// `graded`, `below_lowest`, `unknown`, or `not_configured`. Four answers
    /// rather than a nullable name: "this club grades nobody", "we cannot tell
    /// from a partial history", and "they have not reached the lowest rung"
    /// are different things to put on a screen.
    pub grade: String,
    /// Set only when `grade` is `graded`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade_name: Option<String>,
}

impl From<&CustomerVisitReport> for CustomerVisitHistoryDto {
    fn from(report: &CustomerVisitReport) -> Self {
        let value = &report.history;
        let summary = value.summary();
        Self {
            items: value.visits().iter().map(CustomerVisitDto::from).collect(),
            summary: CustomerVisitSummaryDto {
                visits: summary.visits,
                players: summary.players,
                total_amount: summary.total_amount,
                unpriced_visits: summary.unpriced_visits,
                spend_per_player: summary.spend_per_player,
                cancelled: summary.cancelled,
                no_shows: summary.no_shows,
                upcoming: summary.upcoming,
                first_visit_at: summary.first_visit_at,
                last_visit_at: summary.last_visit_at,
            },
            truncated: value.truncated(),
            grade: report.grade.as_str().to_string(),
            grade_name: report.grade.name().map(str::to_string),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct CustomerVisitParams {
    #[serde(default)]
    pub limit: Option<u32>,
}

/// GET /v1/course/customers/{customer_id}/visits
///
/// What this person has played here, newest first, with what it adds up to.
///
/// Bookings taken *for* them: Field records one customer per reservation, so a
/// regular who always comes in a colleague's group has nothing here. The screen
/// says whose bookings these are — an empty table would otherwise read as
/// "never been" about somebody who plays monthly.
#[utoipa::path(
    get,
    path = "/v1/course/customers/{customer_id}/visits",
    tag = "course",
    params(
        ("customer_id" = String, Path, description = "Customer id"),
        CustomerVisitParams,
    ),
    responses(
        (status = 200, description = "Visit history", body = CustomerVisitHistoryDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_customer_visits(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
    Query(params): Query<CustomerVisitParams>,
) -> Result<Json<CustomerVisitHistoryDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let customer_id = CustomerId::try_new(customer_id).map_err(AppError::from)?;
    let report = GetCustomerVisitsUseCase::new(
        reservation_gateway(&state),
        state.customer_grade_rules.clone(),
    )
    .execute(credentials, &customer_id, params.limit, Utc::now())
    .await
    .map_err(AppError::from)?;
    Ok(Json(CustomerVisitHistoryDto::from(&report)))
}

// ─── Customer grades ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomerGradeRuleDto {
    pub name: String,
    /// Rounds played over the whole history. Zero asks nothing.
    #[serde(default)]
    pub min_visits: u32,
    /// Absent means this rung asks nothing about money.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_spend_per_player: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_total_amount: Option<i64>,
}

impl From<&CustomerGradeRule> for CustomerGradeRuleDto {
    fn from(value: &CustomerGradeRule) -> Self {
        Self {
            name: value.name().to_string(),
            min_visits: value.min_visits(),
            min_spend_per_player: value.min_spend_per_player(),
            min_total_amount: value.min_total_amount(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceCustomerGradeRulesRequest {
    /// Highest rung first. The order is the club's judgement, not decoration:
    /// it decides which rung somebody clearing several of them is given.
    pub items: Vec<CustomerGradeRuleDto>,
}

/// GET /v1/course/customer-grade-rules
#[utoipa::path(
    get,
    path = "/v1/course/customer-grade-rules",
    tag = "course",
    responses(
        (status = 200, description = "The club's grade ladder", body = ItemsResponse<CustomerGradeRuleDto>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_customer_grade_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<CustomerGradeRuleDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let rules = GetCustomerGradeRulesUseCase::new(state.customer_grade_rules.clone())
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: rules
            .rules()
            .iter()
            .map(CustomerGradeRuleDto::from)
            .collect(),
    }))
}

/// PUT /v1/course/customer-grade-rules
///
/// Replaces the ladder wholesale, in the order sent. Blank rows are dropped —
/// the form grows rows the operator may leave empty — but a duplicate name is
/// refused rather than pruned: the ladder that comes back must be theirs.
#[utoipa::path(
    put,
    path = "/v1/course/customer-grade-rules",
    tag = "course",
    request_body = ReplaceCustomerGradeRulesRequest,
    responses(
        (status = 200, description = "The saved ladder", body = ItemsResponse<CustomerGradeRuleDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_customer_grade_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ReplaceCustomerGradeRulesRequest>,
) -> Result<Json<ItemsResponse<CustomerGradeRuleDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let mut rules = Vec::with_capacity(request.items.len());
    for item in &request.items {
        if item.name.trim().is_empty() {
            continue;
        }
        rules.push(
            CustomerGradeRule::try_new(
                item.name.clone(),
                item.min_visits,
                item.min_spend_per_player,
                item.min_total_amount,
            )
            .map_err(AppError::from)?,
        );
    }
    let rules = CustomerGradeRules::try_new(rules).map_err(AppError::from)?;
    let saved = ReplaceCustomerGradeRulesUseCase::new(state.customer_grade_rules.clone())
        .execute(credentials, rules)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: saved
            .rules()
            .iter()
            .map(CustomerGradeRuleDto::from)
            .collect(),
    }))
}

// ─── Membership discounts ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MembershipDiscountDto {
    pub plan_id: String,
    /// `yen` or `percent`.
    pub kind: String,
    pub value: i64,
}

impl From<&MembershipDiscount> for MembershipDiscountDto {
    fn from(value: &MembershipDiscount) -> Self {
        Self {
            plan_id: value.plan_id().to_string(),
            kind: value.discount().kind().to_string(),
            value: value.discount().value(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceMembershipDiscountsRequest {
    pub items: Vec<MembershipDiscountDto>,
}

/// GET /v1/course/membership-discounts
///
/// What each membership takes off the green fee. A plan with no entry
/// discounts nothing, which is where every plan starts.
#[utoipa::path(
    get,
    path = "/v1/course/membership-discounts",
    tag = "course",
    responses(
        (status = 200, description = "Discounts by plan", body = ItemsResponse<MembershipDiscountDto>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_membership_discounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<MembershipDiscountDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials
        .require(crate::course::domain::actions::LIST_MEMBERSHIP)
        .await
        .map_err(AppError::from)?;
    let discounts = state
        .membership_discounts
        .get_membership_discounts(credentials.operator_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: discounts
            .entries()
            .iter()
            .map(MembershipDiscountDto::from)
            .collect(),
    }))
}

/// PUT /v1/course/membership-discounts
///
/// Replaces every plan's discount at once. A plan left out of the list stops
/// discounting — which is how a club withdraws one, and why a partial save
/// would leave the counter quoting a rate the club had already withdrawn.
#[utoipa::path(
    put,
    path = "/v1/course/membership-discounts",
    tag = "course",
    request_body = ReplaceMembershipDiscountsRequest,
    responses(
        (status = 200, description = "The saved discounts", body = ItemsResponse<MembershipDiscountDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_membership_discounts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ReplaceMembershipDiscountsRequest>,
) -> Result<Json<ItemsResponse<MembershipDiscountDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials
        .require(crate::course::domain::actions::MANAGE_MEMBERSHIP_PLANS)
        .await
        .map_err(AppError::from)?;
    let mut entries = Vec::with_capacity(request.items.len());
    for item in &request.items {
        if item.plan_id.trim().is_empty() {
            continue;
        }
        // Zero off is not a discount. Dropping it here keeps a row the operator
        // blanked out from reading back as "discounts nothing, deliberately".
        if item.value == 0 {
            continue;
        }
        entries.push(MembershipDiscount::new(
            MembershipPlanId::try_new(item.plan_id.clone()).map_err(AppError::from)?,
            MemberDiscount::try_new(&item.kind, item.value).map_err(AppError::from)?,
        ));
    }
    let discounts = MembershipDiscounts::try_new(entries).map_err(AppError::from)?;
    let saved = state
        .membership_discounts
        .replace_membership_discounts(credentials.operator_id, &discounts)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: saved
            .entries()
            .iter()
            .map(MembershipDiscountDto::from)
            .collect(),
    }))
}

// ─── Membership playing windows ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MembershipPlayWindowDto {
    pub plan_id: String,
    /// Monday first. All seven true, or all seven false, both mean "no
    /// restriction" — a row the operator started and left blank must not lock
    /// a member out of the whole week.
    pub days: Vec<bool>,
    /// `HH:MM` in the course's own clock. Absent means open at that end.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

impl From<&MembershipPlayWindow> for MembershipPlayWindowDto {
    fn from(value: &MembershipPlayWindow) -> Self {
        Self {
            plan_id: value.plan_id().to_string(),
            days: value.days().flags().to_vec(),
            from: value.from().map(crate::course::domain::format_play_time),
            to: value.to().map(crate::course::domain::format_play_time),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceMembershipPlayWindowsRequest {
    pub items: Vec<MembershipPlayWindowDto>,
}

/// GET /v1/course/membership-play-windows
#[utoipa::path(
    get,
    path = "/v1/course/membership-play-windows",
    tag = "course",
    responses(
        (status = 200, description = "Playing windows by plan", body = ItemsResponse<MembershipPlayWindowDto>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_membership_play_windows(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<MembershipPlayWindowDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials
        .require(crate::course::domain::actions::LIST_MEMBERSHIP)
        .await
        .map_err(AppError::from)?;
    let windows = state
        .membership_play_windows()
        .get_membership_play_windows(credentials.operator_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: windows
            .entries()
            .iter()
            .map(MembershipPlayWindowDto::from)
            .collect(),
    }))
}

/// PUT /v1/course/membership-play-windows
///
/// Replaces every plan's window at once. A plan left out stops being
/// restricted — which is how a club opens 平日会員 to weekends.
#[utoipa::path(
    put,
    path = "/v1/course/membership-play-windows",
    tag = "course",
    request_body = ReplaceMembershipPlayWindowsRequest,
    responses(
        (status = 200, description = "The saved windows", body = ItemsResponse<MembershipPlayWindowDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_membership_play_windows(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ReplaceMembershipPlayWindowsRequest>,
) -> Result<Json<ItemsResponse<MembershipPlayWindowDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials
        .require(crate::course::domain::actions::MANAGE_MEMBERSHIP_PLANS)
        .await
        .map_err(AppError::from)?;
    let mut entries = Vec::with_capacity(request.items.len());
    for item in &request.items {
        if item.plan_id.trim().is_empty() {
            continue;
        }
        let mut flags = [false; 7];
        for (index, flag) in flags.iter_mut().enumerate() {
            *flag = item.days.get(index).copied().unwrap_or(false);
        }
        let days = PlayableDays::from_flags(flags);
        let from = item
            .from
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(crate::course::domain::parse_play_time)
            .transpose()
            .map_err(AppError::from)?;
        let to = item
            .to
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(crate::course::domain::parse_play_time)
            .transpose()
            .map_err(AppError::from)?;
        let window = MembershipPlayWindow::try_new(
            MembershipPlanId::try_new(item.plan_id.clone()).map_err(AppError::from)?,
            days,
            from,
            to,
        )
        .map_err(AppError::from)?;
        // A plan that restricts nothing needs no row: storing one would make
        // "unrestricted" and "never configured" two states nobody can tell
        // apart on the way back out.
        if window.is_unrestricted() {
            continue;
        }
        entries.push(window);
    }
    let windows = MembershipPlayWindows::try_new(entries).map_err(AppError::from)?;
    let saved = state
        .membership_play_windows()
        .replace_membership_play_windows(credentials.operator_id, &windows)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: saved
            .entries()
            .iter()
            .map(MembershipPlayWindowDto::from)
            .collect(),
    }))
}

// ─── Reception sheet OCR ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionDraftRowDto {
    /// Absent when the reader could not make the name out. The row is still
    /// returned: the desk has the original on screen beside it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_kana: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

impl From<&ReceptionDraftRow> for ReceptionDraftRowDto {
    fn from(value: &ReceptionDraftRow) -> Self {
        Self {
            name: value.name().map(str::to_string),
            name_kana: value.name_kana().map(str::to_string),
            phone: value.phone().map(str::to_string),
            email: value.email().map(str::to_string),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionDraftDto {
    pub visitors: Vec<ReceptionDraftRowDto>,
    /// What the reader could not do, in the desk's language. Shown as-is: a
    /// partial read looks identical to a complete one on screen otherwise.
    pub warnings: Vec<String>,
}

/// POST /v1/course/customers/reception-draft
///
/// Reads a scanned reception sheet and answers with rows to check. Writes
/// nothing: registering is still `POST /v1/course/customers`, one approved row
/// at a time, so a misread name never reaches the ledger unseen.
#[utoipa::path(
    post,
    path = "/v1/course/customers/reception-draft",
    tag = "course",
    request_body(
        content = String,
        description = "multipart/form-data with a single `file` part (JPEG, PNG, or PDF, up to 10MB)",
        content_type = "multipart/form-data"
    ),
    responses(
        (status = 200, description = "Rows read off the sheet", body = ReceptionDraftDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn draft_customer_reception(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<ReceptionDraftDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let sheet = read_reception_sheet(multipart).await?;
    let draft = DraftCustomerReceptionUseCase::new(reception_gateway(&state))
        .execute(credentials, sheet)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReceptionDraftDto {
        visitors: draft
            .rows()
            .iter()
            .map(ReceptionDraftRowDto::from)
            .collect(),
        warnings: draft.warnings().to_vec(),
    }))
}

async fn read_reception_sheet(mut multipart: Multipart) -> Result<ReceptionSheet, AppError> {
    let mut sheet = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::BadRequest("invalid multipart request"))?
    {
        if field.name() != Some("file") {
            continue;
        }
        if sheet.is_some() {
            return Err(AppError::BadRequest(
                "multipart request must contain exactly one file",
            ));
        }
        // The scanner's filename is neither read nor forwarded.
        let content_type = field.content_type().unwrap_or_default().to_string();
        let bytes = field
            .bytes()
            .await
            .map_err(|_| AppError::BadRequest("failed to read the reception sheet"))?;
        sheet =
            Some(ReceptionSheet::try_new(bytes.to_vec(), &content_type).map_err(AppError::from)?);
    }
    sheet.ok_or(AppError::BadRequest("multipart field 'file' is required"))
}

// ─── Membership ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MembershipPlanDto {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee_jpy: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub valid_days: Option<i32>,
    pub active: bool,
    pub sort_order: i32,
}

impl From<&MembershipPlan> for MembershipPlanDto {
    fn from(value: &MembershipPlan) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            description: value.description().map(str::to_string),
            fee_jpy: value.fee_jpy(),
            valid_days: value.valid_days(),
            active: value.active(),
            sort_order: value.sort_order(),
        }
    }
}

/// Where one customer stands with the course.
///
/// `isMember` is the answer, not something the client should re-derive from
/// whether `plan` happens to be present: what counts as a member is a golf
/// judgement and it lives on the server (see the `membership` domain module).
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomerMembershipDto {
    pub customer_id: String,
    pub is_member: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<MembershipPlanDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_on: Option<String>,
    /// The club's own number for this member, held as a Field credential.
    /// Absent for a visitor, and for a member the club has not numbered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member_number: Option<String>,
}

impl From<&CustomerMembership> for CustomerMembershipDto {
    fn from(value: &CustomerMembership) -> Self {
        Self {
            customer_id: value.customer_id().to_string(),
            is_member: value.is_member(),
            plan: value.plan().map(MembershipPlanDto::from),
            started_on: value.started_on().map(str::to_string),
            member_number: value.member_number().map(str::to_string),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetMemberNumberRequest {
    /// `null` or blank withdraws the number. A member numbered by mistake has
    /// to be un-numbered, and a blank stored as the number would read as a
    /// member whose number is the empty string.
    #[serde(default)]
    pub member_number: Option<String>,
}

/// PUT /v1/course/customers/{customer_id}/member-number
///
/// Records, changes, or withdraws the club's number for a member. Separate
/// from granting a plan: a club numbers people at a different moment from when
/// it sells them the membership, and renumbers without the membership changing.
#[utoipa::path(
    put,
    path = "/v1/course/customers/{customer_id}/member-number",
    tag = "course",
    params(("customer_id" = String, Path, description = "Customer id")),
    request_body = SetMemberNumberRequest,
    responses(
        (status = 200, description = "The customer's standing, renumbered", body = CustomerMembershipDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn set_member_number(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
    Json(request): Json<SetMemberNumberRequest>,
) -> Result<Json<CustomerMembershipDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let customer_id = CustomerId::try_new(customer_id).map_err(AppError::from)?;
    let input =
        SetMemberNumber::try_new(customer_id, request.member_number).map_err(AppError::from)?;
    let membership = SetMemberNumberUseCase::new(membership_gateway(&state))
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CustomerMembershipDto::from(&membership)))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct MembershipPlanListParams {
    /// Include plans the course has retired. For the settings screen, which
    /// has to show one to bring it back.
    #[serde(default)]
    pub include_inactive: Option<bool>,
}

/// GET /v1/course/membership-plans
#[utoipa::path(
    get,
    path = "/v1/course/membership-plans",
    tag = "course",
    params(MembershipPlanListParams),
    responses(
        (status = 200, description = "Membership plans", body = ItemsResponse<MembershipPlanDto>),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_membership_plans(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<MembershipPlanListParams>,
) -> Result<Json<ItemsResponse<MembershipPlanDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let plans = ListMembershipPlansUseCase::new(membership_gateway(&state))
        .execute(credentials, params.include_inactive.unwrap_or(false))
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: plans.iter().map(MembershipPlanDto::from).collect(),
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMembershipPlanRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub fee_jpy: Option<i64>,
    /// How long one membership runs. Absent means it does not expire on its own.
    #[serde(default)]
    pub valid_days: Option<i32>,
    #[serde(default)]
    pub sort_order: Option<i32>,
    /// Update only. Setting it false retires the plan without touching the
    /// members already holding it.
    #[serde(default)]
    pub active: Option<bool>,
}

impl UpsertMembershipPlanRequest {
    fn into_domain(self) -> Result<UpsertMembershipPlan, AppError> {
        UpsertMembershipPlan::try_new(
            self.name,
            self.description,
            self.fee_jpy,
            self.valid_days,
            self.sort_order,
            self.active,
        )
        .map_err(AppError::from)
    }
}

/// POST /v1/course/membership-plans
#[utoipa::path(
    post,
    path = "/v1/course/membership-plans",
    tag = "course",
    request_body = UpsertMembershipPlanRequest,
    responses(
        (status = 200, description = "Created plan", body = MembershipPlanDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_membership_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<UpsertMembershipPlanRequest>,
) -> Result<Json<MembershipPlanDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let created = CreateMembershipPlanUseCase::new(membership_gateway(&state))
        .execute(credentials, request.into_domain()?)
        .await
        .map_err(AppError::from)?;
    Ok(Json(MembershipPlanDto::from(&created)))
}

/// PATCH /v1/course/membership-plans/{plan_id}
#[utoipa::path(
    patch,
    path = "/v1/course/membership-plans/{plan_id}",
    tag = "course",
    params(("plan_id" = String, Path, description = "Membership plan id")),
    request_body = UpsertMembershipPlanRequest,
    responses(
        (status = 200, description = "Updated plan", body = MembershipPlanDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_membership_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(plan_id): Path<String>,
    Json(request): Json<UpsertMembershipPlanRequest>,
) -> Result<Json<MembershipPlanDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let plan_id = MembershipPlanId::try_new(plan_id).map_err(AppError::from)?;
    let updated = UpdateMembershipPlanUseCase::new(membership_gateway(&state))
        .execute(credentials, &plan_id, request.into_domain()?)
        .await
        .map_err(AppError::from)?;
    Ok(Json(MembershipPlanDto::from(&updated)))
}

/// GET /v1/course/customers/{customer_id}/membership
#[utoipa::path(
    get,
    path = "/v1/course/customers/{customer_id}/membership",
    tag = "course",
    params(("customer_id" = String, Path, description = "Customer id")),
    responses(
        (status = 200, description = "Membership standing", body = CustomerMembershipDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_customer_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
) -> Result<Json<CustomerMembershipDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let customer_id = CustomerId::try_new(customer_id).map_err(AppError::from)?;
    let membership = GetCustomerMembershipUseCase::new(membership_gateway(&state))
        .execute(credentials, &customer_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CustomerMembershipDto::from(&membership)))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssignMembershipPlanRequest {
    pub plan_id: String,
    /// `YYYY-MM-DD`. Absent means Field dates the membership today.
    #[serde(default)]
    pub started_on: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// POST /v1/course/customers/{customer_id}/membership
///
/// Grants a membership. The answer is the customer's standing afterwards, so
/// the screen that asked does not have to re-read it to redraw.
#[utoipa::path(
    post,
    path = "/v1/course/customers/{customer_id}/membership",
    tag = "course",
    params(("customer_id" = String, Path, description = "Customer id")),
    request_body = AssignMembershipPlanRequest,
    responses(
        (status = 200, description = "Membership standing", body = CustomerMembershipDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn assign_membership_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
    Json(request): Json<AssignMembershipPlanRequest>,
) -> Result<Json<CustomerMembershipDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = AssignMembershipPlan::try_new(
        CustomerId::try_new(customer_id).map_err(AppError::from)?,
        MembershipPlanId::try_new(request.plan_id).map_err(AppError::from)?,
        request.started_on,
        request.note,
    )
    .map_err(AppError::from)?;
    let membership = AssignMembershipPlanUseCase::new(membership_gateway(&state))
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CustomerMembershipDto::from(&membership)))
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::course::domain::DEFAULT_CUSTOMER_SEARCH_LIMIT;

    #[test]
    fn a_search_with_an_empty_box_lists_the_ledger_up_to_the_cap() {
        let params: CustomerSearchParams = serde_json::from_value(serde_json::json!({})).unwrap();
        let query =
            CustomerSearchQuery::try_new(params.name, params.phone, params.email, params.limit)
                .unwrap();
        assert_eq!(query.name, None);
        assert_eq!(query.limit, DEFAULT_CUSTOMER_SEARCH_LIMIT);
    }

    #[test]
    fn creating_a_customer_needs_nothing_but_a_name() {
        let request: CreateCustomerRequest =
            serde_json::from_value(serde_json::json!({ "name": "本田 康彦" })).unwrap();
        let input = NewCustomer::try_new(
            request.name,
            request.name_kana,
            request.email,
            request.phone,
        )
        .unwrap();
        assert_eq!(input.name, "本田 康彦");
        assert_eq!(input.email, None);
    }

    #[test]
    fn a_visitor_is_reported_as_one_rather_than_left_for_the_client_to_infer() {
        let dto = CustomerMembershipDto::from(&CustomerMembership::visitor("cus_1"));
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["isMember"], serde_json::json!(false));
        assert!(json.get("plan").is_none());
    }

    #[test]
    fn a_member_carries_the_plan_the_course_named() {
        let dto = CustomerMembershipDto::from(&CustomerMembership::reconstitute(
            "cus_1",
            Some(MembershipPlan::reconstitute(
                "plan_1",
                "正会員",
                None,
                Some(120_000),
                None,
                true,
                0,
            )),
            Some("2026-04-01".to_string()),
        ));
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["isMember"], serde_json::json!(true));
        assert_eq!(json["plan"]["name"], serde_json::json!("正会員"));
        assert_eq!(json["startedOn"], serde_json::json!("2026-04-01"));
    }

    #[test]
    fn a_plan_that_expires_the_day_it_starts_is_refused_at_the_edge() {
        let request: UpsertMembershipPlanRequest =
            serde_json::from_value(serde_json::json!({ "name": "平日会員", "validDays": 0 }))
                .unwrap();
        assert!(request.into_domain().is_err());
    }

    #[test]
    fn a_customer_with_no_email_serialises_without_the_key() {
        let dto = CustomerDto::from(&Customer::reconstitute(
            "cus_1",
            "本田 康彦",
            None,
            Some(String::new()),
            None,
        ));
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["name"], serde_json::json!("本田 康彦"));
        assert!(json.get("email").is_none());
        assert!(json.get("phone").is_none());
    }
}
