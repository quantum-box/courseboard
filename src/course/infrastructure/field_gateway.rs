//! Field API gateways for course-api.
//!
//! All Field URL paths and DTO decoding stay in this module. Domain models leave
//! here already reconstituted (no Field JSON bags).
//!
//! Caddie mapping: gateway owns Field staff → CourseBoard Caddie translation.

use std::{collections::HashMap, time::Duration};

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::header::AUTHORIZATION;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::config::EMPTY_COURSE_STORE_URL;
use crate::course::domain::{
    field_day_of_week_to_courseboard, AvailabilityRule, Caddie, CaddieAssignment, CaddieRank,
    CaddieSkillLevel, CaddieUpstreamIdentity, Course, CourseError, CourseId, CourseOrder,
    GatewayCredentials, GenerationSummary, GolfCatalogGateway, NewReservation, PartyDetails,
    ProductSlot, Reservation, ReservationGateway, ReservationId, ReservationProduct,
    ReservationScheduleGateway, ReservationServiceId, Resource, ResourceId, ResourceKind,
    ResourceTimeSlot, SaveCourseResource, SeededReservation, UpsertCourse,
    UpsertReservationProduct, SEED_KEY_FIELD,
};
use crate::course::infrastructure::course_order_config;
use crate::course::infrastructure::generic_product_config;
use crate::course::infrastructure::party_custom_fields;
use crate::field_api::DEFAULT_FIELD_API_URL;

const GOLF_EXTENSION_KEY: &str = "golf_course";
const RESERVATION_LIST_LIMIT: u32 = 2000;
const FIELD_UPSTREAM_TIMEOUT: Duration = Duration::from_secs(15);
/// How many times a config write re-merges after losing to a concurrent writer.
///
/// Three: enough to ride out one collision and the retry of the writer that
/// caused it, few enough that two screens saving in a loop fail loudly rather
/// than hammering Field.
const CONFIG_WRITE_ATTEMPTS: usize = 3;

fn is_empty_course_store(base_url: &str) -> bool {
    base_url.trim().eq_ignore_ascii_case(EMPTY_COURSE_STORE_URL)
        || base_url.trim().starts_with("empty://")
}

fn empty_course_store_error() -> CourseError {
    CourseError::Provider(
        "Empty course store opt-out is active (TACHYON_FIELD_API_URL=empty://…). \
         List GETs return empty items; writes require a real Field URL."
            .into(),
    )
}

/// Lists generic ERP reservations from Field.
pub struct FieldReservationGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldReservationGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl ReservationGateway for FieldReservationGateway {
    async fn list_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Reservation>, CourseError> {
        let path = format!("/v1/erp/reservations?limit={RESERVATION_LIST_LIMIT}");
        let items: Vec<FieldReservationDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items.into_iter().map(map_reservation).collect())
    }

    async fn update_reservation_party(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        party: &PartyDetails,
    ) -> Result<PartyDetails, CourseError> {
        // Field's PATCH replaces `customFields` wholesale, so the current object
        // has to be read first: `golfCourseId` lives in it, and sending only the
        // group detail would move the booking off its course.
        let path = format!(
            "/v1/erp/reservations/{}",
            urlencoding_path(reservation_id.as_str())
        );
        let current: FieldReservationDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        let merged = party_custom_fields::merge_party(current.custom_fields_json.as_ref(), party);
        let updated: FieldReservationDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&json!({ "customFields": merged })),
        )
        .await?;
        // Field answers with what it stored. If the group detail is not in it,
        // the save did not happen however green the response was, and telling
        // the operator otherwise loses names they typed.
        let stored = party_custom_fields::read_party(updated.custom_fields_json.as_ref());
        if &stored != party {
            return Err(CourseError::Provider(
                "the group detail was not stored as sent; the reservation was left unchanged"
                    .into(),
            ));
        }
        Ok(stored)
    }

    async fn list_reservation_type_ids(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<String>, CourseError> {
        let items: Vec<FieldReservationTypeDto> = field_get_items(
            &self.client,
            &self.base_url,
            "/v1/erp/reservation-types",
            credentials,
        )
        .await?;
        Ok(items.into_iter().map(|item| item.id).collect())
    }

    async fn list_seeded_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<SeededReservation>, CourseError> {
        let path = format!("/v1/erp/reservations?limit={RESERVATION_LIST_LIMIT}");
        let items: Vec<FieldReservationDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items
            .into_iter()
            .filter_map(|item| {
                let seed_key =
                    json_string_field(item.custom_fields_json.as_ref(), &[SEED_KEY_FIELD])?;
                Some(SeededReservation {
                    id: ReservationId::new(item.id),
                    seed_key,
                })
            })
            .collect())
    }

    async fn create_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &NewReservation,
    ) -> Result<ReservationId, CourseError> {
        let created: FieldCreatedReservationDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/reservations",
            credentials,
            Some(&new_reservation_body(input, true)),
        )
        .await?;
        Ok(ReservationId::new(created.into_reservation().id))
    }

    async fn cancel_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        reason: Option<&str>,
    ) -> Result<(), CourseError> {
        let path = format!(
            "/v1/erp/reservations/{}/cancel",
            urlencoding_path(reservation_id.as_str())
        );
        // Field's cancel takes no body today. The reason is sent anyway so the
        // desk's words land the moment Field can keep them (PLT-3297); an
        // endpoint that ignores unknown fields drops it, which is the same
        // outcome as not sending it.
        let body = reason
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| json!({ "reason": value }));
        // Status only, no decode: a cancel that answers 204 has done the work,
        // and failing to parse an empty body would report the booking as still
        // live and invite the desk to cancel it a second time.
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            body.as_ref(),
        )
        .await
    }

    async fn replace_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        input: &NewReservation,
    ) -> Result<(), CourseError> {
        let path = format!(
            "/v1/erp/reservations/{}",
            urlencoding_path(reservation_id.as_str())
        );
        // The seed owns every custom field on a booking it wrote, so this one
        // replaces rather than merges — unlike the operator-facing party write,
        // which has to preserve whatever else is in there.
        field_send_json::<FieldReservationDto>(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&new_reservation_body(input, false)),
        )
        .await?;
        Ok(())
    }
}

