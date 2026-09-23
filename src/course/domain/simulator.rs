//! Golf fee simulation: course-grade tax, operator-facing fee quotes, and
//! green-fee range projections.
//!
//! This module owns the golf pricing knowledge that used to live in Field's
//! `apps/api/src/golf_simulator_api.rs`. Field only ever proxied it; the
//! vocabulary (green fee, cart fee, caddy fee, course grade, taxable visitor)
//! belongs to CourseBoard. See the public README for the boundary.
//! ADR-0005-golf-domain-ownership.md`.
//!
//! Everything here is pure. Tax rules arrive as [`TaxRuleSnapshot`] from the
//! gateway; no storage or HTTP concern enters this module.

use derive_getters::Getters;

use super::CourseError;

/// Representative player age used for a single-player fee quote.
pub const DEFAULT_PLAYER_AGE: i64 = 42;

const MAX_FEE_AMOUNT: f64 = 100_000_000.0;
const MAX_VISITORS: i64 = 1_000_000;

/// Tenant tax rule resolved for one green-fee bracket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaxRuleSnapshot {
    pub course_grade: String,
    pub fee: i64,
    pub minor_exempt_under_age: i64,
    pub senior_exempt_min_age: i64,
    pub disability_cert_exempt: bool,
    /// Age from which the tax is charged at a reduced rate rather than in full.
    /// Hokkaido halves it from 65 until the full exemption at 70.
    pub senior_reduced_min_age: Option<i64>,
    /// Percentage of `fee` a reduced player owes, 1-99. `None` alongside a set
    /// `senior_reduced_min_age` is treated as no reduction.
    pub senior_reduced_percent: Option<i64>,
}

/// One player in a fee quote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimulatedPlayer {
    pub age: i64,
    pub has_disability_cert: bool,
}

impl SimulatedPlayer {
    /// The representative player used when the operator quotes a single round.
    pub fn representative() -> Self {
        Self {
            age: DEFAULT_PLAYER_AGE,
            has_disability_cert: false,
        }
    }
}

/// Per-player golf course tax, with the exemption that applied.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct PlayerTaxLine {
    player_index: usize,
    fee: i64,
    exempt: bool,
    #[getter(skip)]
    reason: Option<String>,
}

impl PlayerTaxLine {
    pub fn reason(&self) -> Option<&str> {
        self.reason.as_deref()
    }
}

/// Golf course tax for a party of players under one tax rule.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct PartyTax {
    #[getter(skip)]
    course_grade: String,
    tax_amount: i64,
    #[getter(skip)]
    lines: Vec<PlayerTaxLine>,
}

impl PartyTax {
    pub fn course_grade(&self) -> &str {
        &self.course_grade
    }

    pub fn lines(&self) -> &[PlayerTaxLine] {
        &self.lines
    }
}

/// Why a player is exempt from the golf course tax, if at all.
///
/// Order matters: minor before senior before disability certificate, matching
/// the ordering operators expect on the printed breakdown.
fn exemption_reason(player: &SimulatedPlayer, rule: &TaxRuleSnapshot) -> Option<&'static str> {
    if player.age < rule.minor_exempt_under_age {
        return Some("minor");
    }
    if player.age >= rule.senior_exempt_min_age {
        return Some("senior");
    }
    if rule.disability_cert_exempt && player.has_disability_cert {
        return Some("disability_cert");
    }
    None
}

/// The reduced band sits between full price and full exemption: a player old
/// enough to be reduced but not yet exempt owes a percentage of the rate.
///
/// Returns `None` when the player is outside the band or the rule does not
/// define one. Rounding is down, so the player is never charged a yen the
/// schedule does not name.
fn reduced_fee(player: &SimulatedPlayer, rule: &TaxRuleSnapshot) -> Option<i64> {
    let min_age = rule.senior_reduced_min_age?;
    let percent = rule.senior_reduced_percent?;
    if player.age < min_age || !(1..100).contains(&percent) {
        return None;
    }
    Some(rule.fee * percent / 100)
}

