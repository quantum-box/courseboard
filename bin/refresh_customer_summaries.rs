//! Works out what everybody in a tenant's ledger has played and spent, and
//! keeps it, so the call list can be drawn instead of assembled by eye.
//!
//! A command rather than an endpoint because of what it costs upstream. Field's
//! reservation listing takes no date filter, offers no `updatedSince`, reports
//! no total, and clamps a page to 500 rows without saying so, so a lifetime
//! figure means reading the tenant's bookings from the newest backwards. That
//! is tens of pages for a real course — minutes, not the seconds an API request
//! has. The generic contract to ask Field for is an incremental listing; until
//! there is one, this is a batch.
//!
//! **This command cannot reach production.** The production database is on the
//! PrivateLink-only `tidb_courseboard_prod` cluster that only the in-VPC Lambda
//! can dial, and `tachyon.yaml` packages `lambda-courseboard` alone. Scheduling
//! the refresh in production is separate work; this binary is for local
//! databases and dev tenants.
//!
//! ```sh
//! DATABASE_URL=mysql://... \
//! TACHYON_FIELD_API_URL=https://tachyon-field-api.txcloud.app \
//! COURSEBOARD_REFRESH_BEARER=<cognito access token> \
//! COURSEBOARD_REFRESH_TENANT_ID=tn_... \
//! COURSEBOARD_REFRESH_PLATFORM_ID=tn_... \
//! cargo run --bin courseboard-refresh-customer-summaries
//! ```

use std::sync::Arc;

use anyhow::Context;
use courseboard::course::domain::GatewayCredentials;
use courseboard::course::infrastructure::{
    FieldReservationGateway, MySqlCustomerSummaryRepository, MySqlVisitCheckinRepository, ALLOW_ALL,
};
use courseboard::course::usecase::RefreshCustomerSummariesUseCase;

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
        .with_env_filter("courseboard=info,courseboard_refresh_customer_summaries=info")
        .init();

    let database_url = required_env("DATABASE_URL")?;
    let field_api_url = required_env("TACHYON_FIELD_API_URL")?;
    let bearer = required_env("COURSEBOARD_REFRESH_BEARER")?;
    let tenant_id = required_env("COURSEBOARD_REFRESH_TENANT_ID")?;
    let platform_id = std::env::var("COURSEBOARD_REFRESH_PLATFORM_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

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

    let outcome = RefreshCustomerSummariesUseCase::new(
        Arc::new(FieldReservationGateway::new(client, Some(&field_api_url))),
        Arc::new(MySqlVisitCheckinRepository::new(pool.clone())),
        Arc::new(MySqlCustomerSummaryRepository::new(pool)),
    )
    .execute(credentials, chrono::Utc::now())
    .await
    .map_err(|error| anyhow::anyhow!("refresh the customer summaries: {error}"))?;

    tracing::info!(
        reservations = outcome.reservations_scanned,
        checkins = outcome.checkins_scanned,
        customers = outcome.customers_written,
        "customer summaries refreshed"
    );
    if outcome.truncated {
        // Not an error: the run did everything it could reach, and every row it
        // wrote says the figures are a partial count. Worth saying out loud,
        // because it means nobody comes back graded.
        tracing::warn!(
            "the sweep reached its cap, so every summary is a partial count and carries no grade"
        );
    }
    Ok(())
}
