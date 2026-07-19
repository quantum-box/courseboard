//! Infrastructure adapters for the course domain.
//!
//! Field API HTTP clients live here only.

mod field_commercial_gateway;
mod field_gateway;
mod field_ops_gateway;

pub use field_commercial_gateway::FieldGolfCommercialGateway;
pub use field_gateway::{FieldGolfCatalogGateway, FieldReservationGateway};
pub use field_ops_gateway::FieldGolfOpsGateway;
