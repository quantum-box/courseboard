use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};

use super::{
    AssignMembershipPlan, AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport,
    AvailabilityDeadline, AvailabilityQuery, AvailabilityRule, BookingHorizon, Caddie,
    CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability, CaddieCourseMembership,
    CaddieDutyAssignment, CaddieDutyOptions, CaddieId, CaddieRankFees, CaddieRating, CaddieRoster,
    CaddieShift, CaddieStaff, Course, CourseError, CourseId, CourseOrder,
    CreateCustomerConsentItem, Customer, CustomerConsentItem, CustomerGradeRules, CustomerId,
    CustomerMembership, CustomerReceptionField, CustomerRegistration, CustomerSearchQuery,
    CustomerSummary, CustomerSummaryQuery, CustomerSummaryRun, CustomerSummaryRunStatus,
    DailyBudget, DailyBudgetQuery, DefaultWorkingHours, DeleteSlotOverrides, ExtensionStatus,
    FieldClientCapabilities, FieldRequestContext, FieldShiftLink, GenerationSummary,
    GolfPricingSettings, InventoryWatermark, MembershipActivityPage, MembershipActivityQuery,
    MembershipDiscounts, MembershipPlan, MembershipPlanId, MembershipPlayWindows,
    MonthlySettlement, NewCustomer, NewCustomerRegistration, NewReservation, PartyDetails,
    PlayerTagOptions, ProductSlot, ReceptionConsentAnswer, ReceptionConsentDefinition,
    ReceptionCustomerInput, ReceptionDraft, ReceptionFormProposal, ReceptionSheet,
    ReplaceCaddieMemberships, Reservation, ReservationBookingUpdate, ReservationId,
    ReservationPolicy, ReservationProduct, ReservationServiceId, Resource, ResourceId,
    ResourceTimeSlot, SaveCourseResource, SeededReservation, SetMemberNumber, ShiftPolicy,
    SlotOverride, SlotOverrideQuery, TaxRuleSnapshot, UnsyncedShift, UpdateExtensionConfig,
    UpdateReservationPolicy, UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
    UpsertCourse, UpsertDailyBudget, UpsertMembershipPlan, UpsertReservationProduct, VisitCheckin,
    VisitCheckinRequest, WorkedMinutes, YearMonth,
};

/// Answers whether the caller may perform one CourseBoard action.
///
/// The decision is not ours to make: it belongs to the tenant's policies in
/// Tachyon Auth, which is also where tenant membership and owner privileges
/// are settled. The port exists so use cases can ask without knowing that.
#[async_trait]
pub trait CourseAuthorizer: Send + Sync {
    /// `Ok(())` when granted. `CourseError::Forbidden` when the policies say
    /// no, and `Provider` when the answer could not be obtained — never a
    /// silent pass.
    async fn require(
        &self,
        credentials: GatewayCredentials<'_>,
        action: &'static str,
    ) -> Result<(), CourseError>;
}

/// Credentials forwarded from the inbound HTTP request to outbound Field calls,
/// plus the authorizer that says what this caller may do with them.
///
/// Domain/usecase never construct Field URLs; they only pass opaque auth
/// context. The authorizer rides along rather than sitting in every use case's
/// constructor: it is a property of the caller, like the bearer beside it, and
/// every use case that can act on a tenant already receives this.
#[derive(Clone, Copy)]
pub struct GatewayCredentials<'a> {
    /// What goes upstream to Field. May be a service-account override.
    pub authorization: &'a str,
    /// Who is asking. Authorization decisions are made about this token, which
    /// is always the signed-in caller's, never the outbound override.
    pub caller_bearer: &'a str,
    pub operator_id: &'a str,
    pub platform_id: Option<&'a str>,
    pub authorizer: &'a dyn CourseAuthorizer,
}

/// The authorizer on credentials a gateway rebuilt for an outbound call.
///
/// A gateway that fans a request out concurrently has to rebuild the context
/// it was handed, and nothing there can authorize anything — the decision was
/// already made by the use case that called it. Refusing rather than granting
/// means that if such a credential is ever handed to a use case by mistake,
/// the mistake is a 403 and not an open door.
struct OutboundOnlyAuthorizer;

