use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use crate::config::EMPTY_COURSE_STORE_URL;

const EXTENSION_KEY: &str = "golf_course";
const FIELD_PROFILE_PATH: &str = "/v1/erp/me";
const FIELD_TENANT_DIRECTORY_PATH: &str = "/get_tenants";
const FIELD_TENANT_DIRECTORY_ACTION: &str = "field:ViewSalesAnalytics";
const MAX_PROFILE_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_PROFILE_TENANTS: usize = 500;
const PROFILE_REQUEST_TIMEOUT: Duration = Duration::from_secs(7);
const TENANT_DIRECTORY_REQUEST_TIMEOUT: Duration = Duration::from_secs(7);
/// Field's tenant directory is platform-scoped. Query both current roots and
/// trust each returned tenant's own `environment`; these IDs are request
/// contexts, not a platform-to-environment mapping.
const TENANT_DIRECTORY_PLATFORM_IDS: [&str; 2] = [
    "tn_01hjjn348rn3t49zz6hvmfq67p",
    "tn_01hjryxysgey07h5jz5wagqj0m",
];

#[derive(Clone, Debug)]
pub struct ProfileClient {
    client: reqwest::Client,
    endpoint: Url,
    tenant_directory_endpoint: Option<Url>,
}

impl ProfileClient {
    pub fn from_field_api_url(
        field_api_url: &str,
        tachyon_auth_api_url: Option<&str>,
    ) -> Result<Option<Self>, ProfileClientConfigError> {
        if field_api_url
            .trim()
            .eq_ignore_ascii_case(EMPTY_COURSE_STORE_URL)
            || field_api_url.trim().starts_with("empty://")
        {
            return Ok(None);
        }
        let legacy_auth_api_url = tachyon_auth_api_url
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let client = Self::with_timeout(field_api_url, PROFILE_REQUEST_TIMEOUT)?;
        if legacy_auth_api_url.is_some_and(|value| value.starts_with("empty://")) {
            return Ok(Some(client));
        }
        // Preserve validation for existing deployments that still provide the
        // retired auth lookup override, even though tenant context now comes
        // from Field's directory endpoint.
        if let Some(value) = legacy_auth_api_url {
            validated_base_url(value)?;
        }
        Ok(Some(client.with_tenant_directory_base(field_api_url)?))
    }