/// Golf course tax for each player, plus the party total.
pub fn party_tax(rule: &TaxRuleSnapshot, players: &[SimulatedPlayer]) -> PartyTax {
    let mut tax_amount = 0;
    let lines = players
        .iter()
        .enumerate()
        .map(|(player_index, player)| {
            let reason = exemption_reason(player, rule);
            let exempt = reason.is_some();
            // Exemption is checked first: past the exemption age the player
            // owes nothing, not the reduced share.
            let (fee, reason) = match (exempt, reduced_fee(player, rule)) {
                (true, _) => (0, reason.map(str::to_string)),
                (false, Some(reduced)) => (reduced, Some("senior_reduced".to_string())),
                (false, None) => (rule.fee, None),
            };
            tax_amount += fee;
            PlayerTaxLine {
                player_index,
                fee,
                exempt,
                reason,
            }
        })
        .collect();

    PartyTax {
        course_grade: rule.course_grade.clone(),
        tax_amount,
        lines,
    }
}

// ─── Operator-facing fee quote ────────────────────────────────────────────────

/// What the operator entered on the fee quote form.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FeeQuoteRequest {
    pub green_fee: f64,
    /// 9 or 18. Validated for operator input hygiene; the tax bracket depends
    /// on the green fee, not the hole count.
    pub num_holes: i32,
    pub cart_fee: Option<f64>,
    pub caddy_fee: Option<f64>,
}

/// Rounded, validated fee inputs ready to price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Getters)]
pub struct FeeQuoteInput {
    green_fee: i64,
    cart_fee: i64,
    caddy_fee: i64,
    subtotal: i64,
}

/// A priced round: play fees plus golf course tax.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct FeeQuote {
    #[getter(skip)]
    course_grade: String,
    /// Golf course tax as a percentage of the green fee.
    tax_rate: f64,
    tax_amount: i64,
    total: i64,
    #[getter(skip)]
    breakdown: Vec<PlayerTaxLine>,
}

impl FeeQuote {
    pub fn course_grade(&self) -> &str {
        &self.course_grade
    }

    pub fn breakdown(&self) -> &[PlayerTaxLine] {
        &self.breakdown
    }
}

fn rounded_i64(value: f64) -> Result<i64, CourseError> {
    if !value.is_finite() || value > i64::MAX as f64 || value < i64::MIN as f64 {
        return Err(CourseError::BadRequest(
            "fee amount is outside the supported range",
        ));
    }
    Ok(value.round() as i64)
}

/// Validate and round the operator's fee inputs.
pub fn prepare_fee_quote(request: &FeeQuoteRequest) -> Result<FeeQuoteInput, CourseError> {
    if !request.green_fee.is_finite()
        || request.green_fee <= 0.0
        || request.green_fee > MAX_FEE_AMOUNT
    {
        return Err(CourseError::BadRequest(
            "greenFee must be greater than 0 and no more than 100000000",
        ));
    }
    if !matches!(request.num_holes, 9 | 18) {
        return Err(CourseError::BadRequest("numHoles must be 9 or 18"));
    }
    if [request.cart_fee, request.caddy_fee]
        .into_iter()
        .flatten()
        .any(|value| !value.is_finite() || !(0.0..=MAX_FEE_AMOUNT).contains(&value))
    {
        return Err(CourseError::BadRequest(
            "optional fees must be between 0 and 100000000",
        ));
    }

    let green_fee = rounded_i64(request.green_fee)?;
    let cart_fee = rounded_i64(request.cart_fee.unwrap_or(0.0))?;
    let caddy_fee = rounded_i64(request.caddy_fee.unwrap_or(0.0))?;
    let subtotal = green_fee
        .checked_add(cart_fee)
        .and_then(|amount| amount.checked_add(caddy_fee))
        .ok_or(CourseError::BadRequest(
            "fee total exceeds the supported range",
        ))?;

    Ok(FeeQuoteInput {
        green_fee,
        cart_fee,
        caddy_fee,
        subtotal,
    })
}

/// Combine play fees with the golf course tax for the party.
pub fn quote_fee(input: &FeeQuoteInput, tax: PartyTax) -> Result<FeeQuote, CourseError> {
    let total = input
        .subtotal
        .checked_add(tax.tax_amount)
        .ok_or(CourseError::BadRequest(
            "fee total exceeds the supported range",
        ))?;
    let tax_rate = if input.green_fee > 0 {
        tax.tax_amount as f64 / input.green_fee as f64 * 100.0
    } else {
        0.0
    };
    Ok(FeeQuote {
        course_grade: tax.course_grade,
        tax_rate,
        tax_amount: tax.tax_amount,
        total,
        breakdown: tax.lines,
    })
}

