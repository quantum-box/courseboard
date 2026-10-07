//! The owner commits its staged import and receipt in the same transaction.
//! Keyset pages bound memory independently of the source's number of rows.
use super::*;
use crate::course::domain::{ReservationReportRow, DAILY_RESERVATION_STATUS_SOURCE};
use serde_json::Value;
use sqlx::QueryBuilder;

impl MySqlReservationReportRepository {
    pub(crate) async fn seed_common_legacy(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
        tenant: &str,
        entries: &[ExternalReservationReportEntry],
    ) -> Result<(), CourseError> {
        for entry in entries {
            let bucket = entry
                .golf_course_id()
                .map(|id| id.as_str().to_owned())
                .unwrap_or_else(|| {
                    format!("{UNLINKED_BUCKET_PREFIX}{}", entry.source_course_key())
                });
            // The facility CAS has checked that the target is still unseeded.
            let row = StoredRow::from_entry(entry, bucket);
            sqlx::query("INSERT INTO golf_reservation_report_rows (tenant_id,bucket,golf_course_id,source_system,source_course_key,source_course_name,report_date,day_part,group_count,caddie_attached_group_count,source_file_sha256,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id")
                .bind(tenant).bind(&row.bucket).bind(&row.golf_course_id).bind(&row.source_system).bind(&row.source_course_key).bind(&row.source_course_name).bind(row.date).bind(row.day_part.as_str()).bind(row.group_count).bind(row.caddie_attached_group_count).bind(&row.source_file_sha256).bind(row.updated_at.unwrap_or_else(Utc::now)).execute(&mut **tx).await.map_err(provider)?;
        }
        Ok(())
    }
    pub(crate) async fn commit_common_import(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::MySql>,
        tenant: &str,
        job: &str,
        source: &str,
    ) -> Result<ReservationReportUpsertSummary, CourseError> {
        let mut after = 0i64;
        loop {
            let stale = sqlx::query("SELECT r.id FROM golf_reservation_report_rows r WHERE r.tenant_id=? AND r.id>? AND EXISTS (SELECT 1 FROM courseboard_common_import_rows c WHERE c.tenant_id=r.tenant_id AND c.job_id=? AND c.source_course_key=r.source_course_key) AND NOT EXISTS (SELECT 1 FROM courseboard_common_import_rows c WHERE c.tenant_id=r.tenant_id AND c.job_id=? AND c.bucket=r.bucket AND c.report_date=r.report_date AND c.day_part=r.day_part) ORDER BY r.id LIMIT 100 FOR UPDATE")
                .bind(tenant).bind(after).bind(job).bind(job).fetch_all(&mut **tx).await.map_err(provider)?;
            if stale.is_empty() {
                break;
            }
            for row in stale {
                after = row.try_get("id").map_err(provider)?;
                sqlx::query("DELETE FROM golf_reservation_report_rows WHERE tenant_id=? AND id=?")
                    .bind(tenant)
                    .bind(after)
                    .execute(&mut **tx)
                    .await
                    .map_err(provider)?;
            }
        }
        let mut summary = ReservationReportUpsertSummary::default();
        let mut after = String::new();
        let now = Utc::now();
        loop {
            let page = sqlx::query("SELECT identity_hash,object_json,bucket,golf_course_id,report_date,day_part FROM courseboard_common_import_rows WHERE tenant_id=? AND job_id=? AND identity_hash>? ORDER BY identity_hash LIMIT 100")
                .bind(tenant).bind(job).bind(&after).fetch_all(&mut **tx).await.map_err(provider)?;
            if page.is_empty() {
                break;
            }
            let last: String = page
                .last()
                .unwrap()
                .try_get("identity_hash")
                .map_err(provider)?;
            let previous = sqlx::query("SELECT r.* FROM golf_reservation_report_rows r JOIN courseboard_common_import_rows c ON c.tenant_id=r.tenant_id AND c.bucket=r.bucket AND c.report_date=r.report_date AND c.day_part=r.day_part WHERE c.tenant_id=? AND c.job_id=? AND c.identity_hash>? AND c.identity_hash<=? ORDER BY r.bucket,r.report_date,r.day_part FOR UPDATE")
                .bind(tenant).bind(job).bind(&after).bind(&last).fetch_all(&mut **tx).await.map_err(provider)?;
            let mut prior = BTreeMap::new();
            for row in previous {
                let stored = StoredRow {
                    bucket: row.try_get("bucket").map_err(provider)?,
                    golf_course_id: row.try_get("golf_course_id").map_err(provider)?,
                    source_system: row.try_get("source_system").map_err(provider)?,
                    source_course_key: row.try_get("source_course_key").map_err(provider)?,
                    source_course_name: row.try_get("source_course_name").map_err(provider)?,
                    date: row.try_get("report_date").map_err(provider)?,
                    day_part: ReservationReportDayPart::parse(
                        &row.try_get::<String, _>("day_part").map_err(provider)?,
                    )?,
                    group_count: row.try_get("group_count").map_err(provider)?,
                    caddie_attached_group_count: row
                        .try_get("caddie_attached_group_count")
                        .map_err(provider)?,
                    source_file_sha256: row.try_get("source_file_sha256").map_err(provider)?,
                    updated_at: row.try_get("updated_at").map_err(provider)?,
                };
                prior.insert(stored.key(), stored);
            }
            let mut writes = Vec::new();
            for row in page {
                let object: Value = row.try_get("object_json").map_err(provider)?;
                let text = |key: &str| {
                    object[key]
                        .as_str()
                        .ok_or(CourseError::BadRequest("validated report field is missing"))
                };
                let report_row = ReservationReportRow::new(
                    text("sourceCourseKey")?,
                    text("sourceCourseName")?,
                    row.try_get("report_date").map_err(provider)?,
                    ReservationReportDayPart::parse(text("dayPart")?)?,
                    object["groupCount"]
                        .as_i64()
                        .ok_or(CourseError::BadRequest("invalid validated count"))?,
                    object["caddieAttachedGroupCount"]
                        .as_i64()
                        .ok_or(CourseError::BadRequest("invalid validated count"))?,
                )?;
                let entry = ExternalReservationReportEntry::new(
                    &report_row,
                    row.try_get::<Option<String>, _>("golf_course_id")
                        .map_err(provider)?
                        .map(CourseId::new),
                    source,
                )
                .with_source_system(DAILY_RESERVATION_STATUS_SOURCE);
                let mut stored =
                    StoredRow::from_entry(&entry, row.try_get("bucket").map_err(provider)?);
                stored.updated_at = Some(now);
                match prior.get(&stored.key()) {
                    Some(old) if old.matches(&stored) => {
                        summary.unchanged_count += 1;
                        stored.updated_at = old.updated_at;
                    }
                    Some(_) => summary.updated_count += 1,
                    None => summary.created_count += 1,
                }
                writes.push(stored);
            }
            let mut insert=QueryBuilder::<sqlx::MySql>::new("INSERT INTO golf_reservation_report_rows (tenant_id,bucket,golf_course_id,source_system,source_course_key,source_course_name,report_date,day_part,group_count,caddie_attached_group_count,source_file_sha256,updated_at) ");
            insert.push_values(&writes, |mut bind, row| {
                bind.push_bind(tenant)
                    .push_bind(&row.bucket)
                    .push_bind(&row.golf_course_id)
                    .push_bind(&row.source_system)
                    .push_bind(&row.source_course_key)
                    .push_bind(&row.source_course_name)
                    .push_bind(row.date)
                    .push_bind(row.day_part.as_str())
                    .push_bind(row.group_count)
                    .push_bind(row.caddie_attached_group_count)
                    .push_bind(&row.source_file_sha256)
                    .push_bind(row.updated_at);
            });
            insert.push(" ON DUPLICATE KEY UPDATE golf_course_id=VALUES(golf_course_id),source_system=VALUES(source_system),source_course_key=VALUES(source_course_key),source_course_name=VALUES(source_course_name),group_count=VALUES(group_count),caddie_attached_group_count=VALUES(caddie_attached_group_count),source_file_sha256=VALUES(source_file_sha256),updated_at=VALUES(updated_at)");
            insert.build().execute(&mut **tx).await.map_err(provider)?;
            after = last;
        }
        Ok(summary)
    }
}
