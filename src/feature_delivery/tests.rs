use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
    let proxy_keys = FIELD_PROXY_RULES.iter().map(|(_, _, route)| *route);
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
        ("/field-api/v1/invoices", "courseboard.cancellation_fee"),
        (
            "/field-api/v1/erp/reservations/rsv_1/billing-invoice",
            "courseboard.settlement",
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
    // Every staff call is the staff feature, the roster's registration and
    // clock-in included: the caddie feature builds on it.
    for (method, path) in [
        (Method::POST, "/field-api/v1/erp/staff"),
        (Method::POST, "/field-api/v1/erp/staff/stf_1/clock-in"),
        (Method::GET, "/field-api/v1/erp/staff"),
        (Method::PATCH, "/field-api/v1/erp/staff/stf_1"),
        (Method::DELETE, "/field-api/v1/erp/staff/stf_1"),
        (Method::GET, "/field-api/v1/erp/staff/stf_1/clock-in"),
    ] {
        match routes::classify_request(&method, path) {
            RequestFeature::Required(feature) => {
                assert_eq!(feature.key, "courseboard.staff", "{method} {path}")
            }
            other => panic!("{method} {path} resolved to {other:?}"),
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
fn catalog_keys_are_unique_and_namespaced() {
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

#[test]
fn the_manifest_writes_no_defaults() {
    // Every scalar value is written double-quoted, so a field whose value is
    // a default is exactly a line ending in an unquoted `[]` or `null`. A
    // description or annotation that merely mentions `: []` ends in a quote.
    let is_default_field = |line: &str| {
        let line = line.trim_end();
        line.ends_with(": []") || line.ends_with(": null")
    };
    let rendered = catalog::render_manifest();
    let defaults: Vec<&str> = rendered
        .lines()
        .filter(|line| is_default_field(line))
        .collect();
    assert!(defaults.is_empty(), "omit these defaults: {defaults:?}");

    let mut notes = String::new();
    catalog::annotations(
        &mut notes,
        &[("example", "fallback: null"), ("list", "example: []")],
    );
    assert!(
        !notes.lines().any(is_default_field),
        "a value that mentions a default is not a default field"
    );
}

/// The manifest is what `tachyon` applies; the catalog is what the guard
/// runs. A difference means one of them is lying.
#[test]
fn the_product_features_manifest_is_rendered_from_the_catalog() {
    let rendered = catalog::render_manifest();
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
    tenants: Mutex<Vec<String>>,
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
        context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, DeliveryValue>, FeatureFlagProviderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.tenants
            .lock()
            .unwrap()
            .push(context.operator_id().to_string());
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

/// Samples every request and never deduplicates, so each call reads Core.
fn guard_of(
    evaluator: Arc<dyn FeatureDeliveryEvaluator>,
    enforcement: DeliveryEnforcement,
) -> FeatureDeliveryGuard {
    FeatureDeliveryGuard::new(evaluator, enforcement)
        .with_sampler(DeliverySampler::new(1.0, Duration::ZERO))
}

fn context() -> FeatureFlagEvaluationContext {
    FeatureFlagEvaluationContext::new(format!("Bearer {TOKEN}"), TENANT.to_string(), None)
}

async fn decide(evaluator: ScriptedEvaluator, key: &str) -> Result<(), DeliveryDenial> {
    let guard = guard_of(Arc::new(evaluator), DeliveryEnforcement::Enforce);
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
        ("courseboard.staff", true, true),
    ];
    assert_eq!(decide(ScriptedEvaluator::with(&all), key).await, Ok(()));

    let without_parent = [
        ("courseboard.caddies.payroll", true, true),
        ("courseboard.caddies.rank_fees", true, true),
        ("courseboard.caddies", false, true),
        ("courseboard.courses", true, true),
        ("courseboard.staff", true, true),
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
    let guard = guard_of(evaluator.clone(), DeliveryEnforcement::Enforce);
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
        .with_feature_delivery(guard_of(evaluator, enforcement))
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
        .route("/admin/caddies", any(|body: String| async move { body }))
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
async fn evaluate_reports_off_and_shadow_without_asking_core() {
    for (enforcement, name) in [
        (DeliveryEnforcement::Off, "off"),
        (DeliveryEnforcement::Shadow, "shadow"),
    ] {
        let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
        let app = guarded_app(state(evaluator.clone(), enforcement));
        let response = app
            .oneshot(evaluate_request(&["courseboard.courses"]))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body_json(response).await,
            serde_json::json!({ "enforcement": name, "values": [] })
        );
        assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0, "{name}");
    }
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
    let guard = guard_of(
        Arc::new(ScriptedEvaluator::with(&values)),
        DeliveryEnforcement::Enforce,
    );
    assert_eq!(
        guard.provided_export_sources(&sources, &headers()).await,
        vec![true, false, false]
    );
    let shadow = guard_of(
        Arc::new(ScriptedEvaluator::with(&values)),
        DeliveryEnforcement::Shadow,
    );
    assert_eq!(
        shadow.provided_export_sources(&sources, &headers()).await,
        vec![true, true, true]
    );
}

#[test]
fn percent_decoding_is_strict() {
    assert_eq!(
        routes::percent_decode("%70ayroll").as_deref(),
        Some("payroll")
    );
    assert_eq!(routes::percent_decode("plain").as_deref(), Some("plain"));
    assert_eq!(routes::percent_decode("%zz"), None);
    assert_eq!(routes::percent_decode("%7"), None);
}

#[tokio::test]
async fn an_encoded_export_key_is_judged_as_the_source_it_reads() {
    let only_exports = [("courseboard.data_exports", true, true)];
    for path in [
        "/v1/course/data-exports/%70ayroll/rows",
        "/v1/course/data-exports/%zz/rows",
        "/v1/course/data-exports/nonexistent/rows",
    ] {
        let app = guarded_app(state(
            Arc::new(ScriptedEvaluator::with(&only_exports)),
            DeliveryEnforcement::Enforce,
        ));
        let response = app.oneshot(request(Method::GET, path)).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{path}");
    }
}

fn admin_request(method: Method, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"))
        .header("content-type", "application/x-www-form-urlencoded")
        .header("content-length", body.len().to_string())
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn legacy_admin_is_judged_for_the_tenant_its_form_names() {
    let provided = [
        ("courseboard.caddies", true, true),
        ("courseboard.courses", true, true),
        ("courseboard.staff", true, true),
    ];
    let evaluator = Arc::new(ScriptedEvaluator::with(&provided));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Enforce));
    let response = app
        .clone()
        .oneshot(admin_request(
            Method::GET,
            &format!("/admin/caddies?tenant_id={TENANT}"),
            "",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let form = format!("tenant_id={TENANT}&display_name=Sato");
    let response = app
        .oneshot(admin_request(Method::POST, "/admin/caddies", &form))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    // The handler still reads the whole form the guard looked into.
    let body = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    assert_eq!(body, form.as_bytes());
    assert_eq!(*evaluator.tenants.lock().unwrap(), vec![TENANT, TENANT]);
}

#[tokio::test]
async fn legacy_admin_without_a_tenant_is_unavailable() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Enforce));
    let response = app
        .oneshot(admin_request(Method::GET, "/admin/caddies", ""))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

const OTHER_TENANT: &str = "tn_01hjjn348rn3t49zz6hvmfq67p";

#[tokio::test]
async fn legacy_admin_refuses_a_header_that_names_another_tenant() {
    let provided = [
        ("courseboard.caddies", true, true),
        ("courseboard.courses", true, true),
        ("courseboard.staff", true, true),
    ];
    let evaluator = Arc::new(ScriptedEvaluator::with(&provided));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Enforce));
    let mut request = admin_request(
        Method::POST,
        "/admin/caddies",
        &format!("tenant_id={OTHER_TENANT}&display_name=Sato"),
    );
    request
        .headers_mut()
        .insert("x-operator-id", TENANT.parse().unwrap());
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        body_json(response).await["code"],
        "FEATURE_DELIVERY_SCOPE_MISMATCH"
    );
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_oversized_admin_form_reaches_the_handler_whole_in_shadow() {
    let form = format!("tenant_id={TENANT}&notes={}", "x".repeat(70 * 1024));
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Shadow));
    let response = app
        .oneshot(admin_request(Method::POST, "/admin/caddies", &form))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    assert_eq!(body.len(), form.len());

    let app = guarded_app(state(
        Arc::new(ScriptedEvaluator::with(&[])),
        DeliveryEnforcement::Enforce,
    ));
    let response = app
        .oneshot(admin_request(Method::POST, "/admin/caddies", &form))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

