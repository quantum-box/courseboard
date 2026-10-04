//! Durable schema snapshots for Field OCR jobs. No sheets or draft rows are stored.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CustomerReceptionOcrJobContextGateway, ReceptionOcrJobContext,
};

pub struct MySqlReceptionOcrJobContextRepository {
    pool: MySqlPool,
}

impl MySqlReceptionOcrJobContextRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn decode(row: sqlx::mysql::MySqlRow) -> Result<ReceptionOcrJobContext, CourseError> {
    let json: String = row.try_get("context_json").map_err(provider)?;
    serde_json::from_str(&json)
        .map_err(|error| CourseError::Provider(format!("invalid OCR job context: {error}")))
}

#[async_trait]
impl CustomerReceptionOcrJobContextGateway for MySqlReceptionOcrJobContextRepository {
    async fn find_by_key(
        &self,
        tenant_id: &str,
        key: &str,
    ) -> Result<Option<ReceptionOcrJobContext>, CourseError> {
        sqlx::query(
            "SELECT CAST(context_json AS CHAR) AS context_json FROM golf_reception_ocr_job_contexts WHERE tenant_id = ? AND idempotency_key = ? AND COALESCE(expires_at, created_at + INTERVAL 24 HOUR) > CURRENT_TIMESTAMP(6)",
        )
        .bind(tenant_id)
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?
        .map(decode)
        .transpose()
    }

    async fn reserve(
        &self,
        tenant_id: &str,
        key: &str,
        context: &ReceptionOcrJobContext,
    ) -> Result<ReceptionOcrJobContext, CourseError> {
        // Each new intake retires expired metadata across tenants, including
        // reservations whose upstream create failed. Limit each sweep's work.
        sqlx::query(
            "DELETE FROM golf_reception_ocr_job_contexts WHERE expires_at <= CURRENT_TIMESTAMP(6) OR (expires_at IS NULL AND created_at <= CURRENT_TIMESTAMP(6) - INTERVAL 24 HOUR) LIMIT 1000",
        )
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        let json = serde_json::to_string(context)
            .map_err(|error| CourseError::Provider(format!("invalid OCR job context: {error}")))?;
        sqlx::query(
            "INSERT INTO golf_reception_ocr_job_contexts (tenant_id, idempotency_key, context_json, expires_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(6) + INTERVAL 24 HOUR) ON DUPLICATE KEY UPDATE idempotency_key = idempotency_key",
        )
        .bind(tenant_id)
        .bind(key)
        .bind(json)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        self.find_by_key(tenant_id, key)
            .await?
            .ok_or_else(|| CourseError::Provider("OCR job context disappeared".into()))
    }

    async fn bind_job(
        &self,
        tenant_id: &str,
        key: &str,
        job_id: &str,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<(), CourseError> {
        sqlx::query(
            "UPDATE golf_reception_ocr_job_contexts SET job_id = ?, expires_at = COALESCE(?, expires_at) WHERE tenant_id = ? AND idempotency_key = ? AND (job_id IS NULL OR job_id = ?)",
        )
        .bind(job_id)
        .bind(expires_at)
        .bind(tenant_id)
        .bind(key)
        .bind(job_id)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        if self.find_by_job(tenant_id, job_id).await?.is_none() {
            return Err(CourseError::Conflict(
                "OCR job does not match its original context",
            ));
        }
        Ok(())
    }

    async fn find_by_job(
        &self,
        tenant_id: &str,
        job_id: &str,
    ) -> Result<Option<ReceptionOcrJobContext>, CourseError> {
        sqlx::query(
            "SELECT CAST(context_json AS CHAR) AS context_json FROM golf_reception_ocr_job_contexts WHERE tenant_id = ? AND job_id = ? AND COALESCE(expires_at, created_at + INTERVAL 24 HOUR) > CURRENT_TIMESTAMP(6)",
        )
        .bind(tenant_id)
        .bind(job_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?
        .map(decode)
        .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{CustomerReceptionField, ReceptionConsentDefinition};
    use crate::test_support::{test_pool, test_tenant};

    #[tokio::test]
    async fn retries_and_job_reads_keep_the_original_schema_and_tenant() {
        let pool = test_pool().await;
        let repository = MySqlReceptionOcrJobContextRepository::new(pool.clone());
        let tenant = test_tenant("ocr-context-original");
        let original = ReceptionOcrJobContext {
            fields: CustomerReceptionField::merge_with_defaults(&tenant, vec![]),
            consents: vec![ReceptionConsentDefinition::new(
                "terms", "Original", None, true, 0,
            )],
        };
        repository
            .reserve(&tenant, "retry-key", &original)
            .await
            .unwrap();
        repository
            .bind_job(&tenant, "retry-key", "job-original", None)
            .await
            .unwrap();
        let mut changed = original.clone();
        changed.consents[0].label = "Changed".into();
        changed.fields[0].label = Some("Changed".into());
        assert_eq!(
            repository
                .reserve(&tenant, "retry-key", &changed)
                .await
                .unwrap(),
            original
        );
        let restarted = MySqlReceptionOcrJobContextRepository::new(pool);
        assert_eq!(
            restarted
                .find_by_job(&tenant, "job-original")
                .await
                .unwrap(),
            Some(original)
        );
        assert!(restarted
            .find_by_job("other-tenant", "job-original")
            .await
            .unwrap()
            .is_none());
        assert!(repository
            .bind_job(&tenant, "retry-key", "different-job", None)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn expired_contexts_are_unreadable_and_the_next_intake_removes_them() {
        let pool = test_pool().await;
        let repository = MySqlReceptionOcrJobContextRepository::new(pool.clone());
        let tenant = test_tenant("ocr-context-expiry");
        let context = ReceptionOcrJobContext {
            fields: vec![],
            consents: vec![],
        };
        repository
            .reserve(&tenant, "expired-key", &context)
            .await
            .unwrap();
        sqlx::query("UPDATE golf_reception_ocr_job_contexts SET expires_at = CURRENT_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE tenant_id = ?")
            .bind(&tenant).execute(&pool).await.unwrap();
        assert!(repository
            .find_by_key(&tenant, "expired-key")
            .await
            .unwrap()
            .is_none());
        repository
            .reserve(&tenant, "new-key", &context)
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM golf_reception_ocr_job_contexts WHERE tenant_id = ? AND idempotency_key = 'expired-key'")
            .bind(&tenant).fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
    }
}
