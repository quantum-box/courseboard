//! Inbound adapters (HTTP) for the course domain.

pub mod http;
pub mod http_commercial;
pub mod http_customers;
pub mod http_field;
pub mod http_ops;
pub mod http_reservation_report;
pub mod http_reservation_summary;
pub mod http_simulator;
pub mod openapi;

#[cfg(test)]
mod persistence_tests;
