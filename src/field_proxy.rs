use axum::{
    body::{to_bytes, Body},
    extract::{Path, State},
    http::{header, Method, Request, Response, StatusCode},
    response::IntoResponse,
};

use crate::cancellation_fees::CancellationFeeConfig;

const MAX_PROXY_BODY_BYTES: usize = 5 * 1024 * 1024;

/// Narrow BFF used by the Vite/Tauri client. The browser-facing extension
/// proxy authenticates the caller first; this handler then forwards only the
/// Field endpoints needed by Course Board and never exposes an arbitrary URL.
pub async fn proxy_field_api(
    State(state): State<crate::AppState>,
    State(client): State<reqwest::Client>,
    State(config): State<CancellationFeeConfig>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Response<Body> {
    let normalized_path = format!("/{}", path.trim_start_matches('/'));
    if !is_allowed_route(request.method(), &normalized_path) {
        return proxy_error(StatusCode::NOT_FOUND, "Field API path is not available");
    }

    let Some(base_url) = config.field_api_url.as_deref() else {
        return proxy_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TACHYON_FIELD_API_URL is not configured",
        );
    };
    if base_url
        .trim()
        .eq_ignore_ascii_case(crate::config::EMPTY_COURSE_STORE_URL)
        || base_url.trim().starts_with("empty://")
    {
        return proxy_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "TACHYON_FIELD_API_URL is not configured (empty course store is active)",
        );
    }
    let Ok(mut url) = reqwest::Url::parse(base_url) else {
        return proxy_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "TACHYON_FIELD_API_URL is invalid",
        );
    };
    url.set_path(&normalized_path);
    url.set_query(request.uri().query());

    let (parts, body) = request.into_parts();
    let method = match reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return proxy_error(StatusCode::METHOD_NOT_ALLOWED, "Unsupported method"),
    };
    let body = match to_bytes(body, MAX_PROXY_BODY_BYTES).await {
        Ok(body) => body,
        Err(_) => return proxy_error(StatusCode::PAYLOAD_TOO_LARGE, "Request body is too large"),
    };

    let requested_method = method.clone();
    let operator_id = parts
        .headers
        .get("x-operator-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let mut outbound = client.request(method, url);
    // Default: forward the caller's inbound bearer (browser-pkce login token).
    // Optional TACHYON_FIELD_API_BEARER_TOKEN override remains for admin/service
    // accounts only — not required for the normal browser-pkce path.
    if let Some(authorization) = outbound_authorization(
        config.field_upstream_authorization.as_deref(),
        &parts.headers,
    ) {
        outbound = outbound.header(header::AUTHORIZATION.as_str(), authorization);
    }
    for name in [header::CONTENT_TYPE, header::ACCEPT, header::IF_MATCH] {
        if let Some(value) = parts.headers.get(&name) {
            outbound = outbound.header(name.as_str(), value.as_bytes());
        }
    }
    for name in ["x-operator-id", "x-platform-id", "idempotency-key"] {
        if let Some(value) = parts.headers.get(name) {
            outbound = outbound.header(name, value.as_bytes());
        }
    }
    if !body.is_empty() {
        outbound = outbound.body(body);
    }

    let upstream = match outbound.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%error, %normalized_path, "Field API proxy request failed");
            return proxy_error(StatusCode::BAD_GATEWAY, "Field API request failed");
        }
    };
    let upstream_status = upstream.status();
    // Inbound bearer was already validated by require_valid_token. A Field 401
    // means Field rejected a token Course Board trusts (issuer/audience/client
    // mismatch on the Field side) — do not pass 401 through, or the UI soft
    // sign-out treats it as an expired Course Board session.
    if upstream_status == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!(
            %normalized_path,
            "Field API rejected an already-authenticated bearer; mapping to 502"
        );
        return proxy_error(
            StatusCode::BAD_GATEWAY,
            "Field API rejected the authenticated bearer (Tachyon Auth verify_user must accept Tachyon-issued OAuth access tokens; re-login if the session expired)",
        );
    }
    // A member's permissions just changed upstream. Remembered allowances for
    // this tenant describe the old answer, so drop them rather than let an
    // operator watch a revocation appear to do nothing for a minute.
    if upstream_status.is_success() && changes_permissions(&requested_method, &normalized_path) {
        if let Some(operator_id) = operator_id.as_deref() {
            state.forget_tenant_allowances(operator_id);
        }
    }
    let status = StatusCode::from_u16(upstream_status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream.headers().get(header::CONTENT_TYPE).cloned();
    let content_disposition = upstream.headers().get(header::CONTENT_DISPOSITION).cloned();
    let response_body = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::warn!(%error, %normalized_path, "Field API proxy response failed");
            return proxy_error(StatusCode::BAD_GATEWAY, "Field API response failed");
        }
    };

    let mut response = Response::builder().status(status);
    if let Some(value) = content_type {
        response = response.header(header::CONTENT_TYPE, value);
    }
    if let Some(value) = content_disposition {
        response = response.header(header::CONTENT_DISPOSITION, value);
    }
    response
        .body(Body::from(response_body))
        .unwrap_or_else(|_| proxy_error(StatusCode::BAD_GATEWAY, "Field API response was invalid"))
}

