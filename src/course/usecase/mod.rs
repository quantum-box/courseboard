//! Course use cases.
//!
//! Convention: **1 use case = 1 file = 1 public entrypoint**.
//! - File name: snake_case verb phrase matching the use case (`list_caddies.rs`).
//! - Public API: a thin `*UseCase` struct with `new(...)` and a single `execute(...)`
//!   (or, for future cases with no DI state, a single free `execute` function).
//! - Keep all use case files flat under this module (no category subdirectories).
//! - Keep orchestration-heavy cases (e.g. `get_tee_sheet`) as one file even if they
//!   contain private helpers; do not pack unrelated operations into the same file.

mod auto_assign_caddies;
mod availability_deadline;
mod caddie_rank_fees;
mod cancel_reservation;
mod change_reservation_plan;
mod course_order;
mod course_schedule;
mod create_caddie;
mod create_caddie_assignment;
mod create_course;
mod create_customer;
mod create_reservation;
mod delete_caddie;
mod delete_caddie_availability;
mod delete_course;
mod export_monthly_settlement_csv;
mod export_payroll_csv;
mod generate_caddie_shifts;
mod get_attendance_snapshot;
mod get_caddie_supply;
mod get_course_caddie_supply;
mod get_customer;
mod get_extension_status;
mod get_field_client_capabilities;
mod get_monthly_settlement;
mod get_payroll_summary;
mod get_reservation_policy;
mod get_tee_ledger;
mod get_tee_sheet;
mod import_daily_budgets_csv;
mod link_course_resource;
mod list_attendance_period_snapshots;
mod list_budget_achievements;
mod list_caddie_assignments;
mod list_caddie_availabilities;
mod list_caddie_memberships;
mod list_caddie_ratings;
mod list_caddie_recommendations;
mod list_caddie_shifts;
mod list_caddies;
mod list_course_reinforcements;
mod list_courses;
mod list_daily_budgets;
mod list_product_slots;
mod list_reservation_products;
mod list_resources;
mod membership;
mod quote_golf_fee;
mod replace_caddie_memberships;
mod replace_product_slots;
mod reservation_report_import;
mod search_customers;
mod seed_demo_board;
mod shift_rules;
mod simulate_green_fee_range;
mod slot_overrides;
mod update_caddie;
mod update_caddie_assignment;
mod update_caddie_shift;
mod update_course;
mod update_extension_config;
mod update_reservation_party;
mod update_reservation_policy;
mod upsert_caddie_availability;
mod upsert_daily_budget;
mod upsert_reservation_product;

