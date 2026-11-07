use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{Datelike, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
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

/// Accept the original single observation or an atomic morning/afternoon pair.
#[derive(Deserialize, ToSchema)]
#[serde(untagged)]
pub enum SaveWeatherBody {
    Single(SaveWeatherRequest),
    Batch { items: Vec<SaveWeatherRequest> },
}

#[derive(Serialize, ToSchema)]
#[serde(untagged)]
pub enum SaveWeatherResponse {
    Single(WeatherObservation),
    Batch { items: Vec<WeatherObservation> },
}

impl SaveWeatherBody {
    fn validate(&self) -> Result<&[SaveWeatherRequest], AppError> {
        let items = match self {
            Self::Single(item) => std::slice::from_ref(item),
            Self::Batch { items } => items.as_slice(),
        };
        if items.is_empty() || items.len() > 2 {
            return Err(AppError::BadRequest("save one or two weather observations"));
        }
        for item in items {
            if !valid_weather(&item.weather)
                || item.observed_at.year() < 1000
                || item.observed_at.year() > 9999
                || item.observed_at.second() != 0
                || item.observed_at.nanosecond() != 0
            {
                return Err(AppError::BadRequest("invalid weather observation"));
            }
        }
        if items.len() == 2
            && items[0].golf_course_id == items[1].golf_course_id
            && items[0].observed_at == items[1].observed_at
        {
            return Err(AppError::BadRequest("duplicate weather observation"));
        }
        Ok(items)
    }
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

#[utoipa::path(post, path = "/v1/course/weather-observations", request_body = SaveWeatherBody,
    responses((status = 200, body = SaveWeatherResponse)), security(("bearer_auth" = [])))]
pub async fn save_weather(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveWeatherBody>,
) -> Result<Json<SaveWeatherResponse>, AppError> {
    let credentials = credentials(&state, &headers)?;
    credentials.require(actions::MANAGE_BUDGETS).await?;
    let items = body.validate()?;
    let catalog = catalog_gateway(&state);
    let courses = catalog.list_courses(credentials).await?;
    if items.iter().any(|item| {
        !courses
            .iter()
            .any(|course| course.id().as_str() == item.golf_course_id)
    }) {
        return Err(AppError::BadRequest("unknown golf course"));
    }
    let timezone = catalog.get_tenant_timezone(credentials).await?;
    let mut observations: Vec<_> = items
        .iter()
        .map(|item| WeatherObservation {
            golf_course_id: item.golf_course_id.clone(),
            observed_at: item.observed_at,
            timezone: timezone.clone(),
            weather: item.weather.clone(),
        })
        .collect();
    MySqlWeatherRepository(state.common_import_pool.clone())
        .save_all(credentials.operator_id, &observations)
        .await?;
    let response = match body {
        SaveWeatherBody::Single(_) => SaveWeatherResponse::Single(observations.remove(0)),
        SaveWeatherBody::Batch { .. } => SaveWeatherResponse::Batch {
            items: observations,
        },
    };
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn observation(time: &str, weather: &str) -> serde_json::Value {
        json!({ "golfCourseId": "east", "observedAt": time, "weather": weather })
    }

    #[test]
    fn accepts_legacy_observations_and_a_morning_afternoon_pair() {
        let morning = observation("2026-11-07T09:00:00", "sunny");
        let afternoon = observation("2026-11-07T15:00:00", "rain");
        let single: SaveWeatherBody = serde_json::from_value(morning.clone()).unwrap();
        assert!(matches!(single, SaveWeatherBody::Single(_)));
        assert_eq!(single.validate().unwrap().len(), 1);
        let batch: SaveWeatherBody =
            serde_json::from_value(json!({"items": [morning, afternoon]})).unwrap();
        assert_eq!(batch.validate().unwrap().len(), 2);
    }

    #[test]
    fn rejects_invalid_batches_before_saving_any_observation() {
        let morning = observation("2026-11-07T09:00:00", "sunny");
        for items in [
            json!([]),
            json!([morning, morning]),
            json!([morning, observation("2026-11-07T15:00:00", "invalid")]),
            json!([morning, morning, morning]),
        ] {
            let body: SaveWeatherBody = serde_json::from_value(json!({ "items": items })).unwrap();
            assert!(body.validate().is_err());
        }
    }
}
