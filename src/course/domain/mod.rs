//! Course domain: golf aggregates, value objects, and outbound ports.
//!
//! Field / ERP JSON never enters this module. Gateways reconstitute domain
//! models; use cases depend on ports and domain types only.

pub mod actions;
mod availability_deadline;
mod budget_achievement;
mod caddie;
mod caddie_duty;
mod caddie_fee_alignment;
mod caddie_ops;
mod caddie_plan;
mod caddie_rank_fee;
mod caddie_ranking;
mod caddie_shift;
mod commercial;
mod course;
mod course_order;
mod course_supply;
mod customer;
mod customer_consent;
mod customer_consent_catalog;
mod customer_grade;
mod customer_reception;
mod customer_reception_fields;
mod customer_registration;
mod customer_summary;
mod customer_visits;
mod demo_board;
mod error;
mod field_capabilities;
mod ids;
mod membership;
mod membership_activity;
mod membership_play_window;
mod membership_pricing;
mod party;
mod payroll;
mod player_tags;
mod ports;
mod pricing_settings;
mod product;
mod reservation;
mod reservation_cancellation;
mod reservation_report;
mod resource;
mod schedule;
mod settlement;
mod shift_hours;
mod simulator;
mod slot_override;
mod tee_ledger;
mod tee_sheet;
mod tenant_timezone;
mod visit_checkin;

