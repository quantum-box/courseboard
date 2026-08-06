//! What each caddie is owed for a month, and what needs a second look before
//! the sheet is handed to payroll.
//!
//! Field aggregated this for us until now. Golf operations belong here
//! (ADR-0005), and the pieces — the roster, the month's assignments, the
//! attendance the operator recorded — are already read by CourseBoard.
//!
//! Everything in this module is pure. The worked and rostered minutes arrive
//! already summed; this decides who they belong to and what to flag.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;

use super::{AssignmentStatus, CaddieAssignment, PayrollRow};

/// Minutes a staff member worked and was rostered for over the month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct WorkedMinutes {
    pub worked: i64,
    pub shifted: i64,
}

/// One caddie as the payroll sheet sees them.
#[derive(Debug, Clone, PartialEq)]
pub struct PayrollCandidate {
    pub caddie_id: String,
    pub display_name: String,
    /// `None` when the caddie has no staff record, so no clock-in can exist.
    pub staff_id: Option<String>,
}

/// Attendance for one caddie on one day, as the operator recorded it.
#[derive(Debug, Clone, PartialEq)]
pub struct AttendanceDay {
    pub caddie_id: String,
    pub date: NaiveDate,
    /// `working` means a clock-in with no clock-out yet.
    pub status: String,
}

/// Currency the fees are already denominated in. Assignments carry their own,
/// so this only stands in when the month has none to read.
const FALLBACK_CURRENCY: &str = "JPY";

fn is_billable(assignment: &CaddieAssignment) -> bool {
    // A cancelled round was not worked, so it is neither counted nor paid.
    assignment.status() != AssignmentStatus::Cancelled
}

