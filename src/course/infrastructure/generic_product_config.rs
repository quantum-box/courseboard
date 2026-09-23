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
    CourseError, CourseId, PlayType, ProductSlot, ReservationProduct, ReservationServiceId,
    Resource, ResourceId, ResourceKind, UpsertReservationProduct,
};

pub(crate) const PRODUCTS_KEY: &str = "reservationProducts";

/// Golf keys CourseBoard adds to the generic product. Field neither reads nor
/// validates them.
const PLAY_TYPE_KEY: &str = "playType";
const HOLE_COUNT_KEY: &str = "holeCount";
/// Scalar compatibility key written before SCC-3.
const GOLF_COURSE_ID_KEY: &str = "golfCourseId";
/// CourseBoard-owned golf domain scope. Field must not attach golf meaning to
/// this key.
const GOLF_COURSE_IDS_KEY: &str = "golfCourseIds";
/// Field-owned, business-agnostic allow-list introduced by PLT-3353.
const ELIGIBLE_RESOURCE_IDS_KEY: &str = "eligibleResourceIds";
/// Players allowed in one group. Inventory counts groups, so this is a
/// condition of the plan rather than a quantity of stock.
const MAX_PLAYERS_PER_GROUP_KEY: &str = "maxPlayersPerGroup";

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

/// How a product write is encoded while Field and CourseBoard roll out in
/// separate deploys.
#[derive(Debug, Clone, Copy)]
pub(crate) enum ProductWriteMode<'a> {
    /// PLT-3353 is not deployed: do not create either new array key.
    LegacyScalar,
    /// PLT-3353 is live: atomically write both the golf scope and generic
    /// resource eligibility.
    Canonical { resources: &'a [Resource] },
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
    let max_players_per_group = product
        .get(MAX_PLAYERS_PER_GROUP_KEY)
        .and_then(Value::as_i64)
        .map(|value| value as i32);

    match read_course_ids(product) {
        // Presence wins over the scalar even when the array is malformed or
        // empty. The domain remembers that a scope was declared and therefore
        // treats the empty result as "sold nowhere", not unrestricted.
        Some(golf_course_ids) => Some(ReservationProduct::reconstitute_with_course_ids(
            service_id.to_string(),
            None,
            service_id.to_string(),
            display_name,
            play_type,
            hole_count,
            duration,
            golf_course_ids,
            max_players_per_group,
        )),
        None => {
            let golf_course_id = product
                .get(GOLF_COURSE_ID_KEY)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            Some(ReservationProduct::reconstitute(
                service_id.to_string(),
                None,
                service_id.to_string(),
                display_name,
                play_type,
                hole_count,
                duration,
                golf_course_id,
                max_players_per_group,
            ))
        }
    }
}

/// `None` means the canonical key is absent and the scalar compatibility key
/// may be read. `Some(empty)` means it was present but unusable and must fail
/// closed.
fn read_course_ids(product: &Value) -> Option<Vec<String>> {
    let value = product.get(GOLF_COURSE_IDS_KEY)?;
    let Some(values) = value.as_array() else {
        return Some(Vec::new());
    };
    let mut course_ids = Vec::with_capacity(values.len());
    for value in values {
        let Some(course_id) = value.as_str().map(str::trim) else {
            return Some(Vec::new());
        };
        if course_id.is_empty() {
            return Some(Vec::new());
        }
        if !course_ids.iter().any(|known| known == course_id) {
            course_ids.push(course_id.to_string());
        }
    }
    Some(course_ids)
}

/// Whether the stored plan already carries the canonical arrays.
///
/// A plan that has them keeps being written that way even when it is down to a
/// single course, because the resource allow-list beside them has to be
/// rewritten with it.
pub(crate) fn uses_canonical_scope(config: &Value, service_id: &ReservationServiceId) -> bool {
    find_product(config, service_id).is_some_and(|product| read_course_ids(product).is_some())
}