/// The body Field takes for a seeded booking.
///
/// `reservationTypeId` only on create: Field's update request has no such field,
/// and sending one would be rejected as unknown.
fn new_reservation_body(input: &NewReservation, creating: bool) -> Value {
    let mut custom_fields = party_custom_fields::merge_party(None, &input.party);
    if let Some(object) = custom_fields.as_object_mut() {
        object.insert("golfCourseId".into(), json!(input.golf_course_id.as_str()));
        if let Some(seed_key) = input.seed_key.as_deref() {
            object.insert(SEED_KEY_FIELD.into(), json!(seed_key));
        }
    }
    let mut body = json!({
        "startsAt": input.starts_at,
        "endsAt": input.ends_at,
        "quantity": input.quantity,
        "customerName": input.customer_name,
        "customFields": custom_fields,
    });
    if let Some(service_id) = input.reservation_service_id.as_deref() {
        body["serviceId"] = json!(service_id);
    }
    if creating {
        body["reservationTypeId"] = json!(input.reservation_type_id);
    }
    body
}

/// Field's reservation create answers `{"reservation": {...}}` while its list
/// and patch answer the booking itself. Only the create is wrapped, so this
/// unwrapping stays here rather than spreading over every reservation read.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FieldCreatedReservationDto {
    Wrapped { reservation: FieldReservationDto },
    Flat(FieldReservationDto),
}

impl FieldCreatedReservationDto {
    fn into_reservation(self) -> FieldReservationDto {
        match self {
            Self::Wrapped { reservation } => reservation,
            Self::Flat(reservation) => reservation,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldReservationTypeDto {
    id: String,
}

/// Loads / mutates golf catalog through Field golf-course extension endpoints.
///
/// Does **not** call a Field `/tee-sheet` product API.
pub struct FieldGolfCatalogGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldGolfCatalogGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }

    /// Plans live in the extension's generic config, not in a golf-specific
    /// table. Field owns the container; the golf meaning is applied in
    /// `generic_product_config`.
    async fn read_config(&self, credentials: GatewayCredentials<'_>) -> Result<Value, CourseError> {
        let items: Vec<FieldExtensionConfigDto> = field_get_items(
            &self.client,
            &self.base_url,
            "/v1/erp/extensions/status",
            credentials,
        )
        .await?;
        Ok(items
            .into_iter()
            .find(|item| item.extension_key == GOLF_EXTENSION_KEY)
            .and_then(|item| item.config_json)
            .unwrap_or_else(|| json!({})))
    }

    async fn write_config(
        &self,
        credentials: GatewayCredentials<'_>,
        config: &Value,
    ) -> Result<(), CourseError> {
        let body = json!({ "scopeType": "tenant", "configJson": config });
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            "/v1/erp/extensions/golf_course/config",
            credentials,
            Some(&body),
        )
        .await
    }