/// Build the month's payroll rows.
///
/// `worked_by_staff` is keyed by staff id because the minutes come from the
/// staff record; everything else is keyed by caddie. A caddie with no staff
/// link therefore has no minutes, which is the truth rather than a gap: without
/// a staff record there is nothing to clock in against.
pub fn summarize_payroll(
    candidates: &[PayrollCandidate],
    assignments: &[CaddieAssignment],
    attendance: &[AttendanceDay],
    worked_by_staff: &HashMap<String, WorkedMinutes>,
) -> Vec<PayrollRow> {
    let mut rounds: HashMap<&str, i64> = HashMap::new();
    let mut fees: HashMap<&str, i64> = HashMap::new();
    let mut currency: Option<String> = None;
    // Which days a caddie actually has a round on, so a missing clock-in can be
    // told apart from a day they were simply not working.
    let mut round_days: HashMap<&str, HashSet<NaiveDate>> = HashMap::new();

    for assignment in assignments.iter().filter(|item| is_billable(item)) {
        let id = assignment.caddie_id();
        *rounds.entry(id).or_insert(0) += 1;
        *fees.entry(id).or_insert(0) += assignment.fee_amount();
        round_days
            .entry(id)
            .or_default()
            .insert(assignment.scheduled_at().date_naive());
        if currency.is_none() {
            let value = assignment.fee_currency().trim();
            if !value.is_empty() {
                currency = Some(value.to_string());
            }
        }
    }

    let mut clocked_days: HashMap<&str, HashSet<NaiveDate>> = HashMap::new();
    let mut open_clock_in: HashSet<&str> = HashSet::new();
    for day in attendance {
        let id = day.caddie_id.as_str();
        match day.status.trim().to_ascii_lowercase().as_str() {
            "working" => {
                // Clocked in and never out. The sheet cannot state hours for a
                // shift that has not ended.
                open_clock_in.insert(id);
                clocked_days.entry(id).or_default().insert(day.date);
            }
            "clocked_out" => {
                clocked_days.entry(id).or_default().insert(day.date);
            }
            _ => {}
        }
    }

    let currency = currency.unwrap_or_else(|| FALLBACK_CURRENCY.to_string());

    candidates
        .iter()
        .map(|candidate| {
            let id = candidate.caddie_id.as_str();
            let minutes = candidate
                .staff_id
                .as_deref()
                .and_then(|staff| worked_by_staff.get(staff))
                .copied()
                .unwrap_or_default();
            let clocked = clocked_days.get(id);
            let rounds_without_clock_in = round_days
                .get(id)
                .map(|days| {
                    days.iter()
                        .filter(|date| !clocked.is_some_and(|c| c.contains(date)))
                        .count() as i64
                })
                .unwrap_or(0);

            PayrollRow::reconstitute(
                candidate.caddie_id.clone(),
                candidate.display_name.clone(),
                candidate.staff_id.clone(),
                minutes.worked,
                minutes.shifted,
                rounds.get(id).copied().unwrap_or(0),
                fees.get(id).copied().unwrap_or(0),
                currency.clone(),
                open_clock_in.contains(id),
                rounds_without_clock_in,
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{AssignmentRole, CaddieAssignment};
    use chrono::{DateTime, Utc};

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }

    fn day(text: &str) -> NaiveDate {
        text.parse().expect("valid date")
    }

    fn assignment(caddie: &str, when: &str, fee: i64, status: &str) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            format!("asn_{caddie}_{when}"),
            caddie,
            None::<String>,
            None::<String>,
            at(when),
            Some(270),
            status,
            AssignmentRole::Primary.as_str(),
            fee,
            "JPY",
            None,
        )
        .expect("assignment")
    }

    fn candidate(id: &str, staff: Option<&str>) -> PayrollCandidate {
        PayrollCandidate {
            caddie_id: id.to_string(),
            display_name: id.to_string(),
            staff_id: staff.map(str::to_string),
        }
    }

    fn minutes(staff: &str, worked: i64, shifted: i64) -> HashMap<String, WorkedMinutes> {
        HashMap::from([(staff.to_string(), WorkedMinutes { worked, shifted })])
    }

    #[test]
    fn a_caddie_who_did_nothing_still_appears_on_the_sheet() {
        // Omitting them would read as "already paid" rather than "no work".
        let rows = summarize_payroll(
            &[candidate("idle", Some("staff_idle"))],
            &[],
            &[],
            &HashMap::new(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].assigned_rounds(), 0);
        assert_eq!(rows[0].worked_minutes(), 0);
    }

    #[test]
    fn rounds_and_fees_add_up_over_the_month() {
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[
                assignment("a", "2026-07-03T00:00:00Z", 12_000, "completed"),
                assignment("a", "2026-07-11T00:00:00Z", 12_000, "completed"),
            ],
            &[],
            &minutes("staff_a", 900, 960),
        );
        assert_eq!(rows[0].assigned_rounds(), 2);
        assert_eq!(rows[0].confirmed_fee_total(), 24_000);
        assert_eq!(rows[0].worked_minutes(), 900);
        assert_eq!(rows[0].shifted_minutes(), 960);
    }

    #[test]
    fn a_cancelled_round_is_neither_counted_nor_paid() {
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[
                assignment("a", "2026-07-03T00:00:00Z", 12_000, "completed"),
                assignment("a", "2026-07-04T00:00:00Z", 12_000, "cancelled"),
            ],
            &[],
            &HashMap::new(),
        );
        assert_eq!(rows[0].assigned_rounds(), 1);
        assert_eq!(rows[0].confirmed_fee_total(), 12_000);
    }

    #[test]
    fn a_round_on_a_day_with_no_clock_in_is_flagged() {
        // The pair payroll has to reconcile by hand: work happened, hours did not.
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[
                assignment("a", "2026-07-03T00:00:00Z", 12_000, "completed"),
                assignment("a", "2026-07-04T00:00:00Z", 12_000, "completed"),
            ],
            &[AttendanceDay {
                caddie_id: "a".to_string(),
                date: day("2026-07-03"),
                status: "clocked_out".to_string(),
            }],
            &HashMap::new(),
        );
        assert_eq!(
            rows[0].rounds_without_clock_in(),
            1,
            "only the 4th is unmatched"
        );
    }

    #[test]
    fn two_rounds_on_one_clocked_day_count_as_matched() {
        // A caddie playing twice in a day clocks in once, not twice.
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[
                assignment("a", "2026-07-03T00:00:00Z", 12_000, "completed"),
                assignment("a", "2026-07-03T06:00:00Z", 12_000, "completed"),
            ],
            &[AttendanceDay {
                caddie_id: "a".to_string(),
                date: day("2026-07-03"),
                status: "clocked_out".to_string(),
            }],
            &HashMap::new(),
        );
        assert_eq!(rows[0].assigned_rounds(), 2);
        assert_eq!(rows[0].rounds_without_clock_in(), 0);
    }

    #[test]
    fn a_shift_that_never_ended_is_called_out() {
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[],
            &[AttendanceDay {
                caddie_id: "a".to_string(),
                date: day("2026-07-09"),
                status: "working".to_string(),
            }],
            &HashMap::new(),
        );
        assert!(
            rows[0].open_clock_in(),
            "an unclosed shift has no hours yet"
        );
    }

    #[test]
    fn a_caddie_with_no_staff_link_reports_no_hours_rather_than_someone_elses() {
        let rows = summarize_payroll(
            &[candidate("unlinked", None)],
            &[assignment(
                "unlinked",
                "2026-07-03T00:00:00Z",
                12_000,
                "completed",
            )],
            &[],
            &minutes("staff_a", 900, 960),
        );
        assert_eq!(rows[0].worked_minutes(), 0);
        assert_eq!(rows[0].assigned_rounds(), 1, "the round still counts");
    }

    #[test]
    fn the_currency_comes_from_the_rounds_that_were_actually_worked() {
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[assignment("a", "2026-07-03T00:00:00Z", 12_000, "completed")],
            &[],
            &HashMap::new(),
        );
        assert_eq!(rows[0].currency(), "JPY");

        // A month with no rounds has no currency to read.
        let empty = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[],
            &[],
            &HashMap::new(),
        );
        assert_eq!(empty[0].currency(), FALLBACK_CURRENCY);
    }
}
