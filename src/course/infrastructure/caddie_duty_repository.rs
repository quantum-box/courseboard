//! CourseBoard's own storage for non-round caddie work.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_caddie_duties`, `golf_caddie_duty_assignments`).
//! Field's HRM knows that a staff member is at work; that this club sent them
//! to the practice range is golf's own and stays here (ADR-0005, ADR-0009).

use async_trait::async_trait;
use chrono::NaiveDate;
use sqlx::mysql::MySqlRow;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CaddieDutyAssignment, CaddieDutyGateway, CaddieDutyOptions, CaddieId, CourseError, DutyWindow,
};

pub struct MySqlCaddieDutyRepository {
    pool: MySqlPool,
}

impl MySqlCaddieDutyRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn to_assignment(row: &MySqlRow) -> Result<CaddieDutyAssignment, CourseError> {
    Ok(CaddieDutyAssignment::reconstitute(
        Some(row.try_get::<i64, _>("id").map_err(provider)?),
        CaddieId::new(row.try_get::<String, _>("caddie_id").map_err(provider)?),
        row.try_get("duty_date").map_err(provider)?,
        DutyWindow::reconstitute(
            row.try_get("start_minute").map_err(provider)?,
            row.try_get("end_minute").map_err(provider)?,
        ),
        row.try_get("duty_label").map_err(provider)?,
        row.try_get("note").map_err(provider)?,
        row.try_get("updated_by").map_err(provider)?,
    ))
}

