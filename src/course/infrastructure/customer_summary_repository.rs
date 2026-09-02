//! CourseBoard's own storage for the ledger ranked by play.
//!
//! Reads and writes `golf_customer_summaries` and `golf_customer_summary_runs`
//! in CourseBoard's MySQL. The figures are golf's reading of generic bookings,
//! so they are ours to keep (ADR-0009), and the rows hold no name, phone, or
//! address — the ledger itself stays Field's (ADR-0005).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{MySqlPool, QueryBuilder, Row};

use crate::course::domain::{
    CourseError, CustomerId, CustomerSummary, CustomerSummaryGateway, CustomerSummaryQuery,
    CustomerSummaryRun, CustomerSummaryRunStatus, CustomerVisitSummary,
};

/// Rows per INSERT when a refresh writes what it worked out.
///
/// A tenant's whole ledger in one statement is a packet TiDB will refuse; one
/// statement per customer is tens of thousands of round trips. Neither is the
/// shape this wants.
const UPSERT_CHUNK: usize = 200;

pub struct MySqlCustomerSummaryRepository {
    pool: MySqlPool,
}

impl MySqlCustomerSummaryRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn row_to_summary(row: &sqlx::mysql::MySqlRow) -> Result<CustomerSummary, CourseError> {
    let customer_id: String = row.try_get("customer_id").map_err(provider)?;
    Ok(CustomerSummary {
        customer_id: CustomerId::new(customer_id),
        summary: CustomerVisitSummary {
            visits: row.try_get::<u32, _>("visits").map_err(provider)?,
            players: row.try_get::<i64, _>("players").map_err(provider)?,
            total_amount: row.try_get::<i64, _>("total_amount").map_err(provider)?,
            unpriced_visits: row.try_get::<u32, _>("unpriced_visits").map_err(provider)?,
            spend_per_player: row
                .try_get::<Option<i64>, _>("spend_per_player")
                .map_err(provider)?,
            cancelled: row.try_get::<u32, _>("cancelled").map_err(provider)?,
            no_shows: row.try_get::<u32, _>("no_shows").map_err(provider)?,
            upcoming: row.try_get::<u32, _>("upcoming").map_err(provider)?,
            first_visit_at: row
                .try_get::<Option<DateTime<Utc>>, _>("first_visit_at")
                .map_err(provider)?,
            last_visit_at: row
                .try_get::<Option<DateTime<Utc>>, _>("last_visit_at")
                .map_err(provider)?,
        },
        truncated: row.try_get::<bool, _>("truncated").map_err(provider)?,
        computed_at: row
            .try_get::<DateTime<Utc>, _>("computed_at")
            .map_err(provider)?,
    })
}

/// The segment, as a WHERE clause.
///
/// Shared by the page and the count so the two cannot describe different sets
/// — a pager whose total came from a different filter than its rows is a bug
/// that looks like a rounding error for weeks.
fn push_filters<'args>(
    builder: &mut QueryBuilder<'args, sqlx::MySql>,
    tenant_id: &'args str,
    query: &CustomerSummaryQuery,
    now: DateTime<Utc>,
) {
    builder.push(" WHERE tenant_id = ").push_bind(tenant_id);
    // Somebody in the ledger who has never played cannot be asked to come
    // again. Their row is still kept — they may play next week — but a call
    // list is not where they belong.
    if !query.include_never_visited {
        builder.push(" AND last_visit_at IS NOT NULL");
    }
    if let Some(cutoff) = query.last_visit_before(now) {
        builder
            .push(" AND last_visit_at IS NOT NULL AND last_visit_at <= ")
            .push_bind(cutoff);
    }
    if let Some(cutoff) = query.last_visit_after(now) {
        builder
            .push(" AND last_visit_at IS NOT NULL AND last_visit_at >= ")
            .push_bind(cutoff);
    }
    if let Some(min) = query.min_visits {
        builder.push(" AND visits >= ").push_bind(min);
    }
    if let Some(min) = query.min_total_amount {
        builder.push(" AND total_amount >= ").push_bind(min);
    }
}