    fn with_timeout(
        field_api_url: &str,
        timeout: Duration,
    ) -> Result<Self, ProfileClientConfigError> {
        let base_url = validated_base_url(field_api_url)?;

        let mut endpoint = base_url;
        let endpoint_path = format!(
            "{}{FIELD_PROFILE_PATH}",
            endpoint.path().trim_end_matches('/')
        );
        endpoint.set_path(&endpoint_path);
        endpoint
            .query_pairs_mut()
            .clear()
            .append_pair("extensionKey", EXTENSION_KEY);
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|_| ProfileClientConfigError::HttpClient)?;
        Ok(Self {
            client,
            endpoint,
            tenant_directory_endpoint: None,
        })
    }

    fn with_tenant_directory_base(
        mut self,
        field_api_url: &str,
    ) -> Result<Self, ProfileClientConfigError> {
        let mut endpoint = validated_base_url(field_api_url)?;
        let endpoint_path = format!(
            "{}{FIELD_TENANT_DIRECTORY_PATH}",
            endpoint.path().trim_end_matches('/')
        );
        endpoint.set_path(&endpoint_path);
        endpoint
            .query_pairs_mut()
            .clear()
            .append_pair("required_action", FIELD_TENANT_DIRECTORY_ACTION);
        self.tenant_directory_endpoint = Some(endpoint);
        Ok(self)
    }

    async fn get_profile(&self, authorization: &str) -> Result<ProfileResponse, ProfileProxyError> {
        let mut response = self
            .client
            .get(self.endpoint.clone())
            .header(header::AUTHORIZATION.as_str(), authorization)
            .header(header::ACCEPT.as_str(), "application/json")
            .send()
            .await
            .map_err(|_| ProfileProxyError::UpstreamRequest)?;

        if !response.status().is_success() {
            return Err(ProfileProxyError::UpstreamStatus);
        }

        let body = bounded_response_body(&mut response).await?;
        let mut profile = decode_and_filter_profile(&body)?;
        self.attach_tenant_context(&mut profile, authorization)
            .await;
        Ok(profile)
    }

    /// Best-effort bulk lookup. A missing directory entry keeps the eligible
    /// profile tenant, but omits both authoritative environment and platform.
    async fn attach_tenant_context(&self, profile: &mut ProfileResponse, authorization: &str) {
        let Some(endpoint) = &self.tenant_directory_endpoint else {
            return;
        };
        if profile.tenants.is_empty() {
            return;
        }

        let production =
            self.fetch_tenant_directory(endpoint, TENANT_DIRECTORY_PLATFORM_IDS[0], authorization);
        let sandbox =
            self.fetch_tenant_directory(endpoint, TENANT_DIRECTORY_PLATFORM_IDS[1], authorization);
        let (production, sandbox) = tokio::join!(production, sandbox);
        let mut context_by_tenant = HashMap::new();
        let mut conflicts = HashSet::new();

        for (platform_id, result) in TENANT_DIRECTORY_PLATFORM_IDS
            .into_iter()
            .zip([production, sandbox])
        {
            let entries = match result {
                Ok(entries) => entries,
                Err(error) => {
                    tracing::warn!(
                        platform_id,
                        error = %error,
                        "tenant directory lookup failed; tenant context omitted"
                    );
                    continue;
                }
            };
            for entry in entries {
                let environment = tenant_environment(entry.environment.as_deref());
                if entry.environment.is_some() && environment.is_none() {
                    tracing::warn!(
                        tenant_id = %entry.id,
                        environment = entry.environment.as_deref().unwrap_or_default(),
                        "tenant directory returned unsupported environment; environment omitted"
                    );
                }
                let platform_id = entry.platform_id.filter(|platform_id| {
                    let valid = is_valid_tenant_id(platform_id);
                    if !valid {
                        tracing::warn!(
                            tenant_id = %entry.id,
                            platform_id,
                            "tenant directory returned invalid platform id; platform omitted"
                        );
                    }
                    valid
                });
                let context = TenantContext {
                    platform_id,
                    environment,
                };
                match context_by_tenant.get(&entry.id) {
                    Some(existing) if existing != &context => {
                        conflicts.insert(entry.id.clone());
                    }
                    None => {
                        context_by_tenant.insert(entry.id, context);
                    }
                    Some(_) => {}
                }
            }
        }

        for tenant_id in conflicts {
            context_by_tenant.remove(&tenant_id);
            tracing::warn!(
                tenant_id,
                "tenant directory returned conflicting context; tenant environment omitted"
            );
        }
        for tenant in &mut profile.tenants {
            if let Some(context) = context_by_tenant.remove(&tenant.id) {
                tenant.platform_id = context.platform_id;
                tenant.environment = context.environment;
            }
        }
    }

    async fn fetch_tenant_directory(
        &self,
        endpoint: &Url,
        platform_id: &str,
        authorization: &str,
    ) -> Result<Vec<TenantDirectoryWire>, TenantDirectoryError> {
        let mut response = self
            .client
            .post(endpoint.clone())
            .timeout(TENANT_DIRECTORY_REQUEST_TIMEOUT)
            .header(header::AUTHORIZATION.as_str(), authorization)
            .header(header::ACCEPT.as_str(), "application/json")
            .header("x-platform-id", platform_id)
            .header("x-operator-id", platform_id)
            .send()
            .await
            .map_err(|_| TenantDirectoryError::Request)?;
        if !response.status().is_success() {
            tracing::warn!(
                platform_id,
                status = response.status().as_u16(),
                "tenant directory lookup was rejected; tenant context omitted"
            );
            return Err(TenantDirectoryError::Status);
        }
        let body = bounded_response_body(&mut response)
            .await
            .map_err(|_| TenantDirectoryError::Body)?;
        let entries: Vec<TenantDirectoryWire> =
            serde_json::from_slice(&body).map_err(|_| TenantDirectoryError::Contract)?;
        Ok(entries
            .into_iter()
            .filter(|entry| {
                if is_valid_tenant_id(&entry.id) {
                    true
                } else {
                    tracing::warn!(
                        tenant_id = entry.id,
                        "tenant directory returned invalid tenant id; entry ignored"
                    );
                    false
                }
            })
            .collect())
    }
}

#[derive(Debug, Error)]
enum TenantDirectoryError {
    #[error("tenant directory request failed")]
    Request,
    #[error("tenant directory returned an unsuccessful status")]
    Status,
    #[error("tenant directory response body was unavailable")]
    Body,
    #[error("tenant directory response violated the expected contract")]
    Contract,
}