#[async_trait]
impl CourseAuthorizer for OutboundOnlyAuthorizer {
    async fn require(
        &self,
        _credentials: GatewayCredentials<'_>,
        action: &'static str,
    ) -> Result<(), CourseError> {
        tracing::error!(
            action,
            "outbound-only credentials were asked to authorize; refusing"
        );
        Err(CourseError::Forbidden(action))
    }
}

static OUTBOUND_ONLY: OutboundOnlyAuthorizer = OutboundOnlyAuthorizer;

impl<'a> GatewayCredentials<'a> {
    /// Context for an outbound Field call, rebuilt inside a gateway.
    ///
    /// Only for gateways. The result cannot authorize; see
    /// [`OutboundOnlyAuthorizer`].
    pub fn for_outbound(
        authorization: &'a str,
        operator_id: &'a str,
        platform_id: Option<&'a str>,
    ) -> Self {
        Self {
            authorization,
            caller_bearer: authorization,
            operator_id,
            platform_id,
            authorizer: &OUTBOUND_ONLY,
        }
    }

    /// Refuse unless the tenant's policies grant `action`.
    ///
    /// Called at the top of a use case's `execute`, before any gateway work,
    /// so a refusal costs nothing and leaves nothing half-done.
    pub async fn require(&self, action: &'static str) -> Result<(), CourseError> {
        self.authorizer.require(*self, action).await
    }
}

/// Hand-written so the bearer never reaches a log line, and so the authorizer
/// does not have to be `Debug` to be held here.
impl std::fmt::Debug for GatewayCredentials<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GatewayCredentials")
            .field("operator_id", &self.operator_id)
            .field("platform_id", &self.platform_id)
            .finish_non_exhaustive()
    }
}

/// Port for SDK-backed Field capability discovery.
#[async_trait]
pub trait FieldCapabilitiesGateway: Send + Sync {
    async fn get_client_capabilities(
        &self,
        context: &FieldRequestContext,
    ) -> Result<FieldClientCapabilities, CourseError>;
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

/// Port for what a round pays a caddie at each rank.
///
/// Keyed by tenant id because this is CourseBoard's own storage. Reading
/// returns `None` rather than the defaults so a caller can tell "nobody has set
/// this" from "somebody set it to what the defaults happen to be" — the
/// migration off the extension config depends on that distinction, and so would
/// any later question about whether a club has ever priced its ranks.
#[async_trait]
pub trait CaddieRankFeeGateway: Send + Sync {
    async fn get_caddie_rank_fees(
        &self,
        tenant_id: &str,
    ) -> Result<Option<CaddieRankFees>, CourseError>;

    async fn replace_caddie_rank_fees(
        &self,
        tenant_id: &str,
        fees: &CaddieRankFees,
    ) -> Result<CaddieRankFees, CourseError>;
}

/// Port for the booking form's visitor categories.
///
/// Keyed by tenant id because this is CourseBoard's own storage. Empty doubles
/// as unset, which is what sends the reader to the extension config the list
/// migrated from — the same trade the course order made.
#[async_trait]
pub trait CustomerGradeRulesGateway: Send + Sync {
    async fn get_customer_grade_rules(
        &self,
        tenant_id: &str,
    ) -> Result<CustomerGradeRules, CourseError>;

    async fn replace_customer_grade_rules(
        &self,
        tenant_id: &str,
        rules: &CustomerGradeRules,
    ) -> Result<CustomerGradeRules, CourseError>;
}

/// Port for what a visitor agreed to.
///
/// Field's, not ours. The trail is append-only and carries the terms version
/// it was agreed under, which is the whole point of keeping it: a tick box
/// stored as a bare `true` cannot answer what the visitor actually signed once
/// the terms are revised. Field supplies the active catalog; CourseBoard maps
/// the paper's checked state into the accepted direction and files it (ADR-0014).
#[async_trait]
pub trait CustomerConsentGateway: Send + Sync {
    /// Files what the sheet said, one row per answered box.
    ///
    /// Boxes the reader could not make out are left out entirely rather than
    /// sent as `false` — an unread box is a question for the desk, and a
    /// refusal nobody made is worse than a gap. `accepted` is already in
    /// Field's direction; the printed opt-out was flipped upstream of here.
    async fn record_consents(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        answers: &[ReceptionConsentAnswer],
    ) -> Result<(), CourseError>;
}

/// Port for Field's tenant-wide membership consent catalog.
#[async_trait]
pub trait CustomerConsentCatalogGateway: Send + Sync {
    async fn list_consent_items(
        &self,
        credentials: GatewayCredentials<'_>,
        include_inactive: bool,
    ) -> Result<Vec<CustomerConsentItem>, CourseError>;

