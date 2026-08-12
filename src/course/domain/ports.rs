use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};

use super::{
    AssignMembershipPlan, AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport,
    AutoAssignResult, AvailabilityDeadline, AvailabilityQuery, AvailabilityRule, BookingHorizon,
    BudgetAchievement, Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
    CaddieCourseMembership, CaddieId, CaddieRankFees, CaddieRating, CaddieRecommendation,
    CaddieRoster, CaddieShift, CaddieStaff, Course, CourseError, CourseId, CourseOrder, Customer,
    CustomerId, CustomerMembership, CustomerSearchQuery, DailyBudget, DailyBudgetQuery,
    DeleteSlotOverrides, ExtensionStatus, GenerationSummary, InventoryWatermark, MembershipPlan,
    MembershipPlanId, MonthlySettlement, NewCustomer, NewReservation, PartyDetails, ProductSlot,
    RecommendationQuery, ReplaceCaddieMemberships, Reservation, ReservationCourseAnswer,
    ReservationCourseLink, ReservationDaySummary, ReservationId, ReservationPolicy,
    ReservationProduct, ReservationServiceId, ReservationSummaryQuery, ReservationSummaryWindow,
    Resource, ResourceId, ResourceTimeSlot, SaveCourseResource, SeededReservation, ShiftPolicy,
    SlotOverride, SlotOverrideQuery, TaxRuleSnapshot, UpdateExtensionConfig,
    UpdateReservationPolicy, UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
    UpsertCourse, UpsertDailyBudget, UpsertMembershipPlan, UpsertReservationProduct, WorkedMinutes,
    YearMonth,
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
    /// Last day to include, when the caller wants more than `date`.
    ///
    /// Staffing is planned ahead, and the groups still missing a caddie are
    /// asked for a fortnight at a time rather than one day at a time. Absent —
    /// or before `date` — means the single day the board has always answered.
    pub to: Option<NaiveDate>,
    pub golf_course_id: Option<CourseId>,
}

impl TeeSheetQuery {
    /// The days this query covers, in order.
    pub fn dates(&self) -> Vec<NaiveDate> {
        let last = self.to.filter(|to| *to > self.date).unwrap_or(self.date);
        let mut dates = Vec::new();
        let mut day = self.date;
        while day <= last && dates.len() < MAX_TEE_SHEET_DAYS {
            dates.push(day);
            let Some(next) = day.succ_opt() else { break };
            day = next;
        }
        dates
    }
}

/// How many days one tee-sheet request may cover.
///
/// Long enough for the fortnight the desk staffs ahead, short enough that a
/// mistyped range cannot ask for a year of boards in one call.
const MAX_TEE_SHEET_DAYS: usize = 31;

#[derive(Debug, Clone)]
pub struct TeeLedgerQuery {
    pub date: NaiveDate,
    /// Which courses get a column. Empty means every active course.
    ///
    /// A list rather than one id because the desk works several courses side by
    /// side and picks which ones are on the board — a single filter can only
    /// answer "this one" or "all of them", and neither is the usual case.
    pub golf_course_ids: Vec<CourseId>,
}

impl TeeLedgerQuery {
    pub fn includes(&self, course_id: &CourseId) -> bool {
        self.golf_course_ids.is_empty() || self.golf_course_ids.contains(course_id)
    }
}

/// Port for the desk's own marks on individual tee times.
///
/// Field generates tee-time inventory but exposes no write API for one slot, so
/// "closed on this Saturday only" is CourseBoard's data to keep (ADR-0005).
#[async_trait]
pub trait SlotOverrideGateway: Send + Sync {
    async fn list_slot_overrides(
        &self,
        tenant_id: &str,
        query: &SlotOverrideQuery,
    ) -> Result<Vec<SlotOverride>, CourseError>;

    /// Replaces the mark on each named tee time, leaving the rest of the day
    /// alone. Re-marking a slot that is already marked changes it rather than
    /// adding a second mark.
    async fn upsert_slot_overrides(
        &self,
        tenant_id: &str,
        overrides: &[SlotOverride],
    ) -> Result<Vec<SlotOverride>, CourseError>;

