//! Axum handlers for golf fee simulation under `/v1/course/simulator/*`.
//!
//! These replace Field's `/v1/erp/extensions/golf-course/simulator/*`, which
//! only proxied the calculation. See
//! The golf-domain boundary is documented in the public README.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::http::{commercial_gateway, credentials, operator_id, pricing_settings_gateway};

use super::openapi::ErrorBody;
use crate::course::domain::{
    CourseError, FeeQuote, FeeQuoteRequest, GolfPricingSettings, MembershipDiscountsGateway,
    MembershipPlanId, PlayerTaxLine, RangeRow, RangeSimulation, RangeSimulationRequest,
};
use crate::course::infrastructure::CourseboardTaxGateway;
use crate::course::usecase::{
    GetPricingSettingsUseCase, QuoteGolfFeeUseCase, ReplacePricingSettingsUseCase,
    SimulateGreenFeeRangeUseCase,
};

/// The course's own pricing inputs, or the product defaults when it has not
/// filled them in. Unset must not stop a quote; the prefecture check inside
/// the use case is what refuses.
async fn pricing_settings(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<GolfPricingSettings, AppError> {
    GetPricingSettingsUseCase::new(commercial_gateway(state), pricing_settings_gateway(state))
        .execute(credentials(state, headers)?)
        .await
        .map_err(AppError::from)
}

// ─── Pricing settings ─────────────────────────────────────────────────────────

/// The pricing inputs as the settings panel edits them.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PricingSettingsDto {
    pub prefecture: Option<String>,
    pub tax_grade: Option<String>,
    pub taxable_ratio: f64,
    pub price_elasticity: f64,
    pub fixed_cost_per_day: i64,
    pub variable_cost_per_visitor: i64,
}

impl From<&GolfPricingSettings> for PricingSettingsDto {
    fn from(value: &GolfPricingSettings) -> Self {
        Self {
            prefecture: value.prefecture.clone(),
            tax_grade: value.tax_grade.clone(),
            taxable_ratio: value.taxable_ratio,
            price_elasticity: value.price_elasticity,
            fixed_cost_per_day: value.fixed_cost,
            variable_cost_per_visitor: value.variable_cost_per_visitor,
        }
    }
}

/// GET /v1/course/pricing-settings
#[utoipa::path(
    get,
    path = "/v1/course/pricing-settings",
    tag = "course",
    responses(
        (status = 200, description = "Effective pricing inputs", body = PricingSettingsDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_pricing_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PricingSettingsDto>, AppError> {
    let settings = pricing_settings(&state, &headers).await?;
    Ok(Json(PricingSettingsDto::from(&settings)))
}

/// PUT /v1/course/pricing-settings
///
/// Whole-object on purpose: the panel edits two of the six fields, but sending
/// everything it fetched means a cost assumption somebody set by hand in the
/// old config survives the first save after the move instead of silently
/// reverting to the defaults.
#[utoipa::path(
    put,
    path = "/v1/course/pricing-settings",
    tag = "course",
    request_body = PricingSettingsDto,
    responses(
        (status = 200, description = "Pricing inputs replaced", body = PricingSettingsDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_pricing_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PricingSettingsDto>,
) -> Result<Json<PricingSettingsDto>, AppError> {
    let settings = GolfPricingSettings::try_new(
        body.prefecture,
        body.tax_grade,
        body.taxable_ratio,
        body.price_elasticity,
        body.fixed_cost_per_day,
        body.variable_cost_per_visitor,
    )
    .map_err(AppError::from)?;
    let stored = ReplacePricingSettingsUseCase::new(pricing_settings_gateway(&state))
        .execute(credentials(&state, &headers)?, settings)
        .await
        .map_err(AppError::from)?;
    Ok(Json(PricingSettingsDto::from(&stored)))
}
use crate::{AppError, AppState};

fn tax_gateway(state: &AppState) -> Arc<CourseboardTaxGateway> {
    Arc::new(CourseboardTaxGateway::new(state.tax_rules()))
}

// ─── Fee quote ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalculateFeeRequest {
    /// The posted green fee, before any membership comes off it.
    pub green_fee: f64,
    pub num_holes: i32,
    #[serde(default)]
    pub cart_fee: Option<f64>,
    #[serde(default)]
    pub caddy_fee: Option<f64>,
    /// Price this round for somebody on this membership. Absent quotes a
    /// visitor, which is what the counter asks for most of the time.
    #[serde(default)]
    pub membership_plan_id: Option<String>,
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
    /// The green fee actually priced. Differs from the posted one when a
    /// membership took something off — shown rather than implied, because the
    /// tax bracket follows this number and the operator has to be able to see
    /// why the total moved.
    pub green_fee: i64,
    /// What the membership took off, in yen. Zero for a visitor.
    pub member_discount_amount: i64,
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
            // Filled in by the handler, which is the only place that knows
            // what was posted before the membership came off.
            green_fee: 0,
            member_discount_amount: 0,
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

    // The membership comes off before the round is priced, not after: the golf
    // course tax bracket is decided by the green fee, so a member paying less
    // can fall into a lower bracket. Discounting the total instead would quote
    // the visitor's tax to a member.
    let posted_green_fee = rounded_fee(body.green_fee)?;
    let plan_id = body
        .membership_plan_id
        .as_deref()
        .map(MembershipPlanId::new);
    let green_fee = if plan_id.is_some() {
        let discounts = state
            .membership_discounts
            .get_membership_discounts(&tenant_id)
            .await
            .map_err(AppError::from)?;
        discounts.green_fee_for(posted_green_fee, plan_id.as_ref())
    } else {
        posted_green_fee
    };

    let quote = use_case
        .execute(
            &tenant_id,
            &settings,
            FeeQuoteRequest {
                green_fee: green_fee as f64,
                num_holes: body.num_holes,
                cart_fee: body.cart_fee,
                caddy_fee: body.caddy_fee,
            },
        )
        .await
        .map_err(AppError::from)?;
    let mut response = CalculateFeeResponse::from(quote);
    response.green_fee = green_fee;
    response.member_discount_amount = posted_green_fee - green_fee;
    Ok(Json(response))
}

/// The posted green fee as whole yen, refused here rather than deep in the
/// quote so the discount is never applied to a nonsense number.
fn rounded_fee(value: f64) -> Result<i64, AppError> {
    if !value.is_finite() || !(0.0..=100_000_000.0).contains(&value) {
        return Err(AppError::from(CourseError::BadRequest(
            "greenFee must be greater than 0 and no more than 100000000",
        )));
    }
    Ok(value.round() as i64)
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