    /// Change one key of the extension config, and make sure the change stuck.
    ///
    /// Field replaces `configJson` wholesale and offers no version to compare
    /// against, so two writers that read the same starting value lose one of the
    /// two changes — and the loser is told the save worked. That is not a
    /// theoretical race here: plans and the ledger's column order live in the
    /// same object, and are edited from different screens.
    ///
    /// Without a compare-and-set the fix is to stay in the operation: write,
    /// read back, and if the key is not what we wrote, merge again onto whatever
    /// won and write again. It converges as long as writes are not continuous,
    /// which turns a silently lost edit into one that is either applied or
    /// reported.
    async fn write_config_key(
        &self,
        credentials: GatewayCredentials<'_>,
        key: &str,
        apply: impl Fn(&Value) -> Value,
    ) -> Result<Value, CourseError> {
        for attempt in 1..=CONFIG_WRITE_ATTEMPTS {
            let current = self.read_config(credentials).await?;
            let next = apply(&current);
            self.write_config(credentials, &next).await?;

            let stored = self.read_config(credentials).await?;
            // Only our own key is compared. Another writer adding a key of its
            // own is not a conflict, and retrying on it would never settle.
            if stored.get(key) == next.get(key) {
                return Ok(stored);
            }
            tracing::warn!(
                key,
                attempt,
                "extension config write was overwritten by a concurrent writer; retrying"
            );
        }
        Err(CourseError::Provider(format!(
            "the extension config kept being overwritten while saving `{key}`; \
             nothing was changed on the last attempt"
        )))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldExtensionConfigDto {
    extension_key: String,
    #[serde(default)]
    config_json: Option<Value>,
}

#[async_trait]
impl GolfCatalogGateway for FieldGolfCatalogGateway {
    async fn list_courses(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Course>, CourseError> {
        let items: Vec<FieldGolfCourseDto> = field_get_items(
            &self.client,
            &self.base_url,
            "/v1/erp/extensions/golf-course/courses",
            credentials,
        )
        .await?;
        Ok(items.into_iter().map(map_course).collect())
    }

    async fn create_course(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCourse,
    ) -> Result<Course, CourseError> {
        let body = upsert_course_body(&input);
        let dto: FieldGolfCourseDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/extensions/golf-course/courses",
            credentials,
            Some(&body),
        )
        .await?;
        Ok(map_course(dto))
    }

    async fn update_course(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        input: UpsertCourse,
    ) -> Result<Course, CourseError> {
        let body = upsert_course_body(&input);
        let path = format!(
            "/v1/erp/extensions/golf-course/courses/{}",
            urlencoding_path(course_id)
        );
        let dto: FieldGolfCourseDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        Ok(map_course(dto))
    }

    async fn delete_course(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
    ) -> Result<(), CourseError> {
        let path = format!(
            "/v1/erp/extensions/golf-course/courses/{}",
            urlencoding_path(course_id)
        );
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::DELETE,
            &path,
            credentials,
            None,
        )
        .await
    }

    async fn list_resources(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Resource>, CourseError> {
        let items: Vec<FieldGolfCourseResourceDto> = field_get_items(
            &self.client,
            &self.base_url,
            "/v1/erp/extensions/golf-course/resources",
            credentials,
        )
        .await?;
        Ok(items.into_iter().map(map_resource).collect())
    }

    async fn create_reservation_resource(
        &self,
        credentials: GatewayCredentials<'_>,
        name: &str,
    ) -> Result<ResourceId, CourseError> {
        // `golf_course_holes` is the resource model the golf extension's
        // reservation type declares; the generic module keys its schedule and
        // inventory off the resource, not off the model.
        let body = json!({
            "name": name,
            "resourceType": "other",
            "resourceModel": "golf_course_holes",
            "active": true,
        });
        let dto: FieldReservationResourceDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/reservation-resources",
            credentials,
            Some(&body),
        )
        .await?;
        Ok(ResourceId::new(dto.id))
    }

    async fn save_course_resource(
        &self,
        credentials: GatewayCredentials<'_>,
        input: SaveCourseResource,
    ) -> Result<Resource, CourseError> {
        let body = json!({
            "resourceCode": input.resource_code,
            "name": input.name,
            "resourceKind": "course",
            "golfCourseId": input.golf_course_id.as_str(),
            "reservationResourceId": input.reservation_resource_id.as_str(),
            "capacity": 1,
            "active": true,
        });
        // Field upserts on (tenant, resourceCode), so POST is how a mapping is
        // both created and corrected.
        let dto: FieldGolfCourseResourceDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/extensions/golf-course/resources",
            credentials,
            Some(&body),
        )
        .await?;
        Ok(map_resource(dto))
    }

    async fn get_course_order(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CourseOrder, CourseError> {
        Ok(course_order_config::read_course_order(
            &self.read_config(credentials).await?,
        ))
    }

    async fn replace_course_order(
        &self,
        credentials: GatewayCredentials<'_>,
        order: &CourseOrder,
    ) -> Result<CourseOrder, CourseError> {
        // Read-modify-write: the extension config is shared with the generic
        // reservation products the storefront reads, and sending only the order
        // would take the plans with it.
        let stored = self
            .write_config_key(
                credentials,
                course_order_config::COURSE_ORDER_KEY,
                |config| course_order_config::with_course_order(config, order),
            )
            .await?;
        Ok(course_order_config::read_course_order(&stored))
    }

    async fn list_reservation_products(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<ReservationProduct>, CourseError> {
        Ok(generic_product_config::read_products(
            &self.read_config(credentials).await?,
        ))
    }

    async fn upsert_reservation_product(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertReservationProduct,
    ) -> Result<ReservationProduct, CourseError> {
        // Same shared object as the column order, so the same write-and-verify:
        // arranging the board must not silently drop a plan saved at the same
        // moment, or the other way round.
        let stored = self
            .write_config_key(
                credentials,
                generic_product_config::PRODUCTS_KEY,
                |config| generic_product_config::upsert_product(config, &input),
            )
            .await?;
        generic_product_config::read_products(&stored)
            .into_iter()
            .find(|product| product.reservation_service_id() == &input.reservation_service_id)
            .ok_or(CourseError::Provider(
                "the saved plan was not returned by the extension config".into(),
            ))
    }

    async fn list_product_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &ReservationServiceId,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        generic_product_config::read_slots(&self.read_config(credentials).await?, service_id)
    }

    async fn replace_product_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &ReservationServiceId,
        slots: Vec<ProductSlot>,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        let config = self.read_config(credentials).await?;
        let next = generic_product_config::replace_slots(&config, service_id, &slots);
        self.write_config(credentials, &next).await?;
        generic_product_config::read_slots(&next, service_id)
    }
}

