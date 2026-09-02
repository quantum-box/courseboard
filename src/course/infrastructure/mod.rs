//! Infrastructure adapters for the course domain.
//!
//! Field API HTTP clients live here only.

mod availability_deadline_repository;
mod booking_horizon_config;
mod caddie_duty_repository;
mod caddie_rank_fee_config;
mod caddie_rank_fee_repository;
mod caddie_shift_repository;
mod course_order_config;
mod course_order_repository;
mod customer_grade_rules_repository;
mod customer_reception_fields_repository;
mod customer_reception_values_repository;
mod customer_registration_repository;
mod customer_summary_repository;
mod field_commercial_gateway;
mod field_customer_consent_gateway;
mod field_customer_gateway;
mod field_customer_reception_create_gateway;
mod field_customer_reception_gateway;
mod field_gateway;
mod field_membership_activity_gateway;
mod field_membership_gateway;
mod field_ops_gateway;
mod field_sdk_capabilities_gateway;
mod field_staff_shift_gateway;
mod generated_through_repository;
mod generic_product_config;
mod membership_discounts_repository;
mod membership_play_windows_repository;
mod party_custom_fields;
mod player_tag_options_repository;
mod policy_authorizer;
mod pricing_settings_repository;
mod product_settings_repository;
mod reservation_report_gateway;
mod reservation_report_repository;
mod shift_rules_repository;
mod slot_override_repository;
mod tax_rule_gateway;
mod visit_checkin_repository;

pub use availability_deadline_repository::MySqlAvailabilityDeadlineRepository;
pub use caddie_duty_repository::MySqlCaddieDutyRepository;
pub use caddie_rank_fee_repository::MySqlCaddieRankFeeRepository;
pub use caddie_shift_repository::MySqlCaddieShiftRepository;
pub use course_order_repository::MySqlCourseOrderRepository;
pub use customer_grade_rules_repository::MySqlCustomerGradeRulesRepository;
pub use customer_reception_fields_repository::MySqlCustomerReceptionFieldsRepository;
pub use customer_reception_values_repository::MySqlCustomerReceptionValuesRepository;
pub use customer_registration_repository::MySqlCustomerRegistrationRepository;
pub use customer_summary_repository::MySqlCustomerSummaryRepository;
pub use field_commercial_gateway::FieldGolfCommercialGateway;
pub use field_customer_consent_gateway::FieldCustomerConsentGateway;
pub use field_customer_gateway::FieldCustomerGateway;
pub use field_customer_reception_create_gateway::FieldCustomerReceptionCreateGateway;
pub use field_customer_reception_gateway::FieldCustomerReceptionGateway;
pub use field_gateway::{
    FieldGolfCatalogGateway, FieldReservationGateway, DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
};
pub use field_membership_activity_gateway::FieldMembershipActivityGateway;
pub use field_membership_gateway::FieldMembershipGateway;
pub use field_ops_gateway::FieldGolfOpsGateway;
pub use field_sdk_capabilities_gateway::FieldSdkCapabilitiesGateway;
pub use field_staff_shift_gateway::FieldStaffShiftGateway;
pub use generated_through_repository::MySqlGeneratedThroughRepository;
pub use membership_discounts_repository::MySqlMembershipDiscountsRepository;
pub use membership_play_windows_repository::MySqlMembershipPlayWindowsRepository;
pub use party_custom_fields::{party_from_request, PartyPlayerInput};
pub use player_tag_options_repository::MySqlPlayerTagOptionsRepository;
pub use policy_authorizer::{AllowAllAuthorizer, PolicyCourseAuthorizer, ALLOW_ALL};
pub use pricing_settings_repository::MySqlPricingSettingsRepository;
pub use product_settings_repository::{GolfProductSettings, MySqlGolfProductSettingsRepository};
pub use reservation_report_gateway::{FieldReservationReportGateway, DEFAULT_FIELD_GENERIC_PATHS};
pub use reservation_report_repository::{
    MigratingReservationReportGateway, MySqlReservationReportRepository,
};
pub use shift_rules_repository::MySqlShiftRulesRepository;
pub use slot_override_repository::MySqlSlotOverrideRepository;
pub use tax_rule_gateway::CourseboardTaxGateway;
pub use visit_checkin_repository::MySqlVisitCheckinRepository;
