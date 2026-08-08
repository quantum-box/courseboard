//! Course domain: golf aggregates, value objects, and outbound ports.
//!
//! Field / ERP JSON never enters this module. Gateways reconstitute domain
//! models; use cases depend on ports and domain types only.

mod caddie;
mod caddie_ops;
mod caddie_ranking;
mod commercial;
mod course;
mod error;
mod ids;
mod payroll;
mod ports;
mod pricing_settings;
mod product;
mod reservation;
mod resource;
mod schedule;
mod simulator;
mod tee_sheet;

pub use caddie::{
    AssignmentRole, AssignmentStatus, Caddie, CaddieAssignment, CaddieRank, CaddieRoster,
    CaddieSkillLevel, CaddieStaff, CaddieUpstreamIdentity,
};
pub use caddie_ops::{
    compute_caddie_supply, AttendancePeriodSnapshot, AttendanceSnapshot, AttendanceSnapshotReport,
    AutoAssignPlanItem, AutoAssignResult, AutoAssignSkippedItem, AvailabilityQuery,
    AvailabilityStatus, CaddieAssignmentQuery, CaddieAvailability, CaddieCourseMembership,
    CaddieDayCapacity, CaddiePatch, CaddieRating, CaddieRecommendation, CaddieSupply,
    PayrollPeriod, PayrollRow, PayrollSummary, RecommendationQuery, ReplaceCaddieMemberships,
    UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
};
pub use caddie_ranking::{
    rank_caddies, AttendanceState, RankedCaddie, RankingCandidate, RankingOptions,
};
pub use commercial::{
    BudgetAchievement, DailyBudget, DailyBudgetQuery, ExtensionStatus, MonthlySettlement,
    ReservationPolicy, SettlementPeriod, UnpaidCancellationItem, UpdateExtensionConfig,
    UpdateReservationPolicy, UpsertDailyBudget,
};
pub use course::{Course, HoleCount, StartIntervalMinutes, UpsertCourse};
pub use error::CourseError;
pub use ids::{
    AssignmentId, AvailabilityId, BudgetId, CaddieId, CourseId, MembershipId, ProductId,
    ProductSlotId, RatingId, ReservationId, ReservationServiceId, ResourceId, TenantId,
};
pub use payroll::{summarize_payroll, AttendanceDay, PayrollCandidate, WorkedMinutes};
pub use ports::{
    GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway, GolfOpsGateway, GolfTaxGateway,
    ReservationGateway, ReservationScheduleGateway, TeeSheetQuery,
};
pub use pricing_settings::GolfPricingSettings;
pub use product::{
    DurationMinutes, PlayType, ProductSlot, ReservationProduct, UpsertReservationProduct,
};
pub use reservation::Reservation;
pub use resource::{Resource, ResourceKind, SaveCourseResource};
pub use schedule::{
    courseboard_weekday_to_field, field_day_of_week_to_courseboard, AvailabilityRule,
    CourseSchedule, GenerationSummary,
};
pub use simulator::{
    party_tax, prepare_fee_quote, prepare_range_simulation, project_row, quote_fee,
    summarize_range, FeeQuote, FeeQuoteInput, FeeQuoteRequest, PartyTax, PlayerTaxLine, RangeRow,
    RangeRowInput, RangeSimulation, RangeSimulationInput, RangeSimulationRequest, SimulatedPlayer,
    TaxRuleSnapshot, DEFAULT_PLAYER_AGE,
};
pub use tee_sheet::{
    format_datetime_with_offset, format_jst_wall_clock, jst_offset, TeeSheet, TeeSheetItem,
    TeeSheetStatus, DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR, DEFAULT_TIMEZONE,
};
