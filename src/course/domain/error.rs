use thiserror::Error;

/// Errors raised by course domain use cases and gateway ports.
#[derive(Debug, Error)]
pub enum CourseError {
    #[error("authorization failed")]
    Unauthorized,
    #[error("{0}")]
    BadRequest(&'static str),
    /// The request was valid, but the selected operational state changed
    /// before it could be applied (for example, another booking filled a tee
    /// time shown as open on the caller's ledger snapshot).
    #[error("{0}")]
    Conflict(&'static str),
    /// Field accepted the request but rejected its contents. Preserve both the
    /// 4xx status and Field's sanitized operator-facing message so CourseBoard
    /// can tell a correctable input/conflict from a provider outage.
    #[error("{message}")]
    UpstreamClient { status: u16, message: String },
    #[error("{0}")]
    NotFound(&'static str),
    #[error("external provider error: {0}")]
    Provider(String),
}
