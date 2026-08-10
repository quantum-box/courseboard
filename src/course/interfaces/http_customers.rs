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
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::http::{credentials, ItemsResponse};
use super::openapi::ErrorBody;

use crate::course::domain::{
    AssignMembershipPlan, Customer, CustomerId, CustomerMembership, CustomerSearchQuery,
    MembershipPlan, MembershipPlanId, NewCustomer, UpsertMembershipPlan,
};
use crate::course::infrastructure::{FieldCustomerGateway, FieldMembershipGateway};
use crate::course::usecase::{
    AssignMembershipPlanUseCase, CreateCustomerUseCase, CreateMembershipPlanUseCase,
    GetCustomerMembershipUseCase, ListMembershipPlansUseCase, SearchCustomersUseCase,
    UpdateMembershipPlanUseCase,
};
use crate::{AppError, AppState};

fn customer_gateway(state: &AppState) -> Arc<FieldCustomerGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldCustomerGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

fn membership_gateway(state: &AppState) -> Arc<FieldMembershipGateway> {
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
}

impl From<&CustomerMembership> for CustomerMembershipDto {
    fn from(value: &CustomerMembership) -> Self {
        Self {
            customer_id: value.customer_id().to_string(),
            is_member: value.is_member(),
            plan: value.plan().map(MembershipPlanDto::from),
            started_on: value.started_on().map(str::to_string),
        }
    }
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

    #[test]
    fn a_search_with_an_empty_box_is_refused_rather_than_listing_everyone() {
        let params: CustomerSearchParams = serde_json::from_value(serde_json::json!({})).unwrap();
        let query =
            CustomerSearchQuery::try_new(params.name, params.phone, params.email, params.limit);
        assert!(query.is_err());
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
