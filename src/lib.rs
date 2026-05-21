use std::{env, sync::Arc};

pub mod auth;

use auth::{AuthError, TokenVerifier};
use axum::{
    body::Body,
    extract::{FromRef, State},
    http::{header::AUTHORIZATION, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{migrate::Migrator, FromRow, SqlitePool};
use thiserror::Error;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct AppState {
    rules: Arc<SqliteTaxRuleRepository>,
    token_verifier: Arc<dyn TokenVerifier>,
}

impl AppState {
    pub fn new(pool: SqlitePool, token_verifier: Arc<dyn TokenVerifier>) -> Self {
        Self {
            rules: Arc::new(SqliteTaxRuleRepository::new(pool)),
            token_verifier,
        }
    }
}

impl FromRef<AppState> for Arc<SqliteTaxRuleRepository> {
    fn from_ref(state: &AppState) -> Self {
        state.rules.clone()
    }
}

impl FromRef<AppState> for Arc<dyn TokenVerifier> {
    fn from_ref(state: &AppState) -> Self {
        state.token_verifier.clone()
    }
}

pub fn build_router(state: AppState) -> Router {
    let auth_state = state.clone();
    Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/calculate",
            post(calculate).route_layer(middleware::from_fn_with_state(
                auth_state,
                require_valid_token,
            )),
        )
        .with_state(state)
}

pub async fn build_app_from_env() -> anyhow::Result<Router> {
    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://tachyonfield-golf.db".to_string());
    let connect_options: SqliteConnectOptions = database_url
        .parse()
        .map_err(|error| anyhow::anyhow!("DATABASE_URL must be a valid SQLite URL: {error}"))?;
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            connect_options
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal),
        )
        .await?;

    run_migrations(&pool).await?;

    let auth_config = auth::AuthConfig::from_env()?;
    let token_verifier = auth::OidcJwtVerifier::discover(auth_config).await?;
    let state = AppState::new(pool, Arc::new(token_verifier));

    Ok(build_router(state))
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    MIGRATOR.run(pool).await?;
    Ok(())
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn require_valid_token(
    State(verifier): State<Arc<dyn TokenVerifier>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let Some(value) = req.headers().get(AUTHORIZATION) else {
        return Err(AppError::Unauthorized);
    };
    let Ok(value) = value.to_str() else {
        return Err(AppError::Unauthorized);
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return Err(AppError::Unauthorized);
    };
    if token.trim().is_empty() {
        return Err(AppError::Unauthorized);
    }
    verifier.verify(token).map_err(AppError::from)?;

    Ok(next.run(req).await)
}

async fn calculate(
    State(rules): State<Arc<SqliteTaxRuleRepository>>,
    Json(request): Json<CalculateRequest>,
) -> Result<Json<CalculateResponse>, AppError> {
    if request.players.is_empty() {
        return Err(AppError::BadRequest(
            "players must contain at least one player",
        ));
    }

    let rule = rules
        .find_rule(
            &request.tenant_id,
            &request.prefecture,
            &request.course_grade,
        )
        .await?
        .ok_or(AppError::RuleNotFound)?;

    let mut tax_amount = 0;
    let breakdown = request
        .players
        .iter()
        .enumerate()
        .map(|(player_index, player)| {
            let reason = exemption_reason(player, &rule);
            let exempt = reason.is_some();
            let fee = if exempt { 0 } else { rule.fee };
            tax_amount += fee;

            PlayerBreakdown {
                player_index,
                fee,
                exempt,
                reason,
            }
        })
        .collect();

    Ok(Json(CalculateResponse {
        tax_amount,
        breakdown,
    }))
}

fn exemption_reason(player: &Player, rule: &TaxRule) -> Option<String> {
    if player.age < rule.minor_exempt_under_age {
        return Some("minor".to_string());
    }
    if player.age >= rule.senior_exempt_min_age {
        return Some("senior".to_string());
    }
    if rule.disability_cert_exempt && player.has_disability_cert {
        return Some("disability_cert".to_string());
    }

    None
}

#[derive(Clone)]
pub struct SqliteTaxRuleRepository {
    pool: SqlitePool,
}

