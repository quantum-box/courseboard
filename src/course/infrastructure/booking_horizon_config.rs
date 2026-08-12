//! How far ahead the club sells, stored in the golf extension config.
//!
//! Field's reservation policy counts backwards — `cutoff_hours` is how late a
//! booking may still be taken — and has no notion of how far forward a club
//! opens its book. Adding one would put a golf operating rule into the shared
//! ERP schema (ADR-0005), so the value lives in the tenant-scoped config
//! CourseBoard already owns, beside the caddie rank fees.
//!
//! Written as one object under `bookingHorizon`, because a rolling window and a
//! named closing date are one setting with two shapes: two independent keys
//! would let a config say both at once and leave the reader to pick a winner.
//! `bookingHorizonDays` is the older spelling of the rolling window; it is read
//! when no object is there, and removed on the first save so that a stale
//! number cannot later look like a second answer.

use chrono::NaiveDate;
use serde_json::{Map, Value};

use crate::course::domain::BookingHorizon;

pub(crate) const BOOKING_HORIZON_KEY: &str = "bookingHorizon";
/// Pre-object spelling: a bare day count.
pub(crate) const LEGACY_BOOKING_HORIZON_DAYS_KEY: &str = "bookingHorizonDays";

/// How far ahead a club is selling, or the default when it has never said.
///
/// Never fails. A config another writer mangled still has to leave the schedule
/// screen openable, and generating the default window says what is on sale far
/// more plainly than an error does.
pub(crate) fn read_booking_horizon(config: &Value) -> BookingHorizon {
    config
        .get(BOOKING_HORIZON_KEY)
        .and_then(read_horizon_object)
        .or_else(|| {
            config
                .get(LEGACY_BOOKING_HORIZON_DAYS_KEY)
                .and_then(Value::as_i64)
                .and_then(|days| BookingHorizon::try_days(days).ok())
        })
        .unwrap_or_default()
}

fn read_horizon_object(value: &Value) -> Option<BookingHorizon> {
    match value.get("mode").and_then(Value::as_str) {
        Some("through") => value
            .get("through")
            .and_then(Value::as_str)
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
            .map(BookingHorizon::through),
        Some("days") => value
            .get("days")
            .and_then(Value::as_i64)
            .and_then(|days| BookingHorizon::try_days(days).ok()),
        _ => None,
    }
}

/// The config with only the horizon replaced.
pub(crate) fn with_booking_horizon(config: &Value, horizon: &BookingHorizon) -> Value {
    let mut object = config.as_object().cloned().unwrap_or_else(Map::new);
    object.insert(BOOKING_HORIZON_KEY.into(), horizon_value(horizon));
    object.remove(LEGACY_BOOKING_HORIZON_DAYS_KEY);
    Value::Object(object)
}

fn horizon_value(horizon: &BookingHorizon) -> Value {
    let mut object = Map::new();
    match horizon {
        BookingHorizon::Days(days) => {
            object.insert("mode".into(), Value::from("days"));
            object.insert("days".into(), Value::from(*days));
        }
        BookingHorizon::Through(date) => {
            object.insert("mode".into(), Value::from("through"));
            object.insert(
                "through".into(),
                Value::from(date.format("%Y-%m-%d").to_string()),
            );
        }
    }
    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).expect("valid date")
    }

    #[test]
    fn a_club_that_never_set_one_is_selling_the_default_window() {
        assert_eq!(read_booking_horizon(&json!({})), BookingHorizon::default());
        assert_eq!(
            read_booking_horizon(&json!({ "defaultHoles": 18 })),
            BookingHorizon::default()
        );
    }

    #[test]
    fn what_was_written_is_what_comes_back() {
        for horizon in [
            BookingHorizon::try_days(90).expect("valid horizon"),
            BookingHorizon::through(date(2026, 11, 30)),
        ] {
            let stored = with_booking_horizon(&json!({}), &horizon);
            assert_eq!(read_booking_horizon(&stored), horizon);
        }
    }

    #[test]
    fn a_club_that_only_ever_saved_the_older_day_count_keeps_it() {
        assert_eq!(
            read_booking_horizon(&json!({ LEGACY_BOOKING_HORIZON_DAYS_KEY: 90 })),
            BookingHorizon::try_days(90).expect("valid horizon")
        );
    }

    #[test]
    fn saving_removes_the_older_day_count_so_it_cannot_answer_for_a_later_read() {
        let config = json!({ LEGACY_BOOKING_HORIZON_DAYS_KEY: 180, "defaultHoles": 18 });
        let stored = with_booking_horizon(&config, &BookingHorizon::through(date(2026, 11, 30)));
        assert!(stored.get(LEGACY_BOOKING_HORIZON_DAYS_KEY).is_none());
        assert_eq!(
            read_booking_horizon(&stored),
            BookingHorizon::through(date(2026, 11, 30))
        );
        assert_eq!(stored["defaultHoles"], json!(18));
    }

    #[test]
    fn saving_the_horizon_leaves_the_plans_in_the_same_config_alone() {
        let config = json!({ "reservationProducts": [{ "id": "plan-1" }], "defaultHoles": 18 });
        let stored = with_booking_horizon(
            &config,
            &BookingHorizon::try_days(60).expect("valid horizon"),
        );
        assert_eq!(stored["reservationProducts"], config["reservationProducts"]);
        assert_eq!(stored["defaultHoles"], json!(18));
    }

    #[test]
    fn a_value_outside_what_can_be_generated_falls_back_rather_than_failing_every_save() {
        // A horizon of 0 would put nothing on sale, and one past the generate
        // cap would make every save fail. Neither is worth honouring.
        assert_eq!(
            read_booking_horizon(&json!({ BOOKING_HORIZON_KEY: { "mode": "days", "days": 0 } })),
            BookingHorizon::default()
        );
        assert_eq!(
            read_booking_horizon(
                &json!({ BOOKING_HORIZON_KEY: { "mode": "days", "days": 4_000 } })
            ),
            BookingHorizon::default()
        );
        assert_eq!(
            read_booking_horizon(&json!({ LEGACY_BOOKING_HORIZON_DAYS_KEY: "180" })),
            BookingHorizon::default()
        );
    }

    #[test]
    fn a_closing_date_that_is_not_a_date_falls_back_rather_than_selling_a_guess() {
        for stored in [json!("2026-13-01"), json!("30/11/2026"), json!(20261130)] {
            assert_eq!(
                read_booking_horizon(
                    &json!({ BOOKING_HORIZON_KEY: { "mode": "through", "through": stored } })
                ),
                BookingHorizon::default()
            );
        }
    }

    #[test]
    fn a_stored_closing_date_is_honoured_even_once_it_is_behind_us() {
        // The season ending is exactly what this says, so reading it back as the
        // default window would quietly reopen a book the club closed.
        assert_eq!(
            read_booking_horizon(
                &json!({ BOOKING_HORIZON_KEY: { "mode": "through", "through": "2020-11-30" } })
            ),
            BookingHorizon::through(date(2020, 11, 30))
        );
    }
}
