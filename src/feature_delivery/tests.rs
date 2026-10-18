use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::{
    body::{to_bytes, Body},
    http::{header::AUTHORIZATION, Method, Request, StatusCode},
    middleware,
    routing::{any, post},
    Router,
};
use tower::ServiceExt;

use super::catalog::{self, FEATURES};
use super::routes::{self, Exemption, FeatureRoute, RequestFeature, FIELD_PROXY_RULES};
use super::*;
use crate::auth::StaticBearerVerifier;
use crate::course::domain::actions;
use crate::course_authz;

const MANIFEST_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/.tachyon/manifests/courseboard-product-features.yml"
);
const TOKEN: &str = "delivery-test-token";
const TENANT: &str = "tn_01hjryxysgey07h5jz5wagqj0m";

// ─── Catalog and route coverage: the CI check for keyless features ────────

/// A concrete path that a `course_authz` pattern matches.
fn sample_path(pattern: &str) -> String {
    pattern
        .split('/')
        .map(|segment| {
            if segment.starts_with(':') || segment.starts_with('*') {
                "sample"
            } else {
                segment
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[test]
fn every_classified_route_has_a_feature_or_an_exemption() {
    let unmapped: Vec<String> = course_authz::route_patterns()
        .filter(|(method, pattern)| routes::feature_for_pattern(method, pattern).is_none())
        .map(|(method, pattern)| format!("{method} {pattern}"))
        .collect();
    assert!(
        unmapped.is_empty(),
        "give these routes a feature key (or an exemption) in src/feature_delivery/routes.rs: {unmapped:?}"
    );
}

#[test]
fn every_rule_names_a_catalog_feature() {
    let route_keys = course_authz::route_patterns()
        .filter_map(|(method, pattern)| routes::feature_for_pattern(method, pattern));
    let proxy_keys = FIELD_PROXY_RULES.iter().map(|(_, route)| *route);
    let unknown: Vec<&str> = route_keys
        .chain(proxy_keys)
        .filter_map(|route| match route {
            FeatureRoute::Feature(key) if catalog::feature(key).is_none() => Some(key),
            _ => None,
        })
        .collect();
    assert!(unknown.is_empty(), "not in the catalog: {unknown:?}");
}

#[test]
fn every_classified_route_resolves_at_request_time() {
    for (method, pattern) in course_authz::route_patterns() {
        if pattern.starts_with("/field-api") {
            continue;
        }
        let method = if method == "*" { "GET" } else { method };
        let method = Method::from_bytes(method.as_bytes()).unwrap();
        let path = sample_path(pattern);
        assert_ne!(
            routes::classify_request(&method, &path),
            RequestFeature::Unclassified,
            "{method} {path} resolves to no feature"
        );
    }
}

#[test]
fn field_proxy_paths_the_spa_calls_resolve_to_features() {
    let cases = [
        (
            "/field-api/v1/cancellation-fees",
            "courseboard.cancellation_fee",
        ),
        (
            "/field-api/v1/cancellation-fees/inv_1/send",
            "courseboard.cancellation_fee",
        ),
        (
            "/field-api/v1/invoices",
            "courseboard.customers.cancellations",
        ),
        (
            "/field-api/v1/erp/reservations/rsv_1/billing-invoice",
            "courseboard.settlement",
        ),
        (
            "/field-api/v1/erp/staff/stf_1/clock-in",
            "courseboard.caddies",
        ),
        (
            "/field-api/v1/bridge/exports/definitions",
            "courseboard.data_exports",
        ),
    ];
    for (path, key) in cases {
        match routes::classify_request(&Method::POST, path) {
            RequestFeature::Required(feature) => assert_eq!(feature.key, key, "{path}"),
            other => panic!("{path} resolved to {other:?}"),
        }
    }
    assert_eq!(
        routes::classify_request(&Method::GET, "/field-api/v1/field/iam/users"),
        RequestFeature::Exempt(Exemption::Settings)
    );
    assert_eq!(
        routes::classify_request(&Method::GET, "/field-api/v1/erp/journals"),
        RequestFeature::Unclassified
    );
}

#[test]
fn public_and_platform_paths_need_no_feature() {
    for (method, path) in [
        (Method::GET, "/healthz"),
        (Method::GET, "/ui/index.html"),
        (Method::GET, "/public/cancellation-fees/token123"),
        (Method::POST, "/public/cancellation-fees/token123/confirm"),
        (Method::GET, "/v1/me"),
        (Method::POST, "/v1/course/feature-deliveries/evaluate"),
        (Method::OPTIONS, "/v1/course/tee-sheet"),
    ] {
        assert!(
            matches!(
                routes::classify_request(&method, path),
                RequestFeature::Exempt(_)
            ),
            "{method} {path}"
        );
    }
}

#[test]
fn catalog_keys_are_unique_namespaced_and_reachable() {
    let mut seen = HashSet::new();
    for feature in FEATURES {
        assert!(seen.insert(feature.key), "duplicate key {}", feature.key);
        assert!(
            feature.key.starts_with("courseboard.")
                && feature
                    .key
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_'),
            "{} must be courseboard.<snake_case>",
            feature.key
        );
        assert!(
            !routes::api_refs(feature.key).is_empty() || !feature.ui_routes.is_empty(),
            "{} has neither a route nor a screen",
            feature.key
        );
        assert!(
            !feature.read_actions.is_empty(),
            "{} has no read action",
            feature.key
        );
    }
}

#[test]
fn required_features_exist_and_never_cycle() {
    for feature in FEATURES {
        for required in feature.required_feature_keys {
            assert!(
                catalog::feature(required).is_some(),
                "{} requires unknown {required}",
                feature.key
            );
        }
        // Depth-first from each requirement must never come back.
        let mut stack: Vec<&str> = feature.required_feature_keys.to_vec();
        let mut visited = HashSet::new();
        while let Some(key) = stack.pop() {
            assert_ne!(key, feature.key, "{} requires itself", feature.key);
            if visited.insert(key) {
                stack.extend(catalog::feature(key).unwrap().required_feature_keys);
            }
        }
    }
}

#[test]
fn feature_actions_are_ones_this_code_or_field_declares() {
    for feature in FEATURES {
        for action in feature.read_actions.iter().chain(feature.manage_actions) {
            assert!(
                actions::ALL.contains(action) || action.starts_with("field:"),
                "{} names undeclared action {action}",
                feature.key
            );
        }
    }
}

#[test]
fn release_gates_are_courseboard_flags() {
    for feature in FEATURES {
        for gate in feature.release_gates {
            assert!(
                gate.starts_with("feature.courseboard."),
                "{} gate {gate}",
                feature.key
            );
        }
    }
}

/// The manifest is what `tachyon` applies; the catalog is what the guard
/// runs. A difference means one of them is lying.
#[test]
fn the_product_features_manifest_is_rendered_from_the_catalog() {
    let rendered = catalog::render_manifest(routes::api_refs);
    if std::env::var_os("COURSEBOARD_UPDATE_FEATURE_MANIFEST").is_some() {
        std::fs::write(MANIFEST_PATH, &rendered).expect("write manifest");
    }
    let on_disk = std::fs::read_to_string(MANIFEST_PATH).unwrap_or_default();
    assert!(
        on_disk == rendered,
        ".tachyon/manifests/courseboard-product-features.yml is stale; \
         run COURSEBOARD_UPDATE_FEATURE_MANIFEST=1 cargo test feature_delivery"
    );
}

// ─── Guard decisions ──────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct ScriptedEvaluator {
    values: HashMap<String, DeliveryValue>,
    fail: bool,
    calls: AtomicUsize,
    asked: Mutex<Vec<String>>,
}

impl ScriptedEvaluator {
    fn with(entries: &[(&str, bool, bool)]) -> Self {
        Self {
            values: entries
                .iter()
                .map(|(key, enabled, resolved)| {
                    (
                        catalog::delivery_key_for(key),
                        DeliveryValue {
                            enabled: *enabled,
                            resolved: *resolved,
                            reason: String::new(),
                        },
                    )
                })
                .collect(),
            ..Self::default()
        }
    }

    fn failing() -> Self {
        Self {
            fail: true,
            ..Self::default()
        }
    }
}

#[async_trait]
impl FeatureDeliveryEvaluator for ScriptedEvaluator {
    async fn delivery_values(
        &self,
        delivery_keys: &[String],
        _context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, DeliveryValue>, FeatureFlagProviderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.asked
            .lock()
            .unwrap()
            .extend(delivery_keys.iter().cloned());
        if self.fail {
            return Err(FeatureFlagProviderError);
        }
        Ok(self.values.clone())
    }
}

fn context() -> FeatureFlagEvaluationContext {
    FeatureFlagEvaluationContext::new(format!("Bearer {TOKEN}"), TENANT.to_string(), None)
}

async fn decide(evaluator: ScriptedEvaluator, key: &str) -> Result<(), DeliveryDenial> {
    let guard = FeatureDeliveryGuard::new(Arc::new(evaluator), DeliveryEnforcement::Enforce);
    guard
        .evaluate(&[catalog::feature(key).unwrap()], &context())
        .await
        .remove(0)
}

#[tokio::test]
async fn a_feature_is_provided_only_with_everything_it_requires() {
    let key = "courseboard.caddies.payroll";
    let all = [
        ("courseboard.caddies.payroll", true, true),
        ("courseboard.caddies.rank_fees", true, true),
        ("courseboard.caddies", true, true),
        ("courseboard.courses", true, true),
    ];
    assert_eq!(decide(ScriptedEvaluator::with(&all), key).await, Ok(()));

    let without_parent = [
        ("courseboard.caddies.payroll", true, true),
        ("courseboard.caddies.rank_fees", true, true),
        ("courseboard.caddies", false, true),
        ("courseboard.courses", true, true),
    ];
    assert_eq!(
        decide(ScriptedEvaluator::with(&without_parent), key).await,
        Err(DeliveryDenial::NotProvided)
    );
}

#[tokio::test]
async fn anything_but_a_positive_decision_is_refused() {
    let key = "courseboard.courses";
    assert_eq!(
        decide(ScriptedEvaluator::with(&[(key, false, false)]), key).await,
        Err(DeliveryDenial::Unresolved)
    );
    assert_eq!(
        decide(ScriptedEvaluator::with(&[]), key).await,
        Err(DeliveryDenial::Unavailable)
    );
    assert_eq!(
        decide(ScriptedEvaluator::failing(), key).await,
        Err(DeliveryDenial::Unavailable)
    );
}

#[tokio::test]
async fn one_batch_asks_core_for_the_feature_and_its_requirements() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let guard = FeatureDeliveryGuard::new(evaluator.clone(), DeliveryEnforcement::Enforce);
    guard
        .evaluate(
            &[
                catalog::feature("courseboard.products").unwrap(),
                catalog::feature("courseboard.budgets").unwrap(),
            ],
            &context(),
        )
        .await;
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        *evaluator.asked.lock().unwrap(),
        vec![
            "feature.courseboard.products",
            "feature.courseboard.courses",
            "feature.courseboard.budgets",
        ]
    );
}

#[test]
fn enforcement_defaults_off_and_a_typo_enforces() {
    assert_eq!(DeliveryEnforcement::parse(None), DeliveryEnforcement::Off);
    assert_eq!(
        DeliveryEnforcement::parse(Some("")),
        DeliveryEnforcement::Off
    );
    assert_eq!(
        DeliveryEnforcement::parse(Some("shadow")),
        DeliveryEnforcement::Shadow
    );
    assert_eq!(
        DeliveryEnforcement::parse(Some(" enforce ")),
        DeliveryEnforcement::Enforce
    );
    assert_eq!(
        DeliveryEnforcement::parse(Some("on")),
        DeliveryEnforcement::Enforce
    );
}

// ─── Middleware and evaluate endpoint ─────────────────────────────────────

fn state(evaluator: Arc<ScriptedEvaluator>, enforcement: DeliveryEnforcement) -> AppState {
    // Lazy: nothing below touches the database.
    let pool = sqlx::MySqlPool::connect_lazy("mysql://root@127.0.0.1:4000/courseboard_test")
        .expect("lazy pool");
    AppState::new(pool, Arc::new(StaticBearerVerifier::new(TOKEN.to_string())))
        .with_feature_delivery(FeatureDeliveryGuard::new(evaluator, enforcement))
}

fn guarded_app(state: AppState) -> Router {
    Router::new()
        .route("/v1/course/tee-sheet", any(|| async { "handler ran" }))
        .route("/field-api/*path", any(|| async { "handler ran" }))
        .route("/healthz", any(|| async { "handler ran" }))
        .route(
            "/v1/course/data-exports/:source_key/rows",
            any(|| async { "handler ran" }),
        )
        .route(
            "/v1/course/feature-deliveries/evaluate",
            post(evaluate_feature_deliveries),
        )
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(
            state,
            require_feature_delivery,
        ))
}