    async fn create_consent_item(
        &self,
        credentials: GatewayCredentials<'_>,
        item: &CreateCustomerConsentItem,
    ) -> Result<CustomerConsentItem, CourseError>;
}

/// Port for where a ledger entry came from.
///
/// CourseBoard's own storage: Field records the customer and nothing about the
/// act of writing them down, and that act is what makes two same-name entries
/// tellable apart afterwards (ADR-0009).
#[async_trait]
pub trait CustomerRegistrationGateway: Send + Sync {
    /// Records a creation. Writing the same customer twice keeps the first
    /// row: the provenance of an entry is where it first came from, and a
    /// retried request should not rewrite history.
    async fn record_customer_registration(
        &self,
        tenant_id: &str,
        entry: &NewCustomerRegistration,
    ) -> Result<(), CourseError>;

    /// One entry's provenance, absent for everybody registered before this was
    /// kept. The screen shows that as "not recorded" rather than as an error:
    /// a ledger full of people who predate the table is the normal state for a
    /// long while.
    async fn get_customer_registration(
        &self,
        tenant_id: &str,
        customer_id: &CustomerId,
    ) -> Result<Option<CustomerRegistration>, CourseError>;
}

/// Port for the ledger ranked by play.
///
/// CourseBoard's own storage. The figures are golf's reading of generic
/// bookings, and the reason they are kept rather than computed on demand is
/// that one person's history costs a paged sweep of Field — affordable for a
/// customer's own page, not for a list ordered by what people are worth.
///
/// Reads take `now` because the segment the desk asks for is relative to it:
/// "not seen for ninety days" is a cutoff, and taking it from the caller's
/// clock is what keeps the answer the same in a test as at the desk.
#[async_trait]
pub trait CustomerSummaryGateway: Send + Sync {
    async fn list_customer_summaries(
        &self,
        tenant_id: &str,
        query: &CustomerSummaryQuery,
        now: DateTime<Utc>,
    ) -> Result<Vec<CustomerSummary>, CourseError>;

    /// How many people the segment holds, not how many fit on the page.
    ///
    /// The desk decides whether a filter is worth a morning from the size of
    /// what it selected, so a pager that could only say "there is more" would
    /// be answering a different question.
    async fn count_customer_summaries(
        &self,
        tenant_id: &str,
        query: &CustomerSummaryQuery,
        now: DateTime<Utc>,
    ) -> Result<i64, CourseError>;

    /// Writes what a refresh worked out. Upsert by customer: a re-run replaces
    /// the figures for everybody it saw and leaves alone anybody it did not,
    /// so a sweep that dies halfway degrades to stale rows rather than to a
    /// half-empty ledger.
    async fn upsert_customer_summaries(
        &self,
        tenant_id: &str,
        rows: &[CustomerSummary],
    ) -> Result<u64, CourseError>;

    /// The last refresh, so the screen can say how old the figures are.
    async fn latest_summary_run(
        &self,
        tenant_id: &str,
    ) -> Result<Option<CustomerSummaryRun>, CourseError>;

    /// Opens a run and hands back its id. Written before the sweep starts, so
    /// a process that dies leaves a `running` row rather than no trace.
    async fn start_summary_run(&self, tenant_id: &str) -> Result<i64, CourseError>;

    async fn finish_summary_run(
        &self,
        run_id: i64,
        status: CustomerSummaryRunStatus,
        reservations_scanned: i64,
        customers_written: i64,
        error: Option<&str>,
    ) -> Result<(), CourseError>;
}

/// Port for who was actually seen at the desk.
///
/// CourseBoard's own storage, because the group and its seats are
/// `golfParty` and Field has nowhere to put a per-player arrival.
#[async_trait]
pub trait VisitCheckinGateway: Send + Sync {
    /// Checks a group in. Idempotent per seat: pressing the button twice is
    /// one arrival, not two.
    async fn record_visit_checkins(
        &self,
        tenant_id: &str,
        request: &VisitCheckinRequest,
        checked_in_by: Option<&str>,
    ) -> Result<Vec<VisitCheckin>, CourseError>;

