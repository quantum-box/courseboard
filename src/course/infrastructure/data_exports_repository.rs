use super::field_gateway::{field_send_json, normalize_base_url, urlencoding_path};
use crate::course::domain::{
    data_exports::{DataExportField, DataExportGateway, DataExportObject},
    CourseError, GatewayCredentials,
};
use async_trait::async_trait;
use futures::{stream, StreamExt, TryStreamExt};
use serde_json::Value;
use sqlx::{MySqlPool, Row};

pub struct MySqlDataExportRepository {
    pool: MySqlPool,
    client: reqwest::Client,
    field_url: String,
}
impl MySqlDataExportRepository {
    pub fn new(pool: MySqlPool, client: reqwest::Client, field_url: Option<&str>) -> Self {
        Self {
            pool,
            client,
            field_url: normalize_base_url(field_url),
        }
    }
    async fn reception_rows(
        &self,
        credentials: GatewayCredentials<'_>,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Value>, CourseError> {
        let registrations = sqlx::query("SELECT customer_id, source, registered_by, source_row_index, created_at FROM golf_customer_registrations WHERE tenant_id = ? AND source = 'reception_sheet' ORDER BY id LIMIT ? OFFSET ?")
            .bind(credentials.operator_id).bind(limit).bind(offset).fetch_all(&self.pool).await.map_err(provider)?;
        stream::iter(registrations).map(|row| async move {
            let id: String = row.try_get("customer_id").map_err(provider)?;
            let path = format!("/v1/storekit/customers/{}", urlencoding_path(&id));
            let customer: Result<Value, CourseError> = field_send_json(&self.client, &self.field_url, reqwest::Method::GET, &path, credentials, None).await;
            let customer = match customer {
                Ok(value) if value.is_object() && value.get("name").is_some_and(Value::is_string) => Some(value),
                Ok(_) => return Err(CourseError::Provider("customer export response is invalid".into())),
                Err(CourseError::UpstreamClient { status: 404, .. }) | Err(CourseError::NotFound(_)) => None,
                Err(error) => return Err(error),
            };
            let customer_available = customer.is_some();
            let customer = customer.unwrap_or(Value::Null);
            let mut document = serde_json::Map::new();
            document.insert("customer_id".into(), Value::String(id.clone()));
            document.insert("customer_available".into(), Value::Bool(customer_available));
            for (target, source) in [("name", "name"), ("name_kana", "name_kana"), ("phone", "phone"), ("email", "email"), ("birth_date", "birth_date"), ("sex", "sex")] {
                document.insert(target.into(), customer.get(source).cloned().unwrap_or(Value::Null));
            }
            for field in ["postalCode", "state", "city", "address1", "address2"] {
                document.insert(field.into(), customer.get("address").and_then(|address| address.get(field)).cloned().unwrap_or(Value::Null));
            }
            document.insert("source".into(), Value::String(row.try_get("source").map_err(provider)?));
            document.insert("registered_by".into(), serde_json::to_value(row.try_get::<Option<String>, _>("registered_by").map_err(provider)?).map_err(json_error)?);
            document.insert("source_row_index".into(), serde_json::to_value(row.try_get::<Option<u32>, _>("source_row_index").map_err(provider)?).map_err(json_error)?);
            document.insert("created_at".into(), Value::String(row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map_err(provider)?.to_rfc3339()));
            let answers = sqlx::query("SELECT field_key, CAST(value_json AS CHAR) AS value_json FROM golf_customer_reception_values WHERE tenant_id = ? AND customer_id = ? ORDER BY field_key")
                .bind(credentials.operator_id).bind(&id).fetch_all(&self.pool).await.map_err(provider)?;
            for answer in answers {
                let key: String = answer.try_get("field_key").map_err(provider)?;
                let value: String = answer.try_get("value_json").map_err(provider)?;
                document.insert(format!("custom.{key}"), serde_json::from_str(&value).map_err(json_error)?);
            }
            Ok(Value::Object(document))
        }).buffered(8).try_collect().await
    }
}
fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}
fn json_error(error: serde_json::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl DataExportGateway for MySqlDataExportRepository {
    async fn custom_fields(&self, tenant_id: &str) -> Result<Vec<DataExportField>, CourseError> {
        // Retain historical answers even when an input field has been removed.
        let rows = sqlx::query("SELECT keys_union.field_key, COALESCE(NULLIF(f.label, ''), keys_union.field_key) AS label FROM (SELECT field_key FROM golf_reception_fields WHERE tenant_id = ? AND kind = 'custom' UNION SELECT field_key FROM golf_customer_reception_values WHERE tenant_id = ?) keys_union LEFT JOIN golf_reception_fields f ON f.tenant_id = ? AND f.field_key = keys_union.field_key ORDER BY COALESCE(f.sort_order, 2147483647), keys_union.field_key")
            .bind(tenant_id).bind(tenant_id).bind(tenant_id).fetch_all(&self.pool).await.map_err(provider)?;
        rows.into_iter()
            .map(|row| {
                Ok(DataExportField {
                    field: format!(
                        "custom.{}",
                        row.try_get::<String, _>("field_key").map_err(provider)?
                    ),
                    label: row.try_get("label").map_err(provider)?,
                })
            })
            .collect()
    }
    async fn rows(
        &self,
        credentials: GatewayCredentials<'_>,
        object: &DataExportObject,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Value>, CourseError> {
        if object.key == "reception" {
            return self.reception_rows(credentials, offset, limit).await;
        }
        // Table and columns come only from the compiled catalogue, never from
        // URL parameters. Tenant and pagination values remain bound parameters.
        let projection = object
            .fields
            .iter()
            .map(|field| format!("'{}', `{}`", field.field, field.field))
            .collect::<Vec<_>>()
            .join(", ");
        let order = match object.key.as_str() {
            "receptionFields" => "field_key",
            "receptionAnswers" => "customer_id, field_key",
            _ => "id",
        };
        let statement = format!("SELECT CAST(JSON_OBJECT({projection}) AS CHAR) AS document FROM `{}` WHERE tenant_id = ? ORDER BY {order} LIMIT ? OFFSET ?", object.table);
        let rows = sqlx::query(&statement)
            .bind(credentials.operator_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(provider)?;
        rows.into_iter()
            .map(|row| {
                row.try_get::<String, _>("document")
                    .map_err(provider)
                    .and_then(|json| serde_json::from_str(&json).map_err(json_error))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        course::domain::data_exports::data_export_objects,
        test_support::{test_pool, test_tenant},
    };
    #[tokio::test]
    async fn data_export_queries_match_the_schema_and_scope_custom_answers_to_the_tenant() {
        let pool = test_pool().await;
        let tenant = test_tenant("data-export-schema");
        let other = test_tenant("data-export-other");
        let repository = MySqlDataExportRepository::new(
            pool.clone(),
            reqwest::Client::new(),
            Some("http://127.0.0.1:1"),
        );
        let credentials = GatewayCredentials::for_outbound("Bearer caller", &tenant, None);
        for object in data_export_objects().iter().filter(|object| {
            !["reception"].contains(&object.key.as_str())
                && !["api", "computed"].contains(&object.table.as_str())
        }) {
            // A settings export must retain every persisted value needed to
            // reconstruct its rule. The tenant is supplied by the request.
            let columns: Vec<String> = sqlx::query_scalar(
                "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME <> 'tenant_id'",
            )
            .bind(&object.table)
            .fetch_all(&pool)
            .await
            .unwrap();
            assert!(!columns.is_empty());
            for column in columns {
                assert!(
                    object.fields.iter().any(|field| field.field == column),
                    "{} export omits persisted column {column}",
                    object.key
                );
            }
            assert!(repository
                .rows(credentials, object, 0, 100)
                .await
                .unwrap_or_else(|error| panic!("{}: {error:?}", object.key))
                .is_empty());
        }
        for (scope, answer) in [(&tenant, "mine"), (&other, "other")] {
            sqlx::query("INSERT INTO golf_customer_reception_values (tenant_id, customer_id, field_key, value_json) VALUES (?, 'customer', 'removed_field', ?)")
                .bind(scope).bind(serde_json::to_string(answer).unwrap()).execute(&pool).await.unwrap();
        }
        for (month, deadline) in [("2026-10", "2026-09-20"), ("2026-11", "2026-10-20")] {
            sqlx::query("INSERT INTO golf_availability_deadlines (tenant_id, `year_month`, deadline_date) VALUES (?, ?, ?)")
                .bind(&tenant).bind(month).bind(deadline).execute(&pool).await.unwrap();
        }
        let deadline_source = data_export_objects()
            .iter()
            .find(|object| object.key == "availabilityDeadlines")
            .unwrap();
        let deadlines = repository
            .rows(credentials, deadline_source, 0, 100)
            .await
            .unwrap();
        assert_eq!(deadlines.len(), 2);
        assert_eq!(deadlines[0]["year_month"], "2026-10");
        assert_eq!(deadlines[0]["deadline_date"], "2026-09-20");
        assert_eq!(deadlines[1]["year_month"], "2026-11");
        assert_eq!(deadlines[1]["deadline_date"], "2026-10-20");
        let fields = repository.custom_fields(&tenant).await.unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].field, "custom.removed_field");
        let source = data_export_objects()
            .iter()
            .find(|object| object.key == "receptionAnswers")
            .unwrap();
        let rows = repository.rows(credentials, source, 0, 100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["value_json"], "mine");
        sqlx::query("INSERT INTO golf_customer_registrations (tenant_id, customer_id, source) VALUES (?, 'customer', 'reception_sheet')")
            .bind(&tenant).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO golf_customer_registrations (tenant_id, customer_id, source) VALUES (?, 'deleted', 'reception_sheet')").bind(&tenant).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO golf_customer_reception_values (tenant_id, customer_id, field_key, value_json) VALUES (?, 'deleted', 'removed_field', '\"historical\"')").bind(&tenant).execute(&pool).await.unwrap();
        let expected_tenant = tenant.clone();
        let app = axum::Router::new().route("/v1/storekit/customers/:id", axum::routing::get(move |headers: axum::http::HeaderMap, axum::extract::Path(id): axum::extract::Path<String>| {
            let expected_tenant = expected_tenant.clone();
            async move {
                assert_eq!(headers["authorization"], "Bearer caller");
                assert_eq!(headers["x-operator-id"], expected_tenant);
                if id == "deleted" { return (axum::http::StatusCode::NOT_FOUND, axum::Json(serde_json::json!({"message": "Customer not found"}))); }
                (axum::http::StatusCode::OK, axum::Json(serde_json::json!({ "id": "customer", "name": "Reception customer", "name_kana": "Reading", "phone": "09001234567", "email": "customer@example.com", "birth_date": "1990-01-02", "sex": "female", "address": { "postalCode": "1000001", "state": "Tokyo", "city": "Chiyoda", "address1": "1-2" } })))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let repository = MySqlDataExportRepository::new(pool, reqwest::Client::new(), Some(&url));
        let source = data_export_objects()
            .iter()
            .find(|object| object.key == "reception")
            .unwrap();
        let rows = repository.rows(credentials, source, 0, 100).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1]["customer_available"], false);
        assert_eq!(rows[1]["name"], serde_json::Value::Null);
        assert_eq!(rows[1]["custom.removed_field"], "historical");
        assert_eq!(rows[0]["customer_available"], true);
        assert_eq!(rows[0]["name"], "Reception customer");
        assert_eq!(rows[0]["phone"], "09001234567");
        assert_eq!(rows[0]["birth_date"], "1990-01-02");
        assert_eq!(rows[0]["postalCode"], "1000001");
        assert_eq!(rows[0]["custom.removed_field"], "mine");
        server.abort();
    }

    #[tokio::test]
    async fn data_export_settings_preserve_time_bounds_and_pricing_assumptions() {
        let pool = test_pool().await;
        let tenant = test_tenant("data-export-settings");
        sqlx::query("INSERT INTO golf_membership_play_windows (tenant_id, plan_id, playable_days, from_time, to_time) VALUES (?, 'weekday-plan', 31, '09:00:00', '15:00:00'), (?, 'all-day-plan', 127, NULL, NULL)")
            .bind(&tenant).bind(&tenant).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO golf_pricing_settings (tenant_id, prefecture, tax_grade, taxable_ratio, price_elasticity, fixed_cost_per_day, variable_cost_per_visitor) VALUES (?, 'Tokyo', 'A', 0.6, -0.8, 250000, 2000)")
            .bind(&tenant).execute(&pool).await.unwrap();
        let repository = MySqlDataExportRepository::new(
            pool,
            reqwest::Client::new(),
            Some("http://127.0.0.1:1"),
        );
        let credentials = GatewayCredentials::for_outbound("Bearer caller", &tenant, None);
        let objects = data_export_objects();
        let source = objects
            .iter()
            .find(|object| object.key == "membershipPlayWindows")
            .unwrap();
        let windows = repository.rows(credentials, source, 0, 100).await.unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0]["playable_days"], 31);
        let time = |field: &str| {
            chrono::NaiveTime::parse_from_str(windows[0][field].as_str().unwrap(), "%H:%M:%S%.f")
                .unwrap()
        };
        assert_eq!(
            time("from_time"),
            chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap()
        );
        assert_eq!(
            time("to_time"),
            chrono::NaiveTime::from_hms_opt(15, 0, 0).unwrap()
        );
        assert_eq!(windows[1]["from_time"], Value::Null);
        assert_eq!(windows[1]["to_time"], Value::Null);
        let source = objects
            .iter()
            .find(|object| object.key == "pricingSettings")
            .unwrap();
        let settings = repository.rows(credentials, source, 0, 100).await.unwrap();
        assert_eq!(settings.len(), 1);
        assert_eq!(settings[0]["taxable_ratio"], 0.6);
        assert_eq!(settings[0]["price_elasticity"], -0.8);
        assert_eq!(settings[0]["fixed_cost_per_day"], 250000);
        assert_eq!(settings[0]["variable_cost_per_visitor"], 2000);
    }
}
