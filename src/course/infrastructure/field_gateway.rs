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
use serde_json::{json, Map, Value};

use crate::config::EMPTY_COURSE_STORE_URL;
use crate::course::domain::{
    field_day_of_week_to_courseboard, AvailabilityRule, Caddie, CaddieAssignment, CaddieRank,
    CaddieSkillLevel, CaddieUpstreamIdentity, Course, CourseError, CourseId, CourseOrder,
    CustomerId, GatewayCredentials, GenerationSummary, GolfCatalogGateway, NewReservation,
    PartyDetails, ProductSlot, Reservation, ReservationBilling, ReservationBookingUpdate,
    ReservationGateway, ReservationId, ReservationProduct, ReservationScheduleGateway,
    ReservationServiceId, Resource, ResourceId, ResourceKind, ResourceTimeSlot, SaveCourseResource,
    SeededReservation, UpsertCourse, UpsertReservationProduct, SEED_KEY_FIELD,
};
use crate::course::infrastructure::course_order_config;
use crate::course::infrastructure::generic_product_config;
use crate::course::infrastructure::party_custom_fields;
use crate::field_api::DEFAULT_FIELD_API_URL;

const GOLF_EXTENSION_KEY: &str = "golf_course";
const RESERVATION_LIST_LIMIT: u32 = 2000;
const FIELD_UPSTREAM_TIMEOUT: Duration = Duration::from_secs(15);
/// OCR-backed tabular analysis can take longer than ordinary Field JSON calls.
const TABULAR_ANALYZE_TIMEOUT: Duration = Duration::from_secs(90);
/// How many times a config write re-merges after losing to a concurrent writer.
///
/// Three: enough to ride out one collision and the retry of the writer that
/// caused it, few enough that two screens saving in a loop fail loudly rather
/// than hammering Field.
const CONFIG_WRITE_ATTEMPTS: usize = 3;
/// Default for the SCC-3 writer gate, now that PLT-3353 has landed in Field.
///
/// The deploy order is Field first, so the paired array shape is only safe to
/// write against a Field that reads `eligibleResourceIds`. Shipping it on by
/// default is what makes the feature reachable; the kill switch beside it is
/// what makes an unexpectedly old Field recoverable without a code revert.
pub const DEFAULT_MULTI_COURSE_PRODUCT_WRITES: bool = true;

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

    async fn list_customer_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Reservation>, CourseError> {
        let path = format!(
            "/v1/erp/reservations?customerId={}&limit={limit}&offset={offset}",
            urlencoding_path(customer_id.as_str())
        );
        let items: Vec<FieldReservationDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items.into_iter().map(map_reservation).collect())
    }

    async fn get_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
    ) -> Result<Reservation, CourseError> {
        let path = format!(
            "/v1/erp/reservations/{}",
            urlencoding_path(reservation_id.as_str())
        );
        let dto: FieldReservationDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(map_reservation(dto))
    }

    async fn update_reservation_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        service_id: &ReservationServiceId,
        ends_at: DateTime<Utc>,
    ) -> Result<(), CourseError> {
        let path = format!(
            "/v1/erp/reservations/{}",
            urlencoding_path(reservation_id.as_str())
        );
        // No `customFields` key: this write is not about the group detail, and
        // Field replaces that object wholesale when it is sent. Omitting it
        // leaves what the desk typed where it is.
        let updated: FieldReservationDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&json!({
                "serviceId": service_id.as_str(),
                "endsAt": ends_at,
            })),
        )
        .await?;
        // Field answers with what it stored. A green response that kept the old
        // plan would tell the desk the round is now caddie-served when it is
        // still sold as self-play, and the fee would follow the wrong one.
        if updated.service_id.as_deref() != Some(service_id.as_str()) {
            return Err(CourseError::Provider(
                "the plan was not stored as sent; the reservation was left unchanged".into(),
            ));
        }
        Ok(())
    }

    async fn update_reservation_booking(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        update: &ReservationBookingUpdate,
    ) -> Result<(), CourseError> {
        let path = format!(
            "/v1/erp/reservations/{}",
            urlencoding_path(reservation_id.as_str())
        );
        let body = reservation_booking_body(update);
        let updated: FieldReservationDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        // Field answers with what it stored. A green response that kept the old
        // headcount would leave the desk seating four where three turned up.
        if updated.quantity != update.quantity {
            return Err(CourseError::Provider(
                "the headcount was not stored as sent; the reservation was left unchanged".into(),
            ));
        }
        // Only when the booking carries no ledger entry. Once it does, the name
        // on the reservation is Field's to resolve from that entry, and holding
        // it to what the desk typed would fail a write that in fact went through.
        if update.customer_id.is_none()
            && updated.customer_name.as_deref().map(str::trim) != Some(update.customer_name.trim())
        {
            return Err(CourseError::Provider(
                "the booking name was not stored as sent; the reservation was left unchanged"
                    .into(),
            ));
        }
        Ok(())
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
        // outcome as not sending it. A JSON object is sent either way, though
        // — `{}` when there is no reason, never nothing at all — because
        // Field's endpoint runs the same `Json<_>` extractor that requires
        // `Content-Type: application/json` regardless of whether the body has
        // anything in it, and reqwest only sets that header when `.json(..)`
        // is actually called with something.
        let trimmed_reason = reason.map(str::trim).filter(|value| !value.is_empty());
        let body = match trimmed_reason {
            Some(reason) => json!({ "reason": reason }),
            None => json!({}),
        };
        // Status only, no decode: a cancel that answers 204 has done the work,
        // and failing to parse an empty body would report the booking as still
        // live and invite the desk to cancel it a second time.
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            Some(&body),
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

/// The body Field takes when the desk corrects a booking it already took.
///
/// No `customFields` key, for the same reason the plan write omits one: Field
/// replaces that object wholesale, and it holds both the group detail and the
/// booking's `golfCourseId`. Sending the caller and the headcount on their own
/// leaves all of that where it is.
fn reservation_booking_body(update: &ReservationBookingUpdate) -> Value {
    let mut body = json!({
        "customerName": update.customer_name,
        "quantity": update.quantity,
    });
    // Only when the desk has identified the caller — the same rule the create
    // follows. A null would not clear the link and an empty string would be a
    // lie about who the booking is for.
    if let Some(customer_id) = update.customer_id.as_ref() {
        body["customerId"] = json!(customer_id.as_str());
    }
    body
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
        "timezone": input.timezone,
        "quantity": input.quantity,
        "customerName": input.customer_name,
        "customFields": custom_fields,
    });
    // Only when the desk identified the caller. Field otherwise resolves a
    // customer from the email on the booking, and a desk booking has none —
    // sending a null would not help it and an empty string would be a lie.
    if let Some(customer_id) = input.customer_id.as_ref() {
        body["customerId"] = json!(customer_id.as_str());
    }
    if let Some(service_id) = input.reservation_service_id.as_deref() {
        body["serviceId"] = json!(service_id);
    }
    if let Some(resource_id) = input.reservation_resource_id.as_ref() {
        body["resourceId"] = json!(resource_id.as_str());
    }
    if creating {
        if let Some(prepayment_policy) = input.prepayment_policy.as_deref() {
            body["prepaymentPolicy"] = json!(prepayment_policy);
        }
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
    /// Whether a plan may be stored against more than one course (SCC-3).
    multi_course_product_writes: bool,
    /// CourseBoard's own store for the golf keys of a product (play type,
    /// hole count, group cap, course scope). When attached, reads prefer it
    /// and every save mirrors what the config write stored into it — the
    /// transitional step of splitting golf keys out of the config (ADR-0009).
    product_settings: Option<std::sync::Arc<super::MySqlGolfProductSettingsRepository>>,
}