    async fn delete_slot_overrides(
        &self,
        tenant_id: &str,
        command: &DeleteSlotOverrides,
    ) -> Result<u64, CourseError>;
}

/// Port for the daily reservation counts imported from the club's booking
/// system.
///
/// The booking system exports counts per course per half-day and nothing
/// finer — no start times, no per-booking caddie flag (PLT-3247) — so these
/// cannot be Field reservations consuming tee-time inventory. They are
/// CourseBoard's own series (ADR-0005), the same reasoning as
/// [`SlotOverrideGateway`].
#[async_trait]
pub trait ReservationSummaryGateway: Send + Sync {
    async fn list_reservation_summaries(
        &self,
        tenant_id: &str,
        query: &ReservationSummaryQuery,
    ) -> Result<Vec<ReservationDaySummary>, CourseError>;

    /// Make `window` hold exactly `summaries` and nothing else.
    ///
    /// A replace rather than an upsert. The club re-exports the same month all
    /// month long, so the same half-day arrives again and again — and a file
    /// that stops reporting one (an unreadable count, a course renamed out of
    /// the match) has to take the old number with it. Writing only what is
    /// present would leave last week's count standing on a half-day this
    /// week's file says nothing about.
    async fn replace_reservation_summaries(
        &self,
        tenant_id: &str,
        window: &ReservationSummaryWindow,
        summaries: &[ReservationDaySummary],
        source_file: Option<&str>,
    ) -> Result<u64, CourseError>;
}

/// Port for how far each course's tee-time inventory has been built.
///
/// Field generates the slots but reports only counts, never a date, so the
/// watermark that makes a daily top-up cheap is CourseBoard's own data
/// (ADR-0005) — the same reasoning as [`SlotOverrideGateway`].
#[async_trait]
pub trait GeneratedThroughGateway: Send + Sync {
    /// The watermark per course. A course absent from the map has never been
    /// built, which is different from having been built through a past date.
    async fn list_watermarks(
        &self,
        tenant_id: &str,
    ) -> Result<HashMap<CourseId, InventoryWatermark>, CourseError>;

    async fn set_watermark(
        &self,
        tenant_id: &str,
        course_id: &CourseId,
        watermark: InventoryWatermark,
    ) -> Result<(), CourseError>;
}

/// Port for the desk's answers about which course a name in the booking
/// system's export refers to.
///
/// Guessing from the name works for the club this was built from and cannot be
/// relied on for the next one, so the answers are kept. Field's course master
/// carries no external identifier, and naming is the golf anti-corruption
/// layer, so they are CourseBoard's (ADR-0005).
#[async_trait]
pub trait ReservationCourseLinkGateway: Send + Sync {
    async fn list_course_links(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<ReservationCourseLink>, CourseError>;

    /// Record the desk's answers. Each replaces whatever that name said before.
    ///
    /// "Do not import" is stored rather than represented by absence, so the
    /// import can tell a decision from a name nobody has looked at yet — and
    /// taking an answer back is therefore its own thing, which removes the row
    /// and puts the name back among the questions.
    async fn save_course_links(
        &self,
        tenant_id: &str,
        answers: &[ReservationCourseAnswer],
        updated_by: Option<&str>,
    ) -> Result<Vec<ReservationCourseLink>, CourseError>;
}

/// Port for each tenant's shift-request filing deadline, one per calendar
/// month. Field's shift-request API carries no notion of a deadline, so this
/// is CourseBoard's own data (ADR-0005), the same reasoning as
/// [`SlotOverrideGateway`].
#[async_trait]
pub trait AvailabilityDeadlineGateway: Send + Sync {
    async fn get_deadline(
        &self,
        tenant_id: &str,
        year_month: YearMonth,
    ) -> Result<Option<AvailabilityDeadline>, CourseError>;

    async fn upsert_deadline(
        &self,
        tenant_id: &str,
        deadline: AvailabilityDeadline,
    ) -> Result<AvailabilityDeadline, CourseError>;
}

/// Port for the club's own shift-planning rules.
///
/// The law fixes one ceiling; the rest — which weekdays to keep clear, how many
/// rounds a day, how much rest a month, how to read a day nobody filed for —
/// are the club's own operating decisions, and Field has nowhere to hold them
/// (ADR-0005).
#[async_trait]
pub trait ShiftRulesGateway: Send + Sync {
    /// Never absent: a tenant that has set nothing gets the statutory limits
    /// and the weekend held back, which is what a golf club wants until it
    /// says otherwise.
    async fn get_shift_policy(&self, tenant_id: &str) -> Result<ShiftPolicy, CourseError>;

