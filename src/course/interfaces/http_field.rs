//! Axum handler for SDK-backed TACHYON Field operations.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::openapi::ErrorBody;
use crate::course::domain::{
    FieldAccessToken, FieldClientCapabilities, FieldOperatorId, FieldPlatformId,
    FieldRequestContext,
};
use crate::course::infrastructure::FieldSdkCapabilitiesGateway;
use crate::course::usecase::GetFieldClientCapabilitiesUseCase;
use crate::course_authz::{self, CheckError, NavigationActionSnapshot};
use crate::{AppError, AppState, COURSEBOARD_AUTHORIZATION_HEADER};

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilitiesResponse {
    pub navigation: NavigationCapabilitiesResponse,
    /// Fresh, per-action policy results. `null` means that Auth could not
    /// establish a decision for that canonical action; clients must not infer
    /// access from a different action or from the aggregate below.
    pub actions: BTreeMap<String, Option<bool>>,
    pub agent_documents: AgentDocumentCapabilitiesResponse,
    pub cancellation_fees: CancellationFeeCapabilitiesResponse,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct AgentDocumentCapabilitiesResponse {
    pub invoices: DocumentQueueCapabilitiesResponse,
    pub quotations: DocumentQueueCapabilitiesResponse,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct DocumentQueueCapabilitiesResponse {
    pub list: bool,
    pub send: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct CancellationFeeCapabilitiesResponse {
    pub list: bool,
    pub manage: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCapabilitiesResponse {
    /// `None` is serialized as null when Field's action batch was incomplete.
    pub other_business_access: Option<bool>,
}

impl From<FieldClientCapabilities> for ClientCapabilitiesResponse {
    fn from(value: FieldClientCapabilities) -> Self {
        Self::from_parts(value, None)
    }
}

impl ClientCapabilitiesResponse {
    fn from_parts(
        value: FieldClientCapabilities,
        navigation_snapshot: Option<NavigationActionSnapshot>,
    ) -> Self {
        let actions = navigation_snapshot
            .map(|snapshot| snapshot.actions)
            .unwrap_or_default();
        Self {
            navigation: NavigationCapabilitiesResponse {
                // Preserve Field's aggregate contract verbatim. The
                // CourseBoard per-action map is additive and must not infer
                // a replacement aggregate from unrelated actions.
                other_business_access: value.navigation.other_business_access,
            },
            actions,
            agent_documents: AgentDocumentCapabilitiesResponse {
                invoices: DocumentQueueCapabilitiesResponse {
                    list: value.agent_documents.invoices.list,
                    send: value.agent_documents.invoices.send,
                },
                quotations: DocumentQueueCapabilitiesResponse {
                    list: value.agent_documents.quotations.list,
                    send: value.agent_documents.quotations.send,
                },
            },
            cancellation_fees: CancellationFeeCapabilitiesResponse {
                list: value.cancellation_fees.list,
                manage: value.cancellation_fees.manage,
            },
        }
    }
}

/// GET /v1/field/client-capabilities
#[utoipa::path(
    get,
    path = "/v1/field/client-capabilities",
    tag = "field",
    params(
        ("x-operator-id" = String, Header, description = "TACHYON tenant being operated on"),
        ("x-platform-id" = String, Header, description = "TACHYON platform tenant")
    ),
    responses(
        (status = 200, description = "Capabilities available to the delegated caller", body = ClientCapabilitiesResponse),
        (status = 400, description = "Missing or invalid tenant header", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 403, description = "Field denied access to the selected tenant", body = ErrorBody),
        (status = 424, description = "Field provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get_client_capabilities(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ClientCapabilitiesResponse>, AppError> {
    // Authentication has already been performed by `require_valid_token`.
    // Parse the exact delegated access token and both tenant headers into VOs
    // here, before any upstream client is constructed.
    let context = FieldRequestContext::new(
        delegated_access_token(&headers)?,
        operator_id(&headers)?,
        platform_id(&headers)?,
    );

    let gateway = Arc::new(FieldSdkCapabilitiesGateway::new(
        state.cancellation_fee_config.field_api_url.as_deref(),
    ));
    let use_case = GetFieldClientCapabilitiesUseCase::new(gateway);
    // Not `http::credentials`: that reads `Authorization` only, and this route
    // is one of the paths where Cloudflare leaves just the first-party header.
    let bearer = super::http::caller_bearer(&headers)?;
    let operator = context.operator_id().to_string();
    let platform = context.platform_id().to_string();
    let credentials = crate::course::domain::GatewayCredentials {
        authorization: bearer,
        caller_bearer: bearer,
        operator_id: &operator,
        platform_id: Some(&platform),
        authorizer: state.course_authorizer(),
    };
    let capabilities = use_case
        .execute(credentials, context)
        .await
        .map_err(AppError::from)?;
    let action_set = course_authz::navigation_action_set();
    let navigation_snapshot = if let Some(checker) = state.navigation_policy_checker() {
        let bearer = bearer.strip_prefix("Bearer ").unwrap_or(bearer).trim();
        Some(
            course_authz::fresh_navigation_snapshot(
                checker.as_ref(),
                bearer,
                &operator,
                Some(&platform),
                &action_set,
            )
            .await
            .map_err(|error| match error {
                CheckError::Unauthorized => AppError::Unauthorized,
                CheckError::TenantRejected => AppError::TenantForbidden,
                CheckError::Provider(message) => AppError::Provider(message),
            })?,
        )
    } else {
        None
    };
    Ok(Json(ClientCapabilitiesResponse::from_parts(
        capabilities,
        navigation_snapshot,
    )))
}

fn delegated_access_token(headers: &HeaderMap) -> Result<FieldAccessToken, AppError> {
    let value = headers
        .get(AUTHORIZATION)
        .or_else(|| headers.get(COURSEBOARD_AUTHORIZATION_HEADER))
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let token = value
        .strip_prefix("Bearer ")
        .ok_or(AppError::Unauthorized)?;
    FieldAccessToken::try_new(token).map_err(|_| AppError::Unauthorized)
}

fn operator_id(headers: &HeaderMap) -> Result<FieldOperatorId, AppError> {
    let value = required_header(headers, "x-operator-id", "x-operator-id header is required")?;
    FieldOperatorId::try_new(value).map_err(AppError::from)
}

fn platform_id(headers: &HeaderMap) -> Result<FieldPlatformId, AppError> {
    let value = required_header(headers, "x-platform-id", "x-platform-id header is required")?;
    FieldPlatformId::try_new(value).map_err(AppError::from)
}

fn required_header<'a>(
    headers: &'a HeaderMap,
    name: &str,
    missing_message: &'static str,
) -> Result<&'a str, AppError> {
    headers
        .get(name)
        .ok_or(AppError::BadRequest(missing_message))?
        .to_str()
        .map_err(|_| AppError::BadRequest("tenant header must contain ASCII text"))
}

#[cfg(test)]
mod tests {
    use std::{
        atomic::{AtomicUsize, Ordering},
        collections::BTreeMap,
        Arc, Mutex,
    };

    use async_trait::async_trait;
    use axum::{
        body::Body,
        extract::State,
        http::{header, HeaderMap, Request, StatusCode},
        response::{IntoResponse, Response},
        routing::get,
        Json, Router,
    };
    use http_body_util::BodyExt;
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use tower::ServiceExt;

    use crate::auth::{AuthError, AuthenticatedPrincipal, TokenVerifier};
    use crate::cancellation_fees::CancellationFeeConfig;
    use crate::course::domain::{CourseAuthorizer, CourseError, GatewayCredentials};
    use crate::course_authz::{CheckError, DisabledActionAuthorizationBatch, PolicyBatchChecker};
    use crate::{build_router, AppState};

    const TOKEN_A: &str = "fixture-access-token-a";
    const TOKEN_B: &str = "fixture-access-token-b";

    struct RejectingAuthorizer;

    #[async_trait]
    impl CourseAuthorizer for RejectingAuthorizer {
        async fn require(
            &self,
            _credentials: GatewayCredentials<'_>,
            action: &'static str,
        ) -> Result<(), CourseError> {
            Err(CourseError::Forbidden(action))
        }
    }

    #[derive(Clone)]
    struct FixtureTokenVerifier;

    impl TokenVerifier for FixtureTokenVerifier {
        fn verify(&self, token: &str) -> Result<AuthenticatedPrincipal, AuthError> {
            if matches!(token, TOKEN_A | TOKEN_B) {
                Ok(AuthenticatedPrincipal {
                    issuer: "fixture".to_string(),
                    subject: Some("fixture-user".to_string()),
                    username: None,
                    client_id: Some("fixture-client".to_string()),
                })
            } else {
                Err(AuthError::InvalidToken)
            }
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct ObservedRequest {
        authorization: String,
        operator_id: String,
        platform_id: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct CapturedBatchRequest {
        bearer: String,
        operator_id: String,
        platform_id: Option<String>,
        actions: Vec<String>,
    }

    #[derive(Clone, Copy)]
    enum BatchMode {
        DenyAll,
        Unauthorized,
        TenantRejected,
    }

    #[derive(Clone)]
    struct CapturingBatchChecker {
        calls: Arc<Mutex<Vec<CapturedBatchRequest>>>,
        mode: BatchMode,
    }

    #[async_trait]
    impl PolicyBatchChecker for CapturingBatchChecker {
        async fn check_batch(
            &self,
            bearer: &str,
            operator_id: &str,
            platform_id: Option<&str>,
            actions: &[&str],
        ) -> Result<BTreeMap<String, Option<bool>>, CheckError> {
            self.calls.lock().unwrap().push(CapturedBatchRequest {
                bearer: bearer.to_string(),
                operator_id: operator_id.to_string(),
                platform_id: platform_id.map(str::to_owned),
                actions: actions.iter().map(|action| (*action).to_string()).collect(),
            });

            match self.mode {
                BatchMode::DenyAll => Ok(actions
                    .iter()
                    .map(|action| ((*action).to_string(), Some(false)))
                    .collect()),
                BatchMode::Unauthorized => Err(CheckError::Unauthorized),
                BatchMode::TenantRejected => Err(CheckError::TenantRejected),
            }
        }
    }

    #[derive(Clone)]
    struct FakeFieldState {
        calls: Arc<AtomicUsize>,
        requests: Arc<Mutex<Vec<ObservedRequest>>>,
        denied_operator: Option<String>,
        other_business_access: bool,
    }

    async fn fake_client_capabilities(
        State(state): State<FakeFieldState>,
        headers: HeaderMap,
    ) -> Response {
        state.calls.fetch_add(1, Ordering::SeqCst);
        let request = ObservedRequest {
            authorization: observed_header(&headers, header::AUTHORIZATION.as_str()),
            operator_id: observed_header(&headers, "x-operator-id"),
            platform_id: observed_header(&headers, "x-platform-id"),
        };
        let denied = state.denied_operator.as_deref() == Some(request.operator_id.as_str());
        state.requests.lock().unwrap().push(request);

        if denied {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "code": "PermissionDenied",
                    "message": "tenant is outside caller scope"
                })),
            )
                .into_response();
        }

        Json(serde_json::json!({
            "navigation": {
                "otherBusinessAccess": state.other_business_access
            },
            "agentDocuments": {
                "invoices": {"list": true, "send": false},
                "quotations": {"list": false, "send": true}
            },
            "cancellationFees": {"list": true, "manage": false}
        }))
        .into_response()
    }

    fn observed_header(headers: &HeaderMap, name: &str) -> String {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    }

    async fn spawn_fake_field(
        denied_operator: Option<String>,
    ) -> (String, Arc<AtomicUsize>, Arc<Mutex<Vec<ObservedRequest>>>) {
        spawn_fake_field_with_aggregate(denied_operator, false).await
    }

    async fn spawn_fake_field_with_aggregate(
        denied_operator: Option<String>,
        other_business_access: bool,
    ) -> (String, Arc<AtomicUsize>, Arc<Mutex<Vec<ObservedRequest>>>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .route(
                "/v1/field/client-capabilities",
                get(fake_client_capabilities),
            )
            .with_state(FakeFieldState {
                calls: calls.clone(),
                requests: requests.clone(),
                denied_operator,
                other_business_access,
            });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake Field API");
        let address = listener.local_addr().expect("fake Field API address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve fake Field API");
        });
        (format!("http://{address}"), calls, requests)
    }

    fn app(field_api_url: String) -> Router {
        let pool = MySqlPoolOptions::new().connect_lazy_with(
            MySqlConnectOptions::new()
                .host("127.0.0.1")
                .username("root")
                .database("unused_field_capabilities_test"),
        );
        let config = CancellationFeeConfig {
            field_api_url: Some(field_api_url),
            // The SDK route must still delegate the verified inbound user even
            // when a legacy service-account override exists for other routes.
            field_upstream_authorization: Some("Bearer fixture-service-account".to_string()),
            ..CancellationFeeConfig::default()
        };
        build_router(AppState::new_with_cancellation_fee_config(
            pool,
            Arc::new(FixtureTokenVerifier),
            config,
        ))
    }

    fn app_with_rejecting_authorizer(field_api_url: String) -> Router {
        let pool = MySqlPoolOptions::new().connect_lazy_with(
            MySqlConnectOptions::new()
                .host("127.0.0.1")
                .username("root")
                .database("unused_field_capabilities_test"),
        );
        let config = CancellationFeeConfig {
            field_api_url: Some(field_api_url),
            ..CancellationFeeConfig::default()
        };
        build_router(
            AppState::new_with_cancellation_fee_config(
                pool,
                Arc::new(FixtureTokenVerifier),
                config,
            )
            .with_course_authorizer(Arc::new(RejectingAuthorizer)),
        )
    }

    fn app_with_navigation_policy_checker(
        field_api_url: String,
        checker: Arc<dyn PolicyBatchChecker>,
    ) -> Router {
        let pool = MySqlPoolOptions::new().connect_lazy_with(
            MySqlConnectOptions::new()
                .host("127.0.0.1")
                .username("root")
                .database("unused_field_capabilities_test"),
        );
        let config = CancellationFeeConfig {
            field_api_url: Some(field_api_url),
            // Keep this override in the Field leg so the test can prove the
            // policy batch still receives the verified caller token below.
            field_upstream_authorization: Some("Bearer fixture-service-account".to_string()),
            ..CancellationFeeConfig::default()
        };
        build_router(
            AppState::new_with_cancellation_fee_config(
                pool,
                Arc::new(FixtureTokenVerifier),
                config,
            )
            .with_navigation_policy_checker(Some(checker)),
        )
    }

    fn tenant_id(fill: char) -> String {
        format!("tn_01{}", fill.to_string().repeat(24))
    }

    fn request(token: &str, operator_id: Option<&str>, platform_id: Option<&str>) -> Request<Body> {
        let mut request = Request::builder()
            .uri("/v1/field/client-capabilities")
            .header(header::AUTHORIZATION, format!("Bearer {token}"));
        if let Some(operator_id) = operator_id {
            request = request.header("x-operator-id", operator_id);
        }
        if let Some(platform_id) = platform_id {
            request = request.header("x-platform-id", platform_id);
        }
        request.body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn missing_or_invalid_tenant_headers_return_400_without_upstream_call() {
        let (origin, calls, _) = spawn_fake_field(None).await;
        let app = app(origin);
        let operator = tenant_id('o');
        let platform = tenant_id('p');
        let malformed_operator = "operator-not-a-tenant-id";
        let malformed_platform = "tn_01UPPERCASE00000000000000";

        for request in [
            request(TOKEN_A, None, Some(&platform)),
            request(TOKEN_A, Some(&operator), None),
            request(TOKEN_A, Some(malformed_operator), Some(&platform)),
            request(TOKEN_A, Some(&operator), Some(malformed_platform)),
        ] {
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn field_permission_denied_is_returned_as_403() {
        let denied_operator = tenant_id('d');
        let platform = tenant_id('p');
        let (origin, calls, _) = spawn_fake_field(Some(denied_operator.clone())).await;

        let response = app(origin)
            .oneshot(request(TOKEN_A, Some(&denied_operator), Some(&platform)))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["error"], "upstream_client_error");
        assert_eq!(body["message"], "tenant is outside caller scope");
    }

    #[tokio::test]
    async fn sdk_configuration_is_request_scoped_without_credential_bleed() {
        let operator_a = tenant_id('a');
        let platform_a = tenant_id('b');
        let operator_b = tenant_id('c');
        let platform_b = tenant_id('d');
        let (origin, calls, requests) = spawn_fake_field(None).await;
        let app = app(origin);

        let (response_a, response_b) = tokio::join!(
            app.clone()
                .oneshot(request(TOKEN_A, Some(&operator_a), Some(&platform_a))),
            app.oneshot(request(TOKEN_B, Some(&operator_b), Some(&platform_b))),
        );
        let response_a = response_a.unwrap();
        let response_b = response_b.unwrap();
        assert_eq!(response_a.status(), StatusCode::OK);
        assert_eq!(response_b.status(), StatusCode::OK);
        assert_eq!(calls.load(Ordering::SeqCst), 2);

        let body_a = response_a.into_body().collect().await.unwrap().to_bytes();
        let body_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
        assert_eq!(body_a["agentDocuments"]["invoices"]["list"], true);
        assert_eq!(body_a["agentDocuments"]["quotations"]["send"], true);
        assert_eq!(body_a["cancellationFees"]["list"], true);
        assert_eq!(body_a["cancellationFees"]["manage"], false);
        assert_eq!(body_a["navigation"]["otherBusinessAccess"], false);

        let mut observed = requests.lock().unwrap().clone();
        observed.sort_by(|left, right| left.authorization.cmp(&right.authorization));
        assert_eq!(
            observed,
            vec![
                ObservedRequest {
                    authorization: format!("Bearer {TOKEN_A}"),
                    operator_id: operator_a,
                    platform_id: platform_a,
                },
                ObservedRequest {
                    authorization: format!("Bearer {TOKEN_B}"),
                    operator_id: operator_b,
                    platform_id: platform_b,
                },
            ]
        );
    }

    #[tokio::test]
    async fn capability_discovery_does_not_require_an_unrelated_course_action() {
        let operator = tenant_id('a');
        let platform = tenant_id('b');
        let (origin, calls, _) = spawn_fake_field(None).await;
        let response = app_with_rejecting_authorizer(origin)
            .oneshot(request(TOKEN_A, Some(&operator), Some(&platform)))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn fresh_policy_batch_uses_request_scope_and_preserves_field_aggregate() {
        let operator = tenant_id('a');
        let platform = tenant_id('b');
        let (origin, field_calls, _) = spawn_fake_field_with_aggregate(None, true).await;
        let checker = Arc::new(CapturingBatchChecker {
            calls: Arc::new(Mutex::new(Vec::new())),
            mode: BatchMode::DenyAll,
        });
        let checker_calls = checker.calls.clone();
        let checker_for_state: Arc<dyn PolicyBatchChecker> = checker;

        let response = app_with_navigation_policy_checker(origin, checker_for_state)
            .oneshot(request(TOKEN_A, Some(&operator), Some(&platform)))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(field_calls.load(Ordering::SeqCst), 1);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        // This remains Field's aggregate result. It must not be recomputed
        // from the per-action Course/Auth map (which is false here).
        assert_eq!(body["navigation"]["otherBusinessAccess"], true);
        assert_eq!(body["actions"]["field_extension_golf:ListTeeSheet"], false);

        let calls = checker_calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].bearer, TOKEN_A);
        assert_eq!(calls[0].operator_id, operator);
        assert_eq!(calls[0].platform_id, Some(platform));
        assert!(calls[0]
            .actions
            .iter()
            .any(|action| action == "field_extension_golf:ListTeeSheet"));
    }

    #[tokio::test]
    async fn fresh_policy_batch_auth_errors_reach_http_boundary() {
        let operator = tenant_id('a');
        let platform = tenant_id('b');
        let (origin, field_calls, _) = spawn_fake_field(None).await;

        for (mode, expected_status) in [
            (BatchMode::Unauthorized, StatusCode::UNAUTHORIZED),
            (BatchMode::TenantRejected, StatusCode::FORBIDDEN),
        ] {
            let checker = Arc::new(CapturingBatchChecker {
                calls: Arc::new(Mutex::new(Vec::new())),
                mode,
            });
            let checker_for_state: Arc<dyn PolicyBatchChecker> = checker;
            let response = app_with_navigation_policy_checker(origin.clone(), checker_for_state)
                .oneshot(request(TOKEN_A, Some(&operator), Some(&platform)))
                .await
                .unwrap();

            assert_eq!(response.status(), expected_status);
        }
        assert_eq!(field_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn explicit_disabled_authz_mode_reports_known_allowed_actions() {
        let operator = tenant_id('a');
        let platform = tenant_id('b');
        let (origin, _, _) = spawn_fake_field(None).await;
        let checker: Arc<dyn PolicyBatchChecker> = Arc::new(DisabledActionAuthorizationBatch);

        let response = app_with_navigation_policy_checker(origin, checker)
            .oneshot(request(TOKEN_A, Some(&operator), Some(&platform)))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["actions"]["field_extension_golf:ListTeeSheet"], true);
    }
}