/// Field keeps the schedule and its inventory on the generic reservation
/// module, addressed by resource. Golf reaches them through the resource its
/// course is mapped to; the golf-course extension has no schedule of its own.
#[async_trait]
impl ReservationScheduleGateway for FieldGolfCatalogGateway {
    async fn get_resource_schedule(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
    ) -> Result<Vec<AvailabilityRule>, CourseError> {
        if is_empty_course_store(&self.base_url) {
            return Ok(Vec::new());
        }
        let response: FieldResourceScheduleDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &format!(
                "/v1/erp/reservation-resources/{}/schedule",
                urlencoding_path(resource_id.as_str())
            ),
            credentials,
            None,
        )
        .await?;
        response.rules.iter().map(rule_to_domain).collect()
    }

    async fn replace_resource_schedule(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        timezone: &str,
        rules: &[AvailabilityRule],
    ) -> Result<Vec<AvailabilityRule>, CourseError> {
        let body = json!({
            "rules": rules
                .iter()
                .map(|rule| rule_to_field(rule, timezone))
                .collect::<Vec<_>>(),
        });
        let response: FieldResourceScheduleDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PUT,
            &format!(
                "/v1/erp/reservation-resources/{}/schedule",
                urlencoding_path(resource_id.as_str())
            ),
            credentials,
            Some(&body),
        )
        .await?;
        response.rules.iter().map(rule_to_domain).collect()
    }

    async fn generate_resource_time_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        from: NaiveDate,
        to: NaiveDate,
        dry_run: bool,
    ) -> Result<GenerationSummary, CourseError> {
        let body = json!({
            "from": from.to_string(),
            "to": to.to_string(),
            "dryRun": dry_run,
        });
        let response: FieldGenerationResponseDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!(
                "/v1/erp/reservation-resources/{}/time-slots/generate",
                urlencoding_path(resource_id.as_str())
            ),
            credentials,
            Some(&body),
        )
        .await?;
        let result = response.into_result();
        Ok(GenerationSummary {
            created: result.created,
            updated: result.updated,
            deactivated: result.deactivated,
            unchanged: result.unchanged,
        })
    }

    async fn list_resource_time_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<ResourceTimeSlot>, CourseError> {
        // A list GET against the opt-out store answers "nothing generated", the
        // same as `field_get_items` does; erroring here would take down the whole
        // ledger instead of falling back to a derived grid.
        if is_empty_course_store(&self.base_url) {
            let _ = (resource_id, from, to, credentials);
            return Ok(Vec::new());
        }
        // Retired rows are asked for on purpose. A slot Field deactivated still
        // has to appear on the ledger — struck through rather than missing —
        // because a row that silently disappears reads as a row that was never
        // sold.
        let path = format!(
            "/v1/erp/reservation-resources/{}/time-slots?from={}&to={}&includeInactive=true",
            urlencoding_path(resource_id.as_str()),
            urlencoding_path(from.to_rfc3339()),
            urlencoding_path(to.to_rfc3339()),
        );
        let response: FieldResourceTimeSlotListDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(response.slots.into_iter().map(map_time_slot).collect())
    }
}

