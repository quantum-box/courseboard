//! Infrastructure adapters for the course domain.
//!
//! Field API HTTP clients live here only.

mod availability_deadline_repository;
mod course_order_config;
mod field_commercial_gateway;
mod field_gateway;
mod field_ops_gateway;
mod generic_product_config;
mod party_custom_fields;
mod slot_override_repository;
mod tax_rule_gateway;

pub use availability_deadline_repository::MySqlAvailabilityDeadlineRepository;
pub use field_commercial_gateway::FieldGolfCommercialGateway;
pub use field_gateway::{FieldGolfCatalogGateway, FieldReservationGateway};
pub use field_ops_gateway::FieldGolfOpsGateway;
pub use party_custom_fields::party_from_request;
pub use slot_override_repository::MySqlSlotOverrideRepository;
pub use tax_rule_gateway::CourseboardTaxGateway;
