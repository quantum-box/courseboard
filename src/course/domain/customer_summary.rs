//! The ledger ranked by play, so a call list can be drawn instead of eyeballed.
//!
//! Nothing new is measured here. These are the figures
//! [`CustomerVisitSummary`] already defines for one person, kept per customer
//! so the whole ledger can be ordered by them. The reason to keep rather than
//! recompute is cost: one person's history is a paged sweep of Field's
//! bookings, and a hundred of them is a hundred sweeps.
//!
//! What this deliberately cannot do is find somebody by name. The ledger is
//! Field's and CourseBoard copies none of it (ADR-0005), so a summary row is a
//! customer id and a set of numbers. Names reach the screen by asking Field for
//! the rows about to be shown — a page of them, not the tenant.

use chrono::{DateTime, Duration, Utc};

use super::{CourseError, CustomerId, CustomerVisitSummary};

/// Rows a call list hands over at once.
///
/// A morning of calls is tens, not thousands. The cap is also what keeps the
/// name lookup behind the list bounded: every row shown costs one question to
/// Field about who that person is.
pub const DEFAULT_SUMMARY_PAGE: u32 = 25;
pub const MAX_SUMMARY_PAGE: u32 = 100;

/// One person's play, as the list reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerSummary {
    pub customer_id: CustomerId,
    pub summary: CustomerVisitSummary,
    /// The sweep stopped short of this person's beginning, so the figures are a
    /// partial count. Carried because it is what withholds the grade.
    pub truncated: bool,
    pub computed_at: DateTime<Utc>,
}

/// What the list is ordered by.
///
/// Three orders, because a call list is built in three ways: who is worth the
/// most, who has been away the longest, who comes most often. Anything else is
/// a sort on a column the desk does not ring people about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomerSummarySort {
    TotalAmount,
    Visits,
    LastVisit,
}

impl CustomerSummarySort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TotalAmount => "total_amount",
            Self::Visits => "visits",
            Self::LastVisit => "last_visit",
        }
    }

    /// The column, for whoever builds the statement. Kept beside the parser so
    /// a new sort cannot be added without giving it one.
    pub fn column(self) -> &'static str {
        match self {
            Self::TotalAmount => "total_amount",
            Self::Visits => "visits",
            Self::LastVisit => "last_visit_at",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value {
            "total_amount" => Ok(Self::TotalAmount),
            "visits" => Ok(Self::Visits),
            "last_visit" => Ok(Self::LastVisit),
            _ => Err(CourseError::BadRequest("unknown customer summary sort")),
        }
    }
}

/// Which slice of the ledger to ring.
///
/// The filters are the segment. "Came at least five times, spent at least this
/// much, and has not been seen for ninety days" is the whole of what the desk
/// means by a list worth calling, and it is the reason this type exists rather
/// than a bare page of rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerSummaryQuery {
    pub sort: CustomerSummarySort,
    /// Descending by default: the biggest spender, the longest absence, the
    /// most frequent visitor are all the top of their order.
    pub descending: bool,
    /// Days since the last round played. The dormant-customer filter, and the
    /// literal shape of "we have not seen them in a while".
    pub min_days_since_last_visit: Option<u32>,
    /// Days since the last round, from above — for ringing people who came
    /// recently rather than people who stopped.
    pub max_days_since_last_visit: Option<u32>,
    pub min_visits: Option<u32>,
    pub min_total_amount: Option<i64>,
    /// People in the ledger who have never played here.
    ///
    /// Excluded by default. "Please come again" is not a call you can make to
    /// somebody who has not been, and a list that opens with hundreds of them
    /// is the eyeballing this screen exists to end.
    pub include_never_visited: bool,
    pub limit: u32,
    pub offset: u32,
}

impl Default for CustomerSummaryQuery {
    fn default() -> Self {
        Self {
            sort: CustomerSummarySort::TotalAmount,
            descending: true,
            min_days_since_last_visit: None,
            max_days_since_last_visit: None,
            min_visits: None,
            min_total_amount: None,
            include_never_visited: false,
            limit: DEFAULT_SUMMARY_PAGE,
            offset: 0,
        }
    }
}

impl CustomerSummaryQuery {
    /// The absolute instant a "not seen for N days" filter compares against.
    ///
    /// Resolved from the caller's clock rather than the database's: the rest of
    /// the domain takes `now` as an argument so tests are not at the mercy of
    /// what time it is, and a filter answering differently in CI than at the
    /// desk would be the one bug nobody reproduces.
    pub fn last_visit_before(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.min_days_since_last_visit
            .map(|days| now - Duration::days(i64::from(days)))
    }

