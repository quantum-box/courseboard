//! Axum handlers for `/v1/course/*`.
//!
//! Handlers stay thin: parse request → call use case → map domain → response DTO.

use std::{collections::BTreeMap, future::Future, sync::Arc, time::Duration};

use axum::{
    extract::{Path, Query, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::openapi::ErrorBody;

use crate::course::domain::{
    tenant_date_at, AvailabilityRule, BookingHorizon, BusinessHours, Caddie, CaddieAssignment,
    CaddieAssignmentQuery, CaddieId, CaddieStaff, CancellationDetails, CancellationReason, Course,
    CourseError, CourseId, CourseOrder, CustomerId, DeleteSlotOverrides, GatewayCredentials,
    GenerationSummary, GolfCatalogGateway, LedgerColumn, LedgerSlot, NewVisitCheckin, PartyDetails,
    ProductSlot, ReservationId, ReservationProduct, ReservationServiceId, Resource, ResourceId,
    SavedSchedule, SlotOverride, SlotOverrideKind, SlotOverrideQuery, TeeLedger, TeeLedgerQuery,
    TeeSheet, TeeSheetItem, TeeSheetQuery, UpsertCourse, UpsertReservationProduct,
    UpsertSlotOverrides, VisitCheckin,
};
use crate::course::infrastructure::{
    party_from_request, FieldGolfCatalogGateway, FieldGolfCommercialGateway, FieldGolfOpsGateway,
    FieldReservationGateway, FieldStaffShiftGateway, MySqlCaddieDutyRepository,
    MySqlCaddieRankFeeRepository, MySqlCourseOrderRepository, MySqlGeneratedThroughRepository,
    MySqlPlayerTagOptionsRepository, MySqlPricingSettingsRepository, MySqlSlotOverrideRepository,
    PartyPlayerInput,
};
use crate::course::usecase::{
    BookingHorizonStatus, CancelReservationUseCase, ChangeReservationPlanUseCase,
    CreateCourseUseCase, CreateReservationInput, CreateReservationUseCase, DeleteCourseUseCase,
    DeleteSlotOverridesUseCase, ExtendCourseInventoryUseCase, GenerateCourseTimeSlotsUseCase,
    GetBookingHorizonUseCase, GetCourseOrderUseCase, GetCourseScheduleUseCase, GetTeeLedgerUseCase,
    GetTeeSheetUseCase, LinkCourseResourceUseCase, ListCaddieAssignmentsUseCase,
    ListCaddiesUseCase, ListCoursesUseCase, ListProductSlotsUseCase,
    ListReservationCheckinsUseCase, ListReservationProductsUseCase, ListResourcesUseCase,
    ListSlotOverridesUseCase, MirrorShiftToField, RecordVisitCheckinUseCase,
    ReplaceCourseOrderUseCase, ReplaceCourseScheduleUseCase, ReplaceProductSlotsUseCase,
    SeedDemoBoardUseCase, SetBookingHorizonUseCase, SyncRollingWindowOptInUseCase,
    UpdateCourseUseCase, UpdateReservationBookingInput, UpdateReservationBookingUseCase,
    UpdateReservationPartyUseCase, UpsertReservationProductUseCase, UpsertSlotOverridesUseCase,
};
use crate::{AppError, AppState, CallerPrincipal};

// ─── Shared helpers ───────────────────────────────────────────────────────────

pub(crate) fn catalog_gateway(state: &AppState) -> Arc<FieldGolfCatalogGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(
        FieldGolfCatalogGateway::with_multi_course_product_writes(
            state.http_client.clone(),
            field_api_url,
            state.cancellation_fee_config.multi_course_product_writes,
        )
        .with_product_settings(state.product_settings()),
    )
}

pub(crate) fn ops_gateway(state: &AppState) -> Arc<FieldGolfOpsGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldGolfOpsGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

/// The generic half of a confirmed shift, written to Field's HRM.
///
/// The catalog gateway is handed over twice on purpose: it answers both the
/// course-to-resource question and the schedule behind that resource, and
/// building a second one would open a second connection pool for the same
/// upstream.
/// `None` when the write-back is switched off, which is the default. The use
/// cases then behave the way they did before it existed: CourseBoard writes
/// its own tables and tells Field nothing. See `config.rs` for why that is the
/// default rather than the exception.
pub(crate) fn shift_mirror(state: &AppState) -> Option<Arc<MirrorShiftToField>> {
    if !state.cancellation_fee_config.field_shift_writeback {
        return None;
    }
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    let catalog = catalog_gateway(state);
    Some(Arc::new(MirrorShiftToField::new(
        Arc::new(FieldStaffShiftGateway::new(
            state.http_client.clone(),
            field_api_url,
        )),
        catalog.clone(),
        catalog,
    )))
}

pub(crate) fn reservation_gateway(state: &AppState) -> Arc<FieldReservationGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldReservationGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

/// Desk marks live in CourseBoard's own MySQL, not in Field.
pub(crate) fn slot_override_gateway(state: &AppState) -> Arc<MySqlSlotOverrideRepository> {
    state.slot_overrides()
}

/// So does the board's column order (ADR-0009).
pub(crate) fn course_order_gateway(state: &AppState) -> Arc<MySqlCourseOrderRepository> {
    state.course_order()
}

/// And what a round pays at each caddie rank.
pub(crate) fn caddie_rank_fee_gateway(state: &AppState) -> Arc<MySqlCaddieRankFeeRepository> {
    state.caddie_rank_fees()
}

/// And the jobs a caddie is put on when they are not walking a round.
pub(crate) fn caddie_duty_gateway(state: &AppState) -> Arc<MySqlCaddieDutyRepository> {
    state.caddie_duties()
}

/// And the pricing inputs the simulator runs on.
pub(crate) fn pricing_settings_gateway(state: &AppState) -> Arc<MySqlPricingSettingsRepository> {
    state.pricing_settings()
}

/// And the booking form's visitor categories.
pub(crate) fn player_tag_options_gateway(state: &AppState) -> Arc<MySqlPlayerTagOptionsRepository> {
    state.player_tag_options()
}

pub(crate) fn generated_through_gateway(state: &AppState) -> Arc<MySqlGeneratedThroughRepository> {
    state.generated_through()
}

pub(crate) fn commercial_gateway(state: &AppState) -> Arc<FieldGolfCommercialGateway> {
    let field_api_url = state.cancellation_fee_config.field_api_url.as_deref();
    Arc::new(FieldGolfCommercialGateway::new(
        state.http_client.clone(),
        field_api_url,
    ))
}

pub(crate) fn credentials<'a>(
    state: &'a AppState,
    headers: &'a HeaderMap,
) -> Result<GatewayCredentials<'a>, AppError> {
    // Inbound Authorization was already verified by require_valid_token.
    // Forward the login bearer unless an optional static Field override is set.
    let authorization = if let Some(value) = state
        .cancellation_fee_config
        .field_upstream_authorization
        .as_deref()
    {
        value
    } else {
        bearer_authorization(headers)?
    };
    Ok(GatewayCredentials {
        authorization,
        // Never the override: `TACHYON_FIELD_API_BEARER_TOKEN` is a service
        // account, and authorizing as it would give every signed-in user its
        // privileges on the routes that use it.
        caller_bearer: caller_bearer(headers)?,
        operator_id: operator_id(headers)?,
        platform_id: optional_header(headers, "x-platform-id"),
        authorizer: state.course_authorizer(),
    })
}

fn optional_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The bearer the signed-in caller presented, wherever it arrived.
///
/// Cloudflare strips `Authorization` on some paths, so the app also accepts
/// `x-courseboard-authorization`. Authorization decisions must be made about
/// this token and no other — see `credentials`.
pub(crate) fn caller_bearer(headers: &HeaderMap) -> Result<&str, AppError> {
    let value = headers
        .get(AUTHORIZATION)
        .or_else(|| {
            headers.get(axum::http::HeaderName::from_static(
                crate::COURSEBOARD_AUTHORIZATION_HEADER,
            ))
        })
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    if !value.starts_with("Bearer ") || value["Bearer ".len()..].trim().is_empty() {
        return Err(AppError::Unauthorized);
    }
    Ok(value)
}

pub(crate) fn bearer_authorization(headers: &HeaderMap) -> Result<&str, AppError> {
    let value = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    if !value.starts_with("Bearer ") || value["Bearer ".len()..].trim().is_empty() {
        return Err(AppError::Unauthorized);
    }
    Ok(value)
}

