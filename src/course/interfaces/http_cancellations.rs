//! Axum handlers for `/v1/course/reservation-cancellations`.
//!
//! Cancelling is done from the tee sheet (`/reservations/{id}/cancel`); this is
//! the other end of it — reading back what was cancelled, why, and what became
//! of the fee. It sits beside the customer ledger rather than beside the board,
//! because the questions it answers are about people: who keeps cancelling on
//! the day, and who has not been billed for it yet.
//!
//! Handlers stay thin: parse request → call use case → map domain → response DTO.

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::http::credentials;
use super::http_customers::customer_gateway;
use super::openapi::ErrorBody;

use crate::course::domain::{
    CancellationFeeDecision, CancellationFeeState, CancellationQuery, CancellationReason,
    ReservationId,
};
use crate::course::usecase::{
    CancellationEntry, ListReservationCancellationsUseCase, SettleCancellationFeesUseCase,
};
use crate::{AppError, AppState};

/// One cancelled booking as a screen reads it.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationCancellationDto {
    pub reservation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reservation_number: Option<String>,
    /// The ledger entry this booking was taken for, when it has one. Without
    /// it the row can be read and chased but not billed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
    /// The name as the ledger spells it now. Falls back to what the booking was
    /// taken under when there is no link, or when Field would not answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_phone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_email: Option<String>,
    /// Whether an invoice can be raised for this row at all.
    pub billable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub golf_course_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tee_time: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub played_on: Option<NaiveDate>,
    pub players: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booking_amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason_note: Option<String>,
    /// Whether the club would normally charge for a cancellation of this kind.
    /// Served rather than re-derived on the screen, so one rule lives in one
    /// place.
    pub fee_expected: bool,
    /// Whole days of notice; negative when the call came after the tee time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice_days: Option<i64>,
    /// `unsettled`, `waived`, or `invoiced`.
    pub fee_state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee_invoice_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee_amount: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee_settled_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee_note: Option<String>,
    pub cancelled_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_by: Option<String>,
}

