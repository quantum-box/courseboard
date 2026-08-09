//! CourseBoard's own storage for the shift-request filing deadline and the
//! desk's explicit monthly confirmation for each caddie.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_availability_deadlines`). Field's shift-request
//! API has no notion of a filing deadline, so it has nowhere upstream to
//! live; see ADR-0005.

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    AvailabilityConfirmation, AvailabilityConfirmationGateway, AvailabilityDeadline,
    AvailabilityDeadlineGateway, CaddieId, CourseError, YearMonth,
};

pub struct MySqlAvailabilityDeadlineRepository {
    pool: MySqlPool,
}

impl MySqlAvailabilityDeadlineRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl AvailabilityDeadlineGateway for MySqlAvailabilityDeadlineRepository {
    async fn get_deadline(
        &self,
        tenant_id: &str,
        year_month: YearMonth,
    ) -> Result<Option<AvailabilityDeadline>, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT deadline_date
            FROM golf_availability_deadlines
            WHERE tenant_id = ?
              AND `year_month` = ?
            "#,
        )
        .bind(tenant_id)
        .bind(year_month.as_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        Ok(match row {
            Some(row) => {
                let deadline_date: NaiveDate = row.try_get("deadline_date").map_err(provider)?;
                Some(AvailabilityDeadline::reconstitute(
                    year_month,
                    deadline_date,
                ))
            }
            None => None,
        })
    }

    async fn upsert_deadline(
        &self,
        tenant_id: &str,
        deadline: AvailabilityDeadline,
    ) -> Result<AvailabilityDeadline, CourseError> {
        sqlx::query(
            r#"
            INSERT INTO golf_availability_deadlines (tenant_id, `year_month`, deadline_date)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                deadline_date = VALUES(deadline_date),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(deadline.year_month().as_string())
        .bind(deadline.deadline_date())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(deadline)
    }
}

