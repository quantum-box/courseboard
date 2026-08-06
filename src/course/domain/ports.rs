use async_trait::async_trait;
use chrono::NaiveDate;

use super::{
    AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AutoAssignResult,
    AvailabilityQuery, BudgetAchievement, Caddie, CaddieAssignment, CaddieAssignmentQuery,
    CaddieAvailability, CaddieCourseMembership, CaddieId, CaddieRating, CaddieRecommendation,
    CaddieRoster, CaddieStaff, Course, CourseError, CourseId, DailyBudget, DailyBudgetQuery,
    ExtensionStatus, MonthlySettlement, ProductSlot, RecommendationQuery, ReplaceCaddieMemberships,
    Reservation, ReservationPolicy, ReservationProduct, ReservationServiceId, Resource,
    TaxRuleSnapshot, UpdateExtensionConfig, UpdateReservationPolicy, UpsertCaddie,
    UpsertCaddieAssignment, UpsertCaddieAvailability, UpsertCourse, UpsertDailyBudget,
    UpsertReservationProduct, WorkedMinutes,
};

/// Credentials forwarded from the inbound HTTP request to outbound Field calls.
///
/// Domain/usecase never construct Field URLs; they only pass opaque auth context.
#[derive(Debug, Clone, Copy)]
pub struct GatewayCredentials<'a> {
    pub authorization: &'a str,
    pub operator_id: &'a str,
    pub platform_id: Option<&'a str>,
}

/// Port for tenant golf course tax rules.
///
/// CourseBoard owns this data (`golf_tax_rules` / `golf_grade_thresholds`);
/// the port exists so simulation use cases stay free of storage concerns.
#[async_trait]
pub trait GolfTaxGateway: Send + Sync {
    /// Resolve the tax rule whose green-fee bracket contains `green_fee`.
    async fn find_rule_by_green_fee(
        &self,
        tenant_id: &str,
        prefecture: &str,
        green_fee: i64,
    ) -> Result<Option<TaxRuleSnapshot>, CourseError>;

    /// The rule for the grade the prefecture assigned this course.
    ///
    /// Preferred over the green-fee lookup: which grade a course is put in is
    /// the prefecture's decision, not something the fee implies.
    async fn find_rule_by_grade(
        &self,
        tenant_id: &str,
        prefecture: &str,
        course_grade: &str,
    ) -> Result<Option<TaxRuleSnapshot>, CourseError>;
}

#[derive(Debug, Clone)]
pub struct TeeSheetQuery {
    pub date: NaiveDate,
    pub golf_course_id: Option<CourseId>,
}

/// Port for listing generic ERP reservations used by the tee-sheet.
#[async_trait]
pub trait ReservationGateway: Send + Sync {
    async fn list_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Reservation>, CourseError>;
}

/// Port for golf catalog (courses, resources, reservation products).
///
/// Implementations may call Field golf-course extension APIs; those paths must
/// stay inside the infrastructure gateway only.
#[async_trait]
pub trait GolfCatalogGateway: Send + Sync {
    async fn list_courses(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Course>, CourseError>;

    async fn create_course(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCourse,
    ) -> Result<Course, CourseError>;

    async fn update_course(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        input: UpsertCourse,
    ) -> Result<Course, CourseError>;

    async fn delete_course(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
    ) -> Result<(), CourseError>;

    async fn list_resources(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Resource>, CourseError>;

    async fn list_reservation_products(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<ReservationProduct>, CourseError>;

    async fn upsert_reservation_product(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertReservationProduct,
    ) -> Result<ReservationProduct, CourseError>;

    async fn list_product_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &ReservationServiceId,
    ) -> Result<Vec<ProductSlot>, CourseError>;

    async fn replace_product_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &ReservationServiceId,
        slots: Vec<ProductSlot>,
    ) -> Result<Vec<ProductSlot>, CourseError>;
}

/// Port for caddie roster, assignments, and operational tooling.
#[async_trait]
pub trait GolfOpsGateway: Send + Sync {
    async fn list_caddie_roster(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieRoster, CourseError>;

    /// Register an HRM staff member.
    ///
    /// A caddie is one role a staff member holds, so creating a caddie for
    /// someone the HRM master does not know yet has to register them first.
    async fn create_staff(
        &self,
        credentials: GatewayCredentials<'_>,
        name: &str,
    ) -> Result<CaddieStaff, CourseError>;

    async fn create_caddie(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError>;

    async fn update_caddie(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError>;

    async fn list_caddie_assignments(
        &self,
        credentials: GatewayCredentials<'_>,
        query: CaddieAssignmentQuery,
    ) -> Result<Vec<CaddieAssignment>, CourseError>;

    async fn update_caddie_assignment(
        &self,
        credentials: GatewayCredentials<'_>,
        assignment_id: &AssignmentId,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError>;

    async fn list_caddie_memberships(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError>;

    async fn replace_caddie_memberships(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        input: ReplaceCaddieMemberships,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError>;

    async fn list_caddie_availabilities(
        &self,
        credentials: GatewayCredentials<'_>,
        query: AvailabilityQuery,
    ) -> Result<Vec<CaddieAvailability>, CourseError>;

    async fn upsert_caddie_availability(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddieAvailability,
    ) -> Result<CaddieAvailability, CourseError>;

    async fn delete_caddie_availability(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        date: NaiveDate,
    ) -> Result<(), CourseError>;

    async fn list_caddie_recommendations(
        &self,
        credentials: GatewayCredentials<'_>,
        query: RecommendationQuery,
    ) -> Result<Vec<CaddieRecommendation>, CourseError>;

    async fn get_attendance_snapshot(
        &self,
        credentials: GatewayCredentials<'_>,
        date: Option<NaiveDate>,
    ) -> Result<AttendanceSnapshotReport, CourseError>;

    async fn list_attendance_period_snapshots(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError>;

    /// Worked and rostered minutes for every staff member in one calendar month.
    ///
    /// Keyed by staff id, since the minutes come from the staff record rather
    /// than the caddie profile.
    async fn list_worked_minutes(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<std::collections::HashMap<String, WorkedMinutes>, CourseError>;

    async fn auto_assign_caddies(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError>;

    async fn export_payroll_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError>;

    async fn list_caddie_ratings(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: Option<&CaddieId>,
    ) -> Result<Vec<CaddieRating>, CourseError>;
}

/// Port for budgets, settlement, reservation policy, and extension config.
#[async_trait]
pub trait GolfCommercialGateway: Send + Sync {
    async fn get_reservation_policy(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<ReservationPolicy, CourseError>;

    async fn update_reservation_policy(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateReservationPolicy,
    ) -> Result<ReservationPolicy, CourseError>;

    async fn list_daily_budgets(
        &self,
        credentials: GatewayCredentials<'_>,
        query: DailyBudgetQuery,
    ) -> Result<Vec<DailyBudget>, CourseError>;

    async fn upsert_daily_budget(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertDailyBudget,
    ) -> Result<DailyBudget, CourseError>;

    async fn import_daily_budgets_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        csv: &str,
    ) -> Result<Vec<DailyBudget>, CourseError>;

    async fn list_budget_achievements(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<BudgetAchievement>, CourseError>;

    async fn get_monthly_settlement(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<MonthlySettlement, CourseError>;

    async fn export_monthly_settlement_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError>;

    async fn get_extension_status(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<ExtensionStatus>, CourseError>;

    async fn update_extension_config(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateExtensionConfig,
    ) -> Result<(), CourseError>;
}