// ─── Green-fee range projection ───────────────────────────────────────────────

/// One green-fee point in a range projection.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct RangeRow {
    green_fee: i64,
    #[getter(skip)]
    course_grade: String,
    visitors: i64,
    taxable_visitors: i64,
    revenue: i64,
    tax_total: i64,
    variable_cost: i64,
    fixed_cost: i64,
    profit: i64,
    profit_margin_pct: f64,
}

impl RangeRow {
    pub fn course_grade(&self) -> &str {
        &self.course_grade
    }
}

/// Inputs for projecting one green-fee point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RangeRowInput {
    pub green_fee: i64,
    pub base_visitors: i64,
    pub base_green_fee: i64,
    pub price_elasticity: f64,
    pub taxable_ratio: f64,
    pub fixed_cost: i64,
    pub variable_cost_per_visitor: i64,
}

/// Project visitors, revenue, tax, and profit at one green-fee point.
///
/// Visitor demand follows a constant-elasticity curve around the base point:
/// `visitors = base_visitors * (green_fee / base_green_fee) ^ elasticity`.
pub fn project_row(input: &RangeRowInput, rule: &TaxRuleSnapshot) -> RangeRow {
    let visitors = (input.base_visitors as f64
        * ((input.green_fee as f64) / (input.base_green_fee as f64)).powf(input.price_elasticity))
    .round() as i64;
    let taxable_visitors = (visitors as f64 * input.taxable_ratio).round() as i64;
    let revenue = input.green_fee * visitors;
    let tax_total = taxable_visitors * rule.fee;
    let variable_cost = input.variable_cost_per_visitor * visitors;
    let profit = revenue - tax_total - variable_cost - input.fixed_cost;
    let profit_margin_pct = if revenue == 0 {
        0.0
    } else {
        ((profit as f64) / (revenue as f64)) * 100.0
    };

    RangeRow {
        green_fee: input.green_fee,
        course_grade: rule.course_grade.clone(),
        visitors,
        taxable_visitors,
        revenue,
        tax_total,
        variable_cost,
        fixed_cost: input.fixed_cost,
        profit,
        profit_margin_pct,
    }
}

/// What the operator entered on the range simulation form.
#[derive(Debug, Clone, PartialEq)]
pub struct RangeSimulationRequest {
    pub date_from: String,
    pub date_to: String,
    pub num_visitors_min: i64,
    pub num_visitors_max: i64,
    pub avg_green_fee: f64,
}

/// Validated range inputs ready to project.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct RangeSimulationInput {
    avg_green_fee: i64,
    num_visitors_min: i64,
    num_visitors_max: i64,
    /// Visitor count the elasticity curve is anchored on.
    visitors_midpoint: i64,
    projected_revenue_min: i64,
    projected_revenue_max: i64,
    #[getter(skip)]
    period_label: String,
}

impl RangeSimulationInput {
    pub fn period_label(&self) -> &str {
        &self.period_label
    }
}

/// Operating projection over a booking period.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct RangeSimulation {
    projected_revenue_min: i64,
    projected_revenue_max: i64,
    tax_total: i64,
    #[getter(skip)]
    rows: Vec<RangeRow>,
    #[getter(skip)]
    period_label: String,
}

impl RangeSimulation {
    pub fn rows(&self) -> &[RangeRow] {
        &self.rows
    }

    pub fn period_label(&self) -> &str {
        &self.period_label
    }
}

/// Midpoint of an inclusive visitor range, rounding up on ties.
fn visitors_midpoint(min: i64, max: i64) -> i64 {
    min + (max - min + 1) / 2
}

