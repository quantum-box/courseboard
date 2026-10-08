//! A bounded BFF for the three common imports exposed by CourseBoard.
//! Field performs current owning-domain and delegation checks on every call.
use crate::course::domain::{actions, GatewayCredentials};
use crate::course::interfaces::http::{caller_bearer, operator_id, optional_header};
use crate::{AppError, AppState};
use axum::{
    body::{to_bytes, Body},
    extract::{Path, State},
    http::{HeaderMap, Method, Request, Response, StatusCode},
    response::IntoResponse,
};
use serde_json::{json, Value};

const TARGETS: &[(&str, &str, &str)] = &[
    ("customer", actions::MANAGE_CUSTOMERS, "顧客台帳"),
    ("customerReception", actions::MANAGE_CUSTOMERS, "受付用紙"),
    ("dailyBudgets", actions::MANAGE_BUDGETS, "日次予算"),
    (
        "courseboardReservationReports",
        actions::IMPORT_RESERVATION_REPORTS,
        "予約表集計",
    ),
];
fn target(key: &str) -> Result<(&'static str, &'static str), AppError> {
    TARGETS
        .iter()
        .find(|(k, _, _)| *k == key)
        .map(|(_, a, l)| (*a, *l))
        .ok_or(AppError::NotFound("import target is unavailable"))
}
fn credentials<'a>(
    state: &'a AppState,
    headers: &'a HeaderMap,
) -> Result<GatewayCredentials<'a>, AppError> {
    let bearer = caller_bearer(headers)?;
    Ok(GatewayCredentials {
        authorization: bearer,
        caller_bearer: bearer,
        operator_id: operator_id(headers)?,
        platform_id: optional_header(headers, "x-platform-id"),
        authorizer: state.course_authorizer(),
    })
}
async fn upstream(
    state: &AppState,
    headers: &HeaderMap,
    method: Method,
    path: &str,
    query: Option<&str>,
    body: Option<Value>,
) -> Result<(StatusCode, HeaderMap, Vec<u8>), AppError> {
    let base = state
        .cancellation_fee_config
        .field_api_url
        .as_deref()
        .ok_or(AppError::Provider("Field API is unavailable".into()))?;
    let mut url = reqwest::Url::parse(base)
        .map_err(|_| AppError::Provider("Field API URL is invalid".into()))?;
    url.set_path(path);
    url.set_query(query);
    let mut request = state
        .http_client
        .request(method, url)
        .timeout(std::time::Duration::from_secs(155))
        .header("Authorization", caller_bearer(headers)?)
        .header("x-operator-id", operator_id(headers)?);
    if let Some(platform) = optional_header(headers, "x-platform-id") {
        request = request.header("x-platform-id", platform);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| AppError::Provider(e.to_string()))?;
    let status = response.status();
    let out_headers = response.headers().clone();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Provider(e.to_string()))?
    {
        if bytes.len().saturating_add(chunk.len()) > 8 * 1024 * 1024 {
            return Err(AppError::Provider(
                "Field import response is too large".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((status, out_headers, bytes))
}
fn parsed(status: StatusCode, bytes: &[u8]) -> Result<Value, AppError> {
    if status == StatusCode::UNAUTHORIZED {
        return Err(AppError::UpstreamAuthenticationExpired);
    }
    if !status.is_success() {
        return Err(AppError::UpstreamClient {
            status,
            message: serde_json::from_slice::<Value>(bytes)
                .ok()
                .and_then(|v| v["message"].as_str().map(str::to_owned))
                .unwrap_or_else(|| "共通取込を確認できませんでした".into()),
        });
    }
    serde_json::from_slice(bytes)
        .map_err(|_| AppError::Provider("Field import response is invalid".into()))
}
async fn permitted(state: &AppState, headers: &HeaderMap, key: &str) -> Result<(), AppError> {
    credentials(state, headers)?.require(target(key)?.0).await?;
    Ok(())
}

#[utoipa::path(method(get, post),path="/v1/course/data-imports/{path}",params(("path"=String,Path,description="objects, jobs, or a permitted target/job operation")),responses((status=200,body=Value),(status=403,body=crate::course::interfaces::openapi::ErrorBody)),security(("bearer_auth"=[])),tag="course")]
pub async fn proxy(
    State(state): State<AppState>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Result<Response<Body>, AppError> {
    let (parts, body) = request.into_parts();
    let headers = &parts.headers;
    let method = parts.method;
    let segments: Vec<_> = path.split('/').collect();
    if segments
        .iter()
        .any(|s| s.is_empty() || s.contains(['\\', '%']) || *s == "." || *s == "..")
    {
        return Err(AppError::NotFound("import route is unavailable"));
    }
    if method == Method::GET && path == "objects" {
        let (status, _, bytes) = upstream(
            &state,
            headers,
            method,
            "/v1/bridge/data-objects",
            None,
            None,
        )
        .await?;
        let value = parsed(status, &bytes)?;
        let mut items = Vec::new();
        for mut item in value["items"].as_array().cloned().unwrap_or_default() {
            let key = item["key"].as_str().unwrap_or_default().to_owned();
            if let Ok((_, label)) = target(&key) {
                if item["import"]["writable"] == true
                    && permitted(&state, headers, &key).await.is_ok()
                {
                    item["label"] = json!(label);
                    items.push(item);
                }
            }
        }
        return Ok(axum::Json(json!({"items":items})).into_response());
    }
    if method == Method::GET && path == "jobs" {
        let (status, _, bytes) =
            upstream(&state, headers, method, "/v1/bridge/data-jobs", None, None).await?;
        let value = parsed(status, &bytes)?;
        let mut items = Vec::new();
        for item in value["items"].as_array().cloned().unwrap_or_default() {
            if (item["kind"] == "import" || item["kind"] == "document")
                && item["importOptions"]["sourceApp"] == "courseboard"
                && item["importOptions"]["documentParentId"].is_null()
                && permitted(
                    &state,
                    headers,
                    item["objectKey"].as_str().unwrap_or_default(),
                )
                .await
                .is_ok()
            {
                items.push(item);
            }
        }
        return Ok(axum::Json(json!({"items":items})).into_response());
    }
    let upstream_path = match segments.as_slice() {
        ["objects", key, "template"] if method == Method::GET => {
            permitted(&state, headers, key).await?;
            format!("/v1/bridge/data-objects/{key}/template")
        }
        ["objects", key, "imports", operation]
            if method == Method::POST
                && ["preview", "upload-url", "document-link", "document-upload"]
                    .contains(operation) =>
        {
            permitted(&state, headers, key).await?;
            format!("/v1/bridge/data-objects/{key}/imports/{operation}")
        }
        ["jobs", id] if method == Method::GET => authorized_job(&state, headers, id).await?,
        ["jobs", id, operation]
            if method == Method::POST
                && [
                    "advance",
                    "validate",
                    "cancel",
                    "resume",
                    "document-sync",
                    "document-revision",
                    "document-read",
                    "document-validate",
                    "document-confirm",
                ]
                .contains(operation) =>
        {
            format!(
                "{}/{}",
                authorized_job(&state, headers, id).await?,
                operation
            )
        }
        ["jobs", id, "preview", page] if method == Method::GET && page.parse::<usize>().is_ok() => {
            format!(
                "{}/preview/{page}",
                authorized_job(&state, headers, id).await?
            )
        }
        ["jobs", id, "document-original", index]
            if method == Method::GET && index.parse::<usize>().is_ok() =>
        {
            format!(
                "{}/document-original/{index}",
                authorized_job(&state, headers, id).await?
            )
        }
        _ => return Err(AppError::NotFound("import route is unavailable")),
    };
    let bytes = to_bytes(body, 5 * 1024 * 1024)
        .await
        .map_err(|_| AppError::BadRequest("import request is too large"))?;
    let body = if bytes.is_empty() {
        None
    } else {
        let mut value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| AppError::BadRequest("invalid import JSON"))?;
        if segments.first() == Some(&"objects")
            && method == Method::POST
            && segments.last() != Some(&"document-link")
        {
            if value["importOptions"].is_null() {
                value["importOptions"] = json!({});
            }
            if !value["importOptions"].is_object() {
                return Err(AppError::BadRequest("invalid import options"));
            }
            value["importOptions"]["sourceApp"] = json!("courseboard");
        }
        Some(value)
    };
    let (status, out_headers, bytes) = upstream(
        &state,
        headers,
        method,
        &upstream_path,
        parts.uri.query(),
        body,
    )
    .await?;
    if status == StatusCode::UNAUTHORIZED {
        return Err(AppError::UpstreamAuthenticationExpired);
    }
    let mut response = Response::builder().status(status);
    for name in [
        axum::http::header::CONTENT_TYPE,
        axum::http::header::CONTENT_DISPOSITION,
    ] {
        if let Some(value) = out_headers.get(&name) {
            response = response.header(name, value);
        }
    }
    response
        .body(Body::from(bytes))
        .map_err(|_| AppError::Provider("invalid import response".into()))
}
async fn authorized_job(
    state: &AppState,
    headers: &HeaderMap,
    id: &str,
) -> Result<String, AppError> {
    if id.len() > 64
        || !id.starts_with("dtj_")
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(AppError::NotFound("import job is unavailable"));
    }
    let path = format!("/v1/bridge/data-jobs/{id}");
    let (status, _, bytes) = upstream(state, headers, Method::GET, &path, None, None).await?;
    let job = parsed(status, &bytes)?;
    if !["import", "document"]
        .iter()
        .any(|kind| job["kind"] == *kind)
        || job["importOptions"]["sourceApp"] != "courseboard"
    {
        return Err(AppError::NotFound("import job is unavailable"));
    }
    permitted(
        state,
        headers,
        job["objectKey"].as_str().unwrap_or_default(),
    )
    .await?;
    Ok(path)
}

#[cfg(test)]
#[path = "common_import_proxy_tests.rs"]
mod tests;
