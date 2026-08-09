//! Deadline for filing a caddie's shift request for one calendar month.
//!
//! Shift requests are still gathered by word of mouth and typed in by the
//! caddie master (see caddie_ops.rs: a day with no request on file reads as
//! `Available`, the same as a day someone actively confirmed). A request that
//! never reached the desk is invisible until the day it causes a caddie to be
//! assigned somewhere they cannot work. This deadline gives the desk a date to
//! check submissions against; Field's shift-request API has no notion of a
//! filing deadline, so it is CourseBoard's own data (ADR-0005).

use chrono::{Datelike, NaiveDate};

use super::CourseError;

/// A calendar month, `YYYY-MM`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct YearMonth {
    year: i32,
    month: u32,
}

impl YearMonth {
    pub fn parse(raw: &str) -> Result<Self, CourseError> {
        let trimmed = raw.trim();
        let (year_part, month_part) = trimmed
            .split_once('-')
            .ok_or(CourseError::BadRequest("year-month must look like YYYY-MM"))?;
        if year_part.len() != 4 || month_part.len() != 2 {
            return Err(CourseError::BadRequest("year-month must look like YYYY-MM"));
        }
        let year: i32 = year_part
            .parse()
            .map_err(|_| CourseError::BadRequest("year-month must look like YYYY-MM"))?;
        let month: u32 = month_part
            .parse()
            .map_err(|_| CourseError::BadRequest("year-month must look like YYYY-MM"))?;
        if !(1..=12).contains(&month) {
            return Err(CourseError::BadRequest("year-month must look like YYYY-MM"));
        }
        Ok(Self { year, month })
    }

    pub fn from_date(date: NaiveDate) -> Self {
        Self {
            year: date.year(),
            month: date.month(),
        }
    }

    pub fn as_string(&self) -> String {
        format!("{:04}-{:02}", self.year, self.month)
    }

    /// The first and last calendar day of the month, inclusive.
    pub fn bounds(&self) -> (NaiveDate, NaiveDate) {
        let start = NaiveDate::from_ymd_opt(self.year, self.month, 1)
            .expect("month is validated to 1..=12");
        let next_month_start = if self.month == 12 {
            NaiveDate::from_ymd_opt(self.year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(self.year, self.month + 1, 1)
        }
        .expect("adjacent month is always representable");
        let end = next_month_start
            .pred_opt()
            .expect("the day before the 1st always exists");
        (start, end)
    }
}

/// One tenant's filing deadline for one calendar month's shift requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AvailabilityDeadline {
    year_month: YearMonth,
    deadline_date: NaiveDate,
}

impl AvailabilityDeadline {
    pub fn try_new(year_month: YearMonth, deadline_date: NaiveDate) -> Self {
        Self {
            year_month,
            deadline_date,
        }
    }

    /// Rebuild from storage, which already holds a validated month.
    pub fn reconstitute(year_month: YearMonth, deadline_date: NaiveDate) -> Self {
        Self {
            year_month,
            deadline_date,
        }
    }

    pub fn year_month(&self) -> YearMonth {
        self.year_month
    }

    pub fn deadline_date(&self) -> NaiveDate {
        self.deadline_date
    }

    /// Whether `today` is after the filing deadline — the point at which a
    /// caddie with no request on file is not "hasn't gotten to it yet" but
    /// "missed the window".
    pub fn has_passed(&self, today: NaiveDate) -> bool {
        today > self.deadline_date
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_well_formed_month_parses() {
        let month = YearMonth::parse("2026-08").unwrap();
        assert_eq!(month.as_string(), "2026-08");
    }

    #[test]
    fn a_month_out_of_range_is_refused() {
        for raw in ["2026-00", "2026-13", "2026-8", "26-08", "august", ""] {
            assert!(YearMonth::parse(raw).is_err(), "{raw} should be refused");
        }
    }

    #[test]
    fn month_bounds_span_the_whole_month() {
        let month = YearMonth::parse("2026-02").unwrap();
        let (start, end) = month.bounds();
        assert_eq!(start, NaiveDate::from_ymd_opt(2026, 2, 1).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    }

    #[test]
    fn december_rolls_into_next_years_january() {
        let month = YearMonth::parse("2026-12").unwrap();
        let (start, end) = month.bounds();
        assert_eq!(start, NaiveDate::from_ymd_opt(2026, 12, 1).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2026, 12, 31).unwrap());
    }

    #[test]
    fn the_deadline_day_itself_has_not_passed_yet() {
        let deadline = AvailabilityDeadline::try_new(
            YearMonth::parse("2026-08").unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
        );
        assert!(!deadline.has_passed(NaiveDate::from_ymd_opt(2026, 7, 20).unwrap()));
        assert!(deadline.has_passed(NaiveDate::from_ymd_opt(2026, 7, 21).unwrap()));
    }
}
