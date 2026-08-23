//! CourseBoard's own storage for the booking form's visitor categories.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_player_tag_options`). The list used to sit in
//! the extension config object other screens replace wholesale (ADR-0009).

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{CourseError, PlayerTagOptions, PlayerTagOptionsGateway};

pub struct MySqlPlayerTagOptionsRepository {
    pool: MySqlPool,
}

impl MySqlPlayerTagOptionsRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl PlayerTagOptionsGateway for MySqlPlayerTagOptionsRepository {
    async fn get_player_tag_options(
        &self,
        tenant_id: &str,
    ) -> Result<PlayerTagOptions, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT label
            FROM golf_player_tag_options
            WHERE tenant_id = ?
            ORDER BY position
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut labels = Vec::with_capacity(rows.len());
        for row in &rows {
            labels.push(row.try_get::<String, _>("label").map_err(provider)?);
        }
        Ok(PlayerTagOptions::reconstitute(labels))
    }

    async fn replace_player_tag_options(
        &self,
        tenant_id: &str,
        options: &PlayerTagOptions,
    ) -> Result<PlayerTagOptions, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;

        // Delete by named label and upsert the rest, exactly as the course
        // order does: a blanket per-tenant DELETE locks a range wide enough
        // that two tenants saving at once deadlock each other on TiDB.
        let existing = sqlx::query("SELECT label FROM golf_player_tag_options WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(provider)?;
        let mut dropped = Vec::new();
        for row in &existing {
            let label: String = row.try_get("label").map_err(provider)?;
            if !options.options().contains(&label) {
                dropped.push(label);
            }
        }
        if !dropped.is_empty() {
            let placeholders = vec!["?"; dropped.len()].join(", ");
            let statement = format!(
                r#"
                DELETE FROM golf_player_tag_options
                WHERE tenant_id = ?
                  AND label IN ({placeholders})
                "#,
            );
            let mut query = sqlx::query(&statement).bind(tenant_id);
            for label in &dropped {
                query = query.bind(label);
            }
            query.execute(&mut *tx).await.map_err(provider)?;
        }

        for (position, label) in options.options().iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO golf_player_tag_options (tenant_id, label, position)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    position = VALUES(position),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(label)
            .bind(position as i32)
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(options.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn tags(labels: &[&str]) -> PlayerTagOptions {
        PlayerTagOptions::try_new(labels.iter().map(|label| label.to_string()).collect())
            .expect("tags")
    }

    async fn repository() -> MySqlPlayerTagOptionsRepository {
        MySqlPlayerTagOptionsRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn a_club_that_never_saved_reads_back_empty() {
        let repository = repository().await;
        let tenant = test_tenant("player-tags-unset");
        assert!(repository
            .get_player_tag_options(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn the_list_survives_the_round_trip_in_the_order_it_was_arranged() {
        let repository = repository().await;
        let tenant = test_tenant("player-tags-round-trip");
        repository
            .replace_player_tag_options(&tenant, &tags(&["優待", "会員", "WEB"]))
            .await
            .unwrap();

        let stored = repository.get_player_tag_options(&tenant).await.unwrap();
        assert_eq!(stored.options(), ["優待", "会員", "WEB"]);
    }

    #[tokio::test]
    async fn rearranging_and_dropping_replaces_the_list_rather_than_stacking() {
        let repository = repository().await;
        let tenant = test_tenant("player-tags-rearrange");
        repository
            .replace_player_tag_options(&tenant, &tags(&["会員", "優待", "WEB"]))
            .await
            .unwrap();
        repository
            .replace_player_tag_options(&tenant, &tags(&["WEB", "会員"]))
            .await
            .unwrap();

        let stored = repository.get_player_tag_options(&tenant).await.unwrap();
        assert_eq!(stored.options(), ["WEB", "会員"]);
    }

    #[tokio::test]
    async fn one_clubs_vocabulary_is_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("player-tags-ours");
        let theirs = test_tenant("player-tags-theirs");
        repository
            .replace_player_tag_options(&ours, &tags(&["会員"]))
            .await
            .unwrap();

        assert!(repository
            .get_player_tag_options(&theirs)
            .await
            .unwrap()
            .is_empty());
    }
}
