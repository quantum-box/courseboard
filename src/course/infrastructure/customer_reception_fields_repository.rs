//! CourseBoard's MySQL storage for reception-sheet field definitions.
//!
//! Standard customer columns and golf-specific custom questions share one
//! table so a single GET can return the exact schema the desk should draw.
//! Values are kept in a separate table (see the migration) and are written by
//! the reception registration use case, not by this settings repository.

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CustomerReceptionField, CustomerReceptionFieldsGateway, ReceptionFieldKind,
    ReceptionFieldType,
};

pub struct MySqlCustomerReceptionFieldsRepository {
    pool: MySqlPool,
}

impl MySqlCustomerReceptionFieldsRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl CustomerReceptionFieldsGateway for MySqlCustomerReceptionFieldsRepository {
    async fn list_customer_reception_fields(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<CustomerReceptionField>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT tenant_id, field_key, kind, field_type, enabled, required,
                   label, sort_order, CAST(options_json AS CHAR) AS options_json
            FROM golf_reception_fields
            WHERE tenant_id = ?
            ORDER BY sort_order, field_key
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.into_iter().map(row_to_field).collect()
    }

    async fn replace_customer_reception_fields(
        &self,
        tenant_id: &str,
        fields: &[CustomerReceptionField],
    ) -> Result<(), CourseError> {
        let mut transaction = self.pool.begin().await.map_err(provider)?;

        // Keep the update keyed to the rows this tenant owns. A blanket
        // tenant-range DELETE takes a wide range lock in TiDB and makes two
        // unrelated settings screens contend; named-key deletion plus upsert
        // follows the other CourseBoard configuration repositories.
        let existing =
            sqlx::query("SELECT field_key FROM golf_reception_fields WHERE tenant_id = ?")
                .bind(tenant_id)
                .fetch_all(&mut *transaction)
                .await
                .map_err(provider)?;
        let existing_keys = existing
            .iter()
            .map(|row| row.try_get::<String, _>("field_key").map_err(provider))
            .collect::<Result<Vec<_>, _>>()?;
        let requested_keys = fields
            .iter()
            .map(|field| field.field_key.as_str())
            .collect::<std::collections::HashSet<_>>();
        let dropped = existing_keys
            .into_iter()
            .filter(|key| !requested_keys.contains(key.as_str()))
            .collect::<Vec<_>>();
        if !dropped.is_empty() {
            let placeholders = vec!["?"; dropped.len()].join(", ");
            let statement = format!(
                "DELETE FROM golf_reception_fields WHERE tenant_id = ? AND field_key IN ({placeholders})"
            );
            let mut query = sqlx::query(&statement).bind(tenant_id);
            for key in &dropped {
                query = query.bind(key);
            }
            query.execute(&mut *transaction).await.map_err(provider)?;
        }

        for field in fields {
            let options_json = serde_json::to_string(&field.options).map_err(|error| {
                CourseError::Provider(format!("failed to encode reception field options: {error}"))
            })?;
            sqlx::query(
                r#"
                INSERT INTO golf_reception_fields
                    (tenant_id, field_key, kind, field_type, enabled, required,
                     label, sort_order, options_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    kind = VALUES(kind),
                    field_type = VALUES(field_type),
                    enabled = VALUES(enabled),
                    required = VALUES(required),
                    label = VALUES(label),
                    sort_order = VALUES(sort_order),
                    options_json = VALUES(options_json),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(&field.field_key)
            .bind(field.kind.as_str())
            .bind(field.field_type.as_str())
            .bind(field.enabled)
            .bind(field.required)
            .bind(&field.label)
            .bind(field.sort_order)
            .bind(options_json)
            .execute(&mut *transaction)
            .await
            .map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;
        Ok(())
    }
}

fn row_to_field(row: sqlx::mysql::MySqlRow) -> Result<CustomerReceptionField, CourseError> {
    let kind: String = row.try_get("kind").map_err(provider)?;
    let field_type: String = row.try_get("field_type").map_err(provider)?;
    let options_json: String = row.try_get("options_json").map_err(provider)?;
    let options = serde_json::from_str(&options_json).map_err(|error| {
        CourseError::Provider(format!(
            "database contains invalid reception field options: {error}"
        ))
    })?;
    Ok(CustomerReceptionField {
        tenant_id: row.try_get("tenant_id").map_err(provider)?,
        field_key: row.try_get("field_key").map_err(provider)?,
        kind: ReceptionFieldKind::parse(&kind)?,
        field_type: ReceptionFieldType::parse(&field_type)?,
        enabled: row.try_get("enabled").map_err(provider)?,
        required: row.try_get("required").map_err(provider)?,
        label: row.try_get("label").map_err(provider)?,
        sort_order: row.try_get("sort_order").map_err(provider)?,
        options,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{ReceptionFieldInput, STANDARD_RECEPTION_FIELD_KEYS};
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlCustomerReceptionFieldsRepository {
        MySqlCustomerReceptionFieldsRepository::new(test_pool().await)
    }

    fn custom() -> CustomerReceptionField {
        CustomerReceptionField::try_new(
            "tenant-1",
            ReceptionFieldInput {
                field_key: "golf_membership_type".to_string(),
                kind: ReceptionFieldKind::Custom,
                field_type: ReceptionFieldType::Select,
                enabled: true,
                required: false,
                label: Some("会員区分".to_string()),
                sort_order: 7,
                options: vec!["正会員".to_string(), "平日会員".to_string()],
            },
        )
        .unwrap()
    }

    #[tokio::test]
    async fn an_unconfigured_tenant_has_no_stored_rows() {
        let repository = repository().await;
        let tenant = test_tenant("reception-fields-empty");
        assert!(repository
            .list_customer_reception_fields(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn custom_definitions_round_trip_without_leaking_between_tenants() {
        let repository = repository().await;
        let tenant = test_tenant("reception-fields-round-trip");
        let mut field = custom();
        field.tenant_id = tenant.clone();
        repository
            .replace_customer_reception_fields(&tenant, &[field])
            .await
            .unwrap();

        let stored = repository
            .list_customer_reception_fields(&tenant)
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].field_key, "golf_membership_type");
        assert_eq!(stored[0].options, ["正会員", "平日会員"]);
        let other = test_tenant("reception-fields-other");
        assert!(repository
            .list_customer_reception_fields(&other)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(STANDARD_RECEPTION_FIELD_KEYS.len(), 7);
    }

    #[tokio::test]
    async fn replacement_removes_custom_fields_omitted_from_the_new_sheet() {
        let repository = repository().await;
        let tenant = test_tenant("reception-fields-replace");
        let mut field = custom();
        field.tenant_id = tenant.clone();
        repository
            .replace_customer_reception_fields(&tenant, &[field])
            .await
            .unwrap();
        repository
            .replace_customer_reception_fields(&tenant, &[])
            .await
            .unwrap();
        assert!(repository
            .list_customer_reception_fields(&tenant)
            .await
            .unwrap()
            .is_empty());
    }
}
