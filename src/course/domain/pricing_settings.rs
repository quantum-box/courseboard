//! What a course has to tell us before its prices can be worked out.
//!
//! Both of these used to be constants compiled into the binary. The prefecture
//! was fixed to Hokkaido, so a course anywhere else looked up a tax schedule
//! that could not apply to it and pricing answered 400 for every request. The
//! cost assumptions were shared by every course in the product, so the revenue
//! projection quoted one course's economics at all of them.
//!
//! They live in the golf extension config, next to `defaultHoles` — the place
//! tenant-specific settings already sit.

use serde_json::Value;

/// Assumed until the operator says otherwise. Kept so an existing tenant's
/// projection reads the same after this change as it did before; each is a
/// placeholder for a real number the course knows and we do not.
pub const DEFAULT_TAXABLE_RATIO: f64 = 0.85;
pub const DEFAULT_PRICE_ELASTICITY: f64 = -1.2;
pub const DEFAULT_FIXED_COST: i64 = 300_000;
pub const DEFAULT_VARIABLE_COST_PER_VISITOR: i64 = 1_500;

/// Golf pricing inputs a course owns.
#[derive(Debug, Clone, PartialEq)]
pub struct GolfPricingSettings {
    /// Which prefecture's tax schedule applies. `None` when the operator has
    /// not chosen one yet, which is a question to ask rather than a value to
    /// guess — the schedules differ and a wrong guess is a wrong tax.
    pub prefecture: Option<String>,
    /// The grade the prefecture assigned this course. Not derivable from the
    /// green fee: the prefecture notifies each course of its own grade.
    pub tax_grade: Option<String>,
    pub taxable_ratio: f64,
    pub price_elasticity: f64,
    pub fixed_cost: i64,
    pub variable_cost_per_visitor: i64,
}

impl Default for GolfPricingSettings {
    fn default() -> Self {
        Self {
            prefecture: None,
            tax_grade: None,
            taxable_ratio: DEFAULT_TAXABLE_RATIO,
            price_elasticity: DEFAULT_PRICE_ELASTICITY,
            fixed_cost: DEFAULT_FIXED_COST,
            variable_cost_per_visitor: DEFAULT_VARIABLE_COST_PER_VISITOR,
        }
    }
}

fn non_empty(config: &Value, key: &str) -> Option<String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// A finite number, or the default. A `null`, a string, or a NaN in the config
/// must not silently become part of a price.
fn finite(config: &Value, key: &str, fallback: f64) -> f64 {
    config
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn whole(config: &Value, key: &str, fallback: i64) -> i64 {
    config
        .get(key)
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .unwrap_or(fallback)
}

impl GolfPricingSettings {
    /// Read the settings out of the extension config, falling back per field.
    ///
    /// A missing or unreadable field takes the default rather than failing the
    /// request: a half-filled config should still price, and the operator sees
    /// the blank on the settings screen.
    pub fn from_config(config: &Value) -> Self {
        let defaults = Self::default();
        Self {
            prefecture: non_empty(config, "prefecture"),
            tax_grade: non_empty(config, "taxGrade"),
            taxable_ratio: finite(config, "taxableRatio", defaults.taxable_ratio).clamp(0.0, 1.0),
            price_elasticity: finite(config, "priceElasticity", defaults.price_elasticity),
            fixed_cost: whole(config, "fixedCostPerDay", defaults.fixed_cost),
            variable_cost_per_visitor: whole(
                config,
                "variableCostPerVisitor",
                defaults.variable_cost_per_visitor,
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_unset_config_keeps_every_projection_reading_as_it_did() {
        // Existing tenants have none of these keys. Their numbers must not move.
        let settings = GolfPricingSettings::from_config(&json!({ "defaultHoles": 18 }));
        assert_eq!(settings, GolfPricingSettings::default());
        assert_eq!(settings.taxable_ratio, DEFAULT_TAXABLE_RATIO);
        assert_eq!(settings.fixed_cost, DEFAULT_FIXED_COST);
    }

    #[test]
    fn the_prefecture_is_asked_for_rather_than_guessed() {
        // It was pinned to Hokkaido, so any course elsewhere looked up a
        // schedule that could not apply and pricing failed outright.
        assert_eq!(
            GolfPricingSettings::from_config(&json!({})).prefecture,
            None
        );
        assert_eq!(
            GolfPricingSettings::from_config(&json!({ "prefecture": " chiba " })).prefecture,
            Some("chiba".to_string())
        );
        assert_eq!(
            GolfPricingSettings::from_config(&json!({ "prefecture": "   " })).prefecture,
            None
        );
    }

    #[test]
    fn the_course_grade_comes_from_the_config_because_only_the_prefecture_knows_it() {
        let settings = GolfPricingSettings::from_config(&json!({ "taxGrade": "7" }));
        assert_eq!(settings.tax_grade, Some("7".to_string()));
    }

    #[test]
    fn the_costs_a_course_knows_override_the_placeholders() {
        let settings = GolfPricingSettings::from_config(&json!({
            "taxableRatio": 0.6,
            "priceElasticity": -0.8,
            "fixedCostPerDay": 450000,
            "variableCostPerVisitor": 2200,
        }));
        assert_eq!(settings.taxable_ratio, 0.6);
        assert_eq!(settings.price_elasticity, -0.8);
        assert_eq!(settings.fixed_cost, 450_000);
        assert_eq!(settings.variable_cost_per_visitor, 2_200);
    }

    #[test]
    fn a_value_that_cannot_be_a_price_falls_back_rather_than_reaching_the_arithmetic() {
        let settings = GolfPricingSettings::from_config(&json!({
            "taxableRatio": "0.5",
            "fixedCostPerDay": -1,
            "variableCostPerVisitor": null,
        }));
        assert_eq!(settings.taxable_ratio, DEFAULT_TAXABLE_RATIO);
        assert_eq!(settings.fixed_cost, DEFAULT_FIXED_COST);
        assert_eq!(
            settings.variable_cost_per_visitor,
            DEFAULT_VARIABLE_COST_PER_VISITOR
        );
    }

    #[test]
    fn a_taxable_share_outside_zero_to_one_is_pulled_back_into_range() {
        // A share above 1 would tax more visitors than turned up.
        assert_eq!(
            GolfPricingSettings::from_config(&json!({ "taxableRatio": 1.4 })).taxable_ratio,
            1.0
        );
        assert_eq!(
            GolfPricingSettings::from_config(&json!({ "taxableRatio": -0.2 })).taxable_ratio,
            0.0
        );
    }
}