pub use availability_deadline::{AvailabilityDeadline, YearMonth};
pub use budget_achievement::{build_budget_achievements, daily_actuals, DailyActual};
pub use caddie::{
    AssignmentRole, AssignmentStatus, Caddie, CaddieAssignment, CaddieRank, CaddieRoster,
    CaddieSkillLevel, CaddieStaff, CaddieUpstreamIdentity,
};
pub use caddie_duty::{
    caddies_off_the_day, duty_blocks_round, duty_windows_for, free_halves, free_rounds,
    round_minutes, CaddieDutyAssignment, CaddieDutyOptions, DutyWindow, MAX_CADDIE_DUTIES,
    MAX_CADDIE_DUTY_LENGTH, MAX_CADDIE_DUTY_NOTE_LENGTH, MINUTES_IN_DAY,
};
pub use caddie_fee_alignment::{
    fee_alignment_candidates, plan_fee_alignment, CaddieFeeChange, FeeAlignmentCandidate,
    FeeAlignmentEffect, FeeAlignmentItem, FeeAlignmentOutcome, FeeAlignmentRequest,
    RecordedCaddieFeeChange, MAX_FEE_ALIGNMENT_ITEMS, MAX_FEE_ALIGNMENT_NOTE_CHARS,
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
    placement_for_shift, plan_caddie_assignments, shift_covers_tee_time, skip_reason,
    CaddiePlacement, PlanOptions, PlannableCaddie, PlannableRound,
};
pub use caddie_rank_fee::{
    CaddieRankFeeChange, CaddieRankFeeChangeContext, CaddieRankFees, MAX_RANK_FEE_CHANGE_LIMIT,
    MAX_RANK_FEE_NOTE_CHARS,
};
pub use caddie_ranking::{
    rank_caddies, AttendanceState, RankedCaddie, RankingCandidate, RankingOptions,
};
pub use caddie_shift::{
    parse_weekday, plan_month_shifts, weekday_key, CaddieShift, FieldShiftLink, MonthShiftPlan,
    ShiftEdit, ShiftOrigin, ShiftPolicy, ShiftRequest, ShiftSeed, ShiftSpan, UnfiledRequest,
    UnsyncedShift, MAX_CONSECUTIVE_WORK_DAYS, MAX_ROUNDS_PER_SHIFT,
};
pub use commercial::{
    BudgetAchievement, DailyBudget, DailyBudgetQuery, ExtensionStatus, MonthlySettlement,
    ReservationPolicy, SettlementPeriod, UnpaidCancellationItem, UpdateExtensionConfig,
    UpdateReservationPolicy, UpsertDailyBudget,
};
pub use course::{BusinessHours, Course, HoleCount, StartIntervalMinutes, UpsertCourse};
pub use course_order::CourseOrder;
pub use course_supply::{
    apply_assignment_coverage, compute_course_supply, reinforcements_for, AssignedCoverage,
    CaddieCapability, CourseCaddieSupply, DayCaddieSupply, Reinforcement,
};
pub use customer::{
    Customer, CustomerPage, CustomerSearchQuery, NewCustomer, DEFAULT_CUSTOMER_SEARCH_LIMIT,
    MAX_CUSTOMER_SEARCH_LIMIT,
};
pub use customer_consent::{
    legacy_reception_consent_definitions, reception_consent, required_reception_consents,
    ConsentPolarity, ReceptionConsent, ReceptionConsentAnswer, ReceptionConsentDefinition,
    CONSENT_ANTISOCIAL_AND_COURSE_TERMS, CONSENT_CART_TERMS, CONSENT_MARKETING_CONTACT,
    RECEPTION_CONSENTS,
};
pub use customer_consent_catalog::{
    active_reception_consent_definitions, CreateCustomerConsentItem, CustomerConsentItem,
};
pub use customer_grade::{
    CustomerGradeRule, CustomerGradeRules, CustomerGradeVerdict, MAX_GRADE_RULES,
};
pub use customer_reception::{
    reception_sheet_schema, reception_sheet_schema_for_fields,
    reception_sheet_schema_for_fields_and_consents, ProposedConsentItem, ReceptionAddress,
    ReceptionCustomerInput, ReceptionDraft, ReceptionDraftRow, ReceptionFormProposal,
    ReceptionOcrColumn, ReceptionOcrField, ReceptionReaderFailure, ReceptionSheet,
    ReceptionSheetMediaType, ReceptionSheets, MAX_RECEPTION_OCR_COLUMNS,
    MAX_RECEPTION_OCR_SCHEMA_BYTES, MAX_RECEPTION_ROWS, MAX_RECEPTION_SHEETS,
    MAX_RECEPTION_SHEET_BYTES, MAX_RECEPTION_UPLOAD_BYTES, RECEPTION_OCR_ENTITY_KEY,
    RECEPTION_ROWS_KEY, RECEPTION_ROW_EMAIL, RECEPTION_ROW_NAME, RECEPTION_ROW_NAME_KANA,
    RECEPTION_ROW_PHONE,
};
pub use customer_reception_fields::{
    CustomerReceptionField, ReceptionFieldInput, ReceptionFieldKind, ReceptionFieldType,
    MAX_RECEPTION_FIELD_KEY_LENGTH, MAX_RECEPTION_FIELD_LABEL_LENGTH, MAX_RECEPTION_FIELD_OPTIONS,
    MAX_RECEPTION_FIELD_OPTION_LENGTH, STANDARD_RECEPTION_FIELD_KEYS,
};
pub use customer_registration::{
    CustomerRegistration, CustomerRegistrationSource, NewCustomerRegistration,
};
pub use customer_summary::{
    CustomerSummary, CustomerSummaryQuery, CustomerSummaryRun, CustomerSummaryRunStatus,
    CustomerSummarySort, DEFAULT_SUMMARY_PAGE, MAX_SUMMARY_PAGE,
};
pub use customer_visits::{
    CustomerVisit, CustomerVisitHistory, CustomerVisitSummary, VisitKind,
    DEFAULT_VISIT_HISTORY_LIMIT, MAX_VISIT_HISTORY_LIMIT, MAX_VISIT_HISTORY_ROWS,
    VISIT_HISTORY_PAGE,
};
pub use demo_board::{
    demo_board, seed_tee_time, DemoBoard, SeedCourse, SeedGroup, SeedMark, SEED_DURATION_MINUTES,
    SEED_KEY_FIELD, SEED_PREFIX,
};
pub use error::CourseError;
pub use field_capabilities::{
    FieldAccessToken, FieldAgentDocumentCapabilities, FieldClientCapabilities,
    FieldDocumentQueueCapabilities, FieldOperatorId, FieldPlatformId, FieldRequestContext,
};
pub use ids::{
    AssignmentId, AvailabilityId, BudgetId, CaddieId, CourseId, CustomerId, MembershipId,
    MembershipPlanId, ProductId, ProductSlotId, RatingId, ReservationId, ReservationServiceId,
    ResourceId, TenantId,
};
pub use membership::{
    AssignMembershipPlan, CustomerMembership, MembershipPlan, SetMemberNumber,
    UpsertMembershipPlan, MEMBER_NUMBER_CREDENTIAL_KIND,
};
pub use membership_activity::{
    MembershipActivity, MembershipActivityActor, MembershipActivityPage, MembershipActivityQuery,
    MembershipActivitySource, MembershipActivityTarget, DEFAULT_MEMBERSHIP_ACTIVITY_LIMIT,
    MAX_MEMBERSHIP_ACTIVITY_LIMIT,
};
pub use membership_play_window::{
    format_play_time, parse_play_time, MembershipPlayWindow, MembershipPlayWindows,
    PlayWindowBreach, PlayableDays,
};
pub use membership_pricing::{MemberDiscount, MembershipDiscount, MembershipDiscounts};
pub use party::{PartyDetails, PartyPlayer, MAX_PARTY_PLAYERS, PARTY_CUSTOM_FIELD_KEY};
pub use payroll::{
    payroll_csv, summarize_payroll_in_timezone, AttendanceDay, PayrollCandidate, WorkedMinutes,
};
pub use player_tags::{PlayerTagOptions, MAX_PLAYER_TAG_LENGTH, MAX_PLAYER_TAG_OPTIONS};
pub use ports::{
    AvailabilityDeadlineGateway, CaddieDutyGateway, CaddieFeeChangeGateway, CaddieRankFeeGateway,
    CaddieShiftGateway, CourseAuthorizer, CourseOrderGateway, CustomerConsentCatalogGateway,
    CustomerConsentGateway, CustomerGateway, CustomerGradeRulesGateway,
    CustomerReceptionCreateGateway, CustomerReceptionFieldsGateway, CustomerReceptionOcrGateway,
    CustomerReceptionValuesGateway, CustomerRegistrationGateway, CustomerSummaryGateway,
    FieldCapabilitiesGateway, GatewayCredentials, GeneratedThroughGateway, GolfCatalogGateway,
    GolfCommercialGateway, GolfOpsGateway, GolfTaxGateway, MembershipActivityGateway,
    MembershipDiscountsGateway, MembershipGateway, MembershipPlayWindowsGateway,
    PlayerTagOptionsGateway, PricingSettingsGateway, ReservationCancellationGateway,
    ReservationGateway, ReservationScheduleGateway, ShiftRulesGateway, SlotOverrideGateway,
    StaffShiftGateway, StaffShiftInput, TeeLedgerQuery, TeeSheetQuery, VisitCheckinGateway,
};
pub use pricing_settings::GolfPricingSettings;
pub use product::{
    DurationMinutes, PlayType, ProductSlot, ReservationProduct, UpsertReservationProduct,
};
pub use reservation::{
    NewReservation, Reservation, ReservationBilling, ReservationBookingUpdate, SeededReservation,
};
pub use reservation_cancellation::{
    notice_days_between, CancellationDetails, CancellationFeeDecision, CancellationFeeState,
    CancellationQuery, CancellationReason, CancellationSort, NewReservationCancellation,
    ReservationCancellation, CANCELLATION_PAGE_LIMIT, MAX_CANCELLATION_NOTE_CHARS,
};
pub use reservation_report::{
    ExternalReservationReportEntry, PdfRotation, ReservationReport,
    ReservationReportAnalyzeGateway, ReservationReportDayPart, ReservationReportEntryQuery,
    ReservationReportFacility, ReservationReportGateway, ReservationReportMigrationGateway,
    ReservationReportRow, ReservationReportTotals, ReservationReportUpsertSummary,
    TabularAnalyzeMapping, TabularAnalyzeMappingField, TabularAnalyzeResult, TabularAnalyzeRow,
    DAILY_RESERVATION_STATUS_SOURCE, TABULAR_RESERVATION_REPORT_SOURCE,
};
pub use resource::{Resource, ResourceKind, SaveCourseResource};
pub use schedule::{
    courseboard_weekday_to_field, field_day_of_week_to_courseboard, AvailabilityRule,
    BookingHorizon, BuiltInventory, CourseSchedule, GenerationSummary, InventoryWatermark,
    SavedSchedule,
};
pub use settlement::{
    caddie_fee_totals, drilldown_reservation_ids, merge_settlement, reservation_totals,
    settlement_csv, settlement_reservation_lines, CaddieFeeTotals, ReservationTotals,
    SettlementReservationLine, SettlementWindow,
};
pub use shift_hours::{hours_for_span, DefaultWorkingHours, OpeningBand, ShiftHours};
pub use simulator::{
    party_tax, prepare_fee_quote, prepare_range_simulation, project_row, quote_fee,
    summarize_range, FeeQuote, FeeQuoteInput, FeeQuoteRequest, PartyTax, PlayerTaxLine, RangeRow,
    RangeRowInput, RangeSimulation, RangeSimulationInput, RangeSimulationRequest, SimulatedPlayer,
    TaxRuleSnapshot, DEFAULT_PLAYER_AGE,
};
pub use slot_override::{
    is_tee_time_closed, DeleteSlotOverrides, SlotOverride, SlotOverrideKind, SlotOverrideQuery,
    UpsertSlotOverrides,
};
pub(crate) use tee_ledger::reconcile_remaining;
pub use tee_ledger::{
    courseboard_weekday, derive_slot_times_from_hours, derive_slot_times_from_rules, LedgerColumn,
    LedgerSlot, ResourceTimeSlot, SlotGridSource, TeeLedger,
};
pub use tee_sheet::{
    widen_for_utc_date_filter, TeeSheet, TeeSheetItem, TeeSheetStatus, DEFAULT_DAY_END_HOUR,
    DEFAULT_DAY_START_HOUR,
};
pub use tenant_timezone::{
    format_datetime_in_timezone, format_tenant_wall_clock, parse_tenant_tee_time,
    parse_tenant_timezone, tenant_date_at, tenant_day_bounds, tenant_timezone_from_config,
    utc_offset_minutes_at, DEFAULT_TIMEZONE,
};
pub use visit_checkin::{NewVisitCheckin, VisitCheckin, VisitCheckinRequest};
