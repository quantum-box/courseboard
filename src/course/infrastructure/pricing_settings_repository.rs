//! CourseBoard's own storage for the course's pricing inputs.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_pricing_settings`). The prefecture and the grade
//! are the key into the golf course tax table, which already lives here — the
//! key was in Field's extension config while the table it opens was in this
//! database (ADR-0009).

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{CourseError, GolfPricingSettings, PricingSettingsGateway};

pub struct MySqlPricingSettingsRepository {
    pool: MySqlPool,
}

impl MySqlPricingSettingsRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn optional(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

#[async_trait]
impl PricingSettingsGateway for MySqlPricingSettingsRepository {
    async fn get_pricing_settings(
        &self,
        tenant_id: &str,
    ) -> Result<Option<GolfPricingSettings>, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT prefecture, tax_grade, taxable_ratio, price_elasticity,
                   fixed_cost_per_day, variable_cost_per_visitor
            FROM golf_pricing_settings
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        let Some(row) = row else {
            return Ok(None);
        };
        let prefecture: String = row.try_get("prefecture").map_err(provider)?;
        let tax_grade: String = row.try_get("tax_grade").map_err(provider)?;
        let taxable_ratio: f64 = row.try_get("taxable_ratio").map_err(provider)?;
        let price_elasticity: f64 = row.try_get("price_elasticity").map_err(provider)?;
        let fixed_cost: i64 = row.try_get("fixed_cost_per_day").map_err(provider)?;
        let variable: i64 = row.try_get("variable_cost_per_visitor").map_err(provider)?;
        // A hand-edited row that no longer passes the value object must not
        // take the pricing screen down; unreadable is treated as unset, and the
        // caller falls back the same way it does for a tenant with no row.
        Ok(GolfPricingSettings::try_new(
            optional(prefecture),
            optional(tax_grade),
            taxable_ratio,
            price_elasticity,
            fixed_cost,
            variable,
        )
        .ok())
    }

    async fn replace_pricing_settings(
        &self,
        tenant_id: &str,
        settings: &GolfPricingSettings,
    ) -> Result<GolfPricingSettings, CourseError> {
        sqlx::query(
            r#"
            INSERT INTO golf_pricing_settings
                (tenant_id, prefecture, tax_grade, taxable_ratio, price_elasticity,
                 fixed_cost_per_day, variable_cost_per_visitor)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                prefecture = VALUES(prefecture),
                tax_grade = VALUES(tax_grade),
                taxable_ratio = VALUES(taxable_ratio),
                price_elasticity = VALUES(price_elasticity),
                fixed_cost_per_day = VALUES(fixed_cost_per_day),
                variable_cost_per_visitor = VALUES(variable_cost_per_visitor),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(settings.prefecture.as_deref().unwrap_or(""))
        .bind(settings.tax_grade.as_deref().unwrap_or(""))
        .bind(settings.taxable_ratio)
        .bind(settings.price_elasticity)
        .bind(settings.fixed_cost)
        .bind(settings.variable_cost_per_visitor)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(settings.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlPricingSettingsRepository {
        MySqlPricingSettingsRepository::new(test_pool().await)
    }

    fn settings(prefecture: Option<&str>, grade: Option<&str>) -> GolfPricingSettings {
        GolfPricingSettings::try_new(
            prefecture.map(str::to_string),
            grade.map(str::to_string),
            0.9,
            -1.1,
            400_000,
            1_800,
        )
        .expect("settings")
    }

    #[tokio::test]
    async fn a_course_that_never_saved_reads_back_as_unset() {
        let repository = repository().await;
        let tenant = test_tenant("pricing-unset");
        // Not the defaults: unset is what sends the reader to the old config.
        assert!(repository
            .get_pricing_settings(&tenant)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn the_inputs_survive_the_round_trip() {
        let repository = repository().await;
        let tenant = test_tenant("pricing-round-trip");
        repository
            .replace_pricing_settings(&tenant, &settings(Some("hokkaido"), Some("7")))
            .await
            .unwrap();

        let stored = repository
            .get_pricing_settings(&tenant)
            .await
            .unwrap()
            .expect("saved");
        assert_eq!(stored.prefecture.as_deref(), Some("hokkaido"));
        assert_eq!(stored.tax_grade.as_deref(), Some("7"));
        assert_eq!(stored.taxable_ratio, 0.9);
        assert_eq!(stored.price_elasticity, -1.1);
        assert_eq!(stored.fixed_cost, 400_000);
        assert_eq!(stored.variable_cost_per_visitor, 1_800);
    }

    #[tokio::test]
    async fn a_save_with_no_prefecture_still_counts_as_saved() {
        // The operator can deliberately leave the prefecture open; that choice
        // must not send the reader back to the config they migrated off.
        let repository = repository().await;
        let tenant = test_tenant("pricing-no-prefecture");
        repository
            .replace_pricing_settings(&tenant, &settings(None, None))
            .await
            .unwrap();

        let stored = repository
            .get_pricing_settings(&tenant)
            .await
            .unwrap()
            .expect("saved");
        assert_eq!(stored.prefecture, None);
        assert_eq!(stored.taxable_ratio, 0.9);
    }

    #[tokio::test]
    async fn resaving_replaces_the_inputs_rather_than_adding_a_second_set() {
        let repository = repository().await;
        let tenant = test_tenant("pricing-resave");
        repository
            .replace_pricing_settings(&tenant, &settings(Some("hokkaido"), None))
            .await
            .unwrap();
        repository
            .replace_pricing_settings(&tenant, &settings(Some("hokkaido"), Some("11")))
            .await
            .unwrap();

        let stored = repository
            .get_pricing_settings(&tenant)
            .await
            .unwrap()
            .expect("saved");
        assert_eq!(stored.tax_grade.as_deref(), Some("11"));
    }

    #[tokio::test]
    async fn one_courses_inputs_are_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("pricing-ours");
        let theirs = test_tenant("pricing-theirs");
        repository
            .replace_pricing_settings(&ours, &settings(Some("hokkaido"), None))
            .await
            .unwrap();

        assert!(repository
            .get_pricing_settings(&theirs)
            .await
            .unwrap()
            .is_none());
    }
}
