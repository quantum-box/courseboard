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
    normalize_course_label, CourseError, CourseId, ReservationDaySummary,
    ReservationSummaryGateway, ReservationSummaryQuery, ReservationSummaryWindow, TimeOfDay,
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
            SELECT golf_course_id, summary_date, time_of_day, total_groups, caddie_groups,
                   sheet_label
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
                    row.try_get("sheet_label").map_err(provider)?,
                ))
            })
            .collect()
    }

    async fn replace_reservation_summaries(
        &self,
        tenant_id: &str,
        window: &ReservationSummaryWindow,
        summaries: &[ReservationDaySummary],
        source_file: Option<&str>,
    ) -> Result<u64, CourseError> {
        if window.from > window.to {
            return Err(CourseError::BadRequest(
                "the first day of the range must not be after the last",
            ));
        }
        if window.sheet_labels.is_empty() && window.course_ids.is_empty() {
            return Ok(0);
        }
        // One transaction for the whole file. A month that half-applies is
        // worse than one that does not apply at all: the desk would be looking
        // at a board where some days came from the new export and the rest from
        // the last one, with nothing on screen saying which.
        let mut transaction = self.pool.begin().await.map_err(provider)?;

        // Clear the window first so the file is the whole truth for the dates
        // and names it covers. Without this, a half-day the new export stopped
        // reporting keeps the previous export's count and the board silently
        // mixes two files.
        //
        // Two handles, because rows can be found by either. The name is the one
        // that survives the desk re-pointing it at another course or excluding
        // it — the rows it wrote last month sit under a course this import is
        // no longer writing to, and only the name still reaches them. The course
        // catches rows written before names were recorded, which have no name to
        // be found by. A course the file does not mention keeps what it has.
        //
        // Names are matched on the key, not the text: an export that respells a
        // name between months means the same course to the import, so keying the
        // delete on the raw text would walk past the rows it wrote.
        let label_keys: Vec<String> = window
            .sheet_labels
            .iter()
            .map(|label| normalize_course_label(label))
            .collect();
        let mut clauses: Vec<String> = Vec::new();
        if !label_keys.is_empty() {
            let placeholders = vec!["?"; label_keys.len()].join(", ");
            clauses.push(format!("sheet_label_key IN ({placeholders})"));
        }
        if !window.course_ids.is_empty() {
            let placeholders = vec!["?"; window.course_ids.len()].join(", ");
            clauses.push(format!("golf_course_id IN ({placeholders})"));
        }
        let statement = format!(
            r#"
            DELETE FROM golf_reservation_day_summaries
            WHERE tenant_id = ?
              AND summary_date BETWEEN ? AND ?
              AND ({})
            "#,
            clauses.join(" OR "),
        );
        let mut delete = sqlx::query(&statement)
            .bind(tenant_id)
            .bind(window.from)
            .bind(window.to);
        for key in &label_keys {
            delete = delete.bind(key.as_str());
        }
        for course_id in &window.course_ids {
            delete = delete.bind(course_id.as_str());
        }
        delete.execute(&mut *transaction).await.map_err(provider)?;

        for chunk in summaries.chunks(UPSERT_CHUNK) {
            let values = vec!["(?, ?, ?, ?, ?, ?, ?, ?, ?)"; chunk.len()].join(", ");
            let statement = format!(
                r#"
                INSERT INTO golf_reservation_day_summaries
                    (tenant_id, golf_course_id, sheet_label, sheet_label_key,
                     summary_date, time_of_day,
                     total_groups, caddie_groups, source_file)
                VALUES {values}
                ON DUPLICATE KEY UPDATE
                    sheet_label = VALUES(sheet_label),
                    sheet_label_key = VALUES(sheet_label_key),
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
                    .bind(summary.sheet_label())
                    .bind(summary.sheet_label_key())
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
        labelled(course, day, time_of_day, total, caddie, "真駒内")
    }

    fn labelled(
        course: &str,
        day: u32,
        time_of_day: TimeOfDay,
        total: i32,
        caddie: i32,
        label: &str,
    ) -> ReservationDaySummary {
        ReservationDaySummary::try_new(
            CourseId::new(course),
            date(day),
            time_of_day,
            total,
            caddie,
            Some(label.to_string()),
        )
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

    /// The window a July file speaks for.
    fn july_window(courses: &[&str]) -> ReservationSummaryWindow {
        labelled_window(&["真駒内"], courses)
    }

    fn labelled_window(labels: &[&str], courses: &[&str]) -> ReservationSummaryWindow {
        ReservationSummaryWindow {
            from: date(1),
            to: date(31),
            sheet_labels: labels.iter().map(|label| label.to_string()).collect(),
            course_ids: courses.iter().map(|id| CourseId::new(*id)).collect(),
        }
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
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-roundtrip"]),
                &imported,
                Some("july.xlsx"),
            )
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
                .replace_reservation_summaries(
                    &tenant,
                    &july_window(&["course-idempotent"]),
                    &imported,
                    Some("july.xlsx"),
                )
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
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-update"]),
                &[summary("course-update", 20, TimeOfDay::Morning, 55, 24)],
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        repository
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-update"]),
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
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-closed"]),
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
    async fn a_half_day_the_new_export_stopped_reporting_does_not_keep_the_old_count() {
        // Yesterday's file had 7/3 morning; today's cannot read that cell. The
        // half-day has to go with it — leaving yesterday's number there makes
        // the board a mix of two exports with nothing saying which is which.
        let (repository, tenant) = fresh("stale").await;
        repository
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-stale"]),
                &[
                    summary("course-stale", 3, TimeOfDay::Morning, 51, 24),
                    summary("course-stale", 3, TimeOfDay::Afternoon, 24, 8),
                ],
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        repository
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-stale"]),
                &[summary("course-stale", 3, TimeOfDay::Afternoon, 24, 8)],
                Some("second.xlsx"),
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].time_of_day(), TimeOfDay::Afternoon);
    }

    #[tokio::test]
    async fn re_pointing_a_name_at_another_course_takes_its_old_rows_with_it() {
        // The desk imported 真駒内 against the wrong course and fixed it. The
        // rows already written sit under a course this import no longer writes
        // to, so only the name still reaches them — and left behind, the board
        // would show the same month twice.
        let (repository, tenant) = fresh("repoint").await;
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["真駒内"], &["course-wrong"]),
                &[labelled(
                    "course-wrong",
                    3,
                    TimeOfDay::Morning,
                    51,
                    24,
                    "真駒内",
                )],
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["真駒内"], &["course-right"]),
                &[labelled(
                    "course-right",
                    3,
                    TimeOfDay::Morning,
                    51,
                    24,
                    "真駒内",
                )],
                Some("second.xlsx"),
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].course_id().as_str(), "course-right");
    }

    #[tokio::test]
    async fn a_name_the_export_respelled_still_finds_the_rows_it_wrote() {
        // `東 コース` and `東コース` are the same name to the import. If the
        // export loses the space in August and the desk excludes the course in
        // the same breath, the course is no handle either — the rows would sit
        // on the board with nothing left able to reach them.
        let (repository, tenant) = fresh("respelled").await;
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["東 コース"], &["course-east"]),
                &[labelled(
                    "course-east",
                    7,
                    TimeOfDay::Morning,
                    18,
                    5,
                    "東 コース",
                )],
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["東コース"], &[]),
                &[],
                Some("second.xlsx"),
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert!(stored.is_empty());
    }

    #[tokio::test]
    async fn excluding_a_name_clears_what_it_put_on_the_board() {
        // "Leave this course out" means nothing if last month's numbers stay.
        // The window names no course at all here, which is exactly the case the
        // old early return walked away from.
        let (repository, tenant) = fresh("exclude").await;
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["羊ケ丘"], &["course-hitsuji"]),
                &[labelled(
                    "course-hitsuji",
                    4,
                    TimeOfDay::Morning,
                    26,
                    11,
                    "羊ケ丘",
                )],
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["羊ケ丘"], &[]),
                &[],
                Some("second.xlsx"),
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert!(stored.is_empty());
    }

    #[tokio::test]
    async fn a_name_the_file_does_not_mention_keeps_what_it_has() {
        let (repository, tenant) = fresh("untouched").await;
        let kept = labelled("course-other", 5, TimeOfDay::Morning, 40, 10, "滝の");
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["滝の"], &["course-other"]),
                std::slice::from_ref(&kept),
                None,
            )
            .await
            .unwrap();
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["真駒内"], &["course-makomanai"]),
                &[labelled(
                    "course-makomanai",
                    5,
                    TimeOfDay::Morning,
                    70,
                    21,
                    "真駒内",
                )],
                None,
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(
                &tenant,
                &ReservationSummaryQuery {
                    from: date(1),
                    to: date(31),
                    course_ids: vec![CourseId::new("course-other")],
                },
            )
            .await
            .unwrap();
        assert_eq!(stored, vec![kept]);
    }

    #[tokio::test]
    async fn a_course_the_import_could_not_match_keeps_what_it_already_had() {
        // A rename in the course master drops a course out of the match. That
        // is a setup problem the desk is warned about — not a reason to erase
        // the month of bookings already imported for it.
        let (repository, tenant) = fresh("unmatched").await;
        let kept = labelled(
            "course-unmatched-old",
            3,
            TimeOfDay::Morning,
            51,
            24,
            "旧コース",
        );
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["旧コース"], &["course-unmatched-old"]),
                std::slice::from_ref(&kept),
                Some("first.xlsx"),
            )
            .await
            .unwrap();
        // Today's import only resolves the other course, so the window names
        // only that one.
        repository
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-unmatched-new"]),
                &[summary(
                    "course-unmatched-new",
                    3,
                    TimeOfDay::Morning,
                    40,
                    10,
                )],
                Some("second.xlsx"),
            )
            .await
            .unwrap();

        let stored = repository
            .list_reservation_summaries(
                &tenant,
                &ReservationSummaryQuery {
                    from: date(1),
                    to: date(31),
                    course_ids: vec![CourseId::new("course-unmatched-old")],
                },
            )
            .await
            .unwrap();
        assert_eq!(stored, vec![kept]);
    }

    #[tokio::test]
    async fn a_window_naming_nothing_at_all_writes_nothing_rather_than_clearing_the_month() {
        // A file whose every name is still an open question resolves to no name
        // and no course. It has nothing to say about the month, so it must not
        // be read as saying the month is empty.
        let (repository, tenant) = fresh("nocourse").await;
        let kept = labelled("course-kept", 6, TimeOfDay::Morning, 33, 9, "真駒内");
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&["真駒内"], &["course-kept"]),
                std::slice::from_ref(&kept),
                Some("june.xlsx"),
            )
            .await
            .unwrap();

        let written = repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(&[], &[]),
                &[],
                Some("july.xlsx"),
            )
            .await
            .unwrap();
        assert_eq!(written, 0);

        let stored = repository
            .list_reservation_summaries(&tenant, &whole_july())
            .await
            .unwrap();
        assert_eq!(stored, vec![kept]);
    }

    #[tokio::test]
    async fn asking_for_one_course_does_not_return_another_courses_counts() {
        let (repository, tenant) = fresh("filter").await;
        let mine = summary("course-filter-mine", 5, TimeOfDay::Morning, 40, 10);
        let other = labelled("course-filter-other", 5, TimeOfDay::Morning, 30, 8, "滝の");
        repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(
                    &["真駒内", "滝の"],
                    &["course-filter-mine", "course-filter-other"],
                ),
                &[mine.clone(), other],
                None,
            )
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
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-range"]),
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
            .replace_reservation_summaries(
                &tenant,
                &july_window(&["course-isolation"]),
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
                        let label = match course {
                            "a" => "真駒内",
                            "b" => "滝の",
                            _ => "羊ケ丘",
                        };
                        labelled(
                            &format!("course-month-{course}"),
                            day,
                            time_of_day,
                            40,
                            12,
                            label,
                        )
                    })
                })
            })
            .collect();
        assert_eq!(month.len(), 186);

        let written = repository
            .replace_reservation_summaries(
                &tenant,
                &labelled_window(
                    &["真駒内", "滝の", "羊ケ丘"],
                    &["course-month-a", "course-month-b", "course-month-c"],
                ),
                &month,
                Some("july.xlsx"),
            )
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