fn validated_base_url(value: &str) -> Result<Url, ProfileClientConfigError> {
    let base_url = Url::parse(value).map_err(|_| ProfileClientConfigError::InvalidFieldApiUrl)?;
    if !matches!(base_url.scheme(), "http" | "https")
        || base_url.host_str().is_none()
        || !base_url.username().is_empty()
        || base_url.password().is_some()
        || base_url.query().is_some()
        || base_url.fragment().is_some()
    {
        return Err(ProfileClientConfigError::InvalidFieldApiUrl);
    }
    Ok(base_url)
}

#[derive(Debug, Error)]
pub enum ProfileClientConfigError {
    #[error(
        "TACHYON_FIELD_API_URL must be an HTTP(S) URL without credentials, query, or fragment"
    )]
    InvalidFieldApiUrl,
    #[error("profile HTTP client could not be initialized")]
    HttpClient,
}

#[derive(Debug, Error)]
pub(crate) enum ProfileProxyError {
    #[error("authorization bearer is required")]
    Unauthorized,
    #[error("Field profile request failed")]
    UpstreamRequest,
    #[error("Field profile returned an unsuccessful status")]
    UpstreamStatus,
    #[error("Field profile response exceeded the size limit")]
    OversizedResponse,
    #[error("Field profile response was not valid JSON")]
    InvalidJson,
    #[error("Field profile response violated the expected contract")]
    InvalidContract,
}

impl ProfileProxyError {
    fn reason(&self) -> &'static str {
        match self {
            Self::Unauthorized => "missing_bearer",
            Self::UpstreamRequest => "upstream_request",
            Self::UpstreamStatus => "upstream_status",
            Self::OversizedResponse => "oversized_response",
            Self::InvalidJson => "invalid_json",
            Self::InvalidContract => "invalid_contract",
        }
    }
}