#[async_trait]
impl CustomerSummaryGateway for MySqlCustomerSummaryRepository {
    async fn list_customer_summaries(
        &self,
        tenant_id: &str,
        query: &CustomerSummaryQuery,
        now: DateTime<Utc>,
    ) -> Result<Vec<CustomerSummary>, CourseError> {
        let mut builder = QueryBuilder::new(
            "SELECT customer_id, visits, players, total_amount, unpriced_visits, \
             spend_per_player, cancelled, no_shows, upcoming, first_visit_at, \
             last_visit_at, truncated, computed_at \
             FROM golf_customer_summaries",
        );
        push_filters(&mut builder, tenant_id, query, now);
        // The column comes from a closed enum, never from the request: this is
        // the one place in the statement that is not a bind.
        builder.push(" ORDER BY ").push(query.sort.column());
        builder.push(if query.descending { " DESC" } else { " ASC" });
        // Ties broken by a unique column so page two does not repeat a row from
        // page one. A ledger has thousands of people on nought visits, and
        // without this the pager reshuffles them on every request.
        builder.push(", customer_id ASC");
        builder
            .push(" LIMIT ")
            .push_bind(query.limit)
            .push(" OFFSET ")
            .push_bind(query.offset);

        let rows = builder
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(provider)?;
        rows.iter().map(row_to_summary).collect()
    }

    async fn count_customer_summaries(
        &self,
        tenant_id: &str,
        query: &CustomerSummaryQuery,
        now: DateTime<Utc>,
    ) -> Result<i64, CourseError> {
        let mut builder =
            QueryBuilder::new("SELECT COUNT(*) AS total FROM golf_customer_summaries");
        push_filters(&mut builder, tenant_id, query, now);
        let row = builder
            .build()
            .fetch_one(&self.pool)
            .await
            .map_err(provider)?;
        row.try_get::<i64, _>("total").map_err(provider)
    }

    async fn upsert_customer_summaries(
        &self,
        tenant_id: &str,
        rows: &[CustomerSummary],
    ) -> Result<u64, CourseError> {
        let mut written = 0u64;
        for chunk in rows.chunks(UPSERT_CHUNK) {
            let mut builder = QueryBuilder::new(
                "INSERT INTO golf_customer_summaries \
                 (tenant_id, customer_id, visits, players, total_amount, unpriced_visits, \
                  spend_per_player, cancelled, no_shows, upcoming, first_visit_at, \
                  last_visit_at, truncated, computed_at) ",
            );
            builder.push_values(chunk, |mut row, entry| {
                row.push_bind(tenant_id)
                    .push_bind(entry.customer_id.as_str())
                    .push_bind(entry.summary.visits)
                    .push_bind(entry.summary.players)
                    .push_bind(entry.summary.total_amount)
                    .push_bind(entry.summary.unpriced_visits)
                    .push_bind(entry.summary.spend_per_player)
                    .push_bind(entry.summary.cancelled)
                    .push_bind(entry.summary.no_shows)
                    .push_bind(entry.summary.upcoming)
                    .push_bind(entry.summary.first_visit_at)
                    .push_bind(entry.summary.last_visit_at)
                    .push_bind(entry.truncated)
                    .push_bind(entry.computed_at);
            });
            // Every figure is replaced wholesale. A refresh recounts a whole
            // lifetime rather than adding to one, so merging the old row in
            // would double what it already knew.
            builder.push(
                " ON DUPLICATE KEY UPDATE \
                 visits = VALUES(visits), \
                 players = VALUES(players), \
                 total_amount = VALUES(total_amount), \
                 unpriced_visits = VALUES(unpriced_visits), \
                 spend_per_player = VALUES(spend_per_player), \
                 cancelled = VALUES(cancelled), \
                 no_shows = VALUES(no_shows), \
                 upcoming = VALUES(upcoming), \
                 first_visit_at = VALUES(first_visit_at), \
                 last_visit_at = VALUES(last_visit_at), \
                 truncated = VALUES(truncated), \
                 computed_at = VALUES(computed_at)",
            );
            builder
                .build()
                .execute(&self.pool)
                .await
                .map_err(provider)?;
            // The rows this run wrote, not what the driver reports: MySQL
            // counts an updated row twice under ON DUPLICATE KEY, so its number
            // would say a refresh touched twice as many people as exist.
            written += chunk.len() as u64;
        }
        Ok(written)
    }

