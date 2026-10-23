//! Product-plan delivery for CourseBoard's own surface.
//!
//! A request runs only when three signals agree:
//!
//! 1. IAM grants its action (`course_authz` and the use cases, unchanged).
//! 2. Tachyon Core's canonical `featureDeliveryValues` returns
//!    `enabled && resolved` for the request's feature key. Core composes the
//!    tenant's contract entitlement and any release flag behind that one
//!    decision, so CourseBoard keeps no evaluator of its own.
//! 3. Every feature the catalog lists as required passes (2) as well.
//!
//! Everything that is not a positive decision is refused (fail-closed): a
//! provider failure, an unresolved value, a key missing from the batch, or a
//! protected route no rule maps to a feature.
//!
//! Enforcement is opted into per deployment with [`DELIVERY_ENFORCEMENT_ENV`]:
//! the Core definitions for these keys must exist before routes tenants
//! already use can be closed. `shadow` never changes a request: it reads a
//! sampled share of decisions alongside the handler and only logs them (see
//! [`DeliverySampler`]). The same switch tells the SPA whether to hide screens.
//!
//! [`DELIVERY_ENFORCE_PLATFORMS_ENV`] lists platform tenants whose requests
//! are enforced whatever the deployment mode is. One deployment serves both
//! the production and the sandbox platform, so a sandbox tenant can run with
//! its plan applied while production tenants stay in `shadow`. The platform
//! comes from the request's `x-platform-id`; this is a rollout switch, not a
//! boundary, and a request outside the listed platforms is never decided
//! more strictly than the deployment mode.

pub mod catalog;
pub mod routes;
mod sampling;
#[cfg(test)]
mod tests;

use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use axum::{
    body::Body,
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::ToSchema;

use crate::feature_flags::{
    feature_flag_graphql_url, FeatureFlagEvaluationContext, FeatureFlagProviderError,
    FEATURE_FLAG_REQUEST_TIMEOUT,
};
use crate::{AppError, AppState};
use catalog::FeatureDefinition;
use routes::RequestFeature;
use sampling::{DecisionLog, LoggedDecision};
pub use sampling::{
    DeliverySampler, DECISION_LOG_TARGET, DEFAULT_SHADOW_SAMPLE_RATE, SHADOW_DEDUP_WINDOW,
    SHADOW_SAMPLE_RATE_ENV,
};
use tracing::Instrument;

/// How long a sampled `shadow` response may wait for Core after the handler
/// is done. Lambda freezes work left running after the response, so the read
/// runs alongside the handler instead of in a detached task, and keeps going
/// for as long as the handler does.
pub const SHADOW_EVALUATION_BUDGET: Duration = Duration::from_secs(1);

pub const DELIVERY_ENFORCEMENT_ENV: &str = "COURSEBOARD_FEATURE_DELIVERY_ENFORCEMENT";
/// Comma-separated platform tenant IDs whose requests are always enforced.
pub const DELIVERY_ENFORCE_PLATFORMS_ENV: &str = "COURSEBOARD_FEATURE_DELIVERY_ENFORCE_PLATFORMS";
const MAX_EVALUATE_KEYS: usize = 64;

/// How the guard treats a denial.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryEnforcement {
    /// Do not evaluate. The default until Core knows CourseBoard's keys.
    Off,
    /// Evaluate and log denials, but let the request through.
    Shadow,
    /// Evaluate and answer 403 on every denial.
    Enforce,
}

impl DeliveryEnforcement {
    /// An unrecognised value enforces: a typo must not open the gate.
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            None | Some("") | Some("off") => Self::Off,
            Some("shadow") => Self::Shadow,
            Some("enforce") => Self::Enforce,
            Some(other) => {
                tracing::warn!(
                    value = other,
                    "unknown {DELIVERY_ENFORCEMENT_ENV}; enforcing feature delivery"
                );
                Self::Enforce
            }
        }
    }

    pub fn from_env() -> Self {
        Self::parse(std::env::var(DELIVERY_ENFORCEMENT_ENV).ok().as_deref())
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Shadow => "shadow",
            Self::Enforce => "enforce",
        }
    }
}

/// The platforms named by [`DELIVERY_ENFORCE_PLATFORMS_ENV`]. An entry that
/// is not a tenant ID is dropped with a warning: a typo must not enforce an
/// unintended platform, and it cannot loosen the deployment mode either.
pub fn parse_enforce_platforms(value: Option<&str>) -> HashSet<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter(|entry| {
            let valid = entry.len() == 29
                && entry.starts_with("tn_")
                && entry[3..].chars().all(|ch| ch.is_ascii_alphanumeric());
            if !valid {
                tracing::warn!(
                    value = *entry,
                    "ignoring a non-tenant entry in {DELIVERY_ENFORCE_PLATFORMS_ENV}"
                );
            }
            valid
        })
        .map(ToOwned::to_owned)
        .collect()
}

