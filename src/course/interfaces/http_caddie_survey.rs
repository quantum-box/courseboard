//! Axum handlers for `/v1/course/caddie-survey`.
//!
//! The roster's survey tab: where the club's caddie survey stands, make it,
//! and bring its caddie list back in step with the roster. The form lives in
//! Field Forms; answers become caddie ratings there.
//!
//! Handlers stay thin: parse request → call use case → map domain → response DTO.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::http::credentials;
use super::openapi::ErrorBody;

use crate::course::domain::CaddieSurveyStatus;
use crate::course::infrastructure::FieldCaddieSurveyGateway;
use crate::course::usecase::{
    CreateCaddieSurveyUseCase, GetCaddieSurveyUseCase, RefreshCaddieSurveyUseCase,
};
use crate::{AppError, AppState};

fn survey_gateway(state: &AppState) -> Arc<FieldCaddieSurveyGateway> {
    Arc::new(FieldCaddieSurveyGateway::new(
        state.http_client.clone(),
        state.cancellation_fee_config.field_api_url.as_deref(),
    ))
}

/// Where the club's caddie survey stands.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieSurveyResponse {
    /// `formsUnavailable` (Field Forms is not in the tenant's plan),
    /// `noCaddies` (no active caddie to list), `notCreated`, or `ready`.
    pub state: String,
    /// Active caddies the survey would list if it were (re)built now.
    pub caddie_count: usize,
    /// Present when `state` is `ready`.
    pub form: Option<CaddieSurveyFormDto>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaddieSurveyFormDto {
    pub id: String,
    pub public_id: String,
    /// Field's form status: `draft` / `published` / `paused` / `archived`.
    pub status: String,
    pub has_unpublished_changes: bool,
    /// The answer page a guest opens from the QR.
    pub public_url: String,
    /// Caddies the published survey lists.
    pub published_caddie_count: usize,
    /// The published list no longer matches the roster.
    pub caddies_changed: bool,
}

impl From<CaddieSurveyStatus> for CaddieSurveyResponse {
    fn from(value: CaddieSurveyStatus) -> Self {
        match value {
            CaddieSurveyStatus::FormsUnavailable => Self {
                state: "formsUnavailable".into(),
                caddie_count: 0,
                form: None,
            },
            CaddieSurveyStatus::NoCaddies => Self {
                state: "noCaddies".into(),
                caddie_count: 0,
                form: None,
            },
            CaddieSurveyStatus::NotCreated { caddie_count } => Self {
                state: "notCreated".into(),
                caddie_count,
                form: None,
            },
            CaddieSurveyStatus::Ready(overview) => Self {
                state: "ready".into(),
                caddie_count: overview.current_caddie_count,
                form: Some(CaddieSurveyFormDto {
                    published_caddie_count: overview.form.published_caddies.len(),
                    id: overview.form.id,
                    public_id: overview.form.public_id,
                    status: overview.form.status,
                    has_unpublished_changes: overview.form.has_unpublished_changes,
                    public_url: overview.public_url,
                    caddies_changed: overview.caddies_changed,
                }),
            },
        }
    }
}

/// GET /v1/course/caddie-survey
#[utoipa::path(
    get,
    path = "/v1/course/caddie-survey",
    tag = "course-ops",
    responses(
        (status = 200, description = "Where the caddie survey stands", body = CaddieSurveyResponse),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_caddie_survey(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CaddieSurveyResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let status = GetCaddieSurveyUseCase::new(survey_gateway(&state))
        .execute(credentials)
        .await?;
    Ok(Json(status.into()))
}

/// POST /v1/course/caddie-survey
#[utoipa::path(
    post,
    path = "/v1/course/caddie-survey",
    tag = "course-ops",
    responses(
        (status = 200, description = "The survey, made and published (or the one already made)", body = CaddieSurveyResponse),
        (status = 400, description = "No active caddie to list", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden, or Field Forms is not in the tenant's plan", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create_caddie_survey(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CaddieSurveyResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let status = CreateCaddieSurveyUseCase::new(survey_gateway(&state))
        .execute(credentials)
        .await?;
    Ok(Json(status.into()))
}

/// POST /v1/course/caddie-survey/refresh
#[utoipa::path(
    post,
    path = "/v1/course/caddie-survey/refresh",
    tag = "course-ops",
    responses(
        (status = 200, description = "The survey with the current caddies, published again", body = CaddieSurveyResponse),
        (status = 400, description = "No active caddie to list", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Forbidden", body = ErrorBody),
        (status = 404, description = "The survey has not been made yet", body = ErrorBody),
        (status = 409, description = "The form was edited in Field meanwhile; try again", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn refresh_caddie_survey(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CaddieSurveyResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    let status = RefreshCaddieSurveyUseCase::new(survey_gateway(&state))
        .execute(credentials)
        .await?;
    Ok(Json(status.into()))
}