fn request(method: Method, path: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"))
        .header("x-operator-id", TENANT)
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap()
}

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap()).unwrap()
}

#[tokio::test]
async fn off_runs_the_handler_without_asking_core() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Off));
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn shadow_asks_core_but_lets_a_denial_through() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Shadow));
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn enforce_refuses_a_feature_the_tenant_lacks() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[
        ("courseboard.tee_sheet", true, true),
        ("courseboard.courses", false, true),
    ]));
    let app = guarded_app(state(evaluator, DeliveryEnforcement::Enforce));
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(body_json(response).await["code"], "FEATURE_NOT_PROVIDED");
}

#[tokio::test]
async fn enforce_runs_a_provided_feature() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[
        ("courseboard.tee_sheet", true, true),
        ("courseboard.courses", true, true),
    ]));
    let app = guarded_app(state(evaluator, DeliveryEnforcement::Enforce));
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn enforce_refuses_an_unmapped_field_proxy_path_and_skips_exempt_ones() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Enforce));
    let response = app
        .clone()
        .oneshot(request(Method::GET, "/field-api/v1/erp/journals"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        body_json(response).await["code"],
        "FEATURE_ROUTE_UNCLASSIFIED"
    );

    let response = app.oneshot(request(Method::GET, "/healthz")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_unverified_bearer_never_reaches_core() {
    for (enforcement, status) in [
        (DeliveryEnforcement::Enforce, StatusCode::UNAUTHORIZED),
        (DeliveryEnforcement::Shadow, StatusCode::OK),
    ] {
        let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
        let app = guarded_app(state(evaluator.clone(), enforcement));
        let request = Request::builder()
            .uri("/v1/course/tee-sheet")
            .header(AUTHORIZATION, "Bearer forged")
            .header("x-operator-id", TENANT)
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), status, "{enforcement:?}");
        assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0, "{enforcement:?}");
    }
}

