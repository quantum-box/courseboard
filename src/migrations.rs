use std::fmt::Write as _;

use anyhow::Context;
use sqlx::{
    migrate::{MigrateError, Migrator},
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
    FromRow, MySqlPool,
};
use thiserror::Error;

pub(crate) static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Connects to the configured database, validates the complete applied
/// migration history, and applies pending migrations.
///
/// This is deliberately a deploy/local preflight entry point. HTTP serving
/// initialization must not call it: a poisoned migration history should stop
/// the candidate deployment without taking the stable API down.
pub async fn run_migration_gate(database_url: &str) -> anyhow::Result<()> {
    let connect_options: MySqlConnectOptions = database_url
        .parse()
        .map_err(|error| anyhow::anyhow!("DATABASE_URL must be a valid MySQL URL: {error}"))?;
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .context("connect migration gate to DATABASE_URL")?;

    let result = run_migrations(&pool).await;
    pool.close().await;
    result.map_err(Into::into)
}

/// Runs SQLx's fail-loud validation and apply logic without weakening its
/// checksum comparison. On failure, the SQLx error is enriched with both the
/// database record and the migration embedded in this build.
pub async fn run_migrations(pool: &MySqlPool) -> Result<(), MigrationGateError> {
    run_migrations_with(pool, &MIGRATOR).await
}

async fn run_migrations_with(
    pool: &MySqlPool,
    migrator: &Migrator,
) -> Result<(), MigrationGateError> {
    if let Err(source) = migrator.run(pool).await {
        let diagnostic = migration_failure_diagnostic(pool, migrator, &source).await;
        return Err(MigrationGateError { source, diagnostic });
    }
    Ok(())
}

#[derive(Debug, Error)]
#[error("migration gate failed: {source}{diagnostic}")]
pub struct MigrationGateError {
    #[source]
    source: MigrateError,
    diagnostic: String,
}

#[derive(Debug, FromRow)]
struct AppliedMigrationRecord {
    description: String,
    checksum: Vec<u8>,
    success: bool,
}

async fn migration_failure_diagnostic(
    pool: &MySqlPool,
    migrator: &Migrator,
    error: &MigrateError,
) -> String {
    let Some(version) = migration_error_version(error) else {
        return String::new();
    };

    let recorded = sqlx::query_as::<_, AppliedMigrationRecord>(
        "SELECT description, checksum, success FROM _sqlx_migrations WHERE version = ?",
    )
    .bind(version)
    .fetch_optional(pool)
    .await;

    let recorded = match recorded {
        Ok(Some(record)) => format!(
            "description={:?}, checksum={}, success={}",
            record.description,
            checksum_hex(&record.checksum),
            record.success,
        ),
        Ok(None) => "<missing from _sqlx_migrations>".to_string(),
        Err(error) => format!("<could not read _sqlx_migrations: {error}>"),
    };
    let current = migrator
        .iter()
        .find(|migration| migration.version == version)
        .map(|migration| {
            format!(
                "description={:?}, checksum={}",
                migration.description,
                checksum_hex(&migration.checksum),
            )
        })
        .unwrap_or_else(|| "<missing from migrations embedded in this build>".to_string());

    format!(
        "\nmigration version: {version}\nrecorded in database: {recorded}\ncurrent file: {current}"
    )
}

fn migration_error_version(error: &MigrateError) -> Option<i64> {
    match error {
        MigrateError::ExecuteMigration(_, version)
        | MigrateError::VersionMissing(version)
        | MigrateError::VersionMismatch(version)
        | MigrateError::VersionNotPresent(version)
        | MigrateError::Dirty(version) => Some(*version),
        MigrateError::VersionTooOld(version, _) | MigrateError::VersionTooNew(version, _) => {
            Some(*version)
        }
        _ => None,
    }
}

