//! CourseBoard's own record of how far each course has been built.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_generated_through`). Field generates the
//! inventory but reports only counts, so there is nowhere upstream for the
//! watermark to live; see ADR-0005.

use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{CourseError, CourseId, GeneratedThroughGateway, InventoryWatermark};

pub struct MySqlGeneratedThroughRepository {
    pool: MySqlPool,
}

impl MySqlGeneratedThroughRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl GeneratedThroughGateway for MySqlGeneratedThroughRepository {
    async fn list_watermarks(
        &self,
        tenant_id: &str,
    ) -> Result<HashMap<CourseId, InventoryWatermark>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT golf_course_id, generated_through, checked_on
            FROM golf_generated_through
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut watermarks = HashMap::with_capacity(rows.len());
        for row in rows {
            let course_id: String = row.try_get("golf_course_id").map_err(provider)?;
            watermarks.insert(
                CourseId::new(course_id),
                InventoryWatermark {
                    generated_through: row.try_get("generated_through").map_err(provider)?,
                    checked_on: row.try_get("checked_on").map_err(provider)?,
                },
            );
        }
        Ok(watermarks)
    }

    async fn set_watermark(
        &self,
        tenant_id: &str,
        course_id: &CourseId,
        watermark: InventoryWatermark,
    ) -> Result<(), CourseError> {
        sqlx::query(
            r#"
            INSERT INTO golf_generated_through
                (tenant_id, golf_course_id, generated_through, checked_on)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                generated_through = VALUES(generated_through),
                checked_on = VALUES(checked_on),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(course_id.as_str())
        .bind(watermark.generated_through)
        .bind(watermark.checked_on)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};
    use chrono::NaiveDate;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid date")
    }

    fn watermark(generated_through: &str, checked_on: &str) -> InventoryWatermark {
        InventoryWatermark {
            generated_through: date(generated_through),
            checked_on: date(checked_on),
        }
    }

    #[tokio::test]
    async fn a_watermark_survives_the_round_trip_and_moves_rather_than_stacking() {
        let repository = MySqlGeneratedThroughRepository::new(test_pool().await);
        let tenant = test_tenant("generated-through-roundtrip");
        let course = CourseId::new("course_east");

        repository
            .set_watermark(&tenant, &course, watermark("2026-09-01", "2026-07-18"))
            .await
            .unwrap();
        assert_eq!(
            repository.list_watermarks(&tenant).await.unwrap(),
            HashMap::from([(course.clone(), watermark("2026-09-01", "2026-07-18"))]),
        );

        // A later top-up moves the same row rather than adding a second.
        repository
            .set_watermark(&tenant, &course, watermark("2026-09-02", "2026-07-19"))
            .await
            .unwrap();
        assert_eq!(
            repository.list_watermarks(&tenant).await.unwrap(),
            HashMap::from([(course, watermark("2026-09-02", "2026-07-19"))]),
        );
    }

    #[tokio::test]
    async fn a_course_that_was_never_built_is_absent_rather_than_dated() {
        let repository = MySqlGeneratedThroughRepository::new(test_pool().await);
        let tenant = test_tenant("generated-through-absent");
        repository
            .set_watermark(
                &tenant,
                &CourseId::new("course_east"),
                watermark("2026-09-01", "2026-07-18"),
            )
            .await
            .unwrap();

        let stored = repository.list_watermarks(&tenant).await.unwrap();
        assert!(!stored.contains_key(&CourseId::new("course_west")));
    }
}
