use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use super::http::{catalog_gateway, credentials, ItemsResponse};
use crate::course::domain::{
    actions,
    weather::{valid_weather, WeatherObservation},
    GolfCatalogGateway,
};
use crate::course::infrastructure::MySqlWeatherRepository;
use crate::{AppError, AppState};

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct WeatherQuery {
    from: NaiveDate,
    to: NaiveDate,
    golf_course_id: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveWeatherRequest {
    golf_course_id: String,
    observed_at: NaiveDateTime,
    weather: String,
}

#[utoipa::path(get, path = "/v1/course/weather-observations", params(WeatherQuery),
    responses((status = 200, body = inline(ItemsResponse<WeatherObservation>))), security(("bearer_auth" = [])))]
pub async fn list_weather(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<WeatherQuery>,
) -> Result<Json<ItemsResponse<WeatherObservation>>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials.require(actions::LIST_BUDGETS).await?;
    if query.to < query.from
        || (query.to - query.from).num_days() > 366
        || query.to.succ_opt().is_none()
    {
        return Err(AppError::BadRequest(
            "invalid observation date range (maximum 367 days)",
        ));
    }
    let items = MySqlWeatherRepository(state.common_import_pool.clone())
        .list(
            credentials.operator_id,
            query.from,
            query.to,
            query.golf_course_id.as_deref(),
        )
        .await?;
    Ok(Json(ItemsResponse { items }))
}

#[utoipa::path(post, path = "/v1/course/weather-observations", request_body = SaveWeatherRequest,
    responses((status = 200, body = WeatherObservation)), security(("bearer_auth" = [])))]
pub async fn save_weather(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveWeatherRequest>,
) -> Result<Json<WeatherObservation>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials.require(actions::MANAGE_BUDGETS).await?;
    if !valid_weather(&body.weather)
        || body.observed_at.year() < 1000
        || body.observed_at.year() > 9999
        || body.observed_at.second() != 0
        || body.observed_at.nanosecond() != 0
    {
        return Err(AppError::BadRequest("invalid weather observation"));
    }
    let catalog = catalog_gateway(&state);
    let courses = catalog.list_courses(credentials).await?;
    if !courses
        .iter()
        .any(|course| course.id().as_str() == body.golf_course_id)
    {
        return Err(AppError::BadRequest("unknown golf course"));
    }
    let observation = WeatherObservation {
        golf_course_id: body.golf_course_id,
        observed_at: body.observed_at,
        timezone: catalog.get_tenant_timezone(credentials).await?,
        weather: body.weather,
    };
    MySqlWeatherRepository(state.common_import_pool.clone())
        .save(credentials.operator_id, &observation)
        .await?;
    Ok(Json(observation))
}
