//! The one-shot move of imported reservation-report history off the legacy
//! Field extension config (ADR-0009): seed → verify → delete the legacy key.
//!
//! The data move itself needs nobody: the gateway seeds a tenant lazily right
//! before its first local import. What needs a deliberate call is the
//! verification and the deletion of `courseBoardReservationReport` — the one
//! key that gets an explicit deletion, because it dominates the config's size
//! and rides the hot-path payload on every extension-status read.
//!
//! This runs as a usecase rather than only as a command because a command
//! cannot reach production: the production database is PrivateLink-only and
//! the migration binary is not part of the Lambda package. Deleting the key
//! also needs a Field bearer, which the Lambda has none of on its own. The one
//! place where an in-VPC database connection and a Field bearer exist at the
//! same time is a request carrying an operator's own token, so the entry point
//! has to be an authenticated route.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::course::domain::{
    actions, CourseError, ExternalReservationReportEntry, GatewayCredentials, GolfCatalogGateway,
    ReservationReportMigrationGateway,
};

/// What the migration found and did, for the operator running it once.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReservationReportMigrationOutcome {
    /// Rows the legacy config still held when this ran.
    pub legacy_row_count: usize,
    /// Rows readable from CourseBoard's own table afterwards. May exceed the
    /// legacy count: imports after the seed land here only.
    pub local_row_count: usize,
    /// Rows copied in by this run. 0 when the tenant was already seeded.
    pub seeded_count: usize,
    /// Legacy rows that are not readable locally. Empty means verified.
    pub missing_row_count: usize,
    /// Whether the legacy key was removed by this run. `false` also covers
    /// "was already absent" and "deletion was not requested".
    pub config_key_deleted: bool,
}

impl ReservationReportMigrationOutcome {
    pub fn verified(&self) -> bool {
        self.missing_row_count == 0
    }
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

pub struct MigrateReservationReportsUseCase {
    gateway: Arc<dyn ReservationReportMigrationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl MigrateReservationReportsUseCase {
    pub fn new(
        gateway: Arc<dyn ReservationReportMigrationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self { gateway, catalog }
    }

    /// Seed, verify, and — only with `delete_config_key` and only after the
    /// verification passes — remove the legacy key. Safe to re-run: the seed
    /// is skipped once the tenant has rows, and deleting an absent key is a
    /// no-op.
    ///
    /// Returns the outcome even when the verification fails, with
    /// `missing_row_count` set and the legacy key untouched. Refusing the
    /// deletion is the caller's decision to report; this never deletes over a
    /// failed verification.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        delete_config_key: bool,
    ) -> Result<ReservationReportMigrationOutcome, CourseError> {
        credentials
            .require(actions::IMPORT_RESERVATION_REPORTS)
            .await?;
        if credentials.operator_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }

        // Unfiltered on purpose: inactive courses still own history, and a row
        // dropped here would read as "missing locally" and block the deletion.
        let courses = self.catalog.list_courses(credentials).await?;
        let legacy_entries = self
            .gateway
            .list_legacy_entries(credentials, &courses)
            .await?;
        let seeded_count = self
            .gateway
            .seed_from_legacy_if_unseeded(credentials, &courses)
            .await?;

        // Verify: every legacy row must be readable locally, field for field.
        let local_entries = self
            .gateway
            .list_local_entries(credentials, &courses)
            .await?;
        let local_set: BTreeSet<String> = local_entries.iter().map(fingerprint).collect();
        let missing: Vec<String> = legacy_entries
            .iter()
            .map(fingerprint)
            .filter(|row| !local_set.contains(row))
            .collect();

        let mut outcome = ReservationReportMigrationOutcome {
            legacy_row_count: legacy_entries.len(),
            local_row_count: local_entries.len(),
            seeded_count,
            missing_row_count: missing.len(),
            config_key_deleted: false,
        };

        if !missing.is_empty() {
            for row in missing.iter().take(10) {
                tracing::error!(row, "legacy reservation report row is not readable locally");
            }
            tracing::error!(
                tenant_id = credentials.operator_id,
                missing = missing.len(),
                legacy_rows = legacy_entries.len(),
                "reservation report verification failed; the legacy config key was NOT touched"
            );
            return Ok(outcome);
        }

        tracing::info!(
            tenant_id = credentials.operator_id,
            legacy_rows = legacy_entries.len(),
            local_rows = local_entries.len(),
            seeded = seeded_count,
            "reservation report verification passed: every legacy row is readable locally"
        );

        if delete_config_key {
            outcome.config_key_deleted = self.gateway.delete_legacy_config_key(credentials).await?;
            tracing::info!(
                tenant_id = credentials.operator_id,
                deleted = outcome.config_key_deleted,
                "legacy reservation report config key removed (false = already absent)"
            );
        }
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{
        Course, CourseId, CourseOrder, ProductSlot, ReservationProduct, ReservationReportDayPart,
        ReservationReportRow, ReservationServiceId, Resource, ResourceId, SaveCourseResource,
        UpsertCourse, UpsertReservationProduct,
    };
    use async_trait::async_trait;
    use chrono::NaiveDate;
    use std::sync::Mutex;