/// Writes the plan into the products array, keeping every key Field or another
/// surface put there. A plan the operator never edited must survive untouched.
pub(crate) fn upsert_product(
    config: &Value,
    input: &UpsertReservationProduct,
    mode: ProductWriteMode<'_>,
) -> Result<Value, CourseError> {
    let service_id = input.reservation_service_id.as_str();
    let mut products = as_products(config);
    let existing = products
        .iter()
        .position(|product| service_id_of(product) == Some(service_id));

    let mut product = existing
        .and_then(|index| products.get(index).cloned())
        .unwrap_or_else(|| json!({ "id": service_id, "enabled": true, "bookingMode": "slot" }));

    // One course on a plan that never carried the canonical arrays keeps the
    // scalar shape Field's legacy path reads. Promoting it would demand a
    // reservation resource for a course that may not have one yet, and a single
    // course expresses the same thing either way — only membership of several
    // courses needs the pair of arrays.
    let canonical_resources = match mode {
        ProductWriteMode::LegacyScalar => None,
        ProductWriteMode::Canonical { resources } => (input.golf_course_ids().len() > 1
            || read_course_ids(&product).is_some())
        .then_some(resources),
    };

    let preserve_existing_canonical_scope = match canonical_resources {
        None => prepare_legacy_scope_write(&product, input)?,
        Some(resources) => {
            refuse_legacy_scalar_shrink(&product, input)?;
            let (course_ids, resource_ids) = resolve_canonical_scope(input, resources)?;
            write_canonical_scope(&mut product, &course_ids, &resource_ids, resources)?;
            false
        }
    };

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
        if canonical_resources.is_none() && !preserve_existing_canonical_scope {
            match input.golf_course_id() {
                Some(course_id) => {
                    object.insert(GOLF_COURSE_ID_KEY.into(), json!(course_id.as_str()));
                }
                // Clearing the legacy course removes the key rather than
                // writing null. Canonical array input can never be empty.
                None => {
                    object.remove(GOLF_COURSE_ID_KEY);
                }
            }
        }
        match input.max_players_per_group {
            Some(players) => {
                object.insert(MAX_PLAYERS_PER_GROUP_KEY.into(), json!(players));
            }
            None => {
                object.remove(MAX_PLAYERS_PER_GROUP_KEY);
            }
        }
        object.entry("enabled").or_insert(json!(true));
        object.entry("bookingMode").or_insert(json!("slot"));
    }

    match existing {
        Some(index) => products[index] = product,
        None => products.push(product),
    }
    Ok(with_products(config, products))
}

/// Checks whether a legacy-shape write can safely edit the product without
/// changing canonical membership. Returns true when the existing array keys
/// must be preserved verbatim.
fn prepare_legacy_scope_write(
    product: &Value,
    input: &UpsertReservationProduct,
) -> Result<bool, CourseError> {
    let Some(existing_course_ids) = read_course_ids(product) else {
        if input.golf_course_ids().len() > 1 {
            return Err(CourseError::BadRequest(
                "selling one plan on several courses is turned off \
                 (COURSEBOARD_MULTI_COURSE_PRODUCT_WRITES)",
            ));
        }
        return Ok(false);
    };

    if input.uses_legacy_course_id_input() && existing_course_ids.len() > 1 {
        return Err(CourseError::BadRequest(
            "a multi-course product cannot be updated with legacy golfCourseId",
        ));
    }
    let requested: Vec<&str> = input
        .golf_course_ids()
        .iter()
        .map(CourseId::as_str)
        .collect();
    if existing_course_ids.is_empty()
        || existing_course_ids
            .iter()
            .map(String::as_str)
            .ne(requested.iter().copied())
    {
        return Err(CourseError::BadRequest(
            "canonical course membership cannot change before PLT-3353 is deployed",
        ));
    }
    Ok(true)
}

fn refuse_legacy_scalar_shrink(
    product: &Value,
    input: &UpsertReservationProduct,
) -> Result<(), CourseError> {
    if input.uses_legacy_course_id_input()
        && read_course_ids(product).is_some_and(|course_ids| course_ids.len() > 1)
    {
        return Err(CourseError::BadRequest(
            "a multi-course product cannot be updated with legacy golfCourseId",
        ));
    }
    Ok(())
}