/// Authorization forwarded to Field: optional static override, else inbound bearer.
fn outbound_authorization<'a>(
    upstream_override: Option<&'a str>,
    inbound_headers: &'a axum::http::HeaderMap,
) -> Option<&'a str> {
    if let Some(value) = upstream_override.filter(|value| !value.trim().is_empty()) {
        return Some(value);
    }
    inbound_headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("Bearer ") && !value["Bearer ".len()..].trim().is_empty())
}

fn proxy_error(status: StatusCode, message: &'static str) -> Response<Body> {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"message":"{message}"}}"#),
    )
        .into_response()
}

fn is_allowed_path(path: &str) -> bool {
    if !has_safe_segments(path) {
        return false;
    }

    path == "/v1/erp/extensions/status"
        || path == "/v1/erp/extensions/golf_course/config"
        || is_non_empty_subpath(path, "/v1/erp/extensions/golf-course")
        || path == "/v1/erp/extensions/golf-course"
        || path == "/v1/erp/staff"
        || is_non_empty_subpath(path, "/v1/erp/staff")
        || path == "/v1/erp/reservation-types"
        || is_field_iam_path(path)
        || is_reservation_billing_invoice_path(path)
        || is_order_detail_path(path)
        || is_invoice_path(path)
}

fn is_allowed_route(method: &Method, path: &str) -> bool {
    if !is_allowed_path(path) {
        return false;
    }

    if path == "/v1/erp/extensions/status" || path == "/v1/erp/reservation-types" {
        return method == Method::GET;
    }
    if path == "/v1/erp/extensions/golf_course/config" {
        return method == Method::GET || method == Method::PATCH;
    }
    if path == "/v1/erp/extensions/golf-course" {
        return method == Method::GET;
    }
    if is_non_empty_subpath(path, "/v1/erp/extensions/golf-course") {
        return method == Method::GET
            || method == Method::POST
            || method == Method::PATCH
            || method == Method::PUT
            || method == Method::DELETE;
    }
    if path == "/v1/erp/staff" {
        return method == Method::GET || method == Method::POST;
    }
    // Roster edits and removals use Field HRM's member update and delete. Keep
    // this narrower than the general `/staff/*` prefix: these may reach one
    // member only, not clock, leave, payroll, or any future nested HRM
    // operation. DELETE hides the member upstream and keeps their attendance
    // and payroll, but Field offers no way back — the roster screen confirms
    // before it is called.
    if is_staff_member_path(path) {
        return method == Method::PATCH || method == Method::DELETE;
    }
    // Tenant member management via the Field IAM surface (gated upstream by
    // the ERP action `field:ManageUsers`). Raw /v1/auth/* stays blocked — the
    // Field host does not serve it.
    if path == "/v1/field/iam/users" {
        return method == Method::GET;
    }
    if path == "/v1/field/iam/users/invite" {
        return method == Method::POST;
    }
    if is_field_iam_user_policies_path(path) {
        return method == Method::PUT;
    }
    if is_field_iam_user_path(path) {
        return method == Method::DELETE;
    }
    if is_non_empty_subpath(path, "/v1/erp/staff") {
        return method == Method::POST;
    }
    if is_reservation_billing_invoice_path(path) {
        return method == Method::POST;
    }
    if is_order_detail_path(path) {
        return method == Method::GET;
    }
    if path == "/v1/invoices" {
        return method == Method::GET || method == Method::POST;
    }

    let Some(suffix) = path.strip_prefix("/v1/invoices/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    match (segments.next(), segments.next(), segments.next()) {
        (Some(_invoice_id), None, None) => method == Method::GET || method == Method::PATCH,
        (Some(_invoice_id), Some("fulfill"), None) => method == Method::POST,
        _ => false,
    }
}

