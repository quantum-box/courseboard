//! CourseBoard's own storage for desk marks on individual tee times.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_slot_overrides`). Field generates tee-time
//! inventory but has no write API for one slot, so "closed on this Saturday
//! only" has nowhere upstream to live; see ADR-0005.

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CourseId, DeleteSlotOverrides, SlotOverride, SlotOverrideGateway,
    SlotOverrideKind, SlotOverrideQuery,
};

pub struct MySqlSlotOverrideRepository {
    pool: MySqlPool,
}

impl MySqlSlotOverrideRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

/// `HH:MM`, trimming the seconds a caller may send.
///
/// The column is `CHAR(5)` — the tee time is the label of a ledger row, not a
/// duration — but Field's slot rows carry `HH:MM:SS`, and an operator clearing
/// a mark should not have to know which of the two the board handed them.
fn clock(value: &str) -> String {
    value.chars().take(5).collect()
}

#[async_trait]
impl SlotOverrideGateway for MySqlSlotOverrideRepository {
    async fn list_slot_overrides(
        &self,
        tenant_id: &str,
        query: &SlotOverrideQuery,
    ) -> Result<Vec<SlotOverride>, CourseError> {
        // An empty course list means every course, so the filter clause is
        // dropped rather than turned into `IN ()` — which is a syntax error in
        // MySQL and would answer "no marks anywhere" if it were not.
        let course_filter = if query.course_ids.is_empty() {
            String::new()
        } else {
            let placeholders = vec!["?"; query.course_ids.len()].join(", ");
            format!("AND golf_course_id IN ({placeholders})")
        };
        let statement = format!(
            r#"
            SELECT golf_course_id, slot_date, tee_time, kind, label, note
            FROM golf_slot_overrides
            WHERE tenant_id = ?
              AND slot_date = ?
              {course_filter}
            ORDER BY golf_course_id, tee_time
            "#,
        );
        let mut statement = sqlx::query(&statement).bind(tenant_id).bind(query.date);
        for course_id in &query.course_ids {
            statement = statement.bind(course_id.as_str());
        }
        let rows = statement.fetch_all(&self.pool).await.map_err(provider)?;

        rows.into_iter()
            .map(|row| {
                let kind: String = row.try_get("kind").map_err(provider)?;
                let tee_time: String = row.try_get("tee_time").map_err(provider)?;
                let date: NaiveDate = row.try_get("slot_date").map_err(provider)?;
                Ok(SlotOverride::reconstitute(
                    CourseId::new(
                        row.try_get::<String, _>("golf_course_id")
                            .map_err(provider)?,
                    ),
                    date,
                    clock(&tee_time),
                    SlotOverrideKind::parse(&kind)?,
                    row.try_get("label").map_err(provider)?,
                    row.try_get("note").map_err(provider)?,
                ))
            })
            .collect()
    }

    async fn upsert_slot_overrides(
        &self,
        tenant_id: &str,
        overrides: &[SlotOverride],
    ) -> Result<Vec<SlotOverride>, CourseError> {
        // The desk closes a band, not a row. Applying the band in one
        // transaction keeps a failure part-way through from leaving half a band
        // closed and the other half on sale.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for mark in overrides {
            sqlx::query(
                r#"
                INSERT INTO golf_slot_overrides
                    (tenant_id, golf_course_id, slot_date, tee_time, kind, label, note)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    kind = VALUES(kind),
                    label = VALUES(label),
                    note = VALUES(note),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(mark.course_id().as_str())
            .bind(mark.date())
            .bind(mark.tee_time())
            .bind(mark.kind().as_str())
            .bind(mark.label())
            .bind(mark.note())
            .execute(&mut *transaction)
            .await
            .map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        Ok(overrides.to_vec())
    }

    async fn delete_slot_overrides(
        &self,
        tenant_id: &str,
        command: &DeleteSlotOverrides,
    ) -> Result<u64, CourseError> {
        if command.tee_times.is_empty() {
            return Ok(0);
        }
        let placeholders = vec!["?"; command.tee_times.len()].join(", ");
        let statement = format!(
            r#"
            DELETE FROM golf_slot_overrides
            WHERE tenant_id = ?
              AND golf_course_id = ?
              AND slot_date = ?
              AND tee_time IN ({placeholders})
            "#,
        );
        let mut query = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(command.course_id.as_str())
            .bind(command.date);
        for tee_time in &command.tee_times {
            query = query.bind(clock(tee_time));
        }
        let result = query.execute(&self.pool).await.map_err(provider)?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    #[test]
    fn a_tee_time_that_arrives_with_seconds_is_stored_as_the_row_label() {
        assert_eq!(clock("07:14:00"), "07:14");
        assert_eq!(clock("07:14"), "07:14");
    }

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 20).unwrap()
    }

    fn mark(tenant_suffix: &str, tee_time: &str, kind: SlotOverrideKind) -> SlotOverride {
        SlotOverride::try_new(
            CourseId::new(format!("course-{tenant_suffix}")),
            date(),
            tee_time,
            kind,
            Some("特別料金".into()),
            None,
        )
        .unwrap()
    }

    /// Each test gets its own tenant so they can share one database without
    /// seeing each other's marks, and each *run* gets its own so two runs
    /// cannot either.
    async fn fresh(tenant: &str) -> (MySqlSlotOverrideRepository, String) {
        let repository = MySqlSlotOverrideRepository::new(test_pool().await);
        (repository, test_tenant(tenant))
    }

