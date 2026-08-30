use std::{collections::HashSet, sync::Arc, time::Duration};

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use utoipa::ToSchema;

use crate::config::{TenantSource, DEFAULT_TACHYON_API_URL, EMPTY_COURSE_STORE_URL};

const EXTENSION_KEY: &str = "golf_course";
const FIELD_PROFILE_PATH: &str = "/v1/erp/me";
const PLATFORM_PROFILE_PATH: &str = "/v1/me";
const CHECK_TENANTS_PATH: &str = "/v1/auth/policies/check-tenants";
/// The action whose policy grant means "this tenant is a CourseBoard tenant"
/// (ADR-0011). Every member policy in the golf auth manifest allows it and the
/// machine-to-machine calculator policy does not — a test on the manifest copy
/// below pins that property.
const REPRESENTATIVE_ACTION: &str = "field_extension_golf:ListTeeSheet";
const MAX_PROFILE_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_PROFILE_TENANTS: usize = 500;
const PROFILE_REQUEST_TIMEOUT: Duration = Duration::from_secs(7);
/// Tenants can live under different platforms (production vs sandbox). The
/// operator lookup tells the client which `x-platform-id` each tenant needs;
/// without it Field's tenant policy check denies platform-mismatched tenants.
const OPERATOR_LOOKUP_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_OPERATOR_LOOKUPS: usize = 20;

