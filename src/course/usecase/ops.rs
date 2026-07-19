//! Caddie operations use cases (create/update + operational tooling).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    AttendanceSnapshotReport, AutoAssignResult, AvailabilityQuery, Caddie, CaddieAssignment,
    CaddieAvailability, CaddieCourseMembership, CaddieRating, CaddieRecommendation, CaddieSupply,
    CourseError, GatewayCredentials, GolfOpsGateway, PayrollSummary, RecommendationQuery,
    ReplaceCaddieMemberships, UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
};

macro_rules! ops_use_case {
    ($name:ident) => {
        pub struct $name {
            ops: Arc<dyn GolfOpsGateway>,
        }

        impl $name {
            pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
                Self { ops }
            }
        }
    };
}

ops_use_case!(CreateCaddieUseCase);
ops_use_case!(UpdateCaddieUseCase);
ops_use_case!(UpdateCaddieAssignmentUseCase);
ops_use_case!(ListCaddieMembershipsUseCase);
ops_use_case!(ReplaceCaddieMembershipsUseCase);
ops_use_case!(ListCaddieAvailabilitiesUseCase);
ops_use_case!(UpsertCaddieAvailabilityUseCase);
ops_use_case!(DeleteCaddieAvailabilityUseCase);
ops_use_case!(ListCaddieRecommendationsUseCase);
ops_use_case!(GetAttendanceSnapshotUseCase);
ops_use_case!(GetCaddieSupplyUseCase);
ops_use_case!(AutoAssignCaddiesUseCase);
ops_use_case!(GetPayrollSummaryUseCase);
ops_use_case!(ExportPayrollCsvUseCase);
ops_use_case!(ListCaddieRatingsUseCase);

impl CreateCaddieUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        self.ops.create_caddie(credentials, input).await
    }
}

impl UpdateCaddieUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        self.ops.update_caddie(credentials, caddie_id, input).await
    }
}

impl UpdateCaddieAssignmentUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        assignment_id: &str,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError> {
        self.ops
            .update_caddie_assignment(credentials, assignment_id, input)
            .await
    }
}

impl ListCaddieMembershipsUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
        self.ops
            .list_caddie_memberships(credentials, caddie_id)
            .await
    }
}

impl ReplaceCaddieMembershipsUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
        input: ReplaceCaddieMemberships,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
        self.ops
            .replace_caddie_memberships(credentials, caddie_id, input)
            .await
    }
}

impl ListCaddieAvailabilitiesUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: AvailabilityQuery,
    ) -> Result<Vec<CaddieAvailability>, CourseError> {
        self.ops
            .list_caddie_availabilities(credentials, query)
            .await
    }
}

impl UpsertCaddieAvailabilityUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddieAvailability,
    ) -> Result<CaddieAvailability, CourseError> {
        self.ops.upsert_caddie_availability(credentials, input).await
    }
}

impl DeleteCaddieAvailabilityUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
        date: NaiveDate,
    ) -> Result<(), CourseError> {
        self.ops
            .delete_caddie_availability(credentials, caddie_id, date)
            .await
    }
}

impl ListCaddieRecommendationsUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: RecommendationQuery,
    ) -> Result<Vec<CaddieRecommendation>, CourseError> {
        self.ops
            .list_caddie_recommendations(credentials, query)
            .await
    }
}

impl GetAttendanceSnapshotUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: Option<NaiveDate>,
    ) -> Result<AttendanceSnapshotReport, CourseError> {
        self.ops.get_attendance_snapshot(credentials, date).await
    }
}

impl GetCaddieSupplyUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        safety_buffer: Option<i64>,
    ) -> Result<CaddieSupply, CourseError> {
        self.ops
            .get_caddie_supply(credentials, date, safety_buffer)
            .await
    }
}

impl AutoAssignCaddiesUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError> {
        self.ops
            .auto_assign_caddies(credentials, date, dry_run)
            .await
    }
}

impl GetPayrollSummaryUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<PayrollSummary, CourseError> {
        self.ops.get_payroll_summary(credentials, year_month).await
    }
}

impl ExportPayrollCsvUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        self.ops.export_payroll_csv(credentials, year_month).await
    }
}

impl ListCaddieRatingsUseCase {
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: Option<&str>,
    ) -> Result<Vec<CaddieRating>, CourseError> {
        self.ops.list_caddie_ratings(credentials, caddie_id).await
    }
}
