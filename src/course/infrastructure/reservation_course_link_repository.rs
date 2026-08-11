//! CourseBoard's own store for which course a name in the booking system's
//! export refers to.
//!
//! Field's `golf_courses` carries no external identifier, and "what IC Green
//! calls this course" is the golf anti-corruption layer, so the answers live
//! here (ADR-0005) alongside the counts they let us place.

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CourseId, ReservationCourseLink, ReservationCourseLinkGateway,
};

pub struct MySqlReservationCourseLinkRepository {
    pool: MySqlPool,
}

impl MySqlReservationCourseLinkRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl ReservationCourseLinkGateway for MySqlReservationCourseLinkRepository {
    async fn list_course_links(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<ReservationCourseLink>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT sheet_label, golf_course_id
            FROM golf_reservation_course_links
            WHERE tenant_id = ?
            ORDER BY sheet_label
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.into_iter()
            .map(|row| {
                Ok(ReservationCourseLink {
                    sheet_label: row.try_get("sheet_label").map_err(provider)?,
                    course_id: row
                        .try_get::<Option<String>, _>("golf_course_id")
                        .map_err(provider)?
                        .map(CourseId::new),
                })
            })
            .collect()
    }

    async fn save_course_links(
        &self,
        tenant_id: &str,
        links: &[ReservationCourseLink],
        updated_by: Option<&str>,
    ) -> Result<Vec<ReservationCourseLink>, CourseError> {
        if links.is_empty() {
            return Ok(Vec::new());
        }
        // One transaction: the desk answers the whole list of names it was
        // shown, and half of those answers landing would leave the next import
        // asking again about names that were already decided.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for link in links {
            let label = link.sheet_label.trim();
            if label.is_empty() {
                return Err(CourseError::BadRequest(
                    "a course link needs the name the sheet uses",
                ));
            }
            sqlx::query(
                r#"
                INSERT INTO golf_reservation_course_links
                    (tenant_id, sheet_label, golf_course_id, updated_by)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    golf_course_id = VALUES(golf_course_id),
                    updated_by = VALUES(updated_by),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(label)
            .bind(link.course_id.as_ref().map(|id| id.as_str()))
            .bind(updated_by)
            .execute(&mut *transaction)
            .await
            .map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        self.list_course_links(tenant_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    async fn fresh(tenant: &str) -> (MySqlReservationCourseLinkRepository, String) {
        (
            MySqlReservationCourseLinkRepository::new(test_pool().await),
            test_tenant(tenant),
        )
    }

    fn link(label: &str, course_id: Option<&str>) -> ReservationCourseLink {
        ReservationCourseLink {
            sheet_label: label.to_string(),
            course_id: course_id.map(CourseId::new),
        }
    }

    #[tokio::test]
    async fn an_answer_survives_the_round_trip_so_the_next_month_needs_no_setup() {
        let (repository, tenant) = fresh("roundtrip").await;
        let answers = vec![
            link("真駒内", Some("course-a")),
            link("滝の", Some("course-b")),
        ];
        repository
            .save_course_links(&tenant, &answers, Some("desk@example.com"))
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, answers);
    }

    #[tokio::test]
    async fn leaving_a_course_out_is_stored_rather_than_left_absent() {
        // Absence means "nobody has looked at this name yet", which is a
        // different thing the import has to keep asking about.
        let (repository, tenant) = fresh("ignored").await;
        repository
            .save_course_links(&tenant, &[link("羊ケ丘", None)], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("羊ケ丘", None)]);
    }

    #[tokio::test]
    async fn changing_an_answer_replaces_it_rather_than_adding_a_second() {
        let (repository, tenant) = fresh("replace").await;
        repository
            .save_course_links(&tenant, &[link("真駒内", Some("course-old"))], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[link("真駒内", Some("course-new"))], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("真駒内", Some("course-new"))]);
    }

    #[tokio::test]
    async fn a_course_can_be_put_back_after_being_left_out() {
        let (repository, tenant) = fresh("restore").await;
        repository
            .save_course_links(&tenant, &[link("滝の", None)], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[link("滝の", Some("course-takino"))], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("滝の", Some("course-takino"))]);
    }

    #[tokio::test]
    async fn a_name_with_nothing_in_it_is_refused() {
        let (repository, tenant) = fresh("blank").await;
        assert!(repository
            .save_course_links(&tenant, &[link("   ", Some("course-a"))], None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn one_tenants_answers_are_invisible_to_another() {
        let (repository, tenant) = fresh("isolation-a").await;
        repository
            .save_course_links(&tenant, &[link("真駒内", Some("course-a"))], None)
            .await
            .unwrap();

        let stored = repository
            .list_course_links(&test_tenant("isolation-b"))
            .await
            .unwrap();
        assert!(stored.is_empty());
    }
}