impl SqliteTaxRuleRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn find_rule(
        &self,
        tenant_id: &str,
        prefecture: &str,
        course_grade: &str,
    ) -> Result<Option<TaxRule>, AppError> {
        let rule = sqlx::query_as::<_, TaxRule>(
            r#"
            SELECT
                tenant_id,
                prefecture,
                course_grade,
                fee,
                minor_exempt_under_age,
                senior_exempt_min_age,
                disability_cert_exempt
            FROM golf_tax_rules
            WHERE tenant_id = ?1
              AND prefecture = ?2
              AND course_grade = ?3
            "#,
        )
        .bind(tenant_id)
        .bind(prefecture)
        .bind(course_grade)
        .fetch_optional(&self.pool)
        .await?;

        Ok(rule)
    }
}

#[derive(Debug, FromRow)]
struct TaxRule {
    fee: i64,
    minor_exempt_under_age: i64,
    senior_exempt_min_age: i64,
    disability_cert_exempt: bool,
}

#[derive(Debug, Deserialize)]
pub struct CalculateRequest {
    pub tenant_id: String,
    pub prefecture: String,
    pub course_grade: String,
    pub players: Vec<Player>,
}

#[derive(Debug, Deserialize)]
pub struct Player {
    pub age: i64,
    pub has_disability_cert: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CalculateResponse {
    pub tax_amount: i64,
    pub breakdown: Vec<PlayerBreakdown>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlayerBreakdown {
    pub player_index: usize,
    pub fee: i64,
    pub exempt: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: &'static str,
    message: String,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("authorization failed")]
    Unauthorized,
    #[error("authenticated client is not authorized")]
    Forbidden,
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("tax rule was not found for tenant, prefecture, and course grade")]
    RuleNotFound,
    #[error("database error")]
    Database(#[from] sqlx::Error),
    #[error("migration error")]
    Migration(#[from] sqlx::migrate::MigrateError),
}

impl From<AuthError> for AppError {
    fn from(value: AuthError) -> Self {
        match value {
            AuthError::UnauthorizedClient => AppError::Forbidden,
            AuthError::MissingToken
            | AuthError::MalformedToken
            | AuthError::MissingKeyId
            | AuthError::UnknownKeyId
            | AuthError::InvalidToken
            | AuthError::InvalidIssuedAt => AppError::Unauthorized,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::RuleNotFound => (StatusCode::NOT_FOUND, "rule_not_found"),
            AppError::Database(_) | AppError::Migration(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_server_error")
            }
        };

        let body = Json(ErrorResponse {
            error,
            message: self.to_string(),
        });
        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{AuthConfig, Jwk, Jwks, OidcJwtVerifier};
    use axum::http::{header::CONTENT_TYPE, Method};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use http_body_util::BodyExt;
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    use rand::rngs::OsRng;
    use rsa::{pkcs1::EncodeRsaPrivateKey, traits::PublicKeyParts, RsaPrivateKey};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::collections::HashSet;
    use tower::ServiceExt;

    async fn test_app(auth: &TestAuth) -> Router {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect test sqlite");
        run_migrations(&pool).await.expect("run migrations");
        build_router(AppState::new(pool, Arc::new(auth.verifier())))
    }

    async fn calculate_with_players(players: serde_json::Value) -> CalculateResponse {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let body = serde_json::json!({
            "tenant_id": "scc",
            "prefecture": "hokkaido",
            "course_grade": "A",
            "players": players
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/calculate")
                    .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn taxable_adult_pays_hokkaido_fee() {
        let response = calculate_with_players(
            serde_json::json!([{ "age": 42, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(
            response,
            CalculateResponse {
                tax_amount: 400,
                breakdown: vec![PlayerBreakdown {
                    player_index: 0,
                    fee: 400,
                    exempt: false,
                    reason: None,
                }],
            }
        );
    }

    #[tokio::test]
    async fn minor_is_exempt_in_hokkaido() {
        let response = calculate_with_players(
            serde_json::json!([{ "age": 17, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(response.tax_amount, 0);
        assert_eq!(response.breakdown[0].reason.as_deref(), Some("minor"));
    }

    #[tokio::test]
    async fn age_70_is_exempt_in_hokkaido() {
        let response = calculate_with_players(
            serde_json::json!([{ "age": 70, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(response.tax_amount, 0);
        assert_eq!(response.breakdown[0].reason.as_deref(), Some("senior"));
    }

    #[tokio::test]
    async fn disability_certificate_is_exempt_in_hokkaido() {
        let response =
            calculate_with_players(serde_json::json!([{ "age": 42, "has_disability_cert": true }]))
                .await;

        assert_eq!(response.tax_amount, 0);
        assert_eq!(
            response.breakdown[0].reason.as_deref(),
            Some("disability_cert")
        );
    }

    #[tokio::test]
    async fn mixed_players_total_only_counts_taxable_players() {
        let response = calculate_with_players(serde_json::json!([
            { "age": 42, "has_disability_cert": false },
            { "age": 17, "has_disability_cert": false },
            { "age": 70, "has_disability_cert": false },
            { "age": 55, "has_disability_cert": true },
            { "age": 69, "has_disability_cert": false }
        ]))
        .await;

        assert_eq!(response.tax_amount, 800);
        assert_eq!(response.breakdown.len(), 5);
        assert_eq!(response.breakdown[0].fee, 400);
        assert_eq!(response.breakdown[4].fee, 400);
    }

    #[tokio::test]
    async fn bearer_token_is_required() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/calculate")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "tenant_id": "scc",
                            "prefecture": "hokkaido",
                            "course_grade": "A",
                            "players": [{ "age": 42, "has_disability_cert": false }]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn malformed_token_is_rejected() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request("Bearer not-a-jwt", "scc"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn valid_jwks_signed_token_is_accepted() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!("Bearer {}", auth.valid_token()),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn wrong_audience_is_rejected() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with("test-issuer", "wrong-audience", "field-core")
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_issuer_is_rejected() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with(
                        "https://wrong-issuer.example",
                        "tachyonfield-golf",
                        "field-core"
                    )
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_client_id_is_forbidden() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with("test-issuer", "tachyonfield-golf", "other-client")
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    fn calculate_request(authorization: &str, tenant_id: &str) -> Request<Body> {
        Request::builder()
            .method(Method::POST)
            .uri("/calculate")
            .header(AUTHORIZATION, authorization)
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "tenant_id": tenant_id,
                    "prefecture": "hokkaido",
                    "course_grade": "A",
                    "players": [{ "age": 42, "has_disability_cert": false }]
                })
                .to_string(),
            ))
            .unwrap()
    }

    struct TestAuth {
        private_key: RsaPrivateKey,
    }

    impl TestAuth {
        fn new() -> Self {
            Self {
                private_key: RsaPrivateKey::new(&mut OsRng, 2048).unwrap(),
            }
        }

        fn verifier(&self) -> OidcJwtVerifier {
            let public_key = self.private_key.to_public_key();
            OidcJwtVerifier::from_jwks(
                AuthConfig {
                    issuer_url: "test-issuer".to_string(),
                    expected_audience: "tachyonfield-golf".to_string(),
                    expected_client_ids: HashSet::from(["field-core".to_string()]),
                },
                Jwks {
                    keys: vec![Jwk {
                        kty: "RSA".to_string(),
                        kid: Some("test-key".to_string()),
                        n: b64url(&public_key.n().to_bytes_be()),
                        e: b64url(&public_key.e().to_bytes_be()),
                        alg: Some("RS256".to_string()),
                        key_use: Some("sig".to_string()),
                    }],
                },
            )
        }

        fn valid_token(&self) -> String {
            self.token_with("test-issuer", "tachyonfield-golf", "field-core")
        }

        fn token_with(&self, issuer: &str, audience: &str, client_id: &str) -> String {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let claims = serde_json::json!({
                "iss": issuer,
                "sub": client_id,
                "aud": audience,
                "iat": now,
                "nbf": now.saturating_sub(10),
                "exp": now + 300,
                "client_id": client_id,
                "azp": client_id
            });
            let mut header = Header::new(Algorithm::RS256);
            header.kid = Some("test-key".to_string());
            let private_key_der = self.private_key.to_pkcs1_der().unwrap();

            encode(
                &header,
                &claims,
                &EncodingKey::from_rsa_der(private_key_der.as_bytes()),
            )
            .unwrap()
        }
    }

    fn b64url(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(bytes)
    }
}
