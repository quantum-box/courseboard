use std::{env, net::SocketAddr};

use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::sync::Arc;
use tachyonfield_golf::{
    auth::{AuthConfig, OidcJwtVerifier},
    build_router, run_migrations, AppState,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tachyonfield_golf=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://tachyonfield-golf.db".to_string());
    let connect_options: SqliteConnectOptions = database_url
        .parse()
        .context("DATABASE_URL must be a valid SQLite URL")?;
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            connect_options
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal),
        )
        .await
        .context("connect to SQLite")?;

    run_migrations(&pool).await?;

    let auth_config = AuthConfig::from_env().context("load Tachyon Auth OIDC config")?;
    let token_verifier = OidcJwtVerifier::discover(auth_config)
        .await
        .context("initialize Tachyon Auth OIDC verifier")?;
    let state = AppState::new(pool, Arc::new(token_verifier));
    let app = build_router(state);
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .context("BIND_ADDR must be host:port")?;

    tracing::info!(%addr, "starting tachyonfield-golf");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("bind listener")?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("serve HTTP")?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