// ─── Common imports and the shell's clock ─────────────────────────────────

#[test]
fn every_import_target_belongs_to_a_feature() {
    let keyless: Vec<&str> = crate::common_import_proxy::TARGETS
        .iter()
        .map(|(key, _, _)| *key)
        .filter(|key| routes::import_target_feature(key).is_none())
        .collect();
    assert!(
        keyless.is_empty(),
        "import targets without a feature: {keyless:?}"
    );
}

#[tokio::test]
async fn an_import_target_needs_its_own_feature_under_enforcement() {
    let only_imports = [("courseboard.data_imports", true, true)];
    let guard = guard_of(
        Arc::new(ScriptedEvaluator::with(&only_imports)),
        DeliveryEnforcement::Enforce,
    );
    assert!(guard
        .ensure_import_target("courseboardReservationReports", &headers())
        .await
        .is_err());

    let with_target = [
        ("courseboard.data_imports", true, true),
        ("courseboard.reservation_report_import", true, true),
        ("courseboard.courses", true, true),
    ];
    let guard = guard_of(
        Arc::new(ScriptedEvaluator::with(&with_target)),
        DeliveryEnforcement::Enforce,
    );
    assert!(guard
        .ensure_import_target("courseboardReservationReports", &headers())
        .await
        .is_ok());

    let shadow = guard_of(
        Arc::new(ScriptedEvaluator::with(&only_imports)),
        DeliveryEnforcement::Shadow,
    );
    assert!(shadow
        .ensure_import_target("courseboardReservationReports", &headers())
        .await
        .is_ok());
}

