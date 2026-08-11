//! CourseBoard's own store for which course a name in the booking system's
//! export refers to.
//!
//! Field's `golf_courses` carries no external identifier, and "what IC Green
//! calls this course" is the golf anti-corruption layer, so the answers live
//! here (ADR-0005) alongside the counts they let us place.

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    normalize_course_label, CourseDecision, CourseError, CourseId, ReservationCourseAnswer,
    ReservationCourseLink, ReservationCourseLinkGateway,
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
        answers: &[ReservationCourseAnswer],
        updated_by: Option<&str>,
    ) -> Result<Vec<ReservationCourseLink>, CourseError> {
        if answers.is_empty() {
            return Ok(Vec::new());
        }
        for answer in answers {
            if answer.sheet_label.trim().is_empty() {
                return Err(CourseError::BadRequest(
                    "a course link needs the name the sheet uses",
                ));
            }
        }
        // One answer per question, where the question is the normalized name.
        //
        // The import decides two names are the same one by normalizing them, so
        // `東 コース` and `東コース` are two spellings of a single question. The
        // unique key cannot see that — it compares the raw text — so storing
        // both would leave the import reading whichever sorted first. A request
        // carrying both spellings keeps the last, which is the same rule that
        // makes a new spelling supersede an old one across saves.
        let mut kept: Vec<&ReservationCourseAnswer> = Vec::new();
        for answer in answers {
            let key = normalize_course_label(answer.sheet_label.trim());
            match kept
                .iter()
                .position(|seen| normalize_course_label(seen.sheet_label.trim()) == key)
            {
                Some(at) => kept[at] = answer,
                None => kept.push(answer),
            }
        }

        // Rows to clear: every name being taken back, plus any answer on file
        // whose name means the same as one being saved but is spelled
        // differently. Clearing the old spelling is what makes the new answer
        // stick.
        let existing = self.list_course_links(tenant_id).await?;
        let mut clear: Vec<String> = existing
            .iter()
            .map(|link| link.sheet_label.clone())
            .filter(|stored| {
                let stored_key = normalize_course_label(stored);
                kept.iter().any(|answer| {
                    answer.sheet_label.trim() != stored
                        && normalize_course_label(answer.sheet_label.trim()) == stored_key
                })
            })
            .collect();
        // Taking an answer back removes the row, which is how the import reads
        // "nobody has looked at this name yet". Storing NULL instead would say
        // "leave this course out" — the answer the desk is trying to undo.
        for answer in &kept {
            if answer.decision == CourseDecision::Undecided {
                clear.push(answer.sheet_label.trim().to_string());
            }
        }

        // One transaction: the desk answers the whole list of names it was
        // shown, and half of those answers landing would leave the next import
        // asking again about names that were already decided.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for stale in &clear {
            sqlx::query(
                r#"
                DELETE FROM golf_reservation_course_links
                WHERE tenant_id = ? AND sheet_label = ?
                "#,
            )
            .bind(tenant_id)
            .bind(stale)
            .execute(&mut *transaction)
            .await
            .map_err(provider)?;
        }
        for answer in &kept {
            let course_id = match &answer.decision {
                CourseDecision::Course(id) => Some(id.as_str()),
                CourseDecision::DoNotImport => None,
                CourseDecision::Undecided => continue,
            };
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
            .bind(answer.sheet_label.trim())
            .bind(course_id)
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

    /// The desk answering with a course, or with "leave this one out".
    fn answer(label: &str, course_id: Option<&str>) -> ReservationCourseAnswer {
        ReservationCourseAnswer {
            sheet_label: label.to_string(),
            decision: match course_id {
                Some(id) => CourseDecision::Course(CourseId::new(id)),
                None => CourseDecision::DoNotImport,
            },
        }
    }

    /// The desk taking its answer back.
    fn undecided(label: &str) -> ReservationCourseAnswer {
        ReservationCourseAnswer {
            sheet_label: label.to_string(),
            decision: CourseDecision::Undecided,
        }
    }

    #[tokio::test]
    async fn an_answer_survives_the_round_trip_so_the_next_month_needs_no_setup() {
        let (repository, tenant) = fresh("roundtrip").await;
        let answers = vec![
            answer("真駒内", Some("course-a")),
            answer("滝の", Some("course-b")),
        ];
        repository
            .save_course_links(&tenant, &answers, Some("desk@example.com"))
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(
            stored,
            vec![
                link("真駒内", Some("course-a")),
                link("滝の", Some("course-b"))
            ]
        );
    }

    #[tokio::test]
    async fn leaving_a_course_out_is_stored_rather_than_left_absent() {
        // Absence means "nobody has looked at this name yet", which is a
        // different thing the import has to keep asking about.
        let (repository, tenant) = fresh("ignored").await;
        repository
            .save_course_links(&tenant, &[answer("羊ケ丘", None)], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("羊ケ丘", None)]);
    }

    #[tokio::test]
    async fn changing_an_answer_replaces_it_rather_than_adding_a_second() {
        let (repository, tenant) = fresh("replace").await;
        repository
            .save_course_links(&tenant, &[answer("真駒内", Some("course-old"))], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[answer("真駒内", Some("course-new"))], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("真駒内", Some("course-new"))]);
    }

    #[tokio::test]
    async fn a_course_can_be_put_back_after_being_left_out() {
        let (repository, tenant) = fresh("restore").await;
        repository
            .save_course_links(&tenant, &[answer("滝の", None)], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[answer("滝の", Some("course-takino"))], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("滝の", Some("course-takino"))]);
    }

    #[tokio::test]
    async fn taking_an_answer_back_leaves_the_name_unanswered_rather_than_excluded() {
        // The desk pointed 真駒内 at the wrong course and wants to think again.
        // Storing "do not import" instead would silence the very question it
        // needs asked, and the mistake would look like a decision.
        let (repository, tenant) = fresh("undo").await;
        repository
            .save_course_links(&tenant, &[answer("真駒内", Some("course-wrong"))], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[undecided("真駒内")], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert!(stored.is_empty());
    }

    #[tokio::test]
    async fn an_exclusion_can_be_taken_back_too() {
        let (repository, tenant) = fresh("undo-ignore").await;
        repository
            .save_course_links(&tenant, &[answer("羊ケ丘", None)], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[undecided("羊ケ丘")], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert!(stored.is_empty());
    }

    #[tokio::test]
    async fn taking_one_answer_back_leaves_the_others_alone() {
        // The screen saves every name it showed at once, so a single undo
        // arrives alongside the answers that are not changing.
        let (repository, tenant) = fresh("undo-one").await;
        repository
            .save_course_links(
                &tenant,
                &[
                    answer("真駒内", Some("course-a")),
                    answer("滝の", Some("course-b")),
                ],
                None,
            )
            .await
            .unwrap();
        repository
            .save_course_links(
                &tenant,
                &[undecided("真駒内"), answer("滝の", Some("course-b"))],
                None,
            )
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("滝の", Some("course-b"))]);
    }

    #[tokio::test]
    async fn re_answering_a_name_that_only_respaced_replaces_the_old_answer() {
        // The import treats `東 コース` and `東コース` as the same name. Left in
        // place, the old spelling would keep answering for the new one — and
        // whichever sorted first would decide, which is nobody's intent.
        let (repository, tenant) = fresh("respaced").await;
        repository
            .save_course_links(&tenant, &[answer("東 コース", Some("course-old"))], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[answer("東コース", Some("course-new"))], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("東コース", Some("course-new"))]);
    }

    #[tokio::test]
    async fn one_save_carrying_two_spellings_of_one_name_stores_a_single_answer() {
        // The import reads `東 コース` and `東コース` as one question. Storing an
        // answer for each would leave it reading whichever sorted first, which
        // is nobody's choice.
        let (repository, tenant) = fresh("same-save").await;
        repository
            .save_course_links(
                &tenant,
                &[
                    answer("東 コース", Some("course-first")),
                    answer("東コース", Some("course-last")),
                ],
                None,
            )
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored, vec![link("東コース", Some("course-last"))]);
    }

    #[tokio::test]
    async fn a_name_that_means_something_else_is_left_alone() {
        let (repository, tenant) = fresh("distinct").await;
        repository
            .save_course_links(&tenant, &[answer("東コース", Some("course-east"))], None)
            .await
            .unwrap();
        repository
            .save_course_links(&tenant, &[answer("西コース", Some("course-west"))], None)
            .await
            .unwrap();

        let stored = repository.list_course_links(&tenant).await.unwrap();
        assert_eq!(stored.len(), 2);
    }

    #[tokio::test]
    async fn a_name_with_nothing_in_it_is_refused() {
        let (repository, tenant) = fresh("blank").await;
        assert!(repository
            .save_course_links(&tenant, &[answer("   ", Some("course-a"))], None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn one_tenants_answers_are_invisible_to_another() {
        let (repository, tenant) = fresh("isolation-a").await;
        repository
            .save_course_links(&tenant, &[answer("真駒内", Some("course-a"))], None)
            .await
            .unwrap();

        let stored = repository
            .list_course_links(&test_tenant("isolation-b"))
            .await
            .unwrap();
        assert!(stored.is_empty());
    }
}
