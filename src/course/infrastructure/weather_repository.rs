use chrono::NaiveDate;
use sqlx::{MySqlPool, Row};

use crate::course::domain::weather::WeatherObservation;

pub struct MySqlWeatherRepository(pub MySqlPool);

impl MySqlWeatherRepository {
    pub async fn list(
        &self,
        tenant: &str,
        from: NaiveDate,
        to: NaiveDate,
        course: Option<&str>,
    ) -> Result<Vec<WeatherObservation>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT golf_course_id, observed_at, timezone, weather FROM golf_weather_observations \
             WHERE tenant_id = ? AND observed_at >= ? AND observed_at < ? \
             AND (? IS NULL OR golf_course_id = ?) ORDER BY observed_at DESC, golf_course_id",
        )
        .bind(tenant)
        .bind(from.and_hms_opt(0, 0, 0).unwrap())
        .bind(to.succ_opt().unwrap().and_hms_opt(0, 0, 0).unwrap())
        .bind(course)
        .bind(course)
        .fetch_all(&self.0)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(WeatherObservation {
                    golf_course_id: row.try_get("golf_course_id")?,
                    observed_at: row.try_get("observed_at")?,
                    timezone: row.try_get("timezone")?,
                    weather: row.try_get("weather")?,
                })
            })
            .collect()
    }

    pub async fn save(
        &self,
        tenant: &str,
        observation: &WeatherObservation,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO golf_weather_observations (tenant_id, golf_course_id, observed_at, timezone, weather) \
             VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE weather = VALUES(weather), \
             timezone = VALUES(timezone), updated_at = CURRENT_TIMESTAMP(6)",
        )
        .bind(tenant)
        .bind(&observation.golf_course_id)
        .bind(observation.observed_at)
        .bind(&observation.timezone)
        .bind(&observation.weather)
        .execute(&self.0)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    #[tokio::test]
    async fn observations_persist_upsert_and_stay_tenant_scoped() {
        let repo = MySqlWeatherRepository(test_pool().await);
        let tenant = test_tenant("weather");
        let date = NaiveDate::from_ymd_opt(2026, 11, 7).unwrap();
        let mut observation = WeatherObservation {
            golf_course_id: "east".into(),
            observed_at: date.and_hms_opt(9, 0, 0).unwrap(),
            timezone: "Asia/Tokyo".into(),
            weather: "sunny".into(),
        };
        repo.save(&tenant, &observation).await.unwrap();
        observation.weather = "rain".into();
        repo.save(&tenant, &observation).await.unwrap();
        let rows = repo.list(&tenant, date, date, Some("east")).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].weather, "rain");
        assert_eq!(rows[0].observed_at, observation.observed_at);
        assert!(repo
            .list(&tenant, date, date, Some("west"))
            .await
            .unwrap()
            .is_empty());
        assert!(repo
            .list(&test_tenant("weather-other"), date, date, None)
            .await
            .unwrap()
            .is_empty());
    }
}
