use thiserror::Error;

/// Errors raised by course domain use cases and gateway ports.
#[derive(Debug, Error)]
pub enum CourseError {
    #[error("authorization failed")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(&'static str),
    /// Upstream Field explicitly denied the caller (401/403). Surfaced as 403,
    /// not 502: Cloudflare replaces origin 502 bodies with its own CORS-less
    /// error page, which browsers can only report as "Failed to fetch".
    #[error("field access denied: {0}")]
    PermissionDenied(String),
    #[error("external provider error: {0}")]
    Provider(String),
}