/// Validate the operator's range inputs and derive the projection anchors.
pub fn prepare_range_simulation(
    request: &RangeSimulationRequest,
) -> Result<RangeSimulationInput, CourseError> {
    let date_from = chrono::NaiveDate::parse_from_str(&request.date_from, "%Y-%m-%d")
        .map_err(|_| CourseError::BadRequest("dateFrom must be YYYY-MM-DD"))?;
    let date_to = chrono::NaiveDate::parse_from_str(&request.date_to, "%Y-%m-%d")
        .map_err(|_| CourseError::BadRequest("dateTo must be YYYY-MM-DD"))?;
    if date_from > date_to {
        return Err(CourseError::BadRequest(
            "dateTo must be on or after dateFrom",
        ));
    }
    if request.num_visitors_min < 0
        || request.num_visitors_max < request.num_visitors_min
        || request.num_visitors_max > MAX_VISITORS
    {
        return Err(CourseError::BadRequest(
            "visitor range must be ordered and no more than 1000000",
        ));
    }
    if !request.avg_green_fee.is_finite()
        || request.avg_green_fee <= 0.0
        || request.avg_green_fee > MAX_FEE_AMOUNT
    {
        return Err(CourseError::BadRequest(
            "avgGreenFee must be greater than 0 and no more than 100000000",
        ));
    }

    let avg_green_fee = rounded_i64(request.avg_green_fee)?;
    let projected_revenue_min =
        request
            .num_visitors_min
            .checked_mul(avg_green_fee)
            .ok_or(CourseError::BadRequest(
                "minimum revenue exceeds the supported range",
            ))?;
    let projected_revenue_max =
        request
            .num_visitors_max
            .checked_mul(avg_green_fee)
            .ok_or(CourseError::BadRequest(
                "maximum revenue exceeds the supported range",
            ))?;

    Ok(RangeSimulationInput {
        avg_green_fee,
        num_visitors_min: request.num_visitors_min,
        num_visitors_max: request.num_visitors_max,
        visitors_midpoint: visitors_midpoint(request.num_visitors_min, request.num_visitors_max),
        projected_revenue_min,
        projected_revenue_max,
        period_label: format!("{} - {}", request.date_from, request.date_to),
    })
}

