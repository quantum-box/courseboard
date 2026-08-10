//! How far ahead the club sells, stored in the golf extension config.
//!
//! Field's reservation policy counts backwards — `cutoff_hours` is how late a
//! booking may still be taken — and has no notion of how far forward a club
//! opens its book. Adding one would put a golf operating rule into the shared
//! ERP schema (ADR-0005), so the number lives in the tenant-scoped config
//! CourseBoard already owns, beside the caddie rank fees.

use serde_json::{Map, Value};

use crate::course::domain::BookingHorizon;

/// Namespaced because the config is shared with the generic reservation
/// products the storefront reads.
pub(crate) const BOOKING_HORIZON_KEY: &str = "bookingHorizonDays";

/// How far ahead a club is selling, or the default when it has never said.
///
/// Never fails. A config another writer mangled still has to leave the schedule
/// screen openable, and generating the default window says what is on sale far
/// more plainly than an error does.
pub(crate) fn read_booking_horizon(config: &Value) -> BookingHorizon {
    config
        .get(BOOKING_HORIZON_KEY)
        .and_then(Value::as_i64)
        .and_then(|days| BookingHorizon::try_new(days).ok())
        .unwrap_or_default()
}

/// The config with only the horizon replaced.
pub(crate) fn with_booking_horizon(config: &Value, horizon: &BookingHorizon) -> Value {
    let mut object = config.as_object().cloned().unwrap_or_else(Map::new);
    object.insert(BOOKING_HORIZON_KEY.into(), Value::from(horizon.days()));
    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
        let horizon = BookingHorizon::try_new(90).expect("valid horizon");
        let stored = with_booking_horizon(&json!({}), &horizon);
        assert_eq!(read_booking_horizon(&stored), horizon);
    }

    #[test]
    fn saving_the_horizon_leaves_the_plans_in_the_same_config_alone() {
        let config = json!({ "reservationProducts": [{ "id": "plan-1" }], "defaultHoles": 18 });
        let stored = with_booking_horizon(
            &config,
            &BookingHorizon::try_new(60).expect("valid horizon"),
        );
        assert_eq!(stored["reservationProducts"], config["reservationProducts"]);
        assert_eq!(stored["defaultHoles"], json!(18));
    }

    #[test]
    fn a_value_outside_what_can_be_generated_falls_back_rather_than_failing_every_save() {
        // A horizon of 0 would put nothing on sale, and one past the generate
        // cap would make every save fail. Neither is worth honouring.
        assert_eq!(
            read_booking_horizon(&json!({ BOOKING_HORIZON_KEY: 0 })),
            BookingHorizon::default()
        );
        assert_eq!(
            read_booking_horizon(&json!({ BOOKING_HORIZON_KEY: 4_000 })),
            BookingHorizon::default()
        );
        assert_eq!(
            read_booking_horizon(&json!({ BOOKING_HORIZON_KEY: "180" })),
            BookingHorizon::default()
        );
    }
}
