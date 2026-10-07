//! CourseBoard supplies authorized application-owned rows; Field owns the
//! saved mappings, CSV escaping and spreadsheet-safe rendering.
use super::http::credentials;
use crate::course::usecase::data_exports::DataExportsUseCase;
use crate::{AppError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Serialize, ToSchema)]
pub struct DataExportFieldDto {
    pub field: String,
    pub label: String,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataExportObjectDto {
    pub requires_month: bool,
    pub key: String,
    pub label: String,
    pub fields: Vec<DataExportFieldDto>,
}
#[derive(Serialize, ToSchema)]
pub struct DataExportObjectList {
    pub items: Vec<DataExportObjectDto>,
}
#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct DataExportPageQuery {
    pub year_month: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "page_limit")]
    pub limit: u32,
}
fn page_limit() -> u32 {
    100
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataExportPage {
    pub items: Vec<serde_json::Value>,
    pub next_offset: Option<u32>,
}

#[utoipa::path(get, path = "/v1/course/data-exports/objects", responses((status = 200, body = DataExportObjectList), (status = 403, body = super::openapi::ErrorBody)), tag = "Data exports")]
pub async fn list_data_export_objects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DataExportObjectList>, AppError> {
    let objects = DataExportsUseCase::new(state.data_exports.clone())
        .objects(credentials(&state, &headers)?)
        .await?;
    Ok(Json(DataExportObjectList {
        items: objects
            .into_iter()
            .map(|object| DataExportObjectDto {
                requires_month: object.table == "computed",
                key: format!("external:courseboard:{}", object.key),
                label: object.label,
                fields: object
                    .fields
                    .into_iter()
                    .map(|field| DataExportFieldDto {
                        field: field.field,
                        label: field.label,
                    })
                    .collect(),
            })
            .collect(),
    }))
}
#[utoipa::path(get, path = "/v1/course/data-exports/{source_key}/rows", params(("source_key" = String, Path), DataExportPageQuery), responses((status = 200, body = DataExportPage), (status = 403, body = super::openapi::ErrorBody)), tag = "Data exports")]
pub async fn list_data_export_rows(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Query(query): Query<DataExportPageQuery>,
) -> Result<Json<DataExportPage>, AppError> {
    if ["courses", "resources", "products", "caddies", "staff"].contains(&key.as_str()) {
        let object = crate::course::domain::data_exports::data_export_objects()
            .iter()
            .find(|object| object.key == key)
            .expect("declared API export");
        credentials(&state, &headers)?
            .require(object.required_action())
            .await?;
        if query.offset > 0 {
            return Ok(Json(DataExportPage {
                items: vec![],
                next_offset: None,
            }));
        }
        let value = match key.as_str() {
            "courses" => serde_json::to_value(
                super::http::list_courses(State(state), headers)
                    .await?
                    .0
                    .items,
            ),
            "resources" => serde_json::to_value(
                super::http::list_resources(State(state), headers)
                    .await?
                    .0
                    .items,
            ),
            "products" => serde_json::to_value(
                super::http::list_reservation_products(State(state), headers)
                    .await?
                    .0
                    .items,
            ),
            "caddies" => serde_json::to_value(
                super::http::list_caddies(State(state), headers)
                    .await?
                    .0
                    .items,
            ),
            "staff" => serde_json::to_value(
                super::http::list_caddies(State(state), headers)
                    .await?
                    .0
                    .staff,
            ),
            _ => unreachable!(),
        }
        .expect("serializable catalogue");
        return Ok(Json(DataExportPage {
            items: value.as_array().expect("row array").clone(),
            next_offset: None,
        }));
    }
    if [
        "payroll",
        "settlement",
        "settlementReservations",
        "settlementUnpaid",
    ]
    .contains(&key.as_str())
    {
        let object = crate::course::domain::data_exports::data_export_objects()
            .iter()
            .find(|object| object.key == key)
            .expect("declared computed export");
        credentials(&state, &headers)?
            .require(object.required_action())
            .await?;
        let month = query
            .year_month
            .ok_or(crate::course::domain::CourseError::BadRequest(
                "yearMonth is required",
            ))?;
        if query.offset > 0 {
            return Ok(Json(DataExportPage {
                items: vec![],
                next_offset: None,
            }));
        }
        let items = if key == "payroll" {
            let Json(report) = super::http_ops::get_payroll_summary(
                State(state),
                headers,
                Query(super::http_ops::YearMonthQuery {
                    year_month: month.clone(),
                }),
            )
            .await?;
            report
                .items
                .into_iter()
                .map(|item| {
                    let mut value = serde_json::to_value(item).expect("serializable payroll row");
                    value["yearMonth"] = serde_json::Value::String(month.clone());
                    value
                })
                .collect()
        } else {
            let Json(report) = super::http_commercial::get_monthly_settlement(
                State(state),
                headers,
                Query(super::http_commercial::YearMonthQuery {
                    year_month: month.clone(),
                }),
            )
            .await?;
            if key == "settlement" {
                vec![flatten_report(
                    serde_json::to_value(report).expect("serializable settlement"),
                )]
            } else {
                let values = if key == "settlementReservations" {
                    if report.drilldown.reservation_details_unavailable {
                        return Err(crate::course::domain::CourseError::Provider(
                            "reservation details are unavailable".into(),
                        )
                        .into());
                    }
                    serde_json::to_value(report.drilldown.reservation_items)
                } else {
                    serde_json::to_value(report.drilldown.unpaid_cancellation_items)
                }
                .expect("serializable settlement rows");
                values
                    .as_array()
                    .expect("row array")
                    .iter()
                    .cloned()
                    .map(|mut value| {
                        value["yearMonth"] = serde_json::Value::String(month.clone());
                        value
                    })
                    .collect()
            }
        };
        return Ok(Json(DataExportPage {
            items,
            next_offset: None,
        }));
    }
    let items = DataExportsUseCase::new(state.data_exports.clone())
        .rows(
            credentials(&state, &headers)?,
            &key,
            query.offset,
            query.limit,
        )
        .await?;
    let next_offset = (items.len() == query.limit as usize).then_some(query.offset + query.limit);
    Ok(Json(DataExportPage { items, next_offset }))
}

fn flatten_report(value: serde_json::Value) -> serde_json::Value {
    fn visit(
        prefix: &str,
        value: serde_json::Value,
        result: &mut serde_json::Map<String, serde_json::Value>,
    ) {
        match value {
            serde_json::Value::Object(values) => {
                for (key, value) in values {
                    visit(
                        &if prefix.is_empty() {
                            key
                        } else {
                            format!("{prefix}.{key}")
                        },
                        value,
                        result,
                    );
                }
            }
            value => {
                result.insert(prefix.to_string(), value);
            }
        }
    }
    let mut result = serde_json::Map::new();
    visit("", value, &mut result);
    serde_json::Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use std::sync::Arc;
    use tower::ServiceExt;
    #[tokio::test]
    async fn data_export_routes_require_a_verified_bearer_before_reading_any_rows() {
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .connect_lazy("mysql://root@127.0.0.1:1/unreachable")
            .unwrap();
        let state = AppState::new(
            pool,
            Arc::new(crate::auth::StaticBearerVerifier::new("valid-token".into())),
        );
        let router = crate::build_router(state);
        for path in [
            "/v1/course/data-exports/objects",
            "/v1/course/data-exports/reception/rows",
        ] {
            for token in [None, Some("Bearer invalid-token")] {
                let mut request = Request::builder().uri(path);
                if let Some(token) = token {
                    request = request.header("authorization", token);
                }
                let response = router
                    .clone()
                    .oneshot(request.body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
            }
        }
    }
    #[test]
    fn data_export_flattening_preserves_summary_numbers_and_lists() {
        let row = flatten_report(
            serde_json::json!({ "period": {"yearMonth": "2026-09"}, "reservations": {"grossAmount": 1200}, "drilldown": {"ids": ["a", "b"]} }),
        );
        assert_eq!(row["period.yearMonth"], "2026-09");
        assert_eq!(row["reservations.grossAmount"], 1200);
        assert_eq!(row["drilldown.ids"], serde_json::json!(["a", "b"]));
    }
}