fn map_time_slot(value: FieldResourceTimeSlotDto) -> ResourceTimeSlot {
    // `availableQuantity` is Field's own arithmetic; recomputing it here would
    // invent a second answer to the same question when the two disagree.
    ResourceTimeSlot::reconstitute(
        value.id,
        value.starts_at,
        value.ends_at,
        value.capacity,
        value.reserved_quantity,
        value.held_quantity,
        value.available_quantity,
        value.active.unwrap_or(true),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldResourceTimeSlotListDto {
    #[serde(default)]
    slots: Vec<FieldResourceTimeSlotDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldResourceTimeSlotDto {
    id: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    #[serde(default)]
    capacity: i32,
    #[serde(default)]
    reserved_quantity: i32,
    #[serde(default)]
    held_quantity: i32,
    #[serde(default)]
    available_quantity: i32,
    #[serde(default)]
    active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldResourceScheduleDto {
    #[serde(default)]
    rules: Vec<FieldAvailabilityRuleDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAvailabilityRuleDto {
    id: Option<String>,
    day_of_week: i8,
    start_time: String,
    end_time: String,
    capacity: i32,
    slot_interval_minutes: i32,
}

/// Field returns the generation counts at the top level; an older shape wrapped
/// them in `result`. Accepting both means a Field that goes back to the wrapper
/// does not take the "make tee times" button down again — the counts are all
/// this side reads either way.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FieldGenerationResponseDto {
    Wrapped { result: FieldGenerationResultDto },
    Flat(FieldGenerationResultDto),
}

impl FieldGenerationResponseDto {
    fn into_result(self) -> FieldGenerationResultDto {
        match self {
            Self::Wrapped { result } => result,
            Self::Flat(result) => result,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldGenerationResultDto {
    created: i64,
    updated: i64,
    deactivated: i64,
    unchanged: i64,
}

fn rule_to_domain(rule: &FieldAvailabilityRuleDto) -> Result<AvailabilityRule, CourseError> {
    AvailabilityRule::try_new(
        rule.id.clone(),
        field_day_of_week_to_courseboard(rule.day_of_week),
        rule.start_time.clone(),
        rule.end_time.clone(),
        rule.capacity,
        rule.slot_interval_minutes,
    )
}

/// The request rejects unknown fields, so every key here has to be one Field
/// declares — and `dayOfWeek` has to be rotated on the way out.
fn rule_to_field(rule: &AvailabilityRule, timezone: &str) -> Value {
    let mut body = json!({
        "timezone": timezone,
        "dayOfWeek": rule.field_day_of_week(),
        "startTime": rule.start_time(),
        "endTime": rule.end_time(),
        "capacity": rule.capacity(),
        "slotIntervalMinutes": rule.slot_interval_minutes(),
    });
    if let (Some(object), Some(id)) = (body.as_object_mut(), rule.id()) {
        object.insert("id".into(), json!(id));
    }
    body
}

pub(crate) fn normalize_base_url(field_api_url: Option<&str>) -> String {
    field_api_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_FIELD_API_URL)
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn urlencoding_path(value: impl AsRef<str>) -> String {
    let value = value.as_ref();
    // Path segments only need percent-encoding for reserved characters.
    value
        .chars()
        .map(|ch| match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | ':' => ch.to_string(),
            _ => format!("%{:02X}", ch as u8),
        })
        .collect()
}

fn upsert_course_body(input: &UpsertCourse) -> Value {
    let mut body = json!({
        "name": input.name,
        "shortName": input.short_name,
        "holeCount": input.hole_count.get(),
        "timezone": input.timezone,
        "startIntervalMinutes": input.start_interval_minutes.get(),
        "isActive": input.is_active,
    });
    // Sent only when set: Field replaces the column with whatever arrives, so a
    // save that omitted the hours would clear the ones a course already has.
    if let Some(hours) = &input.business_hours {
        body["businessHoursJson"] = json!({ "open": hours.open(), "close": hours.close() });
    }
    body
}

fn map_reservation(value: FieldReservationDto) -> Reservation {
    let golf_course_id = json_string_field(
        value.custom_fields_json.as_ref(),
        &["golfCourseId", "golf_course_id"],
    );
    let party = party_custom_fields::read_party(value.custom_fields_json.as_ref());
    Reservation::reconstitute(
        value.id,
        value.reservation_number,
        value.service_id,
        value.resource_id,
        value.customer_name,
        value.status,
        value.starts_at,
        value.ends_at,
        value.quantity,
        golf_course_id,
        value.notes,
    )
    .with_party(party)
}

fn map_course(value: FieldGolfCourseDto) -> Course {
    let (open, close) = business_hours(&value.business_hours_json);
    Course::reconstitute(
        value.id,
        value.name,
        value.short_name,
        value.hole_count.unwrap_or(18),
        value.timezone.unwrap_or_else(|| "Asia/Tokyo".into()),
        value.start_interval_minutes.unwrap_or(10),
        value.is_active.unwrap_or(true),
        open,
        close,
        value.created_at,
        value.updated_at,
    )
}

fn map_resource(value: FieldGolfCourseResourceDto) -> Resource {
    // Field carries the course in its own field now. The JSON lookups behind it
    // are the convention that stood in before the column existed, kept so a row
    // an operator set by hand still names its course.
    let golf_course_id = value
        .golf_course_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            json_string_field(
                value.attributes_json.as_ref(),
                &["golfCourseId", "golf_course_id"],
            )
        })
        .or_else(|| {
            json_string_field(
                value.metadata_json.as_ref(),
                &["golfCourseId", "golf_course_id"],
            )
        });
    let kind = value
        .resource_kind
        .as_deref()
        .map(ResourceKind::parse)
        .unwrap_or(ResourceKind::Other);
    Resource::reconstitute(
        value.id,
        value.name,
        value.reservation_resource_id,
        golf_course_id,
        kind,
        value.active.unwrap_or(true),
    )
}

/// Gateway owns Field staff → CourseBoard Caddie translation.
/// When a golf caddie-profile is linked to HRM staff, identity/display_name
/// comes from `staff.name` (not the extension's potentially stale displayName).
pub(crate) fn resolve_caddie_display_name<'a>(
    profile_display_name: &'a str,
    linked_staff_name: Option<&'a str>,
) -> &'a str {
    linked_staff_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(profile_display_name)
}

pub(crate) fn map_caddie(
    value: FieldGolfCaddieProfileDto,
    staff_names_by_id: &HashMap<String, String>,
) -> Caddie {
    let staff_id = value
        .staff_id
        .as_deref()
        .or(value.staff_reference_id.as_deref())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let linked_staff_name = staff_id
        .as_deref()
        .and_then(|id| staff_names_by_id.get(id).map(String::as_str));
    let display_name = resolve_caddie_display_name(&value.display_name, linked_staff_name);
    let upstream = CaddieUpstreamIdentity {
        profile_display_name: Some(value.display_name.clone()),
        staff_id: value.staff_id.clone(),
        staff_reference_type: value.staff_reference_type.clone(),
        staff_reference_id: value.staff_reference_id.clone(),
    };
    Caddie::reconstitute(
        value.id,
        display_name,
        staff_id,
        value.active.unwrap_or(true),
        CaddieSkillLevel::parse(value.skill_level.as_deref().unwrap_or("regular")),
        CaddieRank::parse(value.rank.as_deref().unwrap_or("C")),
        value.employment_status.unwrap_or_else(|| "active".into()),
        value.base_fee_amount.unwrap_or(0),
        value.currency.unwrap_or_else(|| "JPY".into()),
        value.max_rounds_per_day.unwrap_or(1),
        value.can_two_rounds.unwrap_or(false),
        value.monthly_contract_rounds.unwrap_or(0),
        value.desired_income.unwrap_or(0),
        value.rating_average,
        value.rating_count.unwrap_or(0),
    )
    .with_upstream_identity(upstream)
}

pub(crate) fn map_caddie_assignment(
    value: FieldGolfCaddieAssignmentDto,
) -> Result<CaddieAssignment, CourseError> {
    CaddieAssignment::reconstitute(
        value.id,
        value.caddie_profile_id,
        value.reservation_id,
        value.round_reference,
        value.scheduled_at,
        value.duration_minutes,
        value.status,
        value.assignment_role,
        value.fee_amount,
        value.fee_currency,
        value.notes,
    )
}

fn business_hours(value: &Option<Value>) -> (Option<String>, Option<String>) {
    let object = match value.as_ref().and_then(|entry| entry.as_object()) {
        Some(object) => object,
        None => return (None, None),
    };
    let open = object
        .get("open")
        .and_then(|entry| entry.as_str())
        .map(str::to_string);
    let close = object
        .get("close")
        .and_then(|entry| entry.as_str())
        .map(str::to_string);
    (open, close)
}

fn json_string_field(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = value?.as_object()?;
    for key in keys {
        if let Some(raw) = object.get(*key).and_then(|entry| entry.as_str()) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldItems<T> {
    items: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldReservationDto {
    id: String,
    reservation_number: String,
    #[serde(default)]
    service_id: Option<String>,
    #[serde(default)]
    resource_id: Option<String>,
    #[serde(default)]
    customer_name: Option<String>,
    status: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    #[serde(default)]
    quantity: i32,
    #[serde(default)]
    custom_fields_json: Option<Value>,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldGolfCourseDto {
    id: String,
    name: String,
    #[serde(default)]
    short_name: Option<String>,
    #[serde(default)]
    hole_count: Option<i32>,
    #[serde(default)]
    timezone: Option<String>,
    #[serde(default)]
    business_hours_json: Option<Value>,
    #[serde(default)]
    start_interval_minutes: Option<i32>,
    #[serde(default)]
    is_active: Option<bool>,
    #[serde(default)]
    created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
}

/// Only the id is read back: the mapping row is what CourseBoard keeps, and
/// the generic resource's own fields are the reservation module's business.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldReservationResourceDto {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldGolfCourseResourceDto {
    id: String,
    name: String,
    #[serde(default)]
    reservation_resource_id: Option<String>,
    #[serde(default)]
    golf_course_id: Option<String>,
    #[serde(default)]
    resource_kind: Option<String>,
    #[serde(default)]
    active: Option<bool>,
    #[serde(default)]
    attributes_json: Option<Value>,
    #[serde(default)]
    metadata_json: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FieldGolfCaddieProfileDto {
    id: String,
    display_name: String,
    #[serde(default)]
    staff_id: Option<String>,
    #[serde(default)]
    staff_reference_id: Option<String>,
    #[serde(default)]
    staff_reference_type: Option<String>,
    #[serde(default)]
    active: Option<bool>,
    #[serde(default)]
    skill_level: Option<String>,
    #[serde(default)]
    rank: Option<String>,
    #[serde(default)]
    employment_status: Option<String>,
    #[serde(default)]
    base_fee_amount: Option<i64>,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    max_rounds_per_day: Option<i32>,
    #[serde(default)]
    can_two_rounds: Option<bool>,
    #[serde(default)]
    monthly_contract_rounds: Option<i32>,
    #[serde(default)]
    desired_income: Option<i32>,
    #[serde(default)]
    rating_average: Option<f64>,
    #[serde(default)]
    rating_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FieldGolfCaddieAssignmentDto {
    id: String,
    caddie_profile_id: String,
    #[serde(default)]
    reservation_id: Option<String>,
    #[serde(default)]
    round_reference: Option<String>,
    scheduled_at: DateTime<Utc>,
    #[serde(default)]
    duration_minutes: Option<i32>,
    status: String,
    assignment_role: String,
    #[serde(default)]
    fee_amount: i64,
    #[serde(default)]
    fee_currency: String,
    #[serde(default)]
    notes: Option<String>,
}

pub(crate) async fn field_get_items<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    base_url: &str,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
) -> Result<Vec<T>, CourseError> {
    if is_empty_course_store(base_url) {
        let _ = (client, path_and_query, credentials);
        return Ok(Vec::new());
    }
    let body: FieldItems<T> = field_send_json(
        client,
        base_url,
        reqwest::Method::GET,
        path_and_query,
        credentials,
        None,
    )
    .await?;
    Ok(body.items)
}

pub(crate) async fn field_send_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    body: Option<&Value>,
) -> Result<T, CourseError> {
    field_send_json_inner(client, base_url, method, path_and_query, credentials, body).await
}

async fn field_send_json_inner<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    body: Option<&Value>,
) -> Result<T, CourseError> {
    if is_empty_course_store(base_url) {
        return Err(empty_course_store_error());
    }
    let url = format!("{base_url}{path_and_query}");
    let mut request = field_request(client, method.clone(), &url, credentials);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(map_field_request_error)?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(map_field_status_error(status, &message));
    }
    response
        .json()
        .await
        .map_err(|error| map_field_body_error(&method, path_and_query, error))
}

/// Name the call that failed.
///
/// A bare "decode failed" says nothing about which of the dozen Field endpoints
/// a request touched, and the shape mismatches that produce it are found by
/// curling that one endpoint. A body read that times out arrives here too, as a
/// decode error, so it is separated out rather than blamed on the payload.
fn map_field_body_error(
    method: &reqwest::Method,
    path_and_query: &str,
    error: reqwest::Error,
) -> CourseError {
    CourseError::Provider(field_body_error_message(
        method,
        path_and_query,
        error.is_timeout(),
        &error,
    ))
}

fn field_body_error_message(
    method: &reqwest::Method,
    path_and_query: &str,
    timed_out: bool,
    detail: &dyn std::fmt::Display,
) -> String {
    if timed_out {
        return format!(
            "Field API request timed out after {} seconds: {method} {path_and_query}",
            FIELD_UPSTREAM_TIMEOUT.as_secs()
        );
    }
    format!("Field API decode failed for {method} {path_and_query}: {detail}")
}

pub(crate) async fn field_send_unit(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    body: Option<&Value>,
) -> Result<(), CourseError> {
    if is_empty_course_store(base_url) {
        return Err(empty_course_store_error());
    }
    let url = format!("{base_url}{path_and_query}");
    let mut request = field_request(client, method, &url, credentials);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(map_field_request_error)?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(map_field_status_error(status, &message));
    }
    Ok(())
}

pub(crate) async fn field_send_text(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    body: Option<&Value>,
) -> Result<String, CourseError> {
    if is_empty_course_store(base_url) {
        return Err(empty_course_store_error());
    }
    let url = format!("{base_url}{path_and_query}");
    let mut request = field_request(client, method, &url, credentials);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(map_field_request_error)?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_field_status_error(status, &text));
    }
    Ok(text)
}

