//! CourseBoard's own storage for the ledger board's column order.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_course_order`). The arrangement used to sit in
//! the golf extension's shared config object, where a save from the settings
//! screen could quietly undo one made from the board; and how a club likes its
//! courses ordered is not something Field has a column for (ADR-0009).

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{CourseError, CourseId, CourseOrder, CourseOrderGateway};

pub struct MySqlCourseOrderRepository {
    pool: MySqlPool,
}

impl MySqlCourseOrderRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl CourseOrderGateway for MySqlCourseOrderRepository {
    async fn get_course_order(&self, tenant_id: &str) -> Result<CourseOrder, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT golf_course_id
            FROM golf_course_order
            WHERE tenant_id = ?
            ORDER BY position
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut ids = Vec::with_capacity(rows.len());
        for row in &rows {
            let id: String = row.try_get("golf_course_id").map_err(provider)?;
            ids.push(CourseId::new(id));
        }
        Ok(CourseOrder::new(ids))
    }

    async fn replace_course_order(
        &self,
        tenant_id: &str,
        order: &CourseOrder,
    ) -> Result<CourseOrder, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;

        // Every write names the courses it touches, so both statements below
        // address whole unique keys. A blanket `WHERE tenant_id = ?` looked
        // tidier, but on TiDB it locks a range wide enough that two tenants
        // arranging their own boards at the same time deadlock each other.
        let existing =
            sqlx::query("SELECT golf_course_id FROM golf_course_order WHERE tenant_id = ?")
                .bind(tenant_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(provider)?;
        let mut dropped = Vec::new();
        for row in &existing {
            let id: String = row.try_get("golf_course_id").map_err(provider)?;
            if !order.ids().iter().any(|placed| placed.as_str() == id) {
                dropped.push(id);
            }
        }
        if !dropped.is_empty() {
            let placeholders = vec!["?"; dropped.len()].join(", ");
            let statement = format!(
                r#"
                DELETE FROM golf_course_order
                WHERE tenant_id = ?
                  AND golf_course_id IN ({placeholders})
                "#,
            );
            let mut query = sqlx::query(&statement).bind(tenant_id);
            for id in &dropped {
                query = query.bind(id);
            }
            query.execute(&mut *tx).await.map_err(provider)?;
        }

        // Upsert rather than delete-then-insert so a course that only moved
        // keeps its row. Positions are rewritten wholesale, which is why they
        // are not unique: reversing two courses passes through a moment where
        // both would claim the same one.
        for (position, course_id) in order.ids().iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO golf_course_order (tenant_id, golf_course_id, position)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    position = VALUES(position),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(course_id.as_str())
            .bind(position as i32)
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(order.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn order(ids: &[&str]) -> CourseOrder {
        CourseOrder::new(ids.iter().map(|id| CourseId::new(*id)))
    }

    async fn repository() -> MySqlCourseOrderRepository {
        MySqlCourseOrderRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn a_tenant_that_never_arranged_the_board_reads_back_empty() {
        let repository = repository().await;
        let tenant = test_tenant("course-order-unset");
        assert!(repository
            .get_course_order(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn the_arrangement_survives_the_round_trip_in_the_order_it_was_saved() {
        let repository = repository().await;
        let tenant = test_tenant("course-order-round-trip");
        repository
            .replace_course_order(&tenant, &order(&["course-c", "course-a", "course-b"]))
            .await
            .unwrap();

        let stored = repository.get_course_order(&tenant).await.unwrap();
        assert_eq!(
            stored.ids(),
            &[
                CourseId::new("course-c"),
                CourseId::new("course-a"),
                CourseId::new("course-b"),
            ]
        );
    }

    #[tokio::test]
    async fn rearranging_replaces_the_board_rather_than_stacking_a_second_one() {
        let repository = repository().await;
        let tenant = test_tenant("course-order-rearrange");
        repository
            .replace_course_order(&tenant, &order(&["course-a", "course-b"]))
            .await
            .unwrap();
        // Reversing reuses both positions and both course ids, so a save that
        // updated rather than replaced would have to get the order right on the
        // way through.
        repository
            .replace_course_order(&tenant, &order(&["course-b", "course-a"]))
            .await
            .unwrap();

        let stored = repository.get_course_order(&tenant).await.unwrap();
        assert_eq!(
            stored.ids(),
            &[CourseId::new("course-b"), CourseId::new("course-a")]
        );
    }

    #[tokio::test]
    async fn clearing_the_arrangement_leaves_nothing_behind() {
        let repository = repository().await;
        let tenant = test_tenant("course-order-clear");
        repository
            .replace_course_order(&tenant, &order(&["course-a"]))
            .await
            .unwrap();
        repository
            .replace_course_order(&tenant, &CourseOrder::default())
            .await
            .unwrap();
        assert!(repository
            .get_course_order(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn one_tenants_board_is_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("course-order-ours");
        let theirs = test_tenant("course-order-theirs");
        repository
            .replace_course_order(&ours, &order(&["course-a"]))
            .await
            .unwrap();

        assert!(repository
            .get_course_order(&theirs)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            repository.get_course_order(&ours).await.unwrap().ids(),
            &[CourseId::new("course-a")]
        );
    }
}
