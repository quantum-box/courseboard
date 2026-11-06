//! Start-ledger PDF import: read the booking system's 「スタート予約台帳」 with
//! Tachyon AI OCR (Field generic OCR jobs), let the desk check one group at a
//! time, then book each group on the ledger.
//!
//! - `POST   /v1/course/reservations/start-ledger/jobs`            reserve a read
//! - `GET    /v1/course/reservations/start-ledger/jobs/{id}`       current read
//! - `POST   /v1/course/reservations/start-ledger/jobs/{id}/confirm`
//! - `POST   /v1/course/reservations/start-ledger/jobs/{id}/advance`
//! - `DELETE /v1/course/reservations/start-ledger/jobs/{id}`       abandon
//! - `GET    /v1/course/reservations/start-ledger/context?date=`   courses, plans, booked tee times
//! - `POST   /v1/course/reservations/start-ledger/import`          book checked groups

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::course::domain::{
    normalize_ledger_notes, CourseId, ReceptionOcrJobSheet, ReceptionOcrJobSheets,
    StartLedgerOcrStep, StartLedgerParty,
};
use crate::course::infrastructure::{party_from_request, FieldStartLedgerGateway};
use crate::course::interfaces::http::{
    catalog_gateway, commercial_gateway, credentials, reservation_gateway, slot_override_gateway,
    PartyPlayerDto, PartyRemarksDto,
};
use crate::course::interfaces::openapi::ErrorBody;
use crate::course::usecase::{
    CreateReservationUseCase, GetStartLedgerImportContextUseCase, ImportStartLedgerPartiesUseCase,
    ReadStartLedgerUseCase, StartLedgerImportOutcome, StartLedgerImportParty, StartLedgerRead,
};
use crate::{AppError, AppState};

const MAX_IDEMPOTENCY_KEY_LENGTH: usize = 128;

fn read_use_case(state: &AppState) -> ReadStartLedgerUseCase {
    ReadStartLedgerUseCase::new(Arc::new(FieldStartLedgerGateway::new(
        state.http_client.clone(),
        state.cancellation_fee_config.field_api_url.as_deref(),
    )))
}

// ─── Read ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerDocumentDto {
    /// `application/pdf`.
    pub content_type: String,
    pub size: u64,
    /// Lowercase hex SHA-256 of the PDF the browser will PUT.
    pub sha256: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateStartLedgerJobRequest {
    /// The same key answers the same job, so a lost response never reads twice.
    pub idempotency_key: String,
    pub documents: Vec<StartLedgerDocumentDto>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerPlayerDraftDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// One group as read off the sheet, 「↓」 already resolved.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerPartyDraftDto {
    /// Course name as printed (`空沼OUT`), not yet a CourseBoard course.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub course_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tee_time: Option<String>,
    /// `self` or `caddie`, from the sheet's セルフ/キャディ.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_style_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub representative: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    pub players: Vec<StartLedgerPlayerDraftDto>,
    /// Plan name as printed (`早期予約133`), not yet a plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    pub remarks: PartyRemarksDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Columns that were 「↓」 on the sheet.
    pub copied_from_above: Vec<String>,
    /// `ditto_without_row_above`, `tee_time_unreadable`,
    /// `player_without_name`, `play_style_unknown`.
    pub warnings: Vec<String>,
}