pub fn enforce_platforms_from_env() -> HashSet<String> {
    parse_enforce_platforms(
        std::env::var(DELIVERY_ENFORCE_PLATFORMS_ENV)
            .ok()
            .as_deref(),
    )
}

/// One canonical decision from Core.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryValue {
    pub enabled: bool,
    pub resolved: bool,
    pub reason: String,
}

/// Read-only port onto Core's `featureDeliveryValues`.
#[async_trait]
pub trait FeatureDeliveryEvaluator: fmt::Debug + Send + Sync {
    async fn delivery_values(
        &self,
        delivery_keys: &[String],
        context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, DeliveryValue>, FeatureFlagProviderError>;
}

#[derive(Debug)]
struct UnavailableFeatureDeliveryEvaluator;

#[async_trait]
impl FeatureDeliveryEvaluator for UnavailableFeatureDeliveryEvaluator {
    async fn delivery_values(
        &self,
        _delivery_keys: &[String],
        _context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, DeliveryValue>, FeatureFlagProviderError> {
        Err(FeatureFlagProviderError)
    }
}

#[derive(Clone)]
pub struct TachyonFeatureDeliveryEvaluator {
    client: Option<reqwest::Client>,
    graphql_url: Option<reqwest::Url>,
}

impl TachyonFeatureDeliveryEvaluator {
    pub fn new(tachyon_api_url: &str) -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(FEATURE_FLAG_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| {
                tracing::warn!(
                    error_kind = "client_build",
                    "Feature delivery HTTP client could not be created: {error}"
                );
            })
            .ok();
        Self {
            client,
            graphql_url: feature_flag_graphql_url(tachyon_api_url),
        }
    }
}

impl fmt::Debug for TachyonFeatureDeliveryEvaluator {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TachyonFeatureDeliveryEvaluator")
            .field(
                "configured",
                &(self.client.is_some() && self.graphql_url.is_some()),
            )
            .finish()
    }
}

#[derive(Serialize)]
struct DeliveryGraphqlRequest<'a> {
    query: &'static str,
    variables: DeliveryGraphqlVariables<'a>,
}

#[derive(Serialize)]
struct DeliveryGraphqlVariables<'a> {
    keys: &'a [String],
}

#[derive(Deserialize)]
struct DeliveryGraphqlResponse {
    data: Option<DeliveryGraphqlData>,
    #[serde(default)]
    errors: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryGraphqlData {
    feature_delivery_values: Vec<DeliveryGraphqlValue>,
}

#[derive(Deserialize)]
struct DeliveryGraphqlValue {
    key: String,
    enabled: bool,
    resolved: bool,
    #[serde(default)]
    reason: String,
}

#[async_trait]
impl FeatureDeliveryEvaluator for TachyonFeatureDeliveryEvaluator {
    async fn delivery_values(
        &self,
        delivery_keys: &[String],
        context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, DeliveryValue>, FeatureFlagProviderError> {
        let (Some(client), Some(graphql_url)) = (&self.client, &self.graphql_url) else {
            return Err(FeatureFlagProviderError);
        };
        let payload = DeliveryGraphqlRequest {
            query: "query CourseBoardFeatureDeliveryValues($keys: [String!]!) { featureDeliveryValues(keys: $keys) { key enabled resolved reason } }",
            variables: DeliveryGraphqlVariables {
                keys: delivery_keys,
            },
        };
        let mut request = client
            .post(graphql_url.clone())
            .header(AUTHORIZATION, context.authorization())
            .header("x-operator-id", context.operator_id())
            .json(&payload);
        if let Some(platform_id) = context.platform_id() {
            request = request.header("x-platform-id", platform_id);
        }
        let response = request.send().await.map_err(|error| {
            tracing::warn!(
                error_kind = if error.is_timeout() {
                    "timeout"
                } else {
                    "network"
                },
                "Feature delivery provider request failed"
            );
            FeatureFlagProviderError
        })?;
        if !response.status().is_success() {
            tracing::warn!(
                upstream_status = response.status().as_u16(),
                "Feature delivery provider returned a non-success status"
            );
            return Err(FeatureFlagProviderError);
        }
        let payload = response
            .json::<DeliveryGraphqlResponse>()
            .await
            .map_err(|_| FeatureFlagProviderError)?;
        if !payload.errors.is_empty() {
            tracing::warn!(
                graphql_error_count = payload.errors.len(),
                "Feature delivery provider returned GraphQL errors"
            );
            return Err(FeatureFlagProviderError);
        }
        let data = payload.data.ok_or(FeatureFlagProviderError)?;
        Ok(data
            .feature_delivery_values
            .into_iter()
            .map(|value| {
                (
                    value.key,
                    DeliveryValue {
                        enabled: value.enabled,
                        resolved: value.resolved,
                        reason: value.reason,
                    },
                )
            })
            .collect())
    }
}

/// Why a request was denied. Every variant is a 403.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryDenial {
    /// Core resolved the feature, or one it requires, as not provided.
    NotProvided,
    /// Core could not resolve the feature for this tenant.
    Unresolved,
    /// The decision could not be read, or the batch was incomplete.
    Unavailable,
    /// A protected route no rule maps to a feature.
    UnclassifiedRoute,
    /// The tenant header and the tenant the request acts on disagree.
    ScopeMismatch,
    /// The request reaches past what the feature covers (an invoice that is
    /// not a cancellation fee).
    ScopeExceeded,
}

impl DeliveryDenial {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotProvided => "FEATURE_NOT_PROVIDED",
            Self::Unresolved => "FEATURE_DELIVERY_UNRESOLVED",
            Self::Unavailable => "FEATURE_DELIVERY_UNAVAILABLE",
            Self::UnclassifiedRoute => "FEATURE_ROUTE_UNCLASSIFIED",
            Self::ScopeMismatch => "FEATURE_DELIVERY_SCOPE_MISMATCH",
            Self::ScopeExceeded => "FEATURE_SCOPE_EXCEEDED",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::NotProvided => "This feature is not provided to the tenant",
            Self::Unresolved => "Feature delivery could not be resolved for the tenant",
            Self::Unavailable => "Feature delivery could not be verified",
            Self::UnclassifiedRoute => "This route is not mapped to a CourseBoard feature",
            Self::ScopeMismatch => "x-operator-id does not match the tenant this request acts on",
            Self::ScopeExceeded => "This request reaches past what the feature covers",
        }
    }
}

