//! Feature flag evaluation against the Tachyon platform API (PLT-3384).
//!
//! Flags are declared in `tachyon.yaml` (`kind: FeatureFlags`, manifest
//! `courseboard-flags`) and live in the platform's flag store. This module is
//! the anti-corruption layer between CourseBoard and that store:
//!
//! - Rust callers go through the [`FeatureFlagEvaluator`] port. The upstream
//!   `FeatureFlagApp` also exposes mutation and domain types; CourseBoard owns
//!   this smaller read-only port so upstream changes stay in one HTTP adapter.
//! - The SPA calls `POST /v1/course/feature-flags/evaluate` on course-api
//!   instead of the platform GraphQL endpoint. ADR-0004 forbids the bundle
//!   from calling Tachyon platform APIs directly, so course-api proxies the
//!   evaluation, forwarding the inbound login bearer the same way the Field
//!   gateways do.
//!
//! Evaluation is fail-closed everywhere: a missing flag, a malformed provider
//! entry, or an upstream failure can never enable a feature.

use std::{collections::HashMap, fmt, time::Duration};

use async_trait::async_trait;
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::course::interfaces::openapi::ErrorBody;
use crate::{AppError, AppState};

pub const DEFAULT_TACHYON_API_URL: &str = "https://api.n1.tachy.one";
/// Shared-tenant guard: tachyonfield owns `feature.field.*` in the same flag
/// namespace, so course-api only ever evaluates its own prefix.
const COURSEBOARD_FEATURE_FLAG_PREFIX: &str = "feature.courseboard.";
const MAX_FEATURE_FLAG_KEYS: usize = 64;
const FEATURE_FLAG_REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone)]
pub struct FeatureFlagEvaluationContext {
    operator_id: String,
    platform_id: Option<String>,
    authorization: String,
}

impl FeatureFlagEvaluationContext {
    pub fn new(operator_id: String, platform_id: Option<String>, authorization: String) -> Self {
        Self {
            operator_id,
            platform_id,
            authorization,
        }
    }
}

impl fmt::Debug for FeatureFlagEvaluationContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FeatureFlagEvaluationContext")
            .field("operator_id", &self.operator_id)
            .field("platform_id", &self.platform_id)
            .field("authorization", &"<redacted>")
            .finish()
    }
}

#[derive(Debug)]
pub struct FeatureFlagProviderError;

impl fmt::Display for FeatureFlagProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("feature flag provider is unavailable")
    }
}

impl std::error::Error for FeatureFlagProviderError {}

/// CourseBoard-local read-only port for tenant feature flag evaluation.
#[async_trait]
pub trait FeatureFlagEvaluator: fmt::Debug + Send + Sync {
    async fn is_enabled_batch(
        &self,
        keys: &[String],
        context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, bool>, FeatureFlagProviderError>;

    async fn is_enabled(
        &self,
        key: &str,
        context: &FeatureFlagEvaluationContext,
    ) -> Result<bool, FeatureFlagProviderError> {
        let key = key.to_string();
        let values = self
            .is_enabled_batch(std::slice::from_ref(&key), context)
            .await?;
        Ok(values.get(&key).copied().unwrap_or(false))
    }
}

/// HTTP adapter for the platform GraphQL `featureFlagValues` query.
#[derive(Clone)]
pub struct TachyonFeatureFlagEvaluator {
    client: Option<reqwest::Client>,
    graphql_url: Option<reqwest::Url>,
}

impl TachyonFeatureFlagEvaluator {
    /// `empty://…` URLs build an unconfigured evaluator whose calls fail with
    /// [`FeatureFlagProviderError`] (and therefore 424), keeping tests and
    /// intentional opt-outs fail-closed instead of reaching the network.
    pub fn new(tachyon_api_url: &str) -> Self {
        if tachyon_api_url.trim().starts_with("empty://") {
            return Self {
                client: None,
                graphql_url: None,
            };
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(FEATURE_FLAG_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| {
                tracing::warn!(
                    error_kind = "client_build",
                    "feature flag HTTP client could not be created: {error}"
                );
            })
            .ok();
        let graphql_url = feature_flag_graphql_url(tachyon_api_url);
        if graphql_url.is_none() {
            tracing::warn!(
                error_kind = "invalid_url",
                "feature flag upstream URL is invalid"
            );
        }

        Self {
            client,
            graphql_url,
        }
    }
}

impl fmt::Debug for TachyonFeatureFlagEvaluator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TachyonFeatureFlagEvaluator")
            .field(
                "configured",
                &(self.client.is_some() && self.graphql_url.is_some()),
            )
            .finish()
    }
}