    fn entry(day: u32, groups: i64) -> ExternalReservationReportEntry {
        let row = ReservationReportRow::new(
            "OUT",
            "OUTコース",
            NaiveDate::from_ymd_opt(2026, 8, day).expect("valid date"),
            ReservationReportDayPart::Morning,
            groups,
            0,
        )
        .expect("valid row");
        ExternalReservationReportEntry::new(&row, None, "sha")
    }

    #[derive(Default)]
    struct FakeGateway {
        legacy: Vec<ExternalReservationReportEntry>,
        local: Mutex<Vec<ExternalReservationReportEntry>>,
        deleted: Mutex<bool>,
    }

    #[async_trait]
    impl ReservationReportMigrationGateway for FakeGateway {
        async fn list_legacy_entries(
            &self,
            _credentials: GatewayCredentials<'_>,
            _courses: &[Course],
        ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
            Ok(self.legacy.clone())
        }

        async fn list_local_entries(
            &self,
            _credentials: GatewayCredentials<'_>,
            _courses: &[Course],
        ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
            Ok(self.local.lock().expect("lock").clone())
        }

        async fn seed_from_legacy_if_unseeded(
            &self,
            _credentials: GatewayCredentials<'_>,
            _courses: &[Course],
        ) -> Result<usize, CourseError> {
            let mut local = self.local.lock().expect("lock");
            if !local.is_empty() {
                return Ok(0);
            }
            *local = self.legacy.clone();
            Ok(local.len())
        }

        async fn delete_legacy_config_key(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<bool, CourseError> {
            let mut deleted = self.deleted.lock().expect("lock");
            *deleted = true;
            Ok(true)
        }
    }

    /// The migration reads the course catalog and nothing else; every other
    /// method is unreachable so a new catalog call cannot slip in unnoticed.
    struct EmptyCatalog;

    #[async_trait]
    impl GolfCatalogGateway for EmptyCatalog {
        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            Ok(Vec::new())
        }

        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            unreachable!("the migration does not read the tenant timezone")
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unreachable!("the migration does not write courses")
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unreachable!("the migration does not write courses")
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            unreachable!("the migration does not write courses")
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            unreachable!("the migration does not read resources")
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<ResourceId, CourseError> {
            unreachable!("the migration does not write resources")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unreachable!("the migration does not write resources")
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            unreachable!("the migration does not read the course order")
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            _order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            unreachable!("the migration does not write the course order")
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            unreachable!("the migration does not read products")
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            unreachable!("the migration does not write products")
        }

        async fn list_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unreachable!("the migration does not read slots")
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unreachable!("the migration does not write slots")
        }
    }

    fn credentials<'a>() -> GatewayCredentials<'a> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer token",
            operator_id: "tn_test",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    async fn run(gateway: FakeGateway, delete: bool) -> ReservationReportMigrationOutcome {
        MigrateReservationReportsUseCase::new(Arc::new(gateway), Arc::new(EmptyCatalog))
            .execute(credentials(), delete)
            .await
            .expect("migration runs")
    }

    #[tokio::test]
    async fn seeds_verifies_and_deletes_the_legacy_key() {
        let outcome = run(
            FakeGateway {
                legacy: vec![entry(1, 3), entry(2, 4)],
                ..FakeGateway::default()
            },
            true,
        )
        .await;
        assert_eq!(outcome.legacy_row_count, 2);
        assert_eq!(outcome.seeded_count, 2);
        assert_eq!(outcome.local_row_count, 2);
        assert!(outcome.verified());
        assert!(outcome.config_key_deleted);
    }

    #[tokio::test]
    async fn leaves_the_key_alone_without_the_delete_flag() {
        let outcome = run(
            FakeGateway {
                legacy: vec![entry(1, 3)],
                ..FakeGateway::default()
            },
            false,
        )
        .await;
        assert!(outcome.verified());
        assert!(!outcome.config_key_deleted);
    }

    /// The whole point of the verification: a tenant already holding different
    /// rows locally is not seeded, so a legacy row can go unrepresented. The
    /// key must survive that.
    #[tokio::test]
    async fn refuses_to_delete_when_a_legacy_row_is_not_readable_locally() {
        let gateway = FakeGateway {
            legacy: vec![entry(1, 3), entry(2, 4)],
            local: Mutex::new(vec![entry(1, 3)]),
            ..FakeGateway::default()
        };
        let outcome = run(gateway, true).await;
        assert_eq!(outcome.missing_row_count, 1);
        assert!(!outcome.verified());
        assert!(!outcome.config_key_deleted);
    }

    /// Re-running after a completed migration must not re-seed or fail.
    #[tokio::test]
    async fn is_safe_to_re_run() {
        let gateway = FakeGateway {
            legacy: Vec::new(),
            local: Mutex::new(vec![entry(1, 3)]),
            ..FakeGateway::default()
        };
        let outcome = run(gateway, true).await;
        assert_eq!(outcome.legacy_row_count, 0);
        assert_eq!(outcome.seeded_count, 0);
        assert_eq!(outcome.local_row_count, 1);
        assert!(outcome.verified());
    }
}