impl IntoResponse for DeliveryDenial {
    fn into_response(self) -> Response {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "forbidden", "code": self.code(), "message": self.message() })),
        )
            .into_response()
    }
}

/// The feature followed by everything it requires, transitively, as catalog
/// keys in a stable order without repeats.
pub(crate) fn required_closure(feature: &FeatureDefinition) -> Vec<&'static str> {
    let mut keys = vec![feature.key];
    let mut index = 0;
    while index < keys.len() {
        if let Some(definition) = catalog::feature(keys[index]) {
            for required in definition.required_feature_keys {
                if !keys.contains(required) {
                    keys.push(required);
                }
            }
        }
        index += 1;
    }
    keys
}

#[derive(Debug, Clone)]
pub struct FeatureDeliveryGuard {
    evaluator: Arc<dyn FeatureDeliveryEvaluator>,
    enforcement: DeliveryEnforcement,
    enforce_platforms: Arc<HashSet<String>>,
    sampler: Arc<DeliverySampler>,
    shadow_budget: Duration,
}

impl FeatureDeliveryGuard {
    /// Samples `shadow` at [`SHADOW_SAMPLE_RATE_ENV`].
    pub fn new(
        evaluator: Arc<dyn FeatureDeliveryEvaluator>,
        enforcement: DeliveryEnforcement,
    ) -> Self {
        Self {
            evaluator,
            enforcement,
            enforce_platforms: Arc::new(HashSet::new()),
            sampler: Arc::new(DeliverySampler::from_env()),
            shadow_budget: SHADOW_EVALUATION_BUDGET,
        }
    }

    /// Enforce every request from these platforms (see the module docs).
    pub fn with_enforce_platforms(mut self, platforms: HashSet<String>) -> Self {
        self.enforce_platforms = Arc::new(platforms);
        self
    }

    pub fn with_sampler(mut self, sampler: DeliverySampler) -> Self {
        self.sampler = Arc::new(sampler);
        self
    }

    #[cfg(test)]
    fn with_shadow_budget(mut self, budget: Duration) -> Self {
        self.shadow_budget = budget;
        self
    }