pub(crate) async fn field_send_raw(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    content_type: &str,
    body: &[u8],
) -> Result<Value, CourseError> {
    if is_empty_course_store(base_url) {
        return Err(empty_course_store_error());
    }
    let url = format!("{base_url}{path_and_query}");
    let response = field_request(client, method.clone(), &url, credentials)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body.to_vec())
        .send()
        .await
        .map_err(map_field_request_error)?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(map_field_status_error(status, &message));
    }
    response
        .json()
        .await
        .map_err(|error| map_field_body_error(&method, path_and_query, error))
}

fn field_request(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    credentials: GatewayCredentials<'_>,
) -> reqwest::RequestBuilder {
    let request = client
        .request(method, url)
        .timeout(FIELD_UPSTREAM_TIMEOUT)
        .header(AUTHORIZATION, credentials.authorization)
        .header("x-operator-id", credentials.operator_id);
    if let Some(platform_id) = credentials.platform_id {
        request.header("x-platform-id", platform_id)
    } else {
        request
    }
}

fn map_field_request_error(error: reqwest::Error) -> CourseError {
    if error.is_timeout() {
        return CourseError::Provider(format!(
            "Field API request timed out after {} seconds",
            FIELD_UPSTREAM_TIMEOUT.as_secs()
        ));
    }
    CourseError::Provider(format!("Field API request failed: {error}"))
}

