use std::sync::Arc;

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
use sqlx::{migrate::Migrator, FromRow, SqlitePool};
use thiserror::Error;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct AppState {
    rules: Arc<SqliteTaxRuleRepository>,
}

impl AppState {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            rules: Arc::new(SqliteTaxRuleRepository::new(pool)),
        }
    }
}

impl FromRef<AppState> for Arc<SqliteTaxRuleRepository> {
    fn from_ref(state: &AppState) -> Self {
        state.rules.clone()
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route(
            "/calculate",
            post(calculate).route_layer(middleware::from_fn(require_bearer_token)),
        )
        .with_state(state)
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    MIGRATOR.run(pool).await?;
    Ok(())
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn require_bearer_token(req: Request<Body>, next: Next) -> Result<Response, AppError> {
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
    #[error("authorization bearer token is required")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("tax rule was not found for tenant, prefecture, and course grade")]
    RuleNotFound,
    #[error("database error")]
    Database(#[from] sqlx::Error),
    #[error("migration error")]
    Migration(#[from] sqlx::migrate::MigrateError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
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
    use axum::http::{header::CONTENT_TYPE, Method};
    use http_body_util::BodyExt;
    use sqlx::sqlite::SqlitePoolOptions;
    use tower::ServiceExt;

    async fn test_app() -> Router {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect test sqlite");
        run_migrations(&pool).await.expect("run migrations");
        build_router(AppState::new(pool))
    }

    async fn calculate_with_players(players: serde_json::Value) -> CalculateResponse {
        let app = test_app().await;
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
                    .header(AUTHORIZATION, "Bearer test-token")
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
        let app = test_app().await;
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
}
