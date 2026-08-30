//! CourseBoard's own storage for where a ledger entry came from.
//!
//! Reads and writes `golf_customer_registrations` in CourseBoard's MySQL. The
//! customer itself stays in Field; only the act of creating it is ours
//! (ADR-0009).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CustomerId, CustomerRegistration, CustomerRegistrationGateway,
    CustomerRegistrationSource, NewCustomerRegistration,
};

pub struct MySqlCustomerRegistrationRepository {
    pool: MySqlPool,
}

impl MySqlCustomerRegistrationRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl CustomerRegistrationGateway for MySqlCustomerRegistrationRepository {
    async fn record_customer_registration(
        &self,
        tenant_id: &str,
        entry: &NewCustomerRegistration,
    ) -> Result<(), CourseError> {
        // `INSERT IGNORE` rather than an upsert: provenance is where an entry
        // first came from. A retry that reaches here twice must not rewrite
        // the sheet it was originally read off.
        sqlx::query(
            r#"
            INSERT IGNORE INTO golf_customer_registrations
                (tenant_id, customer_id, source, registered_by, source_row_index)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(tenant_id)
        .bind(entry.customer_id().as_str())
        .bind(entry.source().as_str())
        .bind(entry.registered_by())
        .bind(entry.source_row_index())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }

    async fn get_customer_registration(
        &self,
        tenant_id: &str,
        customer_id: &CustomerId,
    ) -> Result<Option<CustomerRegistration>, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT source, registered_by, source_row_index, created_at
            FROM golf_customer_registrations
            WHERE tenant_id = ? AND customer_id = ?
            "#,
        )
        .bind(tenant_id)
        .bind(customer_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        let Some(row) = row else {
            return Ok(None);
        };
        let stored: String = row.try_get("source").map_err(provider)?;
        // A row written under a name this build no longer knows — a rollback,
        // in practice. Reading it as "typed at the counter" would be a lie and
        // failing the request would take the customer's whole page down with
        // it, so the page says nothing was recorded and the log says why.
        let Ok(source) = CustomerRegistrationSource::parse(&stored) else {
            tracing::warn!(
                source = %stored,
                "customer registration has a source this build cannot read"
            );
            return Ok(None);
        };
        Ok(Some(CustomerRegistration {
            customer_id: customer_id.clone(),
            source,
            registered_by: row.try_get("registered_by").map_err(provider)?,
            source_row_index: row.try_get("source_row_index").map_err(provider)?,
            created_at: row
                .try_get::<DateTime<Utc>, _>("created_at")
                .map_err(provider)?,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlCustomerRegistrationRepository {
        MySqlCustomerRegistrationRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn somebody_registered_before_this_was_kept_reads_back_as_nothing() {
        // Most of the ledger, for a long while. The screen has to say "not
        // recorded" rather than treat it as a failure.
        let repository = repository().await;
        let tenant = test_tenant("registration-absent");
        let found = repository
            .get_customer_registration(&tenant, &CustomerId::new("cus_missing"))
            .await
            .unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn the_sheet_and_the_line_survive_the_round_trip() {
        let repository = repository().await;
        let tenant = test_tenant("registration-sheet");
        let entry = NewCustomerRegistration::new(
            CustomerId::new("cus_1"),
            CustomerRegistrationSource::ReceptionSheet,
            Some("user-1".to_string()),
            Some(2),
        );
        repository
            .record_customer_registration(&tenant, &entry)
            .await
            .unwrap();

        let stored = repository
            .get_customer_registration(&tenant, &CustomerId::new("cus_1"))
            .await
            .unwrap()
            .expect("recorded");
        assert_eq!(stored.source, CustomerRegistrationSource::ReceptionSheet);
        assert_eq!(stored.source_row_index, Some(2));
        assert_eq!(stored.registered_by.as_deref(), Some("user-1"));
    }

    #[tokio::test]
    async fn a_second_write_keeps_where_the_entry_first_came_from() {
        // Provenance is the first answer, not the latest one. A retried request
        // must not rewrite the sheet the entry was originally read off.
        let repository = repository().await;
        let tenant = test_tenant("registration-first-wins");
        repository
            .record_customer_registration(
                &tenant,
                &NewCustomerRegistration::new(
                    CustomerId::new("cus_1"),
                    CustomerRegistrationSource::ReceptionSheet,
                    Some("user-1".to_string()),
                    Some(2),
                ),
            )
            .await
            .unwrap();
        repository
            .record_customer_registration(
                &tenant,
                &NewCustomerRegistration::new(
                    CustomerId::new("cus_1"),
                    CustomerRegistrationSource::Manual,
                    Some("user-2".to_string()),
                    None,
                ),
            )
            .await
            .unwrap();

        let stored = repository
            .get_customer_registration(&tenant, &CustomerId::new("cus_1"))
            .await
            .unwrap()
            .expect("recorded");
        assert_eq!(stored.source, CustomerRegistrationSource::ReceptionSheet);
        assert_eq!(stored.source_row_index, Some(2));
    }

    #[tokio::test]
    async fn one_clubs_registrations_are_invisible_to_another() {
        let repository = repository().await;
        let mine = test_tenant("registration-mine");
        let theirs = test_tenant("registration-theirs");
        repository
            .record_customer_registration(
                &mine,
                &NewCustomerRegistration::new(
                    CustomerId::new("cus_1"),
                    CustomerRegistrationSource::Manual,
                    None,
                    None,
                ),
            )
            .await
            .unwrap();

        assert!(repository
            .get_customer_registration(&theirs, &CustomerId::new("cus_1"))
            .await
            .unwrap()
            .is_none());
    }
}