fn resolve_canonical_scope(
    input: &UpsertReservationProduct,
    resources: &[Resource],
) -> Result<(Vec<String>, Vec<ResourceId>), CourseError> {
    if input.golf_course_ids().is_empty() {
        return Err(CourseError::BadRequest(
            "a canonical product must have at least one course",
        ));
    }
    let mut resource_ids = Vec::with_capacity(input.golf_course_ids().len());
    for course_id in input.golf_course_ids() {
        let mut matches = resources
            .iter()
            .filter(|resource| resource.is_active())
            .filter(|resource| resource.kind() == ResourceKind::Course)
            .filter(|resource| resource.golf_course_id() == Some(course_id));
        let resource = matches.next().ok_or(CourseError::BadRequest(
            "every selected course must have a canonical active reservation resource",
        ))?;
        if matches.next().is_some() {
            return Err(CourseError::BadRequest(
                "a selected course has more than one canonical active reservation resource",
            ));
        }
        let resource_id = resource
            .reservation_resource_id()
            .unwrap_or_else(|| resource.id())
            .clone();
        if resource_ids.contains(&resource_id) {
            return Err(CourseError::BadRequest(
                "selected courses must resolve to distinct reservation resources",
            ));
        }
        resource_ids.push(resource_id);
    }
    Ok((
        input
            .golf_course_ids()
            .iter()
            .map(ToString::to_string)
            .collect(),
        resource_ids,
    ))
}