    /// [`Self::evaluate`] for a sampled `shadow` read: logged, never acted on.
    async fn shadow_evaluate(
        &self,
        features: &[&'static FeatureDefinition],
        context: &FeatureFlagEvaluationContext,
    ) -> LoggedDecision {
        self.evaluate(features, context)
            .await
            .into_iter()
            .find_map(Result::err)
            .map_or(LoggedDecision::Allow, LoggedDecision::Deny)
    }

    /// No evaluation at all: what every deployment runs until it opts in.
    pub fn off() -> Self {
        Self::new(
            Arc::new(UnavailableFeatureDeliveryEvaluator),
            DeliveryEnforcement::Off,
        )
    }

    /// The deployment-wide mode, before any platform override.
    pub fn enforcement(&self) -> DeliveryEnforcement {
        self.enforcement
    }

    /// The mode for one request: `enforce` for a listed platform, otherwise
    /// the deployment mode.
    pub fn enforcement_for(&self, headers: &HeaderMap) -> DeliveryEnforcement {
        let platform = headers
            .get("x-platform-id")
            .and_then(|value| value.to_str().ok())
            .map(str::trim);
        match platform {
            Some(platform) if self.enforce_platforms.contains(platform) => {
                DeliveryEnforcement::Enforce
            }
            _ => self.enforcement,
        }
    }

    /// Decide several features from one Core batch, in the order given.
    pub async fn evaluate(
        &self,
        features: &[&'static FeatureDefinition],
        context: &FeatureFlagEvaluationContext,
    ) -> Vec<Result<(), DeliveryDenial>> {
        let mut delivery_keys = Vec::new();
        for key in features
            .iter()
            .flat_map(|feature| required_closure(feature))
        {
            let delivery_key = catalog::delivery_key_for(key);
            if !delivery_keys.contains(&delivery_key) {
                delivery_keys.push(delivery_key);
            }
        }
        let Ok(values) = self
            .evaluator
            .delivery_values(&delivery_keys, context)
            .await
        else {
            return vec![Err(DeliveryDenial::Unavailable); features.len()];
        };
        features
            .iter()
            .map(|feature| {
                for key in required_closure(feature) {
                    let Some(value) = values.get(&catalog::delivery_key_for(key)) else {
                        return Err(DeliveryDenial::Unavailable);
                    };
                    if !value.resolved {
                        return Err(DeliveryDenial::Unresolved);
                    }
                    if !value.enabled {
                        return Err(DeliveryDenial::NotProvided);
                    }
                }
                Ok(())
            })
            .collect()
    }
}

impl FeatureDeliveryGuard {
    /// Which of these export sources the tenant's plan provides, in order.
    /// Everything is kept unless enforcing, so `off` and `shadow` change
    /// nothing; an unreadable decision keeps nothing.
    pub async fn provided_export_sources(
        &self,
        source_keys: &[&str],
        headers: &HeaderMap,
    ) -> Vec<bool> {
        if self.enforcement_for(headers) != DeliveryEnforcement::Enforce {
            return vec![true; source_keys.len()];
        }
        let Ok(context) = FeatureFlagEvaluationContext::from_headers(headers) else {
            return vec![false; source_keys.len()];
        };
        let data_exports = catalog::feature("courseboard.data_exports").expect("catalog feature");
        let sources: Vec<Option<&'static FeatureDefinition>> = source_keys
            .iter()
            .map(|key| routes::export_source_feature(key))
            .collect();
        let mut features = vec![data_exports];
        for feature in sources.iter().flatten() {
            if !features.iter().any(|seen| seen.key == feature.key) {
                features.push(feature);
            }
        }
        let decisions: HashMap<&str, bool> = features
            .iter()
            .map(|feature| feature.key)
            .zip(
                self.evaluate(&features, &context)
                    .await
                    .into_iter()
                    .map(|d| d.is_ok()),
            )
            .collect();
        sources
            .iter()
            .map(|source| match source {
                Some(feature) => decisions[data_exports.key] && decisions[feature.key],
                None => false,
            })
            .collect()
    }
}

impl FeatureDeliveryGuard {
    /// Whether each common-import target may be used: `courseboard.data_imports`
    /// and the target's own feature, decided from one Core batch however many
    /// targets (or listed jobs) ask. Only `enforce` refuses; `shadow` allows
    /// everything and reads a sampled share, bounded by the shadow budget,
    /// only to log it; `off` asks nothing.
    pub async fn import_target_decisions(
        &self,
        targets: &[&str],
        headers: &HeaderMap,
    ) -> HashMap<String, bool> {
        let mut unique: Vec<&str> = Vec::new();
        for target in targets {
            if !unique.contains(target) {
                unique.push(target);
            }
        }
        let allow_all = |unique: Vec<&str>| {
            unique
                .into_iter()
                .map(|target| (target.to_string(), true))
                .collect()
        };
        let enforcement = self.enforcement_for(headers);
        if enforcement == DeliveryEnforcement::Off || unique.is_empty() {
            return allow_all(unique);
        }
        let data_imports = catalog::feature("courseboard.data_imports").expect("catalog feature");
        let context = FeatureFlagEvaluationContext::from_headers(headers).ok();
        let header_tenant = operator_header(headers);
        let tenant_id = context
            .as_ref()
            .map(FeatureFlagEvaluationContext::operator_id)
            .or(header_tenant.as_deref());
        let shadow = enforcement == DeliveryEnforcement::Shadow;
        if shadow
            && !self
                .sampler
                .admit_shadow(tenant_id.unwrap_or("-"), data_imports.key)
        {
            return allow_all(unique);
        }
        let features: Vec<Option<&'static FeatureDefinition>> = unique
            .iter()
            .map(|target| routes::import_target_feature(target))
            .collect();
        let decide = async {
            match &context {
                None => vec![Err(DeliveryDenial::Unavailable); unique.len()],
                Some(context) => {
                    let mut batch = vec![data_imports];
                    for feature in features.iter().flatten() {
                        if !batch.iter().any(|seen| seen.key == feature.key) {
                            batch.push(feature);
                        }
                    }
                    let results: HashMap<&str, Result<(), DeliveryDenial>> = batch
                        .iter()
                        .map(|feature| feature.key)
                        .zip(self.evaluate(&batch, context).await)
                        .collect();
                    features
                        .iter()
                        .map(|feature| match feature {
                            None => Err(DeliveryDenial::UnclassifiedRoute),
                            Some(feature) => results[data_imports.key].and(results[feature.key]),
                        })
                        .collect()
                }
            }
        };
        let decisions: Option<Vec<Result<(), DeliveryDenial>>> = if shadow {
            tokio::time::timeout(self.shadow_budget, decide)
                .instrument(tracing::Span::current())
                .await
                .ok()
        } else {
            Some(decide.await)
        };
        unique
            .into_iter()
            .zip(features)
            .enumerate()
            .map(|(index, (target, feature))| {
                let decision = decisions.as_ref().map(|decisions| decisions[index]);
                let log = DecisionLog {
                    enforcement,
                    tenant_id,
                    feature: feature.map_or("-", |feature| feature.key),
                    method: "IMPORT",
                    path: target,
                };
                match decision {
                    None => log.emit(LoggedDecision::TimedOut),
                    Some(Err(denial)) => log.emit(LoggedDecision::Deny(denial)),
                    Some(Ok(())) if shadow || self.sampler.roll() => {
                        log.emit(LoggedDecision::Allow)
                    }
                    Some(Ok(())) => {}
                }
                let allowed = shadow || decision.is_some_and(|decision| decision.is_ok());
                (target.to_string(), allowed)
            })
            .collect()
    }

    /// [`Self::import_target_decisions`] for one target, as an error.
    pub async fn ensure_import_target(
        &self,
        target: &str,
        headers: &HeaderMap,
    ) -> Result<(), AppError> {
        let decisions = self.import_target_decisions(&[target], headers).await;
        if decisions.get(target).copied().unwrap_or(false) {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }
}

fn evaluation_context(
    req: &Request<Body>,
    tenant_override: Option<String>,
) -> Option<FeatureFlagEvaluationContext> {
    let bearer = crate::course_authz::bearer_from(req)?;
    let header = |name: &str| {
        req.headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    Some(FeatureFlagEvaluationContext::new(
        format!("Bearer {bearer}"),
        tenant_override.or_else(|| header("x-operator-id"))?,
        header("x-platform-id"),
    ))
}

const LEGACY_ADMIN_PREFIX: &str = "/admin/";
const LEGACY_ADMIN_FORM_LIMIT: usize = 64 * 1024;

fn tenant_field(pairs: Vec<(String, String)>) -> Option<String> {
    pairs
        .into_iter()
        .find(|(name, _)| name == "tenant_id")
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Which tenant a legacy admin request acts on.
enum AdminScope {
    /// Not a legacy admin route: `x-operator-id` is the scope.
    NotAdmin,
    /// The tenant the handler will act on.
    Tenant(String),
    /// No tenant anywhere, or a form too large to read without taking it
    /// away from the handler. Refused under enforcement.
    Unknown,
    /// `x-operator-id` names one tenant and the payload another.
    Mismatch,
    /// The body could not be read back; nothing is left to forward.
    BodyLost,
}

/// The legacy server-rendered admin names its tenant in a `tenant_id` query
/// or form field, and the handler acts on that tenant. So that is the tenant
/// Core is asked about, always; a different `x-operator-id` is refused rather
/// than letting one tenant's plan cover another. Core evaluates under the
/// caller's own bearer, so naming a tenant one does not belong to does not
/// make a feature provided.
///
/// A form is buffered only when its declared length fits the limit, and is
/// put back for the handler; a larger or unsized one is left untouched.
/// Only `enforce` reads it: `shadow` uses [`admin_scope`] without the body.
async fn legacy_admin_scope(req: Request<Body>) -> (Request<Body>, AdminScope) {
    if !req.uri().path().starts_with(LEGACY_ADMIN_PREFIX) {
        return (req, AdminScope::NotAdmin);
    }
    let is_form = req
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/x-www-form-urlencoded"));
    if !is_form {
        let scope = admin_scope(&req, None);
        return (req, scope);
    }
    let declared_length = req
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok());
    if !declared_length.is_some_and(|length| length <= LEGACY_ADMIN_FORM_LIMIT) {
        // The body may name a tenant of its own, unread: the scope is unknown
        // even when the query names one.
        return (req, AdminScope::Unknown);
    }
    let (parts, body) = req.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, LEGACY_ADMIN_FORM_LIMIT).await else {
        return (
            Request::from_parts(parts, Body::empty()),
            AdminScope::BodyLost,
        );
    };
    let form_tenant = serde_urlencoded::from_bytes(&bytes)
        .ok()
        .and_then(tenant_field);
    let req = Request::from_parts(parts, Body::from(bytes));
    let scope = admin_scope(&req, form_tenant);
    (req, scope)
}

/// The tenant a legacy admin request names in `x-operator-id`, its query, and
/// `body_tenant` (a form field read by the caller), which must all agree.
fn admin_scope(req: &Request<Body>, body_tenant: Option<String>) -> AdminScope {
    if !req.uri().path().starts_with(LEGACY_ADMIN_PREFIX) {
        return AdminScope::NotAdmin;
    }
    let header = operator_header(req.headers());
    let query_tenant = req
        .uri()
        .query()
        .and_then(|query| serde_urlencoded::from_str(query).ok())
        .and_then(tenant_field);
    let mut tenants = [query_tenant, body_tenant, header].into_iter().flatten();
    let Some(first) = tenants.next() else {
        return AdminScope::Unknown;
    };
    if tenants.any(|other| other != first) {
        AdminScope::Mismatch
    } else {
        AdminScope::Tenant(first)
    }
}

const CANCELLATION_INVOICES_PATH: &str = "/field-api/v1/invoices";
const CANCELLATION_FEE_REASON: &str = "cancellation_fee";
const INVOICE_BODY_LIMIT: usize = 256 * 1024;

/// Whether a request on the generic invoice API stays inside the
/// cancellation-fee workflow. `None` for any other path.
enum InvoiceScope {
    Within,
    Exceeded,
    /// A body too large (or unsized) to read without taking it away.
    Unknown,
    BodyLost,
}

fn every_reason_is_cancellation_fee<'a>(reasons: impl Iterator<Item = Option<&'a str>>) -> bool {
    let mut any = false;
    for reason in reasons {
        if reason != Some(CANCELLATION_FEE_REASON) {
            return false;
        }
        any = true;
    }
    any
}

async fn cancellation_invoice_scope(req: Request<Body>) -> (Request<Body>, Option<InvoiceScope>) {
    if req.uri().path() != CANCELLATION_INVOICES_PATH {
        return (req, None);
    }
    if *req.method() == axum::http::Method::GET || *req.method() == axum::http::Method::HEAD {
        let pairs: Vec<(String, String)> = req
            .uri()
            .query()
            .and_then(|query| serde_urlencoded::from_str(query).ok())
            .unwrap_or_default();
        let within = every_reason_is_cancellation_fee(
            pairs
                .iter()
                .filter(|(name, _)| name == "reason")
                .map(|(_, value)| Some(value.as_str())),
        );
        let scope = if within {
            InvoiceScope::Within
        } else {
            InvoiceScope::Exceeded
        };
        return (req, Some(scope));
    }
    let declared_length = req
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok());
    if !declared_length.is_some_and(|length| length <= INVOICE_BODY_LIMIT) {
        return (req, Some(InvoiceScope::Unknown));
    }
    let (parts, body) = req.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, INVOICE_BODY_LIMIT).await else {
        return (
            Request::from_parts(parts, Body::empty()),
            Some(InvoiceScope::BodyLost),
        );
    };
    let within = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|body| {
            body.get("sources")
                .and_then(|sources| sources.as_array())
                .cloned()
        })
        .is_some_and(|sources| {
            every_reason_is_cancellation_fee(
                sources
                    .iter()
                    .map(|source| source.get("reason").and_then(|r| r.as_str())),
            )
        });
    let scope = if within {
        InvoiceScope::Within
    } else {
        InvoiceScope::Exceeded
    };
    (Request::from_parts(parts, Body::from(bytes)), Some(scope))
}

