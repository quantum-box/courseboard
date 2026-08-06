//! Axum handlers for golf fee simulation under `/v1/course/simulator/*`.
//!
//! These replace Field's `/v1/erp/extensions/golf-course/simulator/*`, which
//! only proxied the calculation. See
//! `docs/src/architecture/decisions/ADR-0005-golf-domain-ownership.md`.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::http::{commercial_gateway, credentials, operator_id};

use super::openapi::ErrorBody;
use crate::course::domain::{
    FeeQuote, FeeQuoteRequest, PlayerTaxLine, RangeRow, RangeSimulation, RangeSimulationRequest,
};
use crate::course::infrastructure::CourseboardTaxGateway;
use crate::course::usecase::{
    GetExtensionStatusUseCase, QuoteGolfFeeUseCase, SimulateGreenFeeRangeUseCase,
};

/// The course's own pricing inputs, or the product defaults when it has not
/// filled them in. A missing extension config must not stop a quote; the
/// prefecture check inside the use case is what refuses.
async fn pricing_settings(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::course::domain::GolfPricingSettings, AppError> {
    let status = GetExtensionStatusUseCase::new(commercial_gateway(state))
        .execute(credentials(state, headers)?)
        .await
        .map_err(AppError::from)?;
    Ok(status
        .as_ref()
        .and_then(|item| item.config_json())
        .map(crate::course::domain::GolfPricingSettings::from_config)
        .unwrap_or_default())
}
use crate::{AppError, AppState};

fn tax_gateway(state: &AppState) -> Arc<CourseboardTaxGateway> {
    Arc::new(CourseboardTaxGateway::new(state.tax_rules()))
}

// ─── Fee quote ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalculateFeeRequest {
    pub green_fee: f64,
    pub num_holes: i32,
    #[serde(default)]
    pub cart_fee: Option<f64>,
    #[serde(default)]
    pub caddy_fee: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlayerBreakdownDto {
    pub player_index: usize,
    pub fee: i64,
    pub exempt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalculateFeeResponse {
    pub course_grade: String,
    pub tax_rate: f64,
    pub tax_amount: i64,
    pub total: i64,
    pub breakdown: Vec<PlayerBreakdownDto>,
}

impl From<&PlayerTaxLine> for PlayerBreakdownDto {
    fn from(value: &PlayerTaxLine) -> Self {
        Self {
            player_index: value.player_index(),
            fee: value.fee(),
            exempt: value.exempt(),
            reason: value.reason().map(str::to_string),
        }
    }
}

impl From<FeeQuote> for CalculateFeeResponse {
    fn from(value: FeeQuote) -> Self {
        Self {
            course_grade: value.course_grade().to_string(),
            tax_rate: value.tax_rate(),
            tax_amount: value.tax_amount(),
            total: value.total(),
            breakdown: value
                .breakdown()
                .iter()
                .map(PlayerBreakdownDto::from)
                .collect(),
        }
    }
}

/// POST /v1/course/simulator/calculate
#[utoipa::path(
    post,
    path = "/v1/course/simulator/calculate",
    tag = "course",
    request_body = CalculateFeeRequest,
    responses(
        (status = 200, description = "Priced round including golf course tax", body = CalculateFeeResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn calculate_fee(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CalculateFeeRequest>,
) -> Result<Json<CalculateFeeResponse>, AppError> {
    let tenant_id = operator_id(&headers)?.to_string();
    let settings = pricing_settings(&state, &headers).await?;
    let use_case = QuoteGolfFeeUseCase::new(tax_gateway(&state));
    let quote = use_case
        .execute(
            &tenant_id,
            &settings,
            FeeQuoteRequest {
                green_fee: body.green_fee,
                num_holes: body.num_holes,
                cart_fee: body.cart_fee,
                caddy_fee: body.caddy_fee,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(CalculateFeeResponse::from(quote)))
}

// ─── Range simulation ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SimulateRangeRequest {
    pub date_from: String,
    pub date_to: String,
    pub num_visitors_min: i64,
    pub num_visitors_max: i64,
    pub avg_green_fee: f64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SimulateRangeRowDto {
    pub green_fee: i64,
    pub course_grade: String,
    pub visitors: i64,
    pub taxable_visitors: i64,
    pub revenue: i64,
    pub tax_total: i64,
    pub variable_cost: i64,
    pub fixed_cost: i64,
    pub profit: i64,
    pub profit_margin_pct: f64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SimulateRangeResponse {
    pub projected_revenue_min: i64,
    pub projected_revenue_max: i64,
    pub tax_total: i64,
    pub rows: Vec<SimulateRangeRowDto>,
    pub period_label: String,
}

impl From<&RangeRow> for SimulateRangeRowDto {
    fn from(value: &RangeRow) -> Self {
        Self {
            green_fee: value.green_fee(),
            course_grade: value.course_grade().to_string(),
            visitors: value.visitors(),
            taxable_visitors: value.taxable_visitors(),
            revenue: value.revenue(),
            tax_total: value.tax_total(),
            variable_cost: value.variable_cost(),
            fixed_cost: value.fixed_cost(),
            profit: value.profit(),
            profit_margin_pct: value.profit_margin_pct(),
        }
    }
}

impl From<RangeSimulation> for SimulateRangeResponse {
    fn from(value: RangeSimulation) -> Self {
        Self {
            projected_revenue_min: value.projected_revenue_min(),
            projected_revenue_max: value.projected_revenue_max(),
            tax_total: value.tax_total(),
            rows: value.rows().iter().map(SimulateRangeRowDto::from).collect(),
            period_label: value.period_label().to_string(),
        }
    }
}

/// POST /v1/course/simulator/simulate/range
#[utoipa::path(
    post,
    path = "/v1/course/simulator/simulate/range",
    tag = "course",
    request_body = SimulateRangeRequest,
    responses(
        (status = 200, description = "Revenue, tax, and profit projection for the period", body = SimulateRangeResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn simulate_range(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SimulateRangeRequest>,
) -> Result<Json<SimulateRangeResponse>, AppError> {
    let tenant_id = operator_id(&headers)?.to_string();
    let settings = pricing_settings(&state, &headers).await?;
    let use_case = SimulateGreenFeeRangeUseCase::new(tax_gateway(&state));
    let simulation = use_case
        .execute(
            &tenant_id,
            &settings,
            RangeSimulationRequest {
                date_from: body.date_from,
                date_to: body.date_to,
                num_visitors_min: body.num_visitors_min,
                num_visitors_max: body.num_visitors_max,
                avg_green_fee: body.avg_green_fee,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(SimulateRangeResponse::from(simulation)))
}
