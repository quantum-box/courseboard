//! Course domain: golf aggregates, value objects, and outbound ports.
//!
//! Field / ERP JSON never enters this module. Gateways reconstitute domain
//! models; use cases depend on ports and domain types only.

mod caddie;
mod caddie_ops;
mod commercial;
mod course;
mod error;
mod ids;
mod ports;
mod product;
mod reservation;
mod resource;
mod tee_sheet;

pub use caddie::{
    AssignmentRole, AssignmentStatus, Caddie, CaddieAssignment, CaddieRank, CaddieRoster,
    CaddieSkillLevel, CaddieStaff, CaddieUpstreamIdentity,
};
pub use caddie_ops::{
    AttendanceSnapshot, AttendanceSnapshotReport, AutoAssignPlanItem, AutoAssignResult,
    AutoAssignSkippedItem, AvailabilityQuery, AvailabilityStatus, CaddieAssignmentQuery,
    CaddieAvailability, CaddieCourseMembership, CaddiePatch, CaddieRating, CaddieRecommendation,
    CaddieSupply, PayrollPeriod, PayrollRow, PayrollSummary, RecommendationQuery,
    ReplaceCaddieMemberships, UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
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
pub use ports::{
    GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway, GolfOpsGateway,
    ReservationGateway, TeeSheetQuery,
};
pub use product::{
    DurationMinutes, PlayType, ProductSlot, ReservationProduct, UpsertReservationProduct,
};
pub use reservation::Reservation;
pub use resource::{Resource, ResourceKind};
pub use tee_sheet::{
    format_datetime_with_offset, format_jst_wall_clock, jst_offset, TeeSheet, TeeSheetItem,
    TeeSheetStatus, DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR, DEFAULT_TIMEZONE,
};