/// Runs inside the action gate, right before the handler, so a request it
/// sees has already passed IAM.
pub async fn require_feature_delivery(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let guard = state.feature_delivery();
    let enforcement = guard.enforcement_for(req.headers());
    if enforcement == DeliveryEnforcement::Off {
        return next.run(req).await;
    }
    let feature = match routes::classify_request(req.method(), req.uri().path()) {
        RequestFeature::Exempt(_) => return next.run(req).await,
        RequestFeature::Unclassified => None,
        RequestFeature::Required(feature) => Some(feature),
    };
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let mut log = DecisionLog {
        enforcement,
        tenant_id: None,
        feature: feature.map_or("-", |feature| feature.key),
        method: &method,
        path: &path,
    };
    let header_tenant = operator_header(req.headers());
    log.tenant_id = header_tenant.as_deref();
    if enforcement == DeliveryEnforcement::Shadow {
        return shadow_feature_delivery(&state, &guard, feature, req, next, log).await;
    }

    let Some(feature) = feature else {
        log.emit(LoggedDecision::Deny(DeliveryDenial::UnclassifiedRoute));
        return DeliveryDenial::UnclassifiedRoute.into_response();
    };
    // Verified here rather than trusted from an outer layer: the action
    // gate can be switched off (`COURSEBOARD_DISABLE_ACTION_AUTHZ`), and
    // an unverified bearer must never buy an outbound request to Core.
    if !bearer_is_verified(&state, &req) {
        return AppError::Unauthorized.into_response();
    }
    let (rebuilt, admin_scope) = legacy_admin_scope(req).await;
    req = rebuilt;
    let tenant_override = match admin_scope {
        AdminScope::NotAdmin => None,
        AdminScope::Tenant(tenant) => Some(Ok(tenant)),
        AdminScope::Unknown => Some(Err(DeliveryDenial::Unavailable)),
        AdminScope::Mismatch => Some(Err(DeliveryDenial::ScopeMismatch)),
        AdminScope::BodyLost => {
            return AppError::BadRequest("request body could not be read").into_response()
        }
    };
    let (rebuilt, invoice_scope) = cancellation_invoice_scope(req).await;
    req = rebuilt;
    let scope_denial = match invoice_scope {
        None | Some(InvoiceScope::Within) => None,
        Some(InvoiceScope::Exceeded) => Some(DeliveryDenial::ScopeExceeded),
        Some(InvoiceScope::Unknown) => Some(DeliveryDenial::Unavailable),
        Some(InvoiceScope::BodyLost) => {
            return AppError::BadRequest("request body could not be read").into_response()
        }
    };
    let context = match tenant_override {
        None => evaluation_context(&req, None).ok_or(DeliveryDenial::Unavailable),
        Some(Ok(tenant)) => {
            evaluation_context(&req, Some(tenant)).ok_or(DeliveryDenial::Unavailable)
        }
        Some(Err(denial)) => Err(denial),
    };
    let scoped_tenant = context
        .as_ref()
        .ok()
        .map(|context| context.operator_id().to_string());
    if scoped_tenant.is_some() {
        log.tenant_id = scoped_tenant.as_deref();
    }
    let decision = match (
        scope_denial,
        routes::additional_features(req.method(), req.uri().path()),
        context,
    ) {
        (Some(denial), _, _) => Err(denial),
        (None, None, _) => Err(DeliveryDenial::UnclassifiedRoute),
        (None, Some(_), Err(denial)) => Err(denial),
        (None, Some(additional), Ok(context)) => {
            let mut features = vec![feature];
            features.extend(additional);
            guard
                .evaluate(&features, &context)
                .await
                .into_iter()
                .find(Result::is_err)
                .unwrap_or(Ok(()))
        }
    };
    match decision {
        Ok(()) => {
            if guard.sampler.roll() {
                log.emit(LoggedDecision::Allow);
            }
            next.run(req).await
        }
        Err(denial) => {
            log.emit(LoggedDecision::Deny(denial));
            denial.into_response()
        }
    }
}