    async fn upsert_shift_policy(
        &self,
        tenant_id: &str,
        policy: &ShiftPolicy,
    ) -> Result<ShiftPolicy, CourseError>;
}

/// Port for the confirmed shifts a month was planned into.
///
/// Field holds the shift *request* but has nowhere to record which course a
/// caddie works — that placement is a golf dispatch decision (ADR-0005), so
/// the confirmed month is CourseBoard's own data, like the filing deadline
/// that gates it.
#[async_trait]
pub trait CaddieShiftGateway: Send + Sync {
    async fn list_shifts(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CaddieShift>, CourseError>;

    /// Write a planned month. Days absent from `shifts` are left alone, so a
    /// run over one month never disturbs the months around it.
    async fn save_shifts(
        &self,
        tenant_id: &str,
        shifts: &[CaddieShift],
    ) -> Result<u64, CourseError>;

    async fn get_shift(
        &self,
        tenant_id: &str,
        caddie_id: &CaddieId,
        date: NaiveDate,
    ) -> Result<Option<CaddieShift>, CourseError>;
}

/// Port for the generic reservation schedule and the inventory it generates.
///
/// Field owns these as resource-level APIs; a golf course reaches them through
/// the resource it is mapped to. Keeping the port resource-shaped means the
/// translation from "course" lives in one place, the use case.
#[async_trait]
pub trait ReservationScheduleGateway: Send + Sync {
    async fn get_resource_schedule(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
    ) -> Result<Vec<AvailabilityRule>, CourseError>;

    /// Replaces the whole week. Rules left out are retired by Field.
    async fn replace_resource_schedule(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        timezone: &str,
        rules: &[AvailabilityRule],
    ) -> Result<Vec<AvailabilityRule>, CourseError>;

    async fn generate_resource_time_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        from: NaiveDate,
        to: NaiveDate,
        dry_run: bool,
    ) -> Result<GenerationSummary, CourseError>;

    /// The generated tee-time rows for one resource inside a time window.
    ///
    /// This is the ledger's inventory: every row exists whether or not anything
    /// is booked into it, which is exactly what an availability list cannot say.
    ///
    /// The window is instants rather than dates because a course's day is local
    /// and Field's bound is UTC; `from` is inclusive and `to` exclusive, so one
    /// JST day is midnight to the next midnight without an off-by-one slot.
    async fn list_resource_time_slots(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<ResourceTimeSlot>, CourseError>;
}

/// Port for listing generic ERP reservations used by the tee-sheet.
#[async_trait]
pub trait ReservationGateway: Send + Sync {
    async fn list_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Reservation>, CourseError>;

    /// One booking by id.
    ///
    /// Listing the day to find a single row is what the tee sheet does; a case
    /// that only needs the booking it was handed should not pay for it.
    async fn get_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
    ) -> Result<Reservation, CourseError>;

    /// Change which plan a booking is sold under.
    ///
    /// The plan decides how long the round takes, so the end time moves with
    /// it and the caller passes the one it computed. Unlike the party write
    /// this leaves `customFields` alone: the group detail is not what changed,
    /// and sending the object back would risk losing what is in it.
    async fn update_reservation_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        service_id: &ReservationServiceId,
        ends_at: DateTime<Utc>,
    ) -> Result<(), CourseError>;

    /// Replaces the group detail CourseBoard keeps on one reservation.
    ///
    /// Field stores custom fields as one object and a write replaces all of it,
    /// so implementations must read the current object and merge rather than
    /// send only the golf keys — `golfCourseId` lives in the same object and a
    /// naive write would move the booking off its course.
    async fn update_reservation_party(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        party: &PartyDetails,
    ) -> Result<PartyDetails, CourseError>;

