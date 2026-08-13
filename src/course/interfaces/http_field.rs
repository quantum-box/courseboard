//! Axum handler for SDK-backed TACHYON Field operations.

use std::sync::Arc;

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
use crate::{AppError, AppState, COURSEBOARD_AUTHORIZATION_HEADER};

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilitiesResponse {
    pub agent_documents: AgentDocumentCapabilitiesResponse,
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

impl From<FieldClientCapabilities> for ClientCapabilitiesResponse {
    fn from(value: FieldClientCapabilities) -> Self {
        Self {
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
    let capabilities = use_case.execute(context).await.map_err(AppError::from)?;
    Ok(Json(ClientCapabilitiesResponse::from(capabilities)))
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
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

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
    use crate::{build_router, AppState};

    const TOKEN_A: &str = "fixture-access-token-a";
    const TOKEN_B: &str = "fixture-access-token-b";

    #[derive(Clone)]
    struct FixtureTokenVerifier;

    impl TokenVerifier for FixtureTokenVerifier {
        fn verify(&self, token: &str) -> Result<AuthenticatedPrincipal, AuthError> {
            if matches!(token, TOKEN_A | TOKEN_B) {
                Ok(AuthenticatedPrincipal {
                    issuer: "fixture".to_string(),
                    subject: Some("fixture-user".to_string()),
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

    #[derive(Clone)]
    struct FakeFieldState {
        calls: Arc<AtomicUsize>,
        requests: Arc<Mutex<Vec<ObservedRequest>>>,
        denied_operator: Option<String>,
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
            "agentDocuments": {
                "invoices": {"list": true, "send": false},
                "quotations": {"list": false, "send": true}
            }
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
}
