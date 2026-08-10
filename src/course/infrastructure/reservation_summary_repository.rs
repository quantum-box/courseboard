//! CourseBoard's own storage for the club's daily reservation counts.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_reservation_day_summaries`). The club's booking
//! system exports counts per half-day and nothing finer, so there is no
//! slot-level fact to push into Field's reservation inventory; see ADR-0005 and
//! PLT-3247.

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CourseId, ReservationDaySummary, ReservationSummaryGateway,
    ReservationSummaryQuery, TimeOfDay,
};

/// How many rows one statement carries.
///
/// A month of a three-course club is 186 rows, and a club with more courses or
/// a longer file scales from there. Sending them one statement at a time makes
/// the import a few hundred round trips; sending all of them in one makes a
/// single statement whose size nobody bounded. Chunking keeps both in hand.
const UPSERT_CHUNK: usize = 200;

pub struct MySqlReservationSummaryRepository {
    pool: MySqlPool,
}

impl MySqlReservationSummaryRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl ReservationSummaryGateway for MySqlReservationSummaryRepository {
    async fn list_reservation_summaries(
        &self,
        tenant_id: &str,
        query: &ReservationSummaryQuery,
    ) -> Result<Vec<ReservationDaySummary>, CourseError> {
        if query.from > query.to {
            return Err(CourseError::BadRequest(
                "the first day of the range must not be after the last",
            ));
        }
        // An empty course list means every course, so the filter clause is
        // dropped rather than turned into `IN ()` — which is a syntax error in
        // MySQL and would answer "no bookings anywhere" if it were not.
        let course_filter = if query.course_ids.is_empty() {
            String::new()
        } else {
            let placeholders = vec!["?"; query.course_ids.len()].join(", ");
            format!("AND golf_course_id IN ({placeholders})")
        };
        let statement = format!(
            r#"
            SELECT golf_course_id, summary_date, time_of_day, total_groups, caddie_groups
            FROM golf_reservation_day_summaries
            WHERE tenant_id = ?
              AND summary_date BETWEEN ? AND ?
              {course_filter}
            ORDER BY summary_date, golf_course_id, time_of_day
            "#,
        );
        let mut statement = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(query.from)
            .bind(query.to);
        for course_id in &query.course_ids {
            statement = statement.bind(course_id.as_str());
        }
        let rows = statement.fetch_all(&self.pool).await.map_err(provider)?;

        rows.into_iter()
            .map(|row| {
                let time_of_day: String = row.try_get("time_of_day").map_err(provider)?;
                let date: NaiveDate = row.try_get("summary_date").map_err(provider)?;
                Ok(ReservationDaySummary::reconstitute(
                    CourseId::new(
                        row.try_get::<String, _>("golf_course_id")
                            .map_err(provider)?,
                    ),
                    date,
                    TimeOfDay::parse(&time_of_day)?,
                    row.try_get("total_groups").map_err(provider)?,
                    row.try_get("caddie_groups").map_err(provider)?,
                ))
            })
            .collect()
    }

    async fn upsert_reservation_summaries(
        &self,
        tenant_id: &str,
        summaries: &[ReservationDaySummary],
        source_file: Option<&str>,
    ) -> Result<u64, CourseError> {
        if summaries.is_empty() {
            return Ok(0);
        }
        // One transaction for the whole file. A month that half-applies is
        // worse than one that does not apply at all: the desk would be looking
        // at a board where some days came from the new export and the rest from
        // the last one, with nothing on screen saying which.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for chunk in summaries.chunks(UPSERT_CHUNK) {
            let values = vec!["(?, ?, ?, ?, ?, ?, ?)"; chunk.len()].join(", ");
            let statement = format!(
                r#"
                INSERT INTO golf_reservation_day_summaries
                    (tenant_id, golf_course_id, summary_date, time_of_day,
                     total_groups, caddie_groups, source_file)
                VALUES {values}
                ON DUPLICATE KEY UPDATE
                    total_groups = VALUES(total_groups),
                    caddie_groups = VALUES(caddie_groups),
                    source_file = VALUES(source_file),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            );
            let mut query = sqlx::query(&statement);
            for summary in chunk {
                query = query
                    .bind(tenant_id)
                    .bind(summary.course_id().as_str())
                    .bind(summary.date())
                    .bind(summary.time_of_day().as_str())
                    .bind(summary.total_groups())
                    .bind(summary.caddie_groups())
                    .bind(source_file);
            }
            query.execute(&mut *transaction).await.map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        // The count of half-days the file put on the board. Deliberately not
        // `rows_affected`, which counts an updated row twice and a row updated
        // to the value it already held not at all — so re-importing an
        // unchanged month would report zero and read as "nothing imported".
        Ok(summaries.len() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, day).unwrap()
    }

    fn summary(
        course: &str,
        day: u32,
        time_of_day: TimeOfDay,
        total: i32,
        caddie: i32,
    ) -> ReservationDaySummary {
        ReservationDaySummary::try_new(CourseId::new(course), date(day), time_of_day, total, caddie)
            .unwrap()
    }

    /// Each test gets its own tenant so they can share one database without
    /// seeing each other's counts, and each *run* gets its own so two runs
    /// cannot either.
    async fn fresh(tenant: &str) -> (MySqlReservationSummaryRepository, String) {
        (
            MySqlReservationSummaryRepository::new(test_pool().await),
            test_tenant(tenant),
        )
    }

