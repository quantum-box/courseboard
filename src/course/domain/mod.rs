//! Course domain: golf aggregates, value objects, and outbound ports.
//!
//! Field / ERP JSON never enters this module. Gateways reconstitute domain
//! models; use cases depend on ports and domain types only.

mod availability_deadline;
mod caddie;
mod caddie_ops;
mod caddie_plan;
mod caddie_rank_fee;
mod caddie_ranking;
mod caddie_shift;
mod commercial;
mod course;
mod course_order;
mod course_supply;
mod demo_board;
mod error;
mod ids;
mod party;
mod payroll;
mod ports;
mod pricing_settings;
mod product;
mod reservation;
mod resource;
mod schedule;
mod simulator;
mod slot_override;
mod tee_ledger;
mod tee_sheet;
mod tenant_timezone;

pub use availability_deadline::{AvailabilityDeadline, YearMonth};
pub use caddie::{
    AssignmentRole, AssignmentStatus, Caddie, CaddieAssignment, CaddieRank, CaddieRoster,
    CaddieSkillLevel, CaddieStaff, CaddieUpstreamIdentity,
};
pub use caddie_ops::{
    compute_caddie_supply, AttendancePeriodSnapshot, AttendanceSnapshot, AttendanceSnapshotReport,
    AutoAssignPlanItem, AutoAssignResult, AutoAssignSkippedItem, AvailabilityQuery,
    AvailabilityStatus, CaddieAssignmentQuery, CaddieAvailability, CaddieCourseMembership,
    CaddieDayCapacity, CaddiePatch, CaddieRating, CaddieRecommendation, CaddieSupply,
    DeadlineWarning, PayrollPeriod, PayrollRow, PayrollSummary, RecommendationQuery,
    ReplaceCaddieMemberships, UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
};
pub use caddie_plan::{
    plan_caddie_assignments, shift_covers_tee_time, skip_reason, CaddiePlacement, PlanOptions,
    PlannableCaddie, PlannableRound,
};
pub use caddie_rank_fee::CaddieRankFees;
pub use caddie_ranking::{
    rank_caddies, AttendanceState, RankedCaddie, RankingCandidate, RankingOptions,
};
pub use caddie_shift::{
    parse_weekday, plan_month_shifts, weekday_key, CaddieShift, MonthShiftPlan, ShiftEdit,
    ShiftOrigin, ShiftPolicy, ShiftRequest, ShiftSeed, ShiftSpan, UnfiledRequest,
    MAX_CONSECUTIVE_WORK_DAYS, MAX_ROUNDS_PER_SHIFT,
};
pub use commercial::{
    BudgetAchievement, DailyBudget, DailyBudgetQuery, ExtensionStatus, MonthlySettlement,
    ReservationPolicy, SettlementPeriod, UnpaidCancellationItem, UpdateExtensionConfig,
    UpdateReservationPolicy, UpsertDailyBudget,
};
pub use course::{BusinessHours, Course, HoleCount, StartIntervalMinutes, UpsertCourse};
pub use course_order::CourseOrder;
pub use course_supply::{
    compute_course_supply, has_room_for_one_more_caddie_round, reinforcements_for,
    CaddieCapability, CourseCaddieSupply, DayCaddieSupply, Reinforcement,
};
pub use demo_board::{
    demo_board, seed_tee_time, DemoBoard, SeedCourse, SeedGroup, SeedMark, SEED_DURATION_MINUTES,
    SEED_KEY_FIELD, SEED_PREFIX,
};
pub use error::CourseError;
pub use ids::{
    AssignmentId, AvailabilityId, BudgetId, CaddieId, CourseId, MembershipId, ProductId,
    ProductSlotId, RatingId, ReservationId, ReservationServiceId, ResourceId, TenantId,
};
pub use party::{PartyDetails, PartyPlayer, MAX_PARTY_PLAYERS, PARTY_CUSTOM_FIELD_KEY};
pub use payroll::{payroll_csv, summarize_payroll, AttendanceDay, PayrollCandidate, WorkedMinutes};
pub use ports::{
    AvailabilityDeadlineGateway, CaddieShiftGateway, GatewayCredentials, GeneratedThroughGateway,
    GolfCatalogGateway, GolfCommercialGateway, GolfOpsGateway, GolfTaxGateway, ReservationGateway,
    ReservationScheduleGateway, ShiftRulesGateway, SlotOverrideGateway, TeeLedgerQuery,
    TeeSheetQuery,
};
pub use pricing_settings::GolfPricingSettings;
pub use product::{
    DurationMinutes, PlayType, ProductSlot, ReservationProduct, UpsertReservationProduct,
};
pub use reservation::{NewReservation, Reservation, SeededReservation};
pub use resource::{Resource, ResourceKind, SaveCourseResource};
pub use schedule::{
    courseboard_weekday_to_field, field_day_of_week_to_courseboard, AvailabilityRule,
    BookingHorizon, BuiltInventory, CourseSchedule, GenerationSummary, InventoryWatermark,
    SavedSchedule,
};
pub use simulator::{
    party_tax, prepare_fee_quote, prepare_range_simulation, project_row, quote_fee,
    summarize_range, FeeQuote, FeeQuoteInput, FeeQuoteRequest, PartyTax, PlayerTaxLine, RangeRow,
    RangeRowInput, RangeSimulation, RangeSimulationInput, RangeSimulationRequest, SimulatedPlayer,
    TaxRuleSnapshot, DEFAULT_PLAYER_AGE,
};
pub use slot_override::{
    DeleteSlotOverrides, SlotOverride, SlotOverrideKind, SlotOverrideQuery, UpsertSlotOverrides,
};
pub(crate) use tee_ledger::reconcile_remaining;
pub use tee_ledger::{
    courseboard_weekday, derive_slot_times_from_hours, derive_slot_times_from_rules, LedgerColumn,
    LedgerSlot, ResourceTimeSlot, SlotGridSource, TeeLedger,
};
pub use tee_sheet::{
    course_day_bounds, format_datetime_with_offset, format_jst_wall_clock, jst_offset,
    parse_jst_tee_time, widen_for_utc_date_filter, TeeSheet, TeeSheetItem, TeeSheetStatus,
    DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR,
};
pub use tenant_timezone::{tenant_timezone_from_config, DEFAULT_TIMEZONE};
