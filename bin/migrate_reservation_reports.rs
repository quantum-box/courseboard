//! One-shot migration of the imported reservation-report history from the
//! legacy Field extension config into CourseBoard's own table (ADR-0009).
//!
//! seed → verify → (optionally) delete the legacy config key, one way, no
//! dual-write. The app also seeds lazily on a tenant's first import, so this
//! command exists to migrate proactively and to run the verified deletion of
//! the legacy key — the one key that gets an explicit deletion because it
//! rides the hot-path payload.
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

use std::collections::BTreeSet;
use std::sync::Arc;

use anyhow::{bail, Context};
use courseboard::course::domain::{
    ExternalReservationReportEntry, GatewayCredentials, GolfCatalogGateway,
    ReservationReportEntryQuery, ReservationReportGateway,
};
use courseboard::course::infrastructure::{
    FieldGolfCatalogGateway, FieldReservationReportGateway, MySqlReservationReportRepository,
    ALLOW_ALL,
};

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{name} must be set"))
}

/// The identity of a row, independent of which store held it.
fn fingerprint(entry: &ExternalReservationReportEntry) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        entry.source_course_key(),
        entry.source_course_name(),
        entry
            .golf_course_id()
            .map(|id| id.as_str())
            .unwrap_or("<unlinked>"),
        entry.date(),
        entry.day_part().as_str(),
        entry.group_count(),
        entry.caddie_attached_group_count(),
        entry.source_file_sha256(),
    )
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
    let local = MySqlReservationReportRepository::new(pool);
    let client = reqwest::Client::new();
    let catalog = FieldGolfCatalogGateway::new(client.clone(), Some(&field_api_url));
    let legacy = Arc::new(FieldReservationReportGateway::new(
        client,
        Some(&field_api_url),
    ));

    let courses = catalog
        .list_courses(credentials)
        .await
        .map_err(|error| anyhow::anyhow!("list courses from Field: {error}"))?;
    tracing::info!(tenant_id, courses = courses.len(), "course catalog loaded");

    let unbounded = ReservationReportEntryQuery {
        from: None,
        to: None,
    };
    let legacy_entries = legacy
        .list_entries(credentials, &courses, unbounded)
        .await
        .map_err(|error| anyhow::anyhow!("read the legacy config rows: {error}"))?;
    tracing::info!(rows = legacy_entries.len(), "legacy config rows read");

    if local
        .has_rows(&tenant_id)
        .await
        .map_err(|error| anyhow::anyhow!("check whether the tenant is already seeded: {error}"))?
    {
        tracing::info!("tenant already has local rows; skipping the seed and verifying");
    } else if legacy_entries.is_empty() {
        tracing::info!("nothing to migrate: the legacy store holds no rows for this tenant");
    } else {
        let seeded = local
            .seed(&tenant_id, &legacy_entries)
            .await
            .map_err(|error| anyhow::anyhow!("seed the local table: {error}"))?;
        tracing::info!(seeded, "local table seeded");
    }

    // Verify: every legacy row must be readable locally, field for field.
    // (The local store may legitimately hold more — imports after the seed.)
    let local_entries = local
        .list(&tenant_id, &courses, unbounded)
        .await
        .map_err(|error| anyhow::anyhow!("read the local rows back: {error}"))?;
    let local_set: BTreeSet<String> = local_entries.iter().map(fingerprint).collect();
    let missing: Vec<&ExternalReservationReportEntry> = legacy_entries
        .iter()
        .filter(|entry| !local_set.contains(&fingerprint(entry)))
        .collect();
    if !missing.is_empty() {
        for entry in missing.iter().take(10) {
            tracing::error!(
                row = fingerprint(entry),
                "legacy row is not readable locally"
            );
        }
        bail!(
            "{} of {} legacy rows are not readable locally; the legacy config key was NOT touched",
            missing.len(),
            legacy_entries.len()
        );
    }
    tracing::info!(
        legacy_rows = legacy_entries.len(),
        local_rows = local_entries.len(),
        "verification passed: every legacy row is readable locally"
    );

    if delete_config_key {
        let deleted = legacy
            .delete_report_config_key(credentials)
            .await
            .map_err(|error| anyhow::anyhow!("delete the legacy config key: {error}"))?;
        if deleted {
            tracing::info!("legacy reservation report config key deleted");
        } else {
            tracing::info!("legacy reservation report config key was already absent");
        }
    } else {
        tracing::info!(
            "legacy config key left in place; re-run with \
             COURSEBOARD_MIGRATE_DELETE_CONFIG_KEY=1 to remove it after this verification"
        );
    }

    Ok(())
}