impl FieldGolfCatalogGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self::with_multi_course_product_writes(
            client,
            field_api_url,
            DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
        )
    }

    pub fn with_multi_course_product_writes(
        client: reqwest::Client,
        field_api_url: Option<&str>,
        multi_course_product_writes: bool,
    ) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
            multi_course_product_writes,
            product_settings: None,
        }
    }

    pub fn with_product_settings(
        mut self,
        product_settings: std::sync::Arc<super::MySqlGolfProductSettingsRepository>,
    ) -> Self {
        self.product_settings = Some(product_settings);
        self
    }

    async fn read_config(&self, credentials: GatewayCredentials<'_>) -> Result<Value, CourseError> {
        read_extension_config(&self.client, &self.base_url, credentials).await
    }

    async fn write_config_key(
        &self,
        credentials: GatewayCredentials<'_>,
        key: &str,
        apply: impl Fn(&Value) -> Result<Value, CourseError>,
    ) -> Result<Value, CourseError> {
        write_extension_config_key(&self.client, &self.base_url, credentials, key, apply).await
    }
}

/// The golf extension's tenant config.
///
/// Plans live in the extension's generic config, not in a golf-specific table.
/// Field owns the container; the golf meaning is applied by the callers —
/// `generic_product_config`, the ledger's column order, the caddie rank fees.
pub(super) async fn read_extension_config(
    client: &reqwest::Client,
    base_url: &str,
    credentials: GatewayCredentials<'_>,
) -> Result<Value, CourseError> {
    let items: Vec<FieldExtensionConfigDto> =
        field_get_items(client, base_url, "/v1/erp/extensions/status", credentials).await?;
    Ok(items
        .into_iter()
        .find(|item| item.extension_key == GOLF_EXTENSION_KEY)
        .and_then(|item| item.config_json)
        .unwrap_or_else(|| json!({})))
}