fn has_safe_segments(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains('\\')
        && path
            .split('/')
            .skip(1)
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn is_non_empty_subpath(path: &str, prefix: &str) -> bool {
    path.strip_prefix(prefix)
        .and_then(|suffix| suffix.strip_prefix('/'))
        .is_some_and(|suffix| !suffix.is_empty())
}

/// Exactly `/v1/erp/staff/{staff_id}`, with no nested operation after the id.
fn is_staff_member_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/v1/erp/staff/") else {
        return false;
    };
    !suffix.is_empty() && !suffix.contains('/')
}

/// Whether a proxied call changes who may do what in the tenant.
///
/// The IAM writes this app offers: replacing a member's policies, inviting one,
/// and removing one. A read never invalidates anything.
fn changes_permissions(method: &reqwest::Method, path: &str) -> bool {
    match *method {
        reqwest::Method::PUT => is_field_iam_user_policies_path(path),
        reqwest::Method::POST => path == "/v1/field/iam/users/invite",
        reqwest::Method::DELETE => is_field_iam_user_path(path),
        _ => false,
    }
}

fn is_field_iam_path(path: &str) -> bool {
    path == "/v1/field/iam/users"
        || path == "/v1/field/iam/users/invite"
        || is_field_iam_user_policies_path(path)
        || is_field_iam_user_path(path)
}

/// `/v1/field/iam/users/{user_id}` (excluding the static `invite` segment).
fn is_field_iam_user_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/v1/field/iam/users/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (segments.next(), segments.next()),
        (Some(user_id), None) if !user_id.is_empty() && user_id != "invite"
    )
}

/// `/v1/field/iam/users/{user_id}/policies`
fn is_field_iam_user_policies_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/v1/field/iam/users/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (segments.next(), segments.next(), segments.next()),
        (Some(user_id), Some("policies"), None) if !user_id.is_empty() && user_id != "invite"
    )
}

fn is_reservation_billing_invoice_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/v1/erp/reservations/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (segments.next(), segments.next(), segments.next()),
        (Some(reservation_id), Some("billing-invoice"), None) if !reservation_id.is_empty()
    )
}

fn is_order_detail_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/v1/erp/orders/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (segments.next(), segments.next()),
        (Some(order_id), None) if !order_id.is_empty()
    )
}