#[test]
fn only_the_timezone_read_is_left_to_every_feature() {
    assert_eq!(
        routes::classify_request(&Method::GET, "/v1/course/tenant-timezone"),
        RequestFeature::Exempt(Exemption::Platform)
    );
    match routes::classify_request(&Method::GET, "/v1/course/extension-status") {
        RequestFeature::Required(feature) => {
            assert_eq!(feature.key, "courseboard.reservation_policy")
        }
        other => panic!("extension-status resolved to {other:?}"),
    }
}

/// Every route shape the Field proxy lets through has a feature or an
/// exemption, so enforcement never refuses a proxied call as unclassified.
#[test]
fn every_route_the_field_proxy_allows_is_classified() {
    let allowed = [
        ("GET", "/v1/erp/staff"),
        ("POST", "/v1/erp/staff"),
        ("PATCH", "/v1/erp/staff/stf_1"),
        ("DELETE", "/v1/erp/staff/stf_1"),
        ("POST", "/v1/erp/staff/stf_1/clock-in"),
        ("GET", "/v1/erp/reservation-types"),
        ("GET", "/v1/field/iam/users"),
        ("POST", "/v1/field/iam/users/invite"),
        ("PUT", "/v1/field/iam/users/usr_1/policies"),
        ("DELETE", "/v1/field/iam/users/usr_1"),
        ("POST", "/v1/erp/reservations/rsv_1/billing-invoice"),
        ("GET", "/v1/erp/orders/ord_1"),
        ("GET", "/v1/field/client-context"),
        ("GET", "/v1/cancellation-fees"),
        ("POST", "/v1/cancellation-fees"),
        ("PATCH", "/v1/cancellation-fees/inv_1"),
        ("POST", "/v1/cancellation-fees/inv_1/send"),
        ("GET", "/v1/invoices"),
        ("POST", "/v1/invoices"),
        ("GET", "/v1/bridge/exports/objects"),
        ("POST", "/v1/bridge/exports/definitions"),
        ("GET", "/v1/bridge/exports/definitions/def_1/csv"),
        ("POST", "/v1/bridge/exports/definitions/def_1/render"),
    ];
    for (method, path) in allowed {
        let method = Method::from_bytes(method.as_bytes()).unwrap();
        assert!(
            crate::field_proxy::is_allowed_route(&method, path),
            "the proxy no longer allows {method} {path}; drop it here"
        );
        assert_ne!(
            routes::classify_request(&method, &format!("/field-api{path}")),
            RequestFeature::Unclassified,
            "{method} {path}"
        );
    }
}