fn checksum_hex(checksum: &[u8]) -> String {
    let mut encoded = String::with_capacity(checksum.len() * 2);
    for byte in checksum {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    use sqlx::mysql::MySqlConnectOptions;

    use super::*;
    use crate::config::{RuntimeConfig, EMPTY_COURSE_STORE_URL};

    static TEST_DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    const PRODUCTION_MIGRATION_GATE_CHECK: &str = "name: CourseBoard production migration gate";
    const TEMPORARY_RELEASE_CHECK_EXCEPTION: &str = "TEMPORARY (PLT-3438)";

    fn assert_production_migration_gate_release_policy(manifest: &str) {
        let gate_is_wired = manifest.contains(PRODUCTION_MIGRATION_GATE_CHECK);
        let temporary_exception_is_documented =
            manifest.contains(TEMPORARY_RELEASE_CHECK_EXCEPTION);

        // PLT-3438 temporarily permits deploys while the production migration
        // credential is being wired. Once that is complete, this marker must be
        // removed together with restoring the release check. Requiring one of
        // these two explicit states keeps a silent removal fail-closed.
        assert!(
            gate_is_wired || temporary_exception_is_documented,
            "production migration gate must be wired or explicitly exempted with {TEMPORARY_RELEASE_CHECK_EXCEPTION}"
        );
    }

    struct TestDatabase {
        admin_pool: MySqlPool,
        pool: MySqlPool,
        name: String,
    }

    impl TestDatabase {
        async fn create(test_name: &str) -> Self {
            let host = std::env::var("COURSEBOARD_TEST_DB_HOST")
                .unwrap_or_else(|_| "127.0.0.1".to_string());
            let port = std::env::var("COURSEBOARD_TEST_DB_PORT")
                .map(|value| {
                    value
                        .parse()
                        .expect("COURSEBOARD_TEST_DB_PORT must be a u16")
                })
                .unwrap_or(4000);
            let username =
                std::env::var("COURSEBOARD_TEST_DB_USER").unwrap_or_else(|_| "root".to_string());
            let sequence = TEST_DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let name = format!(
                "courseboard_plt3433_{}_{}_{}",
                std::process::id(),
                test_name,
                sequence,
            );

            let mut connect_options = MySqlConnectOptions::new()
                .host(&host)
                .port(port)
                .username(&username);
            if let Ok(password) = std::env::var("COURSEBOARD_TEST_DB_PASSWORD") {
                connect_options = connect_options.password(&password);
            }

            let admin_pool = MySqlPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(Duration::from_secs(60))
                .connect_with(connect_options.clone())
                .await
                .expect("connect test TiDB admin pool");
            sqlx::query(&format!(
                "CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            ))
            .execute(&admin_pool)
            .await
            .expect("create isolated migration test database");

            let pool = MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(60))
                .connect_with(connect_options.database(&name))
                .await
                .expect("connect isolated migration test database");

            Self {
                admin_pool,
                pool,
                name,
            }
        }

        async fn cleanup(self) {
            self.pool.close().await;
            sqlx::query(&format!("DROP DATABASE `{}`", self.name))
                .execute(&self.admin_pool)
                .await
                .expect("drop isolated migration test database");
            self.admin_pool.close().await;
        }
    }

    fn serving_config() -> RuntimeConfig {
        RuntimeConfig {
            database_url: "not-used-by-build_app_with_pool".to_string(),
            dev_bearer_token: Some("plt3433-test-token".to_string()),
            tachyon_auth_api_url: Some(EMPTY_COURSE_STORE_URL.to_string()),
            tachyon_field_api_url: Some(EMPTY_COURSE_STORE_URL.to_string()),
            ..RuntimeConfig::default()
        }
    }

    #[test]
    fn production_gate_does_not_cancel_an_earlier_commit_waiting_for_a_runner() {
        let workflow = include_str!("../.github/workflows/production-migration-gate.yml");
        let concurrency_group = workflow
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with("group:"))
            .expect("production workflow must declare a concurrency group");
        let cancel_in_progress = workflow
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with("cancel-in-progress:"))
            .expect("production workflow must declare cancellation behavior");

        assert_eq!(
            concurrency_group,
            "group: courseboard-production-migration-gate-${{ github.sha }}"
        );
        assert_eq!(cancel_in_progress, "cancel-in-progress: false");
        assert!(
            MIGRATOR.locking,
            "commit-scoped workflow concurrency relies on SQLx's target-DB advisory lock"
        );
    }

    #[test]
    fn migration_gate_is_wired_into_deploy_and_local_preflight_paths() {
        let manifest = include_str!("../tachyon.yaml");
        let workflow = include_str!("../.github/workflows/production-migration-gate.yml");
        let local_start = include_str!("../desktop/scripts/run-courseboard-with-env.sh");

        assert!(manifest.contains("name: migration-gate-before-activation"));
        assert_production_migration_gate_release_policy(manifest);
        assert!(workflow.contains("run: cargo run --bin courseboard-migrate"));
        assert!(workflow.contains(PRODUCTION_MIGRATION_GATE_CHECK));

        let migrate = local_start
            .find("cargo run --bin courseboard-migrate")
            .expect("local start must run the migration preflight");
        let serve = local_start
            .find("exec cargo run --bin courseboard")
            .expect("local start must launch the serving binary");
        assert!(migrate < serve, "local migration gate must precede serving");
    }

    #[test]
    fn documented_temporary_release_check_exception_is_allowed() {
        assert_production_migration_gate_release_policy(
            "production:\n  # TEMPORARY (PLT-3438): requiredReleaseChecks is disabled",
        );
    }

    #[test]
    #[should_panic(expected = "production migration gate must be wired or explicitly exempted")]
    fn silent_release_check_removal_is_rejected() {
        assert_production_migration_gate_release_policy("production:\n  watchPaths: []");
    }

    async fn poison_last_checksum(pool: &MySqlPool) -> (i64, String, String) {
        let migration = MIGRATOR
            .iter()
            .last()
            .expect("CourseBoard must have at least one migration");
        let recorded_checksum = vec![0xa5; migration.checksum.len()];
        assert_ne!(recorded_checksum, migration.checksum.as_ref());
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(&recorded_checksum)
            .bind(migration.version)
            .execute(pool)
            .await
            .expect("poison migration checksum");
        (
            migration.version,
            checksum_hex(&recorded_checksum),
            checksum_hex(&migration.checksum),
        )
    }

    #[tokio::test]
    async fn checksum_drift_fails_deploy_gate_but_not_serving_init() {
        let database = TestDatabase::create("drift").await;
        run_migrations(&database.pool)
            .await
            .expect("apply migrations before poisoning history");
        let (version, recorded_checksum, current_checksum) =
            poison_last_checksum(&database.pool).await;

        let _router = crate::build_app_with_pool(serving_config(), database.pool.clone())
            .await
            .expect("serving initialization must not validate migration history");

        let error = run_migrations(&database.pool)
            .await
            .expect_err("deploy migration gate must reject checksum drift");
        let message = error.to_string();
        assert!(message.contains(&format!("migration version: {version}")));
        assert!(message.contains("recorded in database: description="));
        assert!(message.contains(&recorded_checksum));
        assert!(message.contains("current file: description="));
        assert!(message.contains(&current_checksum));

        database.cleanup().await;
    }

    #[tokio::test]
    async fn correctly_migrated_database_still_starts_normally() {
        let database = TestDatabase::create("normal").await;
        run_migrations(&database.pool)
            .await
            .expect("deploy migration gate must accept and apply current migrations");

        let _router = crate::build_app_with_pool(serving_config(), database.pool.clone())
            .await
            .expect("normally migrated database must initialize serving");

        database.cleanup().await;
    }
}