    /// Reservation type ids the tenant has.
    ///
    /// Field requires one on every booking and offers no way to create one, so
    /// the seed can only use what the tenant already has — and has to say so
    /// plainly when there is nothing to use.
    async fn list_reservation_type_ids(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<String>, CourseError>;

    /// Bookings a previous seed run wrote, by their seed key.
    async fn list_seeded_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<SeededReservation>, CourseError>;

    async fn create_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &NewReservation,
    ) -> Result<ReservationId, CourseError>;

    /// Cancel a booking.
    ///
    /// `reason` is carried for the day Field can store one; today's cancel
    /// endpoint takes no body, so it is recorded in the call and dropped
    /// upstream rather than silently pretended to be saved (PLT-3297).
    async fn cancel_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        reason: Option<&str>,
    ) -> Result<(), CourseError>;

    /// Move an already-seeded booking back onto the demo day.
    ///
    /// Separate from create so a re-run updates in place: the demo is meant to
    /// be re-runnable without the board filling up with yesterday's copies.
    async fn replace_reservation(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        input: &NewReservation,
    ) -> Result<(), CourseError>;
}

/// Port for the customer ledger Field keeps for the tenant.
///
/// The ledger is not golf data and CourseBoard stores none of it (ADR-0005).
/// What CourseBoard owns is which ledger entry a booking and each player in a
/// group belong to, and the golf meaning that identity carries.
#[async_trait]
pub trait CustomerGateway: Send + Sync {
    /// Candidates matching what the desk typed.
    ///
    /// Candidates, not an answer: several people share a name and a household
    /// shares a phone number. Implementations must not merge or dedupe — which
    /// row is the right person is the desk's call, and guessing it wrong
    /// attaches someone else's visit history to a booking.
    async fn search_customers(
        &self,
        credentials: GatewayCredentials<'_>,
        query: &CustomerSearchQuery,
    ) -> Result<Vec<Customer>, CourseError>;

    async fn get_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<Customer, CourseError>;

    /// Adds a person to the ledger exactly as asked.
    ///
    /// No find-or-create: the caller has already been shown the candidates and
    /// decided this is somebody new. Folding that decision into the write would
    /// silently hand back an existing stranger's identity.
    async fn create_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &NewCustomer,
    ) -> Result<Customer, CourseError>;
}

/// Port for the tenant's membership registry in Field.
///
/// Field owns the plans and the assignments; what is golf here is only the
/// reading of them — that an active assignment means "member" and its absence
/// means "visitor" (see `membership`).
#[async_trait]
pub trait MembershipGateway: Send + Sync {
    /// Plans the tenant sells. Inactive ones are included only when asked for,
    /// so a retired plan stops being offered on new bookings while the members
    /// already holding it keep reading as members.
    async fn list_membership_plans(
        &self,
        credentials: GatewayCredentials<'_>,
        include_inactive: bool,
    ) -> Result<Vec<MembershipPlan>, CourseError>;

    async fn create_membership_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &UpsertMembershipPlan,
    ) -> Result<MembershipPlan, CourseError>;

    async fn update_membership_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        plan_id: &MembershipPlanId,
        input: &UpsertMembershipPlan,
    ) -> Result<MembershipPlan, CourseError>;

    /// Where one customer stands today.
    ///
    /// A customer with no membership record is a visitor, not a missing row:
    /// implementations answer `CustomerMembership::visitor` rather than an
    /// error, because the desk asks this about everyone who books.
    async fn get_customer_membership(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<CustomerMembership, CourseError>;

    async fn assign_membership_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &AssignMembershipPlan,
    ) -> Result<CustomerMembership, CourseError>;
}