/// Scale the projected rows up to the operator's period.
///
/// The rows are computed at the visitor midpoint; the period tax is the
/// per-taxable-visitor tax applied to the taxable share of peak visitors.
pub fn summarize_range(
    input: &RangeSimulationInput,
    taxable_ratio: f64,
    rows: Vec<RangeRow>,
) -> Result<RangeSimulation, CourseError> {
    let tax_per_taxable_visitor = rows
        .first()
        .filter(|row| row.taxable_visitors > 0)
        .map(|row| row.tax_total as f64 / row.taxable_visitors as f64)
        .unwrap_or(0.0);
    let tax_total = input.num_visitors_max as f64 * taxable_ratio * tax_per_taxable_visitor;
    if !tax_total.is_finite() || tax_total > i64::MAX as f64 || tax_total < i64::MIN as f64 {
        return Err(CourseError::BadRequest(
            "projected tax total is outside the supported range",
        ));
    }

    Ok(RangeSimulation {
        projected_revenue_min: input.projected_revenue_min,
        projected_revenue_max: input.projected_revenue_max,
        tax_total: tax_total.round() as i64,
        rows,
        period_label: input.period_label.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::pricing_settings::{
        DEFAULT_FIXED_COST, DEFAULT_PRICE_ELASTICITY, DEFAULT_TAXABLE_RATIO,
        DEFAULT_VARIABLE_COST_PER_VISITOR,
    };

    fn rule() -> TaxRuleSnapshot {
        TaxRuleSnapshot {
            course_grade: "A".to_string(),
            fee: 800,
            minor_exempt_under_age: 18,
            senior_exempt_min_age: 70,
            disability_cert_exempt: true,
            senior_reduced_min_age: None,
            senior_reduced_percent: None,
        }
    }

    /// Hokkaido's schedule: exempt under 18 and from 70, halved from 65.
    fn hokkaido_rule() -> TaxRuleSnapshot {
        TaxRuleSnapshot {
            senior_reduced_min_age: Some(65),
            senior_reduced_percent: Some(50),
            ..rule()
        }
    }

    #[test]
    fn a_player_in_the_reduced_band_owes_a_share_not_the_whole_rate() {
        // Charging these players the full rate is what the table used to do,
        // because it could only say exempt or not exempt.
        let rule = hokkaido_rule();
        let tax = party_tax(
            &rule,
            &[SimulatedPlayer {
                age: 65,
                has_disability_cert: false,
            }],
        );
        assert_eq!(tax.tax_amount(), 400);
        assert_eq!(tax.lines()[0].reason(), Some("senior_reduced"));
        assert!(!tax.lines()[0].exempt());
    }

    #[test]
    fn the_reduced_band_ends_where_the_exemption_begins() {
        let rule = hokkaido_rule();
        let party = [
            SimulatedPlayer {
                age: 64,
                has_disability_cert: false,
            },
            SimulatedPlayer {
                age: 69,
                has_disability_cert: false,
            },
            SimulatedPlayer {
                age: 70,
                has_disability_cert: false,
            },
        ];
        let lines = party_tax(&rule, &party);
        assert_eq!(lines.lines()[0].fee(), 800, "64 is still full price");
        assert_eq!(lines.lines()[1].fee(), 400, "69 is still reduced");
        assert_eq!(lines.lines()[2].fee(), 0, "70 is exempt outright");
        assert_eq!(lines.lines()[2].reason(), Some("senior"));
    }

    #[test]
    fn a_rule_without_a_reduced_band_charges_as_before() {
        let tax = party_tax(
            &rule(),
            &[SimulatedPlayer {
                age: 66,
                has_disability_cert: false,
            }],
        );
        assert_eq!(tax.tax_amount(), 800);
        assert_eq!(tax.lines()[0].reason(), None);
    }

    #[test]
    fn the_reduced_share_rounds_down_to_a_rate_the_schedule_names() {
        // 11 grades, 80-yen steps: halving an odd grade must not invent a yen.
        let rule = TaxRuleSnapshot {
            fee: 1120,
            ..hokkaido_rule()
        };
        let tax = party_tax(
            &rule,
            &[SimulatedPlayer {
                age: 68,
                has_disability_cert: false,
            }],
        );
        assert_eq!(tax.tax_amount(), 560);
    }

    #[test]
    fn party_tax_applies_exemptions_in_order() {
        let players = [
            SimulatedPlayer {
                age: 17,
                has_disability_cert: false,
            },
            SimulatedPlayer {
                age: 70,
                has_disability_cert: false,
            },
            SimulatedPlayer {
                age: 42,
                has_disability_cert: true,
            },
            SimulatedPlayer::representative(),
        ];
        let tax = party_tax(&rule(), &players);

        assert_eq!(tax.tax_amount(), 800);
        assert_eq!(tax.course_grade(), "A");
        assert_eq!(tax.lines()[0].reason(), Some("minor"));
        assert_eq!(tax.lines()[1].reason(), Some("senior"));
        assert_eq!(tax.lines()[2].reason(), Some("disability_cert"));
        assert_eq!(tax.lines()[3].reason(), None);
        assert_eq!(tax.lines()[3].fee(), 800);
    }

    #[test]
    fn fee_quote_sums_play_fees_and_tax() {
        let input = prepare_fee_quote(&FeeQuoteRequest {
            green_fee: 10_000.0,
            num_holes: 18,
            cart_fee: Some(2_000.0),
            caddy_fee: Some(3_000.0),
        })
        .expect("valid request");
        assert_eq!(input.subtotal(), 15_000);

        let quote = quote_fee(
            &input,
            party_tax(&rule(), &[SimulatedPlayer::representative()]),
        )
        .expect("quote");
        assert_eq!(quote.tax_amount(), 800);
        assert_eq!(quote.total(), 15_800);
        assert!((quote.tax_rate() - 8.0).abs() < 1e-9);
    }

    #[test]
    fn fee_quote_rejects_invalid_input() {
        let base = FeeQuoteRequest {
            green_fee: 10_000.0,
            num_holes: 18,
            cart_fee: None,
            caddy_fee: None,
        };
        assert!(prepare_fee_quote(&FeeQuoteRequest {
            green_fee: 0.0,
            ..base
        })
        .is_err());
        assert!(prepare_fee_quote(&FeeQuoteRequest {
            num_holes: 27,
            ..base
        })
        .is_err());
        assert!(prepare_fee_quote(&FeeQuoteRequest {
            cart_fee: Some(-1.0),
            ..base
        })
        .is_err());
    }

    #[test]
    fn range_midpoint_rounds_up_on_ties() {
        assert_eq!(visitors_midpoint(0, 0), 0);
        assert_eq!(visitors_midpoint(10, 20), 15);
        assert_eq!(visitors_midpoint(10, 11), 11);
    }

    #[test]
    fn range_preparation_derives_revenue_bounds_and_label() {
        let input = prepare_range_simulation(&RangeSimulationRequest {
            date_from: "2026-07-01".to_string(),
            date_to: "2026-07-31".to_string(),
            num_visitors_min: 100,
            num_visitors_max: 200,
            avg_green_fee: 12_000.0,
        })
        .expect("valid request");

        assert_eq!(input.projected_revenue_min(), 1_200_000);
        assert_eq!(input.projected_revenue_max(), 2_400_000);
        assert_eq!(input.visitors_midpoint(), 150);
        assert_eq!(input.period_label(), "2026-07-01 - 2026-07-31");
    }

    #[test]
    fn range_preparation_rejects_invalid_input() {
        let base = RangeSimulationRequest {
            date_from: "2026-07-01".to_string(),
            date_to: "2026-07-31".to_string(),
            num_visitors_min: 100,
            num_visitors_max: 200,
            avg_green_fee: 12_000.0,
        };
        assert!(prepare_range_simulation(&RangeSimulationRequest {
            date_to: "2026-06-30".to_string(),
            ..base.clone()
        })
        .is_err());
        assert!(prepare_range_simulation(&RangeSimulationRequest {
            date_from: "07/01/2026".to_string(),
            ..base.clone()
        })
        .is_err());
        assert!(prepare_range_simulation(&RangeSimulationRequest {
            num_visitors_max: 50,
            ..base.clone()
        })
        .is_err());
        assert!(prepare_range_simulation(&RangeSimulationRequest {
            avg_green_fee: 0.0,
            ..base
        })
        .is_err());
    }

    #[test]
    fn row_projection_follows_elasticity_curve() {
        let row = project_row(
            &RangeRowInput {
                green_fee: 12_000,
                base_visitors: 150,
                base_green_fee: 12_000,
                price_elasticity: DEFAULT_PRICE_ELASTICITY,
                taxable_ratio: DEFAULT_TAXABLE_RATIO,
                fixed_cost: DEFAULT_FIXED_COST,
                variable_cost_per_visitor: DEFAULT_VARIABLE_COST_PER_VISITOR,
            },
            &rule(),
        );

        // At the base green fee the curve returns the base visitor count.
        assert_eq!(row.visitors(), 150);
        assert_eq!(row.taxable_visitors(), 128); // 150 * 0.85 = 127.5 → 128
        assert_eq!(row.revenue(), 1_800_000);
        assert_eq!(row.tax_total(), 128 * 800);
        assert_eq!(row.variable_cost(), 150 * 1_500);
        assert_eq!(row.profit(), 1_800_000 - 128 * 800 - 150 * 1_500 - 300_000);
    }

    #[test]
    fn range_summary_scales_tax_to_peak_visitors() {
        let input = prepare_range_simulation(&RangeSimulationRequest {
            date_from: "2026-07-01".to_string(),
            date_to: "2026-07-31".to_string(),
            num_visitors_min: 100,
            num_visitors_max: 200,
            avg_green_fee: 12_000.0,
        })
        .expect("valid request");
        let row = project_row(
            &RangeRowInput {
                green_fee: 12_000,
                base_visitors: input.visitors_midpoint(),
                base_green_fee: input.avg_green_fee(),
                price_elasticity: DEFAULT_PRICE_ELASTICITY,
                taxable_ratio: DEFAULT_TAXABLE_RATIO,
                fixed_cost: DEFAULT_FIXED_COST,
                variable_cost_per_visitor: DEFAULT_VARIABLE_COST_PER_VISITOR,
            },
            &rule(),
        );

        let summary = summarize_range(&input, DEFAULT_TAXABLE_RATIO, vec![row]).expect("summary");
        // 200 visitors * 0.85 taxable * 800 JPY per taxable visitor.
        assert_eq!(summary.tax_total(), 136_000);
        assert_eq!(summary.projected_revenue_max(), 2_400_000);
        assert_eq!(summary.period_label(), "2026-07-01 - 2026-07-31");
    }

    #[test]
    fn range_summary_is_zero_without_taxable_visitors() {
        let input = prepare_range_simulation(&RangeSimulationRequest {
            date_from: "2026-07-01".to_string(),
            date_to: "2026-07-01".to_string(),
            num_visitors_min: 0,
            num_visitors_max: 0,
            avg_green_fee: 12_000.0,
        })
        .expect("valid request");
        let summary = summarize_range(&input, DEFAULT_TAXABLE_RATIO, Vec::new()).expect("summary");
        assert_eq!(summary.tax_total(), 0);
        assert!(summary.rows().is_empty());
    }
}
