use std::{collections::HashMap, fmt, sync::Arc, time::Duration};

use async_trait::async_trait;
use axum::{
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{AppError, AppState};

const COURSEBOARD_FEATURE_FLAG_PREFIX: &str = "feature.courseboard.";
const MAX_FEATURE_FLAG_KEYS: usize = 64;
const FEATURE_FLAG_REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone)]
pub struct FeatureFlagEvaluationContext {
    authorization: String,
    operator_id: String,
    platform_id: Option<String>,
}

impl FeatureFlagEvaluationContext {
    fn from_headers(headers: &HeaderMap) -> Result<Self, AppError> {
        let authorization = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .filter(|value| {
                value
                    .strip_prefix("Bearer ")
                    .is_some_and(|token| !token.trim().is_empty())
            })
            .ok_or(AppError::Unauthorized)?
            .to_string();
        let operator_id = required_header(headers, "x-operator-id")?.to_string();
        let platform_id = optional_header(headers, "x-platform-id").map(ToOwned::to_owned);

        Ok(Self {
            authorization,
            operator_id,
            platform_id,
        })
    }
}

impl fmt::Debug for FeatureFlagEvaluationContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FeatureFlagEvaluationContext")
            .field("authorization", &"<redacted>")
            .field("operator_id", &self.operator_id)
            .field("platform_id", &self.platform_id)
            .finish()
    }
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, AppError> {
    optional_header(headers, name).ok_or(AppError::BadRequest("x-operator-id header is required"))
}

fn optional_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

#[derive(Debug)]
pub struct FeatureFlagProviderError;

impl fmt::Display for FeatureFlagProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("feature flag provider is unavailable")
    }
}

impl std::error::Error for FeatureFlagProviderError {}

/// CourseBoard-local, read-only feature flag boundary.
///
/// The Tachyon-internal `FeatureFlagApp` also carries mutation APIs and its own
/// domain types. Keeping this port narrow isolates CourseBoard from those
/// upstream changes and makes fail-closed behavior part of the product contract.
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

#[derive(Debug)]
struct UnavailableFeatureFlagEvaluator;

#[async_trait]
impl FeatureFlagEvaluator for UnavailableFeatureFlagEvaluator {
    async fn is_enabled_batch(
        &self,
        _keys: &[String],
        _context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, bool>, FeatureFlagProviderError> {
        Err(FeatureFlagProviderError)
    }
}

#[derive(Clone)]
pub struct TachyonFeatureFlagEvaluator {
    client: Option<reqwest::Client>,
    graphql_url: Option<reqwest::Url>,
}

impl TachyonFeatureFlagEvaluator {
    pub fn new(tachyon_api_url: &str) -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(FEATURE_FLAG_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| {
                tracing::warn!(
                    error_kind = "client_build",
                    "Feature flag HTTP client could not be created: {error}"
                );
            })
            .ok();
        let graphql_url = feature_flag_graphql_url(tachyon_api_url).or_else(|| {
            tracing::warn!(
                error_kind = "invalid_url",
                "Feature flag upstream URL is invalid"
            );
            None
        });

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
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let mut segments = url.path_segments_mut().ok()?;
    segments.clear();
    segments.extend(["v1", "graphql"]);
    drop(segments);
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
            query: "query CourseBoardFeatureFlagValues($keys: [String!]!) { featureFlagValues(keys: $keys) { key enabled } }",
            variables: FeatureFlagGraphqlVariables { keys },
        };
        let mut request = client
            .post(graphql_url.clone())
            .header(AUTHORIZATION, &context.authorization)
            .header("x-operator-id", &context.operator_id)
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
                "Feature flag provider request failed"
            );
            FeatureFlagProviderError
        })?;
        if !response.status().is_success() {
            tracing::warn!(
                upstream_status = response.status().as_u16(),
                "Feature flag provider returned a non-success status"
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
                "Feature flag provider returned GraphQL errors"
            );
            return Err(FeatureFlagProviderError);
        }
        let data = payload.data.ok_or(FeatureFlagProviderError)?;

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