async fn write_extension_config(
    client: &reqwest::Client,
    base_url: &str,
    credentials: GatewayCredentials<'_>,
    config: &Value,
) -> Result<(), CourseError> {
    let body = json!({ "scopeType": "tenant", "configJson": config });
    field_send_unit(
        client,
        base_url,
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
/// theoretical race here: plans, the ledger's column order, and the caddie rank
/// fees live in the same object, and are edited from different screens.
///
/// Without a compare-and-set the fix is to stay in the operation: write,
/// read back, and if the key is not what we wrote, merge again onto whatever
/// won and write again. It converges as long as writes are not continuous,
/// which turns a silently lost edit into one that is either applied or
/// reported.
pub(super) async fn write_extension_config_key(
    client: &reqwest::Client,
    base_url: &str,
    credentials: GatewayCredentials<'_>,
    key: &str,
    apply: impl Fn(&Value) -> Result<Value, CourseError>,
) -> Result<Value, CourseError> {
    for attempt in 1..=CONFIG_WRITE_ATTEMPTS {
        let current = read_extension_config(client, base_url, credentials).await?;
        // Validation happens before PATCH. In particular, a missing course
        // resource cannot leave only half of the paired product scope in
        // Field's wholesale config object.
        let next = apply(&current)?;
        write_extension_config(client, base_url, credentials, &next).await?;

        let stored = read_extension_config(client, base_url, credentials).await?;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldExtensionConfigDto {
    extension_key: String,
    #[serde(default)]
    config_json: Option<Value>,
}

#[async_trait]
impl GolfCatalogGateway for FieldGolfCatalogGateway {
    async fn get_tenant_timezone(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<String, CourseError> {
        Ok(crate::course::domain::tenant_timezone_from_config(
            &self.read_config(credentials).await?,
        ))
    }

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
        let timezone = self.get_tenant_timezone(credentials).await?;
        let body = upsert_course_body(&input, &timezone);
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
        let timezone = self.get_tenant_timezone(credentials).await?;
        let body = upsert_course_body(&input, &timezone);
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
                |config| Ok(course_order_config::with_course_order(config, order)),
            )
            .await?;
        Ok(course_order_config::read_course_order(&stored))
    }

    async fn list_reservation_products(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<ReservationProduct>, CourseError> {
        let products = generic_product_config::read_products(&self.read_config(credentials).await?);
        let Some(repository) = &self.product_settings else {
            return Ok(products);
        };
        // CourseBoard's own rows are the source of truth for the golf keys; a
        // product without a row (saved before this table existed) falls back
        // to the copies still riding on the config.
        let local = repository.get_all(credentials.operator_id).await?;
        Ok(products
            .into_iter()
            .map(
                |product| match local.get(product.reservation_service_id().as_str()) {
                    Some(settings) => settings.apply_to(&product),
                    None => product,
                },
            )
            .collect())
    }

    async fn upsert_reservation_product(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertReservationProduct,
    ) -> Result<ReservationProduct, CourseError> {
        // Resolve every course before entering the config write: a plan that
        // names a course Field cannot place must fail before anything is
        // stored, not halfway through the pair of arrays.
        //
        // Only membership of several courses needs that resolution. A plan on
        // one course keeps the scalar shape unless it already carries the
        // arrays, and asking Field for resources it would not use turns a save
        // that used to work into a failure on tenants that have none.
        let needs_resources = self.multi_course_product_writes
            && match input.golf_course_ids().len() {
                0 => false,
                1 => generic_product_config::uses_canonical_scope(
                    &self.read_config(credentials).await?,
                    &input.reservation_service_id,
                ),
                _ => true,
            };
        let resources = if needs_resources {
            Some(self.list_resources(credentials).await?)
        } else {
            None
        };
        let write_mode = resources
            .as_deref()
            .map(|resources| generic_product_config::ProductWriteMode::Canonical { resources })
            .unwrap_or(generic_product_config::ProductWriteMode::LegacyScalar);

        // Same shared object as the column order, so the same write-and-verify:
        // arranging the board must not silently drop a plan saved at the same
        // moment, or the other way round.
        let stored = self
            .write_config_key(
                credentials,
                generic_product_config::PRODUCTS_KEY,
                |config| generic_product_config::upsert_product(config, &input, write_mode),
            )
            .await?;
        let product = generic_product_config::read_products(&stored)
            .into_iter()
            .find(|product| product.reservation_service_id() == &input.reservation_service_id)
            .ok_or(CourseError::Provider(
                "the saved plan was not returned by the extension config".into(),
            ))?;
        if let Some(repository) = &self.product_settings {
            // Mirror what the config write actually stored — never the raw
            // input — so the local rows can only ever equal the config copy.
            // A failure here surfaces to the operator; the config is already
            // saved, and retrying the save converges the two stores.
            repository
                .replace(
                    credentials.operator_id,
                    product.reservation_service_id().as_str(),
                    &super::GolfProductSettings::from_product(&product),
                )
                .await?;
        }
        Ok(product)
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
        // Slots live inside the same `reservationProducts` array as the plans,
        // and Field's own slot import rewrites that array too. A bare PATCH
        // here reported success while dropping whichever write landed second,
        // so this takes the same write-and-verify path as the plan editor.
        let stored = self
            .write_config_key(
                credentials,
                generic_product_config::PRODUCTS_KEY,
                |config| {
                    Ok(generic_product_config::replace_slots(
                        config, service_id, &slots,
                    ))
                },
            )
            .await?;
        // Read back from what Field stored rather than from the value we sent:
        // after a retry the two are not the same object.
        generic_product_config::read_slots(&stored, service_id)
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
        let path = format!(
            "/v1/erp/reservation-resources/{}/schedule",
            urlencoding_path(resource_id.as_str())
        );
        // Field's PUT is a full replacement. Read immediately before it so
        // fields introduced by Field but not yet modeled by CourseBoard travel
        // through the save instead of being reset to null/default.
        let current: FieldResourceScheduleDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        let body = schedule_replace_body(&current.rules, rules, timezone);
        let response: FieldResourceScheduleDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PUT,
            &path,
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
    /// Field-owned fields that CourseBoard does not edit.
    ///
    /// Keeping the raw values here is deliberate: schedule PUT replaces the
    /// entire rule, so dropping a newly added mutable field would erase it on
    /// the next unrelated save.
    #[serde(flatten)]
    additional_fields: Map<String, Value>,
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

/// CourseBoard-owned schedule edits, overlaid on a rule read from Field.
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

/// Fields present in Field's schedule response but rejected by its PUT input.
///
/// This is intentionally a deny-list rather than an allow-list. An allow-list
/// recreates SCC-8 whenever Field adds a mutable schedule field that
/// CourseBoard does not know yet.
const FIELD_RULE_RESPONSE_ONLY_FIELDS: [&str; 4] = ["active", "createdAt", "updatedAt", "revision"];

fn schedule_replace_body(
    current: &[FieldAvailabilityRuleDto],
    edited: &[AvailabilityRule],
    timezone: &str,
) -> Value {
    let current_by_id: HashMap<&str, &FieldAvailabilityRuleDto> = current
        .iter()
        .filter_map(|rule| rule.id.as_deref().map(|id| (id, rule)))
        .collect();
    let rules = edited
        .iter()
        .map(|rule| {
            let mut body = rule
                .id()
                .and_then(|id| current_by_id.get(id).copied())
                .map(field_rule_passthrough_fields)
                .unwrap_or_default();
            let edited_fields = rule_to_field(rule, timezone)
                .as_object()
                .expect("rule_to_field always returns an object")
                .clone();
            body.extend(edited_fields);
            Value::Object(body)
        })
        .collect::<Vec<_>>();
    json!({ "rules": rules })
}

fn field_rule_passthrough_fields(rule: &FieldAvailabilityRuleDto) -> Map<String, Value> {
    rule.additional_fields
        .iter()
        .filter(|(key, _)| !FIELD_RULE_RESPONSE_ONLY_FIELDS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
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

fn upsert_course_body(input: &UpsertCourse, tenant_timezone: &str) -> Value {
    let mut body = json!({
        "name": input.name,
        "shortName": input.short_name,
        "holeCount": input.hole_count.get(),
        // Field still requires the legacy column. Mirror the tenant setting so
        // rollback stays possible without restoring a per-course editor.
        "timezone": tenant_timezone,
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
    .with_customer_id(CustomerId::from_optional(value.customer_id))
    .with_billing(ReservationBilling {
        price_amount: value.price_amount,
        deposit_amount: value.deposit_amount,
        paid_amount: value.paid_amount,
        currency: value.currency,
        payment_status: value.payment_status,
        invoice_id: value.invoice_id,
        cancelled_at: value.cancelled_at,
    })
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
    #[serde(default)]
    customer_id: Option<String>,
    status: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    #[serde(default)]
    quantity: i32,
    #[serde(default)]
    custom_fields_json: Option<Value>,
    #[serde(default)]
    notes: Option<String>,
    // Field records the money against the booking; CourseBoard used to drop it
    // on the floor and ask Field to add the day up instead. Reading it here is
    // what lets the takings be worked out on this side (ADR-0005 Phase 1).
    #[serde(default)]
    price_amount: i64,
    #[serde(default)]
    deposit_amount: i64,
    #[serde(default)]
    paid_amount: i64,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    payment_status: Option<String>,
    #[serde(default)]
    invoice_id: Option<String>,
    #[serde(default)]
    cancelled_at: Option<DateTime<Utc>>,
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
    response.json().await.map_err(|error| {
        map_field_body_error_with_timeout(&method, path_and_query, error, FIELD_UPSTREAM_TIMEOUT)
    })
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
    map_field_body_error_with_timeout(method, path_and_query, error, FIELD_UPSTREAM_TIMEOUT)
}

fn map_field_body_error_with_timeout(
    method: &reqwest::Method,
    path_and_query: &str,
    error: reqwest::Error,
    timeout: Duration,
) -> CourseError {
    CourseError::Provider(field_body_error_message_with_timeout(
        method,
        path_and_query,
        error.is_timeout(),
        &error,
        timeout,
    ))
}

#[cfg(test)]
fn field_body_error_message(
    method: &reqwest::Method,
    path_and_query: &str,
    timed_out: bool,
    detail: &dyn std::fmt::Display,
) -> String {
    field_body_error_message_with_timeout(
        method,
        path_and_query,
        timed_out,
        detail,
        FIELD_UPSTREAM_TIMEOUT,
    )
}

fn field_body_error_message_with_timeout(
    method: &reqwest::Method,
    path_and_query: &str,
    timed_out: bool,
    detail: &dyn std::fmt::Display,
    timeout: Duration,
) -> String {
    if timed_out {
        return format!(
            "Field API request timed out after {} seconds: {method} {path_and_query}",
            timeout.as_secs()
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

/// A Field response that was not a success, before it is flattened.
///
/// `map_field_status_error` keeps the status of a 4xx and drops it from a 5xx,
/// and neither keeps Field's `code`. That is enough for a screen that only has
/// to say "the save did not go through", and not enough for one that has to
/// say *why* — which is what the reception desk needs now that Field
/// distinguishes an OCR provider that is down from a document it could not
/// read (PLT-4033).
pub(crate) struct FieldStatusFailure<'a> {
    pub status: reqwest::StatusCode,
    /// Field's own error code, e.g. `PAYMENT_REQUIRED`. Absent on the older
    /// endpoints that answer in plain text.
    pub code: Option<String>,
    /// The response body as it arrived, for the default mapping to sanitize.
    pub body: &'a str,
}

/// Send a multipart request to a Field endpoint while preserving the same
/// forwarded bearer/operator/platform headers used by JSON gateways.
pub(crate) async fn field_send_multipart<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    form: reqwest::multipart::Form,
) -> Result<T, CourseError> {
    field_send_multipart_classified(
        client,
        base_url,
        method,
        path_and_query,
        credentials,
        form,
        |_| None,
    )
    .await
}

/// The same send, with the caller given first refusal on the failure.
///
/// `classify` answers `None` for anything it does not recognise, which falls
/// back to the shared mapping. Recognising selectively is the point: a 400 is
/// a request the gateway built wrong and a 401 is the caller's own bearer, and
/// a gateway that claimed those as its own domain failure would send the
/// operator off to fix something that is not broken.
pub(crate) async fn field_send_multipart_classified<T, F>(
    client: &reqwest::Client,
    base_url: &str,
    method: reqwest::Method,
    path_and_query: &str,
    credentials: GatewayCredentials<'_>,
    form: reqwest::multipart::Form,
    classify: F,
) -> Result<T, CourseError>
where
    T: for<'de> Deserialize<'de>,
    F: FnOnce(&FieldStatusFailure<'_>) -> Option<CourseError>,
{
    if is_empty_course_store(base_url) {
        return Err(empty_course_store_error());
    }
    let url = format!("{base_url}{path_and_query}");
    let response = field_request(client, method.clone(), &url, credentials)
        .timeout(TABULAR_ANALYZE_TIMEOUT)
        .multipart(form)
        .send()
        .await
        .map_err(|error| map_field_request_error_with_timeout(error, TABULAR_ANALYZE_TIMEOUT))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let failure = FieldStatusFailure {
            status,
            code: field_error_code(&body),
            body: &body,
        };
        return Err(
            classify(&failure).unwrap_or_else(|| map_field_status_error(status, failure.body))
        );
    }
    response.json().await.map_err(|error| {
        map_field_body_error_with_timeout(&method, path_and_query, error, TABULAR_ANALYZE_TIMEOUT)
    })
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
    map_field_request_error_with_timeout(error, FIELD_UPSTREAM_TIMEOUT)
}

fn map_field_request_error_with_timeout(error: reqwest::Error, timeout: Duration) -> CourseError {
    if error.is_timeout() {
        return CourseError::Provider(format!(
            "Field API request timed out after {} seconds",
            timeout.as_secs()
        ));
    }
    CourseError::Provider(format!("Field API request failed: {error}"))
}

/// Preserve every sanitized Field 4xx as an operator-correctable response;
/// transport failures and 5xx responses remain provider failures. Authentication
/// and authorization stay distinct: Field 401 remains 401, while a real policy
/// denial remains 403.
pub(crate) fn map_field_status_error(status: reqwest::StatusCode, message: &str) -> CourseError {
    if status.is_client_error() {
        return CourseError::UpstreamClient {
            status: status.as_u16(),
            message: field_error_message(message).unwrap_or_else(|| status.to_string()),
        };
    }
    CourseError::Provider(format!("Field API returned {status}: {message}"))
}

/// Field's machine-readable error code, when the body carries one.
///
/// Read separately from the message because the two answer different
/// questions: the message is prose a screen may show, the code is what a
/// gateway may branch on. Only the code is stable enough to branch on — Field
/// rewords its messages freely, and CourseBoard writes its own operator copy
/// anyway.
pub(crate) fn field_error_code(body: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(body.trim()).ok()?;
    value
        .get("code")
        .or_else(|| value.get("error").and_then(|error| error.get("code")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .map(str::to_string)
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
    use std::sync::{Arc, Mutex};

    use axum::{extract::State, routing::get, Json, Router};

    use super::*;

    /// The takings have to be workable out on this side, which means the
    /// money Field records against a booking must survive the decode. A
    /// booking that carries none of it still decodes — Field omits the keys
    /// for bookings taken before they existed, and a missing amount is zero,
    /// not a failure.
    #[test]
    fn a_bookings_money_survives_the_decode_and_its_absence_is_not_a_failure() {
        let with_money: FieldReservationDto = serde_json::from_value(serde_json::json!({
            "id": "res_1",
            "reservationNumber": "R-1",
            "status": "confirmed",
            "startsAt": "2026-07-18T00:00:00Z",
            "endsAt": "2026-07-18T04:00:00Z",
            "quantity": 4,
            "priceAmount": 48000,
            "depositAmount": 10000,
            "paidAmount": 48000,
            "currency": "JPY",
            "paymentStatus": "paid",
            "invoiceId": "inv_1",
            "cancelledAt": "2026-07-17T09:00:00Z",
        }))
        .expect("decode a booking that carries money");

        let reservation = map_reservation(with_money);
        let billing = reservation.billing();
        assert_eq!(billing.price_amount, 48_000);
        assert_eq!(billing.deposit_amount, 10_000);
        assert_eq!(billing.paid_amount, 48_000);
        assert_eq!(billing.currency.as_deref(), Some("JPY"));
        assert_eq!(billing.payment_status.as_deref(), Some("paid"));
        assert_eq!(billing.invoice_id.as_deref(), Some("inv_1"));
        // Cancelled bookings are kept out of takings even when money was
        // collected: that money settles as a cancellation fee instead.
        assert!(billing.is_cancelled());

        let without_money: FieldReservationDto = serde_json::from_value(serde_json::json!({
            "id": "res_2",
            "reservationNumber": "R-2",
            "status": "confirmed",
            "startsAt": "2026-07-18T00:00:00Z",
            "endsAt": "2026-07-18T04:00:00Z",
            "quantity": 4,
        }))
        .expect("decode a booking with no money recorded");

        let billing = map_reservation(without_money).billing().clone();
        assert_eq!(billing.price_amount, 0);
        assert_eq!(billing.invoice_id, None);
        assert!(!billing.is_cancelled());
    }

    #[derive(Clone, Default)]
    struct ScheduleServerState {
        calls: Arc<Mutex<Vec<&'static str>>>,
        put_body: Arc<Mutex<Option<Value>>>,
    }

    async fn read_schedule(State(state): State<ScheduleServerState>) -> Json<Value> {
        state.calls.lock().expect("calls lock").push("GET");
        Json(json!({
            "resourceId": "resource-1",
            "rules": [{
                "id": "rule-1",
                "timezone": "Asia/Tokyo",
                "dayOfWeek": 0,
                "startTime": "07:00",
                "endTime": "12:00",
                "capacity": 1,
                "slotIntervalMinutes": 8,
                "futureWritePolicy": {
                    "mode": "field-owned",
                    "thresholds": [2, 4]
                },
                "active": true,
                "createdAt": "2026-08-10T00:00:00Z",
                "updatedAt": "2026-08-10T00:00:00Z",
                "revision": 7
            }]
        }))
    }

    async fn write_schedule(
        State(state): State<ScheduleServerState>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        state.calls.lock().expect("calls lock").push("PUT");
        *state.put_body.lock().expect("put body lock") = Some(body.clone());
        Json(body)
    }

    fn desk_reservation() -> NewReservation {
        NewReservation {
            reservation_type_id: "type-1".into(),
            reservation_service_id: Some("service-1".into()),
            reservation_resource_id: Some(ResourceId::new("resource-1")),
            starts_at: "2026-08-11T22:30:00Z".parse().unwrap(),
            ends_at: "2026-08-12T03:00:00Z".parse().unwrap(),
            timezone: "Europe/Berlin".into(),
            quantity: 4,
            customer_name: "山田 太郎".into(),
            customer_id: None,
            golf_course_id: CourseId::new("course-1"),
            party: PartyDetails::try_new(
                None,
                None,
                None,
                vec![crate::course::domain::PartyPlayer::try_new(
                    "増田 公陽",
                    Some("共通".into()),
                    Some("M-01".into()),
                    None,
                )
                .unwrap()],
            )
            .unwrap(),
            prepayment_policy: Some("none".into()),
            seed_key: None,
        }
    }

    #[test]
    fn legacy_course_column_mirrors_the_tenant_timezone() {
        let input = UpsertCourse::try_new("East", Some("E".into()), 18, 8, true, None)
            .expect("course input");

        let body = upsert_course_body(&input, "Europe/Berlin");

        assert_eq!(body["timezone"], "Europe/Berlin");
    }

    #[tokio::test]
    async fn schedule_save_round_trips_a_field_owned_unknown_field() {
        let state = ScheduleServerState::default();
        let app = Router::new()
            .route(
                "/v1/erp/reservation-resources/resource-1/schedule",
                get(read_schedule).put(write_schedule),
            )
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock Field");
        let address = listener.local_addr().expect("mock Field address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve mock Field");
        });

        let gateway = FieldGolfCatalogGateway::new(
            reqwest::Client::new(),
            Some(&format!("http://{address}")),
        );
        let edited = AvailabilityRule::try_new(Some("rule-1".into()), 1, "07:00", "12:00", 2, 8)
            .expect("edited rule");
        let saved = gateway
            .replace_resource_schedule(
                GatewayCredentials {
                    authorization: "Bearer test-token",
                    operator_id: "operator-test",
                    platform_id: Some("platform-test"),
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                &ResourceId::new("resource-1"),
                "Europe/Berlin",
                &[edited],
            )
            .await
            .expect("replace schedule");

        let body = state
            .put_body
            .lock()
            .expect("put body lock")
            .clone()
            .expect("PUT body");
        assert_eq!(*state.calls.lock().expect("calls lock"), vec!["GET", "PUT"]);
        assert_eq!(body["rules"][0]["capacity"], 2);
        assert_eq!(body["rules"][0]["timezone"], "Europe/Berlin");
        assert_eq!(
            body["rules"][0]["futureWritePolicy"],
            json!({ "mode": "field-owned", "thresholds": [2, 4] })
        );
        for response_only in FIELD_RULE_RESPONSE_ONLY_FIELDS {
            assert!(body["rules"][0].get(response_only).is_none());
        }
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].capacity(), 2);

        server.abort();
    }

    #[derive(Clone, Default)]
    struct CancelServerState {
        bodies: Arc<Mutex<Vec<Value>>>,
    }

    async fn cancel_endpoint(
        State(state): State<CancelServerState>,
        Json(body): Json<Value>,
    ) -> axum::http::StatusCode {
        state.bodies.lock().expect("bodies lock").push(body);
        axum::http::StatusCode::NO_CONTENT
    }

    /// Field's cancel endpoint uses the same `Json<_>` extractor as any other
    /// write, which rejects a request that arrives with no
    /// `Content-Type: application/json` — reason or no reason. A cancel with a
    /// blank reason used to skip the body (and the header riding on it)
    /// entirely, so this pins what actually reaches Field for each shape of
    /// reason the desk can type (or not).
    #[tokio::test]
    async fn cancel_reservation_always_sends_a_json_body_to_field() {
        for (reason, expected) in [
            (None, json!({})),
            (Some("   "), json!({})),
            (
                Some("電話でキャンセル"),
                json!({ "reason": "電話でキャンセル" }),
            ),
        ] {
            let state = CancelServerState::default();
            let app = Router::new()
                .route(
                    "/v1/erp/reservations/res_1/cancel",
                    axum::routing::post(cancel_endpoint),
                )
                .with_state(state.clone());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind mock Field");
            let address = listener.local_addr().expect("mock Field address");
            let server = tokio::spawn(async move {
                axum::serve(listener, app).await.expect("serve mock Field");
            });

            let gateway = FieldReservationGateway::new(
                reqwest::Client::new(),
                Some(&format!("http://{address}")),
            );
            gateway
                .cancel_reservation(
                    GatewayCredentials {
                        authorization: "Bearer test-token",
                        operator_id: "operator-test",
                        platform_id: Some("platform-test"),
                        authorizer: &crate::course::infrastructure::ALLOW_ALL,
                        caller_bearer: "Bearer test",
                    },
                    &ReservationId::new("res_1"),
                    reason,
                )
                .await
                .unwrap_or_else(|error| panic!("cancel with reason {reason:?}: {error}"));

            assert_eq!(
                state.bodies.lock().expect("bodies lock").as_slice(),
                [expected],
                "reason {reason:?}",
            );

            server.abort();
        }
    }

    #[test]
    fn a_booking_the_desk_did_not_identify_carries_no_customer_id_at_all() {
        let body = new_reservation_body(&desk_reservation(), true);
        assert!(body.get("customerId").is_none());
    }

    #[test]
    fn identifying_the_caller_puts_them_on_the_booking() {
        let mut input = desk_reservation();
        input.customer_id = Some(CustomerId::new("cus_1"));
        let body = new_reservation_body(&input, true);
        assert_eq!(body["customerId"], json!("cus_1"));
    }

    #[test]
    fn correcting_a_booking_never_sends_the_custom_fields_object() {
        // Field replaces `customFields` wholesale. A booking write that carried
        // one would take the group detail and the booking's own `golfCourseId`
        // down with it — the round would leave the course it is played on.
        let body = reservation_booking_body(&ReservationBookingUpdate {
            customer_name: "増田 公陽".to_string(),
            customer_id: None,
            quantity: 3,
        });
        assert_eq!(body["customerName"], json!("増田 公陽"));
        assert_eq!(body["quantity"], json!(3));
        assert!(body.get("customFields").is_none());
        assert!(body.get("customerId").is_none());
    }

    #[test]
    fn a_corrected_booking_carries_the_ledger_entry_the_desk_picked() {
        let body = reservation_booking_body(&ReservationBookingUpdate {
            customer_name: "増田 公陽".to_string(),
            customer_id: Some(CustomerId::new("cus_1")),
            quantity: 4,
        });
        assert_eq!(body["customerId"], json!("cus_1"));
    }

    fn profile_dto(value: Value) -> FieldGolfCaddieProfileDto {
        serde_json::from_value(value).expect("caddie profile dto")
    }

    #[test]
    fn upstream_authentication_expiry_stays_401() {
        let unauthorized = map_field_status_error(
            reqwest::StatusCode::UNAUTHORIZED,
            "{\"error\":\"unauthorized\",\"message\":\"Field authentication expired\"}",
        );
        assert!(
            matches!(unauthorized, CourseError::UpstreamClient { status: 401, message }
            if message == "Field authentication expired")
        );
    }

    #[test]
    fn upstream_permission_denial_stays_403() {
        let denied = map_field_status_error(
            reqwest::StatusCode::FORBIDDEN,
            "{\"code\":\"FORBIDDEN\",\"message\":\"tenant policy check denied\"}",
        );
        assert!(
            matches!(denied, CourseError::UpstreamClient { status: 403, message }
            if message == "tenant policy check denied")
        );
    }

    #[test]
    fn upstream_conflict_keeps_its_status_and_sanitized_message() {
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
    fn desk_booking_targets_generated_inventory_and_skips_online_prepayment() {
        let body = new_reservation_body(&desk_reservation(), true);

        assert_eq!(body["reservationTypeId"], "type-1");
        assert_eq!(body["serviceId"], "service-1");
        assert_eq!(body["resourceId"], "resource-1");
        assert_eq!(body["prepaymentPolicy"], "none");
        assert_eq!(body["quantity"], 4);
        assert_eq!(
            body["customFields"]["golfParty"]["players"][0]["name"],
            "増田 公陽"
        );
        assert_eq!(
            body["customFields"]["golfParty"]["players"][0]["tag"],
            "共通"
        );
        assert_eq!(
            body["customFields"]["golfParty"]["players"][0]["memberNumber"],
            "M-01"
        );
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
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
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
    fn tabular_analyze_allows_ocr_time() {
        assert_eq!(TABULAR_ANALYZE_TIMEOUT, Duration::from_secs(90));
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
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
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