/// `shadow` hands the handler the request exactly as `off` would: no body is
/// read, so a tenant named only in a legacy admin form, and the invoice scope
/// of a cancellation-fee invoice, are not checked here. A sampled request is
/// read from Core alongside the handler and only logged.
async fn shadow_feature_delivery(
    state: &AppState,
    guard: &FeatureDeliveryGuard,
    feature: Option<&'static FeatureDefinition>,
    req: Request<Body>,
    next: Next,
    mut log: DecisionLog<'_>,
) -> Response {
    let Some(feature) = feature else {
        if guard.sampler.roll() {
            log.emit(LoggedDecision::Deny(DeliveryDenial::UnclassifiedRoute));
        }
        return next.run(req).await;
    };
    if !bearer_is_verified(state, &req) {
        return next.run(req).await;
    }
    let (tenant_override, scope_denial) = match admin_scope(&req, None) {
        AdminScope::NotAdmin | AdminScope::BodyLost => (None, None),
        AdminScope::Tenant(tenant) => (Some(tenant), None),
        AdminScope::Unknown => (None, Some(DeliveryDenial::Unavailable)),
        AdminScope::Mismatch => (None, Some(DeliveryDenial::ScopeMismatch)),
    };
    let context = evaluation_context(&req, tenant_override);
    if let Some(context) = &context {
        log.tenant_id = Some(context.operator_id());
    }
    if !guard
        .sampler
        .admit_shadow(log.tenant_id.unwrap_or("-"), feature.key)
    {
        return next.run(req).await;
    }
    let additional = routes::additional_features(req.method(), req.uri().path());
    let read = async {
        if let Some(denial) = scope_denial {
            return LoggedDecision::Deny(denial);
        }
        let Some(additional) = additional else {
            return LoggedDecision::Deny(DeliveryDenial::UnclassifiedRoute);
        };
        let Some(context) = &context else {
            return LoggedDecision::Deny(DeliveryDenial::Unavailable);
        };
        let mut features = vec![feature];
        features.extend(additional);
        guard.shadow_evaluate(&features, context).await
    };
    // The read runs while the handler does; once the response is ready it
    // waits for the read only up to the budget.
    let read = read.instrument(tracing::Span::current());
    tokio::pin!(read);
    let handler = next.run(req);
    tokio::pin!(handler);
    let mut decision = None;
    let response = loop {
        tokio::select! {
            response = &mut handler => break response,
            outcome = &mut read, if decision.is_none() => decision = Some(outcome),
        }
    };
    let decision = match decision {
        Some(outcome) => outcome,
        None => tokio::time::timeout(guard.shadow_budget, read)
            .await
            .unwrap_or(LoggedDecision::TimedOut),
    };
    log.emit(decision);
    response
}

