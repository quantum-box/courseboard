//! CourseBoard's own storage for the golf-specific keys of a reservation
//! product: play type, hole count, players per group, and which courses the
//! plan is sold on.
//!
//! The generic product shape stays in Field's extension config until Field's
//! product table exists (PLT-3855); these four keys are the part Field never
//! reads, so they are golf domain data that only rode along (ADR-0009).
//! Transitional contract: every product save writes this table *and* the same
//! keys into the config, and reads prefer this table — so a revert loses
//! nothing, and the config copy can stop being written once every product has
//! a row here.

use std::collections::HashMap;

use sqlx::{MySqlPool, Row};

use crate::course::domain::{CourseError, PlayType, ReservationProduct};

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

/// The golf keys of one product, as CourseBoard stores them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GolfProductSettings {
    pub play_type: PlayType,
    pub hole_count: i32,
    pub max_players_per_group: Option<i32>,
    /// Declared with no courses means "sold nowhere"; undeclared means
    /// unrestricted. The two must not collapse into each other.
    pub course_scope_declared: bool,
    pub golf_course_ids: Vec<String>,
}

impl GolfProductSettings {
    /// What to store after a save, taken from the product the config write
    /// actually persisted — never re-derived from the input, so this table
    /// can only ever mirror what Field stored.
    pub fn from_product(product: &ReservationProduct) -> Self {
        Self {
            play_type: product.play_type(),
            hole_count: product.hole_count().get(),
            max_players_per_group: product.max_players_per_group(),
            course_scope_declared: product.course_scope_declared(),
            golf_course_ids: product
                .golf_course_ids()
                .iter()
                .map(|course_id| course_id.as_str().to_string())
                .collect(),
        }
    }

    /// Rebuild the product with this table's golf keys, keeping the generic
    /// half (id, name, duration) from the config copy.
    pub fn apply_to(&self, product: &ReservationProduct) -> ReservationProduct {
        if self.course_scope_declared {
            ReservationProduct::reconstitute_with_course_ids(
                product.id().as_str().to_string(),
                product
                    .tenant_id()
                    .map(|tenant| tenant.as_str().to_string()),
                product.reservation_service_id().as_str().to_string(),
                product.display_name().map(str::to_string),
                self.play_type,
                self.hole_count,
                product.fallback_duration_minutes(),
                self.golf_course_ids.clone(),
                self.max_players_per_group,
            )
        } else {
            ReservationProduct::reconstitute(
                product.id().as_str().to_string(),
                product
                    .tenant_id()
                    .map(|tenant| tenant.as_str().to_string()),
                product.reservation_service_id().as_str().to_string(),
                product.display_name().map(str::to_string),
                self.play_type,
                self.hole_count,
                product.fallback_duration_minutes(),
                None,
                self.max_players_per_group,
            )
        }
    }
}

pub struct MySqlGolfProductSettingsRepository {
    pool: MySqlPool,
}

impl MySqlGolfProductSettingsRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    /// Every stored product's golf keys, keyed by reservation service id.
    pub async fn get_all(
        &self,
        tenant_id: &str,
    ) -> Result<HashMap<String, GolfProductSettings>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT reservation_service_id, play_type, hole_count,
                   max_players_per_group, course_scope_declared
            FROM golf_product_settings
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;
        let mut settings: HashMap<String, GolfProductSettings> = HashMap::with_capacity(rows.len());
        for row in &rows {
            let service_id: String = row.try_get("reservation_service_id").map_err(provider)?;
            let play_type: String = row.try_get("play_type").map_err(provider)?;
            settings.insert(
                service_id,
                GolfProductSettings {
                    play_type: PlayType::parse(&play_type),
                    hole_count: row.try_get("hole_count").map_err(provider)?,
                    max_players_per_group: row
                        .try_get("max_players_per_group")
                        .map_err(provider)?,
                    course_scope_declared: row
                        .try_get("course_scope_declared")
                        .map_err(provider)?,
                    golf_course_ids: Vec::new(),
                },
            );
        }

        let course_rows = sqlx::query(
            r#"
            SELECT reservation_service_id, golf_course_id
            FROM golf_product_courses
            WHERE tenant_id = ?
            ORDER BY reservation_service_id, position
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;
        for row in &course_rows {
            let service_id: String = row.try_get("reservation_service_id").map_err(provider)?;
            let course_id: String = row.try_get("golf_course_id").map_err(provider)?;
            if let Some(entry) = settings.get_mut(&service_id) {
                entry.golf_course_ids.push(course_id);
            }
        }
        Ok(settings)
    }

    /// Replace one product's golf keys. Deletes name whole unique keys rather
    /// than ranging over the tenant, for the same TiDB deadlock reason as the
    /// course order.
    pub async fn replace(
        &self,
        tenant_id: &str,
        service_id: &str,
        settings: &GolfProductSettings,
    ) -> Result<(), CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;
        sqlx::query(
            r#"
            INSERT INTO golf_product_settings (
                tenant_id, reservation_service_id, play_type, hole_count,
                max_players_per_group, course_scope_declared
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                play_type = VALUES(play_type),
                hole_count = VALUES(hole_count),
                max_players_per_group = VALUES(max_players_per_group),
                course_scope_declared = VALUES(course_scope_declared),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(service_id)
        .bind(settings.play_type.as_str())
        .bind(settings.hole_count)
        .bind(settings.max_players_per_group)
        .bind(settings.course_scope_declared)
        .execute(&mut *tx)
        .await
        .map_err(provider)?;

        let existing = sqlx::query(
            r#"
            SELECT golf_course_id FROM golf_product_courses
            WHERE tenant_id = ? AND reservation_service_id = ?
            "#,
        )
        .bind(tenant_id)
        .bind(service_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(provider)?;
        for row in &existing {
            let course_id: String = row.try_get("golf_course_id").map_err(provider)?;
            if !settings.golf_course_ids.contains(&course_id) {
                sqlx::query(
                    r#"
                    DELETE FROM golf_product_courses
                    WHERE tenant_id = ? AND reservation_service_id = ? AND golf_course_id = ?
                    "#,
                )
                .bind(tenant_id)
                .bind(service_id)
                .bind(&course_id)
                .execute(&mut *tx)
                .await
                .map_err(provider)?;
            }
        }
        for (position, course_id) in settings.golf_course_ids.iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO golf_product_courses (
                    tenant_id, reservation_service_id, position, golf_course_id
                )
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    position = VALUES(position),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(service_id)
            .bind(position as i32)
            .bind(course_id)
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn settings(play_type: PlayType, declared: bool, courses: &[&str]) -> GolfProductSettings {
        GolfProductSettings {
            play_type,
            hole_count: 18,
            max_players_per_group: Some(4),
            course_scope_declared: declared,
            golf_course_ids: courses.iter().map(|id| id.to_string()).collect(),
        }
    }

    async fn repository() -> MySqlGolfProductSettingsRepository {
        MySqlGolfProductSettingsRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn golf_keys_round_trip_per_product() {
        let repository = repository().await;
        let tenant = test_tenant("product-settings-round-trip");
        repository
            .replace(
                &tenant,
                "plan-1",
                &settings(PlayType::Caddie, true, &["course-a", "course-b"]),
            )
            .await
            .unwrap();
        repository
            .replace(&tenant, "plan-2", &settings(PlayType::SelfPlay, false, &[]))
            .await
            .unwrap();

        let all = repository.get_all(&tenant).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all["plan-1"].play_type, PlayType::Caddie);
        assert_eq!(all["plan-1"].golf_course_ids, vec!["course-a", "course-b"]);
        assert!(all["plan-1"].course_scope_declared);
        assert!(!all["plan-2"].course_scope_declared);
        assert!(all["plan-2"].golf_course_ids.is_empty());
    }

    #[tokio::test]
    async fn narrowing_the_scope_drops_the_removed_course_row() {
        let repository = repository().await;
        let tenant = test_tenant("product-settings-narrow");
        repository
            .replace(
                &tenant,
                "plan-1",
                &settings(PlayType::SelfPlay, true, &["course-a", "course-b"]),
            )
            .await
            .unwrap();
        repository
            .replace(
                &tenant,
                "plan-1",
                &settings(PlayType::SelfPlay, true, &["course-b"]),
            )
            .await
            .unwrap();

        let all = repository.get_all(&tenant).await.unwrap();
        assert_eq!(all["plan-1"].golf_course_ids, vec!["course-b"]);
    }

    #[tokio::test]
    async fn declared_with_no_courses_survives_as_sold_nowhere() {
        let repository = repository().await;
        let tenant = test_tenant("product-settings-nowhere");
        repository
            .replace(&tenant, "plan-1", &settings(PlayType::SelfPlay, true, &[]))
            .await
            .unwrap();

        let all = repository.get_all(&tenant).await.unwrap();
        // Declared + zero rows is a deliberate "sold nowhere", not "sold
        // everywhere" — losing the flag would invert the meaning.
        assert!(all["plan-1"].course_scope_declared);
        assert!(all["plan-1"].golf_course_ids.is_empty());
    }

    #[tokio::test]
    async fn one_tenants_products_are_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("product-settings-ours");
        let theirs = test_tenant("product-settings-theirs");
        repository
            .replace(&ours, "plan-1", &settings(PlayType::SelfPlay, false, &[]))
            .await
            .unwrap();

        assert!(repository.get_all(&theirs).await.unwrap().is_empty());
        assert_eq!(repository.get_all(&ours).await.unwrap().len(), 1);
    }

    #[test]
    fn apply_to_overrides_golf_keys_and_keeps_the_generic_half() {
        let config_product = ReservationProduct::reconstitute(
            "plan-1",
            None,
            "plan-1",
            Some("平日セルフ".to_string()),
            PlayType::SelfPlay,
            18,
            240,
            None,
            None,
        );
        let local = settings(PlayType::Caddie, true, &["course-a"]);

        let merged = local.apply_to(&config_product);

        assert_eq!(merged.play_type(), PlayType::Caddie);
        assert!(merged.course_scope_declared());
        assert_eq!(merged.golf_course_ids().len(), 1);
        assert_eq!(merged.display_name(), Some("平日セルフ"));
        assert_eq!(merged.fallback_duration_minutes(), 240);
        assert_eq!(merged.max_players_per_group(), Some(4));
    }

    #[test]
    fn from_product_then_apply_to_is_lossless_for_the_golf_half() {
        let product = ReservationProduct::reconstitute_with_course_ids(
            "plan-1",
            None,
            "plan-1",
            Some("キャディ付".to_string()),
            PlayType::Caddie,
            9,
            180,
            vec!["course-a".to_string(), "course-b".to_string()],
            Some(3),
        );

        let stored = GolfProductSettings::from_product(&product);
        let rebuilt = stored.apply_to(&product);

        assert_eq!(rebuilt, product);
    }
}
