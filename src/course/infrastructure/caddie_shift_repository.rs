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
    CaddieId, CaddieShift, CaddieShiftGateway, CourseError, CourseId, ShiftOrigin, ShiftSpan,
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
}

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
}
