//! The rank fee table, stored in the golf extension config.
//!
//! Field has no notion of a caddie grade and no column to pay one by, and
//! adding both would put a golf rule into the shared ERP schema (ADR-0005). The
//! extension config is the tenant-scoped bag CourseBoard already owns — the
//! same place the ledger keeps its column order — so the table lives there and
//! Field passes it through untouched.

use serde_json::{Map, Value};

use crate::course::domain::{CaddieRank, CaddieRankFees};

/// Namespaced because the config is shared with the generic reservation
/// products the storefront reads.
pub(crate) const CADDIE_RANK_FEES_KEY: &str = "caddieRankFees";

fn amount(table: &Map<String, Value>, rank: &str, fallback: i64) -> i64 {
    // A key someone else wrote a string or a null into is not an amount. Taking
    // it as zero would pay nobody at that rank; the default at least pays.
    table
        .get(rank)
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .unwrap_or(fallback)
}

/// The table a club is paying by, or the defaults when it has never set one.
///
/// Never fails: a config another writer mangled has to leave the payroll screen
/// openable, and a screen showing the defaults says what is being paid far more
/// plainly than an error does.
pub(crate) fn read_caddie_rank_fees(config: &Value) -> CaddieRankFees {
    let defaults = CaddieRankFees::default();
    let Some(table) = config.get(CADDIE_RANK_FEES_KEY).and_then(Value::as_object) else {
        return defaults;
    };
    let currency = table
        .get("currency")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CaddieRankFees::DEFAULT_CURRENCY);

    CaddieRankFees::try_new(
        amount(table, "A", defaults.fee_for(CaddieRank::A)),
        amount(table, "B", defaults.fee_for(CaddieRank::B)),
        amount(table, "C", defaults.fee_for(CaddieRank::C)),
        amount(table, "D", defaults.fee_for(CaddieRank::D)),
        currency,
    )
    .unwrap_or(defaults)
}

/// The config with only the rank fee table replaced.
pub(crate) fn with_caddie_rank_fees(config: &Value, fees: &CaddieRankFees) -> Value {
    let mut object = config.as_object().cloned().unwrap_or_else(Map::new);
    let mut table = Map::new();
    for rank in CaddieRank::ALL {
        table.insert(rank.as_str().to_string(), Value::from(fees.fee_for(rank)));
    }
    table.insert(
        "currency".into(),
        Value::String(fees.currency().to_string()),
    );
    object.insert(CADDIE_RANK_FEES_KEY.into(), Value::Object(table));
    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::CaddieRank;
    use serde_json::json;

    fn table(a: i64, b: i64, c: i64, d: i64) -> CaddieRankFees {
        CaddieRankFees::try_new(a, b, c, d, "JPY").expect("valid table")
    }

    #[test]
    fn a_club_that_never_set_a_table_is_paying_by_the_defaults() {
        assert_eq!(read_caddie_rank_fees(&json!({})), CaddieRankFees::default());
        assert_eq!(
            read_caddie_rank_fees(&json!({ "defaultHoles": 18 })),
            CaddieRankFees::default()
        );
    }

    #[test]
    fn what_was_written_is_what_comes_back() {
        let stored = with_caddie_rank_fees(&json!({}), &table(15_000, 13_000, 11_000, 9_000));
        assert_eq!(
            read_caddie_rank_fees(&stored),
            table(15_000, 13_000, 11_000, 9_000)
        );
    }

    #[test]
    fn saving_the_table_leaves_the_plans_in_the_same_config_alone() {
        // The extension config is shared: the storefront reads its products out
        // of the same object.
        let config = json!({ "reservationProducts": [{ "id": "plan-1" }], "defaultHoles": 18 });
        let stored = with_caddie_rank_fees(&config, &table(1, 2, 3, 4));
        assert_eq!(stored["reservationProducts"], config["reservationProducts"]);
        assert_eq!(stored["defaultHoles"], json!(18));
    }

    #[test]
    fn a_rank_someone_else_wrote_nonsense_into_falls_back_rather_than_paying_nothing() {
        let stored = json!({
            CADDIE_RANK_FEES_KEY: { "A": "15000", "B": null, "C": -1, "D": 9_000 }
        });
        let fees = read_caddie_rank_fees(&stored);
        assert_eq!(fees.fee_for(CaddieRank::A), CaddieRankFees::DEFAULT_A);
        assert_eq!(fees.fee_for(CaddieRank::B), CaddieRankFees::DEFAULT_B);
        assert_eq!(fees.fee_for(CaddieRank::C), CaddieRankFees::DEFAULT_C);
        assert_eq!(fees.fee_for(CaddieRank::D), 9_000);
    }

    #[test]
    fn a_table_that_is_not_an_object_reads_as_no_table() {
        assert_eq!(
            read_caddie_rank_fees(&json!({ CADDIE_RANK_FEES_KEY: "A=15000" })),
            CaddieRankFees::default()
        );
    }

    #[test]
    fn a_zero_at_one_rank_is_kept_because_it_may_be_deliberate() {
        // A rank nobody holds yet is allowed to be unpriced; only negatives and
        // non-numbers fall back.
        let stored = with_caddie_rank_fees(&json!({}), &table(12_000, 11_000, 10_000, 0));
        assert_eq!(read_caddie_rank_fees(&stored).fee_for(CaddieRank::D), 0);
    }

    #[test]
    fn the_currency_survives_the_round_trip() {
        let usd = CaddieRankFees::try_new(120, 110, 100, 90, "USD").expect("valid table");
        let stored = with_caddie_rank_fees(&json!({}), &usd);
        assert_eq!(read_caddie_rank_fees(&stored).currency(), "USD");
    }
}