#[tokio::test]
async fn legacy_admin_refuses_a_query_and_form_that_disagree() {
    let provided = [
        ("courseboard.caddies", true, true),
        ("courseboard.courses", true, true),
        ("courseboard.staff", true, true),
    ];
    let evaluator = Arc::new(ScriptedEvaluator::with(&provided));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Enforce));
    let response = app
        .oneshot(admin_request(
            Method::POST,
            &format!("/admin/caddies?tenant_id={TENANT}"),
            &format!("tenant_id={OTHER_TENANT}&display_name=Sato"),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        body_json(response).await["code"],
        "FEATURE_DELIVERY_SCOPE_MISMATCH"
    );
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_import_listing_asks_core_once_whatever_its_length() {
    let values = [
        ("courseboard.data_imports", true, true),
        ("courseboard.customers", true, true),
        ("courseboard.budgets", false, true),
        ("courseboard.courses", true, true),
    ];
    let targets = [
        "customer",
        "dailyBudgets",
        "customer",
        "customer",
        "dailyBudgets",
        "unknown",
    ];
    let evaluator = Arc::new(ScriptedEvaluator::with(&values));
    let guard = guard_of(evaluator.clone(), DeliveryEnforcement::Enforce);
    let decisions = guard.import_target_decisions(&targets, &headers()).await;
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 1);
    assert!(decisions["customer"]);
    assert!(!decisions["dailyBudgets"]);
    assert!(!decisions["unknown"]);

    // Shadow still asks once, and changes nothing.
    let evaluator = Arc::new(ScriptedEvaluator::failing());
    let shadow = guard_of(evaluator.clone(), DeliveryEnforcement::Shadow);
    let decisions = shadow.import_target_decisions(&targets, &headers()).await;
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 1);
    assert!(decisions.values().all(|allowed| *allowed));

    let evaluator = Arc::new(ScriptedEvaluator::failing());
    let off = guard_of(evaluator.clone(), DeliveryEnforcement::Off);
    off.import_target_decisions(&targets, &headers()).await;
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn the_fallback_authorization_header_carries_the_evaluation_context() {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        crate::COURSEBOARD_AUTHORIZATION_HEADER,
        format!("Bearer {TOKEN}").parse().unwrap(),
    );
    headers.insert("x-operator-id", TENANT.parse().unwrap());
    let context = FeatureFlagEvaluationContext::from_headers(&headers).expect("fallback header");
    assert_eq!(context.authorization(), format!("Bearer {TOKEN}"));
}

