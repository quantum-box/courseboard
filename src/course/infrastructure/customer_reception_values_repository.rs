//! CourseBoard's MySQL storage for answers to custom reception fields.
//!
//! A Field customer is the source of truth for standard customer columns. A
//! golf-specific answer has no generic ERP meaning, so it stays here under
//! the upstream customer id. The whole answer set is written in one local
//! transaction after the upstream customer has been created.

use async_trait::async_trait;
use sqlx::MySqlPool;

use crate::course::domain::{CourseError, CustomerId, CustomerReceptionValuesGateway};

pub struct MySqlCustomerReceptionValuesRepository {
    pool: MySqlPool,
}

impl MySqlCustomerReceptionValuesRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl CustomerReceptionValuesGateway for MySqlCustomerReceptionValuesRepository {
    async fn record_customer_reception_values(
        &self,
        tenant_id: &str,
        customer_id: &CustomerId,
        values: &std::collections::BTreeMap<String, serde_json::Value>,
    ) -> Result<(), CourseError> {
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for (field_key, value) in values {
            let value_json = serde_json::to_string(value).map_err(|error| {
                CourseError::Provider(format!("failed to encode reception field value: {error}"))
            })?;
            sqlx::query(
                r#"
                INSERT INTO golf_customer_reception_values
                    (tenant_id, customer_id, field_key, value_json)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    value_json = VALUES(value_json),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(customer_id.as_str())
            .bind(field_key)
            .bind(value_json)
            .execute(&mut *transaction)
            .await
            .map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    #[tokio::test]
    async fn custom_answers_are_scoped_to_the_customer_and_tenant() {
        let repository = MySqlCustomerReceptionValuesRepository::new(test_pool().await);
        let tenant = test_tenant("reception-values-round-trip");
        let customer = CustomerId::new("cus_reception_values");
        let values = std::collections::BTreeMap::from([
            ("membership_type".to_string(), serde_json::json!("正会員")),
            ("cart_required".to_string(), serde_json::json!(true)),
        ]);
        repository
            .record_customer_reception_values(&tenant, &customer, &values)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM golf_customer_reception_values WHERE tenant_id = ? AND customer_id = ?",
        )
        .bind(&tenant)
        .bind(customer.as_str())
        .fetch_one(&repository.pool)
        .await
        .unwrap();
        assert_eq!(count, 2);
    }
}