impl From<&CancellationEntry> for ReservationCancellationDto {
    fn from(entry: &CancellationEntry) -> Self {
        let row = &entry.cancellation;
        Self {
            reservation_id: row.reservation_id.to_string(),
            reservation_number: row.reservation_number.clone(),
            customer_id: row.customer_id.as_ref().map(ToString::to_string),
            customer_name: entry
                .customer
                .as_ref()
                .map(|customer| customer.name().to_string())
                .or_else(|| row.customer_name.clone()),
            customer_phone: entry
                .customer
                .as_ref()
                .and_then(|customer| customer.phone().map(str::to_string)),
            customer_email: entry
                .customer
                .as_ref()
                .and_then(|customer| customer.email().map(str::to_string)),
            billable: entry.billable(),
            golf_course_id: row.golf_course_id.as_ref().map(ToString::to_string),
            tee_time: row.tee_time,
            played_on: row.played_on,
            players: row.players,
            booking_amount: row.booking_amount,
            currency: row.currency.clone(),
            reason: row.reason.as_str().to_string(),
            reason_note: row.reason_note.clone(),
            fee_expected: row.reason.fee_expected(),
            notice_days: row.notice_days,
            fee_state: row.fee_state.as_str().to_string(),
            fee_invoice_id: row.fee_invoice_id.clone(),
            fee_amount: row.fee_amount,
            fee_settled_at: row.fee_settled_at,
            fee_note: row.fee_note.clone(),
            cancelled_at: row.cancelled_at,
            cancelled_by: row.cancelled_by.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationCancellationPageDto {
    pub items: Vec<ReservationCancellationDto>,
    /// How many rows the filters select, not how many came back.
    pub total: i64,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct CancellationParams {
    /// First day of play to include, tenant-local.
    pub from: Option<NaiveDate>,
    /// Last day of play to include, tenant-local.
    pub to: Option<NaiveDate>,
    pub customer_id: Option<String>,
    /// Comma-separated reason codes. Empty means every reason.
    pub reasons: Option<String>,
    /// Comma-separated fee states. Empty means every state.
    pub fee_states: Option<String>,
    /// Keep only the reasons the club charges for.
    pub fee_expected_only: Option<bool>,
    /// Keep only rows that carry a ledger link, which is what a fee can be
    /// billed against.
    pub linked_only: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// A comma-separated list, parsed strictly.
///
/// A code this build does not know is refused rather than skipped: silently
/// dropping it would answer a narrower question than the one the screen asked
/// and look like an empty period.
fn parse_list<T>(
    raw: Option<&str>,
    parse: impl Fn(&str) -> Result<T, crate::course::domain::CourseError>,
) -> Result<Vec<T>, AppError> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    raw.split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| parse(value).map_err(AppError::from))
        .collect()
}

/// GET /v1/course/reservation-cancellations
///
/// Everybody who gave up a tee time in a period, with why and what became of
/// the fee. The collection list is this, narrowed to the chargeable reasons
/// nobody has settled.
#[utoipa::path(
    get,
    path = "/v1/course/reservation-cancellations",
    tag = "course",
    params(CancellationParams),
    responses(
        (status = 200, description = "Cancelled bookings", body = ReservationCancellationPageDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_reservation_cancellations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CancellationParams>,
) -> Result<Json<ReservationCancellationPageDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let query = CancellationQuery {
        from: params.from,
        to: params.to,
        customer_id: params
            .customer_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(crate::course::domain::CustomerId::new),
        reasons: parse_list(params.reasons.as_deref(), CancellationReason::parse)?,
        fee_states: parse_list(params.fee_states.as_deref(), CancellationFeeState::parse)?,
        fee_expected_only: params.fee_expected_only.unwrap_or(false),
        linked_only: params.linked_only.unwrap_or(false),
        ..CancellationQuery::default()
    }
    .with_paging(params.limit, params.offset);

    let page = ListReservationCancellationsUseCase::new(
        state.reservation_cancellations.clone(),
        customer_gateway(&state),
    )
    .execute(credentials, &query)
    .await
    .map_err(AppError::from)?;

    Ok(Json(ReservationCancellationPageDto {
        items: page
            .entries
            .iter()
            .map(ReservationCancellationDto::from)
            .collect(),
        total: page.total,
    }))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancellationFeeDecisionDto {
    pub reservation_id: String,
    /// `unsettled`, `waived`, or `invoiced`.
    pub state: String,
    /// Field's invoice. Required when the state is `invoiced`: the pointer is
    /// the whole point of that state.
    #[serde(default)]
    pub invoice_id: Option<String>,
    #[serde(default)]
    pub amount: Option<i64>,
    /// Why it was waived, when it was.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettleCancellationFeesRequest {
    /// The bookings settled in this action, sent as a set because that is how
    /// the desk decides: one screen, one batch.
    pub decisions: Vec<CancellationFeeDecisionDto>,
}

/// POST /v1/course/reservation-cancellations/fees
///
/// Records what the desk decided about a batch of cancellation fees, after the
/// invoices behind them exist upstream. Answers with the rows as they now
/// stand so the screen redraws from the store rather than from what it hoped
/// it had written.
#[utoipa::path(
    post,
    path = "/v1/course/reservation-cancellations/fees",
    tag = "course",
    request_body = SettleCancellationFeesRequest,
    responses(
        (status = 200, description = "The settled rows", body = ReservationCancellationPageDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn settle_cancellation_fees(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<SettleCancellationFeesRequest>,
) -> Result<Json<ReservationCancellationPageDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let mut decisions = Vec::with_capacity(request.decisions.len());
    for decision in &request.decisions {
        decisions.push(CancellationFeeDecision {
            reservation_id: ReservationId::new(decision.reservation_id.trim()),
            state: CancellationFeeState::parse(&decision.state).map_err(AppError::from)?,
            invoice_id: decision
                .invoice_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            amount: decision.amount,
            note: decision
                .note
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        });
    }

    let settled = SettleCancellationFeesUseCase::new(state.reservation_cancellations.clone())
        .execute(credentials, &decisions)
        .await
        .map_err(AppError::from)?;

    // Settled rows are answered without a ledger lookup: the screen already
    // holds the names it drew the list with, and re-reading Field here would
    // put a page of upstream calls behind a button the desk presses at the end
    // of a morning.
    let total = settled.len() as i64;
    Ok(Json(ReservationCancellationPageDto {
        items: settled
            .iter()
            .map(|cancellation| CancellationEntry {
                cancellation: cancellation.clone(),
                customer: None,
            })
            .map(|entry| ReservationCancellationDto::from(&entry))
            .collect(),
        total,
    }))
}
