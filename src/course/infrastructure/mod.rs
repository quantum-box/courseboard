//! Infrastructure adapters for the course domain.
//!
//! Field API HTTP clients live here only.

mod availability_deadline_repository;
mod booking_horizon_config;
mod caddie_rank_fee_config;
mod caddie_rank_fee_repository;
mod caddie_shift_repository;
mod course_order_config;
mod course_order_repository;
mod field_commercial_gateway;
mod field_customer_gateway;
mod field_customer_reception_gateway;
mod field_gateway;
mod field_membership_gateway;
mod field_ops_gateway;
mod field_sdk_capabilities_gateway;
mod generated_through_repository;
mod generic_product_config;
mod party_custom_fields;
mod policy_authorizer;
mod pricing_settings_repository;
mod reservation_report_gateway;
mod shift_rules_repository;
mod slot_override_repository;
mod tax_rule_gateway;

pub use availability_deadline_repository::MySqlAvailabilityDeadlineRepository;
pub use caddie_rank_fee_repository::MySqlCaddieRankFeeRepository;
pub use caddie_shift_repository::MySqlCaddieShiftRepository;
pub use course_order_repository::MySqlCourseOrderRepository;
pub use field_commercial_gateway::FieldGolfCommercialGateway;
pub use field_customer_gateway::FieldCustomerGateway;
pub use field_customer_reception_gateway::FieldCustomerReceptionGateway;
pub use field_gateway::{
    FieldGolfCatalogGateway, FieldReservationGateway, DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
};
pub use field_membership_gateway::FieldMembershipGateway;
pub use field_ops_gateway::FieldGolfOpsGateway;
pub use field_sdk_capabilities_gateway::FieldSdkCapabilitiesGateway;
pub use generated_through_repository::MySqlGeneratedThroughRepository;
pub use party_custom_fields::{party_from_request, PartyPlayerInput};
pub use policy_authorizer::{AllowAllAuthorizer, PolicyCourseAuthorizer, ALLOW_ALL};
pub use pricing_settings_repository::MySqlPricingSettingsRepository;
pub use reservation_report_gateway::FieldReservationReportGateway;
pub use shift_rules_repository::MySqlShiftRulesRepository;
pub use slot_override_repository::MySqlSlotOverrideRepository;
pub use tax_rule_gateway::CourseboardTaxGateway;