/// Preserve every sanitized Field 4xx as an operator-correctable response;
/// transport failures and 5xx responses remain provider failures.
pub(crate) fn map_field_status_error(status: reqwest::StatusCode, message: &str) -> CourseError {
    if status.is_client_error() {
        // A Field 401 describes the forwarded bearer/tenant at the provider
        // boundary, not the operator's CourseBoard session. Keep the historical
        // 403 normalization so the browser does not refresh or sign out a valid
        // CourseBoard login. Both statuses still stay below 500, avoiding
        // Cloudflare's CORS-less origin 5xx replacement page.
        let downstream_status = if status == reqwest::StatusCode::UNAUTHORIZED {
            reqwest::StatusCode::FORBIDDEN
        } else {
            status
        };
        return CourseError::UpstreamClient {
            status: downstream_status.as_u16(),
            message: field_error_message(message).unwrap_or_else(|| status.to_string()),
        };
    }
    CourseError::Provider(format!("Field API returned {status}: {message}"))
}

/// Field's public 4xx payload is sanitized at its API boundary. Prefer its
/// operator-facing message over the surrounding JSON/error code, while still
/// supporting plain-text responses from older endpoints.
fn field_error_message(body: &str) -> Option<String> {
    let body = body.trim();
    if body.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
            })
            .map(str::trim)
            .filter(|message| !message.is_empty());
        if let Some(message) = message {
            return Some(message.to_string());
        }
    }
    Some(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_dto(value: Value) -> FieldGolfCaddieProfileDto {
        serde_json::from_value(value).expect("caddie profile dto")
    }

    #[test]
    fn upstream_4xx_keeps_its_status_and_sanitized_message() {
        let denied = map_field_status_error(
            reqwest::StatusCode::FORBIDDEN,
            "{\"code\":\"FORBIDDEN\",\"message\":\"tenant policy check denied\"}",
        );
        assert!(
            matches!(denied, CourseError::UpstreamClient { status: 403, message }
            if message == "tenant policy check denied")
        );

        let unauthorized = map_field_status_error(reqwest::StatusCode::UNAUTHORIZED, "expired");
        assert!(
            matches!(unauthorized, CourseError::UpstreamClient { status: 403, message }
            if message == "expired")
        );

        let conflict = map_field_status_error(
            reqwest::StatusCode::CONFLICT,
            "{\"error\":\"staff_already_linked\",\"message\":\"このスタッフは田中さんに既に紐付いています\"}",
        );
        assert!(
            matches!(conflict, CourseError::UpstreamClient { status: 409, message }
            if message == "このスタッフは田中さんに既に紐付いています")
        );
    }

    #[test]
    fn a_created_booking_is_read_whether_or_not_field_wraps_it() {
        // Field's create answers `{"reservation": {...}}` while its list and
        // patch answer the booking itself. Reading only the wrapper cost the
        // demo seed every booking after the first.
        let booking = json!({
            "id": "rsv_1",
            "reservationNumber": "RSV-1",
            "status": "requested",
            "startsAt": "2026-08-08T00:00:00Z",
            "endsAt": "2026-08-08T04:30:00Z",
        });

        let wrapped: FieldCreatedReservationDto =
            serde_json::from_value(json!({ "reservation": booking })).expect("wrapped create");
        assert_eq!(wrapped.into_reservation().id, "rsv_1");

        let flat: FieldCreatedReservationDto =
            serde_json::from_value(booking).expect("flat create");
        assert_eq!(flat.into_reservation().id, "rsv_1");
    }

    #[test]
    fn generation_counts_are_read_whether_or_not_field_wraps_them() {
        let counts = json!({
            "created": 266,
            "updated": 0,
            "deactivated": 0,
            "unchanged": 0,
        });

        // What Field sends today: the counts beside `resourceId` / `dryRun`,
        // which the DTO has to ignore rather than reject.
        let flat: FieldGenerationResponseDto = serde_json::from_value(json!({
            "resourceId": "rsrc_1",
            "from": "2026-08-08",
            "to": "2026-08-14",
            "dryRun": false,
            "created": 266,
            "updated": 0,
            "deactivated": 0,
            "unchanged": 0,
        }))
        .expect("flat generation response");
        assert_eq!(flat.into_result().created, 266);

        let wrapped: FieldGenerationResponseDto =
            serde_json::from_value(json!({ "result": counts }))
                .expect("wrapped generation response");
        assert_eq!(wrapped.into_result().created, 266);
    }

    #[test]
    fn a_body_that_will_not_decode_names_the_call_that_produced_it() {
        // "decode failed" alone leaves an operator with a 424 and no way to
        // tell which of Field's endpoints changed shape.
        let error = serde_json::from_str::<FieldGenerationResultDto>("{}")
            .expect_err("missing counts must not decode");
        let path = "/v1/erp/reservation-resources/rsrc_1/time-slots/generate";
        let message = field_body_error_message(&reqwest::Method::POST, path, false, &error);
        assert!(message.contains("POST"), "{message}");
        assert!(message.contains(path), "{message}");

        // A body read that runs out of time also surfaces as a decode error;
        // reporting it as a bad payload sends the reader hunting a shape change
        // that never happened.
        let timed_out = field_body_error_message(&reqwest::Method::POST, path, true, &"unused");
        assert!(timed_out.contains("timed out"), "{timed_out}");
        assert!(timed_out.contains(path), "{timed_out}");
    }

    #[test]
    fn upstream_5xx_remains_a_provider_failure() {
        let outage = map_field_status_error(reqwest::StatusCode::BAD_GATEWAY, "upstream down");
        assert!(matches!(outage, CourseError::Provider(message)
            if message.contains("502 Bad Gateway") && message.contains("upstream down")));
    }

    #[test]
    fn field_requests_have_a_bounded_timeout() {
        let client = reqwest::Client::new();
        let request = field_request(
            &client,
            reqwest::Method::GET,
            "https://field.example/v1/erp/staff",
            GatewayCredentials {
                authorization: "Bearer test-token",
                operator_id: "operator-test",
                platform_id: Some("platform-test"),
            },
        )
        .build()
        .expect("build Field request");

        assert_eq!(request.timeout(), Some(&FIELD_UPSTREAM_TIMEOUT));
        assert_eq!(
            request
                .headers()
                .get("x-platform-id")
                .and_then(|value| value.to_str().ok()),
            Some("platform-test")
        );
    }

    #[test]
    fn field_requests_keep_platform_optional_for_legacy_clients() {
        let client = reqwest::Client::new();
        let request = field_request(
            &client,
            reqwest::Method::GET,
            "https://field.example/v1/erp/staff",
            GatewayCredentials {
                authorization: "Bearer test-token",
                operator_id: "operator-test",
                platform_id: None,
            },
        )
        .build()
        .expect("build Field request");

        assert!(!request.headers().contains_key("x-platform-id"));
    }

    #[test]
    fn resolve_caddie_display_name_prefers_linked_staff() {
        assert_eq!(
            resolve_caddie_display_name("佐藤", Some("佐藤 姫花")),
            "佐藤 姫花"
        );
        assert_eq!(resolve_caddie_display_name("佐藤", Some("  ")), "佐藤");
        assert_eq!(resolve_caddie_display_name("佐藤", None), "佐藤");
    }

    #[test]
    fn map_caddie_uses_staff_name_when_linked() {
        let dto = profile_dto(json!({
            "id": "golfcad_01kxmnwdxjhghc7vmg8xf9pfth",
            "displayName": "佐藤",
            "staffId": "staff_himeca",
            "skillLevel": "regular",
            "rank": "C",
            "active": true,
        }));
        let mut staff_names = HashMap::new();
        staff_names.insert("staff_himeca".into(), "佐藤 姫花".into());

        let caddie = map_caddie(dto, &staff_names);
        assert_eq!(caddie.id(), "golfcad_01kxmnwdxjhghc7vmg8xf9pfth");
        assert_eq!(caddie.display_name(), "佐藤 姫花");
        assert_eq!(caddie.staff_id(), Some("staff_himeca"));
    }

    #[test]
    fn map_caddie_falls_back_to_profile_display_name_when_unlinked() {
        let dto = profile_dto(json!({
            "id": "golfcad_unlinked",
            "displayName": "ゲストキャディ",
            "skillLevel": "rookie",
            "rank": "D",
        }));
        let staff_names = HashMap::new();
        let caddie = map_caddie(dto, &staff_names);
        assert_eq!(caddie.display_name(), "ゲストキャディ");
        assert_eq!(caddie.staff_id(), None);
    }

    #[test]
    fn map_caddie_falls_back_when_staff_missing_from_index() {
        let dto = profile_dto(json!({
            "id": "golfcad_stale_link",
            "displayName": "プロファイル名",
            "staffId": "staff_missing",
            "skillLevel": "veteran",
            "rank": "A",
        }));
        let staff_names = HashMap::new();
        let caddie = map_caddie(dto, &staff_names);
        assert_eq!(caddie.display_name(), "プロファイル名");
        assert_eq!(caddie.staff_id(), Some("staff_missing"));
    }

    #[test]
    fn map_caddie_resolves_via_staff_reference_id() {
        let dto = profile_dto(json!({
            "id": "golfcad_ref",
            "displayName": "旧名",
            "staffReferenceId": "staff_ref",
            "skillLevel": "regular",
            "rank": "B",
        }));
        let mut staff_names = HashMap::new();
        staff_names.insert("staff_ref".into(), "参照スタッフ".into());
        let caddie = map_caddie(dto, &staff_names);
        assert_eq!(caddie.display_name(), "参照スタッフ");
        assert_eq!(caddie.staff_id(), Some("staff_ref"));
    }
}