    async fn latest_summary_run(
        &self,
        tenant_id: &str,
    ) -> Result<Option<CustomerSummaryRun>, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT id, started_at, finished_at, status, reservations_scanned,
                   customers_written, error
            FROM golf_customer_summary_runs
            WHERE tenant_id = ?
            ORDER BY started_at DESC, id DESC
            LIMIT 1
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        let Some(row) = row else { return Ok(None) };
        let status: String = row.try_get("status").map_err(provider)?;
        Ok(Some(CustomerSummaryRun {
            id: row.try_get::<i64, _>("id").map_err(provider)?,
            started_at: row
                .try_get::<DateTime<Utc>, _>("started_at")
                .map_err(provider)?,
            finished_at: row
                .try_get::<Option<DateTime<Utc>>, _>("finished_at")
                .map_err(provider)?,
            status: CustomerSummaryRunStatus::from_stored(&status),
            reservations_scanned: row
                .try_get::<i64, _>("reservations_scanned")
                .map_err(provider)?,
            customers_written: row
                .try_get::<i64, _>("customers_written")
                .map_err(provider)?,
            error: row.try_get("error").map_err(provider)?,
        }))
    }

    async fn start_summary_run(&self, tenant_id: &str) -> Result<i64, CourseError> {
        let result =
            sqlx::query("INSERT INTO golf_customer_summary_runs (tenant_id, status) VALUES (?, ?)")
                .bind(tenant_id)
                .bind(CustomerSummaryRunStatus::Running.as_str())
                .execute(&self.pool)
                .await
                .map_err(provider)?;
        Ok(result.last_insert_id() as i64)
    }

    async fn finish_summary_run(
        &self,
        run_id: i64,
        status: CustomerSummaryRunStatus,
        reservations_scanned: i64,
        customers_written: i64,
        error: Option<&str>,
    ) -> Result<(), CourseError> {
        sqlx::query(
            r#"
            UPDATE golf_customer_summary_runs
            SET finished_at = CURRENT_TIMESTAMP(6),
                status = ?,
                reservations_scanned = ?,
                customers_written = ?,
                error = ?
            WHERE id = ?
            "#,
        )
        .bind(status.as_str())
        .bind(reservations_scanned)
        .bind(customers_written)
        .bind(error)
        .bind(run_id)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::CustomerSummarySort;
    use crate::test_support::{test_pool, test_tenant};
    use chrono::{Duration, TimeZone};

    async fn repository() -> MySqlCustomerSummaryRepository {
        MySqlCustomerSummaryRepository::new(test_pool().await)
    }

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 31, 0, 0, 0).unwrap()
    }

    fn entry(customer: &str, visits: u32, amount: i64, days_ago: Option<i64>) -> CustomerSummary {
        CustomerSummary {
            customer_id: CustomerId::new(customer),
            summary: CustomerVisitSummary {
                visits,
                players: i64::from(visits) * 4,
                total_amount: amount,
                unpriced_visits: 0,
                spend_per_player: (visits > 0).then(|| amount / (i64::from(visits) * 4)),
                cancelled: 0,
                no_shows: 0,
                upcoming: 0,
                first_visit_at: days_ago.map(|_| now() - Duration::days(900)),
                last_visit_at: days_ago.map(|days| now() - Duration::days(days)),
            },
            truncated: false,
            computed_at: now(),
        }
    }

    #[tokio::test]
    async fn the_list_ranks_by_takings_and_the_count_describes_the_same_set() {
        let repository = repository().await;
        let tenant = test_tenant("summary-rank");
        repository
            .upsert_customer_summaries(
                &tenant,
                &[
                    entry("cus-small", 2, 40_000, Some(10)),
                    entry("cus-big", 30, 900_000, Some(10)),
                    entry("cus-mid", 9, 300_000, Some(10)),
                ],
            )
            .await
            .unwrap();

        let query = CustomerSummaryQuery::default();
        let rows = repository
            .list_customer_summaries(&tenant, &query, now())
            .await
            .unwrap();
        assert_eq!(
            rows.iter()
                .map(|row| row.customer_id.as_str())
                .collect::<Vec<_>>(),
            ["cus-big", "cus-mid", "cus-small"]
        );
        assert_eq!(
            repository
                .count_customer_summaries(&tenant, &query, now())
                .await
                .unwrap(),
            3
        );
    }

    #[tokio::test]
    async fn dormancy_selects_the_people_who_stopped_coming() {
        let repository = repository().await;
        let tenant = test_tenant("summary-dormant");
        repository
            .upsert_customer_summaries(
                &tenant,
                &[
                    entry("cus-last-week", 20, 800_000, Some(7)),
                    entry("cus-last-year", 20, 800_000, Some(400)),
                    entry("cus-never", 0, 0, None),
                ],
            )
            .await
            .unwrap();

        let query = CustomerSummaryQuery {
            min_days_since_last_visit: Some(90),
            ..CustomerSummaryQuery::default()
        };
        let rows = repository
            .list_customer_summaries(&tenant, &query, now())
            .await
            .unwrap();
        // The regular who came last week is not a lapsed customer, and the
        // person who has never played cannot be asked to come again.
        assert_eq!(
            rows.iter()
                .map(|row| row.customer_id.as_str())
                .collect::<Vec<_>>(),
            ["cus-last-year"]
        );
        assert_eq!(
            repository
                .count_customer_summaries(&tenant, &query, now())
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn a_refresh_replaces_the_figures_rather_than_adding_to_them() {
        let repository = repository().await;
        let tenant = test_tenant("summary-refresh");
        repository
            .upsert_customer_summaries(&tenant, &[entry("cus-1", 5, 100_000, Some(30))])
            .await
            .unwrap();
        repository
            .upsert_customer_summaries(&tenant, &[entry("cus-1", 6, 120_000, Some(2))])
            .await
            .unwrap();

        let rows = repository
            .list_customer_summaries(&tenant, &CustomerSummaryQuery::default(), now())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].summary.visits, 6);
        assert_eq!(rows[0].summary.total_amount, 120_000);
    }

    #[tokio::test]
    async fn the_oldest_absence_comes_first_when_the_list_is_ordered_by_last_visit() {
        let repository = repository().await;
        let tenant = test_tenant("summary-order");
        repository
            .upsert_customer_summaries(
                &tenant,
                &[
                    entry("cus-recent", 3, 10, Some(5)),
                    entry("cus-old", 3, 10, Some(500)),
                ],
            )
            .await
            .unwrap();

        let query = CustomerSummaryQuery {
            sort: CustomerSummarySort::LastVisit,
            descending: false,
            ..CustomerSummaryQuery::default()
        };
        let rows = repository
            .list_customer_summaries(&tenant, &query, now())
            .await
            .unwrap();
        assert_eq!(rows[0].customer_id.as_str(), "cus-old");
    }

    #[tokio::test]
    async fn a_run_that_never_finished_is_readable_as_unfinished() {
        let repository = repository().await;
        let tenant = test_tenant("summary-run");
        assert!(repository
            .latest_summary_run(&tenant)
            .await
            .unwrap()
            .is_none());

        let run = repository.start_summary_run(&tenant).await.unwrap();
        let opened = repository
            .latest_summary_run(&tenant)
            .await
            .unwrap()
            .expect("the run was opened before the sweep started");
        assert_eq!(opened.status, CustomerSummaryRunStatus::Running);
        assert!(opened.finished_at.is_none());

        repository
            .finish_summary_run(
                run,
                CustomerSummaryRunStatus::Failed,
                1_200,
                0,
                Some("field said 424"),
            )
            .await
            .unwrap();
        let failed = repository
            .latest_summary_run(&tenant)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(failed.status, CustomerSummaryRunStatus::Failed);
        assert_eq!(failed.reservations_scanned, 1_200);
        assert_eq!(failed.error.as_deref(), Some("field said 424"));
        assert!(failed.finished_at.is_some());
    }
}