fn write_canonical_scope(
    product: &mut Value,
    course_ids: &[String],
    resource_ids: &[ResourceId],
    resources: &[Resource],
) -> Result<(), CourseError> {
    let Some(object) = product.as_object_mut() else {
        return Err(CourseError::Provider(
            "the reservation product in extension config is not an object".into(),
        ));
    };
    object.insert(GOLF_COURSE_IDS_KEY.into(), json!(course_ids));
    object.insert(
        ELIGIBLE_RESOURCE_IDS_KEY.into(),
        json!(resource_ids
            .iter()
            .map(ResourceId::as_str)
            .collect::<Vec<_>>()),
    );
    object.remove(GOLF_COURSE_ID_KEY);

    match read_eligible_resource_ids(product, resources) {
        ResourceEligibility::Allowed(stored) if stored == resource_ids => Ok(()),
        _ => Err(CourseError::Provider(
            "the generated resource eligibility did not validate".into(),
        )),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ResourceEligibility {
    Allowed(Vec<ResourceId>),
    Denied,
}

/// Decodes Field's generic allow-list. Every invalid state denies the whole
/// product; accepting the known subset would silently widen or change what is
/// sold.
fn read_eligible_resource_ids(product: &Value, resources: &[Resource]) -> ResourceEligibility {
    let Some(values) = product
        .get(ELIGIBLE_RESOURCE_IDS_KEY)
        .and_then(Value::as_array)
    else {
        return ResourceEligibility::Denied;
    };
    if values.is_empty() {
        return ResourceEligibility::Denied;
    }

    let known: Vec<&ResourceId> = resources
        .iter()
        .filter(|resource| resource.is_active())
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .map(|resource| {
            resource
                .reservation_resource_id()
                .unwrap_or_else(|| resource.id())
        })
        .collect();
    let mut decoded = Vec::with_capacity(values.len());
    for value in values {
        let Some(resource_id) = value.as_str().map(str::trim) else {
            return ResourceEligibility::Denied;
        };
        if resource_id.is_empty() {
            return ResourceEligibility::Denied;
        }
        let resource_id = ResourceId::new(resource_id);
        if !known.contains(&&resource_id) {
            return ResourceEligibility::Denied;
        }
        if !decoded.contains(&resource_id) {
            decoded.push(resource_id);
        }
    }
    ResourceEligibility::Allowed(decoded)
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
        UpsertReservationProduct::try_new(
            service_id,
            name.map(str::to_string),
            "caddie",
            18,
            240,
            None,
            None,
        )
        .expect("valid input")
    }

    fn scoped_input(service_id: &str, course_ids: &[&str]) -> UpsertReservationProduct {
        UpsertReservationProduct::try_new_with_course_ids(
            service_id,
            Some("シーズンパス".to_string()),
            "self",
            18,
            240,
            course_ids.iter().map(|value| value.to_string()).collect(),
            None,
        )
        .expect("valid scoped input")
    }

    fn legacy_upsert(config: &Value, input: &UpsertReservationProduct) -> Value {
        upsert_product(config, input, ProductWriteMode::LegacyScalar).expect("legacy upsert")
    }

    fn resource(course_id: &str, resource_id: &str, active: bool) -> Resource {
        Resource::reconstitute(
            format!("link-{course_id}"),
            course_id,
            Some(resource_id.to_string()),
            Some(course_id.to_string()),
            ResourceKind::Course,
            active,
        )
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
            "availability": { "startDate": "2026-04-01", "endDate": "2026-11-30" },
        }]));
        let next = legacy_upsert(&config, &upsert_input("svc:caddie-18", Some("新しい名前")));
        let product = &next[PRODUCTS_KEY][0];
        assert_eq!(product["priceAmount"], 18000);
        assert_eq!(product["formFields"][0], "partySize");
        assert_eq!(product["depositRatio"], 0.3);
        assert_eq!(
            product["availability"],
            config[PRODUCTS_KEY][0]["availability"]
        );
        assert_eq!(product["name"], "新しい名前");
    }

    #[test]
    fn the_course_a_plan_is_sold_on_round_trips() {
        let config = config_with(json!([{ "id": "svc:caddie-18" }]));
        let input = UpsertReservationProduct::try_new(
            "svc:caddie-18",
            Some("東キャディ付き".to_string()),
            "caddie",
            18,
            240,
            Some("course_east".to_string()),
            None,
        )
        .expect("input");

        let next = legacy_upsert(&config, &input);
        assert_eq!(next[PRODUCTS_KEY][0]["golfCourseId"], "course_east");

        let products = read_products(&next);
        assert_eq!(
            products[0].golf_course_id().map(ToString::to_string),
            Some("course_east".to_string()),
        );
    }

    #[test]
    fn clearing_the_course_removes_the_key_rather_than_writing_null() {
        // A null would read back as a course whose id is the empty string, and
        // the editor would show a plan pinned to a course that does not exist.
        let config = config_with(json!([{
            "id": "svc:caddie-18",
            "golfCourseId": "course_east",
        }]));
        let next = legacy_upsert(&config, &upsert_input("svc:caddie-18", None));

        assert!(next[PRODUCTS_KEY][0].get("golfCourseId").is_none());
        assert_eq!(read_products(&next)[0].golf_course_id(), None);
    }

    #[test]
    fn a_plan_written_before_courses_reads_back_without_one() {
        let config = config_with(json!([{ "id": "svc:caddie-18", "name": "旧プラン" }]));
        assert_eq!(read_products(&config)[0].golf_course_id(), None);
    }

    #[test]
    fn upsert_leaves_other_products_and_config_keys_alone() {
        let config = config_with(json!([{ "id": "svc:self-18", "name": "セルフ" }]));
        let next = legacy_upsert(&config, &upsert_input("svc:caddie-18", Some("キャディ")));
        assert_eq!(next["defaultHoles"], 18);
        let products = next[PRODUCTS_KEY].as_array().expect("array");
        assert_eq!(products.len(), 2);
        assert_eq!(products[0]["name"], "セルフ");
    }

    #[test]
    fn canonical_course_array_takes_precedence_over_the_legacy_scalar() {
        let config = config_with(json!([{
            "id": "season-pass",
            "golfCourseId": "course_legacy",
            "golfCourseIds": [" course_east ", "course_west", "course_east"],
        }]));

        let product = &read_products(&config)[0];
        assert_eq!(
            product
                .golf_course_ids()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["course_east", "course_west"]
        );
        assert!(product.is_sold_on(&CourseId::new("course_west")));
        assert!(!product.is_sold_on(&CourseId::new("course_legacy")));
        assert_eq!(product.golf_course_id(), None);
    }

    #[test]
    fn empty_or_malformed_canonical_course_array_fails_closed() {
        for golf_course_ids in [json!([]), json!("course_east"), json!(["course_east", 7])] {
            let config = config_with(json!([{
                "id": "season-pass",
                "golfCourseId": "course_legacy",
                "golfCourseIds": golf_course_ids,
            }]));
            let product = &read_products(&config)[0];
            assert!(product.golf_course_ids().is_empty());
            assert!(!product.is_sold_on(&CourseId::new("course_legacy")));
            assert!(!product.is_sold_on(&CourseId::new("course_east")));
        }
    }

    #[test]
    fn generic_resource_eligibility_has_five_fail_closed_cases() {
        let resources = vec![
            resource("course_east", "resource_east", true),
            resource("course_west", "resource_west", false),
        ];
        assert_eq!(
            read_eligible_resource_ids(
                &json!({ "eligibleResourceIds": ["resource_east"] }),
                &resources,
            ),
            ResourceEligibility::Allowed(vec![ResourceId::new("resource_east")])
        );
        assert_eq!(
            read_eligible_resource_ids(&json!({ "eligibleResourceIds": [] }), &resources),
            ResourceEligibility::Denied
        );
        assert_eq!(
            read_eligible_resource_ids(&json!({}), &resources),
            ResourceEligibility::Denied
        );
        assert_eq!(
            read_eligible_resource_ids(
                &json!({ "eligibleResourceIds": "resource_east" }),
                &resources,
            ),
            ResourceEligibility::Denied
        );
        assert_eq!(
            read_eligible_resource_ids(
                &json!({ "eligibleResourceIds": ["resource_unknown"] }),
                &resources,
            ),
            ResourceEligibility::Denied
        );
    }

    #[test]
    fn canonical_write_resolves_every_course_and_preserves_availability() {
        let config = config_with(json!([{
            "id": "season-pass",
            "golfCourseId": "course_east",
            "availability": {
                "startDate": "2026-04-01",
                "endDate": "2026-11-30",
                "weekdays": [1, 2, 3, 4, 5]
            },
        }]));
        let resources = vec![
            resource("course_east", "resource_east", true),
            resource("course_west", "resource_west", true),
        ];
        let next = upsert_product(
            &config,
            &scoped_input("season-pass", &["course_east", "course_west"]),
            ProductWriteMode::Canonical {
                resources: &resources,
            },
        )
        .expect("canonical write");
        let product = &next[PRODUCTS_KEY][0];

        assert_eq!(
            product[GOLF_COURSE_IDS_KEY],
            json!(["course_east", "course_west"])
        );
        assert_eq!(
            product[ELIGIBLE_RESOURCE_IDS_KEY],
            json!(["resource_east", "resource_west"])
        );
        assert!(product.get(GOLF_COURSE_ID_KEY).is_none());
        assert_eq!(
            product["availability"],
            config[PRODUCTS_KEY][0]["availability"]
        );
    }

    #[test]
    fn legacy_scalar_cannot_shrink_an_existing_multi_course_product() {
        let config = config_with(json!([{
            "id": "season-pass",
            "golfCourseIds": ["course_east", "course_west"],
            "eligibleResourceIds": ["resource_east", "resource_west"],
        }]));
        let input = UpsertReservationProduct::try_new(
            "season-pass",
            Some("旧画面からの更新".to_string()),
            "self",
            18,
            240,
            Some("course_east".to_string()),
            None,
        )
        .expect("legacy input");

        let result = upsert_product(&config, &input, ProductWriteMode::LegacyScalar);
        assert!(matches!(
            result,
            Err(CourseError::BadRequest(
                "a multi-course product cannot be updated with legacy golfCourseId"
            ))
        ));
        assert_eq!(
            config[PRODUCTS_KEY][0][GOLF_COURSE_IDS_KEY],
            json!(["course_east", "course_west"])
        );
        assert!(config[PRODUCTS_KEY][0].get(GOLF_COURSE_ID_KEY).is_none());
    }

    #[test]
    fn canonical_input_can_edit_an_existing_multi_scope_without_rewriting_it() {
        let config = config_with(json!([{
            "id": "season-pass",
            "name": "保存前",
            "golfCourseIds": ["course_east", "course_west"],
            "eligibleResourceIds": ["resource_east", "resource_west"],
            "availability": { "startDate": "2026-04-01" },
        }]));
        let next = upsert_product(
            &config,
            &scoped_input("season-pass", &["course_east", "course_west"]),
            ProductWriteMode::LegacyScalar,
        )
        .expect("membership-preserving edit");

        assert_eq!(next[PRODUCTS_KEY][0]["name"], "シーズンパス");
        assert_eq!(
            next[PRODUCTS_KEY][0][GOLF_COURSE_IDS_KEY],
            config[PRODUCTS_KEY][0][GOLF_COURSE_IDS_KEY]
        );
        assert_eq!(
            next[PRODUCTS_KEY][0][ELIGIBLE_RESOURCE_IDS_KEY],
            config[PRODUCTS_KEY][0][ELIGIBLE_RESOURCE_IDS_KEY]
        );
        assert_eq!(
            next[PRODUCTS_KEY][0]["availability"],
            config[PRODUCTS_KEY][0]["availability"]
        );
    }

    #[test]
    fn disabled_writer_gate_returns_an_explicit_error_for_a_new_multi_course_write() {
        let config = config_with(json!([]));
        let result = upsert_product(
            &config,
            &scoped_input("season-pass", &["course_east", "course_west"]),
            ProductWriteMode::LegacyScalar,
        );
        assert!(matches!(
            result,
            Err(CourseError::BadRequest(
                "selling one plan on several courses is turned off \
                 (COURSEBOARD_MULTI_COURSE_PRODUCT_WRITES)"
            ))
        ));
        assert!(config[PRODUCTS_KEY]
            .as_array()
            .expect("products")
            .is_empty());
    }

    #[test]
    fn one_course_keeps_the_scalar_shape_even_with_the_writer_open() {
        // A plan on a single course says the same thing in either shape, and
        // the scalar one needs no reservation resource to exist yet — which is
        // what a freshly seeded club, or any course nobody has linked, has.
        let config = config_with(json!([]));
        let next = upsert_product(
            &config,
            &scoped_input("weekday-standard", &["course_east"]),
            ProductWriteMode::Canonical { resources: &[] },
        )
        .expect("save a single-course plan");

        let product = &next[PRODUCTS_KEY][0];
        assert_eq!(product[GOLF_COURSE_ID_KEY], json!("course_east"));
        assert!(product.get(GOLF_COURSE_IDS_KEY).is_none());
        assert!(product.get(ELIGIBLE_RESOURCE_IDS_KEY).is_none());
    }

    #[test]
    fn adding_a_second_course_promotes_the_plan_and_drops_the_scalar() {
        // The scalar can only name one course, so leaving it would hide the
        // plan on the course that was just added.
        let config = config_with(json!([{
            "id": "season-pass",
            "name": "シーズンパス",
            GOLF_COURSE_ID_KEY: "course_east",
        }]));
        let resources = vec![
            resource("course_east", "resource_east", true),
            resource("course_west", "resource_west", true),
        ];

        let next = upsert_product(
            &config,
            &scoped_input("season-pass", &["course_east", "course_west"]),
            ProductWriteMode::Canonical {
                resources: &resources,
            },
        )
        .expect("promote the plan");

        let product = &next[PRODUCTS_KEY][0];
        assert_eq!(
            product[GOLF_COURSE_IDS_KEY],
            json!(["course_east", "course_west"])
        );
        assert_eq!(
            product[ELIGIBLE_RESOURCE_IDS_KEY],
            json!(["resource_east", "resource_west"])
        );
        assert!(product.get(GOLF_COURSE_ID_KEY).is_none());
    }

    #[test]
    fn dropping_back_to_one_course_rewrites_both_arrays() {
        let config = config_with(json!([{
            "id": "season-pass",
            "name": "シーズンパス",
            GOLF_COURSE_IDS_KEY: ["course_east", "course_west"],
            ELIGIBLE_RESOURCE_IDS_KEY: ["resource_east", "resource_west"],
        }]));
        let resources = vec![
            resource("course_east", "resource_east", true),
            resource("course_west", "resource_west", true),
        ];

        let next = upsert_product(
            &config,
            &scoped_input("season-pass", &["course_east"]),
            ProductWriteMode::Canonical {
                resources: &resources,
            },
        )
        .expect("shrink the plan");

        let product = &next[PRODUCTS_KEY][0];
        assert_eq!(product[GOLF_COURSE_IDS_KEY], json!(["course_east"]));
        assert_eq!(product[ELIGIBLE_RESOURCE_IDS_KEY], json!(["resource_east"]));
    }

    #[test]
    fn missing_canonical_resource_rejects_the_whole_product_write() {
        let config = config_with(json!([{
            "id": "season-pass",
            "name": "保存前",
            "availability": { "startDate": "2026-04-01" },
        }]));
        let resources = vec![
            resource("course_east", "resource_east", true),
            resource("course_west", "resource_west", false),
        ];
        let result = upsert_product(
            &config,
            &scoped_input("season-pass", &["course_east", "course_west"]),
            ProductWriteMode::Canonical {
                resources: &resources,
            },
        );

        assert!(matches!(result, Err(CourseError::BadRequest(_))));
        assert_eq!(config[PRODUCTS_KEY][0]["name"], "保存前");
        assert!(config[PRODUCTS_KEY][0].get(GOLF_COURSE_IDS_KEY).is_none());
        assert!(config[PRODUCTS_KEY][0]
            .get(ELIGIBLE_RESOURCE_IDS_KEY)
            .is_none());
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
