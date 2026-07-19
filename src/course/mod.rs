//! Course domain (golf operations) for CourseBoard course-api.
//!
//! Layering (Clean Architecture):
//! - `domain` — golf aggregates / value objects and gateway ports
//!   (no Field HTTP, no axum, no serde DTOs)
//! - `usecase` — use cases depending on ports and domain types only
//! - `infrastructure` — Field API gateway adapters (Field JSON → domain)
//! - `interfaces` — HTTP handlers / response DTOs for `/v1/course/*`

pub mod domain;
pub mod infrastructure;
pub mod interfaces;
pub mod usecase;
