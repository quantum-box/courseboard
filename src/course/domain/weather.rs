use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// An observation in the tenant's local time, with its timezone retained.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WeatherObservation {
    pub golf_course_id: String,
    pub observed_at: NaiveDateTime,
    pub timezone: String,
    pub weather: String,
}

pub fn valid_weather(weather: &str) -> bool {
    matches!(weather, "sunny" | "cloudy" | "rain" | "snow" | "other")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_supported_weather_is_accepted() {
        for weather in ["sunny", "cloudy", "rain", "snow", "other"] {
            assert!(valid_weather(weather));
        }
        assert!(!valid_weather(""));
        assert!(!valid_weather("storm"));
    }
}