#[async_trait]
impl AvailabilityConfirmationGateway for MySqlAvailabilityDeadlineRepository {
    async fn list_confirmations(
        &self,
        tenant_id: &str,
        year_month: YearMonth,
    ) -> Result<Vec<AvailabilityConfirmation>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT caddie_profile_id, confirmed_at
            FROM golf_availability_confirmations
            WHERE tenant_id = ?
              AND `year_month` = ?
            ORDER BY caddie_profile_id
            "#,
        )
        .bind(tenant_id)
        .bind(year_month.as_string())
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.into_iter()
            .map(|row| {
                let caddie_id: String = row.try_get("caddie_profile_id").map_err(provider)?;
                let confirmed_at: DateTime<Utc> = row.try_get("confirmed_at").map_err(provider)?;
                Ok(AvailabilityConfirmation::reconstitute(
                    year_month,
                    caddie_id,
                    confirmed_at,
                ))
            })
            .collect()
    }

    async fn confirm(
        &self,
        tenant_id: &str,
        year_month: YearMonth,
        caddie_id: &CaddieId,
    ) -> Result<AvailabilityConfirmation, CourseError> {
        sqlx::query(
            r#"
            INSERT INTO golf_availability_confirmations (
                tenant_id, `year_month`, caddie_profile_id
            )
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                confirmed_at = CURRENT_TIMESTAMP(6),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(year_month.as_string())
        .bind(caddie_id.as_str())
        .execute(&self.pool)
        .await
        .map_err(provider)?;

        let row = sqlx::query(
            r#"
            SELECT confirmed_at
            FROM golf_availability_confirmations
            WHERE tenant_id = ?
              AND `year_month` = ?
              AND caddie_profile_id = ?
            "#,
        )
        .bind(tenant_id)
        .bind(year_month.as_string())
        .bind(caddie_id.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(provider)?;
        let confirmed_at: DateTime<Utc> = row.try_get("confirmed_at").map_err(provider)?;
        Ok(AvailabilityConfirmation::reconstitute(
            year_month,
            caddie_id.clone(),
            confirmed_at,
        ))
    }

    async fn remove_confirmation(
        &self,
        tenant_id: &str,
        year_month: YearMonth,
        caddie_id: &CaddieId,
    ) -> Result<(), CourseError> {
        sqlx::query(
            r#"
            DELETE FROM golf_availability_confirmations
            WHERE tenant_id = ?
              AND `year_month` = ?
              AND caddie_profile_id = ?
            "#,
        )
        .bind(tenant_id)
        .bind(year_month.as_string())
        .bind(caddie_id.as_str())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn deadline(year_month: &str, deadline_date: &str) -> AvailabilityDeadline {
        AvailabilityDeadline::try_new(
            YearMonth::parse(year_month).unwrap(),
            NaiveDate::parse_from_str(deadline_date, "%Y-%m-%d").unwrap(),
        )
    }

    #[tokio::test]
    async fn a_deadline_survives_the_round_trip_through_storage() {
        let repository = MySqlAvailabilityDeadlineRepository::new(test_pool().await);
        let tenant = test_tenant("deadline-roundtrip");
        repository
            .upsert_deadline(&tenant, deadline("2026-08", "2026-07-20"))
            .await
            .unwrap();

        let stored = repository
            .get_deadline(&tenant, YearMonth::parse("2026-08").unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.deadline_date(),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap()
        );
    }

    #[tokio::test]
    async fn setting_it_again_replaces_the_date_rather_than_stacking_a_second_deadline() {
        let repository = MySqlAvailabilityDeadlineRepository::new(test_pool().await);
        let tenant = test_tenant("deadline-remark");
        repository
            .upsert_deadline(&tenant, deadline("2026-09", "2026-08-20"))
            .await
            .unwrap();
        repository
            .upsert_deadline(&tenant, deadline("2026-09", "2026-08-25"))
            .await
            .unwrap();

        let stored = repository
            .get_deadline(&tenant, YearMonth::parse("2026-09").unwrap())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.deadline_date(),
            NaiveDate::from_ymd_opt(2026, 8, 25).unwrap()
        );
    }

    #[tokio::test]
    async fn a_month_with_no_deadline_set_reads_back_as_none() {
        let repository = MySqlAvailabilityDeadlineRepository::new(test_pool().await);
        let tenant = test_tenant("deadline-unset");
        let stored = repository
            .get_deadline(&tenant, YearMonth::parse("2026-10").unwrap())
            .await
            .unwrap();
        assert!(stored.is_none());
    }

    #[tokio::test]
    async fn one_tenants_deadline_is_invisible_to_another() {
        let repository = MySqlAvailabilityDeadlineRepository::new(test_pool().await);
        repository
            .upsert_deadline(
                &test_tenant("deadline-isolation-a"),
                deadline("2026-08", "2026-07-20"),
            )
            .await
            .unwrap();

        let stored = repository
            .get_deadline(
                &test_tenant("deadline-isolation-b"),
                YearMonth::parse("2026-08").unwrap(),
            )
            .await
            .unwrap();
        assert!(stored.is_none());
    }

    #[tokio::test]
    async fn a_confirmation_survives_storage_and_can_be_removed() {
        let repository = MySqlAvailabilityDeadlineRepository::new(test_pool().await);
        let tenant = test_tenant("confirmation-roundtrip");
        let month = YearMonth::parse("2026-08").unwrap();
        let caddie_id = CaddieId::new("golfcad_confirmed");

        let saved = repository
            .confirm(&tenant, month, &caddie_id)
            .await
            .unwrap();
        assert_eq!(saved.caddie_id(), &caddie_id);
        assert_eq!(saved.year_month(), month);

        let stored = repository.list_confirmations(&tenant, month).await.unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].caddie_id(), &caddie_id);

        repository
            .remove_confirmation(&tenant, month, &caddie_id)
            .await
            .unwrap();
        assert!(repository
            .list_confirmations(&tenant, month)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn confirmations_are_isolated_by_tenant_and_month() {
        let repository = MySqlAvailabilityDeadlineRepository::new(test_pool().await);
        let tenant = test_tenant("confirmation-isolation");
        let other_tenant = test_tenant("confirmation-isolation-other");
        let august = YearMonth::parse("2026-08").unwrap();
        let september = YearMonth::parse("2026-09").unwrap();
        let caddie_id = CaddieId::new("golfcad_confirmed");
        repository
            .confirm(&tenant, august, &caddie_id)
            .await
            .unwrap();

        assert!(repository
            .list_confirmations(&tenant, september)
            .await
            .unwrap()
            .is_empty());
        assert!(repository
            .list_confirmations(&other_tenant, august)
            .await
            .unwrap()
            .is_empty());
    }
}
