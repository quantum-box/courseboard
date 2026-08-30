//! One-shot migration of the imported reservation-report history from the
//! legacy Field extension config into CourseBoard's own table (ADR-0009).
//!
//! seed → verify → (optionally) delete the legacy config key, one way, no
//! dual-write. The app also seeds lazily on a tenant's first import, so this
//! command exists to migrate proactively and to run the verified deletion of
//! the legacy key — the one key that gets an explicit deletion because it
//! rides the hot-path payload.
//!
//! **This command cannot reach production.** The production database is on the
//! PrivateLink-only `tidb_courseboard_prod` cluster, which only the in-VPC
//! Lambda can dial, and `tachyon.yaml` packages `lambda-courseboard` alone, so
//! this binary is not deployed. For production, call
//! `POST /v1/course/reservation-report-migration` with an operator bearer —
//! same usecase, same seed → verify → delete, reachable. This binary stays for
//! local databases and dev tenants.
//!
//! ```sh
//! DATABASE_URL=mysql://... \
//! TACHYON_FIELD_API_URL=https://tachyon-field-api.txcloud.app \
//! COURSEBOARD_MIGRATE_BEARER=<cognito access token> \
//! COURSEBOARD_MIGRATE_TENANT_ID=tn_... \
//! COURSEBOARD_MIGRATE_PLATFORM_ID=tn_... \
//! cargo run --bin courseboard-migrate-reservation-reports
//! ```
//!
//! Set `COURSEBOARD_MIGRATE_DELETE_CONFIG_KEY=1` to remove the legacy key
//! after a successful verification. Without it the command only seeds and
//! verifies, and is safe to re-run.

use std::sync::Arc;

use anyhow::{bail, Context};
use courseboard::course::domain::GatewayCredentials;
use courseboard::course::infrastructure::{
    FieldGolfCatalogGateway, FieldReservationReportGateway, MigratingReservationReportGateway,
    ALLOW_ALL,
};
use courseboard::course::usecase::MigrateReservationReportsUseCase;

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{name} must be set"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter("courseboard=info,courseboard_migrate_reservation_reports=info")
        .init();

    let database_url = required_env("DATABASE_URL")?;
    let field_api_url = required_env("TACHYON_FIELD_API_URL")?;
    let bearer = required_env("COURSEBOARD_MIGRATE_BEARER")?;
    let tenant_id = required_env("COURSEBOARD_MIGRATE_TENANT_ID")?;
    let platform_id = std::env::var("COURSEBOARD_MIGRATE_PLATFORM_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let delete_config_key = std::env::var("COURSEBOARD_MIGRATE_DELETE_CONFIG_KEY")
        .is_ok_and(|value| matches!(value.trim(), "1" | "true"));

    let authorization = if bearer.starts_with("Bearer ") {
        bearer
    } else {
        format!("Bearer {bearer}")
    };
    let credentials = GatewayCredentials {
        authorization: &authorization,
        caller_bearer: &authorization,
        operator_id: &tenant_id,
        platform_id: platform_id.as_deref(),
        authorizer: &ALLOW_ALL,
    };

    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .context("connect to the CourseBoard database")?;
    let client = reqwest::Client::new();
    let catalog = Arc::new(FieldGolfCatalogGateway::new(
        client.clone(),
        Some(&field_api_url),
    ));
    let gateway = Arc::new(MigratingReservationReportGateway::new(
        pool,
        Arc::new(FieldReservationReportGateway::new(
            client,
            Some(&field_api_url),
        )),
    ));

    let outcome = MigrateReservationReportsUseCase::new(gateway, catalog)
        .execute(credentials, delete_config_key)
        .await
        .map_err(|error| anyhow::anyhow!("migrate the reservation reports: {error}"))?;

    // The usecase already logged the per-row detail and never deletes over a
    // failed verification; turn that into a non-zero exit for the operator.
    if !outcome.verified() {
        bail!(
            "{} of {} legacy rows are not readable locally; the legacy config key was NOT touched",
            outcome.missing_row_count,
            outcome.legacy_row_count
        );
    }
    if delete_config_key {
        tracing::info!(
            deleted = outcome.config_key_deleted,
            "legacy reservation report config key removed (false = already absent)"
        );
    } else {
        tracing::info!(
            "legacy config key left in place; re-run with \
             COURSEBOARD_MIGRATE_DELETE_CONFIG_KEY=1 to remove it after this verification"
        );
    }
    Ok(())
}