    fn whole_july() -> ReservationSummaryQuery {
        ReservationSummaryQuery {
            from: date(1),
            to: date(31),
            course_ids: Vec::new(),
        }
    }

    #[tokio::test]
    async fn a_months_counts_survive_the_round_trip_through_storage() {
        let (repository, tenant) = fresh("roundtrip").await;
        let imported = vec![
            summary("course-roundtrip", 1, TimeOfDay::Morning, 70, 19),
            summary("course-roundtrip", 1, TimeOfDay::Afternoon, 19, 4),
        ];
        let written = repository
            .upsert_reservation_summaries(&tenant, &imported, Some("july.xlsx"))
            .await
            .unwrap();
        assert_eq!(written, 2);

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored, imported);
    }

    #[tokio::test]
    async fn importing_the_same_export_twice_leaves_the_month_exactly_as_it_was() {
        // The club re-exports July all through July, so this is the normal
        // case, not an edge one.
        let (repository, tenant) = fresh("idempotent").await;
        let imported = vec![
            summary("course-idempotent", 3, TimeOfDay::Morning, 51, 24),
            summary("course-idempotent", 3, TimeOfDay::Afternoon, 24, 8),
        ];
        for _ in 0..2 {
            repository
                .upsert_reservation_summaries(&tenant, &imported, Some("july.xlsx"))
                .await
                .unwrap();
        }

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored, imported);
    }

    #[tokio::test]
    async fn a_day_whose_bookings_moved_is_updated_rather_than_duplicated() {
        let (repository, tenant) = fresh("update").await;
        repository
            .upsert_reservation_summaries(
                &tenant,
                &[summary("course-update", 20, TimeOfDay::Morning, 55, 24)],
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        repository
            .upsert_reservation_summaries(
                &tenant,
                &[summary("course-update", 20, TimeOfDay::Morning, 61, 30)],
                Some("second.xlsx"),
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].total_groups(), 61);
        assert_eq!(stored[0].caddie_groups(), 30);
    }

    #[tokio::test]
    async fn a_course_that_closes_for_the_day_is_stored_as_zero_and_read_back_as_zero() {
        // 真駒内 shuts on six July days. A zero that failed to store would
        // leave the previous export's count standing on a day nobody plays.
        let (repository, tenant) = fresh("closed").await;
        repository
            .upsert_reservation_summaries(
                &tenant,
                &[summary("course-closed", 6, TimeOfDay::Morning, 0, 0)],
                None,
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].total_groups(), 0);
    }

    #[tokio::test]
    async fn asking_for_one_course_does_not_return_another_courses_counts() {
        let (repository, tenant) = fresh("filter").await;
        let mine = summary("course-filter-mine", 5, TimeOfDay::Morning, 40, 10);
        let other = summary("course-filter-other", 5, TimeOfDay::Morning, 30, 8);
        repository
            .upsert_reservation_summaries(&tenant, &[mine.clone(), other], None)
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(
                &tenant,
                &ReservationSummaryQuery {
                    from: date(1),
                    to: date(31),
                    course_ids: vec![CourseId::new("course-filter-mine")],
                },
            )
            .await
            .unwrap();
        assert_eq!(stored, vec![mine]);
    }

    #[tokio::test]
    async fn a_range_returns_the_days_it_names_and_no_others() {
        let (repository, tenant) = fresh("range").await;
        repository
            .upsert_reservation_summaries(
                &tenant,
                &[
                    summary("course-range", 1, TimeOfDay::Morning, 10, 1),
                    summary("course-range", 15, TimeOfDay::Morning, 20, 2),
                    summary("course-range", 31, TimeOfDay::Morning, 30, 3),
                ],
                None,
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(
                &tenant,
                &ReservationSummaryQuery {
                    from: date(10),
                    to: date(20),
                    course_ids: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].date(), date(15));
    }

    #[tokio::test]
    async fn a_backwards_range_is_refused_rather_than_answering_nothing_found() {
        // "No bookings that week" and "you asked for the week backwards" are
        // different answers and only one of them is actionable.
        let (repository, tenant) = fresh("backwards").await;
        assert!(repository
            .list_reservation_summaries(
                &tenant,
                &ReservationSummaryQuery {
                    from: date(20),
                    to: date(10),
                    course_ids: Vec::new(),
                },
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn one_tenants_bookings_are_invisible_to_another() {
        let (repository, tenant) = fresh("isolation-a").await;
        repository
            .upsert_reservation_summaries(
                &tenant,
                &[summary("course-isolation", 8, TimeOfDay::Morning, 12, 3)],
                None,
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&test_tenant("isolation-b"), &whole_july())
            .await
            .unwrap();
        assert!(stored.is_empty());
    }

    #[tokio::test]
    async fn a_whole_month_of_a_three_course_club_imports_in_one_go() {
        // 31 days, two halves, three courses: the real shape of the file, and
        // more rows than one statement carries.
        let (repository, tenant) = fresh("month").await;
        let month: Vec<ReservationDaySummary> = (1..=31)
            .flat_map(|day| {
                ["a", "b", "c"].into_iter().flat_map(move |course| {
                    TimeOfDay::ALL.into_iter().map(move |time_of_day| {
                        summary(&format!("course-month-{course}"), day, time_of_day, 40, 12)
                    })
                })
            })
            .collect();
        assert_eq!(month.len(), 186);

        let written = repository
            .upsert_reservation_summaries(&tenant, &month, Some("july.xlsx"))
            .await
            .unwrap();
        assert_eq!(written, 186);

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored.len(), 186);
    }
}