#[tokio::test]
async fn enforce_without_a_tenant_scope_is_unavailable() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator, DeliveryEnforcement::Enforce));
    let request = Request::builder()
        .uri("/v1/course/tee-sheet")
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"))
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        body_json(response).await["code"],
        "FEATURE_DELIVERY_UNAVAILABLE"
    );
}

fn evaluate_request(keys: &[&str]) -> Request<Body> {
    let mut request = request(Method::POST, "/v1/course/feature-deliveries/evaluate");
    *request.body_mut() = Body::from(serde_json::json!({ "keys": keys }).to_string());
    request
}

#[tokio::test]
async fn evaluate_reports_off_without_values() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Off));
    let response = app
        .oneshot(evaluate_request(&["courseboard.courses"]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_json(response).await,
        serde_json::json!({ "enforcement": "off", "values": [] })
    );
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn evaluate_ands_requirements_and_separates_unresolved() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[
        ("courseboard.courses", true, true),
        ("courseboard.products", true, true),
        ("courseboard.customers", false, false),
    ]));
    let app = guarded_app(state(evaluator, DeliveryEnforcement::Enforce));
    let response = app
        .oneshot(evaluate_request(&[
            "courseboard.products",
            "courseboard.customers.reception",
            "courseboard.budgets",
        ]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_json(response).await,
        serde_json::json!({
            "enforcement": "enforce",
            "values": [
                { "key": "courseboard.products", "enabled": true, "resolved": true, "reason": "provided" },
                { "key": "courseboard.customers.reception", "enabled": false, "resolved": false, "reason": "unavailable" },
                { "key": "courseboard.budgets", "enabled": false, "resolved": false, "reason": "unavailable" },
            ]
        })
    );
}

