//! CourseBoard operation discovery for browser-executed Agent tools.
use axum::Json;
use serde_json::{json, Value};
use utoipa::OpenApi;

/// JSON operations only. No arbitrary URLs, files, internal settings or agent recursion.
fn catalog_path(path: &str) -> bool {
    path.starts_with("/v1/course/")
        && ![
            "/agent",
            "feature-",
            "demo-seed",
            "migrate",
            "data-import",
            "common-import",
            "reception-draft",
            "export",
            "config",
            "tenant-timezone",
        ]
        .iter()
        .any(|part| path.contains(part))
}
pub async fn operations() -> Json<Value> {
    Json(operation_catalog())
}
fn operation_catalog() -> Value {
    let doc =
        serde_json::to_value(crate::course::interfaces::openapi::CourseApiDoc::openapi()).unwrap();
    let mut operations = Vec::new();
    for (path, item) in doc["paths"].as_object().unwrap() {
        if !catalog_path(path) {
            continue;
        }
        for method in ["get", "post", "put", "patch", "delete"] {
            let op = &item[method];
            let Some(id) = op["operationId"].as_str() else {
                continue;
            };
            if !op["requestBody"].is_null()
                && op["requestBody"]["content"]["application/json"].is_null()
            {
                continue;
            }
            let description = match path.as_str() {
                "/v1/course/tee-ledger" => json!("Authoritative reservation ledger / daily booking status (予約台帳・予約状況). Includes all course columns with groupCount and playerCount. Use courseboard_get_reservation_status for compact complete totals."),
                "/v1/course/tee-sheet" => json!("Live reservations / bookings (予約一覧) for a date or date range. This is current reservation data, not imported report rows."),
                "/v1/course/reservation-report-entries" => json!("Imported reservation report rows ONLY (取り込み済み予約レポート). This is NOT the reservation ledger. Empty items do NOT mean zero reservations; use courseboard_get_reservation_status or tee-ledger for reservation counts."),
                _ => op["description"].clone(),
            };
            // References are resolved lazily by the client for this operation only.
            operations.push(json!({"operationId":id,"method":method.to_uppercase(),"path":path,"summary":op["summary"],"description":description,"parameters":op["parameters"],"requestBody":op["requestBody"]}));
        }
    }
    json!({"operations":operations,"schemas":doc["components"]["schemas"]})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_has_real_reservation_customer_and_summary_operations() {
        let catalog = operation_catalog();
        let rows = catalog["operations"].as_array().unwrap();
        assert!(rows
            .iter()
            .any(|op| op["path"] == "/v1/course/reservations" && op["method"] == "POST"));
        assert!(rows
            .iter()
            .any(|op| op["path"].as_str().unwrap().contains("customers")));
        assert!(rows
            .iter()
            .all(|op| catalog_path(op["path"].as_str().unwrap())));
        assert!(rows.iter().all(|op| op["operationId"].is_string()));
    }

    #[tokio::test]
    async fn retired_session_routes_are_rejected_but_catalog_remains() {
        use axum::{body::Body, http::Request};
        use std::sync::Arc;
        use tower::ServiceExt;

        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .connect_lazy("mysql://test:test@127.0.0.1/test")
            .unwrap();
        let state = crate::AppState::new(
            pool,
            Arc::new(crate::auth::StaticBearerVerifier::new("test-token".into())),
        );
        let app = crate::build_router(state);
        for path in [
            "/v1/course/agent/sessions",
            "/v1/course/agent/sessions/as_test/execute-request",
            "/v1/course/agent/sessions/as_test/execute",
            "/v1/course/agent/sessions/as_test/tool-result",
            "/v1/course/agent/sessions/as_test/tool-call",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(path)
                        .header("authorization", "Bearer test-token")
                        .header("x-operator-id", "tn_test")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                axum::http::StatusCode::FORBIDDEN,
                "{path}"
            );
        }
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/course/agent/operations")
                    .header("authorization", "Bearer test-token")
                    .header("x-operator-id", "tn_test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::OK);
    }
}