#[test]
fn reading_cancellation_invoices_is_the_list_but_issuing_one_is_billing() {
    let key = |method: Method| match routes::classify_request(&method, "/field-api/v1/invoices") {
        RequestFeature::Required(feature) => feature.key,
        other => panic!("{other:?}"),
    };
    assert_eq!(key(Method::GET), "courseboard.customers.cancellations");
    assert_eq!(key(Method::POST), "courseboard.cancellation_fee");
    // Invoice ids are not CourseBoard's to act on.
    for (method, path) in [
        (Method::GET, "/field-api/v1/invoices/inv_1"),
        (Method::PATCH, "/field-api/v1/invoices/inv_1"),
        (Method::POST, "/field-api/v1/invoices/inv_1/fulfill"),
    ] {
        assert_eq!(
            routes::classify_request(&method, path),
            RequestFeature::Unclassified,
            "{method} {path}"
        );
    }
}

fn json_request(method: Method, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"))
        .header("x-operator-id", TENANT)
        .header("content-type", "application/json")
        .header("content-length", body.len().to_string())
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn the_invoice_api_is_admitted_only_inside_the_cancellation_fee_workflow() {
    let provided = [
        ("courseboard.customers.cancellations", true, true),
        ("courseboard.customers", true, true),
        ("courseboard.cancellation_fee", true, true),
    ];
    let status = |request: Request<Body>| async {
        let app = guarded_app(state(
            Arc::new(ScriptedEvaluator::with(&provided)),
            DeliveryEnforcement::Enforce,
        ));
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let code = if status == StatusCode::FORBIDDEN {
            body_json(response).await["code"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        } else {
            String::new()
        };
        (status, code)
    };
    let fee = r#"{"sources":[{"sourceType":"reservation","sourceId":"rsv_1","reason":"cancellation_fee"}]}"#;
    let general =
        r#"{"sources":[{"sourceType":"reservation","sourceId":"rsv_1","reason":"green_fee"}]}"#;

    assert_eq!(
        status(request(
            Method::GET,
            "/field-api/v1/invoices?reason=cancellation_fee&limit=50"
        ))
        .await,
        (StatusCode::OK, String::new())
    );
    assert_eq!(
        status(request(Method::GET, "/field-api/v1/invoices")).await,
        (StatusCode::FORBIDDEN, "FEATURE_SCOPE_EXCEEDED".to_string())
    );
    assert_eq!(
        status(request(
            Method::GET,
            "/field-api/v1/invoices?reason=cancellation_fee&reason=green_fee"
        ))
        .await,
        (StatusCode::FORBIDDEN, "FEATURE_SCOPE_EXCEEDED".to_string())
    );
    assert_eq!(
        status(json_request(Method::POST, "/field-api/v1/invoices", fee)).await,
        (StatusCode::OK, String::new())
    );
    assert_eq!(
        status(json_request(
            Method::POST,
            "/field-api/v1/invoices",
            general
        ))
        .await,
        (StatusCode::FORBIDDEN, "FEATURE_SCOPE_EXCEEDED".to_string())
    );
    assert_eq!(
        status(request(Method::PATCH, "/field-api/v1/invoices/inv_1")).await,
        (
            StatusCode::FORBIDDEN,
            "FEATURE_ROUTE_UNCLASSIFIED".to_string()
        )
    );
}

#[test]
fn member_pricing_in_the_simulator_needs_the_membership_feature() {
    let simulator = catalog::feature("courseboard.fee_simulator").unwrap();
    assert!(super::required_closure(simulator).contains(&"courseboard.membership"));
}

#[test]
fn annotations_stay_within_cores_limits() {
    let (max_keys, max_value_bytes) = catalog::ANNOTATION_LIMITS;
    for feature in FEATURES {
        assert!(
            feature.annotations.len() <= max_keys,
            "{} has more than {max_keys} annotations",
            feature.key
        );
        let mut seen = HashSet::new();
        for (key, value) in feature.annotations {
            assert!(
                catalog::is_annotation_key(key),
                "{}: bad annotation key {key:?}",
                feature.key
            );
            assert!(
                seen.insert(key),
                "{}: duplicate annotation {key}",
                feature.key
            );
            assert!(
                value.len() <= max_value_bytes,
                "{}: annotation {key} is over {max_value_bytes} bytes",
                feature.key
            );
        }
    }
}

#[test]
fn annotation_keys_follow_cores_pattern() {
    for key in [
        "a",
        "owner",
        "docs/runbook",
        "v1.notes_x-y",
        &"a".repeat(63),
    ] {
        assert!(catalog::is_annotation_key(key), "{key}");
    }
    for key in ["", "Owner", "-lead", ".x", "a b", "日本", &"a".repeat(64)] {
        assert!(!catalog::is_annotation_key(key), "{key}");
    }
}

#[test]
fn annotations_render_as_a_quoted_map_and_are_omitted_when_empty() {
    let mut out = String::new();
    catalog::annotations(&mut out, &[]);
    assert!(out.is_empty());

    catalog::annotations(
        &mut out,
        &[("owner", "desk team"), ("note", "line one\nline \"two\"\\")],
    );
    assert_eq!(
        out,
        "    annotations:\n      \"owner\": \"desk team\"\n      \"note\": \"line one\\nline \\\"two\\\"\\\\\"\n"
    );
}

// ─── Shadow sampling and decision logs ────────────────────────────────────

#[derive(Debug, Default)]
struct SlowEvaluator {
    calls: AtomicUsize,
}

#[async_trait]
impl FeatureDeliveryEvaluator for SlowEvaluator {
    async fn delivery_values(
        &self,
        _delivery_keys: &[String],
        _context: &FeatureFlagEvaluationContext,
    ) -> Result<HashMap<String, DeliveryValue>, FeatureFlagProviderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(30)).await;
        Err(FeatureFlagProviderError)
    }
}

