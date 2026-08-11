//! Infrastructure adapters for the course domain.
//!
//! Field API HTTP clients live here only.

mod availability_deadline_repository;
mod booking_horizon_config;
mod caddie_rank_fee_config;
mod caddie_shift_repository;
mod course_order_config;
mod field_commercial_gateway;
mod field_customer_gateway;
mod field_gateway;
mod field_membership_gateway;
mod field_ops_gateway;
mod generated_through_repository;
mod generic_product_config;
mod party_custom_fields;
mod reservation_summary_repository;
mod reservation_workbook;
mod shift_rules_repository;
mod slot_override_repository;
mod tax_rule_gateway;

pub use availability_deadline_repository::MySqlAvailabilityDeadlineRepository;
pub use caddie_shift_repository::MySqlCaddieShiftRepository;
pub use field_commercial_gateway::FieldGolfCommercialGateway;
pub use field_customer_gateway::FieldCustomerGateway;
pub use field_gateway::{FieldGolfCatalogGateway, FieldReservationGateway};
pub use field_membership_gateway::FieldMembershipGateway;
pub use field_ops_gateway::FieldGolfOpsGateway;
pub use generated_through_repository::MySqlGeneratedThroughRepository;
pub use party_custom_fields::{party_from_request, PartyPlayerInput};
pub use reservation_summary_repository::MySqlReservationSummaryRepository;
pub use reservation_workbook::read_reservation_sheet;
pub use shift_rules_repository::MySqlShiftRulesRepository;
pub use slot_override_repository::MySqlSlotOverrideRepository;
pub use tax_rule_gateway::CourseboardTaxGateway;