    #[tokio::test]
    async fn a_band_survives_the_round_trip_through_storage() {
        let (repository, tenant) = fresh("roundtrip").await;
        let marks = vec![
            mark("roundtrip", "07:14", SlotOverrideKind::SpecialRate),
            mark("roundtrip", "07:21", SlotOverrideKind::Closed),
        ];
        repository
            .upsert_slot_overrides(&tenant, &marks)
            .await
            .unwrap();

        let stored = repository
            .list_slot_overrides(
                &tenant,
                &SlotOverrideQuery {
                    date: date(),
                    course_ids: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert_eq!(stored, marks);
    }

    #[tokio::test]
    async fn re_marking_a_tee_time_changes_it_rather_than_stacking_a_second_mark() {
        // Two marks on one row would leave the ledger picking between them.
        let (repository, tenant) = fresh("remark").await;
        repository
            .upsert_slot_overrides(
                &tenant,
                &[mark("remark", "08:00", SlotOverrideKind::Closed)],
            )
            .await
            .unwrap();
        repository
            .upsert_slot_overrides(
                &tenant,
                &[mark("remark", "08:00", SlotOverrideKind::SpecialRate)],
            )
            .await
            .unwrap();

        let stored = repository
            .list_slot_overrides(
                &tenant,
                &SlotOverrideQuery {
                    date: date(),
                    course_ids: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].kind(), SlotOverrideKind::SpecialRate);
    }

    #[tokio::test]
    async fn asking_for_one_course_does_not_return_another_courses_marks() {
        let (repository, tenant) = fresh("filter").await;
        let mine = mark("filter", "09:00", SlotOverrideKind::Closed);
        let other = SlotOverride::try_new(
            CourseId::new("course-filter-other"),
            date(),
            "09:00",
            SlotOverrideKind::Closed,
            None,
            None,
        )
        .unwrap();
        repository
            .upsert_slot_overrides(&tenant, &[mine.clone(), other])
            .await
            .unwrap();

        let stored = repository
            .list_slot_overrides(
                &tenant,
                &SlotOverrideQuery {
                    date: date(),
                    course_ids: vec![CourseId::new("course-filter")],
                },
            )
            .await
            .unwrap();
        assert_eq!(stored, vec![mine]);
    }

    #[tokio::test]
    async fn asking_for_several_courses_returns_all_of_them_and_nothing_else() {
        // The ledger draws whichever courses the desk picked, so its marks query
        // has to name the same set rather than one course or the whole tenant.
        let (repository, tenant) = fresh("multi").await;
        let wanted: Vec<SlotOverride> = ["a", "b"]
            .iter()
            .map(|suffix| {
                SlotOverride::try_new(
                    CourseId::new(format!("course-multi-{suffix}")),
                    date(),
                    "12:00",
                    SlotOverrideKind::Closed,
                    None,
                    None,
                )
                .unwrap()
            })
            .collect();
        let unwanted = SlotOverride::try_new(
            CourseId::new("course-multi-c"),
            date(),
            "12:00",
            SlotOverrideKind::Closed,
            None,
            None,
        )
        .unwrap();
        let mut all = wanted.clone();
        all.push(unwanted);
        repository
            .upsert_slot_overrides(&tenant, &all)
            .await
            .unwrap();

        let stored = repository
            .list_slot_overrides(
                &tenant,
                &SlotOverrideQuery {
                    date: date(),
                    course_ids: vec![
                        CourseId::new("course-multi-a"),
                        CourseId::new("course-multi-b"),
                    ],
                },
            )
            .await
            .unwrap();
        assert_eq!(stored, wanted);
    }

    #[tokio::test]
    async fn clearing_a_band_removes_only_the_tee_times_it_names() {
        let (repository, tenant) = fresh("clear").await;
        repository
            .upsert_slot_overrides(
                &tenant,
                &[
                    mark("clear", "10:00", SlotOverrideKind::Closed),
                    mark("clear", "10:10", SlotOverrideKind::Closed),
                ],
            )
            .await
            .unwrap();

        let deleted = repository
            .delete_slot_overrides(
                &tenant,
                &DeleteSlotOverrides {
                    course_id: CourseId::new("course-clear"),
                    date: date(),
                    // Sent with seconds, the way Field's slot rows carry it.
                    tee_times: vec!["10:00:00".into()],
                },
            )
            .await
            .unwrap();
        assert_eq!(deleted, 1);

        let stored = repository
            .list_slot_overrides(
                &tenant,
                &SlotOverrideQuery {
                    date: date(),
                    course_ids: vec![CourseId::new("course-clear")],
                },
            )
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].tee_time(), "10:10");
    }

    #[tokio::test]
    async fn one_tenants_marks_are_invisible_to_another() {
        let (repository, tenant) = fresh("isolation-a").await;
        repository
            .upsert_slot_overrides(
                &tenant,
                &[mark("isolation", "11:00", SlotOverrideKind::Closed)],
            )
            .await
            .unwrap();

        let stored = repository
            .list_slot_overrides(
                &test_tenant("isolation-b"),
                &SlotOverrideQuery {
                    date: date(),
                    course_ids: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert!(stored.is_empty());
    }
}
