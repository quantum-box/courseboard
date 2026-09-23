//! CourseBoard's own storage for confirmed caddie shifts.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_caddie_shifts`). Field holds the shift request
//! but has no column for the course a caddie works, and that placement is what
//! a course's caddie-attached capacity is counted from; see ADR-0005.

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::mysql::MySqlRow;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CaddieId, CaddieShift, CaddieShiftGateway, CourseError, CourseId, FieldShiftLink, ShiftOrigin,
    ShiftSpan, UnsyncedShift,
};

/// Rows per statement when a whole month is written. A month of a full roster
/// is well over a thousand rows, and one statement per row would hold the
/// transaction open far longer than the desk is willing to wait.
const WRITE_CHUNK: usize = 200;

const COLUMNS: &str = "shift_date, caddie_id, golf_course_id, is_working, span, \
     rounds_capacity, origin, note, updated_by, updated_at";

pub struct MySqlCaddieShiftRepository {
    pool: MySqlPool,
}

impl MySqlCaddieShiftRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn to_shift(row: &MySqlRow) -> Result<CaddieShift, CourseError> {
    let span: String = row.try_get("span").map_err(provider)?;
    let origin: String = row.try_get("origin").map_err(provider)?;
    let course_id: Option<String> = row.try_get("golf_course_id").map_err(provider)?;
    let updated_at: Option<DateTime<Utc>> = row.try_get("updated_at").map_err(provider)?;
    Ok(CaddieShift::reconstitute(
        CaddieId::new(row.try_get::<String, _>("caddie_id").map_err(provider)?),
        row.try_get("shift_date").map_err(provider)?,
        CourseId::from_optional(course_id),
        row.try_get("is_working").map_err(provider)?,
        ShiftSpan::parse(&span),
        row.try_get("rounds_capacity").map_err(provider)?,
        ShiftOrigin::parse(&origin),
        row.try_get("note").map_err(provider)?,
        row.try_get("updated_by").map_err(provider)?,
        updated_at,
    ))
}

