//! Golf plans stored as generic reservation products in the extension config.
//!
//! Field owns a business-agnostic product shape that every industry extension
//! uses: an array under `extension_configs.config_json.reservationProducts`,
//! read back by `GET /v1/storekit/reservation-products` without knowing what
//! industry wrote it. Golf is the only extension that also had its own
//! `golf_reservation_products` table, and that table is the broken path — it
//! carries a hard foreign key onto `reservation_services`, which nothing in
//! Field ever inserts.
//!
//! So the golf meaning lives here, in CourseBoard's anti-corruption layer:
//! play type and hole count ride along as extra keys on the generic product,
//! which Field passes through untouched.

use serde_json::{json, Map, Value};

use crate::course::domain::{
    CourseError, PlayType, ProductSlot, ReservationProduct, ReservationServiceId,
    UpsertReservationProduct,
};

pub(crate) const PRODUCTS_KEY: &str = "reservationProducts";

/// Golf keys CourseBoard adds to the generic product. Field neither reads nor
/// validates them; the storefront only looks at `enabled`, `availability` and
/// `slots`.
const PLAY_TYPE_KEY: &str = "playType";
const HOLE_COUNT_KEY: &str = "holeCount";

fn as_products(config: &Value) -> Vec<Value> {
    config
        .get(PRODUCTS_KEY)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn service_id_of(product: &Value) -> Option<&str> {
    product
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn read_products(config: &Value) -> Vec<ReservationProduct> {
    as_products(config).iter().filter_map(to_domain).collect()
}

fn to_domain(product: &Value) -> Option<ReservationProduct> {
    let service_id = service_id_of(product)?;
    let play_type = product
        .get(PLAY_TYPE_KEY)
        .and_then(Value::as_str)
        .map(PlayType::parse)
        .unwrap_or(PlayType::SelfPlay);
    let hole_count = product
        .get(HOLE_COUNT_KEY)
        .and_then(Value::as_i64)
        .unwrap_or(18) as i32;
    let duration = product
        .get("durationMinutes")
        .and_then(Value::as_i64)
        .unwrap_or(0) as i32;
    let display_name = product
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string);

    Some(ReservationProduct::reconstitute(
        service_id.to_string(),
        None,
        service_id.to_string(),
        display_name,
        play_type,
        hole_count,
        duration,
    ))
}

/// Writes the plan into the products array, keeping every key Field or another
/// surface put there. A plan the operator never edited must survive untouched.
pub(crate) fn upsert_product(config: &Value, input: &UpsertReservationProduct) -> Value {
    let service_id = input.reservation_service_id.as_str();
    let mut products = as_products(config);
    let existing = products
        .iter()
        .position(|product| service_id_of(product) == Some(service_id));

    let mut product = existing
        .and_then(|index| products.get(index).cloned())
        .unwrap_or_else(|| json!({ "id": service_id, "enabled": true, "bookingMode": "slot" }));

    if let Some(object) = product.as_object_mut() {
        object.insert("id".into(), json!(service_id));
        object.insert(
            "name".into(),
            json!(input.display_name.as_deref().unwrap_or(service_id)),
        );
        object.insert(PLAY_TYPE_KEY.into(), json!(input.play_type.as_str()));
        object.insert(HOLE_COUNT_KEY.into(), json!(input.hole_count.get()));
        object.insert(
            "durationMinutes".into(),
            json!(input.expected_duration_minutes.get()),
        );
        object.entry("enabled").or_insert(json!(true));
        object.entry("bookingMode").or_insert(json!("slot"));
    }

    match existing {
        Some(index) => products[index] = product,
        None => products.push(product),
    }
    with_products(config, products)
}

pub(crate) fn read_slots(
    config: &Value,
    service_id: &ReservationServiceId,
) -> Result<Vec<ProductSlot>, CourseError> {
    let Some(product) = find_product(config, service_id) else {
        return Ok(Vec::new());
    };
    product
        .get("slots")
        .and_then(Value::as_array)
        .map(|slots| slots.iter().filter_map(slot_to_domain).collect())
        .transpose()
        .map(Option::unwrap_or_default)
}

fn slot_to_domain(slot: &Value) -> Option<Result<ProductSlot, CourseError>> {
    // The generic slot repeats weekly over a `weekdays` array; a golf slot is
    // one weekday, so a shared slot expands into one row per weekday.
    let start = slot.get("startTime").and_then(Value::as_str)?;
    let end = slot.get("endTime").and_then(Value::as_str)?;
    let weekday = slot
        .get("weekdays")
        .and_then(Value::as_array)
        .and_then(|days| days.first())
        .and_then(Value::as_u64)? as u8;
    Some(ProductSlot::reconstitute(
        slot.get("id").and_then(Value::as_str).map(str::to_string),
        weekday,
        start.to_string(),
        end.to_string(),
        slot.get("maxGroups").and_then(Value::as_i64).unwrap_or(0) as i32,
        slot.get("maxPlayers").and_then(Value::as_i64).unwrap_or(0) as i32,
    ))
}

pub(crate) fn replace_slots(
    config: &Value,
    service_id: &ReservationServiceId,
    slots: &[ProductSlot],
) -> Value {
    let mut products = as_products(config);
    let Some(index) = products
        .iter()
        .position(|product| service_id_of(product) == Some(service_id.as_str()))
    else {
        return config.clone();
    };

    let encoded: Vec<Value> = slots
        .iter()
        .map(|slot| {
            json!({
                "repeatsWeekly": true,
                "weekdays": [slot.weekday()],
                "startTime": slot.start_time(),
                "endTime": slot.end_time(),
                "maxGroups": slot.max_groups(),
                "maxPlayers": slot.max_players(),
            })
        })
        .collect();

    if let Some(object) = products[index].as_object_mut() {
        object.insert("slots".into(), Value::Array(encoded));
        // Slot-mode products are the only ones the storefront materializes per
        // date; a plan with slots that says "time" would never be offered.
        object.insert("bookingMode".into(), json!("slot"));
    }
    with_products(config, products)
}

fn find_product<'a>(config: &'a Value, service_id: &ReservationServiceId) -> Option<&'a Value> {
    config
        .get(PRODUCTS_KEY)
        .and_then(Value::as_array)?
        .iter()
        .find(|product| service_id_of(product) == Some(service_id.as_str()))
}