fn bearer_is_verified(state: &AppState, req: &Request<Body>) -> bool {
    crate::course_authz::bearer_from(req)
        .is_some_and(|bearer| state.token_verifier_for_authz().verify(bearer).is_ok())
}

fn operator_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-operator-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct EvaluateFeatureDeliveriesRequest {
    /// Catalog keys, e.g. `courseboard.tee_sheet`.
    keys: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, ToSchema)]
pub struct EvaluateFeatureDeliveriesResponse {
    /// `off` and `shadow` mean nothing was evaluated and nothing is gated.
    enforcement: DeliveryEnforcement,
    values: Vec<FeatureDeliveryResult>,
}

#[derive(Debug, Serialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDeliveryResult {
    key: String,
    /// The feature and everything it requires are provided.
    enabled: bool,
    /// False when the decision could not be read; ask again later.
    resolved: bool,
    reason: &'static str,
}

fn validate_evaluate_keys(keys: &[String]) -> Result<Vec<&'static FeatureDefinition>, AppError> {
    if keys.is_empty() {
        return Err(AppError::BadRequest("at least one feature key is required"));
    }
    if keys.len() > MAX_EVALUATE_KEYS {
        return Err(AppError::BadRequest("too many feature keys"));
    }
    let mut features: Vec<&'static FeatureDefinition> = Vec::with_capacity(keys.len());
    for key in keys {
        let feature = catalog::feature(key).ok_or(AppError::BadRequest(
            "only CourseBoard catalog keys can be evaluated",
        ))?;
        if features.iter().any(|seen| seen.key == feature.key) {
            return Err(AppError::BadRequest(
                "duplicate feature keys are not allowed",
            ));
        }
        features.push(feature);
    }
    Ok(features)
}