fn is_invoice_path(path: &str) -> bool {
    if path == "/v1/invoices" {
        return true;
    }
    let Some(suffix) = path.strip_prefix("/v1/invoices/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    match (segments.next(), segments.next(), segments.next()) {
        (Some(invoice_id), None, None) => !invoice_id.is_empty(),
        (Some(invoice_id), Some("fulfill"), None) => !invoice_id.is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{header, HeaderMap, HeaderValue, Method};

    use super::{is_allowed_path, is_allowed_route, outbound_authorization};

    #[test]
    fn allows_only_courseboard_field_surfaces() {
        assert!(is_allowed_path("/v1/erp/extensions/golf-course/courses"));
        assert!(is_allowed_path("/v1/erp/extensions/status"));
        assert!(is_allowed_path("/v1/erp/staff/staff_1/clock-in"));
        assert!(is_allowed_path(
            "/v1/erp/reservations/res_1/billing-invoice"
        ));
        assert!(is_allowed_path("/v1/invoices"));
        assert!(is_allowed_path("/v1/invoices/inv_1"));
        assert!(is_allowed_path("/v1/invoices/inv_1/fulfill"));
        assert!(is_allowed_path("/v1/erp/orders/order_1"));
        assert!(is_allowed_path("/v1/field/iam/users"));
        assert!(is_allowed_path("/v1/field/iam/users/invite"));
        assert!(is_allowed_path("/v1/field/iam/users/us_1"));
        assert!(is_allowed_path("/v1/field/iam/users/us_1/policies"));
        assert!(!is_allowed_path("/v1/erp/vendors"));
        assert!(!is_allowed_path("/v1/auth/users"));
        assert!(!is_allowed_path("/v1/auth/users/invite"));
        assert!(!is_allowed_path("/v1/auth/user-policies"));
        assert!(!is_allowed_path("/v1/field/iam/users/us_1/role"));
        assert!(!is_allowed_path("/v1/field/iam/users/invite/policies"));
        assert!(!is_allowed_path("/v1/field/iam"));
        assert!(!is_allowed_path("/https://example.com"));
        assert!(!is_allowed_path("/v1/erp/staff-secrets"));
        assert!(!is_allowed_path("/v1/invoices-private"));
        assert!(!is_allowed_path("/v1/invoices/inv_1/refund"));
        assert!(!is_allowed_path(
            "/v1/erp/reservations/res_1/private/billing-invoice"
        ));
        assert!(!is_allowed_path("/v1/invoices/../auth/users"));
        assert!(!is_allowed_path("/v1/invoices//fulfill"));
        assert!(!is_allowed_path("/v1/erp/orders"));
        assert!(!is_allowed_path("/v1/erp/orders/order_1/private"));
    }

    #[test]
    fn allows_only_methods_used_by_courseboard() {
        assert!(is_allowed_route(&Method::GET, "/v1/invoices"));
        assert!(is_allowed_route(&Method::POST, "/v1/invoices"));
        assert!(is_allowed_route(&Method::GET, "/v1/invoices/inv_1"));
        assert!(is_allowed_route(&Method::PATCH, "/v1/invoices/inv_1"));
        assert!(is_allowed_route(
            &Method::POST,
            "/v1/invoices/inv_1/fulfill"
        ));
        assert!(is_allowed_route(
            &Method::PATCH,
            "/v1/erp/extensions/golf-course/courses/course_1"
        ));
        assert!(is_allowed_route(&Method::PATCH, "/v1/erp/staff/staff_1"));
        assert!(is_allowed_route(&Method::DELETE, "/v1/erp/staff/staff_1"));
        assert!(!is_allowed_route(
            &Method::PATCH,
            "/v1/erp/staff/staff_1/clock-in"
        ));
        // Deleting one member is allowed; wiping the roster is not a route the
        // client may reach, whatever Field would do with it.
        assert!(!is_allowed_route(&Method::DELETE, "/v1/erp/staff"));
        assert!(!is_allowed_route(
            &Method::DELETE,
            "/v1/erp/staff/staff_1/clock-in"
        ));
        assert!(!is_allowed_route(
            &Method::PATCH,
            "/v1/erp/staff/leave-requests/leave_1"
        ));
        assert!(!is_allowed_route(&Method::PUT, "/v1/erp/staff/staff_1"));
        assert!(is_allowed_route(&Method::GET, "/v1/erp/orders/order_1"));
        assert!(is_allowed_route(&Method::GET, "/v1/field/iam/users"));
        assert!(is_allowed_route(
            &Method::POST,
            "/v1/field/iam/users/invite"
        ));
        assert!(is_allowed_route(
            &Method::PUT,
            "/v1/field/iam/users/us_1/policies"
        ));
        assert!(is_allowed_route(
            &Method::DELETE,
            "/v1/field/iam/users/us_1"
        ));
        assert!(!is_allowed_route(&Method::POST, "/v1/field/iam/users"));
        assert!(!is_allowed_route(
            &Method::GET,
            "/v1/field/iam/users/invite"
        ));
        assert!(!is_allowed_route(
            &Method::PUT,
            "/v1/field/iam/users/us_1/role"
        ));
        assert!(!is_allowed_route(
            &Method::DELETE,
            "/v1/field/iam/users/us_1/policies"
        ));
        assert!(!is_allowed_route(&Method::PUT, "/v1/field/iam/users/us_1"));
        assert!(!is_allowed_route(&Method::GET, "/v1/erp/orders"));
        assert!(!is_allowed_route(&Method::DELETE, "/v1/invoices/inv_1"));
        assert!(!is_allowed_route(
            &Method::GET,
            "/v1/invoices/inv_1/fulfill"
        ));
        assert!(!is_allowed_route(
            &Method::GET,
            "/v1/erp/reservations/res_1/billing-invoice"
        ));
        assert!(!is_allowed_route(
            &Method::TRACE,
            "/v1/erp/extensions/golf-course/courses"
        ));
    }

    #[test]
    fn forwards_inbound_bearer_when_no_static_override() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer login-access-token"),
        );
        assert_eq!(
            outbound_authorization(None, &headers),
            Some("Bearer login-access-token")
        );
    }

    #[test]
    fn prefers_static_field_bearer_override_when_configured() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer login-access-token"),
        );
        assert_eq!(
            outbound_authorization(Some("Bearer cli-override"), &headers),
            Some("Bearer cli-override")
        );
    }

    #[test]
    fn ignores_empty_inbound_authorization() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer "));
        assert_eq!(outbound_authorization(None, &headers), None);
    }
}