#[tokio::test]
async fn evaluate_rejects_keys_outside_the_catalog() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator, DeliveryEnforcement::Enforce));
    let response = app
        .oneshot(evaluate_request(&["field.invoice.general"]))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ─── Data exports: each source is its own feature ─────────────────────────

#[test]
fn every_export_source_belongs_to_a_feature() {
    let keyless: Vec<&str> = crate::course::domain::data_exports::data_export_objects()
        .iter()
        .filter(|object| routes::export_source_feature(&object.key).is_none())
        .map(|object| object.key.as_str())
        .collect();
    assert!(
        keyless.is_empty(),
        "export sources without a feature: {keyless:?}"
    );
    let key = |source: &str| routes::export_source_feature(source).map(|feature| feature.key);
    assert_eq!(key("payroll"), Some("courseboard.caddies.payroll"));
    assert_eq!(
        key("external:courseboard:settlement"),
        Some("courseboard.settlement")
    );
    assert_eq!(
        key("receptionAnswers"),
        Some("courseboard.customers.reception")
    );
    assert_eq!(key("courses"), Some("courseboard.courses"));
    assert_eq!(key("visitCheckins"), Some("courseboard.tee_sheet.checkin"));
}

#[tokio::test]
async fn export_rows_need_the_source_feature_as_well() {
    let only_exports = [("courseboard.data_exports", true, true)];
    let app = guarded_app(state(
        Arc::new(ScriptedEvaluator::with(&only_exports)),
        DeliveryEnforcement::Enforce,
    ));
    let response = app
        .oneshot(request(
            Method::GET,
            "/v1/course/data-exports/settlement/rows",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let with_source = [
        ("courseboard.data_exports", true, true),
        ("courseboard.settlement", true, true),
    ];
    let app = guarded_app(state(
        Arc::new(ScriptedEvaluator::with(&with_source)),
        DeliveryEnforcement::Enforce,
    ));
    let response = app
        .oneshot(request(
            Method::GET,
            "/v1/course/data-exports/settlement/rows",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

fn headers() -> axum::http::HeaderMap {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(AUTHORIZATION, format!("Bearer {TOKEN}").parse().unwrap());
    headers.insert("x-operator-id", TENANT.parse().unwrap());
    headers
}

#[tokio::test]
async fn the_export_catalogue_offers_only_provided_sources_under_enforcement() {
    let values = [
        ("courseboard.data_exports", true, true),
        ("courseboard.settlement", true, true),
        ("courseboard.caddies.payroll", false, true),
    ];
    let sources = ["settlement", "payroll", "unknown"];
    let guard = FeatureDeliveryGuard::new(
        Arc::new(ScriptedEvaluator::with(&values)),
        DeliveryEnforcement::Enforce,
    );
    assert_eq!(
        guard.provided_export_sources(&sources, &headers()).await,
        vec![true, false, false]
    );
    let shadow = FeatureDeliveryGuard::new(
        Arc::new(ScriptedEvaluator::with(&values)),
        DeliveryEnforcement::Shadow,
    );
    assert_eq!(
        shadow.provided_export_sources(&sources, &headers()).await,
        vec![true, true, true]
    );
}
