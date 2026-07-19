//! Field API gateways for course-api.
//!
//! All Field URL paths and DTO decoding stay in this module. Domain models leave
//! here already reconstituted (no Field JSON bags).
//!
//! Caddie mapping: gateway owns Field staff → CourseBoard Caddie translation.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::header::AUTHORIZATION;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::config::EMPTY_COURSE_STORE_URL;
use crate::course::domain::{
    Caddie, CaddieAssignment, CaddieRank, CaddieSkillLevel, Course, CourseError,
    GatewayCredentials, GolfCatalogGateway, PlayType, ProductSlot, Reservation, ReservationGateway,
    ReservationProduct, Resource, ResourceKind, UpsertCourse, UpsertReservationProduct,
};
use crate::field_api::DEFAULT_FIELD_API_URL;

const RESERVATION_LIST_LIMIT: u32 = 2000;

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
        course_id: &str,
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
        course_id: &str,
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

    async fn list_reservation_products(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<ReservationProduct>, CourseError> {
        let items: Vec<FieldGolfReservationProductDto> = field_get_items(
            &self.client,
            &self.base_url,
            "/v1/erp/extensions/golf-course/reservation-products",
            credentials,
        )
        .await?;
        Ok(items.into_iter().map(map_product).collect())
    }

    async fn upsert_reservation_product(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertReservationProduct,
    ) -> Result<ReservationProduct, CourseError> {
        let body = json!({
            "playType": input.play_type.as_str(),
            "holeCount": input.hole_count.get(),
            "expectedDurationMinutes": input.expected_duration_minutes.get(),
        });
        let path = format!(
            "/v1/erp/extensions/golf-course/reservation-products/{}",
            urlencoding_path(&input.reservation_service_id)
        );
        let dto: FieldGolfReservationProductDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        Ok(map_product(dto))
    }

    async fn list_product_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &str,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        let path = format!(
            "/v1/erp/extensions/golf-course/reservation-products/{}/slots",
            urlencoding_path(service_id)
        );
        let items: Vec<FieldGolfProductSlotDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        items.into_iter().map(map_product_slot).collect()
    }

    async fn replace_product_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &str,
        slots: Vec<ProductSlot>,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        let body = json!({
            "slots": slots.iter().map(|slot| json!({
                "weekday": slot.weekday(),
                "startTime": slot.start_time(),
                "endTime": slot.end_time(),
                "maxGroups": slot.max_groups(),
                "maxPlayers": slot.max_players(),
            })).collect::<Vec<_>>()
        });
        let path = format!(
            "/v1/erp/extensions/golf-course/reservation-products/{}/slots",
            urlencoding_path(service_id)
        );
        let items: FieldItems<FieldGolfProductSlotDto> = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PUT,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        items.items.into_iter().map(map_product_slot).collect()
    }
}

pub(crate) fn normalize_base_url(field_api_url: Option<&str>) -> String {
    field_api_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_FIELD_API_URL)
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn urlencoding_path(value: &str) -> String {
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
    json!({
        "name": input.name,
        "shortName": input.short_name,
        "holeCount": input.hole_count.get(),
        "timezone": input.timezone,
        "startIntervalMinutes": input.start_interval_minutes.get(),
        "isActive": input.is_active,
    })
}

fn map_reservation(value: FieldReservationDto) -> Reservation {
    let golf_course_id = json_string_field(
        value.custom_fields_json.as_ref(),
        &["golfCourseId", "golf_course_id"],
    );
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
    let golf_course_id = json_string_field(
        value.attributes_json.as_ref(),
        &["golfCourseId", "golf_course_id"],
    )
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

fn map_product(value: FieldGolfReservationProductDto) -> ReservationProduct {
    let id = value
        .id
        .clone()
        .unwrap_or_else(|| format!("product:{}", value.reservation_service_id));
    ReservationProduct::reconstitute(
        id,
        value.tenant_id,
        value.reservation_service_id,
        PlayType::parse(&value.play_type),
        value.hole_count,
        value.expected_duration_minutes,
    )
}

fn map_product_slot(value: FieldGolfProductSlotDto) -> Result<ProductSlot, CourseError> {
    ProductSlot::reconstitute(
        value.id,
        value.weekday as u8,
        value.start_time,
        value.end_time,
        value.max_groups,
        value.max_players,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldGolfCourseResourceDto {
    id: String,
    name: String,
    #[serde(default)]
    reservation_resource_id: Option<String>,
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
struct FieldGolfReservationProductDto {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    tenant_id: Option<String>,
    reservation_service_id: String,
    play_type: String,
    #[serde(default)]
    hole_count: i32,
    #[serde(default)]
    expected_duration_minutes: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldGolfProductSlotDto {
    #[serde(default)]
    id: Option<String>,
    weekday: i32,
    start_time: String,
    end_time: String,
    #[serde(default)]
    max_groups: i32,
    #[serde(default)]
    max_players: i32,
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
    if is_empty_course_store(base_url) {
        return Err(empty_course_store_error());
    }
    let url = format!("{base_url}{path_and_query}");
    let mut request = client
        .request(method, &url)
        .header(AUTHORIZATION, credentials.authorization)
        .header("x-operator-id", credentials.operator_id);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| CourseError::Provider(format!("Field API request failed: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(CourseError::Provider(format!(
            "Field API returned {status}: {message}"
        )));
    }
    response
        .json()
        .await
        .map_err(|error| CourseError::Provider(format!("Field API decode failed: {error}")))
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
    let mut request = client
        .request(method, &url)
        .header(AUTHORIZATION, credentials.authorization)
        .header("x-operator-id", credentials.operator_id);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| CourseError::Provider(format!("Field API request failed: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(CourseError::Provider(format!(
            "Field API returned {status}: {message}"
        )));
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
    let mut request = client
        .request(method, &url)
        .header(AUTHORIZATION, credentials.authorization)
        .header("x-operator-id", credentials.operator_id);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| CourseError::Provider(format!("Field API request failed: {error}")))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(CourseError::Provider(format!(
            "Field API returned {status}: {text}"
        )));
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
    let response = client
        .request(method, &url)
        .header(AUTHORIZATION, credentials.authorization)
        .header("x-operator-id", credentials.operator_id)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .body(body.to_vec())
        .send()
        .await
        .map_err(|error| CourseError::Provider(format!("Field API request failed: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(CourseError::Provider(format!(
            "Field API returned {status}: {message}"
        )));
    }
    response
        .json()
        .await
        .map_err(|error| CourseError::Provider(format!("Field API decode failed: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_dto(value: Value) -> FieldGolfCaddieProfileDto {
        serde_json::from_value(value).expect("caddie profile dto")
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