#[async_trait]
impl CaddieShiftGateway for MySqlCaddieShiftRepository {
    async fn list_shifts(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CaddieShift>, CourseError> {
        let statement = format!(
            r#"
            SELECT {COLUMNS}
            FROM golf_caddie_shifts
            WHERE tenant_id = ?
              AND shift_date BETWEEN ? AND ?
            ORDER BY shift_date, caddie_id
            "#
        );
        let rows = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(from)
            .bind(to)
            .fetch_all(&self.pool)
            .await
            .map_err(provider)?;

        rows.iter().map(to_shift).collect()
    }

    async fn save_shifts(
        &self,
        tenant_id: &str,
        shifts: &[CaddieShift],
    ) -> Result<u64, CourseError> {
        if shifts.is_empty() {
            return Ok(0);
        }
        // A month is planned as a whole. Writing it in one transaction keeps a
        // failure part-way through from leaving half the month confirmed
        // against the requests and the other half against the previous run.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for chunk in shifts.chunks(WRITE_CHUNK) {
            let values = vec!["(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"; chunk.len()].join(", ");
            let statement = format!(
                r#"
                INSERT INTO golf_caddie_shifts
                    (tenant_id, shift_date, caddie_id, golf_course_id, is_working, span,
                     rounds_capacity, origin, note, updated_by)
                VALUES {values}
                ON DUPLICATE KEY UPDATE
                    golf_course_id = VALUES(golf_course_id),
                    is_working = VALUES(is_working),
                    span = VALUES(span),
                    rounds_capacity = VALUES(rounds_capacity),
                    origin = VALUES(origin),
                    note = VALUES(note),
                    updated_by = VALUES(updated_by),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#
            );
            let mut query = sqlx::query(&statement);
            for shift in chunk {
                query = query
                    .bind(tenant_id)
                    .bind(shift.date())
                    .bind(shift.caddie_id().as_str())
                    .bind(shift.course_id().map(CourseId::as_str))
                    .bind(shift.is_working())
                    .bind(shift.span().as_str())
                    .bind(shift.rounds_capacity())
                    .bind(shift.origin().as_str())
                    .bind(shift.note())
                    .bind(shift.updated_by());
            }
            query.execute(&mut *transaction).await.map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        // MySQL counts an updated row twice in `rows_affected`, so the caller
        // is told how many days it asked for rather than a number that doubles
        // the second time the same month is planned.
        Ok(shifts.len() as u64)
    }

    async fn get_shift(
        &self,
        tenant_id: &str,
        caddie_id: &CaddieId,
        date: NaiveDate,
    ) -> Result<Option<CaddieShift>, CourseError> {
        let statement = format!(
            r#"
            SELECT {COLUMNS}
            FROM golf_caddie_shifts
            WHERE tenant_id = ?
              AND caddie_id = ?
              AND shift_date = ?
            "#
        );
        let row = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(caddie_id.as_str())
            .bind(date)
            .fetch_optional(&self.pool)
            .await
            .map_err(provider)?;

        row.as_ref().map(to_shift).transpose()
    }

    async fn field_shift_links(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<FieldShiftLink>, CourseError> {
        // Days with no link are left out rather than returned as `None`: the
        // caller reads this as "what Field already holds", and a month early
        // in its life is mostly days it holds nothing for.
        let rows = sqlx::query(
            r#"
            SELECT shift_date, caddie_id, field_shift_id
            FROM golf_caddie_shifts
            WHERE tenant_id = ?
              AND shift_date BETWEEN ? AND ?
              AND field_shift_id IS NOT NULL
            ORDER BY shift_date, caddie_id
            "#,
        )
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.iter()
            .map(|row| {
                Ok(FieldShiftLink::new(
                    CaddieId::new(row.try_get::<String, _>("caddie_id").map_err(provider)?),
                    row.try_get("shift_date").map_err(provider)?,
                    row.try_get("field_shift_id").map_err(provider)?,
                ))
            })
            .collect()
    }

    async fn set_field_shift_links(
        &self,
        tenant_id: &str,
        links: &[FieldShiftLink],
    ) -> Result<(), CourseError> {
        if links.is_empty() {
            return Ok(());
        }
        // UPDATE rather than upsert: a link describes a day the desk already
        // confirmed, so a missing row means the day is gone and inserting one
        // would confirm work nobody planned.
        //
        // `updated_at` is deliberately left alone. It records when a person
        // last changed the shift, and the desk reads it that way; a
        // write-through touching it would make every confirmed month look
        // freshly edited.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for chunk in links.chunks(WRITE_CHUNK) {
            let cases = vec!["WHEN caddie_id = ? AND shift_date = ? THEN ?"; chunk.len()].join(" ");
            let pairs = vec!["(?, ?)"; chunk.len()].join(", ");
            let statement = format!(
                r#"
                UPDATE golf_caddie_shifts
                SET field_shift_id = CASE {cases} END,
                    field_synced_at = CURRENT_TIMESTAMP(6)
                WHERE tenant_id = ?
                  AND (caddie_id, shift_date) IN ({pairs})
                "#
            );
            let mut query = sqlx::query(&statement);
            for link in chunk {
                query = query
                    .bind(link.caddie_id.as_str())
                    .bind(link.date)
                    .bind(link.field_shift_id.as_deref());
            }
            query = query.bind(tenant_id);
            for link in chunk {
                query = query.bind(link.caddie_id.as_str()).bind(link.date);
            }
            query.execute(&mut *transaction).await.map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        Ok(())
    }

    async fn unsynced_shifts(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
        limit: u32,
    ) -> Result<Vec<UnsyncedShift>, CourseError> {
        let statement = format!(
            r#"
            SELECT {COLUMNS}, field_shift_id
            FROM golf_caddie_shifts
            WHERE tenant_id = ?
              AND shift_date BETWEEN ? AND ?
              AND {BEHIND_FIELD}
            ORDER BY shift_date, caddie_id
            LIMIT ?
            "#
        );
        let rows = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(from)
            .bind(to)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(provider)?;

        rows.iter()
            .map(|row| {
                Ok(UnsyncedShift {
                    shift: to_shift(row)?,
                    field_shift_id: row.try_get("field_shift_id").map_err(provider)?,
                })
            })
            .collect()
    }

    async fn mark_month_unsynced(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<(), CourseError> {
        // The shift ids are kept. They are what stops the re-send from filing
        // a second shift on a day Field already holds — clearing them here
        // would turn a repair into a duplication.
        sqlx::query(
            r#"
            UPDATE golf_caddie_shifts
            SET field_synced_at = NULL
            WHERE tenant_id = ?
              AND shift_date BETWEEN ? AND ?
            "#,
        )
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }

    async fn count_unsynced(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<u64, CourseError> {
        let statement = format!(
            r#"
            SELECT COUNT(*) AS behind
            FROM golf_caddie_shifts
            WHERE tenant_id = ?
              AND shift_date BETWEEN ? AND ?
              AND {BEHIND_FIELD}
            "#
        );
        let row = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(from)
            .bind(to)
            .fetch_one(&self.pool)
            .await
            .map_err(provider)?;
        let behind: i64 = row.try_get("behind").map_err(provider)?;
        Ok(behind.max(0) as u64)
    }
}

/// A day Field has not been told about since it last changed.
///
/// Never `field_shift_id IS NULL`: a day off is deliberately unrepresented in
/// Field, and reading "no shift there" as "behind" would keep every rest day
/// in the queue forever. What settles it is whether the stamp is newer than
/// the last edit.
const BEHIND_FIELD: &str = "(field_synced_at IS NULL OR field_synced_at < updated_at)";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::ShiftSpan;
    use crate::test_support::{test_pool, test_tenant};

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, day).unwrap()
    }

    fn shift(caddie: &str, day: u32, course: Option<&str>, origin: ShiftOrigin) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new(caddie),
            date(day),
            course.map(CourseId::new),
            course.is_some(),
            ShiftSpan::FullDay,
            if course.is_some() { 2 } else { 0 },
            origin,
            None,
            Some("desk".to_string()),
            None,
        )
    }

    #[tokio::test]
    async fn a_planned_month_survives_the_round_trip_through_storage() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-roundtrip");
        repository
            .save_shifts(
                &tenant,
                &[
                    shift("caddie-1", 1, Some("out"), ShiftOrigin::Generated),
                    shift("caddie-2", 1, Some("in"), ShiftOrigin::Pinned),
                ],
            )
            .await
            .unwrap();

        let stored = repository
            .list_shifts(&tenant, date(1), date(30))
            .await
            .unwrap();

        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].course_id(), Some(&CourseId::new("out")));
        assert_eq!(stored[0].rounds_capacity(), 2);
        assert_eq!(stored[0].updated_by(), Some("desk"));
        assert_eq!(stored[1].origin(), ShiftOrigin::Pinned);
    }

    #[tokio::test]
    async fn planning_the_same_day_again_replaces_it_rather_than_stacking_a_second_placement() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-replan");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 2, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 2, Some("in"), ShiftOrigin::Edited)],
            )
            .await
            .unwrap();

        let stored = repository
            .list_shifts(&tenant, date(2), date(2))
            .await
            .unwrap();

        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].course_id(), Some(&CourseId::new("in")));
        assert_eq!(stored[0].origin(), ShiftOrigin::Edited);
    }

    #[tokio::test]
    async fn a_confirmed_day_off_reads_back_placed_nowhere() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-off");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 3, None, ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        let stored = repository
            .get_shift(&tenant, &CaddieId::new("caddie-1"), date(3))
            .await
            .unwrap()
            .unwrap();

        assert_eq!(stored.course_id(), None);
        assert!(!stored.is_working());
        assert_eq!(stored.rounds_capacity(), 0);
    }

    #[tokio::test]
    async fn a_day_outside_the_asked_for_range_stays_out_of_the_answer() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-range");
        repository
            .save_shifts(
                &tenant,
                &[
                    shift("caddie-1", 10, Some("out"), ShiftOrigin::Generated),
                    shift("caddie-1", 20, Some("out"), ShiftOrigin::Generated),
                ],
            )
            .await
            .unwrap();

        let stored = repository
            .list_shifts(&tenant, date(10), date(15))
            .await
            .unwrap();

        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].date(), date(10));
    }

    #[tokio::test]
    async fn one_tenants_month_is_invisible_to_another() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        repository
            .save_shifts(
                &test_tenant("shift-isolation-a"),
                &[shift("caddie-1", 1, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        let stored = repository
            .list_shifts(&test_tenant("shift-isolation-b"), date(1), date(30))
            .await
            .unwrap();

        assert!(stored.is_empty());
    }

    #[tokio::test]
    async fn a_month_larger_than_one_statement_is_written_whole() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-chunked");
        let shifts: Vec<CaddieShift> = (0..WRITE_CHUNK + 20)
            .map(|index| {
                shift(
                    &format!("caddie-{index}"),
                    1,
                    Some("out"),
                    ShiftOrigin::Generated,
                )
            })
            .collect();

        let written = repository.save_shifts(&tenant, &shifts).await.unwrap();

        assert_eq!(written, shifts.len() as u64);
        assert_eq!(
            repository
                .list_shifts(&tenant, date(1), date(1))
                .await
                .unwrap()
                .len(),
            shifts.len()
        );
    }
    #[tokio::test]
    async fn a_day_written_through_to_field_remembers_which_shift_it_became() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-link");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 3, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(3),
                    Some("shift_a".to_string()),
                )],
            )
            .await
            .unwrap();

        let links = repository
            .field_shift_links(&tenant, date(1), date(30))
            .await
            .unwrap();

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].caddie_id, CaddieId::new("caddie-1"));
        assert_eq!(links[0].date, date(3));
        assert_eq!(links[0].field_shift_id.as_deref(), Some("shift_a"));
    }

    #[tokio::test]
    async fn a_day_that_never_reached_field_is_left_out_rather_than_reported_as_linked() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-link-absent");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 4, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        assert!(repository
            .field_shift_links(&tenant, date(1), date(30))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn withdrawing_a_day_from_field_clears_the_link_it_used_to_name() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-link-clear");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 5, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(5),
                    Some("shift_b".to_string()),
                )],
            )
            .await
            .unwrap();

        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(5),
                    None,
                )],
            )
            .await
            .unwrap();

        assert!(repository
            .field_shift_links(&tenant, date(1), date(30))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn re_planning_a_month_keeps_the_field_shift_the_day_already_became() {
        // `save_shifts` must not blank the link: the day is still the same
        // day, and losing the id would stack a second shift on Field.
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-link-replan");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 6, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(6),
                    Some("shift_c".to_string()),
                )],
            )
            .await
            .unwrap();

        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 6, Some("in"), ShiftOrigin::Edited)],
            )
            .await
            .unwrap();

        let links = repository
            .field_shift_links(&tenant, date(6), date(6))
            .await
            .unwrap();
        assert_eq!(links[0].field_shift_id.as_deref(), Some("shift_c"));
    }

    #[tokio::test]
    async fn a_link_for_a_day_nobody_confirmed_creates_no_shift() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-link-unplanned");

        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-ghost"),
                    date(7),
                    Some("shift_d".to_string()),
                )],
            )
            .await
            .unwrap();

        assert!(repository
            .list_shifts(&tenant, date(7), date(7))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn one_tenants_field_shift_is_invisible_to_another() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let mine = test_tenant("shift-link-mine");
        let theirs = test_tenant("shift-link-theirs");
        repository
            .save_shifts(
                &mine,
                &[shift("caddie-1", 8, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .save_shifts(
                &theirs,
                &[shift("caddie-1", 8, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .set_field_shift_links(
                &mine,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(8),
                    Some("shift_e".to_string()),
                )],
            )
            .await
            .unwrap();

        assert!(repository
            .field_shift_links(&theirs, date(8), date(8))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn more_links_than_one_statement_holds_are_all_written() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-link-chunked");
        let shifts: Vec<CaddieShift> = (0..WRITE_CHUNK + 20)
            .map(|index| {
                shift(
                    &format!("caddie-{index}"),
                    9,
                    Some("out"),
                    ShiftOrigin::Generated,
                )
            })
            .collect();
        repository.save_shifts(&tenant, &shifts).await.unwrap();
        let links: Vec<FieldShiftLink> = (0..WRITE_CHUNK + 20)
            .map(|index| {
                FieldShiftLink::new(
                    CaddieId::new(format!("caddie-{index}")),
                    date(9),
                    Some(format!("shift_{index}")),
                )
            })
            .collect();

        repository
            .set_field_shift_links(&tenant, &links)
            .await
            .unwrap();

        assert_eq!(
            repository
                .field_shift_links(&tenant, date(9), date(9))
                .await
                .unwrap()
                .len(),
            links.len()
        );
    }
    #[tokio::test]
    async fn a_freshly_confirmed_month_is_entirely_behind_field() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-behind-fresh");
        repository
            .save_shifts(
                &tenant,
                &[
                    shift("caddie-1", 10, Some("out"), ShiftOrigin::Generated),
                    shift("caddie-2", 10, None, ShiftOrigin::Generated),
                ],
            )
            .await
            .unwrap();

        assert_eq!(
            repository
                .count_unsynced(&tenant, date(1), date(30))
                .await
                .unwrap(),
            2
        );
        let batch = repository
            .unsynced_shifts(&tenant, date(1), date(30), 10)
            .await
            .unwrap();
        assert_eq!(batch.len(), 2);
        assert!(batch.iter().all(|entry| entry.field_shift_id.is_none()));
    }

    #[tokio::test]
    async fn a_day_told_to_field_drops_out_of_the_queue() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-behind-caught-up");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 11, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(11),
                    Some("shift_a".to_string()),
                )],
            )
            .await
            .unwrap();

        assert_eq!(
            repository
                .count_unsynced(&tenant, date(1), date(30))
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn a_day_off_that_field_never_held_still_leaves_the_queue() {
        // Stamped with no shift id. Reading "no id" as "behind" would keep
        // every rest day in the queue and the push would never finish.
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-behind-day-off");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 12, None, ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(12),
                    None,
                )],
            )
            .await
            .unwrap();

        assert_eq!(
            repository
                .count_unsynced(&tenant, date(1), date(30))
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn changing_a_day_after_it_reached_field_puts_it_back_in_the_queue() {
        // The whole reason the mark is a timestamp: this day already has a
        // shift id, and Field is holding the previous version of it.
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-behind-changed");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 13, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(13),
                    Some("shift_a".to_string()),
                )],
            )
            .await
            .unwrap();

        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 13, Some("in"), ShiftOrigin::Edited)],
            )
            .await
            .unwrap();

        let batch = repository
            .unsynced_shifts(&tenant, date(13), date(13), 10)
            .await
            .unwrap();
        assert_eq!(batch.len(), 1);
        // The id rides along, so the push moves that shift rather than adding
        // a second one to the same day.
        assert_eq!(batch[0].field_shift_id.as_deref(), Some("shift_a"));
    }

    #[tokio::test]
    async fn the_queue_is_read_a_batch_at_a_time_oldest_first() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-behind-batched");
        repository
            .save_shifts(
                &tenant,
                &[
                    shift("caddie-1", 16, Some("out"), ShiftOrigin::Generated),
                    shift("caddie-1", 14, Some("out"), ShiftOrigin::Generated),
                    shift("caddie-1", 15, Some("out"), ShiftOrigin::Generated),
                ],
            )
            .await
            .unwrap();

        let batch = repository
            .unsynced_shifts(&tenant, date(1), date(30), 2)
            .await
            .unwrap();

        assert_eq!(batch.len(), 2);
        assert_eq!(batch[0].shift.date(), date(14));
        assert_eq!(batch[1].shift.date(), date(15));
    }

    #[tokio::test]
    async fn re_sending_a_month_queues_it_again_without_losing_the_shift_ids() {
        // Clearing the ids here would turn a repair into a second shift on
        // every day Field already holds.
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let tenant = test_tenant("shift-behind-resend");
        repository
            .save_shifts(
                &tenant,
                &[shift("caddie-1", 17, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();
        repository
            .set_field_shift_links(
                &tenant,
                &[FieldShiftLink::new(
                    CaddieId::new("caddie-1"),
                    date(17),
                    Some("shift_a".to_string()),
                )],
            )
            .await
            .unwrap();

        repository
            .mark_month_unsynced(&tenant, date(1), date(30))
            .await
            .unwrap();

        let batch = repository
            .unsynced_shifts(&tenant, date(17), date(17), 10)
            .await
            .unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].field_shift_id.as_deref(), Some("shift_a"));
    }

    #[tokio::test]
    async fn one_tenants_queue_is_invisible_to_another() {
        let repository = MySqlCaddieShiftRepository::new(test_pool().await);
        let mine = test_tenant("shift-behind-mine");
        repository
            .save_shifts(
                &mine,
                &[shift("caddie-1", 18, Some("out"), ShiftOrigin::Generated)],
            )
            .await
            .unwrap();

        assert_eq!(
            repository
                .count_unsynced(&test_tenant("shift-behind-theirs"), date(1), date(30))
                .await
                .unwrap(),
            0
        );
    }
}
