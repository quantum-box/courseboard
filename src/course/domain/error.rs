use thiserror::Error;

/// Errors raised by course domain use cases and gateway ports.
#[derive(Debug, Error)]
pub enum CourseError {
    #[error("authorization failed")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("external provider error: {0}")]
    Provider(String),
}