pub(crate) fn operator_id(headers: &HeaderMap) -> Result<&str, AppError> {
    let value = headers
        .get("x-operator-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(AppError::BadRequest("x-operator-id header is required"))?;
    Ok(value)
}

impl From<CourseError> for AppError {
    fn from(value: CourseError) -> Self {
        match value {
            CourseError::Unauthorized => AppError::Unauthorized,
            CourseError::Forbidden(action) => AppError::ActionForbidden(action),
            CourseError::TenantForbidden => AppError::TenantForbidden,
            CourseError::BadRequest(message) => AppError::BadRequest(message),
            CourseError::Conflict(message) => AppError::Conflict(message),
            CourseError::UpstreamClient { status: 401, .. } => {
                AppError::UpstreamAuthenticationExpired
            }
            CourseError::UpstreamClient { status, message } => match StatusCode::from_u16(status) {
                Ok(status) if status.is_client_error() => {
                    AppError::UpstreamClient { status, message }
                }
                _ => AppError::Provider(format!(
                    "Field API returned invalid client status {status}: {message}"
                )),
            },
            CourseError::ReceptionReaderFailed(failure) => AppError::ReceptionReaderFailed(failure),
            CourseError::NotFound(message) => AppError::NotFound(message),
            CourseError::Provider(message) => AppError::Provider(message),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemsResponse<T: ToSchema> {
    pub items: Vec<T>,
}

// ─── Tee sheet ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct TeeSheetQueryParams {
    pub date: NaiveDate,
    /// Last day to include. Omitted, the board answers `date` alone.
    ///
    /// Capped at a month from `date`; every row carries its own start, so a
    /// caller reading several days at once can tell them apart.
    pub to: Option<NaiveDate>,
    pub golf_course_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeeSheetItemDto {
    pub id: String,
    pub reservation_number: String,
    pub reservation_service_id: Option<String>,
    pub display_name: Option<String>,
    pub golf_course_id: String,
    pub course_name: String,
    /// Courses the booked plan is sold on.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub expected_course_ids: Vec<String>,
    /// Compatibility alias emitted only for singleton membership.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_course_id: Option<String>,
    /// True when the booking sits on a course its plan is not sold on.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub course_mismatch: bool,
    pub tee_time: String,
    pub duration_minutes: i32,
    pub play_type: String,
    pub party_size: i32,
    pub party_name: String,
    /// Who the booking is for in the customer ledger, when the desk has said.
    ///
    /// Absent on a booking taken under a name alone, which is the normal way a
    /// phone call is written down.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
    /// Competition, group number, and named players the desk keeps.
    ///
    /// Absent until someone enters them: Field hands over one customer name and
    /// a headcount, which the ledger cannot read four names out of.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party: Option<PartyDto>,
    pub status: String,
    pub holes: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Money already taken against the booking, deposit included. Absent when
    /// nothing has been paid; present, the plan can no longer be changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid_amount: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartyPlayerDto {
    pub name: String,
    /// Booking channel or rate class shown above the name (`共通`, `優待`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member_number: Option<String>,
    /// Who this player is in the customer ledger, once the desk has said so.
    ///
    /// Absent on every group entered before the ledger existed and on anyone
    /// the desk has not identified yet, so a client must treat it as optional
    /// rather than as a field that will fill itself in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
}

impl From<PartyPlayerDto> for PartyPlayerInput {
    fn from(value: PartyPlayerDto) -> Self {
        Self {
            name: value.name,
            tag: value.tag,
            member_number: value.member_number,
            customer_id: value.customer_id,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartyDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub competition_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_number: Option<i32>,
    #[serde(default)]
    pub players: Vec<PartyPlayerDto>,
}

impl From<&PartyDetails> for PartyDto {
    fn from(value: &PartyDetails) -> Self {
        Self {
            competition_name: value.competition_name().map(str::to_string),
            organizer: value.organizer().map(str::to_string),
            group_number: value.group_number(),
            players: value
                .players()
                .iter()
                .map(|player| PartyPlayerDto {
                    name: player.name().to_string(),
                    tag: player.tag().map(str::to_string),
                    member_number: player.member_number().map(str::to_string),
                    customer_id: player.customer_id().map(ToString::to_string),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeeSheetResponse {
    pub date: NaiveDate,
    pub timezone: String,
    pub day_start: String,
    pub day_end: String,
    pub items: Vec<TeeSheetItemDto>,
    /// Catalog lookups that failed while building this board. Non-empty means
    /// the rows are present but some of their detail is a fallback.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unavailable: Vec<String>,
}

impl From<&TeeSheetItem> for TeeSheetItemDto {
    fn from(value: &TeeSheetItem) -> Self {
        Self {
            id: value.id().to_string(),
            reservation_number: value.reservation_number().to_string(),
            reservation_service_id: value.reservation_service_id().map(str::to_string),
            display_name: value.display_name().map(str::to_string),
            golf_course_id: value.golf_course_id().to_string(),
            course_name: value.course_name().to_string(),
            expected_course_ids: value
                .expected_course_ids()
                .iter()
                .map(ToString::to_string)
                .collect(),
            expected_course_id: value.expected_course_id().map(ToString::to_string),
            course_mismatch: value.course_mismatch(),
            tee_time: value.tee_time().to_string(),
            duration_minutes: value.duration_minutes(),
            play_type: value.play_type().as_str().to_string(),
            party_size: value.party_size(),
            party_name: value.party_name().to_string(),
            customer_id: value.customer_id().map(ToString::to_string),
            party: Some(value.party())
                .filter(|party| !party.is_empty())
                .map(PartyDto::from),
            status: value.status().as_str().to_string(),
            holes: value.holes(),
            notes: value.notes().map(str::to_string),
            paid_amount: Some(value.paid_amount()).filter(|amount| *amount > 0),
        }
    }
}

impl From<TeeSheet> for TeeSheetResponse {
    fn from(value: TeeSheet) -> Self {
        Self {
            date: value.date(),
            timezone: value.timezone().to_string(),
            day_start: value.day_start().to_string(),
            day_end: value.day_end().to_string(),
            items: value.items().iter().map(TeeSheetItemDto::from).collect(),
            unavailable: value.unavailable().to_vec(),
        }
    }
}

/// GET /v1/course/tee-sheet
#[utoipa::path(
    get,
    path = "/v1/course/tee-sheet",
    tag = "course",
    params(TeeSheetQueryParams),
    responses(
        (status = 200, description = "Tee sheet for the requested date", body = TeeSheetResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_tee_sheet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TeeSheetQueryParams>,
) -> Result<Json<TeeSheetResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let reservations = reservation_gateway(&state);
    let catalog = catalog_gateway(&state);
    let use_case = GetTeeSheetUseCase::new(reservations, catalog);
    let sheet = use_case
        .execute(
            credentials,
            TeeSheetQuery {
                date: query.date,
                to: query.to,
                golf_course_id: CourseId::from_optional(query.golf_course_id),
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(TeeSheetResponse::from(sheet)))
}

// ─── Tee ledger ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSlotDto {
    /// Local wall clock `HH:MM`.
    pub tee_time: String,
    /// Groups the course may start here, absent when the row was derived rather
    /// than generated. Absent is not zero: it means nobody counted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_groups: Option<i32>,
    pub booked_groups: i32,
    pub player_count: i32,
    pub is_active: bool,
    /// Whether the desk could still sell this row to a walk-in.
    pub is_sellable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mark: Option<SlotOverrideDto>,
    pub items: Vec<TeeSheetItemDto>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LedgerColumnDto {
    pub golf_course_id: String,
    pub course_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_interval_minutes: Option<i32>,
    /// `inventory`, `schedule`, `opening_hours`, or `bookings_only`.
    ///
    /// Only `inventory` knows how many groups are left; the rest say when a
    /// group could start and nothing more.
    pub grid_source: String,
    pub group_count: i32,
    pub player_count: i32,
    pub self_group_count: i32,
    pub caddie_group_count: i32,
    pub open_slot_count: i32,
    pub slots: Vec<LedgerSlotDto>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeeLedgerResponse {
    pub date: NaiveDate,
    pub timezone: String,
    pub columns: Vec<LedgerColumnDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unavailable: Vec<String>,
}

impl From<&LedgerSlot> for LedgerSlotDto {
    fn from(value: &LedgerSlot) -> Self {
        Self {
            tee_time: value.tee_time().to_string(),
            capacity: value.capacity(),
            available_groups: value.available_groups(),
            booked_groups: value.booked_groups(),
            player_count: value.player_count(),
            is_active: value.is_active(),
            is_sellable: value.is_sellable(),
            mark: value.mark().map(SlotOverrideDto::from),
            items: value.items().iter().map(TeeSheetItemDto::from).collect(),
        }
    }
}

impl From<&LedgerColumn> for LedgerColumnDto {
    fn from(value: &LedgerColumn) -> Self {
        Self {
            golf_course_id: value.course_id().to_string(),
            course_name: value.course_name().to_string(),
            resource_id: value.resource_id().map(ToString::to_string),
            start_interval_minutes: value.start_interval_minutes(),
            grid_source: value.grid_source().as_str().to_string(),
            group_count: value.group_count(),
            player_count: value.player_count(),
            self_group_count: value.self_group_count(),
            caddie_group_count: value.caddie_group_count(),
            open_slot_count: value.open_slot_count(),
            slots: value.slots().iter().map(LedgerSlotDto::from).collect(),
        }
    }
}

impl From<TeeLedger> for TeeLedgerResponse {
    fn from(value: TeeLedger) -> Self {
        Self {
            date: value.date(),
            timezone: value.timezone().to_string(),
            columns: value.columns().iter().map(LedgerColumnDto::from).collect(),
            unavailable: value.unavailable().to_vec(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct TeeLedgerQueryParams {
    pub date: NaiveDate,
    /// Comma-separated course ids to draw columns for. Absent or empty means
    /// every active course.
    pub golf_course_ids: Option<String>,
    /// One course id, kept because the tee sheet next to this board takes the
    /// singular name and operators paste links between the two.
    pub golf_course_id: Option<String>,
}

/// Absolute budget for the whole rolling-window backfill on one ledger visit.
///
/// The sync performs up to `2 + C + k` Field calls for `C` course resources and
/// `k` changed resources (`k <= C`), or at most `2 + 2C`. It is deliberately a
/// single injected deadline rather than a timeout added per course, so a slow
/// Field cannot make ledger latency grow without bound as courses are added.
const ROLLING_WINDOW_SYNC_DEADLINE: Duration = Duration::from_secs(5);

async fn run_rolling_window_sync_then<T, SyncFuture, LedgerFuture>(
    sync: SyncFuture,
    deadline: Duration,
    ledger: LedgerFuture,
) -> Result<T, CourseError>
where
    SyncFuture: Future<Output = Result<Vec<CourseId>, CourseError>>,
    LedgerFuture: Future<Output = Result<T, CourseError>>,
{
    match tokio::time::timeout(deadline, sync).await {
        Ok(Ok(_synced)) => {}
        Ok(Err(error)) => {
            tracing::warn!(%error, "could not sync the Field rolling window opt-in while reading the ledger");
        }
        Err(_) => {
            tracing::warn!(
                deadline = ?deadline,
                "Field rolling window opt-in sync exceeded its deadline; continuing without it",
            );
        }
    }
    ledger.await
}

impl TeeLedgerQueryParams {
    fn course_ids(&self) -> Vec<CourseId> {
        self.golf_course_ids
            .iter()
            .flat_map(|value| value.split(','))
            .chain(self.golf_course_id.iter().map(String::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(CourseId::new)
            // A link that names the same course twice would otherwise draw it
            // twice, side by side.
            .fold(Vec::new(), |mut ids, id| {
                if !ids.contains(&id) {
                    ids.push(id);
                }
                ids
            })
    }
}

/// GET /v1/course/tee-ledger
#[utoipa::path(
    get,
    path = "/v1/course/tee-ledger",
    tag = "course",
    params(TeeLedgerQueryParams),
    responses(
        (status = 200, description = "Start-time ledger for the requested date", body = TeeLedgerResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_tee_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TeeLedgerQueryParams>,
) -> Result<Json<TeeLedgerResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let tenant_id = operator_id(&headers)?.to_string();

    // The ledger is the screen the desk opens every day, which makes it the
    // one place the far edge of the book can be kept moving without a
    // scheduler. Best effort: a top-up that fails must still show the day.
    let catalog = catalog_gateway(&state);
    if let Err(error) = ExtendCourseInventoryUseCase::new(
        catalog.clone(),
        catalog.clone(),
        commercial_gateway(&state),
        generated_through_gateway(&state),
    )
    .execute(credentials, &tenant_id)
    .await
    {
        tracing::warn!(%error, "could not extend the booking window while reading the ledger");
    }

    let rolling_window_sync = SyncRollingWindowOptInUseCase::new(
        catalog.clone(),
        catalog.clone(),
        commercial_gateway(&state),
    );
    let use_case = GetTeeLedgerUseCase::new(
        reservation_gateway(&state),
        catalog_gateway(&state),
        catalog_gateway(&state),
        slot_override_gateway(&state),
        course_order_gateway(&state),
    );
    let ledger = run_rolling_window_sync_then(
        rolling_window_sync.execute(credentials),
        ROLLING_WINDOW_SYNC_DEADLINE,
        use_case.execute(
            credentials,
            &tenant_id,
            TeeLedgerQuery {
                date: query.date,
                golf_course_ids: query.course_ids(),
            },
        ),
    )
    .await
    .map_err(AppError::from)?;
    Ok(Json(TeeLedgerResponse::from(ledger)))
}

// ─── Demo seed ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct SeedDemoBoardParams {
    /// The day to put the demo board on. Defaults to today in the course's zone.
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeedDemoBoardResponse {
    pub date: NaiveDate,
    pub courses: usize,
    pub bookings_created: usize,
    pub bookings_updated: usize,
    pub marks: usize,
}

/// POST /v1/course/demo-seed
///
/// Writes a demo day into Field and into CourseBoard's own storage, then leaves
/// it to be read back through the ordinary board. Safe to run twice: bookings
/// carry a key the next run matches on, so a second run updates rather than
/// stacking a second day beside the first.
#[utoipa::path(
    post,
    path = "/v1/course/demo-seed",
    tag = "course",
    params(SeedDemoBoardParams),
    responses(
        (status = 200, description = "What the run created or changed", body = SeedDemoBoardResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn seed_demo_board(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<SeedDemoBoardParams>,
) -> Result<Json<SeedDemoBoardResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let tenant_id = operator_id(&headers)?.to_string();
    let date = match params.date {
        Some(date) => date,
        None => {
            let timezone = catalog_gateway(&state)
                .get_tenant_timezone(credentials)
                .await
                .map_err(AppError::from)?;
            tenant_date_at(Utc::now(), &timezone).map_err(AppError::from)?
        }
    };
    let use_case = SeedDemoBoardUseCase::new(
        reservation_gateway(&state),
        catalog_gateway(&state),
        slot_override_gateway(&state),
    );
    let summary = use_case
        .execute(credentials, &tenant_id, date)
        .await
        .map_err(AppError::from)?;
    Ok(Json(SeedDemoBoardResponse {
        date,
        courses: summary.courses,
        bookings_created: summary.bookings_created,
        bookings_updated: summary.bookings_updated,
        marks: summary.marks,
    }))
}

// ─── Course order ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CourseOrderResponse {
    /// Course ids left to right. Courses left out fall in behind these by name,
    /// so a course created after the board was arranged still reaches it.
    pub golf_course_ids: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceCourseOrderRequest {
    /// The whole arrangement. An empty list clears it back to name order.
    pub golf_course_ids: Vec<String>,
}

impl From<CourseOrder> for CourseOrderResponse {
    fn from(value: CourseOrder) -> Self {
        Self {
            golf_course_ids: value.ids().iter().map(ToString::to_string).collect(),
        }
    }
}

/// GET /v1/course/course-order
#[utoipa::path(
    get,
    path = "/v1/course/course-order",
    tag = "course",
    responses(
        (status = 200, description = "Left-to-right column order", body = CourseOrderResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_course_order(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CourseOrderResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let order = GetCourseOrderUseCase::new(catalog_gateway(&state), course_order_gateway(&state))
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CourseOrderResponse::from(order)))
}

/// PUT /v1/course/course-order
#[utoipa::path(
    put,
    path = "/v1/course/course-order",
    tag = "course",
    request_body = ReplaceCourseOrderRequest,
    responses(
        (status = 200, description = "Stored column order", body = CourseOrderResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_course_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ReplaceCourseOrderRequest>,
) -> Result<Json<CourseOrderResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let ids = request
        .golf_course_ids
        .into_iter()
        .filter_map(|id| CourseId::from_optional(Some(id)))
        .collect();
    let order =
        ReplaceCourseOrderUseCase::new(catalog_gateway(&state), course_order_gateway(&state))
            .execute(credentials, ids)
            .await
            .map_err(AppError::from)?;
    Ok(Json(CourseOrderResponse::from(order)))
}

// ─── Reservation create ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateReservationRequest {
    pub golf_course_id: String,
    /// Generic reservation inventory resource from the selected ledger column.
    pub resource_id: String,
    #[serde(default)]
    pub reservation_service_id: Option<String>,
    pub date: NaiveDate,
    /// Wall clock on the course's own day, e.g. `"07:14"`.
    pub tee_time: String,
    pub duration_minutes: i64,
    pub quantity: i32,
    pub customer_name: String,
    /// The ledger entry the desk picked for whoever is booking.
    ///
    /// Optional: a call the desk cannot place a name to still has to become a
    /// booking. The name is always recorded; the identity is recorded when it
    /// is known.
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub competition_name: Option<String>,
    #[serde(default)]
    pub organizer: Option<String>,
    #[serde(default)]
    pub group_number: Option<i32>,
    #[serde(default)]
    pub players: Vec<PartyPlayerDto>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedReservationDto {
    pub id: String,
    /// Things the desk should know about the booking that was just written.
    /// Never a refusal — the tee time is sold either way. Empty is normal.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// POST /v1/course/reservations
///
/// Books an empty tee time straight from the ledger — a walk-in or phone
/// booking the desk takes without a customer-facing channel.
#[utoipa::path(
    post,
    path = "/v1/course/reservations",
    tag = "course",
    request_body = CreateReservationRequest,
    responses(
        (status = 200, description = "Created reservation", body = CreatedReservationDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 409, description = "The selected tee time is no longer available", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_reservation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateReservationRequest>,
) -> Result<Json<CreatedReservationDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    // The Field catalog gateway serves both the catalog and the schedule port.
    let catalog = catalog_gateway(&state);
    let use_case = CreateReservationUseCase::new(
        reservation_gateway(&state),
        commercial_gateway(&state),
        catalog.clone(),
        catalog,
        slot_override_gateway(&state),
        super::http_customers::membership_gateway(&state),
        state.membership_play_windows(),
    );
    let party = party_from_request(
        request.competition_name,
        request.organizer,
        request.group_number,
        request.players.into_iter().map(Into::into).collect(),
    )
    .map_err(AppError::from)?;
    let created = use_case
        .execute(
            credentials,
            CreateReservationInput {
                // try_new, not new: a blank id would be written into the
                // booking's custom fields and read back as a course, leaving an
                // orphan column on the board instead of a correctable 400.
                golf_course_id: CourseId::try_new(request.golf_course_id)
                    .map_err(AppError::from)?,
                reservation_resource_id: ResourceId::try_new(request.resource_id)
                    .map_err(AppError::from)?,
                reservation_service_id: request.reservation_service_id,
                date: request.date,
                tee_time: request.tee_time,
                duration_minutes: request.duration_minutes,
                quantity: request.quantity,
                customer_name: request.customer_name,
                customer_id: CustomerId::from_optional(request.customer_id),
                party,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(CreatedReservationDto {
        id: created.id.to_string(),
        warnings: created.warnings.iter().map(|w| w.to_string()).collect(),
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelReservationRequest {
    /// Which of the club's reasons this was: `weather`, `illness`, `personal`,
    /// `no_contact`, `course_side`, `shortage`, `mistake`, or `other`.
    ///
    /// Optional so that a client written before the reasons existed still
    /// cancels rather than failing, and lands as `other`. It is what the whole
    /// month is counted by, so every screen of ours sends one.
    #[serde(default)]
    pub reason_code: Option<String>,
    /// Why the desk cancelled, in their own words. Optional.
    #[serde(default)]
    pub reason: Option<String>,
}

/// POST /v1/course/reservations/{reservation_id}/cancel
#[utoipa::path(
    post,
    path = "/v1/course/reservations/{reservation_id}/cancel",
    tag = "course",
    params(("reservation_id" = String, Path, description = "Reservation id")),
    request_body = CancelReservationRequest,
    responses(
        (status = 204, description = "Reservation cancelled"),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn cancel_reservation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    principal: Option<Extension<CallerPrincipal>>,
    Json(request): Json<CancelReservationRequest>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let reason = match request.reason_code.as_deref() {
        Some(code) => CancellationReason::parse(code).map_err(AppError::from)?,
        None => CancellationReason::Other,
    };
    let details =
        CancellationDetails::try_new(reason, request.reason.as_deref()).map_err(AppError::from)?;
    let cancelled_by = principal.and_then(|Extension(caller)| caller.subject);
    let use_case = CancelReservationUseCase::new(
        reservation_gateway(&state),
        ops_gateway(&state),
        catalog_gateway(&state),
        state.reservation_cancellations.clone(),
    );
    use_case
        .execute(
            credentials,
            &ReservationId::new(reservation_id),
            &details,
            cancelled_by.as_deref(),
        )
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Reservation booking ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReservationBookingRequest {
    /// Who the booking is under, as the desk would read it out.
    pub customer_name: String,
    /// The ledger entry for that person, when the desk has identified one.
    ///
    /// Absent leaves the link the booking already has rather than clearing it:
    /// Field owns the customer on its side and has no way to unset one.
    #[serde(default)]
    pub customer_id: Option<String>,
    /// How many are playing.
    pub quantity: i32,
}

/// PATCH /v1/course/reservations/{reservation_id}
///
/// Corrects the caller and the headcount on a booking already taken. The group
/// detail has its own call: this one deliberately leaves it alone.
#[utoipa::path(
    patch,
    path = "/v1/course/reservations/{reservation_id}",
    tag = "course",
    params(("reservation_id" = String, Path, description = "Reservation id")),
    request_body = UpdateReservationBookingRequest,
    responses(
        (status = 204, description = "Booking updated"),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Reservation not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_reservation_booking(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    Json(request): Json<UpdateReservationBookingRequest>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case =
        UpdateReservationBookingUseCase::new(reservation_gateway(&state), catalog_gateway(&state));
    use_case
        .execute(
            credentials,
            &ReservationId::new(reservation_id),
            UpdateReservationBookingInput {
                customer_name: request.customer_name,
                customer_id: CustomerId::from_optional(request.customer_id),
                quantity: request.quantity,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Reservation party ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReservationPartyRequest {
    #[serde(default)]
    pub competition_name: Option<String>,
    #[serde(default)]
    pub organizer: Option<String>,
    #[serde(default)]
    pub group_number: Option<i32>,
    /// The whole roster, replacing whatever was there.
    ///
    /// A patch per player would need stable player ids, and the desk edits the
    /// group as one thing — it retypes the cell, it does not amend seat three.
    #[serde(default)]
    pub players: Vec<PartyPlayerDto>,
}

/// PATCH /v1/course/reservations/{reservation_id}/party
#[utoipa::path(
    patch,
    path = "/v1/course/reservations/{reservation_id}/party",
    tag = "course",
    params(("reservation_id" = String, Path, description = "Reservation id")),
    request_body = UpdateReservationPartyRequest,
    responses(
        (status = 200, description = "Stored group detail", body = PartyDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_reservation_party(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    Json(request): Json<UpdateReservationPartyRequest>,
) -> Result<Json<PartyDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let party = party_from_request(
        request.competition_name,
        request.organizer,
        request.group_number,
        request.players.into_iter().map(Into::into).collect(),
    )
    .map_err(AppError::from)?;
    let use_case = UpdateReservationPartyUseCase::new(reservation_gateway(&state));
    let stored = use_case
        .execute(credentials, &ReservationId::new(reservation_id), party)
        .await
        .map_err(AppError::from)?;
    Ok(Json(PartyDto::from(&stored)))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeReservationPlanRequest {
    /// The plan to sell the round under from now on.
    pub reservation_service_id: String,
}

/// PATCH /v1/course/reservations/{reservation_id}/plan
///
/// Moves a booking onto another plan — a self round the caller decides they
/// want a caddie for. The round's length follows the plan, so the end time is
/// recomputed here rather than left at what the old plan implied.
#[utoipa::path(
    patch,
    path = "/v1/course/reservations/{reservation_id}/plan",
    tag = "course",
    params(("reservation_id" = String, Path, description = "Reservation id")),
    request_body = ChangeReservationPlanRequest,
    responses(
        (status = 204, description = "Plan changed"),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Plan not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn change_reservation_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    Json(request): Json<ChangeReservationPlanRequest>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ChangeReservationPlanUseCase::new(
        reservation_gateway(&state),
        catalog_gateway(&state),
        state.visit_checkins.clone(),
    );
    use_case
        .execute(
            credentials,
            &ReservationId::new(reservation_id),
            &ReservationServiceId::new(request.reservation_service_id),
        )
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Reservation check-in ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VisitCheckinDto {
    pub reservation_id: String,
    /// Seat in the group, zero-based, as the party roster orders them.
    pub player_index: u32,
    /// Who this turned out to be in the ledger. Absent for a seat the desk has
    /// not decided about, which is a normal state for a group that has already
    /// gone out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
    pub player_name: String,
    pub played_on: NaiveDate,
    pub checked_in_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_in_by: Option<String>,
}

impl From<&VisitCheckin> for VisitCheckinDto {
    fn from(value: &VisitCheckin) -> Self {
        Self {
            reservation_id: value.reservation_id.to_string(),
            player_index: value.player_index,
            customer_id: value.customer_id.as_ref().map(ToString::to_string),
            player_name: value.player_name.clone(),
            played_on: value.played_on,
            checked_in_at: value.checked_in_at,
            checked_in_by: value.checked_in_by.clone(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckinPlayerDto {
    pub player_index: u32,
    #[serde(default)]
    pub customer_id: Option<String>,
    pub player_name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecordCheckinRequest {
    /// The seats that turned up. Sent as a set because a group walks up
    /// together, and four separate calls is four chances to record half of one.
    pub players: Vec<CheckinPlayerDto>,
}

/// POST /v1/course/reservations/{reservation_id}/checkins
///
/// The desk saying this group arrived, which is the only thing that can tell a
/// round played from a round nobody came to — and the only record of the three
/// people who played in somebody else's booking. Idempotent per seat: pressing
/// the button twice is one arrival.
#[utoipa::path(
    post,
    path = "/v1/course/reservations/{reservation_id}/checkins",
    tag = "course",
    params(("reservation_id" = String, Path, description = "Reservation id")),
    request_body = RecordCheckinRequest,
    responses(
        (status = 200, description = "The booking's check-ins", body = ItemsResponse<VisitCheckinDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn record_reservation_checkins(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
    principal: Option<Extension<CallerPrincipal>>,
    Json(request): Json<RecordCheckinRequest>,
) -> Result<Json<ItemsResponse<VisitCheckinDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let mut players = Vec::with_capacity(request.players.len());
    for player in request.players {
        let customer_id = match player.customer_id {
            Some(id) => Some(CustomerId::try_new(id).map_err(AppError::from)?),
            None => None,
        };
        players.push(
            NewVisitCheckin::try_new(player.player_index, customer_id, player.player_name)
                .map_err(AppError::from)?,
        );
    }
    let checked_in_by = principal.and_then(|Extension(caller)| caller.subject);
    let stored = RecordVisitCheckinUseCase::new(
        reservation_gateway(&state),
        catalog_gateway(&state),
        state.visit_checkins.clone(),
    )
    .execute(
        credentials,
        &ReservationId::new(reservation_id),
        players,
        checked_in_by.as_deref(),
    )
    .await
    .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: stored.iter().map(VisitCheckinDto::from).collect(),
    }))
}

/// GET /v1/course/reservations/{reservation_id}/checkins
///
/// What the desk has already done to this group, so the screen shows it rather
/// than making somebody press the button again to find out.
#[utoipa::path(
    get,
    path = "/v1/course/reservations/{reservation_id}/checkins",
    tag = "course",
    params(("reservation_id" = String, Path, description = "Reservation id")),
    responses(
        (status = 200, description = "The booking's check-ins", body = ItemsResponse<VisitCheckinDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_reservation_checkins(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(reservation_id): Path<String>,
) -> Result<Json<ItemsResponse<VisitCheckinDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let found = ListReservationCheckinsUseCase::new(state.visit_checkins.clone())
        .execute(credentials, &ReservationId::new(reservation_id))
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: found.iter().map(VisitCheckinDto::from).collect(),
    }))
}

// ─── Slot marks ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlotOverrideDto {
    pub golf_course_id: String,
    pub date: NaiveDate,
    pub tee_time: String,
    /// `closed` or `special_rate`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl From<&SlotOverride> for SlotOverrideDto {
    fn from(value: &SlotOverride) -> Self {
        Self {
            golf_course_id: value.course_id().to_string(),
            date: value.date(),
            tee_time: value.tee_time().to_string(),
            kind: value.kind().as_str().to_string(),
            label: value.label().map(str::to_string),
            note: value.note().map(str::to_string),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct SlotOverrideQueryParams {
    pub date: NaiveDate,
    pub golf_course_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSlotOverridesRequest {
    pub golf_course_id: String,
    pub date: NaiveDate,
    /// The whole band the desk is marking, as `HH:MM`.
    pub tee_times: Vec<String>,
    pub kind: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSlotOverridesRequest {
    pub golf_course_id: String,
    pub date: NaiveDate,
    pub tee_times: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSlotOverridesResponse {
    pub deleted: u64,
}

/// GET /v1/course/slot-overrides
#[utoipa::path(
    get,
    path = "/v1/course/slot-overrides",
    tag = "course",
    params(SlotOverrideQueryParams),
    responses(
        (status = 200, description = "Desk marks for the requested date", body = ItemsResponse<SlotOverrideDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_slot_overrides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SlotOverrideQueryParams>,
) -> Result<Json<ItemsResponse<SlotOverrideDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListSlotOverridesUseCase::new(slot_override_gateway(&state));
    let items = use_case
        .execute(
            credentials,
            SlotOverrideQuery {
                date: query.date,
                course_ids: CourseId::from_optional(query.golf_course_id)
                    .into_iter()
                    .collect(),
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(SlotOverrideDto::from).collect(),
    }))
}

/// PUT /v1/course/slot-overrides
#[utoipa::path(
    put,
    path = "/v1/course/slot-overrides",
    tag = "course",
    request_body = UpsertSlotOverridesRequest,
    responses(
        (status = 200, description = "Marks now on those tee times", body = ItemsResponse<SlotOverrideDto>),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn upsert_slot_overrides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<UpsertSlotOverridesRequest>,
) -> Result<Json<ItemsResponse<SlotOverrideDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let command = UpsertSlotOverrides {
        course_id: CourseId::try_new(request.golf_course_id).map_err(AppError::from)?,
        date: request.date,
        tee_times: request.tee_times,
        kind: SlotOverrideKind::parse(&request.kind).map_err(AppError::from)?,
        label: request.label,
        note: request.note,
    };
    let use_case = UpsertSlotOverridesUseCase::new(slot_override_gateway(&state));
    let items = use_case
        .execute(credentials, command)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(SlotOverrideDto::from).collect(),
    }))
}

/// DELETE /v1/course/slot-overrides
#[utoipa::path(
    delete,
    path = "/v1/course/slot-overrides",
    tag = "course",
    request_body = DeleteSlotOverridesRequest,
    responses(
        (status = 200, description = "How many marks were cleared", body = DeleteSlotOverridesResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_slot_overrides(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DeleteSlotOverridesRequest>,
) -> Result<Json<DeleteSlotOverridesResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = DeleteSlotOverridesUseCase::new(slot_override_gateway(&state));
    let deleted = use_case
        .execute(
            credentials,
            DeleteSlotOverrides {
                course_id: CourseId::try_new(request.golf_course_id).map_err(AppError::from)?,
                date: request.date,
                tee_times: request.tee_times,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(DeleteSlotOverridesResponse { deleted }))
}

// ─── Courses ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CourseDto {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name: Option<String>,
    pub hole_count: i32,
    /// Legacy Field value retained for API and rollback compatibility.
    /// Tenant extension config is the operational source of truth.
    pub timezone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_hours_json: Option<BusinessHoursDto>,
    pub start_interval_minutes: i32,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BusinessHoursDto {
    pub open: String,
    pub close: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCourseRequest {
    pub name: String,
    pub short_name: Option<String>,
    pub hole_count: i32,
    pub start_interval_minutes: i32,
    #[serde(default = "default_true")]
    pub is_active: bool,
    /// When the course starts and stops sending groups out.
    ///
    /// Omit to leave whatever the course already has: Field replaces the column
    /// with what it is sent, so a save without this must not clear the hours.
    #[serde(default)]
    pub business_hours_json: Option<BusinessHoursDto>,
}

fn default_true() -> bool {
    true
}

impl From<&Course> for CourseDto {
    fn from(value: &Course) -> Self {
        let business_hours_json = match (value.business_hours_open(), value.business_hours_close())
        {
            (Some(open), Some(close)) => Some(BusinessHoursDto {
                open: open.to_string(),
                close: close.to_string(),
            }),
            _ => None,
        };
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            short_name: value.short_name().map(str::to_string),
            hole_count: value.hole_count().get(),
            timezone: value.timezone().to_string(),
            business_hours_json,
            start_interval_minutes: value.start_interval_minutes().get(),
            is_active: value.is_active(),
            created_at: value.created_at(),
            updated_at: value.updated_at(),
        }
    }
}

fn parse_upsert_course(body: UpsertCourseRequest) -> Result<UpsertCourse, AppError> {
    let business_hours = body
        .business_hours_json
        .map(|hours| BusinessHours::try_new(hours.open, hours.close))
        .transpose()
        .map_err(AppError::from)?;
    UpsertCourse::try_new(
        body.name,
        body.short_name,
        body.hole_count,
        body.start_interval_minutes,
        body.is_active,
        business_hours,
    )
    .map_err(AppError::from)
}

/// GET /v1/course/courses
#[utoipa::path(
    get,
    path = "/v1/course/courses",
    tag = "course",
    responses(
        (status = 200, description = "List golf courses", body = inline(ItemsResponse<CourseDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_courses(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<CourseDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCoursesUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(CourseDto::from).collect(),
    }))
}

/// POST /v1/course/courses
#[utoipa::path(
    post,
    path = "/v1/course/courses",
    tag = "course",
    request_body = UpsertCourseRequest,
    responses(
        (status = 201, description = "Course created", body = CourseDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertCourseRequest>,
) -> Result<(StatusCode, Json<CourseDto>), AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = parse_upsert_course(body)?;
    let use_case = CreateCourseUseCase::new(catalog_gateway(&state));
    let course = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok((StatusCode::CREATED, Json(CourseDto::from(&course))))
}

/// PATCH /v1/course/courses/:id
#[utoipa::path(
    patch,
    path = "/v1/course/courses/{id}",
    tag = "course",
    params(("id" = String, Path, description = "Course ID")),
    request_body = UpsertCourseRequest,
    responses(
        (status = 200, description = "Course updated", body = CourseDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(course_id): Path<String>,
    Json(body): Json<UpsertCourseRequest>,
) -> Result<Json<CourseDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let course_id = CourseId::try_new(course_id).map_err(AppError::from)?;
    let input = parse_upsert_course(body)?;
    let use_case = UpdateCourseUseCase::new(catalog_gateway(&state));
    let course = use_case
        .execute(credentials, &course_id, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CourseDto::from(&course)))
}

/// DELETE /v1/course/courses/:id
#[utoipa::path(
    delete,
    path = "/v1/course/courses/{id}",
    tag = "course",
    params(("id" = String, Path, description = "Course ID")),
    responses(
        (status = 204, description = "Course deleted"),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete_course(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(course_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let credentials = credentials(&state, &headers)?;
    let course_id = CourseId::try_new(course_id).map_err(AppError::from)?;
    let use_case = DeleteCourseUseCase::new(catalog_gateway(&state));
    use_case
        .execute(credentials, &course_id)
        .await
        .map_err(AppError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Resources ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDto {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation_resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub golf_course_id: Option<String>,
    pub resource_kind: String,
    pub active: bool,
}

impl From<&Resource> for ResourceDto {
    fn from(value: &Resource) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            reservation_resource_id: value.reservation_resource_id().map(ToString::to_string),
            golf_course_id: value.golf_course_id().map(ToString::to_string),
            resource_kind: value.kind().as_str().to_string(),
            active: value.is_active(),
        }
    }
}

/// GET /v1/course/resources
#[utoipa::path(
    get,
    path = "/v1/course/resources",
    tag = "course",
    responses(
        (status = 200, description = "List resources", body = inline(ItemsResponse<ResourceDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<ResourceDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListResourcesUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ResourceDto::from).collect(),
    }))
}

/// POST /v1/course/courses/:id/resource
#[utoipa::path(
    post,
    path = "/v1/course/courses/{id}/resource",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    responses(
        (status = 200, description = "The course's reservation resource", body = ResourceDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Course not found", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn link_course_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ResourceDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = LinkCourseResourceUseCase::new(catalog_gateway(&state));
    let resource = use_case
        .execute(credentials, &CourseId::new(id))
        .await
        .map_err(AppError::from)?;
    Ok(Json(ResourceDto::from(&resource)))
}

// ─── Course schedule and inventory ────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityRuleDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Sunday is 0, as everywhere else in CourseBoard.
    pub weekday: u8,
    pub start_time: String,
    pub end_time: String,
    /// Groups that may be out at once. Never a party size.
    pub capacity: i32,
    pub slot_interval_minutes: i32,
}

impl From<&AvailabilityRule> for AvailabilityRuleDto {
    fn from(value: &AvailabilityRule) -> Self {
        Self {
            id: value.id().map(str::to_string),
            weekday: value.weekday(),
            start_time: value.start_time().to_string(),
            end_time: value.end_time().to_string(),
            capacity: value.capacity(),
            slot_interval_minutes: value.slot_interval_minutes(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceCourseScheduleRequest {
    pub rules: Vec<ReplaceAvailabilityRuleDto>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceAvailabilityRuleDto {
    pub id: Option<String>,
    /// Required only for a rule created in this editor session. A full-replace
    /// request cannot otherwise distinguish a create from a persisted rule
    /// whose id was accidentally dropped.
    #[serde(default)]
    pub is_new: bool,
    pub weekday: u8,
    pub start_time: String,
    pub end_time: String,
    pub capacity: i32,
    pub slot_interval_minutes: i32,
}

impl ReplaceAvailabilityRuleDto {
    fn into_domain(self) -> Result<AvailabilityRule, CourseError> {
        let id = self.id.filter(|value| !value.trim().is_empty());
        match (id.is_some(), self.is_new) {
            (false, false) => {
                return Err(CourseError::BadRequest(
                    "a schedule rule without an id must be marked isNew",
                ));
            }
            (true, true) => {
                return Err(CourseError::BadRequest(
                    "a schedule rule with an id must not be marked isNew",
                ));
            }
            _ => {}
        }
        AvailabilityRule::try_new(
            id,
            self.weekday,
            self.start_time,
            self.end_time,
            self.capacity,
            self.slot_interval_minutes,
        )
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateCourseTimeSlotsRequest {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Work out the same plan without writing it.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerationSummaryDto {
    pub created: i64,
    pub updated: i64,
    pub deactivated: i64,
    pub unchanged: i64,
}

impl From<GenerationSummary> for GenerationSummaryDto {
    fn from(value: GenerationSummary) -> Self {
        Self {
            created: value.created,
            updated: value.updated,
            deactivated: value.deactivated,
            unchanged: value.unchanged,
        }
    }
}

/// GET /v1/course/courses/:id/schedule
#[utoipa::path(
    get,
    path = "/v1/course/courses/{id}/schedule",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    responses(
        (status = 200, description = "Weekly opening schedule", body = inline(ItemsResponse<AvailabilityRuleDto>)),
        (status = 400, description = "Course is not linked to a resource", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_course_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ItemsResponse<AvailabilityRuleDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let gateway = catalog_gateway(&state);
    let use_case = GetCourseScheduleUseCase::new(gateway.clone(), gateway);
    let rules = use_case
        .execute(credentials, &CourseId::new(id))
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: rules.iter().map(AvailabilityRuleDto::from).collect(),
    }))
}

/// PUT /v1/course/courses/:id/schedule
#[utoipa::path(
    put,
    path = "/v1/course/courses/{id}/schedule",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    request_body = ReplaceCourseScheduleRequest,
    responses(
        (status = 200, description = "Schedule replaced and its tee times built", body = SavedScheduleDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_course_schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ReplaceCourseScheduleRequest>,
) -> Result<Json<SavedScheduleDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let rules = body
        .rules
        .into_iter()
        .map(ReplaceAvailabilityRuleDto::into_domain)
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    let gateway = catalog_gateway(&state);
    let use_case = ReplaceCourseScheduleUseCase::new(
        gateway.clone(),
        gateway,
        commercial_gateway(&state),
        generated_through_gateway(&state),
    );
    let saved = use_case
        .execute(credentials, &CourseId::new(id), rules)
        .await
        .map_err(AppError::from)?;
    Ok(Json(SavedScheduleDto::from(saved)))
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedScheduleDto {
    pub items: Vec<AvailabilityRuleDto>,
    /// Last date now on sale, or `null` when the week saved but its tee times
    /// were not built.
    pub bookable_through: Option<NaiveDate>,
    pub built: Option<GenerationSummaryDto>,
}

impl From<SavedSchedule> for SavedScheduleDto {
    fn from(value: SavedSchedule) -> Self {
        Self {
            items: value.rules.iter().map(AvailabilityRuleDto::from).collect(),
            bookable_through: value.built.map(|built| built.bookable_through),
            built: value
                .built
                .map(|built| GenerationSummaryDto::from(built.summary)),
        }
    }
}

// ─── Booking horizon ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingHorizonDto {
    /// `days` for a rolling window, `through` for a named closing date.
    pub mode: String,
    /// Days ahead of today the book is open, in `days` mode.
    pub days: Option<i64>,
    /// The closing date the club named, in `through` mode.
    pub through: Option<NaiveDate>,
    /// The last date a booking may land on, as of today. Behind today once a
    /// named closing date has passed, which is a closed book rather than an
    /// error.
    pub bookable_through: NaiveDate,
}

impl BookingHorizonDto {
    fn new(horizon: BookingHorizon, bookable_through: NaiveDate) -> Self {
        Self {
            mode: match horizon {
                BookingHorizon::Days(_) => "days",
                BookingHorizon::Through(_) => "through",
            }
            .to_string(),
            days: horizon.days(),
            through: horizon.through_date(),
            bookable_through,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingHorizonStatusDto {
    #[serde(flatten)]
    pub horizon: BookingHorizonDto,
    /// Per-course far edge of dated inventory. A `null` value is intentional:
    /// that course has no recorded successful build and must not be presented
    /// as reaching the configured booking horizon.
    pub generated_through: BTreeMap<String, Option<NaiveDate>>,
}

impl From<BookingHorizonStatus> for BookingHorizonStatusDto {
    fn from(status: BookingHorizonStatus) -> Self {
        Self {
            horizon: BookingHorizonDto::new(status.horizon, status.bookable_through),
            generated_through: status
                .generated_through
                .into_iter()
                .map(|(course_id, generated)| (course_id.into_inner(), generated))
                .collect(),
        }
    }
}

/// Exactly one of the two is sent; the other says which shape was not chosen.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetBookingHorizonRequest {
    pub days: Option<i64>,
    pub through: Option<NaiveDate>,
}

impl SetBookingHorizonRequest {
    fn into_horizon(self) -> Result<BookingHorizon, CourseError> {
        match (self.days, self.through) {
            (Some(days), None) => BookingHorizon::try_days(days),
            (None, Some(date)) => Ok(BookingHorizon::through(date)),
            // Both would leave the far edge to whichever field the server
            // happened to prefer, and neither says nothing at all.
            _ => Err(CourseError::BadRequest(
                "send either days or through, not both",
            )),
        }
    }
}

/// GET /v1/course/booking-horizon
#[utoipa::path(
    get,
    path = "/v1/course/booking-horizon",
    tag = "course",
    responses(
        (status = 200, description = "Configured and generated booking horizons", body = BookingHorizonStatusDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_booking_horizon(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<BookingHorizonStatusDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let status = GetBookingHorizonUseCase::new(
        catalog_gateway(&state),
        commercial_gateway(&state),
        generated_through_gateway(&state),
    )
    .execute(credentials)
    .await
    .map_err(AppError::from)?;
    Ok(Json(BookingHorizonStatusDto::from(status)))
}

/// PUT /v1/course/booking-horizon
#[utoipa::path(
    put,
    path = "/v1/course/booking-horizon",
    tag = "course",
    request_body = SetBookingHorizonRequest,
    responses(
        (status = 200, description = "Horizon stored and every course rebuilt", body = BookingHorizonDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn set_booking_horizon(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SetBookingHorizonRequest>,
) -> Result<Json<BookingHorizonDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let horizon = body.into_horizon().map_err(AppError::from)?;
    let gateway = catalog_gateway(&state);
    let use_case = SetBookingHorizonUseCase::new(
        gateway.clone(),
        gateway,
        commercial_gateway(&state),
        generated_through_gateway(&state),
    );
    let (stored, bookable_through) = use_case
        .execute(credentials, horizon)
        .await
        .map_err(AppError::from)?;
    Ok(Json(BookingHorizonDto::new(stored, bookable_through)))
}

/// POST /v1/course/courses/:id/time-slots/generate
#[utoipa::path(
    post,
    path = "/v1/course/courses/{id}/time-slots/generate",
    tag = "course",
    params(("id" = String, Path, description = "Golf course ID")),
    request_body = GenerateCourseTimeSlotsRequest,
    responses(
        (status = 200, description = "Inventory generated", body = GenerationSummaryDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn generate_course_time_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<GenerateCourseTimeSlotsRequest>,
) -> Result<Json<GenerationSummaryDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let gateway = catalog_gateway(&state);
    let use_case = GenerateCourseTimeSlotsUseCase::new(gateway.clone(), gateway);
    let summary = use_case
        .execute(
            credentials,
            &CourseId::new(id),
            body.from,
            body.to,
            body.dry_run,
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(GenerationSummaryDto::from(summary)))
}

// ─── Reservation products ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationProductDto {
    pub id: String,
    pub tenant_id: String,
    pub extension_key: String,
    pub reservation_service_id: String,
    pub display_name: Option<String>,
    pub play_type: String,
    pub hole_count: i32,
    pub expected_duration_minutes: i32,
    /// Canonical CourseBoard-owned course membership.
    #[serde(default)]
    pub golf_course_ids: Vec<String>,
    /// Compatibility alias emitted only for a singleton membership.
    pub golf_course_id: Option<String>,
    /// Players allowed in one group; falls back to the reservation policy.
    pub max_players_per_group: Option<i32>,
}

impl From<&ReservationProduct> for ReservationProductDto {
    fn from(value: &ReservationProduct) -> Self {
        Self {
            id: value.id().to_string(),
            tenant_id: value
                .tenant_id()
                .map(ToString::to_string)
                .unwrap_or_default(),
            extension_key: "golf_course".to_string(),
            reservation_service_id: value.reservation_service_id().to_string(),
            display_name: value.display_name().map(str::to_string),
            play_type: value.play_type().as_str().to_string(),
            hole_count: value.hole_count().get(),
            expected_duration_minutes: value.expected_duration_minutes().get(),
            golf_course_ids: value
                .golf_course_ids()
                .iter()
                .map(ToString::to_string)
                .collect(),
            golf_course_id: value.golf_course_id().map(ToString::to_string),
            max_players_per_group: value.max_players_per_group(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertReservationProductRequest {
    pub display_name: Option<String>,
    pub play_type: String,
    pub hole_count: Option<i32>,
    pub expected_duration_minutes: Option<i32>,
    /// Canonical input. Presence takes precedence structurally; callers must
    /// not send it together with the compatibility scalar.
    pub golf_course_ids: Option<Vec<String>>,
    pub golf_course_id: Option<String>,
    pub max_players_per_group: Option<i32>,
}

impl UpsertReservationProductRequest {
    fn into_domain(self, service_id: String) -> Result<UpsertReservationProduct, CourseError> {
        let Self {
            display_name,
            play_type,
            hole_count,
            expected_duration_minutes,
            golf_course_ids,
            golf_course_id,
            max_players_per_group,
        } = self;
        match (golf_course_ids, golf_course_id) {
            (Some(_), Some(_)) => Err(CourseError::BadRequest(
                "send golfCourseIds or golfCourseId, not both",
            )),
            (Some(course_ids), None) => UpsertReservationProduct::try_new_with_course_ids(
                service_id,
                display_name,
                play_type,
                hole_count.unwrap_or(18),
                expected_duration_minutes.unwrap_or(270),
                course_ids,
                max_players_per_group,
            ),
            (None, course_id) => UpsertReservationProduct::try_new(
                service_id,
                display_name,
                play_type,
                hole_count.unwrap_or(18),
                expected_duration_minutes.unwrap_or(270),
                course_id,
                max_players_per_group,
            ),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductSlotDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub weekday: u8,
    pub start_time: String,
    pub end_time: String,
    pub max_groups: i32,
    pub max_players: i32,
}

impl From<&ProductSlot> for ProductSlotDto {
    fn from(value: &ProductSlot) -> Self {
        Self {
            id: value.id().map(ToString::to_string),
            weekday: value.weekday(),
            start_time: value.start_time().to_string(),
            end_time: value.end_time().to_string(),
            max_groups: value.max_groups(),
            max_players: value.max_players(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceProductSlotsRequest {
    pub slots: Vec<ProductSlotDto>,
}

/// GET /v1/course/reservation-products
#[utoipa::path(
    get,
    path = "/v1/course/reservation-products",
    tag = "course",
    responses(
        (status = 200, description = "List reservation products", body = inline(ItemsResponse<ReservationProductDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_reservation_products(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ItemsResponse<ReservationProductDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListReservationProductsUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ReservationProductDto::from).collect(),
    }))
}

/// POST /v1/course/reservation-products/:service_id
#[utoipa::path(
    post,
    path = "/v1/course/reservation-products/{service_id}",
    tag = "course",
    params(("service_id" = String, Path, description = "Reservation service ID")),
    request_body = UpsertReservationProductRequest,
    responses(
        (status = 200, description = "Reservation product upserted", body = ReservationProductDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn upsert_reservation_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(body): Json<UpsertReservationProductRequest>,
) -> Result<Json<ReservationProductDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let input = body.into_domain(service_id).map_err(AppError::from)?;
    let use_case = UpsertReservationProductUseCase::new(catalog_gateway(&state));
    let product = use_case
        .execute(credentials, input)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationProductDto::from(&product)))
}

/// GET /v1/course/reservation-products/:service_id/slots
#[utoipa::path(
    get,
    path = "/v1/course/reservation-products/{service_id}/slots",
    tag = "course",
    params(("service_id" = String, Path, description = "Reservation service ID")),
    responses(
        (status = 200, description = "List product slots", body = inline(ItemsResponse<ProductSlotDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_product_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
) -> Result<Json<ItemsResponse<ProductSlotDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let service_id = ReservationServiceId::try_new(service_id).map_err(AppError::from)?;
    let use_case = ListProductSlotsUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials, &service_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ProductSlotDto::from).collect(),
    }))
}

/// PUT /v1/course/reservation-products/:service_id/slots
#[utoipa::path(
    put,
    path = "/v1/course/reservation-products/{service_id}/slots",
    tag = "course",
    params(("service_id" = String, Path, description = "Reservation service ID")),
    request_body = ReplaceProductSlotsRequest,
    responses(
        (status = 200, description = "Product slots replaced", body = inline(ItemsResponse<ProductSlotDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn replace_product_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(body): Json<ReplaceProductSlotsRequest>,
) -> Result<Json<ItemsResponse<ProductSlotDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let service_id = ReservationServiceId::try_new(service_id).map_err(AppError::from)?;
    let slots = body
        .slots
        .into_iter()
        .map(|slot| {
            ProductSlot::reconstitute(
                slot.id,
                slot.weekday,
                slot.start_time,
                slot.end_time,
                slot.max_groups,
                slot.max_players,
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    let use_case = ReplaceProductSlotsUseCase::new(catalog_gateway(&state));
    let items = use_case
        .execute(credentials, &service_id, slots)
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ProductSlotDto::from).collect(),
    }))
}

// ─── Caddies / assignments ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieDto {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff_id: Option<String>,
    pub active: bool,
    pub skill_level: String,
    pub rank: String,
    pub employment_status: String,
    pub base_fee_amount: i64,
    pub currency: String,
    pub max_rounds_per_day: i32,
    pub can_two_rounds: bool,
    pub monthly_contract_rounds: i32,
    pub desired_income: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating_average: Option<f64>,
    pub rating_count: i64,
}

impl From<&Caddie> for CaddieDto {
    fn from(value: &Caddie) -> Self {
        Self {
            id: value.id().to_string(),
            display_name: value.display_name().to_string(),
            staff_id: value.staff_id().map(str::to_string),
            active: value.is_active(),
            skill_level: value.skill_level().as_str().to_string(),
            rank: value.rank().as_str().to_string(),
            employment_status: value.employment_status().to_string(),
            base_fee_amount: value.base_fee_amount(),
            currency: value.currency().to_string(),
            max_rounds_per_day: value.max_rounds_per_day(),
            can_two_rounds: value.can_two_rounds(),
            monthly_contract_rounds: value.monthly_contract_rounds(),
            desired_income: value.desired_income(),
            rating_average: value.rating_average(),
            rating_count: value.rating_count(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieStaffDto {
    pub id: String,
    pub name: String,
    pub active: bool,
}

impl From<&CaddieStaff> for CaddieStaffDto {
    fn from(value: &CaddieStaff) -> Self {
        Self {
            id: value.id().to_string(),
            name: value.name().to_string(),
            active: value.is_active(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieRosterResponse {
    pub items: Vec<CaddieDto>,
    pub staff: Vec<CaddieStaffDto>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieAssignmentDto {
    pub id: String,
    /// Kept as `caddieProfileId` for Timeline / Caddies UI compatibility.
    pub caddie_profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub round_reference: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<i32>,
    pub status: String,
    /// Canonicalized by CourseBoard's AssignmentStatus parser. The raw status
    /// above remains untouched for compatibility with existing consumers.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub canonical_status: Option<String>,
    pub assignment_role: String,
    pub fee_amount: i64,
    pub fee_currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl From<&CaddieAssignment> for CaddieAssignmentDto {
    fn from(value: &CaddieAssignment) -> Self {
        Self {
            id: value.id().to_string(),
            caddie_profile_id: value.caddie_id().to_string(),
            reservation_id: value.reservation_id().map(ToString::to_string),
            round_reference: value.round_reference().map(str::to_string),
            scheduled_at: value.scheduled_at(),
            duration_minutes: value.duration_minutes(),
            status: value.status_label().to_string(),
            canonical_status: Some(value.status().as_str().to_string()),
            assignment_role: value.role_label().to_string(),
            fee_amount: value.fee_amount(),
            fee_currency: value.fee_currency().to_string(),
            notes: value.notes().map(str::to_string),
        }
    }
}

/// GET /v1/course/caddie-profiles
#[utoipa::path(
    get,
    path = "/v1/course/caddie-profiles",
    tag = "course-ops",
    responses(
        (status = 200, description = "List caddie profiles and reusable staff index", body = CaddieRosterResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddies(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CaddieRosterResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddiesUseCase::new(ops_gateway(&state));
    let roster = use_case
        .execute(credentials)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CaddieRosterResponse {
        items: roster.caddies().iter().map(CaddieDto::from).collect(),
        staff: roster.staff().iter().map(CaddieStaffDto::from).collect(),
    }))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct CaddieAssignmentQueryParams {
    pub caddie_profile_id: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

/// GET /v1/course/caddie-assignments
#[utoipa::path(
    get,
    path = "/v1/course/caddie-assignments",
    tag = "course-ops",
    params(CaddieAssignmentQueryParams),
    responses(
        (status = 200, description = "List caddie assignments", body = inline(ItemsResponse<CaddieAssignmentDto>)),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_caddie_assignments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CaddieAssignmentQueryParams>,
) -> Result<Json<ItemsResponse<CaddieAssignmentDto>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let use_case = ListCaddieAssignmentsUseCase::new(ops_gateway(&state));
    let items = use_case
        .execute(
            credentials,
            CaddieAssignmentQuery {
                caddie_id: CaddieId::from_optional(query.caddie_profile_id),
                from: query.from,
                to: query.to,
                reservation_id: None,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(CaddieAssignmentDto::from).collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::PlayType;
    use chrono::TimeZone;

    fn schedule_rule_request(id: Option<&str>, is_new: Option<bool>) -> ReplaceAvailabilityRuleDto {
        let mut value = serde_json::json!({
            "weekday": 1,
            "startTime": "07:00",
            "endTime": "12:00",
            "capacity": 2,
            "slotIntervalMinutes": 8
        });
        let object = value.as_object_mut().expect("schedule rule object");
        if let Some(id) = id {
            object.insert("id".into(), serde_json::json!(id));
        }
        if let Some(is_new) = is_new {
            object.insert("isNew".into(), serde_json::json!(is_new));
        }
        serde_json::from_value(value).expect("schedule rule request")
    }

    #[test]
    fn booking_horizon_serializes_a_never_built_course_as_null() {
        let dto = BookingHorizonStatusDto::from(BookingHorizonStatus {
            horizon: BookingHorizon::try_days(180).expect("valid horizon"),
            bookable_through: NaiveDate::from_ymd_opt(2027, 2, 19).expect("valid date"),
            generated_through: [
                (
                    CourseId::new("course-built"),
                    Some(NaiveDate::from_ymd_opt(2027, 2, 19).expect("valid date")),
                ),
                (CourseId::new("course-empty"), None),
            ]
            .into_iter()
            .collect(),
        });

        let json = serde_json::to_value(dto).expect("serialize booking horizon");
        assert_eq!(
            json["generatedThrough"]["course-built"],
            serde_json::json!("2027-02-19")
        );
        assert_eq!(
            json["generatedThrough"]["course-empty"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn schedule_replace_distinguishes_existing_rules_from_explicit_creates() {
        let existing = schedule_rule_request(Some("rule-1"), None)
            .into_domain()
            .expect("existing rule");
        assert_eq!(existing.id(), Some("rule-1"));

        let created = schedule_rule_request(None, Some(true))
            .into_domain()
            .expect("new rule");
        assert_eq!(created.id(), None);
    }

    #[test]
    fn schedule_replace_rejects_ambiguous_or_contradictory_rule_identity() {
        assert!(matches!(
            schedule_rule_request(None, None).into_domain(),
            Err(CourseError::BadRequest(
                "a schedule rule without an id must be marked isNew"
            ))
        ));
        assert!(matches!(
            schedule_rule_request(Some("rule-1"), Some(true)).into_domain(),
            Err(CourseError::BadRequest(
                "a schedule rule with an id must not be marked isNew"
            ))
        ));
    }

    fn product_request(
        golf_course_ids: Option<Vec<&str>>,
        golf_course_id: Option<&str>,
    ) -> UpsertReservationProductRequest {
        UpsertReservationProductRequest {
            display_name: Some("シーズンパス".to_string()),
            play_type: "self".to_string(),
            hole_count: Some(18),
            expected_duration_minutes: Some(240),
            golf_course_ids: golf_course_ids
                .map(|ids| ids.into_iter().map(str::to_string).collect()),
            golf_course_id: golf_course_id.map(str::to_string),
            max_players_per_group: Some(4),
        }
    }

    #[test]
    fn create_reservation_request_accepts_player_details() {
        let request: CreateReservationRequest = serde_json::from_value(serde_json::json!({
            "golfCourseId": "course-1",
            "resourceId": "resource-1",
            "date": "2026-08-12",
            "teeTime": "07:30",
            "durationMinutes": 270,
            "quantity": 4,
            "customerName": "山田 太郎",
            "players": [{
                "name": "増田 公陽",
                "tag": "共通",
                "memberNumber": "M-01"
            }]
        }))
        .expect("create reservation request");

        assert_eq!(request.players.len(), 1);
        assert_eq!(request.players[0].name, "増田 公陽");
        assert_eq!(request.players[0].tag.as_deref(), Some("共通"));
        assert_eq!(request.players[0].member_number.as_deref(), Some("M-01"));
    }

    fn params(ids: Option<&str>, id: Option<&str>) -> TeeLedgerQueryParams {
        TeeLedgerQueryParams {
            date: NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
            golf_course_ids: ids.map(str::to_string),
            golf_course_id: id.map(str::to_string),
        }
    }

    #[test]
    fn naming_no_course_draws_every_course() {
        assert!(params(None, None).course_ids().is_empty());
        assert!(params(Some(""), None).course_ids().is_empty());
        // A trailing comma is what a UI building the list by joining produces
        // when the last item is dropped; it must not mean "a course with no id".
        assert!(params(Some(" , "), None).course_ids().is_empty());
    }

    #[test]
    fn reservation_product_input_accepts_canonical_array_and_legacy_scalar() {
        let canonical = product_request(Some(vec![" course-east ", "course-west"]), None)
            .into_domain("season-pass".to_string())
            .expect("canonical request");
        assert_eq!(
            canonical
                .golf_course_ids()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["course-east", "course-west"]
        );
        assert!(!canonical.uses_legacy_course_id_input());

        let legacy = product_request(None, Some("course-east"))
            .into_domain("single-course".to_string())
            .expect("legacy request");
        assert_eq!(legacy.golf_course_id(), Some(&CourseId::new("course-east")));
        assert!(legacy.uses_legacy_course_id_input());
    }

    #[test]
    fn reservation_product_input_rejects_ambiguous_or_empty_array_scope() {
        assert!(matches!(
            product_request(Some(vec!["course-east"]), Some("course-east"))
                .into_domain("ambiguous".to_string()),
            Err(CourseError::BadRequest(
                "send golfCourseIds or golfCourseId, not both"
            ))
        ));
        assert!(matches!(
            product_request(Some(Vec::new()), None).into_domain("empty".to_string()),
            Err(CourseError::BadRequest(
                "golfCourseIds must contain at least one course"
            ))
        ));
    }

    #[test]
    fn multi_course_product_dto_omits_the_scalar_alias() {
        let product = ReservationProduct::reconstitute_with_course_ids(
            "season-pass",
            None,
            "season-pass",
            Some("シーズンパス".to_string()),
            PlayType::SelfPlay,
            18,
            240,
            vec!["course-east".to_string(), "course-west".to_string()],
            Some(4),
        );
        let dto = ReservationProductDto::from(&product);
        assert_eq!(dto.golf_course_ids, vec!["course-east", "course-west"]);
        assert_eq!(dto.golf_course_id, None);
    }

    #[test]
    fn several_courses_arrive_as_a_comma_separated_list() {
        assert_eq!(
            params(Some("course-a, course-b"), None).course_ids(),
            vec![CourseId::new("course-a"), CourseId::new("course-b")]
        );
    }

    #[test]
    fn the_tee_sheets_singular_parameter_still_selects_a_course() {
        // The two boards sit next to each other and operators paste links
        // between them; the tee sheet's name for this is `golfCourseId`.
        assert_eq!(
            params(None, Some("course-a")).course_ids(),
            vec![CourseId::new("course-a")]
        );
    }

    #[test]
    fn a_course_named_twice_gets_one_column_rather_than_two() {
        assert_eq!(
            params(Some("course-a,course-a"), Some("course-a")).course_ids(),
            vec![CourseId::new("course-a")]
        );
    }

    #[test]
    fn assignment_dto_preserves_raw_status_and_emits_the_canonical_status() {
        let cases = [
            (" assigned ", "assigned"),
            ("CHECKED_IN", "in_progress"),
            (" completed ", "completed"),
            ("CANCELED", "cancelled"),
            ("unknown", "other"),
        ];
        for (raw, canonical) in cases {
            let assignment = CaddieAssignment::reconstitute(
                "assignment-1",
                "caddie-1",
                Some("reservation-1".into()),
                None,
                Utc.with_ymd_and_hms(2026, 9, 12, 1, 0, 0).unwrap(),
                None,
                raw,
                "primary",
                0,
                "JPY",
                None,
            )
            .expect("valid assignment");
            let dto = CaddieAssignmentDto::from(&assignment);

            assert_eq!(dto.status, raw);
            assert_eq!(dto.canonical_status.as_deref(), Some(canonical));
            let json = serde_json::to_value(dto).expect("serialize assignment");
            assert_eq!(json["status"], raw);
            assert_eq!(json["canonicalStatus"], canonical);
        }
    }

    #[test]
    fn assignment_dto_without_canonical_status_remains_deserializable() {
        let old_json = serde_json::json!({
            "id": "assignment-1",
            "caddieProfileId": "caddie-1",
            "reservationId": "reservation-1",
            "scheduledAt": "2026-09-12T01:00:00Z",
            "status": "assigned",
            "assignmentRole": "primary",
            "feeAmount": 0,
            "feeCurrency": "JPY"
        });

        let dto: CaddieAssignmentDto =
            serde_json::from_value(old_json).expect("decode old assignment");
        assert_eq!(dto.canonical_status, None);
    }

    #[tokio::test]
    async fn rolling_window_deadline_still_runs_the_ledger_future() {
        let result = run_rolling_window_sync_then(
            async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok::<Vec<CourseId>, CourseError>(Vec::new())
            },
            Duration::from_millis(1),
            async { Ok::<&str, CourseError>("ledger") },
        )
        .await
        .expect("ledger should run after the best-effort timeout");

        assert_eq!(result, "ledger");
    }

    #[tokio::test]
    async fn rolling_window_sync_error_still_runs_the_ledger_future() {
        let result = run_rolling_window_sync_then(
            async {
                Err::<Vec<CourseId>, CourseError>(CourseError::Provider(
                    "Field rejected the sync".into(),
                ))
            },
            ROLLING_WINDOW_SYNC_DEADLINE,
            async { Ok::<&str, CourseError>("ledger") },
        )
        .await
        .expect("ledger should run after an immediate sync error");

        assert_eq!(result, "ledger");
    }
}