impl IntoResponse for ProfileProxyError {
    fn into_response(self) -> Response {
        let (status, error, message) = match self {
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Authorization bearer token is required",
            ),
            _ => (
                StatusCode::BAD_GATEWAY,
                "profile_upstream_error",
                "Profile service is unavailable",
            ),
        };
        if status == StatusCode::BAD_GATEWAY {
            tracing::warn!(
                reason = self.reason(),
                "Field profile request failed closed"
            );
        }
        (status, Json(ProfileErrorResponse { error, message })).into_response()
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ProfileErrorResponse {
    error: &'static str,
    message: &'static str,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProfileResponse {
    pub user: ProfileUser,
    pub tenants: Vec<ProfileTenant>,
    pub default_tenant_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProfileUser {
    pub id: String,
    pub sub: Option<String>,
    pub email: Option<String>,
    pub username: String,
    pub onboarding_completed: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProfileTenant {
    pub id: String,
    pub name: String,
    /// Platform (parent tenant) this tenant belongs to. The client sends it as
    /// `x-platform-id`; omitted when the tenant directory lookup is unavailable.
    #[serde(
        rename = "platformId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub platform_id: Option<String>,
    /// Environment resolved by Field from Tachyon's platform hierarchy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<TenantEnvironment>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TenantEnvironment {
    Production,
    Sandbox,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TenantContext {
    platform_id: Option<String>,
    environment: Option<TenantEnvironment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TenantDirectoryWire {
    id: String,
    #[serde(default)]
    #[serde(rename = "platformId")]
    platform_id: Option<String>,
    #[serde(default)]
    environment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldProfileWire {
    user: Option<FieldProfileUserWire>,
    tenants: Option<Vec<FieldProfileTenantWire>>,
    #[serde(default)]
    default_tenant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldProfileUserWire {
    id: Option<String>,
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    email: Option<String>,
    username: Option<String>,
    #[serde(default)]
    onboarding_completed: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct FieldProfileTenantWire {
    id: Option<String>,
    name: Option<String>,
    extension: Option<FieldTenantExtensionWire>,
}

#[derive(Debug, Deserialize)]
struct FieldTenantExtensionWire {
    key: Option<String>,
    enabled: Option<bool>,
}

/// Return the authenticated user's tenants that have CourseBoard's required
/// Field extension enabled.
#[utoipa::path(
    get,
    path = "/v1/me",
    responses(
        (status = 200, description = "Authenticated profile filtered to eligible tenants", body = ProfileResponse),
        (status = 401, description = "Missing or locally invalid bearer", body = ProfileErrorResponse),
        (status = 502, description = "Field profile was unavailable or invalid", body = ProfileErrorResponse)
    ),
    tag = "identity",
    security(("bearer_auth" = []))
)]
pub(crate) async fn get_me(
    State(client): State<Arc<ProfileClient>>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<ProfileResponse>), ProfileProxyError> {
    let authorization = inbound_authorization(&headers)?;
    let profile = client.get_profile(authorization).await?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok((response_headers, Json(profile)))
}

fn inbound_authorization(headers: &HeaderMap) -> Result<&str, ProfileProxyError> {
    headers
        .get(header::AUTHORIZATION)
        .or_else(|| headers.get(crate::COURSEBOARD_AUTHORIZATION_HEADER))
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            value
                .strip_prefix("Bearer ")
                .is_some_and(|token| !token.trim().is_empty())
        })
        .ok_or(ProfileProxyError::Unauthorized)
}

async fn bounded_response_body(
    response: &mut reqwest::Response,
) -> Result<Vec<u8>, ProfileProxyError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PROFILE_RESPONSE_BYTES as u64)
    {
        return Err(ProfileProxyError::OversizedResponse);
    }

    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_PROFILE_RESPONSE_BYTES as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ProfileProxyError::UpstreamRequest)?
    {
        if body.len().saturating_add(chunk.len()) > MAX_PROFILE_RESPONSE_BYTES {
            return Err(ProfileProxyError::OversizedResponse);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn decode_and_filter_profile(body: &[u8]) -> Result<ProfileResponse, ProfileProxyError> {
    let wire: FieldProfileWire =
        serde_json::from_slice(body).map_err(|_| ProfileProxyError::InvalidJson)?;
    let user = wire.user.ok_or(ProfileProxyError::InvalidContract)?;
    let user = ProfileUser {
        id: required_non_blank(user.id)?,
        sub: optional_non_blank(user.sub)?,
        email: user.email,
        username: required_non_blank(user.username)?,
        onboarding_completed: user.onboarding_completed,
    };
    let tenants = wire.tenants.ok_or(ProfileProxyError::InvalidContract)?;
    if tenants.len() > MAX_PROFILE_TENANTS {
        return Err(ProfileProxyError::InvalidContract);
    }

    let mut candidate_ids = HashSet::with_capacity(tenants.len());
    let mut enabled_tenants = Vec::with_capacity(tenants.len());
    for tenant in tenants {
        let id = required_non_blank(tenant.id)?;
        if !is_valid_tenant_id(&id) || !candidate_ids.insert(id.clone()) {
            return Err(ProfileProxyError::InvalidContract);
        }
        let name = required_non_blank(tenant.name)?;
        let extension = tenant.extension.ok_or(ProfileProxyError::InvalidContract)?;
        if required_non_blank(extension.key)? != EXTENSION_KEY {
            return Err(ProfileProxyError::InvalidContract);
        }
        let enabled = extension
            .enabled
            .ok_or(ProfileProxyError::InvalidContract)?;
        if enabled {
            enabled_tenants.push(ProfileTenant {
                id,
                name,
                platform_id: None,
                environment: None,
            });
        }
    }

    if let Some(default_tenant_id) = wire.default_tenant_id.as_deref() {
        if !is_valid_tenant_id(default_tenant_id) || !candidate_ids.contains(default_tenant_id) {
            return Err(ProfileProxyError::InvalidContract);
        }
    }

    let default_tenant_id = match enabled_tenants.as_slice() {
        [tenant] => Some(tenant.id.clone()),
        _ => None,
    };
    Ok(ProfileResponse {
        user,
        tenants: enabled_tenants,
        default_tenant_id,
    })
}

fn required_non_blank(value: Option<String>) -> Result<String, ProfileProxyError> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or(ProfileProxyError::InvalidContract)
}

fn optional_non_blank(value: Option<String>) -> Result<Option<String>, ProfileProxyError> {
    match value {
        Some(value) if value.trim().is_empty() => Err(ProfileProxyError::InvalidContract),
        value => Ok(value),
    }
}

fn tenant_environment(value: Option<&str>) -> Option<TenantEnvironment> {
    match value {
        Some("production") => Some(TenantEnvironment::Production),
        Some("sandbox") => Some(TenantEnvironment::Sandbox),
        _ => None,
    }
}

fn is_valid_tenant_id(value: &str) -> bool {
    value.strip_prefix("tn_").is_some_and(|suffix| {
        suffix.len() == 26
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use axum::{
        body::Body,
        extract::{OriginalUri, State},
        http::{header, HeaderMap, Request, StatusCode},
        response::{IntoResponse, Response},
        routing::{get, post},
        Router,
    };
    use http_body_util::BodyExt;
    use serde_json::json;
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use tower::ServiceExt;

    use crate::auth::{StaticBearerVerifier, TokenVerifier};
    use crate::{build_router, AppState};

    use super::*;

    fn tenant_id(character: char) -> String {
        format!("tn_01{}", character.to_string().repeat(24))
    }

    fn field_profile(tenants: serde_json::Value) -> serde_json::Value {
        json!({
            "user": {
                "id": "us_fixture",
                "sub": "subject-fixture",
                "email": null,
                "username": "courseboard-user",
                "onboardingCompleted": true
            },
            "tenants": tenants,
            "defaultTenantId": null
        })
    }

    fn field_tenant(id: &str, enabled: bool) -> serde_json::Value {
        json!({
            "id": id,
            "name": format!("Tenant {id}"),
            "extension": {
                "key": EXTENSION_KEY,
                "enabled": enabled
            }
        })
    }

    #[test]
    fn filters_disabled_tenants_preserves_order_and_recomputes_single_default() {
        let disabled = tenant_id('a');
        let enabled = tenant_id('b');
        let body = field_profile(json!([
            field_tenant(&disabled, false),
            field_tenant(&enabled, true)
        ]));

        let profile = decode_and_filter_profile(body.to_string().as_bytes()).unwrap();

        assert_eq!(
            profile.tenants,
            vec![ProfileTenant {
                id: enabled.clone(),
                name: format!("Tenant {enabled}"),
                platform_id: None,
                environment: None,
            }]
        );
        assert_eq!(profile.default_tenant_id, Some(enabled));
    }

    #[test]
    fn zero_or_multiple_enabled_tenants_have_no_default() {
        let tenant_a = tenant_id('a');
        let tenant_b = tenant_id('b');
        let none = field_profile(json!([
            field_tenant(&tenant_a, false),
            field_tenant(&tenant_b, false)
        ]));
        let multiple = field_profile(json!([
            field_tenant(&tenant_a, true),
            field_tenant(&tenant_b, true)
        ]));

        let none = decode_and_filter_profile(none.to_string().as_bytes()).unwrap();
        let multiple = decode_and_filter_profile(multiple.to_string().as_bytes()).unwrap();

        assert!(none.tenants.is_empty());
        assert_eq!(none.default_tenant_id, None);
        assert_eq!(multiple.tenants.len(), 2);
        assert_eq!(multiple.default_tenant_id, None);
    }

    #[test]
    fn accepts_omitted_optional_profile_fields() {
        let body = json!({
            "user": {
                "id": "us_fixture",
                "username": "courseboard-user"
            },
            "tenants": []
        });

        let profile = decode_and_filter_profile(body.to_string().as_bytes()).unwrap();

        assert_eq!(profile.user.sub, None);
        assert_eq!(profile.user.email, None);
        assert_eq!(profile.user.onboarding_completed, None);
        assert_eq!(profile.default_tenant_id, None);
    }

    #[test]
    fn rejects_malformed_or_partial_field_contracts_without_partial_output() {
        let tenant = tenant_id('a');
        let missing_username = json!({
            "user": {"id": "us_fixture"},
            "tenants": []
        });
        let duplicate = field_profile(json!([
            field_tenant(&tenant, true),
            field_tenant(&tenant, false)
        ]));
        let wrong_extension = field_profile(json!([{
            "id": tenant,
            "name": "Tenant",
            "extension": {"key": "another_extension", "enabled": true}
        }]));
        let missing_enabled = field_profile(json!([{
            "id": tenant_id('b'),
            "name": "Tenant",
            "extension": {"key": EXTENSION_KEY}
        }]));
        let invalid_tenant = field_profile(json!([{
            "id": "tn_not-valid",
            "name": "Tenant",
            "extension": {"key": EXTENSION_KEY, "enabled": false}
        }]));

        for body in [
            missing_username,
            duplicate,
            wrong_extension,
            missing_enabled,
            invalid_tenant,
        ] {
            assert!(matches!(
                decode_and_filter_profile(body.to_string().as_bytes()),
                Err(ProfileProxyError::InvalidContract)
            ));
        }
        assert!(matches!(
            decode_and_filter_profile(b"{not-json"),
            Err(ProfileProxyError::InvalidJson)
        ));
    }

    #[test]
    fn rejects_invalid_default_and_unsupported_cardinality() {
        let tenant = tenant_id('a');
        let mut invalid_default = field_profile(json!([field_tenant(&tenant, true)]));
        invalid_default["defaultTenantId"] = json!(tenant_id('b'));
        let tenants = (0..=MAX_PROFILE_TENANTS)
            .map(|index| {
                let suffix = format!("{index:024}");
                field_tenant(&format!("tn_01{suffix}"), false)
            })
            .collect::<Vec<_>>();
        let oversized = field_profile(json!(tenants));

        assert!(matches!(
            decode_and_filter_profile(invalid_default.to_string().as_bytes()),
            Err(ProfileProxyError::InvalidContract)
        ));
        assert!(matches!(
            decode_and_filter_profile(oversized.to_string().as_bytes()),
            Err(ProfileProxyError::InvalidContract)
        ));
    }

    #[derive(Clone)]
    struct FakeField {
        status: StatusCode,
        body: Vec<u8>,
        delay: Duration,
        calls: Arc<AtomicUsize>,
    }

    async fn fake_field_profile(
        State(fake): State<FakeField>,
        OriginalUri(uri): OriginalUri,
        headers: HeaderMap,
    ) -> Response {
        fake.calls.fetch_add(1, Ordering::SeqCst);
        assert_eq!(uri.path(), FIELD_PROFILE_PATH);
        assert_eq!(uri.query(), Some("extensionKey=golf_course"));
        assert_eq!(
            headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer accepted-fixture")
        );
        if !fake.delay.is_zero() {
            tokio::time::sleep(fake.delay).await;
        }
        (
            fake.status,
            [(header::CONTENT_TYPE, "application/json")],
            fake.body,
        )
            .into_response()
    }

    async fn spawn_fake_field(
        status: StatusCode,
        body: Vec<u8>,
        delay: Duration,
    ) -> (String, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(FIELD_PROFILE_PATH, get(fake_field_profile))
            .with_state(FakeField {
                status,
                body,
                delay,
                calls: calls.clone(),
            });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), calls)
    }

    fn courseboard_app(client: Option<ProfileClient>) -> Router {
        let verifier: Arc<dyn TokenVerifier> =
            Arc::new(StaticBearerVerifier::new("accepted-fixture".to_string()));
        let pool = MySqlPoolOptions::new().connect_lazy_with(
            MySqlConnectOptions::new()
                .host("127.0.0.1")
                .username("root")
                .database("unused_profile_test"),
        );
        build_router(AppState::new(pool, verifier).with_profile_client(client))
    }

    #[tokio::test]
    async fn protected_route_validates_then_delegates_the_inbound_bearer() {
        let enabled = tenant_id('a');
        let body = field_profile(json!([field_tenant(&enabled, true)]))
            .to_string()
            .into_bytes();
        let (origin, calls) = spawn_fake_field(StatusCode::OK, body, Duration::ZERO).await;
        let client = ProfileClient::with_timeout(&origin, Duration::from_secs(1)).unwrap();
        let app = courseboard_app(Some(client));

        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/me")
                    .header(header::AUTHORIZATION, "Bearer rejected-fixture")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let success = app
            .oneshot(
                Request::builder()
                    .uri("/v1/me")
                    .header(header::AUTHORIZATION, "Bearer accepted-fixture")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(success.status(), StatusCode::OK);
        assert_eq!(
            success.headers().get(header::CACHE_CONTROL),
            Some(&HeaderValue::from_static("private, no-store"))
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let body = success.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["default_tenant_id"].as_str(), Some(enabled.as_str()));
        assert_eq!(json["user"]["onboarding_completed"], true);
        assert!(json.get("defaultTenantId").is_none());
        assert!(json["tenants"][0].get("extension").is_none());
        let profile: ProfileResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(profile.tenants.len(), 1);
        assert_eq!(profile.tenants[0].id, enabled);
    }

    async fn spawn_fake_tenant_directory(
        response_by_platform: Vec<(String, StatusCode, serde_json::Value)>,
    ) -> (String, Arc<AtomicUsize>) {
        let table = Arc::new(response_by_platform);
        let calls = Arc::new(AtomicUsize::new(0));
        let app = Router::new().route(
            FIELD_TENANT_DIRECTORY_PATH,
            post({
                let calls = calls.clone();
                move |OriginalUri(uri): OriginalUri, headers: HeaderMap| {
                    let table = table.clone();
                    let calls = calls.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        assert_eq!(
                            uri.query(),
                            Some("required_action=field%3AViewSalesAnalytics")
                        );
                        assert_eq!(
                            headers
                                .get(header::AUTHORIZATION)
                                .and_then(|value| value.to_str().ok()),
                            Some("Bearer accepted-fixture")
                        );
                        let platform_id = headers
                            .get("x-platform-id")
                            .and_then(|value| value.to_str().ok())
                            .unwrap();
                        assert_eq!(
                            headers
                                .get("x-operator-id")
                                .and_then(|value| value.to_str().ok()),
                            Some(platform_id)
                        );
                        match table.iter().find(|(id, _, _)| id == platform_id) {
                            Some((_, status, body)) => {
                                (*status, Json(body.clone())).into_response()
                            }
                            None => StatusCode::NOT_FOUND.into_response(),
                        }
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), calls)
    }

    #[tokio::test]
    async fn profile_tenants_use_two_bulk_lists_without_a_twenty_tenant_cap() {
        let production_ids = ('a'..='m').map(tenant_id).collect::<Vec<_>>();
        let sandbox_ids = ('n'..='z').map(tenant_id).collect::<Vec<_>>();
        let all_ids = production_ids
            .iter()
            .chain(&sandbox_ids)
            .cloned()
            .collect::<Vec<_>>();
        let body = field_profile(json!(all_ids
            .iter()
            .map(|id| field_tenant(id, true))
            .collect::<Vec<_>>()))
        .to_string()
        .into_bytes();
        let (field_origin, _) = spawn_fake_field(StatusCode::OK, body, Duration::ZERO).await;
        let directory_entry = |id: &String, environment: &str, platform_id: &str| {
            json!({
                "id": id,
                "name": format!("Tenant {id}"),
                "platformId": platform_id,
                "environment": environment,
            })
        };
        let (directory_origin, directory_calls) = spawn_fake_tenant_directory(vec![
            (
                TENANT_DIRECTORY_PLATFORM_IDS[0].to_string(),
                StatusCode::OK,
                json!(production_ids
                    .iter()
                    .map(|id| directory_entry(id, "production", TENANT_DIRECTORY_PLATFORM_IDS[0]))
                    .collect::<Vec<_>>()),
            ),
            (
                TENANT_DIRECTORY_PLATFORM_IDS[1].to_string(),
                StatusCode::OK,
                json!(sandbox_ids
                    .iter()
                    .map(|id| directory_entry(id, "sandbox", TENANT_DIRECTORY_PLATFORM_IDS[1]))
                    .collect::<Vec<_>>()),
            ),
        ])
        .await;
        let client = ProfileClient::with_timeout(&field_origin, Duration::from_secs(1))
            .unwrap()
            .with_tenant_directory_base(&directory_origin)
            .unwrap();
        let app = courseboard_app(Some(client));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/me")
                    .header(header::AUTHORIZATION, "Bearer accepted-fixture")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let profile: ProfileResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(directory_calls.load(Ordering::SeqCst), 2);
        assert_eq!(profile.tenants.len(), 26);
        assert!(profile.tenants[..production_ids.len()]
            .iter()
            .all(|tenant| {
                tenant.platform_id.as_deref() == Some(TENANT_DIRECTORY_PLATFORM_IDS[0])
                    && tenant.environment == Some(TenantEnvironment::Production)
            }));
        assert!(profile.tenants[production_ids.len()..]
            .iter()
            .all(|tenant| {
                tenant.platform_id.as_deref() == Some(TENANT_DIRECTORY_PLATFORM_IDS[1])
                    && tenant.environment == Some(TenantEnvironment::Sandbox)
            }));
    }

    #[tokio::test]
    async fn failed_or_unsupported_directory_context_remains_explicitly_unknown() {
        let resolved = tenant_id('a');
        let unsupported = tenant_id('b');
        let missing = tenant_id('c');
        let body = field_profile(json!([
            field_tenant(&resolved, true),
            field_tenant(&unsupported, true),
            field_tenant(&missing, true),
        ]))
        .to_string()
        .into_bytes();
        let (field_origin, _) = spawn_fake_field(StatusCode::OK, body, Duration::ZERO).await;
        let (directory_origin, _) = spawn_fake_tenant_directory(vec![
            (
                TENANT_DIRECTORY_PLATFORM_IDS[0].to_string(),
                StatusCode::OK,
                json!([
                    {
                        "id": resolved,
                        "platformId": TENANT_DIRECTORY_PLATFORM_IDS[0],
                        "environment": "production"
                    },
                    {
                        "id": unsupported,
                        "platformId": TENANT_DIRECTORY_PLATFORM_IDS[0],
                        "environment": "preview"
                    }
                ]),
            ),
            (
                TENANT_DIRECTORY_PLATFORM_IDS[1].to_string(),
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "fixture"}),
            ),
        ])
        .await;
        let client = ProfileClient::with_timeout(&field_origin, Duration::from_secs(1))
            .unwrap()
            .with_tenant_directory_base(&directory_origin)
            .unwrap();

        let profile = client.get_profile("Bearer accepted-fixture").await.unwrap();

        assert_eq!(profile.tenants.len(), 3);
        assert_eq!(
            profile.tenants[0].environment,
            Some(TenantEnvironment::Production)
        );
        assert_eq!(profile.tenants[1].environment, None);
        assert_eq!(
            profile.tenants[1].platform_id.as_deref(),
            Some(TENANT_DIRECTORY_PLATFORM_IDS[0])
        );
        assert_eq!(profile.tenants[2].environment, None);
        assert_eq!(profile.tenants[2].platform_id, None);
    }

    #[tokio::test]
    async fn empty_field_marker_leaves_profile_route_unregistered() {
        let response = courseboard_app(None)
            .oneshot(
                Request::builder()
                    .uri("/v1/me")
                    .header(header::AUTHORIZATION, "Bearer accepted-fixture")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn upstream_status_malformed_body_oversize_and_timeout_fail_closed() {
        let cases = [
            (StatusCode::UNAUTHORIZED, b"{}".to_vec(), Duration::ZERO),
            (StatusCode::FORBIDDEN, b"{}".to_vec(), Duration::ZERO),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                b"{}".to_vec(),
                Duration::ZERO,
            ),
            (StatusCode::OK, b"{not-json".to_vec(), Duration::ZERO),
            (
                StatusCode::OK,
                vec![b'x'; MAX_PROFILE_RESPONSE_BYTES + 1],
                Duration::ZERO,
            ),
            (
                StatusCode::OK,
                field_profile(json!([])).to_string().into_bytes(),
                Duration::from_millis(100),
            ),
        ];

        for (status, body, delay) in cases {
            let (origin, _) = spawn_fake_field(status, body, delay).await;
            let timeout = if delay.is_zero() {
                Duration::from_secs(1)
            } else {
                Duration::from_millis(10)
            };
            let app = courseboard_app(Some(ProfileClient::with_timeout(&origin, timeout).unwrap()));
            let response = app
                .oneshot(
                    Request::builder()
                        .uri("/v1/me")
                        .header(header::AUTHORIZATION, "Bearer accepted-fixture")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        }
    }

    #[test]
    fn profile_client_rejects_unsafe_urls_and_disables_only_empty_marker() {
        assert!(ProfileClient::from_field_api_url("empty://local", None)
            .unwrap()
            .is_none());
        for url in [
            "not-a-url",
            "file:///tmp/field",
            "https://user@example.test",
            "https://example.test?redirect=other",
            "https://example.test#fragment",
        ] {
            assert!(ProfileClient::from_field_api_url(url, None).is_err());
            assert!(ProfileClient::from_field_api_url("https://example.test", Some(url)).is_err());
        }
        let disabled_lookup =
            ProfileClient::from_field_api_url("https://example.test", Some("empty://local"))
                .unwrap()
                .unwrap();
        assert!(disabled_lookup.tenant_directory_endpoint.is_none());
        let default_lookup = ProfileClient::from_field_api_url("https://example.test", None)
            .unwrap()
            .unwrap();
        assert_eq!(
            default_lookup
                .tenant_directory_endpoint
                .as_ref()
                .map(Url::as_str),
            Some("https://example.test/get_tenants?required_action=field%3AViewSalesAnalytics")
        );
    }

    #[test]
    fn profile_client_preserves_configured_field_base_path() {
        let client =
            ProfileClient::with_timeout("https://example.test/field/", Duration::from_secs(1))
                .unwrap();

        assert_eq!(
            client.endpoint.as_str(),
            "https://example.test/field/v1/erp/me?extensionKey=golf_course"
        );
    }
}