    pub fn last_visit_after(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.max_days_since_last_visit
            .map(|days| now - Duration::days(i64::from(days)))
    }

    /// Refuse a window that can never match rather than answering it emptily.
    ///
    /// "Away for more than 90 days but fewer than 30" returns nothing, and an
    /// empty list reads at the desk as "nobody to call" rather than as a
    /// mistyped filter.
    pub fn validate(&self) -> Result<(), CourseError> {
        if let (Some(min), Some(max)) = (
            self.min_days_since_last_visit,
            self.max_days_since_last_visit,
        ) {
            if min > max {
                return Err(CourseError::BadRequest(
                    "the days-since-last-visit window is empty",
                ));
            }
        }
        Ok(())
    }

    pub fn with_paging(mut self, limit: Option<u32>, offset: Option<u32>) -> Self {
        self.limit = limit
            .unwrap_or(DEFAULT_SUMMARY_PAGE)
            .clamp(1, MAX_SUMMARY_PAGE);
        self.offset = offset.unwrap_or(0);
        self
    }
}

/// How the last refresh went.
///
/// Read next to the list, because nothing in the figures themselves says they
/// are three months old. A refresh that quietly stopped running leaves a table
/// of plausible numbers and a desk ringing people who came in last week.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerSummaryRun {
    pub id: i64,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: CustomerSummaryRunStatus,
    pub reservations_scanned: i64,
    pub customers_written: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomerSummaryRunStatus {
    Running,
    Succeeded,
    Failed,
}

impl CustomerSummaryRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }

    /// Trusted input from CourseBoard's own rows. An unrecognised status reads
    /// as `Running` — the one answer that makes the screen say "we do not know
    /// that this finished" rather than claiming a success that never happened.
    pub fn from_stored(value: &str) -> Self {
        match value {
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            _ => Self::Running,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
    }

    #[test]
    fn dormancy_is_a_cutoff_taken_from_the_callers_clock() {
        let query = CustomerSummaryQuery {
            min_days_since_last_visit: Some(90),
            ..CustomerSummaryQuery::default()
        };
        assert_eq!(
            query.last_visit_before(at(2026, 8, 31)),
            Some(at(2026, 6, 2))
        );
        assert_eq!(query.last_visit_after(at(2026, 8, 31)), None);
    }

    #[test]
    fn an_empty_window_is_refused_rather_than_answered_with_nobody() {
        // An empty list reads as "nobody to call", which is exactly the wrong
        // thing for the desk to conclude from a mistyped filter.
        let query = CustomerSummaryQuery {
            min_days_since_last_visit: Some(90),
            max_days_since_last_visit: Some(30),
            ..CustomerSummaryQuery::default()
        };
        assert!(query.validate().is_err());

        let ok = CustomerSummaryQuery {
            min_days_since_last_visit: Some(30),
            max_days_since_last_visit: Some(90),
            ..CustomerSummaryQuery::default()
        };
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn every_sort_has_a_column_and_survives_a_round_trip() {
        for sort in [
            CustomerSummarySort::TotalAmount,
            CustomerSummarySort::Visits,
            CustomerSummarySort::LastVisit,
        ] {
            assert_eq!(CustomerSummarySort::parse(sort.as_str()).unwrap(), sort);
            assert!(!sort.column().is_empty());
        }
        assert!(CustomerSummarySort::parse("name").is_err());
    }

    #[test]
    fn paging_is_clamped_to_what_a_morning_of_calls_can_be() {
        let query = CustomerSummaryQuery::default().with_paging(Some(10_000), Some(50));
        assert_eq!(query.limit, MAX_SUMMARY_PAGE);
        assert_eq!(query.offset, 50);
        assert_eq!(
            CustomerSummaryQuery::default()
                .with_paging(None, None)
                .limit,
            DEFAULT_SUMMARY_PAGE
        );
    }

    #[test]
    fn an_unfinished_run_is_never_read_back_as_a_success() {
        assert_eq!(
            CustomerSummaryRunStatus::from_stored("succeeded"),
            CustomerSummaryRunStatus::Succeeded
        );
        assert_eq!(
            CustomerSummaryRunStatus::from_stored("something-new"),
            CustomerSummaryRunStatus::Running
        );
    }
}