#[async_trait]
impl CaddieDutyGateway for MySqlCaddieDutyRepository {
    async fn get_duty_options(&self, tenant_id: &str) -> Result<CaddieDutyOptions, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT label
            FROM golf_caddie_duties
            WHERE tenant_id = ?
            ORDER BY position
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut labels = Vec::with_capacity(rows.len());
        for row in &rows {
            labels.push(row.try_get::<String, _>("label").map_err(provider)?);
        }
        Ok(CaddieDutyOptions::reconstitute(labels))
    }

    async fn replace_duty_options(
        &self,
        tenant_id: &str,
        options: &CaddieDutyOptions,
    ) -> Result<CaddieDutyOptions, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;

        // Delete by named label and upsert the rest, exactly as the visitor
        // categories do: a blanket per-tenant DELETE locks a range wide enough
        // that two tenants saving at once deadlock each other on TiDB.
        let existing = sqlx::query("SELECT label FROM golf_caddie_duties WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(provider)?;
        let mut dropped = Vec::new();
        for row in &existing {
            let label: String = row.try_get("label").map_err(provider)?;
            if !options.options().contains(&label) {
                dropped.push(label);
            }
        }
        if !dropped.is_empty() {
            let placeholders = vec!["?"; dropped.len()].join(", ");
            let statement = format!(
                r#"
                DELETE FROM golf_caddie_duties
                WHERE tenant_id = ?
                  AND label IN ({placeholders})
                "#,
            );
            let mut query = sqlx::query(&statement).bind(tenant_id);
            for label in &dropped {
                query = query.bind(label);
            }
            query.execute(&mut *tx).await.map_err(provider)?;
        }

        for (position, label) in options.options().iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO golf_caddie_duties (tenant_id, label, position)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    position = VALUES(position),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(label)
            .bind(position as i32)
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(options.clone())
    }

    async fn list_duty_assignments(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CaddieDutyAssignment>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT id, duty_date, caddie_id, duty_label, start_minute, end_minute, note,
                   updated_by
            FROM golf_caddie_duty_assignments
            WHERE tenant_id = ?
              AND duty_date BETWEEN ? AND ?
            ORDER BY duty_date, start_minute, caddie_id
            "#,
        )
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.iter().map(to_assignment).collect()
    }

    async fn save_duty_assignment(
        &self,
        tenant_id: &str,
        assignment: &CaddieDutyAssignment,
    ) -> Result<CaddieDutyAssignment, CourseError> {
        // Keyed by the start, so re-filing the same stretch corrects it rather
        // than stacking a second row on the same minutes.
        sqlx::query(
            r#"
            INSERT INTO golf_caddie_duty_assignments
                (tenant_id, duty_date, caddie_id, duty_label, start_minute, end_minute, note,
                 updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                duty_label = VALUES(duty_label),
                end_minute = VALUES(end_minute),
                note = VALUES(note),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(assignment.date())
        .bind(assignment.caddie_id().as_str())
        .bind(assignment.duty_label())
        .bind(assignment.window().start_minute())
        .bind(assignment.window().end_minute())
        .bind(assignment.note())
        .bind(assignment.updated_by())
        .execute(&self.pool)
        .await
        .map_err(provider)?;

        // Read back rather than trusting `last_insert_id`: an upsert that
        // corrected an existing stretch reports 0 there, and the desk needs the
        // id of the row it is now looking at.
        let row = sqlx::query(
            r#"
            SELECT id, duty_date, caddie_id, duty_label, start_minute, end_minute, note,
                   updated_by
            FROM golf_caddie_duty_assignments
            WHERE tenant_id = ?
              AND duty_date = ?
              AND caddie_id = ?
              AND start_minute = ?
            "#,
        )
        .bind(tenant_id)
        .bind(assignment.date())
        .bind(assignment.caddie_id().as_str())
        .bind(assignment.window().start_minute())
        .fetch_one(&self.pool)
        .await
        .map_err(provider)?;
        to_assignment(&row)
    }

    async fn delete_duty_assignment(
        &self,
        tenant_id: &str,
        duty_id: i64,
    ) -> Result<bool, CourseError> {
        let result = sqlx::query(
            r#"
            DELETE FROM golf_caddie_duty_assignments
            WHERE tenant_id = ?
              AND id = ?
            "#,
        )
        .bind(tenant_id)
        .bind(duty_id)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(result.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, day).expect("date")
    }

    fn duties(labels: &[&str]) -> CaddieDutyOptions {
        CaddieDutyOptions::try_new(labels.iter().map(|label| label.to_string()).collect())
            .expect("duties")
    }

    fn window(from_hour: i32, to_hour: i32) -> DutyWindow {
        DutyWindow::try_new(from_hour * 60, to_hour * 60).expect("window")
    }

    fn assignment(caddie: &str, day: u32, label: &str, window: DutyWindow) -> CaddieDutyAssignment {
        CaddieDutyAssignment::try_new(
            CaddieId::new(caddie),
            date(day),
            window,
            label,
            Some("9番ホール".into()),
            Some("受付".into()),
        )
        .expect("assignment")
    }

    async fn repository() -> MySqlCaddieDutyRepository {
        MySqlCaddieDutyRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn a_club_that_never_arranged_its_jobs_reads_back_empty() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duties-unset");
        assert!(repository
            .get_duty_options(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn the_job_list_survives_the_round_trip_in_the_order_it_was_arranged() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duties-round-trip");
        repository
            .replace_duty_options(&tenant, &duties(&["コース整備", "練習場", "フロント補助"]))
            .await
            .unwrap();

        let stored = repository.get_duty_options(&tenant).await.unwrap();
        assert_eq!(stored.options(), ["コース整備", "練習場", "フロント補助"]);
    }

    #[tokio::test]
    async fn rearranging_and_dropping_replaces_the_list_rather_than_stacking() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duties-rearrange");
        repository
            .replace_duty_options(&tenant, &duties(&["コース整備", "練習場", "フロント補助"]))
            .await
            .unwrap();
        repository
            .replace_duty_options(&tenant, &duties(&["練習場", "コース整備"]))
            .await
            .unwrap();

        let stored = repository.get_duty_options(&tenant).await.unwrap();
        assert_eq!(stored.options(), ["練習場", "コース整備"]);
    }

    #[tokio::test]
    async fn a_filed_stretch_reads_back_with_its_window_note_and_id() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duty-day");
        let saved = repository
            .save_duty_assignment(
                &tenant,
                &assignment("cp_1", 12, "コース整備", window(8, 12)),
            )
            .await
            .unwrap();
        assert!(saved.id().is_some());

        let filed = repository
            .list_duty_assignments(&tenant, date(12), date(12))
            .await
            .unwrap();
        assert_eq!(filed.len(), 1);
        assert_eq!(filed[0].id(), saved.id());
        assert_eq!(filed[0].caddie_id().as_str(), "cp_1");
        assert_eq!(filed[0].duty_label(), "コース整備");
        assert_eq!(filed[0].window(), window(8, 12));
        assert_eq!(filed[0].note(), Some("9番ホール"));
    }

    #[tokio::test]
    async fn a_morning_and_an_afternoon_job_both_stand_on_one_day() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duty-two");
        repository
            .save_duty_assignment(
                &tenant,
                &assignment("cp_1", 13, "コース整備", window(8, 12)),
            )
            .await
            .unwrap();
        repository
            .save_duty_assignment(&tenant, &assignment("cp_1", 13, "練習場", window(12, 17)))
            .await
            .unwrap();

        let filed = repository
            .list_duty_assignments(&tenant, date(13), date(13))
            .await
            .unwrap();
        assert_eq!(filed.len(), 2);
        assert_eq!(filed[0].duty_label(), "コース整備");
        assert_eq!(filed[1].duty_label(), "練習場");
    }

    #[tokio::test]
    async fn refiling_the_same_stretch_corrects_it_rather_than_stacking() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duty-refile");
        let first = repository
            .save_duty_assignment(
                &tenant,
                &assignment("cp_1", 14, "コース整備", window(8, 12)),
            )
            .await
            .unwrap();
        let second = repository
            .save_duty_assignment(&tenant, &assignment("cp_1", 14, "練習場", window(8, 11)))
            .await
            .unwrap();

        assert_eq!(first.id(), second.id());
        let filed = repository
            .list_duty_assignments(&tenant, date(14), date(14))
            .await
            .unwrap();
        assert_eq!(filed.len(), 1);
        assert_eq!(filed[0].duty_label(), "練習場");
        assert_eq!(filed[0].window(), window(8, 11));
    }

    #[tokio::test]
    async fn clearing_one_job_says_whether_anything_was_there_and_leaves_the_other() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duty-clear");
        let morning = repository
            .save_duty_assignment(
                &tenant,
                &assignment("cp_1", 15, "コース整備", window(8, 12)),
            )
            .await
            .unwrap();
        repository
            .save_duty_assignment(&tenant, &assignment("cp_1", 15, "練習場", window(13, 17)))
            .await
            .unwrap();

        let duty_id = morning.id().expect("id");
        assert!(repository
            .delete_duty_assignment(&tenant, duty_id)
            .await
            .unwrap());
        assert!(!repository
            .delete_duty_assignment(&tenant, duty_id)
            .await
            .unwrap());

        let left = repository
            .list_duty_assignments(&tenant, date(15), date(15))
            .await
            .unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].duty_label(), "練習場");
    }

    #[tokio::test]
    async fn the_range_read_leaves_the_days_around_it_alone() {
        let repository = repository().await;
        let tenant = test_tenant("caddie-duty-range");
        repository
            .save_duty_assignment(
                &tenant,
                &assignment("cp_1", 20, "コース整備", DutyWindow::all_day()),
            )
            .await
            .unwrap();
        repository
            .save_duty_assignment(
                &tenant,
                &assignment("cp_2", 22, "練習場", DutyWindow::all_day()),
            )
            .await
            .unwrap();

        let filed = repository
            .list_duty_assignments(&tenant, date(20), date(21))
            .await
            .unwrap();
        assert_eq!(filed.len(), 1);
        assert_eq!(filed[0].caddie_id().as_str(), "cp_1");
    }

    #[tokio::test]
    async fn one_clubs_jobs_are_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("caddie-duties-ours");
        let theirs = test_tenant("caddie-duties-theirs");
        repository
            .replace_duty_options(&ours, &duties(&["コース整備"]))
            .await
            .unwrap();
        repository
            .save_duty_assignment(
                &ours,
                &assignment("cp_1", 25, "コース整備", DutyWindow::all_day()),
            )
            .await
            .unwrap();

        assert!(repository
            .get_duty_options(&theirs)
            .await
            .unwrap()
            .is_empty());
        assert!(repository
            .list_duty_assignments(&theirs, date(25), date(25))
            .await
            .unwrap()
            .is_empty());
    }
}