#[derive(Clone, Debug)]
pub struct EvaluateFeatureFlags {
    evaluator: Arc<dyn FeatureFlagEvaluator>,
}

impl EvaluateFeatureFlags {
    pub fn new(evaluator: Arc<dyn FeatureFlagEvaluator>) -> Self {
        Self { evaluator }
    }

    pub fn unavailable() -> Self {
        Self::new(Arc::new(UnavailableFeatureFlagEvaluator))
    }

    async fn execute(
        &self,
        input: EvaluateFeatureFlagsRequest,
        context: &FeatureFlagEvaluationContext,
    ) -> Result<EvaluateFeatureFlagsResponse, EvaluateFeatureFlagsError> {
        validate_keys(&input.keys)?;
        let values = self
            .evaluator
            .is_enabled_batch(&input.keys, context)
            .await
            .map_err(EvaluateFeatureFlagsError::Provider)?;

        Ok(EvaluateFeatureFlagsResponse {
            values: input
                .keys
                .into_iter()
                .map(|key| FeatureFlagValue {
                    enabled: values.get(&key).copied().unwrap_or(false),
                    key,
                })
                .collect(),
        })
    }
}

#[derive(Debug)]
enum EvaluateFeatureFlagsError {
    InvalidInput(&'static str),
    Provider(FeatureFlagProviderError),
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EvaluateFeatureFlagsRequest {
    keys: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, ToSchema)]
pub struct EvaluateFeatureFlagsResponse {
    values: Vec<FeatureFlagValue>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
pub struct FeatureFlagValue {
    pub key: String,
    pub enabled: bool,
}

fn validate_keys(keys: &[String]) -> Result<(), EvaluateFeatureFlagsError> {
    if keys.is_empty() {
        return Err(EvaluateFeatureFlagsError::InvalidInput(
            "at least one feature flag key is required",
        ));
    }
    if keys.len() > MAX_FEATURE_FLAG_KEYS {
        return Err(EvaluateFeatureFlagsError::InvalidInput(
            "too many feature flag keys",
        ));
    }

    let mut seen = std::collections::HashSet::with_capacity(keys.len());
    for key in keys {
        if key.trim() != key || !key.starts_with(COURSEBOARD_FEATURE_FLAG_PREFIX) {
            return Err(EvaluateFeatureFlagsError::InvalidInput(
                "only feature.courseboard.* keys can be evaluated",
            ));
        }
        if !seen.insert(key) {
            return Err(EvaluateFeatureFlagsError::InvalidInput(
                "duplicate feature flag keys are not allowed",
            ));
        }
    }
    Ok(())
}

/// Evaluate CourseBoard-owned feature flags for the authenticated tenant.
#[utoipa::path(
    post,
    path = "/v1/course/feature-flags/evaluate",
    request_body = EvaluateFeatureFlagsRequest,
    responses(
        (status = 200, description = "Tenant-scoped feature flag values", body = EvaluateFeatureFlagsResponse),
        (status = 400, description = "Tenant scope or CourseBoard-owned keys are invalid", body = crate::course::interfaces::openapi::ErrorBody),
        (status = 401, description = "Authenticated user bearer is required", body = crate::course::interfaces::openapi::ErrorBody),
        (status = 424, description = "Tachyon feature flag evaluation failed", body = crate::course::interfaces::openapi::ErrorBody)
    ),
    security(("bearer_auth" = [])),
    tag = "feature-flags"
)]
pub async fn evaluate_feature_flags(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<EvaluateFeatureFlagsRequest>,
) -> Result<Json<EvaluateFeatureFlagsResponse>, AppError> {
    let context = FeatureFlagEvaluationContext::from_headers(&headers)?;
    state
        .feature_flags()
        .execute(input, &context)
        .await
        .map(Json)
        .map_err(|error| match error {
            EvaluateFeatureFlagsError::InvalidInput(message) => AppError::BadRequest(message),
            EvaluateFeatureFlagsError::Provider(_) => {
                AppError::Provider("feature flag provider is unavailable".to_string())
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::post, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    #[derive(Debug)]
    struct PartialEvaluator;

    #[async_trait]
    impl FeatureFlagEvaluator for PartialEvaluator {
        async fn is_enabled_batch(
            &self,
            _keys: &[String],
            _context: &FeatureFlagEvaluationContext,
        ) -> Result<HashMap<String, bool>, FeatureFlagProviderError> {
            Ok(HashMap::from([(
                "feature.courseboard.flag-evaluation-smoke".to_string(),
                true,
            )]))
        }
    }

    fn context() -> FeatureFlagEvaluationContext {
        FeatureFlagEvaluationContext {
            authorization: "Bearer test-bearer".to_string(),
            operator_id: "tn_operator".to_string(),
            platform_id: Some("tn_platform".to_string()),
        }
    }

    #[tokio::test]
    async fn undeclared_or_missing_flag_is_fail_closed() {
        let usecase = EvaluateFeatureFlags::new(Arc::new(PartialEvaluator));
        let response = usecase
            .execute(
                EvaluateFeatureFlagsRequest {
                    keys: vec![
                        "feature.courseboard.flag-evaluation-smoke".to_string(),
                        "feature.courseboard.not-declared".to_string(),
                    ],
                },
                &context(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.values,
            vec![
                FeatureFlagValue {
                    key: "feature.courseboard.flag-evaluation-smoke".to_string(),
                    enabled: true,
                },
                FeatureFlagValue {
                    key: "feature.courseboard.not-declared".to_string(),
                    enabled: false,
                },
            ]
        );
        assert!(usecase
            .evaluator
            .is_enabled("feature.courseboard.flag-evaluation-smoke", &context())
            .await
            .unwrap());
        assert!(!usecase
            .evaluator
            .is_enabled("feature.courseboard.not-declared", &context())
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn rejects_keys_outside_courseboard_namespace() {
        let usecase = EvaluateFeatureFlags::new(Arc::new(PartialEvaluator));
        let result = usecase
            .execute(
                EvaluateFeatureFlagsRequest {
                    keys: vec!["feature.field.flag-evaluation-smoke".to_string()],
                },
                &context(),
            )
            .await;

        assert!(matches!(
            result,
            Err(EvaluateFeatureFlagsError::InvalidInput(_))
        ));
    }

    #[tokio::test]
    async fn tachyon_adapter_forwards_scope_and_defaults_missing_keys_to_false() {
        async fn upstream(
            headers: HeaderMap,
            Json(body): Json<serde_json::Value>,
        ) -> Json<serde_json::Value> {
            assert_eq!(headers[AUTHORIZATION], "Bearer test-bearer");
            assert_eq!(headers["x-operator-id"], "tn_operator");
            assert_eq!(headers["x-platform-id"], "tn_platform");
            assert_eq!(
                body["variables"]["keys"],
                json!([
                    "feature.courseboard.flag-evaluation-smoke",
                    "feature.courseboard.not-declared"
                ])
            );
            Json(json!({
                "data": {
                    "featureFlagValues": [{
                        "key": "feature.courseboard.flag-evaluation-smoke",
                        "enabled": true
                    }]
                }
            }))
        }

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, Router::new().route("/v1/graphql", post(upstream)))
                .await
                .unwrap();
        });
        let evaluator = TachyonFeatureFlagEvaluator::new(&format!("http://{address}"));
        let keys = vec![
            "feature.courseboard.flag-evaluation-smoke".to_string(),
            "feature.courseboard.not-declared".to_string(),
        ];

        let values = evaluator.is_enabled_batch(&keys, &context()).await.unwrap();

        assert!(values["feature.courseboard.flag-evaluation-smoke"]);
        assert!(!values["feature.courseboard.not-declared"]);
        server.abort();
    }
}
