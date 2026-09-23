use thiserror::Error;

use super::customer_reception::ReceptionReaderFailure;

/// Errors raised by course domain use cases and gateway ports.
#[derive(Debug, Error)]
pub enum CourseError {
    #[error("authorization failed")]
    Unauthorized,
    /// The caller is signed in, but the tenant's policies do not grant the
    /// action this operation requires. Carries the action so the response can
    /// name what is missing rather than a bare "forbidden".
    #[error("this operation requires {0}")]
    Forbidden(&'static str),
    /// The policy store refused the tenant scope itself, not one action. The
    /// screen has to tell these apart: this one means "you cannot work in this
    /// tenant", which sends the operator back to tenant selection.
    #[error("the tenant scope was refused for this caller")]
    TenantForbidden,
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
    /// The document reader upstream refused the call itself, rather than
    /// reading a sheet and failing to make it out. Its own variant because the
    /// screen has to tell those apart: this one is not answered by
    /// re-photographing the paper, and the desk was doing exactly that for as
    /// long as Field folded both into one 200 (PLT-4033).
    #[error("{0}")]
    ReceptionReaderFailed(ReceptionReaderFailure),
    #[error("{0}")]
    NotFound(&'static str),
    #[error("external provider error: {0}")]
    Provider(String),
}