    /// Every round this person was seen at, newest first.
    ///
    /// This is the half of a customer's play that a booking cannot answer:
    /// rounds they played in somebody else's group.
    async fn list_customer_checkins(
        &self,
        tenant_id: &str,
        customer_id: &CustomerId,
    ) -> Result<Vec<VisitCheckin>, CourseError>;

    /// Every arrival the tenant has recorded against a ledger entry, a page at
    /// a time.
    ///
    /// Only for the summary refresh, which needs the whole tenant at once to
    /// work out what everybody has played. Rows with no ledger link are left
    /// out: they make a headcount true but belong to nobody, and no summary can
    /// be filed under them.
    async fn list_linked_checkins(
        &self,
        tenant_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<VisitCheckin>, CourseError>;

    /// The seats already checked in on one booking, so the desk sees what it
    /// has already done rather than pressing the button again to find out.
    async fn list_reservation_checkins(
        &self,
        tenant_id: &str,
        reservation_id: &ReservationId,
    ) -> Result<Vec<VisitCheckin>, CourseError>;
}

#[async_trait]
pub trait MembershipDiscountsGateway: Send + Sync {
    async fn get_membership_discounts(
        &self,
        tenant_id: &str,
    ) -> Result<MembershipDiscounts, CourseError>;

    async fn replace_membership_discounts(
        &self,
        tenant_id: &str,
        discounts: &MembershipDiscounts,
    ) -> Result<MembershipDiscounts, CourseError>;
}

#[async_trait]
pub trait MembershipPlayWindowsGateway: Send + Sync {
    async fn get_membership_play_windows(
        &self,
        tenant_id: &str,
    ) -> Result<MembershipPlayWindows, CourseError>;

    async fn replace_membership_play_windows(
        &self,
        tenant_id: &str,
        windows: &MembershipPlayWindows,
    ) -> Result<MembershipPlayWindows, CourseError>;
}

/// Port for the jobs a caddie is put on when they are not walking a round, and
/// the days they are put on them.
///
/// CourseBoard's own rows (ADR-0009): Field's HRM models that a staff member is
/// at work, not that this club sent them to the practice range.
#[async_trait]
pub trait CaddieDutyGateway: Send + Sync {
    async fn get_duty_options(&self, tenant_id: &str) -> Result<CaddieDutyOptions, CourseError>;

    async fn replace_duty_options(
        &self,
        tenant_id: &str,
        options: &CaddieDutyOptions,
    ) -> Result<CaddieDutyOptions, CourseError>;

    /// Every day filed in the window, oldest first.
    async fn list_duty_assignments(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CaddieDutyAssignment>, CourseError>;

    /// File one stretch of a day, and answer with the row as it now stands —
    /// the id included, which is how the desk clears this one and not the
    /// other job the same caddie is on that afternoon.
    async fn save_duty_assignment(
        &self,
        tenant_id: &str,
        assignment: &CaddieDutyAssignment,
    ) -> Result<CaddieDutyAssignment, CourseError>;

    /// Take one filed job back off. `false` when there was nothing there,
    /// which the desk reads as already done rather than as a failure.
    async fn delete_duty_assignment(
        &self,
        tenant_id: &str,
        duty_id: i64,
    ) -> Result<bool, CourseError>;
}

#[async_trait]
pub trait PlayerTagOptionsGateway: Send + Sync {
    async fn get_player_tag_options(
        &self,
        tenant_id: &str,
    ) -> Result<PlayerTagOptions, CourseError>;

    async fn replace_player_tag_options(
        &self,
        tenant_id: &str,
        options: &PlayerTagOptions,
    ) -> Result<PlayerTagOptions, CourseError>;
}

/// Port for the course's pricing inputs: the tax-schedule key and the cost
/// assumptions behind the revenue projection.
///
/// Keyed by tenant id because this is CourseBoard's own storage. `None` means
/// nobody has saved here yet, which is what sends the reader looking in the
/// extension config the settings migrated from.
#[async_trait]
pub trait PricingSettingsGateway: Send + Sync {
    async fn get_pricing_settings(
        &self,
        tenant_id: &str,
    ) -> Result<Option<GolfPricingSettings>, CourseError>;