#[derive(Clone, Debug)]
pub struct ProfileClient {
    client: reqwest::Client,
    endpoint: Url,
    operators_base: Option<Url>,
    tenant_source: TenantSource,
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
        let auth_api_url = tachyon_auth_api_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_TACHYON_API_URL);
        let client = Self::with_timeout(field_api_url, PROFILE_REQUEST_TIMEOUT)?;
        if auth_api_url.starts_with("empty://") {
            return Ok(Some(client));
        }
        Ok(Some(client.with_operators_base(auth_api_url)?))
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
            operators_base: None,
            tenant_source: TenantSource::Extension,
        })
    }

    fn with_operators_base(
        mut self,
        tachyon_auth_api_url: &str,
    ) -> Result<Self, ProfileClientConfigError> {
        self.operators_base = Some(validated_base_url(tachyon_auth_api_url)?);
        Ok(self)
    }

    pub fn with_tenant_source(mut self, tenant_source: TenantSource) -> Self {
        if tenant_source != TenantSource::Extension && self.operators_base.is_none() {
            tracing::warn!(
                ?tenant_source,
                "policy tenant source needs the Tachyon API base URL, which is disabled; \
                 falling back to the extension source"
            );
            self.tenant_source = TenantSource::Extension;
            return self;
        }
        self.tenant_source = tenant_source;
        self
    }

    async fn get_profile(&self, authorization: &str) -> Result<ProfileResponse, ProfileProxyError> {
        match self.tenant_source {
            TenantSource::Extension => self.extension_profile(authorization).await,
            TenantSource::Compare => {
                let profile = self.extension_profile(authorization).await?;
                self.spawn_policy_comparison(&profile, authorization);
                Ok(profile)
            }
            TenantSource::Policy => self.policy_profile(authorization).await,
        }
    }

    async fn extension_profile(
        &self,
        authorization: &str,
    ) -> Result<ProfileResponse, ProfileProxyError> {
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
        self.attach_platform_ids(&mut profile, authorization).await;
        Ok(profile)
    }

    /// Best-effort per-tenant platform lookup: a failed lookup leaves the
    /// tenant without `platformId` and the client falls back to its default.
    async fn attach_platform_ids(&self, profile: &mut ProfileResponse, authorization: &str) {
        let Some(operators_base) = &self.operators_base else {
            return;
        };
        for tenant in profile.tenants.iter_mut().take(MAX_OPERATOR_LOOKUPS) {
            tenant.platform_id = self
                .fetch_operator_platform_id(operators_base, &tenant.id, authorization)
                .await;
        }
    }

    async fn fetch_operator_platform_id(
        &self,
        operators_base: &Url,
        tenant_id: &str,
        authorization: &str,
    ) -> Option<String> {
        let mut endpoint = operators_base.clone();
        let path = format!(
            "{}/v1/auth/operators/{tenant_id}",
            endpoint.path().trim_end_matches('/')
        );
        endpoint.set_path(&path);
        let response = self
            .client
            .get(endpoint)
            .timeout(OPERATOR_LOOKUP_TIMEOUT)
            .header(header::AUTHORIZATION.as_str(), authorization)
            .header(header::ACCEPT.as_str(), "application/json")
            // Tachyon auth requires an operator scope; the looked-up tenant is
            // the scope the caller is asking about.
            .header("x-operator-id", tenant_id)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            tracing::warn!(
                tenant_id,
                status = response.status().as_u16(),
                "tenant platform lookup was rejected; platformId omitted"
            );
            return None;
        }
        let wire: OperatorWire = response.json().await.ok()?;
        wire.platform_id
            .filter(|platform_id| is_valid_tenant_id(platform_id))
    }

    /// The policy-based tenant list (ADR-0011): the platform's own `/v1/me`,
    /// filtered by who actually holds the representative CourseBoard action.
    /// Field is not on this path at all.
    async fn policy_profile(
        &self,
        authorization: &str,
    ) -> Result<ProfileResponse, ProfileProxyError> {
        // with_tenant_source refuses the policy source without this base.
        let operators_base = self
            .operators_base
            .as_ref()
            .ok_or(ProfileProxyError::UpstreamRequest)?;
        let (user, tenants) = self
            .fetch_platform_profile(operators_base, authorization)
            .await?;
        self.filter_by_policy(operators_base, user, tenants, authorization)
            .await
    }

    /// `GET {tachyon-api}/v1/me` with the caller's own bearer. Deliberately no
    /// `x-operator-id` / `x-platform-id`: this is the one unscoped call, and a
    /// scope header makes the second platform's answer a 400.
    async fn fetch_platform_profile(
        &self,
        operators_base: &Url,
        authorization: &str,
    ) -> Result<(ProfileUser, Vec<PlatformTenant>), ProfileProxyError> {
        let mut endpoint = operators_base.clone();
        let path = format!(
            "{}{PLATFORM_PROFILE_PATH}",
            endpoint.path().trim_end_matches('/')
        );
        endpoint.set_path(&path);
        let mut response = self
            .client
            .get(endpoint)
            .header(header::AUTHORIZATION.as_str(), authorization)
            .header(header::ACCEPT.as_str(), "application/json")
            .send()
            .await
            .map_err(|_| ProfileProxyError::UpstreamRequest)?;
        if !response.status().is_success() {
            return Err(ProfileProxyError::UpstreamStatus);
        }
        let body = bounded_response_body(&mut response).await?;
        decode_platform_profile(&body)
    }

    /// Group the tenants by platform, ask `check-tenants` once per platform,
    /// and keep the `/v1/me` order. A platform whose check fails is kept
    /// unfiltered with `partial` set: the tenant list is a discovery
    /// affordance, not an authorization boundary — every later API authorizes
    /// independently — and the alternative sends every operator to a dead-end
    /// screen during an auth outage.
    async fn filter_by_policy(
        &self,
        operators_base: &Url,
        user: ProfileUser,
        tenants: Vec<PlatformTenant>,
        authorization: &str,
    ) -> Result<ProfileResponse, ProfileProxyError> {
        let mut platform_order: Vec<String> = Vec::new();
        for tenant in &tenants {
            if !platform_order.contains(&tenant.platform_id) {
                platform_order.push(tenant.platform_id.clone());
            }
        }
        let answers = futures::future::join_all(platform_order.iter().map(|platform_id| {
            let tenant_ids: Vec<String> = tenants
                .iter()
                .filter(|tenant| &tenant.platform_id == platform_id)
                .map(|tenant| tenant.id.clone())
                .collect();
            async move {
                let allowed = self
                    .check_tenants(operators_base, platform_id, &tenant_ids, authorization)
                    .await;
                (platform_id.clone(), tenant_ids, allowed)
            }
        }))
        .await;

        let mut partial = false;
        let mut allowed_ids: HashSet<String> = HashSet::new();
        for (platform_id, tenant_ids, allowed) in answers {
            match allowed {
                Ok(allowed) => allowed_ids.extend(allowed),
                Err(reason) => {
                    tracing::warn!(
                        platform_id,
                        reason,
                        "check-tenants failed; keeping this platform's tenants unfiltered"
                    );
                    partial = true;
                    allowed_ids.extend(tenant_ids);
                }
            }
        }

        let filtered: Vec<ProfileTenant> = tenants
            .into_iter()
            .filter(|tenant| allowed_ids.contains(&tenant.id))
            .map(|tenant| ProfileTenant {
                id: tenant.id,
                name: tenant.name,
                platform_id: Some(tenant.platform_id),
            })
            .collect();
        let default_tenant_id = match filtered.as_slice() {
            [tenant] => Some(tenant.id.clone()),
            _ => None,
        };
        Ok(ProfileResponse {
            user,
            tenants: filtered,
            default_tenant_id,
            partial: partial.then_some(true),
        })
    }

    /// `POST {tachyon-api}/v1/auth/policies/check-tenants` — which of these
    /// tenants grant the caller the representative action. Unscoped, like the
    /// platform profile call.
    async fn check_tenants(
        &self,
        operators_base: &Url,
        platform_id: &str,
        tenant_ids: &[String],
        authorization: &str,
    ) -> Result<Vec<String>, String> {
        let mut endpoint = operators_base.clone();
        let path = format!(
            "{}{CHECK_TENANTS_PATH}",
            endpoint.path().trim_end_matches('/')
        );
        endpoint.set_path(&path);
        let response = self
            .client
            .post(endpoint)
            .header(header::AUTHORIZATION.as_str(), authorization)
            .header(header::ACCEPT.as_str(), "application/json")
            .json(&CheckTenantsRequest {
                action: REPRESENTATIVE_ACTION,
                platform_id,
                tenant_ids,
            })
            .send()
            .await
            .map_err(|error| format!("request failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("answered {status}"));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("decode failed: {error}"))?;
        let wire: CheckTenantsResponse = serde_json::from_value(body.clone())
            .map_err(|error| format!("decode failed: {error}"))?;
        // Name the keys we did get, so a changed contract is diagnosable from
        // the log instead of looking like "this user holds nothing anywhere".
        wire.allowed_tenant_ids().ok_or_else(|| {
            let keys = body
                .as_object()
                .map(|object| object.keys().cloned().collect::<Vec<_>>().join(", "))
                .unwrap_or_else(|| "not an object".to_string());
            format!("answer carried no known allowed-tenant field; keys were [{keys}]")
        })
    }

    /// Compare mode: the extension answer was already served; run the policy
    /// path in the background and log the difference. A tenant only the old
    /// path lists would lose access on switch — that is fixed by granting the
    /// policy, not by code.
    fn spawn_policy_comparison(&self, extension_profile: &ProfileResponse, authorization: &str) {
        let client = self.clone();
        let extension_ids: Vec<String> = extension_profile
            .tenants
            .iter()
            .map(|tenant| tenant.id.clone())
            .collect();
        let authorization = authorization.to_string();
        tokio::spawn(async move {
            let policy = match client.policy_profile(&authorization).await {
                Ok(policy) => policy,
                Err(error) => {
                    tracing::warn!(
                        target: "tenant_source_compare",
                        reason = error.reason(),
                        "policy tenant source failed; nothing to compare"
                    );
                    return;
                }
            };
            let policy_ids: Vec<String> = policy
                .tenants
                .iter()
                .map(|tenant| tenant.id.clone())
                .collect();
            let only_extension: Vec<&String> = extension_ids
                .iter()
                .filter(|id| !policy_ids.contains(id))
                .collect();
            let only_policy: Vec<&String> = policy_ids
                .iter()
                .filter(|id| !extension_ids.contains(id))
                .collect();
            if only_extension.is_empty() && only_policy.is_empty() {
                tracing::info!(
                    target: "tenant_source_compare",
                    tenants = extension_ids.len(),
                    partial = policy.partial.unwrap_or(false),
                    "tenant sources agree"
                );
            } else {
                tracing::warn!(
                    target: "tenant_source_compare",
                    ?only_extension,
                    ?only_policy,
                    partial = policy.partial.unwrap_or(false),
                    "tenant sources disagree; only_extension tenants would lose \
                     access on switch — grant them the CourseBoard policy"
                );
            }
        });
    }
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
    /// Set when the policy filter could not run for some platform and its
    /// tenants are listed unfiltered. The UI already reads this flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial: Option<bool>,
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
    /// `x-platform-id`; omitted when the operator lookup is unavailable.
    #[serde(
        rename = "platformId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub platform_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OperatorWire {
    #[serde(rename = "platformId")]
    platform_id: Option<String>,
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

/// A tenant from the platform's own `/v1/me`, after dropping entries without a
/// platform parent (the platforms themselves).
#[derive(Debug)]
struct PlatformTenant {
    id: String,
    name: String,
    platform_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformProfileWire {
    user: Option<FieldProfileUserWire>,
    tenants: Option<Vec<PlatformTenantWire>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformTenantWire {
    id: Option<String>,
    name: Option<String>,
    #[serde(default)]
    platform_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckTenantsRequest<'a> {
    action: &'a str,
    platform_id: &'a str,
    tenant_ids: &'a [String],
}

/// Tolerant of the field name and element shape: compare mode exists exactly
/// to surface a contract mismatch in logs instead of on users, so the decoder
/// accepts the plausible spellings rather than betting on one.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckTenantsResponse {
    #[serde(default)]
    allowed_tenant_ids: Option<Vec<AllowedTenantWire>>,
    #[serde(default)]
    allowed_tenants: Option<Vec<AllowedTenantWire>>,
    #[serde(default)]
    tenant_ids: Option<Vec<AllowedTenantWire>>,
}

impl CheckTenantsResponse {
    /// `None` when the answer carried none of the known field names.
    ///
    /// That case must not read as "no tenant is allowed": the two are
    /// indistinguishable in the data but opposite in consequence — a contract
    /// mismatch would hide every tenant from every operator, while the caller
    /// treats an outright failure as "list them unfiltered and say so".
    fn allowed_tenant_ids(self) -> Option<Vec<String>> {
        Some(
            self.allowed_tenant_ids
                .or(self.allowed_tenants)
                .or(self.tenant_ids)?
                .into_iter()
                .map(AllowedTenantWire::into_id)
                .collect(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AllowedTenantWire {
    Id(String),
    Object {
        #[serde(alias = "tenantId")]
        id: String,
    },
}

impl AllowedTenantWire {
    fn into_id(self) -> String {
        match self {
            Self::Id(id) => id,
            Self::Object { id } => id,
        }
    }
}

fn decode_platform_profile(
    body: &[u8],
) -> Result<(ProfileUser, Vec<PlatformTenant>), ProfileProxyError> {
    let wire: PlatformProfileWire =
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
    let mut seen = HashSet::with_capacity(tenants.len());
    let mut kept = Vec::with_capacity(tenants.len());
    for tenant in tenants {
        let id = required_non_blank(tenant.id)?;
        if !is_valid_tenant_id(&id) || !seen.insert(id.clone()) {
            return Err(ProfileProxyError::InvalidContract);
        }
        let name = required_non_blank(tenant.name)?;
        // No platform parent means this entry is a platform itself (the top of
        // the hierarchy); CourseBoard tenants always live under one.
        let Some(platform_id) = tenant
            .platform_id
            .filter(|platform_id| is_valid_tenant_id(platform_id))
        else {
            continue;
        };
        kept.push(PlatformTenant {
            id,
            name,
            platform_id,
        });
    }
    Ok((user, kept))
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
    let mut missing_extension = 0usize;
    for tenant in tenants {
        let id = required_non_blank(tenant.id)?;
        if !is_valid_tenant_id(&id) || !candidate_ids.insert(id.clone()) {
            return Err(ProfileProxyError::InvalidContract);
        }
        let name = required_non_blank(tenant.name)?;
        // A missing or malformed extension block excludes the tenant instead
        // of failing the whole profile. The day Field stops returning this
        // block must degrade to "that tenant is not listed", not "nobody can
        // sign in" — the first migration step of ADR-0011.
        let Some(extension) = tenant.extension else {
            missing_extension += 1;
            continue;
        };
        let enabled = extension.key.as_deref().map(str::trim) == Some(EXTENSION_KEY)
            && extension.enabled == Some(true);
        if enabled {
            enabled_tenants.push(ProfileTenant {
                id,
                name,
                platform_id: None,
            });
        }
    }
    if missing_extension > 0 {
        tracing::warn!(
            missing_extension,
            "Field profile tenants had no extension block; excluded from the list"
        );
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
        partial: None,
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
        routing::get,
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
        let invalid_tenant = field_profile(json!([{
            "id": "tn_not-valid",
            "name": "Tenant",
            "extension": {"key": EXTENSION_KEY, "enabled": false}
        }]));

        for body in [missing_username, duplicate, invalid_tenant] {
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
    fn missing_or_malformed_extension_blocks_exclude_the_tenant_not_the_profile() {
        // The day Field stops returning the extension block must not lock
        // everyone out with a 502: those tenants drop off the list and the
        // rest of the profile still decodes (ADR-0011's first migration step).
        let no_block = tenant_id('a');
        let wrong_key = tenant_id('b');
        let no_enabled = tenant_id('c');
        let enabled = tenant_id('d');
        let body = field_profile(json!([
            {"id": no_block, "name": "No block"},
            {"id": wrong_key, "name": "Wrong key", "extension": {"key": "another_extension", "enabled": true}},
            {"id": no_enabled, "name": "No enabled", "extension": {"key": EXTENSION_KEY}},
            field_tenant(&enabled, true),
        ]));

        let profile = decode_and_filter_profile(body.to_string().as_bytes()).unwrap();

        assert_eq!(
            profile
                .tenants
                .iter()
                .map(|tenant| tenant.id.as_str())
                .collect::<Vec<_>>(),
            vec![enabled.as_str()]
        );
        assert_eq!(profile.default_tenant_id, Some(enabled));
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

    async fn spawn_fake_operators(platform_by_tenant: Vec<(String, Option<String>)>) -> String {
        use axum::extract::Path;
        let table = Arc::new(platform_by_tenant);
        let app = Router::new().route(
            "/v1/auth/operators/:tenant_id",
            get(move |Path(tenant_id): Path<String>, headers: HeaderMap| {
                let table = table.clone();
                async move {
                    assert_eq!(
                        headers
                            .get(header::AUTHORIZATION)
                            .and_then(|value| value.to_str().ok()),
                        Some("Bearer accepted-fixture")
                    );
                    assert_eq!(
                        headers
                            .get("x-operator-id")
                            .and_then(|value| value.to_str().ok()),
                        Some(tenant_id.as_str())
                    );
                    match table.iter().find(|(id, _)| *id == tenant_id) {
                        Some((id, Some(platform_id))) => serde_json::json!({
                            "id": id,
                            "name": format!("Tenant {id}"),
                            "operatorName": "fixture",
                            "platformId": platform_id,
                        })
                        .to_string()
                        .into_response(),
                        Some((_, None)) => StatusCode::FORBIDDEN.into_response(),
                        None => StatusCode::NOT_FOUND.into_response(),
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn profile_tenants_carry_platform_id_and_lookup_failures_omit_it() {
        let resolved = tenant_id('a');
        let denied = tenant_id('b');
        let sandbox_platform = tenant_id('s');
        let body = field_profile(json!([
            field_tenant(&resolved, true),
            field_tenant(&denied, true)
        ]))
        .to_string()
        .into_bytes();
        let (field_origin, _) = spawn_fake_field(StatusCode::OK, body, Duration::ZERO).await;
        let operators_origin = spawn_fake_operators(vec![
            (resolved.clone(), Some(sandbox_platform.clone())),
            (denied.clone(), None),
        ])
        .await;
        let client = ProfileClient::with_timeout(&field_origin, Duration::from_secs(1))
            .unwrap()
            .with_operators_base(&operators_origin)
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
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            json["tenants"][0]["platformId"].as_str(),
            Some(sandbox_platform.as_str())
        );
        assert!(json["tenants"][1].get("platformId").is_none());
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
        assert!(disabled_lookup.operators_base.is_none());
        let default_lookup = ProfileClient::from_field_api_url("https://example.test", None)
            .unwrap()
            .unwrap();
        assert_eq!(
            default_lookup.operators_base.as_ref().map(Url::as_str),
            Some("https://api.n1.tachy.one/")
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

    /// A fake of the platform: `/v1/me` and `check-tenants`. Both handlers
    /// assert the scopeless-call contract — a scope header on either call is
    /// the bug ADR-0011 warns about (the second platform answers 400).
    async fn spawn_fake_platform(
        tenants: serde_json::Value,
        allowed_by_platform: Vec<(String, Option<Vec<String>>)>,
    ) -> (String, Arc<std::sync::Mutex<Vec<serde_json::Value>>>) {
        use axum::Json;
        let check_bodies = Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = check_bodies.clone();
        let table = Arc::new(allowed_by_platform);
        let me_body = json!({
            "user": {"id": "us_fixture", "username": "courseboard-user"},
            "tenants": tenants,
        });
        let app = Router::new()
            .route(
                PLATFORM_PROFILE_PATH,
                get(move |headers: HeaderMap| {
                    let me_body = me_body.clone();
                    async move {
                        assert!(headers.get("x-operator-id").is_none());
                        assert!(headers.get("x-platform-id").is_none());
                        Json(me_body)
                    }
                }),
            )
            .route(
                CHECK_TENANTS_PATH,
                axum::routing::post(
                    move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                        let table = table.clone();
                        let recorded = recorded.clone();
                        async move {
                            assert!(headers.get("x-operator-id").is_none());
                            assert!(headers.get("x-platform-id").is_none());
                            assert_eq!(body["action"].as_str(), Some(REPRESENTATIVE_ACTION));
                            let platform_id = body["platformId"].as_str().unwrap().to_string();
                            recorded.lock().unwrap().push(body);
                            match table.iter().find(|(id, _)| *id == platform_id) {
                                Some((_, Some(allowed))) => {
                                    Json(json!({"allowedTenantIds": allowed})).into_response()
                                }
                                Some((_, None)) => {
                                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                                }
                                None => panic!("unexpected platform {platform_id}"),
                            }
                        }
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), check_bodies)
    }

    fn platform_me_tenant(id: &str, platform_id: Option<&str>) -> serde_json::Value {
        match platform_id {
            Some(platform_id) => json!({
                "id": id,
                "name": format!("Tenant {id}"),
                "platformId": platform_id,
            }),
            None => json!({"id": id, "name": format!("Tenant {id}")}),
        }
    }

    #[tokio::test]
    async fn policy_source_filters_by_check_tenants_and_keeps_me_order() {
        let platform_a = tenant_id('p');
        let platform_b = tenant_id('q');
        let tenant_1 = tenant_id('a');
        let tenant_2 = tenant_id('b');
        let tenant_3 = tenant_id('c');
        let (platform_origin, check_bodies) = spawn_fake_platform(
            json!([
                // The platform itself has no parent and must be dropped.
                platform_me_tenant(&platform_a, None),
                platform_me_tenant(&tenant_1, Some(&platform_a)),
                platform_me_tenant(&tenant_2, Some(&platform_b)),
                platform_me_tenant(&tenant_3, Some(&platform_a)),
            ]),
            vec![
                // Answer order deliberately differs from /v1/me order.
                (
                    platform_a.clone(),
                    Some(vec![tenant_3.clone(), tenant_1.clone()]),
                ),
                (platform_b.clone(), Some(vec![])),
            ],
        )
        .await;
        let client = ProfileClient::with_timeout("http://field.invalid", Duration::from_secs(1))
            .unwrap()
            .with_operators_base(&platform_origin)
            .unwrap()
            .with_tenant_source(TenantSource::Policy);

        let profile = client.get_profile("Bearer accepted-fixture").await.unwrap();

        assert_eq!(
            profile
                .tenants
                .iter()
                .map(|tenant| (tenant.id.as_str(), tenant.platform_id.as_deref()))
                .collect::<Vec<_>>(),
            vec![
                (tenant_1.as_str(), Some(platform_a.as_str())),
                (tenant_3.as_str(), Some(platform_a.as_str())),
            ]
        );
        assert_eq!(profile.default_tenant_id, None);
        assert_eq!(profile.partial, None);
        let bodies = check_bodies.lock().unwrap();
        assert_eq!(bodies.len(), 2);
        let for_a = bodies
            .iter()
            .find(|body| body["platformId"] == json!(platform_a))
            .unwrap();
        assert_eq!(for_a["tenantIds"], json!([tenant_1, tenant_3]));
    }

    /// An answer whose shape we do not recognise must not read as "this user
    /// holds nothing anywhere". Empty and unrecognised are identical in the
    /// data and opposite in consequence: the first is a real answer, the
    /// second would hide every tenant from every operator if the contract
    /// ever changed under us.
    #[tokio::test]
    async fn an_unrecognised_check_tenants_answer_degrades_instead_of_hiding_everything() {
        use axum::Json;
        let platform = tenant_id('p');
        let tenant = tenant_id('a');
        let me_body = json!({
            "user": {"id": "us_fixture", "username": "courseboard-user"},
            "tenants": [platform_me_tenant(&tenant, Some(&platform))],
        });
        let app = Router::new()
            .route(
                PLATFORM_PROFILE_PATH,
                get(move || {
                    let me_body = me_body.clone();
                    async move { Json(me_body) }
                }),
            )
            .route(
                CHECK_TENANTS_PATH,
                // 200, but shaped like the single-tenant check endpoint.
                axum::routing::post(|| async {
                    Json(json!({"results": [{"action": REPRESENTATIVE_ACTION, "allowed": true}]}))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = ProfileClient::with_timeout("http://field.invalid", Duration::from_secs(1))
            .unwrap()
            .with_operators_base(&format!("http://{address}"))
            .unwrap()
            .with_tenant_source(TenantSource::Policy);

        let profile = client.get_profile("Bearer accepted-fixture").await.unwrap();

        assert_eq!(
            profile
                .tenants
                .iter()
                .map(|tenant| tenant.id.as_str())
                .collect::<Vec<_>>(),
            vec![tenant.as_str()]
        );
        assert_eq!(profile.partial, Some(true));
    }

    #[tokio::test]
    async fn policy_source_keeps_a_platform_unfiltered_when_its_check_fails() {
        let platform_a = tenant_id('p');
        let platform_b = tenant_id('q');
        let tenant_1 = tenant_id('a');
        let tenant_2 = tenant_id('b');
        let (platform_origin, _) = spawn_fake_platform(
            json!([
                platform_me_tenant(&tenant_1, Some(&platform_a)),
                platform_me_tenant(&tenant_2, Some(&platform_b)),
            ]),
            vec![
                (platform_a.clone(), Some(vec![])),
                (platform_b.clone(), None),
            ],
        )
        .await;
        let client = ProfileClient::with_timeout("http://field.invalid", Duration::from_secs(1))
            .unwrap()
            .with_operators_base(&platform_origin)
            .unwrap()
            .with_tenant_source(TenantSource::Policy);

        let profile = client.get_profile("Bearer accepted-fixture").await.unwrap();

        // Platform B could not be checked: its tenant stays listed and the
        // response says the list is partial. Platform A answered "none".
        assert_eq!(
            profile
                .tenants
                .iter()
                .map(|tenant| tenant.id.as_str())
                .collect::<Vec<_>>(),
            vec![tenant_2.as_str()]
        );
        assert_eq!(profile.partial, Some(true));
        // Exactly one surviving tenant still becomes the default.
        assert_eq!(profile.default_tenant_id, Some(tenant_2));
    }

    #[tokio::test]
    async fn compare_source_serves_the_extension_answer_even_when_policy_side_is_down() {
        let enabled = tenant_id('a');
        let body = field_profile(json!([field_tenant(&enabled, true)]))
            .to_string()
            .into_bytes();
        let (field_origin, _) = spawn_fake_field(StatusCode::OK, body, Duration::ZERO).await;
        // A dead policy side must never surface in the served response.
        let client = ProfileClient::with_timeout(&field_origin, Duration::from_secs(1))
            .unwrap()
            .with_operators_base("http://127.0.0.1:1")
            .unwrap()
            .with_tenant_source(TenantSource::Compare);

        let profile = client.get_profile("Bearer accepted-fixture").await.unwrap();

        assert_eq!(profile.tenants.len(), 1);
        assert_eq!(profile.tenants[0].id, enabled);
        assert_eq!(profile.partial, None);
    }

    #[test]
    fn tenant_source_downgrades_to_extension_without_a_platform_base() {
        let client = ProfileClient::with_timeout("https://example.test", Duration::from_secs(1))
            .unwrap()
            .with_tenant_source(TenantSource::Policy);

        assert_eq!(client.tenant_source, TenantSource::Extension);
    }

    /// "A new role hid every tenant from its holders" is only observable in
    /// production; this pins it in CI instead. Every member policy in the golf
    /// auth manifest must allow the representative action, and the
    /// machine-to-machine calculator policy must not (its executor cannot call
    /// `check-tenants` anyway).
    #[test]
    fn representative_action_is_granted_by_every_member_policy() {
        let manifest = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/.tachyon/manifests/tachyonfield-golf-auth.yml"
        ))
        .expect("read the golf auth manifest copy");
        let (_, policies) = manifest
            .split_once("\npolicies:")
            .expect("manifest has a policies section");
        let grant = format!("action: {REPRESENTATIVE_ACTION}");
        let mut member_policies = 0;
        for block in policies.split("\n- name: ").skip(1) {
            let name = block.lines().next().expect("policy name").trim();
            if name == "field-extension:golf:calculator" {
                assert!(
                    !block.contains(&grant),
                    "the machine-to-machine policy must not carry the tenant-selection action"
                );
                continue;
            }
            member_policies += 1;
            assert!(
                block.contains(&grant),
                "policy {name} does not allow {REPRESENTATIVE_ACTION}; switching tenant \
                 selection to the policy source would hide every tenant from people \
                 holding only this role"
            );
        }
        assert!(
            member_policies >= 5,
            "expected the five member policies in the manifest copy"
        );
    }
}