fn with_products(config: &Value, products: Vec<Value>) -> Value {
    let mut object = config.as_object().cloned().unwrap_or_else(Map::new);
    object.insert(PRODUCTS_KEY.into(), Value::Array(products));
    Value::Object(object)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(products: Value) -> Value {
        json!({ "defaultHoles": 18, PRODUCTS_KEY: products })
    }

    fn upsert_input(service_id: &str, name: Option<&str>) -> UpsertReservationProduct {
        UpsertReservationProduct::try_new(service_id, name.map(str::to_string), "caddie", 18, 240)
            .expect("valid input")
    }

    #[test]
    fn reads_golf_meaning_off_a_generic_product() {
        let config = config_with(json!([{
            "id": "svc:caddie-18",
            "name": "キャディ付き18ホール",
            "playType": "caddie",
            "holeCount": 18,
            "durationMinutes": 270,
        }]));
        let products = read_products(&config);
        assert_eq!(products.len(), 1);
        assert_eq!(products[0].display_name(), Some("キャディ付き18ホール"));
        assert_eq!(products[0].play_type(), PlayType::Caddie);
        assert_eq!(products[0].hole_count().get(), 18);
    }

    #[test]
    fn a_product_written_by_another_surface_keeps_its_keys() {
        // Field's storefront and the admin UI write into the same array; an
        // edit here must not drop what they put there.
        let config = config_with(json!([{
            "id": "svc:caddie-18",
            "priceAmount": 18000,
            "formFields": ["partySize"],
            "depositRatio": 0.3,
        }]));
        let next = upsert_product(&config, &upsert_input("svc:caddie-18", Some("新しい名前")));
        let product = &next[PRODUCTS_KEY][0];
        assert_eq!(product["priceAmount"], 18000);
        assert_eq!(product["formFields"][0], "partySize");
        assert_eq!(product["depositRatio"], 0.3);
        assert_eq!(product["name"], "新しい名前");
    }

    #[test]
    fn upsert_leaves_other_products_and_config_keys_alone() {
        let config = config_with(json!([{ "id": "svc:self-18", "name": "セルフ" }]));
        let next = upsert_product(&config, &upsert_input("svc:caddie-18", Some("キャディ")));
        assert_eq!(next["defaultHoles"], 18);
        let products = next[PRODUCTS_KEY].as_array().expect("array");
        assert_eq!(products.len(), 2);
        assert_eq!(products[0]["name"], "セルフ");
    }

    #[test]
    fn slots_round_trip_through_the_generic_shape() {
        let config = config_with(json!([{ "id": "svc:caddie-18" }]));
        let service_id = ReservationServiceId::new("svc:caddie-18");
        let slots = vec![ProductSlot::reconstitute(
            None,
            1,
            "07:00".to_string(),
            "15:00".to_string(),
            6,
            24,
        )
        .expect("slot")];
        let next = replace_slots(&config, &service_id, &slots);

        // Stored as the generic weekly-repeating slot the storefront understands.
        let stored = &next[PRODUCTS_KEY][0]["slots"][0];
        assert_eq!(stored["repeatsWeekly"], true);
        assert_eq!(stored["weekdays"][0], 1);
        assert_eq!(next[PRODUCTS_KEY][0]["bookingMode"], "slot");

        let read_back = read_slots(&next, &service_id).expect("read slots");
        assert_eq!(read_back.len(), 1);
        assert_eq!(read_back[0].weekday(), 1);
        assert_eq!(read_back[0].start_time(), "07:00");
        assert_eq!(read_back[0].max_groups(), 6);
    }

    #[test]
    fn slots_for_an_unknown_product_are_empty_rather_than_an_error() {
        let config = config_with(json!([]));
        let slots = read_slots(&config, &ReservationServiceId::new("svc:missing")).expect("ok");
        assert!(slots.is_empty());
    }
}
