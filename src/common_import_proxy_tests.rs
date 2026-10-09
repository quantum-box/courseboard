use super::*;
use crate::{
    auth::StaticBearerVerifier,
    cancellation_fees::CancellationFeeConfig,
    course::domain::{CourseAuthorizer, CourseError},
};
use axum::{extract::State, routing::any, Json, Router};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Capture {
    requests: Mutex<Vec<(String, HeaderMap, Value)>>,
}
async fn upstream_capture(
    State(capture): State<Arc<Capture>>,
    request: Request<Body>,
) -> Response<Body> {
    let path = request.uri().path().to_owned();
    let headers = request.headers().clone();
    let body = to_bytes(request.into_body(), 5 * 1024 * 1024)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    capture
        .requests
        .lock()
        .unwrap()
        .push((path.clone(), headers, body));
    if path.contains("/document-original/") {
        return Response::builder()
            .header("content-type", "application/pdf")
            .header("cache-control", "no-store")
            .body(Body::from(vec![b'x'; 8 * 1024 * 1024 + 1]))
            .unwrap();
    }
    let json = if path.ends_with("dtj_foreign") {
        Json(
            json!({"kind":"import","objectKey":"customer","importOptions":{"sourceApp":"another-app"}}),
        )
    } else if path.ends_with("dtj_document") {
        Json(
            json!({"kind":"document","objectKey":"courseboardReservationReports","importOptions":{"sourceApp":"courseboard"},"status":"review"}),
        )
    } else {
        Json(
            json!({"kind":"import","objectKey":"customer","importOptions":{"sourceApp":"courseboard"},"status":"ready"}),
        )
    };
    json.into_response()
}

