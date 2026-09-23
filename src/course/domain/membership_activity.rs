//! The append-only membership activity feed owned by Field.
//!
//! CourseBoard deliberately keeps this model small.  Field is the source of
//! truth and this application only reads the feed, so snapshots remain JSON
//! rather than being turned into a second, lossy set of golf tables.  In
//! particular, `kind` is a string: a newer Field event must still be visible to
//! an older CourseBoard build.

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::CourseError;

/// A single membership mutation recorded by Field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipActivity {
    pub id: String,
    pub kind: String,
    pub occurred_at: DateTime<Utc>,
    pub actor: MembershipActivityActor,
    pub source: Option<MembershipActivitySource>,
    pub target: Option<MembershipActivityTarget>,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub schema_version: u32,
}

/// The executor that caused the mutation.  `kind` intentionally remains a
/// string so a future actor type does not make the read endpoint fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipActivityActor {
    pub kind: String,
    pub id: String,
}

/// Where a mutation came from.  Both fields are optional for older events and
/// for mutations that do not have a channel (for example a direct assignment).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipActivitySource {
    pub channel: Option<String>,
    pub application: Option<String>,
}

/// The membership entity affected by the event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipActivityTarget {
    pub kind: String,
    pub id: Option<String>,
}

/// A page of Field activity rows, already ordered newest first by Field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipActivityPage {
    pub items: Vec<MembershipActivity>,
    pub next_cursor: Option<String>,
}

/// Keyset pagination parameters for the Field activity endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipActivityQuery {
    pub limit: u32,
    pub cursor: Option<String>,
}

pub const DEFAULT_MEMBERSHIP_ACTIVITY_LIMIT: u32 = 20;
pub const MAX_MEMBERSHIP_ACTIVITY_LIMIT: u32 = 100;

impl MembershipActivityQuery {
    /// Validate the public contract before contacting Field. Silently
    /// changing an explicitly supplied limit would make a malformed caller
    /// look successful and diverge from Field's 1..=100 contract.
    pub fn try_new(limit: Option<u32>, cursor: Option<String>) -> Result<Self, CourseError> {
        let limit = limit.unwrap_or(DEFAULT_MEMBERSHIP_ACTIVITY_LIMIT);
        if !(1..=MAX_MEMBERSHIP_ACTIVITY_LIMIT).contains(&limit) {
            return Err(CourseError::BadRequest(
                "membership activity limit must be between 1 and 100",
            ));
        }
        // The cursor is opaque. In particular, do not turn an explicitly
        // supplied empty/whitespace value into the first page; Field owns the
        // cursor decoder and must be allowed to return its contract 400.
        Ok(Self { limit, cursor })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_uses_the_contract_default_and_rejects_out_of_range_values() {
        assert_eq!(
            MembershipActivityQuery::try_new(None, None).unwrap().limit,
            20
        );
        assert!(MembershipActivityQuery::try_new(Some(0), None).is_err());
        assert!(MembershipActivityQuery::try_new(Some(101), None).is_err());
    }

    #[test]
    fn opaque_cursor_is_preserved_for_field_validation() {
        assert_eq!(
            MembershipActivityQuery::try_new(None, Some("  ".into()))
                .unwrap()
                .cursor,
            Some("  ".into())
        );
    }
}