impl From<StartLedgerParty> for StartLedgerPartyDraftDto {
    fn from(party: StartLedgerParty) -> Self {
        Self {
            course_name: party.course_name,
            tee_time: party.tee_time,
            play_style: party.play_style.map(|style| style.as_str().to_string()),
            play_style_text: party.play_style_text,
            representative: party.representative,
            group_name: party.group_name,
            players: party
                .players
                .into_iter()
                .map(|player| StartLedgerPlayerDraftDto {
                    tag: player.tag,
                    number: player.number,
                    name: player.name,
                })
                .collect(),
            plan_name: party.plan_name,
            remarks: PartyRemarksDto {
                meal: party.remarks.meal().map(str::to_string),
                score_tally: party.remarks.score_tally(),
                settlement: party
                    .remarks
                    .settlement()
                    .map(|value| value.as_str().to_string()),
                note: party.remarks.note().map(str::to_string),
            },
            notes: party.notes,
            copied_from_above: party
                .copied_from_above
                .into_iter()
                .map(str::to_string)
                .collect(),
            warnings: party.warnings.into_iter().map(str::to_string).collect(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerReadDto {
    pub id: String,
    /// uploading | ready | running | completed | failed | cancelled | expired
    pub status: String,
    pub completed_units: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_units: Option<u32>,
    /// The day printed at the top of the sheet, when it could be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<NaiveDate>,
    pub parties: Vec<StartLedgerPartyDraftDto>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<StartLedgerRead> for StartLedgerReadDto {
    fn from(read: StartLedgerRead) -> Self {
        Self {
            id: read.id,
            status: read.status.as_str().to_string(),
            completed_units: read.completed_units,
            total_units: read.total_units,
            date: read.date,
            parties: read.parties.into_iter().map(Into::into).collect(),
            warnings: read.warnings,
            failure_code: read.failure_code,
            expires_at: read.expires_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerUploadDto {
    pub storage_key: String,
    pub upload_url: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateStartLedgerJobResponse {
    pub job: StartLedgerReadDto,
    /// One presigned PUT per document, in request order.
    pub uploads: Vec<StartLedgerUploadDto>,
}

/// POST /v1/course/reservations/start-ledger/jobs
#[utoipa::path(
    post,
    path = "/v1/course/reservations/start-ledger/jobs",
    tag = "course",
    request_body = CreateStartLedgerJobRequest,
    responses(
        (status = 200, description = "Read reserved; PUT each PDF to its URL, then confirm", body = CreateStartLedgerJobResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_start_ledger_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateStartLedgerJobRequest>,
) -> Result<Json<CreateStartLedgerJobResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let key = request.idempotency_key.trim();
    if key.is_empty() || key.len() > MAX_IDEMPOTENCY_KEY_LENGTH {
        return Err(AppError::BadRequest(
            "idempotency key must be 1 to 128 characters",
        ));
    }
    let sheets = request
        .documents
        .into_iter()
        .map(|document| {
            ReceptionOcrJobSheet::try_new(&document.content_type, document.size)?
                .with_sha256(Some(document.sha256))
        })
        .collect::<Result<Vec<_>, _>>()
        .and_then(ReceptionOcrJobSheets::try_new)
        .map_err(AppError::from)?;
    let created = read_use_case(&state)
        .create(credentials, key, sheets)
        .await
        .map_err(AppError::from)?;
    Ok(Json(CreateStartLedgerJobResponse {
        job: created.read.into(),
        uploads: created
            .uploads
            .into_iter()
            .map(|upload| StartLedgerUploadDto {
                storage_key: upload.storage_key,
                upload_url: upload.upload_url,
                expires_at: upload.expires_at,
            })
            .collect(),
    }))
}

/// GET /v1/course/reservations/start-ledger/jobs/{job_id}
#[utoipa::path(
    get,
    path = "/v1/course/reservations/start-ledger/jobs/{job_id}",
    tag = "course",
    params(("job_id" = String, Path)),
    responses(
        (status = 200, description = "Current read", body = StartLedgerReadDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 404, description = "Not found", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_start_ledger_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<StartLedgerReadDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let read = read_use_case(&state)
        .get(credentials, &job_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(read.into()))
}

/// DELETE /v1/course/reservations/start-ledger/jobs/{job_id}
#[utoipa::path(
    delete,
    path = "/v1/course/reservations/start-ledger/jobs/{job_id}",
    tag = "course",
    params(("job_id" = String, Path)),
    responses(
        (status = 200, description = "Read abandoned (or its final state)", body = StartLedgerReadDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn cancel_start_ledger_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<StartLedgerReadDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let read = read_use_case(&state)
        .cancel(credentials, &job_id)
        .await
        .map_err(AppError::from)?;
    Ok(Json(read.into()))
}

async fn step(
    state: AppState,
    headers: HeaderMap,
    job_id: String,
    step: StartLedgerOcrStep,
) -> Result<Json<StartLedgerReadDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let read = read_use_case(&state)
        .step(credentials, &job_id, step)
        .await
        .map_err(AppError::from)?;
    Ok(Json(read.into()))
}

/// POST /v1/course/reservations/start-ledger/jobs/{job_id}/confirm
#[utoipa::path(
    post,
    path = "/v1/course/reservations/start-ledger/jobs/{job_id}/confirm",
    tag = "course",
    params(("job_id" = String, Path)),
    responses(
        (status = 200, description = "Uploads confirmed", body = StartLedgerReadDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn confirm_start_ledger_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<StartLedgerReadDto>, AppError> {
    step(state, headers, job_id, StartLedgerOcrStep::Confirm).await
}

/// POST /v1/course/reservations/start-ledger/jobs/{job_id}/advance
#[utoipa::path(
    post,
    path = "/v1/course/reservations/start-ledger/jobs/{job_id}/advance",
    tag = "course",
    params(("job_id" = String, Path)),
    responses(
        (status = 200, description = "One piece read; call again until completed", body = StartLedgerReadDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 429, description = "The reader is rate limited upstream", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn advance_start_ledger_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<StartLedgerReadDto>, AppError> {
    step(state, headers, job_id, StartLedgerOcrStep::Advance).await
}

// ─── Review context ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct StartLedgerContextQuery {
    pub date: NaiveDate,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerCourseDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerPlanDto {
    pub reservation_service_id: String,
    pub name: String,
    pub requires_caddie: bool,
    /// Absent when the plan is sold on every course.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub course_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerBookedDto {
    pub golf_course_id: String,
    pub tee_time: String,
    pub reservation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerContextDto {
    pub courses: Vec<StartLedgerCourseDto>,
    pub plans: Vec<StartLedgerPlanDto>,
    /// Tee times on the day that already have a group.
    pub booked: Vec<StartLedgerBookedDto>,
}

/// GET /v1/course/reservations/start-ledger/context
#[utoipa::path(
    get,
    path = "/v1/course/reservations/start-ledger/context",
    tag = "course",
    params(StartLedgerContextQuery),
    responses(
        (status = 200, description = "Courses, plans, and booked tee times for the day", body = StartLedgerContextDto),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_start_ledger_context(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StartLedgerContextQuery>,
) -> Result<Json<StartLedgerContextDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let context = GetStartLedgerImportContextUseCase::new(
        catalog_gateway(&state),
        reservation_gateway(&state),
    )
    .execute(credentials, query.date)
    .await
    .map_err(AppError::from)?;
    Ok(Json(StartLedgerContextDto {
        courses: context
            .courses
            .into_iter()
            .map(|course| StartLedgerCourseDto {
                id: course.id.as_str().to_string(),
                name: course.name,
            })
            .collect(),
        plans: context
            .plans
            .into_iter()
            .map(|plan| StartLedgerPlanDto {
                reservation_service_id: plan.reservation_service_id,
                name: plan.name,
                requires_caddie: plan.requires_caddie,
                course_ids: plan
                    .course_ids
                    .map(|ids| ids.iter().map(|id| id.as_str().to_string()).collect()),
            })
            .collect(),
        booked: context
            .booked
            .into_iter()
            .map(|booked| StartLedgerBookedDto {
                golf_course_id: booked.course_id.as_str().to_string(),
                tee_time: booked.tee_time,
                reservation_id: booked.reservation_id.to_string(),
                customer_name: booked.customer_name,
            })
            .collect(),
    }))
}

// ─── Import ─────────────────────────────────────────────────────────────────

/// One group as the desk approved it on the review screen.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerImportPartyDto {
    pub golf_course_id: String,
    pub tee_time: String,
    #[serde(default)]
    pub reservation_service_id: Option<String>,
    /// The representative; the booking is written under this name.
    pub customer_name: String,
    /// Headcount; defaults to the number of named players (at least 1).
    #[serde(default)]
    pub quantity: Option<i32>,
    /// The 「会」 or competition the group plays in, when the sheet names one.
    #[serde(default)]
    pub competition_name: Option<String>,
    #[serde(default)]
    pub players: Vec<PartyPlayerDto>,
    #[serde(default)]
    pub remarks: PartyRemarksDto,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerImportRequest {
    pub date: NaiveDate,
    /// 1 to 10 groups; the screen sends the day in pieces.
    pub parties: Vec<StartLedgerImportPartyDto>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerImportResultDto {
    /// `created`, `already_booked`, or `failed`.
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartLedgerImportResponse {
    /// One per requested group, in request order.
    pub results: Vec<StartLedgerImportResultDto>,
}

fn import_party(dto: StartLedgerImportPartyDto) -> Result<StartLedgerImportParty, AppError> {
    let players: Vec<_> = dto.players.into_iter().map(Into::into).collect();
    let named = players.len() as i32;
    let party = party_from_request(
        dto.competition_name,
        None,
        None,
        players,
        dto.remarks.into(),
    )
    .map_err(AppError::from)?;
    Ok(StartLedgerImportParty {
        golf_course_id: CourseId::try_new(dto.golf_course_id).map_err(AppError::from)?,
        tee_time: dto.tee_time.trim().to_string(),
        reservation_service_id: dto
            .reservation_service_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty()),
        customer_name: dto.customer_name,
        quantity: dto.quantity.unwrap_or(named).max(1),
        party,
        notes: normalize_ledger_notes(dto.notes).map_err(AppError::from)?,
    })
}

/// POST /v1/course/reservations/start-ledger/import
///
/// Books each group through the ledger's own booking path. A tee time that
/// already has a group on that course is skipped (`already_booked`), so the
/// request is safe to send again after a lost response.
#[utoipa::path(
    post,
    path = "/v1/course/reservations/start-ledger/import",
    tag = "course",
    request_body = StartLedgerImportRequest,
    responses(
        (status = 200, description = "One result per group", body = StartLedgerImportResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn import_start_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<StartLedgerImportRequest>,
) -> Result<Json<StartLedgerImportResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let parties = request
        .parties
        .into_iter()
        .map(import_party)
        .collect::<Result<Vec<_>, _>>()?;
    let catalog = catalog_gateway(&state);
    let reservations = reservation_gateway(&state);
    let create = CreateReservationUseCase::new(
        reservations.clone(),
        commercial_gateway(&state),
        catalog.clone(),
        catalog.clone(),
        slot_override_gateway(&state),
        super::http_customers::membership_gateway(&state),
        state.membership_play_windows(),
    );
    let outcomes = ImportStartLedgerPartiesUseCase::new(catalog, reservations, create)
        .execute(credentials, request.date, parties)
        .await
        .map_err(AppError::from)?;
    Ok(Json(StartLedgerImportResponse {
        results: outcomes
            .into_iter()
            .map(|outcome| match outcome {
                StartLedgerImportOutcome::Created {
                    reservation_id,
                    warnings,
                } => StartLedgerImportResultDto {
                    outcome: "created".into(),
                    reservation_id: Some(reservation_id.to_string()),
                    message: None,
                    warnings: warnings.into_iter().map(str::to_string).collect(),
                },
                StartLedgerImportOutcome::AlreadyBooked { reservation_id } => {
                    StartLedgerImportResultDto {
                        outcome: "already_booked".into(),
                        reservation_id: reservation_id.map(|id| id.to_string()),
                        message: None,
                        warnings: Vec::new(),
                    }
                }
                StartLedgerImportOutcome::Failed { message } => StartLedgerImportResultDto {
                    outcome: "failed".into(),
                    reservation_id: None,
                    message: Some(message),
                    warnings: Vec::new(),
                },
            })
            .collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dto(players: usize) -> StartLedgerImportPartyDto {
        StartLedgerImportPartyDto {
            golf_course_id: "out".into(),
            tee_time: " 08:45 ".into(),
            reservation_service_id: Some(" ".into()),
            customer_name: "菊池 芳彦".into(),
            quantity: None,
            competition_name: Some("１・３会".into()),
            players: (0..players)
                .map(|index| PartyPlayerDto {
                    name: format!("選手{index}"),
                    tag: Some("共通".into()),
                    member_number: Some("1001".into()),
                    customer_id: None,
                })
                .collect(),
            remarks: PartyRemarksDto {
                meal: Some("各自注文".into()),
                score_tally: Some(true),
                settlement: Some("individual".into()),
                note: None,
            },
            notes: Some("2B@2750".into()),
        }
    }

    #[test]
    fn a_checked_group_keeps_its_players_remarks_and_notes() {
        let party = import_party(dto(3)).unwrap();
        assert_eq!(party.tee_time, "08:45");
        assert_eq!(party.reservation_service_id, None);
        assert_eq!(party.quantity, 3);
        assert_eq!(party.party.players().len(), 3);
        assert_eq!(party.party.players()[0].member_number(), Some("1001"));
        assert_eq!(party.party.competition_name(), Some("１・３会"));
        assert_eq!(party.party.remarks().meal(), Some("各自注文"));
        assert_eq!(party.notes.as_deref(), Some("2B@2750"));
    }

    #[test]
    fn a_group_with_no_named_players_still_books_one() {
        assert_eq!(import_party(dto(0)).unwrap().quantity, 1);
    }

    #[test]
    fn an_unknown_settlement_is_refused() {
        let mut request = dto(1);
        request.remarks.settlement = Some("card".into());
        assert!(import_party(request).is_err());
    }
}