#[tokio::test]
async fn reservation_document_bff_preserves_revision_and_authorizes_every_operation() {
    let (state, capture, authorizer, server) = state(true).await;
    for operation in ["document-read", "document-validate", "document-confirm"] {
        let body =
            json!({"manifestSha256":"original","revisionVersion":2,"revisionSha256":"reviewed"});
        proxy(
            State(state.clone()),
            Path(format!("jobs/dtj_document/{operation}")),
            request(Method::POST, body.clone()),
        )
        .await
        .unwrap();
        let calls = capture.requests.lock().unwrap();
        let forwarded = calls.last().unwrap();
        assert_eq!(
            forwarded.0,
            format!("/v1/bridge/data-jobs/dtj_document/{operation}")
        );
        assert_eq!(forwarded.1["authorization"], "Bearer current-user");
        assert_eq!(forwarded.1["x-operator-id"], "tenant-a");
        assert_eq!(forwarded.1["x-platform-id"], "platform-a");
        assert_eq!(forwarded.2, body);
    }
    let original = proxy(
        State(state),
        Path("jobs/dtj_document/document-original/0".into()),
        request(Method::GET, Value::Null),
    )
    .await
    .unwrap();
    assert_eq!(original.headers()["content-type"], "application/pdf");
    assert_eq!(original.headers()["cache-control"], "no-store");
    assert_eq!(
        to_bytes(original.into_body(), 64 * 1024 * 1024)
            .await
            .unwrap()
            .len(),
        8 * 1024 * 1024 + 1,
        "originals above the ordinary JSON limit remain viewable"
    );
    assert_eq!(
        authorizer.calls.lock().unwrap().as_slice(),
        [actions::IMPORT_RESERVATION_REPORTS; 4]
    );
    assert_eq!(
        capture.requests.lock().unwrap().last().unwrap().0,
        "/v1/bridge/data-jobs/dtj_document/document-original/0"
    );
    server.abort();
}
struct Authorizer {
    allow: bool,
    calls: Mutex<Vec<String>>,
}
#[async_trait::async_trait]
impl CourseAuthorizer for Authorizer {
    async fn require(
        &self,
        credentials: GatewayCredentials<'_>,
        action: &'static str,
    ) -> Result<(), CourseError> {
        assert_eq!(credentials.authorization, "Bearer current-user");
        assert_eq!(credentials.caller_bearer, credentials.authorization);
        assert_eq!(credentials.operator_id, "tenant-a");
        assert_eq!(credentials.platform_id, Some("platform-a"));
        self.calls.lock().unwrap().push(action.into());
        if self.allow {
            Ok(())
        } else {
            Err(CourseError::Forbidden("denied"))
        }
    }
}
async fn state(
    allow: bool,
) -> (
    AppState,
    Arc<Capture>,
    Arc<Authorizer>,
    tokio::task::JoinHandle<()>,
) {
    let capture = Arc::new(Capture::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/*path", any(upstream_capture))
        .with_state(capture.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .connect_lazy("mysql://root@127.0.0.1/not_used")
        .unwrap();
    let authorizer = Arc::new(Authorizer {
        allow,
        calls: Mutex::new(Vec::new()),
    });
    let state = AppState::new_with_cancellation_fee_config(
        pool,
        Arc::new(StaticBearerVerifier::new("unused".into())),
        CancellationFeeConfig {
            field_api_url: Some(format!("http://{address}")),
            ..Default::default()
        },
    )
    .with_course_authorizer(authorizer.clone());
    (state, capture, authorizer, server)
}
fn request(method: Method, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri("/v1/course/data-imports/objects/customer/imports/preview")
        .header("authorization", "Bearer current-user")
        .header("x-operator-id", "tenant-a")
        .header("x-platform-id", "platform-a")
        .body(Body::from(body.to_string()))
        .unwrap()
}
#[tokio::test]
async fn common_import_bff_forwards_current_identity_and_server_binds_origin() {
    let (state, capture, authorizer, server) = state(true).await;
    proxy(
        State(state),
        Path("objects/customer/imports/preview".into()),
        request(
            Method::POST,
            json!({"importOptions":{"sourceApp":"forged"},"contentBase64":"bmFtZQo="}),
        ),
    )
    .await
    .unwrap();
    let calls = capture.requests.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].0,
        "/v1/bridge/data-objects/customer/imports/preview"
    );
    assert_eq!(calls[0].1["authorization"], "Bearer current-user");
    assert_eq!(calls[0].1["x-operator-id"], "tenant-a");
    assert_eq!(calls[0].1["x-platform-id"], "platform-a");
    assert_eq!(calls[0].2["importOptions"]["sourceApp"], "courseboard");
    assert_eq!(
        *authorizer.calls.lock().unwrap(),
        vec![actions::MANAGE_CUSTOMERS]
    );
    server.abort();
}
#[tokio::test]
async fn common_import_bff_denies_unowned_jobs_and_missing_business_grants() {
    let (state, capture, _, server) = state(false).await;
    assert!(matches!(
        proxy(
            State(state),
            Path("objects/customer/imports/preview".into()),
            request(Method::POST, json!({}))
        )
        .await,
        Err(AppError::ActionForbidden("denied"))
    ));
    assert!(capture.requests.lock().unwrap().is_empty());
    server.abort();
    let (state, capture, _, server) = self::state(true).await;
    assert!(matches!(
        proxy(
            State(state),
            Path("jobs/dtj_foreign/advance".into()),
            request(Method::POST, json!({}))
        )
        .await,
        Err(AppError::NotFound("import job is unavailable"))
    ));
    assert_eq!(capture.requests.lock().unwrap().len(), 1);
    server.abort();
}

#[tokio::test]
async fn document_link_preserves_its_strict_body_and_current_credentials() {
    let (state, capture, authorizer, server) = state(true).await;
    proxy(
        State(state),
        Path("objects/customerReception/imports/document-link".into()),
        request(Method::POST, json!({"ocrJobId":"goj_existing"})),
    )
    .await
    .unwrap();
    let calls = capture.requests.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].0,
        "/v1/bridge/data-objects/customerReception/imports/document-link"
    );
    assert_eq!(calls[0].2, json!({"ocrJobId":"goj_existing"}));
    assert_eq!(calls[0].1["authorization"], "Bearer current-user");
    assert_eq!(calls[0].1["x-platform-id"], "platform-a");
    assert_eq!(
        *authorizer.calls.lock().unwrap(),
        vec![actions::MANAGE_CUSTOMERS]
    );
    server.abort();
}
