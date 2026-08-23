//! CourseBoard's own storage for imported daily reservation-count rows.
//!
//! The rows used to live in the golf extension's shared config object, which
//! made every ledger read transfer the whole history and every import rewrite
//! it (ADR-0009). This is the one exited system where a read-time fallback is
//! not enough: it is history, not a setting, and two stores answering the same
//! date cannot be reconciled by a reader. The [`MigratingReservationReportGateway`]
//! therefore seeds this table from the legacy config copy exactly once — on
//! the first import, or proactively via `courseboard-migrate-reservation-reports`
//! — and reads fall back to the legacy copy only while a tenant has no rows
//! here at all.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{MySqlPool, Row};

use super::reservation_report_gateway::FieldReservationReportGateway;
use crate::course::domain::{
    Course, CourseError, CourseId, ExternalReservationReportEntry, GatewayCredentials,
    ReservationReportAnalyzeGateway, ReservationReportDayPart, ReservationReportEntryQuery,
    ReservationReportGateway, ReservationReportUpsertSummary, TabularAnalyzeResult,
};

const UNLINKED_BUCKET_PREFIX: &str = "unlinked:";

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

/// One stored row, keyed by (bucket, date, day part) within a tenant.
#[derive(Clone, Debug, PartialEq, Eq)]
struct StoredRow {
    bucket: String,
    golf_course_id: Option<String>,
    source_system: String,
    source_course_key: String,
    source_course_name: String,
    date: NaiveDate,
    day_part: ReservationReportDayPart,
    group_count: i64,
    caddie_attached_group_count: i64,
    source_file_sha256: String,
    updated_at: Option<DateTime<Utc>>,
}

impl StoredRow {
    fn key(&self) -> (String, NaiveDate, &'static str) {
        (self.bucket.clone(), self.date, self.day_part.as_str())
    }

    fn matches(&self, other: &StoredRow) -> bool {
        self.source_system == other.source_system
            && self.source_course_key == other.source_course_key
            && self.source_course_name == other.source_course_name
            && self.golf_course_id == other.golf_course_id
            && self.date == other.date
            && self.day_part == other.day_part
            && self.group_count == other.group_count
            && self.caddie_attached_group_count == other.caddie_attached_group_count
            && self.source_file_sha256 == other.source_file_sha256
    }

    fn from_entry(entry: &ExternalReservationReportEntry, bucket: String) -> Self {
        Self {
            bucket,
            golf_course_id: entry
                .golf_course_id()
                .map(|course_id| course_id.as_str().to_string()),
            source_system: entry.source_system().to_string(),
            source_course_key: entry.source_course_key().to_string(),
            source_course_name: entry.source_course_name().to_string(),
            date: entry.date(),
            day_part: entry.day_part(),
            group_count: entry.group_count(),
            caddie_attached_group_count: entry.caddie_attached_group_count(),
            source_file_sha256: entry.source_file_sha256().to_string(),
            updated_at: entry.updated_at(),
        }
    }

    fn into_entry(self) -> Result<ExternalReservationReportEntry, CourseError> {
        let id = format!("{}:{}:{}", self.bucket, self.date, self.day_part.as_str());
        ExternalReservationReportEntry::reconstitute(
            id,
            self.source_course_key,
            self.source_course_name,
            self.golf_course_id.map(CourseId::new),
            self.date,
            self.day_part,
            self.group_count,
            self.caddie_attached_group_count,
            self.source_file_sha256,
            self.updated_at,
        )
        .map_err(|_| CourseError::Provider("stored reservation report row is invalid".into()))
    }
}

pub struct MySqlReservationReportRepository {
    pool: MySqlPool,
}