/// Port for golf catalog (courses, resources, reservation products).
///
/// Implementations may call Field golf-course extension APIs; those paths must
/// stay inside the infrastructure gateway only.
#[async_trait]
pub trait GolfCatalogGateway: Send + Sync {
    /// Tenant-wide timezone from the golf extension config.
    ///
    /// Course master timezone remains in the upstream schema for rollback, but
    /// must not be used as an operational setting after SCC-6.
    async fn get_tenant_timezone(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<String, CourseError>;

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

    /// Create the generic reservation resource a course books against.
    ///
    /// Schedules and inventory live on the generic reservation module, so a
    /// course with no resource has nowhere to keep its tee times. Returns the
    /// new resource's id.
    async fn create_reservation_resource(
        &self,
        credentials: GatewayCredentials<'_>,
        name: &str,
    ) -> Result<ResourceId, CourseError>;

    /// Write the course ↔ resource mapping, creating the row if it is new.
    async fn save_course_resource(
        &self,
        credentials: GatewayCredentials<'_>,
        input: SaveCourseResource,
    ) -> Result<Resource, CourseError>;

    /// Left-to-right column order for the ledger.
    ///
    /// Tenant-scoped: the order groups go out in is the club's, so every
    /// operator's board reads the same way.
    async fn get_course_order(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CourseOrder, CourseError>;

    async fn replace_course_order(
        &self,
        credentials: GatewayCredentials<'_>,
        order: &CourseOrder,
    ) -> Result<CourseOrder, CourseError>;

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

    /// Put a caddie on a round.
    ///
    /// The plan behind a booking decides whether it is played with a caddie, and
    /// that plan is CourseBoard's — so who takes which round is worked out here
    /// and written through this, rather than asked of the upstream.
    async fn create_caddie_assignment(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError>;

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

    /// Memberships for several caddies at once, keyed by caddie id.
    ///
    /// Field answers memberships one caddie at a time, but planning a month
    /// and finding who can be sent to a short course both need the whole
    /// roster's. Batching it here keeps the fan-out in the adapter, where the
    /// transport that forces it lives.
    async fn list_memberships_for(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_ids: &[CaddieId],
    ) -> Result<HashMap<String, Vec<CaddieCourseMembership>>, CourseError>;

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
        timezone: &str,
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

    /// What one round pays at each rank.
    ///
    /// Tenant-scoped and CourseBoard's own: Field grades no one and pays by no
    /// grade, so the table is kept in the golf extension config rather than in
    /// a shared ERP column (ADR-0005).
    async fn get_caddie_rank_fees(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieRankFees, CourseError>;

    async fn replace_caddie_rank_fees(
        &self,
        credentials: GatewayCredentials<'_>,
        fees: &CaddieRankFees,
    ) -> Result<CaddieRankFees, CourseError>;

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
        timezone: &str,
    ) -> Result<Vec<BudgetAchievement>, CourseError>;

    async fn get_monthly_settlement(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
        timezone: &str,
    ) -> Result<MonthlySettlement, CourseError>;

    async fn export_monthly_settlement_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
        timezone: &str,
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

    /// How far ahead the club sells tee times.
    ///
    /// Tenant-scoped and CourseBoard's own: Field's policy only counts
    /// backwards from the tee time, so the forward window is kept in the golf
    /// extension config (ADR-0005).
    async fn get_booking_horizon(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<BookingHorizon, CourseError>;

    async fn set_booking_horizon(
        &self,
        credentials: GatewayCredentials<'_>,
        horizon: &BookingHorizon,
    ) -> Result<BookingHorizon, CourseError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, day).expect("date")
    }

    fn query(to: Option<NaiveDate>) -> TeeSheetQuery {
        TeeSheetQuery {
            date: day(18),
            to,
            golf_course_id: None,
        }
    }

    #[test]
    fn no_end_asks_for_the_one_day() {
        assert_eq!(query(None).dates(), vec![day(18)]);
    }

    #[test]
    fn an_end_asks_for_every_day_up_to_it() {
        assert_eq!(
            query(Some(day(20))).dates(),
            vec![day(18), day(19), day(20)]
        );
    }

    #[test]
    fn an_end_before_the_start_is_the_one_day() {
        // A backwards range is a typo, not a request for nothing.
        assert_eq!(query(Some(day(10))).dates(), vec![day(18)]);
    }

    #[test]
    fn a_long_range_stops_at_a_month() {
        let dates = TeeSheetQuery {
            date: day(1),
            to: NaiveDate::from_ymd_opt(2027, 7, 1),
            golf_course_id: None,
        }
        .dates();
        assert_eq!(dates.len(), MAX_TEE_SHEET_DAYS);
        assert_eq!(dates[0], day(1));
    }
}