    async fn replace_pricing_settings(
        &self,
        tenant_id: &str,
        settings: &GolfPricingSettings,
    ) -> Result<GolfPricingSettings, CourseError>;
}

/// Port for the order courses are laid out in on the ledger board.
///
/// Keyed by tenant id rather than credentials because this is CourseBoard's own
/// storage. It used to live in the golf extension's config object on Field,
/// which has no version to compare against and is now gated behind the
/// permission that also enables and disables extensions — neither of which is
/// the real reason to move it. How a club likes its board arranged is not
/// something Field should have a column for (ADR-0009, ADR-0010).
#[async_trait]
pub trait CourseOrderGateway: Send + Sync {
    /// Never absent: a tenant that has arranged nothing reads back as empty,
    /// and the board falls back to the course list's own order.
    async fn get_course_order(&self, tenant_id: &str) -> Result<CourseOrder, CourseError>;

    async fn replace_course_order(
        &self,
        tenant_id: &str,
        order: &CourseOrder,
    ) -> Result<CourseOrder, CourseError>;
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

    /// The hours to file for a day the course schedule cannot answer for — a
    /// shift placed on no course, and a weekday the course stays shut.
    ///
    /// Read separately from the policy above rather than carried on it: the
    /// planner that needs the rest-day rules has no use for clock times, and
    /// the write-through that needs the times does not plan anything. Never
    /// absent — a tenant that has set nothing gets
    /// [`DefaultWorkingHours::club_default`].
    async fn get_default_working_hours(
        &self,
        tenant_id: &str,
    ) -> Result<DefaultWorkingHours, CourseError>;
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

