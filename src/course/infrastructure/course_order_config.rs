//! The ledger's column order, stored in the golf extension config.
//!
//! Field's `golf_courses` has no sort column, and adding one would put a
//! CourseBoard-only concern into the shared ERP schema. The extension config is
//! the tenant-scoped bag CourseBoard already owns — the same place plans keep
//! their `golfCourseId` — so the order lives there and Field passes it through
//! untouched.

use serde_json::{Map, Value};

use crate::course::domain::{CourseId, CourseOrder};

/// Namespaced because the config is shared with the generic reservation
/// products the storefront reads.
pub(crate) const COURSE_ORDER_KEY: &str = "golfCourseOrder";

pub(crate) fn read_course_order(config: &Value) -> CourseOrder {
    let Some(entries) = config.get(COURSE_ORDER_KEY).and_then(Value::as_array) else {
        return CourseOrder::default();
    };
    CourseOrder::new(
        entries
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(CourseId::new),
    )
}

/// The config with only the column order replaced.
///
/// An empty order removes the key rather than storing `[]`, so a tenant that
/// has never arranged its board looks the same as one that cleared it.
pub(crate) fn with_course_order(config: &Value, order: &CourseOrder) -> Value {
    let mut object = config.as_object().cloned().unwrap_or_else(Map::new);
    if order.is_empty() {
        object.remove(COURSE_ORDER_KEY);
    } else {
        object.insert(
            COURSE_ORDER_KEY.into(),
            Value::Array(
                order
                    .ids()
                    .iter()
                    .map(|id| Value::String(id.to_string()))
                    .collect(),
            ),
        );
    }
    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn order(ids: &[&str]) -> CourseOrder {
        CourseOrder::new(ids.iter().map(|id| CourseId::new(*id)))
    }

    #[test]
    fn a_tenant_that_never_arranged_its_board_has_no_order() {
        assert!(read_course_order(&json!({})).is_empty());
        assert!(read_course_order(&json!({ "reservationProducts": [] })).is_empty());
    }

    #[test]
    fn what_was_written_is_what_comes_back() {
        let stored = with_course_order(&json!({}), &order(&["a", "b"]));
        assert_eq!(read_course_order(&stored), order(&["a", "b"]));
    }

    #[test]
    fn arranging_the_board_leaves_the_plans_in_the_same_config_alone() {
        // The extension config is shared: the storefront reads its products out
        // of the same object.
        let config = json!({ "reservationProducts": [{ "id": "plan-1" }], "defaultHoles": 18 });
        let stored = with_course_order(&config, &order(&["a"]));
        assert_eq!(stored["reservationProducts"], config["reservationProducts"]);
        assert_eq!(stored["defaultHoles"], json!(18));
    }

    #[test]
    fn clearing_the_order_removes_the_key_rather_than_leaving_an_empty_list() {
        let stored = with_course_order(&json!({ "defaultHoles": 18 }), &order(&["a"]));
        let cleared = with_course_order(&stored, &CourseOrder::default());
        assert_eq!(cleared["defaultHoles"], json!(18));
        assert!(cleared.get(COURSE_ORDER_KEY).is_none());
    }

    #[test]
    fn entries_that_are_not_course_ids_are_skipped_instead_of_breaking_the_board() {
        // The config is shared and anything may have written to it.
        let stored = json!({ COURSE_ORDER_KEY: ["a", 7, null, "  ", { "id": "b" }, "c"] });
        assert_eq!(read_course_order(&stored), order(&["a", "c"]));
    }

    #[test]
    fn an_order_that_is_not_a_list_reads_as_no_order() {
        assert!(read_course_order(&json!({ COURSE_ORDER_KEY: "a,b" })).is_empty());
    }
}