fn sampled_state(
    evaluator: Arc<dyn FeatureDeliveryEvaluator>,
    guard: impl FnOnce(FeatureDeliveryGuard) -> FeatureDeliveryGuard,
) -> AppState {
    let pool = sqlx::MySqlPool::connect_lazy("mysql://root@127.0.0.1:4000/courseboard_test")
        .expect("lazy pool");
    AppState::new(pool, Arc::new(StaticBearerVerifier::new(TOKEN.to_string())))
        .with_feature_delivery(guard(FeatureDeliveryGuard::new(
            evaluator,
            DeliveryEnforcement::Shadow,
        )))
}

#[derive(Clone, Default)]
struct CapturedLogs(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for CapturedLogs {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLogs {
    type Writer = Self;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

impl CapturedLogs {
    fn install(&self) -> tracing::subscriber::DefaultGuard {
        tracing::subscriber::set_default(
            tracing_subscriber::fmt()
                .without_time()
                .with_ansi(false)
                .with_writer(self.clone())
                .finish(),
        )
    }

    fn decisions(&self) -> Vec<String> {
        String::from_utf8(self.0.lock().unwrap().clone())
            .unwrap()
            .lines()
            .filter(|line| line.contains(DECISION_LOG_TARGET))
            .map(ToOwned::to_owned)
            .collect()
    }
}

#[tokio::test]
async fn shadow_reads_only_the_sampled_share() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(sampled_state(evaluator.clone(), |guard| {
        guard.with_sampler(DeliverySampler::new(0.0, Duration::ZERO))
    }));
    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn shadow_reads_a_tenant_and_feature_once_per_window() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(sampled_state(evaluator.clone(), |guard| {
        guard.with_sampler(DeliverySampler::new(1.0, SHADOW_DEDUP_WINDOW))
    }));
    for _ in 0..3 {
        app.clone()
            .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
            .await
            .unwrap();
    }
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_slow_core_delays_a_shadow_response_only_up_to_the_budget() {
    let logs = CapturedLogs::default();
    let _subscriber = logs.install();
    let evaluator = Arc::new(SlowEvaluator::default());
    let app = guarded_app(sampled_state(evaluator.clone(), |guard| {
        guard
            .with_sampler(DeliverySampler::new(1.0, Duration::ZERO))
            .with_shadow_budget(Duration::from_millis(20))
    }));
    let started = std::time::Instant::now();
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(evaluator.calls.load(Ordering::SeqCst), 1);
    let decisions = logs.decisions();
    assert_eq!(decisions.len(), 1, "{decisions:?}");
    assert!(
        decisions[0].contains("reason=\"SHADOW_TIMEOUT\""),
        "{decisions:?}"
    );
}

#[tokio::test]
async fn shadow_logs_a_structured_decision_with_the_tenant_and_no_secret() {
    let logs = CapturedLogs::default();
    let _subscriber = logs.install();
    let evaluator = Arc::new(ScriptedEvaluator::with(&[
        ("courseboard.tee_sheet", true, true),
        ("courseboard.courses", false, true),
    ]));
    let app = guarded_app(state(evaluator, DeliveryEnforcement::Shadow));
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let decisions = logs.decisions();
    assert_eq!(decisions.len(), 1, "{decisions:?}");
    for field in [
        format!("tenant_id=\"{TENANT}\""),
        "feature=\"courseboard.tee_sheet\"".to_string(),
        "decision=\"deny\"".to_string(),
        "reason=\"FEATURE_NOT_PROVIDED\"".to_string(),
        "enforcement=\"shadow\"".to_string(),
    ] {
        assert!(decisions[0].contains(&field), "{field} in {decisions:?}");
    }
    let raw = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(!raw.contains(TOKEN), "{raw}");
}

#[tokio::test]
async fn enforce_logs_every_denial_and_samples_allows() {
    let logs = CapturedLogs::default();
    let _subscriber = logs.install();
    let evaluator = Arc::new(ScriptedEvaluator::failing());
    let pool = sqlx::MySqlPool::connect_lazy("mysql://root@127.0.0.1:4000/courseboard_test")
        .expect("lazy pool");
    let app = guarded_app(
        AppState::new(pool, Arc::new(StaticBearerVerifier::new(TOKEN.to_string())))
            .with_feature_delivery(
                FeatureDeliveryGuard::new(evaluator, DeliveryEnforcement::Enforce)
                    .with_sampler(DeliverySampler::new(0.0, Duration::ZERO)),
            ),
    );
    let response = app
        .oneshot(request(Method::GET, "/v1/course/tee-sheet"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let decisions = logs.decisions();
    assert_eq!(decisions.len(), 1, "{decisions:?}");
    assert!(decisions[0].contains(&format!("tenant_id=\"{TENANT}\"")));
    assert!(decisions[0].contains("enforcement=\"enforce\""));
}

#[tokio::test]
async fn shadow_never_reads_the_body_so_an_unreadable_one_is_left_to_the_handler() {
    let evaluator = Arc::new(ScriptedEvaluator::with(&[]));
    let app = guarded_app(state(evaluator.clone(), DeliveryEnforcement::Shadow));
    let failing = futures::stream::once(async {
        Err::<axum::body::Bytes, std::io::Error>(std::io::Error::other("client went away"))
    });
    let request = Request::builder()
        .method(Method::POST)
        .uri("/field-api/v1/invoices")
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"))
        .header("x-operator-id", TENANT)
        .header("content-type", "application/json")
        .header("content-length", "16")
        .body(Body::from_stream(failing))
        .unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[test]
fn the_sample_rate_defaults_low_and_rejects_nonsense() {
    assert_eq!(
        DeliverySampler::parse_rate(None),
        DEFAULT_SHADOW_SAMPLE_RATE
    );
    assert_eq!(DeliverySampler::parse_rate(Some("0.25")), 0.25);
    assert_eq!(DeliverySampler::parse_rate(Some("1")), 1.0);
    for bad in ["1.5", "-0.1", "NaN", "abc"] {
        assert_eq!(
            DeliverySampler::parse_rate(Some(bad)),
            DEFAULT_SHADOW_SAMPLE_RATE,
            "{bad}"
        );
    }
}