    /// Which Field shift each day in the window was written through to.
    ///
    /// Only days that have one appear. A day absent from the answer has never
    /// reached Field, or was withdrawn from it — both ordinary, and the
    /// write-through treats them the same way: there is nothing to update, so
    /// it files afresh.
    async fn field_shift_links(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<FieldShiftLink>, CourseError>;

    /// Confirmed days Field has not been told about since they last changed,
    /// oldest first, at most `limit` of them.
    ///
    /// Confirming a month rewrites the whole roster in one operation, and the
    /// thousand-odd upstream calls that implies do not belong in the request a
    /// person is waiting on. So the push runs afterwards, and asks this for
    /// one batch at a time until nothing is left.
    ///
    /// Behind, not merely unsent: a day re-confirmed with different hours
    /// already carries a `field_shift_id`, and Field still holds the previous
    /// version of it.
    async fn unsynced_shifts(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
        limit: u32,
    ) -> Result<Vec<UnsyncedShift>, CourseError>;

    /// Treat every day in the window as behind again.
    ///
    /// The push stamps a day it could not file — a caddie with no staff record
    /// — so the queue can empty. Closing that gap on the roster changes
    /// nothing about the confirmed day, so nothing puts those days back by
    /// itself; this does. Also how a month deleted on Field's side is
    /// recovered.
    async fn mark_month_unsynced(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<(), CourseError>;

    /// How many days in the window are still behind. What the screen counts
    /// down, and how the push knows it is finished.
    async fn count_unsynced(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<u64, CourseError>;

    /// Record what Field now holds for these days.
    ///
    /// Written after the Field call rather than before it, so an id is only
    /// ever stored for a shift Field acknowledged. A day whose link is `None`
    /// is cleared, which is how a day turned off stops naming a shift that no
    /// longer exists.
    ///
    /// Days with no confirmed shift row are skipped rather than created: the
    /// link describes a day the desk already decided, and inventing a row here
    /// would confirm work nobody planned.
    ///
    /// Also stamps the day as caught up with Field, which is what takes it out
    /// of [`unsynced_shifts`](Self::unsynced_shifts). A day Field holds nothing
    /// for by design — an off day — is stamped too, with no id: otherwise every
    /// pass would pick it up, find nothing to do, and never finish.
    async fn set_field_shift_links(
        &self,
        tenant_id: &str,
        links: &[FieldShiftLink],
    ) -> Result<(), CourseError>;
}

/// Port for the generic side of a shift: that somebody is at work, and when.
///
/// Field's HRM already models this, so CourseBoard does not get to model it
/// twice (ADR-0013). The port is deliberately free of golf: a staff member, a
/// date, hours, and a note. Which course the caddie stands at and how many
/// rounds they can take never crosses it — that is golf's own, and Field has
/// no column for it by design.
///
/// Nothing here decides *whether* a shift should exist. The caller has already
/// confirmed the month; this only mirrors the working part of it.
#[async_trait]
pub trait StaffShiftGateway: Send + Sync {
    /// File a working day, or move the one already filed.
    ///
    /// `field_shift_id` is what a previous write filed for the same staff
    /// member and date, if any. Passing it updates that shift; passing `None`
    /// creates one. The id is only ever one this app stored itself, so a shift
    /// belonging to another tenant is never named — Field's own ownership
    /// check is a backstop, not the thing being relied on (PLT-3945).
    async fn upsert_shift(
        &self,
        credentials: GatewayCredentials<'_>,
        staff_id: &str,
        field_shift_id: Option<&str>,
        shift: StaffShiftInput,
    ) -> Result<String, CourseError>;

    /// Withdraw a day: the caddie is not working it after all.
    ///
    /// A shift Field no longer has is not an error. The desk turning a day off
    /// twice, or a retry after a delete that did land, both arrive here — and
    /// both leave Field in the state the caller asked for.
    async fn delete_shift(
        &self,
        credentials: GatewayCredentials<'_>,
        staff_id: &str,
        field_shift_id: &str,
    ) -> Result<(), CourseError>;
}

/// The generic shift Field is asked to hold. No golf in it, on purpose.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffShiftInput {
    pub date: NaiveDate,
    /// `HH:MM`, derived from the course's schedule where it has one.
    pub start_time: String,
    pub end_time: String,
    /// Field's own vocabulary for the kind of day, left to the caller.
    pub shift_type: Option<String>,
    pub notes: Option<String>,
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
        rolling_window_days: Option<Option<i32>>,
    ) -> Result<Vec<AvailabilityRule>, CourseError>;

    /// Synchronizes Field's rolling-window opt-in from one schedule read.
    ///
    /// The boolean is true only when the schedule was written. The operation
    /// owns the GET, comparison, and full replacement so callers cannot
    /// accidentally read rules once and write a stale second read back.
    async fn sync_rolling_window_opt_in(
        &self,
        credentials: GatewayCredentials<'_>,
        resource_id: &ResourceId,
        rolling_window_days: Option<i32>,
    ) -> Result<bool, CourseError>;

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

    /// One person's bookings, newest first.
    ///
    /// Filtered upstream rather than here: the tenant's reservation table is
    /// years of play and the desk wants one customer out of it. Only the
    /// booking's own customer matches — Field records one per reservation and
    /// cannot be asked about `golfParty.players[].customerId` — so this answers
    /// "rounds they booked", not "rounds they played in".
    ///
    /// Paged, because the caller needs the whole history and not a screenful:
    /// how often somebody plays and what they are worth are lifetime figures,
    /// and a page of them is a different number wearing the same label. Field
    /// answers with no total, so the caller reads until a page comes back
    /// short.
    async fn list_customer_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<Reservation>, CourseError>;

    /// Every booking the tenant has, a page at a time, newest first.
    ///
    /// Distinct from [`Self::list_reservations`], which asks for one capped
    /// batch and is what the tee sheet and the seeder use. This one is for the
    /// case that genuinely needs the lot: working out what every customer in
    /// the ledger has spent.
    ///
    /// Field offers no date filter, no `updatedSince`, and no total, so the
    /// only way through is from the newest backwards until a page comes back
    /// short. That is why the summary refresh is a batch job rather than a
    /// request, and why the generic contract for an incremental listing is the
    /// first thing to ask Field for.
    async fn list_tenant_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
        limit: u32,
        offset: u32,
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

    /// Change who the booking is for and how many are playing.
    ///
    /// Like the plan write and unlike the party write, this leaves
    /// `customFields` alone: the group detail is not what changed, and Field
    /// replaces that object wholesale when it is sent.
    async fn update_reservation_booking(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        update: &ReservationBookingUpdate,
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

    /// Removes a person from the active ledger.
    ///
    /// Field keeps the row for audit and reference integrity, but excludes it
    /// from subsequent reads and searches. CourseBoard must not try to remove
    /// reservations or its own historical records alongside this operation.
    async fn delete_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<(), CourseError>;
}

/// Port for reading a paper reception sheet into ledger candidates.
///
/// Separate from `CustomerGateway` because it is a different upstream capability
/// with a different failure mode: the ledger has to stay usable on a morning
/// when the document reader is down, and a screen that registers by hand should
/// not be holding a port it cannot reach.
#[async_trait]
pub trait CustomerReceptionOcrGateway: Send + Sync {
    /// Reads one sheet. Nothing is stored — upstream keeps neither the document
    /// nor the raw text, and neither does CourseBoard.
    ///
    /// Returns a draft, never a write: every row is a proposal the desk checks
    /// against the original before anybody lands in the ledger.
    async fn draft_reception(
        &self,
        credentials: GatewayCredentials<'_>,
        sheet: ReceptionSheet,
        fields: &[CustomerReceptionField],
        consents: &[ReceptionConsentDefinition],
    ) -> Result<ReceptionDraft, CourseError>;

    /// Analyzes a blank sheet and proposes only fields that can be represented
    /// by CourseBoard's current reception-field model.  The proposal is not a
    /// write; the caller reviews it and uses the settings PUT to persist it.
    async fn analyze_reception_form(
        &self,
        credentials: GatewayCredentials<'_>,
        sheet: ReceptionSheet,
    ) -> Result<ReceptionFormProposal, CourseError>;
}

/// Port for the reception-only Field ERP customer create capability.
///
/// This must stay separate from [`CustomerGateway`]: manual and booking-ledger
/// creation use the existing StoreKit response contract, while this endpoint
/// returns only an id and accepts the reception-only standard columns and
/// consents.
#[async_trait]
pub trait CustomerReceptionCreateGateway: Send + Sync {
    async fn create_reception_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &ReceptionCustomerInput,
        consents: &[ReceptionConsentAnswer],
    ) -> Result<Customer, CourseError>;
}

/// Port for CourseBoard-owned answers to custom reception fields.
#[async_trait]
pub trait CustomerReceptionValuesGateway: Send + Sync {
    async fn record_customer_reception_values(
        &self,
        tenant_id: &str,
        customer_id: &CustomerId,
        values: &std::collections::BTreeMap<String, serde_json::Value>,
    ) -> Result<(), CourseError>;
}

/// Port for the reception sheet settings CourseBoard owns locally.
///
/// The repository intentionally takes a tenant string rather than Field
/// credentials: these rows never cross the Field boundary. Use cases still
/// receive credentials so the action check is made before a tenant-scoped
/// read or write.
#[async_trait]
pub trait CustomerReceptionFieldsGateway: Send + Sync {
    async fn list_customer_reception_fields(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<CustomerReceptionField>, CourseError>;

    async fn replace_customer_reception_fields(
        &self,
        tenant_id: &str,
        fields: &[CustomerReceptionField],
    ) -> Result<(), CourseError>;
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

    /// Record, change, or withdraw the club's number for a member.
    ///
    /// Separate from assigning a plan: a club numbers people at a different
    /// moment from when it sells them the membership, and renumbers without
    /// the membership changing at all.
    async fn set_member_number(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &SetMemberNumber,
    ) -> Result<CustomerMembership, CourseError>;
}

/// Port for the append-only membership activity feed owned by Field.
///
/// CourseBoard never copies these rows into its own database.  The provider's
/// cursor and JSON snapshots pass through unchanged so a newer Field event can
/// still be displayed by an older CourseBoard build.
#[async_trait]
pub trait MembershipActivityGateway: Send + Sync {
    async fn list_membership_activities(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        query: &MembershipActivityQuery,
    ) -> Result<MembershipActivityPage, CourseError>;
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

    /// Take a caddie off the roster.
    ///
    /// Upstream keeps the row and hides it, so the rounds, ratings and payroll
    /// that point at this caddie still add up — what goes away is the roster
    /// entry and every screen that plans future work from it.
    async fn delete_caddie(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
    ) -> Result<(), CourseError>;

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