pub use auto_assign_caddies::AutoAssignCaddiesUseCase;
pub use availability_deadline::{
    GetAvailabilityDeadlineUseCase, ListUnsubmittedCaddiesUseCase,
    UpsertAvailabilityDeadlineUseCase,
};
pub use caddie_rank_fees::{GetCaddieRankFeesUseCase, ReplaceCaddieRankFeesUseCase};
pub use cancel_reservation::CancelReservationUseCase;
pub use change_reservation_plan::ChangeReservationPlanUseCase;
pub use course_order::{GetCourseOrderUseCase, ReplaceCourseOrderUseCase};
pub use course_schedule::{
    ExtendCourseInventoryUseCase, GenerateCourseTimeSlotsUseCase, GetBookingHorizonUseCase,
    GetCourseScheduleUseCase, ReplaceCourseScheduleUseCase, SetBookingHorizonUseCase,
};
pub use create_caddie::CreateCaddieUseCase;
pub use create_caddie_assignment::{CreateCaddieAssignmentUseCase, NameCaddieForRound};
pub use create_course::CreateCourseUseCase;
pub use create_customer::CreateCustomerUseCase;
pub use create_reservation::{CreateReservationInput, CreateReservationUseCase};
pub use delete_caddie::DeleteCaddieUseCase;
pub use delete_caddie_availability::DeleteCaddieAvailabilityUseCase;
pub use delete_course::DeleteCourseUseCase;
pub use export_monthly_settlement_csv::ExportMonthlySettlementCsvUseCase;
pub use export_payroll_csv::ExportPayrollCsvUseCase;
pub use generate_caddie_shifts::{GenerateCaddieShiftsUseCase, GeneratedMonth, ShiftPlanMode};
pub use get_attendance_snapshot::GetAttendanceSnapshotUseCase;
pub use get_caddie_supply::GetCaddieSupplyUseCase;
pub use get_course_caddie_supply::GetCourseCaddieSupplyUseCase;
pub use get_customer::GetCustomerUseCase;
pub use get_extension_status::GetExtensionStatusUseCase;
pub use get_field_client_capabilities::GetFieldClientCapabilitiesUseCase;
pub use get_monthly_settlement::{
    GetMonthlySettlementUseCase, MonthlySettlementReservation, MonthlySettlementView,
};
pub use get_payroll_summary::GetPayrollSummaryUseCase;
pub use get_reservation_policy::GetReservationPolicyUseCase;
pub use get_tee_ledger::GetTeeLedgerUseCase;
pub use get_tee_sheet::GetTeeSheetUseCase;
pub use import_daily_budgets_csv::ImportDailyBudgetsCsvUseCase;
pub use link_course_resource::LinkCourseResourceUseCase;
pub use list_attendance_period_snapshots::ListAttendancePeriodSnapshotsUseCase;
pub use list_budget_achievements::ListBudgetAchievementsUseCase;
pub use list_caddie_assignments::ListCaddieAssignmentsUseCase;
pub use list_caddie_availabilities::ListCaddieAvailabilitiesUseCase;
pub use list_caddie_memberships::ListCaddieMembershipsUseCase;
pub use list_caddie_ratings::ListCaddieRatingsUseCase;
pub use list_caddie_recommendations::ListCaddieRecommendationsUseCase;
pub use list_caddie_shifts::ListCaddieShiftsUseCase;
pub use list_caddies::ListCaddiesUseCase;
pub use list_course_reinforcements::{ListCourseReinforcementsUseCase, ReinforcementCandidate};
pub use list_courses::ListCoursesUseCase;
pub use list_daily_budgets::ListDailyBudgetsUseCase;
pub use list_product_slots::ListProductSlotsUseCase;
pub use list_reservation_products::ListReservationProductsUseCase;
pub use list_resources::ListResourcesUseCase;
pub use membership::{
    AssignMembershipPlanUseCase, CreateMembershipPlanUseCase, GetCustomerMembershipUseCase,
    ListMembershipPlansUseCase, UpdateMembershipPlanUseCase,
};
pub use quote_golf_fee::QuoteGolfFeeUseCase;
pub use replace_caddie_memberships::ReplaceCaddieMembershipsUseCase;
pub use replace_product_slots::ReplaceProductSlotsUseCase;
pub use reservation_report_import::{
    normalize_course_key, normalized_reservation_report_fingerprint, parse_reservation_report,
    ImportReservationReportUseCase, ListReservationReportEntriesUseCase,
    PreviewReservationReportUseCase, ReservationReportCourseMapping, ReservationReportPreview,
    MAX_RESERVATION_REPORT_BYTES,
};
pub use search_customers::SearchCustomersUseCase;
pub use seed_demo_board::{SeedDemoBoardUseCase, SeedSummary};
pub use shift_rules::{GetShiftRulesUseCase, UpdateShiftRulesUseCase};
pub use simulate_green_fee_range::SimulateGreenFeeRangeUseCase;
pub use slot_overrides::{
    DeleteSlotOverridesUseCase, ListSlotOverridesUseCase, UpsertSlotOverridesUseCase,
};
pub use update_caddie::UpdateCaddieUseCase;
pub use update_caddie_assignment::UpdateCaddieAssignmentUseCase;
pub use update_caddie_shift::UpdateCaddieShiftUseCase;
pub use update_course::UpdateCourseUseCase;
pub use update_extension_config::UpdateExtensionConfigUseCase;
pub use update_reservation_party::UpdateReservationPartyUseCase;
pub use update_reservation_policy::UpdateReservationPolicyUseCase;
pub use upsert_caddie_availability::UpsertCaddieAvailabilityUseCase;
pub use upsert_daily_budget::UpsertDailyBudgetUseCase;
pub use upsert_reservation_product::UpsertReservationProductUseCase;