impl MySqlReservationReportRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    /// Whether the tenant has been seeded. Row presence — not any query
    /// window — decides which store answers, so a tenant whose history is
    /// entirely outside the asked range still reads locally.
    pub async fn has_rows(&self, tenant_id: &str) -> Result<bool, CourseError> {
        let row = sqlx::query(
            "SELECT 1 AS one FROM golf_reservation_report_rows WHERE tenant_id = ? LIMIT 1",
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;
        Ok(row.is_some())
    }

    async fn load_rows(&self, tenant_id: &str) -> Result<Vec<StoredRow>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT bucket, golf_course_id, source_system, source_course_key,
                   source_course_name, report_date, day_part, group_count,
                   caddie_attached_group_count, source_file_sha256, updated_at
            FROM golf_reservation_report_rows
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;
        rows.iter()
            .map(|row| {
                let day_part: String = row.try_get("day_part").map_err(provider)?;
                let day_part = ReservationReportDayPart::parse(&day_part).map_err(|_| {
                    CourseError::Provider("stored reservation report day part is invalid".into())
                })?;
                let updated_at: Option<DateTime<Utc>> =
                    row.try_get("updated_at").map_err(provider)?;
                Ok(StoredRow {
                    bucket: row.try_get("bucket").map_err(provider)?,
                    golf_course_id: row.try_get("golf_course_id").map_err(provider)?,
                    source_system: row.try_get("source_system").map_err(provider)?,
                    source_course_key: row.try_get("source_course_key").map_err(provider)?,
                    source_course_name: row.try_get("source_course_name").map_err(provider)?,
                    date: row.try_get("report_date").map_err(provider)?,
                    day_part,
                    group_count: row.try_get("group_count").map_err(provider)?,
                    caddie_attached_group_count: row
                        .try_get("caddie_attached_group_count")
                        .map_err(provider)?,
                    source_file_sha256: row.try_get("source_file_sha256").map_err(provider)?,
                    updated_at,
                })
            })
            .collect()
    }

    /// The rows a reader sees: active courses' buckets plus every unlinked
    /// facility, filtered to the asked window and sorted the way the legacy
    /// gateway sorted.
    pub async fn list(
        &self,
        tenant_id: &str,
        courses: &[Course],
        query: ReservationReportEntryQuery,
    ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
        let query = query.validate()?;
        let active_ids: HashSet<&str> = courses
            .iter()
            .filter(|course| course.is_active())
            .map(|course| course.id().as_str())
            .collect();
        let mut rows: Vec<StoredRow> = self
            .load_rows(tenant_id)
            .await?
            .into_iter()
            .filter(|row| {
                row.bucket.starts_with(UNLINKED_BUCKET_PREFIX)
                    || active_ids.contains(row.bucket.as_str())
            })
            .filter(|row| {
                query.from.is_none_or(|from| row.date >= from)
                    && query.to.is_none_or(|to| row.date <= to)
            })
            .collect();
        rows.sort_by(|a, b| {
            (a.date, &a.source_course_key, a.day_part.as_str()).cmp(&(
                b.date,
                &b.source_course_key,
                b.day_part.as_str(),
            ))
        });
        rows.into_iter().map(StoredRow::into_entry).collect()
    }

    /// Import: replace every row belonging to the imported source facilities,
    /// leaving other facilities' rows alone. Same replacement semantics as the
    /// legacy config gateway, including the counts it reports.
    pub async fn upsert(
        &self,
        tenant_id: &str,
        entries: &[ExternalReservationReportEntry],
        courses: &[Course],
    ) -> Result<ReservationReportUpsertSummary, CourseError> {
        if entries.is_empty() {
            return Err(CourseError::BadRequest(
                "reservation report contains no rows",
            ));
        }
        let active_ids: HashSet<&str> = courses
            .iter()
            .filter(|course| course.is_active())
            .map(|course| course.id().as_str())
            .collect();
        let source_keys: HashSet<&str> = entries
            .iter()
            .map(|entry| entry.source_course_key())
            .collect();

        // The rows to write. An entry linked to a course that is no longer in
        // the active catalog is dropped, exactly as the legacy gateway only
        // rebuilt active courses' buckets.
        let mut new_rows: BTreeMap<(String, NaiveDate, &'static str), StoredRow> = BTreeMap::new();
        for entry in entries {
            let bucket = match entry.golf_course_id() {
                Some(course_id) if active_ids.contains(course_id.as_str()) => {
                    course_id.as_str().to_string()
                }
                Some(_) => continue,
                None => format!("{UNLINKED_BUCKET_PREFIX}{}", entry.source_course_key()),
            };
            let row = StoredRow::from_entry(entry, bucket);
            new_rows.insert(row.key(), row);
        }

        let existing = self.load_rows(tenant_id).await?;
        let existing_by_key: BTreeMap<(String, NaiveDate, &'static str), StoredRow> = existing
            .iter()
            .map(|row| (row.key(), row.clone()))
            .collect();

        // A source facility relinked to another course must not leave a stale
        // copy behind: delete its rows everywhere they are not being rewritten.
        let stale: Vec<&StoredRow> = existing
            .iter()
            .filter(|row| source_keys.contains(row.source_course_key.as_str()))
            .filter(|row| !new_rows.contains_key(&row.key()))
            .collect();

        let mut summary = ReservationReportUpsertSummary::default();
        let now = Utc::now();
        let mut writes: Vec<StoredRow> = Vec::with_capacity(new_rows.len());
        for (key, mut row) in new_rows {
            match existing_by_key.get(&key) {
                Some(previous) if previous.matches(&row) => {
                    summary.unchanged_count += 1;
                    // Keep the timestamp of the import that actually changed
                    // the row; a re-import of the same file is not a change.
                    row.updated_at = previous.updated_at;
                }
                Some(_) => {
                    summary.updated_count += 1;
                    row.updated_at = Some(now);
                }
                None => {
                    summary.created_count += 1;
                    row.updated_at = Some(now);
                }
            }
            writes.push(row);
        }

        let mut tx = self.pool.begin().await.map_err(provider)?;
        // Deletes name whole unique keys instead of ranging over the tenant:
        // on TiDB a range delete locks wide enough that two tenants importing
        // at the same time deadlock each other.
        for row in stale {
            sqlx::query(
                r#"
                DELETE FROM golf_reservation_report_rows
                WHERE tenant_id = ? AND bucket = ? AND report_date = ? AND day_part = ?
                "#,
            )
            .bind(tenant_id)
            .bind(&row.bucket)
            .bind(row.date)
            .bind(row.day_part.as_str())
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        for row in &writes {
            upsert_row(&mut tx, tenant_id, row).await?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(summary)
    }

    /// One-shot seed from the legacy store. Insert-only semantics with upsert
    /// safety: two concurrent seeders converge on the same rows.
    pub async fn seed(
        &self,
        tenant_id: &str,
        entries: &[ExternalReservationReportEntry],
    ) -> Result<usize, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;
        let mut seeded = 0usize;
        for entry in entries {
            let bucket = match entry.golf_course_id() {
                Some(course_id) => course_id.as_str().to_string(),
                None => format!("{UNLINKED_BUCKET_PREFIX}{}", entry.source_course_key()),
            };
            let row = StoredRow::from_entry(entry, bucket);
            upsert_row(&mut tx, tenant_id, &row).await?;
            seeded += 1;
        }
        tx.commit().await.map_err(provider)?;
        Ok(seeded)
    }
}

async fn upsert_row(
    tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
    tenant_id: &str,
    row: &StoredRow,
) -> Result<(), CourseError> {
    sqlx::query(
        r#"
        INSERT INTO golf_reservation_report_rows (
            tenant_id, bucket, golf_course_id, source_system, source_course_key,
            source_course_name, report_date, day_part, group_count,
            caddie_attached_group_count, source_file_sha256, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            golf_course_id = VALUES(golf_course_id),
            source_system = VALUES(source_system),
            source_course_key = VALUES(source_course_key),
            source_course_name = VALUES(source_course_name),
            group_count = VALUES(group_count),
            caddie_attached_group_count = VALUES(caddie_attached_group_count),
            source_file_sha256 = VALUES(source_file_sha256),
            updated_at = VALUES(updated_at)
        "#,
    )
    .bind(tenant_id)
    .bind(&row.bucket)
    .bind(&row.golf_course_id)
    .bind(&row.source_system)
    .bind(&row.source_course_key)
    .bind(&row.source_course_name)
    .bind(row.date)
    .bind(row.day_part.as_str())
    .bind(row.group_count)
    .bind(row.caddie_attached_group_count)
    .bind(&row.source_file_sha256)
    .bind(row.updated_at.unwrap_or_else(Utc::now))
    .execute(&mut **tx)
    .await
    .map_err(provider)?;
    Ok(())
}

/// The gateway the app actually uses: CourseBoard's table as the source of
/// truth, the legacy config copy as a one-shot seed and a read fallback for
/// tenants that have never been seeded. Tabular analysis stays a Field call —
/// it is a stateless capability, not storage.
pub struct MigratingReservationReportGateway {
    local: MySqlReservationReportRepository,
    legacy: Arc<FieldReservationReportGateway>,
}

impl MigratingReservationReportGateway {
    pub fn new(pool: MySqlPool, legacy: Arc<FieldReservationReportGateway>) -> Self {
        Self {
            local: MySqlReservationReportRepository::new(pool),
            legacy,
        }
    }

    pub fn local(&self) -> &MySqlReservationReportRepository {
        &self.local
    }

    pub fn legacy(&self) -> &FieldReservationReportGateway {
        &self.legacy
    }

    /// Copy the whole legacy history in if this tenant has never been seeded.
    /// Returns how many rows were copied (0 when already seeded or empty).
    pub async fn seed_from_legacy_if_unseeded(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: &[Course],
    ) -> Result<usize, CourseError> {
        if self.local.has_rows(credentials.operator_id).await? {
            return Ok(0);
        }
        let legacy_entries = self
            .legacy
            .list_entries(
                credentials,
                courses,
                ReservationReportEntryQuery {
                    from: None,
                    to: None,
                },
            )
            .await?;
        if legacy_entries.is_empty() {
            return Ok(0);
        }
        self.local
            .seed(credentials.operator_id, &legacy_entries)
            .await
    }
}

#[async_trait]
impl ReservationReportGateway for MigratingReservationReportGateway {
    async fn upsert_entries(
        &self,
        credentials: GatewayCredentials<'_>,
        entries: &[ExternalReservationReportEntry],
        courses: &[Course],
    ) -> Result<ReservationReportUpsertSummary, CourseError> {
        // Seeding before the first write makes the switch atomic per tenant:
        // without it, the first local import would make the fallback stop and
        // every older half-day would vanish from the board.
        self.seed_from_legacy_if_unseeded(credentials, courses)
            .await?;
        self.local
            .upsert(credentials.operator_id, entries, courses)
            .await
    }

    async fn list_entries(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: &[Course],
        query: ReservationReportEntryQuery,
    ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
        if self.local.has_rows(credentials.operator_id).await? {
            return self
                .local
                .list(credentials.operator_id, courses, query)
                .await;
        }
        self.legacy.list_entries(credentials, courses, query).await
    }
}

#[async_trait]
impl ReservationReportAnalyzeGateway for MigratingReservationReportGateway {
    async fn analyze_tabular(
        &self,
        credentials: GatewayCredentials<'_>,
        bytes: &[u8],
        filename: Option<&str>,
        year: i32,
    ) -> Result<TabularAnalyzeResult, CourseError> {
        self.legacy
            .analyze_tabular(credentials, bytes, filename, year)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::ReservationReportRow;
    use crate::test_support::{test_pool, test_tenant};

    fn course(id: &str, is_active: bool) -> Course {
        Course::reconstitute(
            id,
            "テストコース",
            None,
            18,
            "Asia/Tokyo",
            10,
            is_active,
            None,
            None,
            None,
            None,
        )
    }

    fn entry(
        source_key: &str,
        course_id: Option<&str>,
        date: (i32, u32, u32),
        day_part: ReservationReportDayPart,
        group_count: i64,
    ) -> ExternalReservationReportEntry {
        let row = ReservationReportRow::new(
            source_key,
            format!("{source_key} facility"),
            NaiveDate::from_ymd_opt(date.0, date.1, date.2).unwrap(),
            day_part,
            group_count,
            1,
        )
        .unwrap();
        ExternalReservationReportEntry::new(&row, course_id.map(CourseId::new), "hash")
    }

    async fn repository() -> MySqlReservationReportRepository {
        MySqlReservationReportRepository::new(test_pool().await)
    }

    fn unbounded() -> ReservationReportEntryQuery {
        ReservationReportEntryQuery {
            from: None,
            to: None,
        }
    }

    #[tokio::test]
    async fn import_round_trips_and_counts_like_the_legacy_gateway() {
        let repository = repository().await;
        let tenant = test_tenant("report-round-trip");
        let courses = [course("course-1", true)];
        let first = entry(
            "真駒内",
            Some("course-1"),
            (2026, 7, 1),
            ReservationReportDayPart::Morning,
            3,
        );

        let created = repository
            .upsert(&tenant, std::slice::from_ref(&first), &courses)
            .await
            .unwrap();
        assert_eq!(
            (
                created.created_count,
                created.updated_count,
                created.unchanged_count
            ),
            (1, 0, 0)
        );

        // The same file again: unchanged, and the timestamp survives.
        let listed_before = repository
            .list(&tenant, &courses, unbounded())
            .await
            .unwrap();
        let unchanged = repository
            .upsert(&tenant, std::slice::from_ref(&first), &courses)
            .await
            .unwrap();
        assert_eq!(
            (
                unchanged.created_count,
                unchanged.updated_count,
                unchanged.unchanged_count
            ),
            (0, 0, 1)
        );
        let listed_after = repository
            .list(&tenant, &courses, unbounded())
            .await
            .unwrap();
        assert_eq!(listed_before[0].updated_at(), listed_after[0].updated_at());

        // A corrected count on the same half-day is an update.
        let corrected = entry(
            "真駒内",
            Some("course-1"),
            (2026, 7, 1),
            ReservationReportDayPart::Morning,
            5,
        );
        let updated = repository
            .upsert(&tenant, &[corrected], &courses)
            .await
            .unwrap();
        assert_eq!(
            (
                updated.created_count,
                updated.updated_count,
                updated.unchanged_count
            ),
            (0, 1, 0)
        );
        let listed = repository
            .list(&tenant, &courses, unbounded())
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].group_count(), 5);
        assert_eq!(
            listed[0].golf_course_id().map(|id| id.as_str()),
            Some("course-1")
        );
    }

    #[tokio::test]
    async fn relinking_a_facility_leaves_no_stale_copy_behind() {
        let repository = repository().await;
        let tenant = test_tenant("report-relink");
        let linked = entry(
            "真駒内",
            Some("course-1"),
            (2026, 7, 1),
            ReservationReportDayPart::Morning,
            3,
        );
        repository
            .upsert(&tenant, &[linked], &[course("course-1", true)])
            .await
            .unwrap();

        // The facility moves to course-2 while course-1 goes inactive.
        let relinked = entry(
            "真駒内",
            Some("course-2"),
            (2026, 7, 1),
            ReservationReportDayPart::Morning,
            3,
        );
        let summary = repository
            .upsert(
                &tenant,
                &[relinked],
                &[course("course-1", false), course("course-2", true)],
            )
            .await
            .unwrap();
        assert_eq!(summary.created_count, 1);

        let listed = repository
            .list(
                &tenant,
                &[course("course-1", false), course("course-2", true)],
                unbounded(),
            )
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].golf_course_id().map(|id| id.as_str()),
            Some("course-2")
        );

        // Unlinking keeps the history under the facility's own namespace.
        let unlinked = entry(
            "真駒内",
            None,
            (2026, 7, 1),
            ReservationReportDayPart::Morning,
            3,
        );
        repository
            .upsert(
                &tenant,
                &[unlinked],
                &[course("course-1", false), course("course-2", false)],
            )
            .await
            .unwrap();
        let listed = repository
            .list(
                &tenant,
                &[course("course-1", false), course("course-2", false)],
                unbounded(),
            )
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].golf_course_id().is_none());
        assert!(listed[0].id().unwrap().starts_with("unlinked:"));
    }

    #[tokio::test]
    async fn other_facilities_rows_survive_an_import_that_does_not_mention_them() {
        let repository = repository().await;
        let tenant = test_tenant("report-other-facility");
        let courses = [course("course-1", true), course("course-2", true)];
        repository
            .upsert(
                &tenant,
                &[entry(
                    "真駒内",
                    Some("course-1"),
                    (2026, 7, 1),
                    ReservationReportDayPart::Morning,
                    3,
                )],
                &courses,
            )
            .await
            .unwrap();

        repository
            .upsert(
                &tenant,
                &[entry(
                    "滝の",
                    Some("course-2"),
                    (2026, 7, 2),
                    ReservationReportDayPart::Afternoon,
                    2,
                )],
                &courses,
            )
            .await
            .unwrap();

        let listed = repository
            .list(&tenant, &courses, unbounded())
            .await
            .unwrap();
        assert_eq!(listed.len(), 2);
    }

    #[tokio::test]
    async fn the_date_window_filters_and_inactive_course_buckets_disappear() {
        let repository = repository().await;
        let tenant = test_tenant("report-window");
        let courses = [course("course-1", true)];
        repository
            .upsert(
                &tenant,
                &[
                    entry(
                        "真駒内",
                        Some("course-1"),
                        (2026, 7, 1),
                        ReservationReportDayPart::Morning,
                        3,
                    ),
                    entry(
                        "真駒内",
                        Some("course-1"),
                        (2026, 8, 1),
                        ReservationReportDayPart::Morning,
                        4,
                    ),
                ],
                &courses,
            )
            .await
            .unwrap();

        let windowed = repository
            .list(
                &tenant,
                &courses,
                ReservationReportEntryQuery {
                    from: NaiveDate::from_ymd_opt(2026, 7, 15),
                    to: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(windowed.len(), 1);
        assert_eq!(windowed[0].group_count(), 4);

        // The course going inactive hides its bucket, same as the legacy read.
        let hidden = repository
            .list(&tenant, &[course("course-1", false)], unbounded())
            .await
            .unwrap();
        assert!(hidden.is_empty());
    }

    #[tokio::test]
    async fn seeding_is_idempotent_and_flips_has_rows() {
        let repository = repository().await;
        let tenant = test_tenant("report-seed");
        assert!(!repository.has_rows(&tenant).await.unwrap());

        let entries = [
            entry(
                "真駒内",
                Some("course-1"),
                (2026, 7, 1),
                ReservationReportDayPart::Morning,
                3,
            ),
            entry(
                "facility-a",
                None,
                (2026, 7, 2),
                ReservationReportDayPart::Afternoon,
                2,
            ),
        ];
        assert_eq!(repository.seed(&tenant, &entries).await.unwrap(), 2);
        assert!(repository.has_rows(&tenant).await.unwrap());
        assert_eq!(repository.seed(&tenant, &entries).await.unwrap(), 2);

        let listed = repository
            .list(&tenant, &[course("course-1", true)], unbounded())
            .await
            .unwrap();
        assert_eq!(listed.len(), 2);
    }

    mod migrating_gateway {
        use std::sync::Mutex;

        use axum::{
            extract::{Query, State},
            http::StatusCode,
            routing::get,
            Json, Router,
        };
        use serde_json::{json, Value};

        use super::*;

        struct ConfigState {
            tenant: Mutex<Value>,
            patches: Mutex<Vec<Value>>,
        }

        async fn get_config(
            State(state): State<Arc<ConfigState>>,
            Query(_): Query<std::collections::HashMap<String, String>>,
        ) -> (StatusCode, Json<Value>) {
            (
                StatusCode::OK,
                Json(json!({
                    "configJson": state.tenant.lock().unwrap().clone()
                })),
            )
        }

        async fn patch_config(
            State(state): State<Arc<ConfigState>>,
            Json(body): Json<Value>,
        ) -> (StatusCode, Json<Value>) {
            state.patches.lock().unwrap().push(body.clone());
            *state.tenant.lock().unwrap() = body["configJson"].clone();
            (StatusCode::OK, Json(json!({ "ok": true })))
        }

        async fn spawn_fake_field(state: Arc<ConfigState>) -> String {
            let app = Router::new()
                .route(
                    "/v1/erp/extensions/golf_course/config",
                    get(get_config).patch(patch_config),
                )
                .with_state(state);
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            format!("http://{addr}")
        }

        fn legacy_config() -> Value {
            json!({
                "courseBoardReservationReport": {
                    "courses": {
                        "course-1": {
                            "sourceSystem": "daily_reservation_status",
                            "rows": {
                                "2026-07-01:morning": {
                                    "sourceSystem": "daily_reservation_status",
                                    "sourceCourseKey": "真駒内",
                                    "sourceCourseName": "真駒内 facility",
                                    "golfCourseId": "course-1",
                                    "date": "2026-07-01",
                                    "dayPart": "morning",
                                    "groupCount": 3,
                                    "caddieAttachedGroupCount": 1,
                                    "sourceFileSha256": "legacy-hash",
                                    "updatedAt": "2026-07-02T00:00:00Z"
                                }
                            }
                        }
                    },
                    "unlinkedFacilities": {}
                }
            })
        }

        #[tokio::test]
        async fn reads_fall_back_to_legacy_until_the_first_import_seeds_the_table() {
            let tenant = test_tenant("report-migrating");
            let config_state = Arc::new(ConfigState {
                tenant: Mutex::new(legacy_config()),
                patches: Mutex::new(Vec::new()),
            });
            let base_url = spawn_fake_field(config_state.clone()).await;
            let gateway = MigratingReservationReportGateway::new(
                test_pool().await,
                Arc::new(FieldReservationReportGateway::new(
                    reqwest::Client::new(),
                    Some(&base_url),
                )),
            );
            let credentials = GatewayCredentials {
                authorization: "Bearer test-token",
                caller_bearer: "Bearer test-token",
                operator_id: &tenant,
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
            };
            let courses = [course("course-1", true), course("course-2", true)];

            // Unseeded: the legacy config answers.
            let listed = gateway
                .list_entries(credentials, &courses, unbounded())
                .await
                .unwrap();
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].source_file_sha256(), "legacy-hash");

            // The first import copies the legacy history in before writing, so
            // another facility's older half-day survives the switch. (Rows of
            // the imported facility itself are replaced wholesale — that is
            // the legacy semantics too.)
            let summary = gateway
                .upsert_entries(
                    credentials,
                    &[entry(
                        "滝の",
                        Some("course-2"),
                        (2026, 8, 1),
                        ReservationReportDayPart::Morning,
                        4,
                    )],
                    &courses,
                )
                .await
                .unwrap();
            assert_eq!(summary.created_count, 1);
            let listed = gateway
                .list_entries(credentials, &courses, unbounded())
                .await
                .unwrap();
            assert_eq!(listed.len(), 2);
            assert!(listed
                .iter()
                .any(|entry| entry.source_file_sha256() == "legacy-hash"));

            // The import never wrote the legacy config: the exit is one-way.
            assert!(config_state.patches.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn one_tenants_history_is_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("report-ours");
        let theirs = test_tenant("report-theirs");
        let courses = [course("course-1", true)];
        repository
            .upsert(
                &ours,
                &[entry(
                    "真駒内",
                    Some("course-1"),
                    (2026, 7, 1),
                    ReservationReportDayPart::Morning,
                    3,
                )],
                &courses,
            )
            .await
            .unwrap();

        assert!(repository
            .list(&theirs, &courses, unbounded())
            .await
            .unwrap()
            .is_empty());
        assert!(!repository.has_rows(&theirs).await.unwrap());
    }
}