fn feature_flag_graphql_url(base_url: &str) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(base_url.trim()).ok()?;
    url.path_segments_mut()
        .ok()?
        .clear()
        .extend(["v1", "graphql"]);
    url.set_query(None);
    url.set_fragment(None);
    Some(url)
}

#[derive(Serialize)]
struct FeatureFlagGraphqlRequest<'a> {
    query: &'static str,
    variables: FeatureFlagGraphqlVariables<'a>,
}

#[derive(Serialize)]
struct FeatureFlagGraphqlVariables<'a> {
    keys: &'a [String],
}

#[derive(Deserialize)]
struct FeatureFlagGraphqlResponse {
    data: Option<FeatureFlagGraphqlData>,
    #[serde(default)]
    errors: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureFlagGraphqlData {
    feature_flag_values: Vec<FeatureFlagValue>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct FeatureFlagValue {
    pub key: String,
    pub enabled: bool,
}

#[async_trait]
impl FeatureFlagEvaluator for TachyonFeatureFlagEvaluator {
    async fn is_enabled_batch(
        &self,
        keys: &[String],
        context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, bool>, FeatureFlagProviderError> {
        let (Some(client), Some(graphql_url)) = (&self.client, &self.graphql_url) else {
            return Err(FeatureFlagProviderError);
        };

        let payload = FeatureFlagGraphqlRequest {
            query: "query CourseboardFeatureFlagValues($keys: [String!]!) { featureFlagValues(keys: $keys) { key enabled } }",
            variables: FeatureFlagGraphqlVariables { keys },
        };
        let mut request = client
            .post(graphql_url.clone())
            .header("x-operator-id", &context.operator_id)
            .header(reqwest::header::AUTHORIZATION, &context.authorization)
            .json(&payload);
        if let Some(platform_id) = &context.platform_id {
            request = request.header("x-platform-id", platform_id);
        }

        let response = request.send().await.map_err(|error| {
            tracing::warn!(
                error_kind = if error.is_timeout() {
                    "timeout"
                } else {
                    "network"
                },
                "feature flag provider request failed"
            );
            FeatureFlagProviderError
        })?;
        if !response.status().is_success() {
            tracing::warn!(
                upstream_status = response.status().as_u16(),
                "feature flag provider returned a non-success status"
            );
            return Err(FeatureFlagProviderError);
        }

        let payload = response
            .json::<FeatureFlagGraphqlResponse>()
            .await
            .map_err(|_| FeatureFlagProviderError)?;
        if !payload.errors.is_empty() {
            tracing::warn!(
                graphql_error_count = payload.errors.len(),
                "feature flag provider returned GraphQL errors"
            );
            return Err(FeatureFlagProviderError);
        }
        let data = payload.data.ok_or(FeatureFlagProviderError)?;

        // Initialize every requested key to false. Missing or malformed
        // provider entries can never accidentally enable a feature.
        let mut values = keys
            .iter()
            .map(|key| (key.clone(), false))
            .collect::<HashMap<_, _>>();
        for value in data.feature_flag_values {
            if let Some(enabled) = values.get_mut(&value.key) {
                *enabled = value.enabled;
            }
        }
        Ok(values)
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EvaluateFeatureFlagsRequest {
    keys: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, ToSchema)]
pub struct EvaluateFeatureFlagsResponse {
    values: Vec<FeatureFlagValue>,
}

fn validate_keys(keys: &[String]) -> Result<(), AppError> {
    if keys.is_empty() {
        return Err(AppError::BadRequest(
            "at least one feature flag key is required",
        ));
    }
    if keys.len() > MAX_FEATURE_FLAG_KEYS {
        return Err(AppError::BadRequest("too many feature flag keys"));
    }

    let mut seen = std::collections::HashSet::with_capacity(keys.len());
    for key in keys {
        if key.trim() != key || !key.starts_with(COURSEBOARD_FEATURE_FLAG_PREFIX) {
            return Err(AppError::BadRequest(
                "only feature.courseboard.* keys can be evaluated",
            ));
        }
        if !seen.insert(key) {
            return Err(AppError::BadRequest(
                "duplicate feature flag keys are not allowed",
            ));
        }
    }
    Ok(())
}

/// Evaluate CourseBoard-owned feature flags for the authenticated tenant.
///
/// Proxy over the platform GraphQL `featureFlagValues` query so the SPA never
/// talks to Tachyon platform APIs directly (ADR-0004).
#[utoipa::path(
    post,
    path = "/v1/course/feature-flags/evaluate",
    request_body = EvaluateFeatureFlagsRequest,
    responses(
        (status = 200, description = "Tenant-scoped feature flag values", body = EvaluateFeatureFlagsResponse),
        (status = 400, description = "Keys are missing, duplicated, or not feature.courseboard.*", body = ErrorBody),
        (status = 401, description = "Authorization failed", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    tag = "course"
)]
pub async fn evaluate_feature_flags(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<EvaluateFeatureFlagsRequest>,
) -> Result<Json<EvaluateFeatureFlagsResponse>, AppError> {
    validate_keys(&request.keys)?;

    let authorization = crate::course::interfaces::http::bearer_authorization(&headers)?;
    let operator_id = crate::course::interfaces::http::operator_id(&headers)?;
    let platform_id = headers
        .get("x-platform-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let context = FeatureFlagEvaluationContext::new(
        operator_id.to_string(),
        platform_id.map(str::to_string),
        authorization.to_string(),
    );

    let evaluator = state.feature_flags().ok_or_else(|| {
        AppError::Provider("feature flag evaluator is not configured".to_string())
    })?;
    let values = evaluator
        .is_enabled_batch(&request.keys, &context)
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?;

    Ok(Json(EvaluateFeatureFlagsResponse {
        values: request
            .keys
            .into_iter()
            .map(|key| FeatureFlagValue {
                enabled: values.get(&key).copied().unwrap_or(false),
                key,
            })
            .collect(),
    }))
}

/// Test double: every requested key evaluates to enabled.
#[cfg(test)]
#[derive(Debug)]
pub struct AllEnabledFeatureFlagEvaluator;

#[cfg(test)]
#[async_trait]
impl FeatureFlagEvaluator for AllEnabledFeatureFlagEvaluator {
    async fn is_enabled_batch(
        &self,
        keys: &[String],
        _context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, bool>, FeatureFlagProviderError> {
        Ok(keys.iter().map(|key| (key.clone(), true)).collect())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc as StdArc, Mutex};

    use super::*;

    fn context() -> FeatureFlagEvaluationContext {
        FeatureFlagEvaluationContext::new(
            "tn_operator".to_string(),
            Some("tn_platform".to_string()),
            "Bearer login-token".to_string(),
        )
    }

    #[test]
    fn validate_keys_rejects_empty_foreign_and_duplicate_keys() {
        assert!(validate_keys(&[]).is_err());
        assert!(validate_keys(&["feature.field.flag-evaluation-smoke".to_string()]).is_err());
        assert!(validate_keys(&[" feature.courseboard.padded".to_string()]).is_err());
        assert!(validate_keys(&[
            "feature.courseboard.a".to_string(),
            "feature.courseboard.a".to_string(),
        ])
        .is_err());
        let too_many = (0..=MAX_FEATURE_FLAG_KEYS)
            .map(|index| format!("feature.courseboard.flag-{index}"))
            .collect::<Vec<_>>();
        assert!(validate_keys(&too_many).is_err());
        assert!(validate_keys(&["feature.courseboard.flag-evaluation-smoke".to_string()]).is_ok());
    }

    #[test]
    fn graphql_url_replaces_path_and_strips_query() {
        let url = feature_flag_graphql_url("https://api.n1.tachy.one").expect("url");
        assert_eq!(url.as_str(), "https://api.n1.tachy.one/v1/graphql");
        let url = feature_flag_graphql_url("https://api.example.com/base/?q=1#frag").expect("url");
        assert_eq!(url.as_str(), "https://api.example.com/v1/graphql");
    }

    #[test]
    fn empty_marker_builds_unconfigured_evaluator() {
        let evaluator = TachyonFeatureFlagEvaluator::new("empty://local");
        assert!(evaluator.client.is_none() && evaluator.graphql_url.is_none());
    }

    #[tokio::test]
    async fn unconfigured_evaluator_fails_closed() {
        let evaluator = TachyonFeatureFlagEvaluator::new("empty://local");
        let keys = ["feature.courseboard.flag-evaluation-smoke".to_string()];
        assert!(evaluator.is_enabled_batch(&keys, &context()).await.is_err());
    }

    type SeenHeaders = StdArc<Mutex<Option<(Option<String>, Option<String>, Option<String>)>>>;

    async fn spawn_graphql_server(
        seen: SeenHeaders,
        response_body: serde_json::Value,
        status: axum::http::StatusCode,
    ) -> std::net::SocketAddr {
        let handler = move |headers: axum::http::HeaderMap| {
            let seen = seen.clone();
            let response_body = response_body.clone();
            async move {
                let header = |name: &str| {
                    headers
                        .get(name)
                        .and_then(|v| v.to_str().ok())
                        .map(String::from)
                };
                *seen.lock().unwrap() = Some((
                    header("x-operator-id"),
                    header("x-platform-id"),
                    header("authorization"),
                ));
                (status, axum::Json(response_body))
            }
        };
        let app = axum::Router::new().route("/v1/graphql", axum::routing::post(handler));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        addr
    }

    #[tokio::test]
    async fn evaluator_forwards_tenant_headers_and_fails_closed_on_missing_keys() {
        let seen: SeenHeaders = StdArc::new(Mutex::new(None));
        let addr = spawn_graphql_server(
            seen.clone(),
            serde_json::json!({
                "data": {
                    "featureFlagValues": [
                        { "key": "feature.courseboard.flag-evaluation-smoke", "enabled": true },
                        { "key": "feature.courseboard.unrequested", "enabled": true },
                    ]
                }
            }),
            axum::http::StatusCode::OK,
        )
        .await;

        let evaluator = TachyonFeatureFlagEvaluator::new(&format!("http://{addr}"));
        let keys = [
            "feature.courseboard.flag-evaluation-smoke".to_string(),
            "feature.courseboard.absent".to_string(),
        ];
        let values = evaluator
            .is_enabled_batch(&keys, &context())
            .await
            .expect("evaluation succeeds");

        assert_eq!(
            values.get("feature.courseboard.flag-evaluation-smoke"),
            Some(&true)
        );
        // Requested but not returned: stays disabled.
        assert_eq!(values.get("feature.courseboard.absent"), Some(&false));
        // Unrequested provider entries are dropped.
        assert_eq!(values.len(), 2);

        let (operator, platform, authorization) =
            seen.lock().unwrap().clone().expect("request was seen");
        assert_eq!(operator.as_deref(), Some("tn_operator"));
        assert_eq!(platform.as_deref(), Some("tn_platform"));
        assert_eq!(authorization.as_deref(), Some("Bearer login-token"));
    }

    #[tokio::test]
    async fn evaluator_rejects_graphql_errors_and_non_success_statuses() {
        let seen: SeenHeaders = StdArc::new(Mutex::new(None));
        let addr = spawn_graphql_server(
            seen.clone(),
            serde_json::json!({ "data": null, "errors": [{ "message": "boom" }] }),
            axum::http::StatusCode::OK,
        )
        .await;
        let evaluator = TachyonFeatureFlagEvaluator::new(&format!("http://{addr}"));
        let keys = ["feature.courseboard.flag-evaluation-smoke".to_string()];
        assert!(evaluator.is_enabled_batch(&keys, &context()).await.is_err());

        let addr = spawn_graphql_server(
            seen.clone(),
            serde_json::json!({ "message": "denied" }),
            axum::http::StatusCode::FORBIDDEN,
        )
        .await;
        let evaluator = TachyonFeatureFlagEvaluator::new(&format!("http://{addr}"));
        assert!(evaluator.is_enabled_batch(&keys, &context()).await.is_err());
    }
}
