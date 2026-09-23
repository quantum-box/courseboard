//! Axum handlers for `/v1/course/caddie-fee-alignment`.
//!
//! The payroll screen's way of moving caddies off a fee of their own and onto
//! their rank's fee (PLT-3346): read what each move would do, then move the
//! caddies the operator ticked.
//!
//! Handlers stay thin: parse request → call use case → map domain → response DTO.

use axum::{extract::State, http::HeaderMap, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::http::{caddie_rank_fee_gateway, credentials, ops_gateway};
use super::http_ops::CaddieRankFeesDto;
use super::openapi::ErrorBody;

use crate::course::domain::{
    CaddieId, CourseError, FeeAlignmentCandidate, FeeAlignmentItem, FeeAlignmentOutcome,
    FeeAlignmentRequest, RecordedCaddieFeeChange,
};
use crate::course::usecase::{AlignCaddieFeesToRankUseCase, PreviewCaddieFeeAlignmentUseCase};
use crate::{AppError, AppState, CallerPrincipal};

/// A caddie who carries a fee of their own, against their rank's fee.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeeAlignmentCandidateDto {
    pub caddie_profile_id: String,
    pub display_name: String,
    pub active: bool,
    pub rank: String,
    /// What they are paid per round now.
    pub own_fee: i64,
    /// What their rank pays per round.
    pub rank_fee: i64,
    /// `rankFee - ownFee`: negative is a pay cut.
    pub difference: i64,
    /// `unchanged`, `raise`, or `cut`.
    pub effect: String,
}

impl From<&FeeAlignmentCandidate> for FeeAlignmentCandidateDto {
    fn from(value: &FeeAlignmentCandidate) -> Self {
        Self {
            caddie_profile_id: value.caddie_id.as_str().to_string(),
            display_name: value.display_name.clone(),
            active: value.active,
            rank: value.rank.as_str().to_string(),
            own_fee: value.own_fee,
            rank_fee: value.rank_fee,
            difference: value.difference(),
            effect: value.effect().as_str().to_string(),
        }
    }
}

/// A logged move onto the rank fee.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieFeeChangeDto {
    pub id: u64,
    pub caddie_profile_id: String,
    /// The caddie's current name, when the roster still has them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub rank: String,
    pub previous_fee: i64,
    pub new_fee: i64,
    /// What the rank paid at the moment of the move.
    pub rank_fee: i64,
    pub currency: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_by_name: Option<String>,
    pub changed_at: DateTime<Utc>,
}

impl CaddieFeeChangeDto {
    fn new(recorded: RecordedCaddieFeeChange, display_name: Option<String>) -> Self {
        let change = recorded.change;
        Self {
            id: recorded.id,
            caddie_profile_id: change.caddie_id.into_inner(),
            display_name,
            rank: change.rank.as_str().to_string(),
            previous_fee: change.previous_fee,
            new_fee: change.new_fee,
            rank_fee: change.rank_fee,
            currency: change.currency,
            note: change.note,
            changed_by: change.changed_by,
            changed_by_name: change.changed_by_name,
            changed_at: recorded.changed_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeeAlignmentPreviewResponse {
    /// False until the club has saved its rank fees on this screen. Nobody can
    /// be moved onto an unsaved table.
    pub rank_fees_confirmed: bool,
    pub fees: CaddieRankFeesDto,
    /// Cuts first, then raises, then the moves that change nothing.
    pub candidates: Vec<FeeAlignmentCandidateDto>,
    /// The most recent moves, newest first.
    pub recent_changes: Vec<CaddieFeeChangeDto>,
}

/// GET /v1/course/caddie-fee-alignment
#[utoipa::path(
    get,
    path = "/v1/course/caddie-fee-alignment",
    tag = "course-ops",
    responses(
        (status = 200, description = "What moving caddies onto their rank fee would do", body = FeeAlignmentPreviewResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn preview_caddie_fee_alignment(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<FeeAlignmentPreviewResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let preview = PreviewCaddieFeeAlignmentUseCase::new(
        ops_gateway(&state),
        caddie_rank_fee_gateway(&state),
        state.caddie_fee_changes(),
    )
    .execute(credentials)
    .await
    .map_err(AppError::from)?;
    Ok(Json(FeeAlignmentPreviewResponse {
        rank_fees_confirmed: preview.rank_fees_confirmed,
        candidates: preview
            .candidates
            .iter()
            .map(FeeAlignmentCandidateDto::from)
            .collect(),
        fees: CaddieRankFeesDto::from(preview.fees),
        recent_changes: preview
            .recent_changes
            .into_iter()
            .map(|(recorded, name)| CaddieFeeChangeDto::new(recorded, name))
            .collect(),
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeeAlignmentItemRequest {
    pub caddie_profile_id: String,
    /// The fee the operator's screen showed. A caddie whose fee has changed
    /// since is not moved.
    pub expected_own_fee: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignCaddieFeesRequest {
    pub items: Vec<FeeAlignmentItemRequest>,
    /// Why these caddies are being moved, kept in the change log.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeeAlignmentResultDto {
    pub caddie_profile_id: String,
    /// `aligned`, `already_on_rank`, `own_fee_changed`, `not_found`,
    /// `rank_unpriced`, or `failed`.
    pub outcome: String,
    /// Field's message, for `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlignCaddieFeesResponse {
    pub results: Vec<FeeAlignmentResultDto>,
}

/// POST /v1/course/caddie-fee-alignment
#[utoipa::path(
    post,
    path = "/v1/course/caddie-fee-alignment",
    tag = "course-ops",
    request_body = AlignCaddieFeesRequest,
    responses(
        (status = 200, description = "What happened to each caddie", body = AlignCaddieFeesResponse),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden", body = ErrorBody),
        (status = 409, description = "The rank fees have not been saved", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn align_caddie_fees(
    State(state): State<AppState>,
    headers: HeaderMap,
    principal: Option<Extension<CallerPrincipal>>,
    Json(request): Json<AlignCaddieFeesRequest>,
) -> Result<Json<AlignCaddieFeesResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let items = request
        .items
        .into_iter()
        .map(|item| {
            Ok(FeeAlignmentItem {
                caddie_id: CaddieId::try_new(item.caddie_profile_id)?,
                expected_own_fee: item.expected_own_fee,
            })
        })
        .collect::<Result<Vec<_>, CourseError>>()
        .map_err(AppError::from)?;
    let request =
        FeeAlignmentRequest::try_new(items, request.note.as_deref()).map_err(AppError::from)?;
    let (changed_by, changed_by_name) = principal
        .map(|Extension(caller)| (caller.subject, caller.username))
        .unwrap_or_default();
    let results = AlignCaddieFeesToRankUseCase::new(
        ops_gateway(&state),
        caddie_rank_fee_gateway(&state),
        state.caddie_fee_changes(),
    )
    .execute(
        credentials,
        &request,
        changed_by.as_deref(),
        changed_by_name.as_deref(),
    )
    .await
    .map_err(AppError::from)?;
    Ok(Json(AlignCaddieFeesResponse {
        results: results
            .into_iter()
            .map(|result| FeeAlignmentResultDto {
                caddie_profile_id: result.caddie_id,
                outcome: result.outcome.as_str().to_string(),
                message: match result.outcome {
                    FeeAlignmentOutcome::Failed(message) => Some(message),
                    _ => None,
                },
            })
            .collect(),
    }))
}