/// Evaluate CourseBoard product features for the authenticated tenant.
#[utoipa::path(
    post,
    path = "/v1/course/feature-deliveries/evaluate",
    request_body = EvaluateFeatureDeliveriesRequest,
    responses(
        (status = 200, description = "Tenant-scoped feature delivery, requirements included", body = EvaluateFeatureDeliveriesResponse),
        (status = 400, description = "Tenant scope or catalog keys are invalid", body = crate::course::interfaces::openapi::ErrorBody),
        (status = 401, description = "Authenticated user bearer is required", body = crate::course::interfaces::openapi::ErrorBody)
    ),
    security(("bearer_auth" = [])),
    tag = "feature-flags"
)]
pub async fn evaluate_feature_deliveries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<EvaluateFeatureDeliveriesRequest>,
) -> Result<Json<EvaluateFeatureDeliveriesResponse>, AppError> {
    let context = FeatureFlagEvaluationContext::from_headers(&headers)?;
    let features = validate_evaluate_keys(&input.keys)?;
    let guard = state.feature_delivery();
    // The SPA hides nothing until `enforce`, so `shadow` does not spend a
    // Core read (and a Field lease) on every screen load.
    let enforcement = guard.enforcement_for(&headers);
    if enforcement != DeliveryEnforcement::Enforce {
        return Ok(Json(EvaluateFeatureDeliveriesResponse {
            enforcement,
            values: Vec::new(),
        }));
    }
    let decisions = guard.evaluate(&features, &context).await;
    let values = features
        .iter()
        .zip(decisions)
        .map(|(feature, decision)| {
            let (enabled, resolved, reason) = match decision {
                Ok(()) => (true, true, "provided"),
                Err(DeliveryDenial::NotProvided) => (false, true, "not_provided"),
                Err(DeliveryDenial::Unresolved) => (false, false, "unresolved"),
                Err(
                    DeliveryDenial::Unavailable
                    | DeliveryDenial::UnclassifiedRoute
                    | DeliveryDenial::ScopeMismatch
                    | DeliveryDenial::ScopeExceeded,
                ) => (false, false, "unavailable"),
            };
            FeatureDeliveryResult {
                key: feature.key.to_string(),
                enabled,
                resolved,
                reason,
            }
        })
        .collect();
    Ok(Json(EvaluateFeatureDeliveriesResponse {
        enforcement,
        values,
    }))
}
