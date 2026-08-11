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
use chrono_tz::Tz;

use super::{
    AssignmentStatus, CaddieAssignment, CaddieRank, CaddieRankFees, PayrollRow, PayrollSummary,
};

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
    /// The grade the club gave them, which decides what a round pays.
    pub rank: CaddieRank,
    /// Their own per-round fee, or `0` when they are paid by their rank.
    pub base_fee_amount: i64,
}

/// Attendance for one caddie on one day, as the operator recorded it.
#[derive(Debug, Clone, PartialEq)]
pub struct AttendanceDay {
    pub caddie_id: String,
    pub date: NaiveDate,
    /// `working` means a clock-in with no clock-out yet.
    pub status: String,
}

fn is_billable(assignment: &CaddieAssignment) -> bool {
    // A cancelled round was not worked, so it is neither counted nor paid.
    assignment.status() != AssignmentStatus::Cancelled
}

/// Build the month's payroll rows.
///
/// The amount is priced here rather than read off the assignments. Field stamps
/// a fee on a round when it is assigned, and that stamp is a snapshot of a rate
/// that may since have been corrected — a club that fixes a wrong rank fee
/// expects the month to be right, not the rounds booked before the fix to keep
/// paying the old amount. So every month is `round fee × rounds worked`, priced
/// off the table as it stands now.
///
/// `worked_by_staff` is keyed by staff id because the minutes come from the
/// staff record; everything else is keyed by caddie. A caddie with no staff
/// link therefore has no minutes, which is the truth rather than a gap: without
/// a staff record there is nothing to clock in against.
#[cfg(test)]
fn summarize_payroll(
    candidates: &[PayrollCandidate],
    assignments: &[CaddieAssignment],
    attendance: &[AttendanceDay],
    worked_by_staff: &HashMap<String, WorkedMinutes>,
    rank_fees: &CaddieRankFees,
) -> Vec<PayrollRow> {
    summarize_payroll_in_timezone(
        candidates,
        assignments,
        attendance,
        worked_by_staff,
        rank_fees,
        chrono_tz::Asia::Tokyo,
    )
}

pub fn summarize_payroll_in_timezone(
    candidates: &[PayrollCandidate],
    assignments: &[CaddieAssignment],
    attendance: &[AttendanceDay],
    worked_by_staff: &HashMap<String, WorkedMinutes>,
    rank_fees: &CaddieRankFees,
    timezone: Tz,
) -> Vec<PayrollRow> {
    let mut rounds: HashMap<&str, i64> = HashMap::new();
    // Which days a caddie actually has a round on, so a missing clock-in can be
    // told apart from a day they were simply not working.
    let mut round_days: HashMap<&str, HashSet<NaiveDate>> = HashMap::new();

    for assignment in assignments.iter().filter(|item| is_billable(item)) {
        let id = assignment.caddie_id();
        *rounds.entry(id).or_insert(0) += 1;
        round_days.entry(id).or_default().insert(
            assignment
                .scheduled_at()
                .with_timezone(&timezone)
                .date_naive(),
        );
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
                candidate.rank,
                rank_fees.round_fee_for(candidate.rank, candidate.base_fee_amount),
                candidate.base_fee_amount > 0,
                rank_fees.currency(),
                open_clock_in.contains(id),
                rounds_without_clock_in,
            )
        })
        .collect()
}

/// Column order of the exported sheet.
///
/// Deliberately the same names the API answers with, and deliberately ASCII:
/// the file is opened in Excel, which reads a UTF-8 header without a byte-order
/// mark as mojibake. The amounts are the reason to export, and they are digits
/// in any locale.
const CSV_HEADER: &str = "yearMonth,caddieProfileId,displayName,staffId,rank,roundFee,\
feeOverridden,assignedRounds,feeTotal,currency,workedMinutes,shiftedMinutes,openClockIn,\
roundsWithoutClockIn";

/// A field as CSV: quoted only when it would otherwise break the row.
fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// The month's sheet as a CSV file.
///
/// Built from the same rows the screen shows, so the file an operator hands to
/// accounting says what they were looking at when they pressed the button.
pub fn payroll_csv(summary: &PayrollSummary) -> String {
    let year_month = summary.period().year_month();
    let mut out = String::from(CSV_HEADER);
    for row in summary.items() {
        out.push('\n');
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
            csv_field(year_month),
            csv_field(row.caddie_id().as_str()),
            csv_field(row.display_name()),
            csv_field(row.staff_id().unwrap_or_default()),
            row.rank().as_str(),
            row.round_fee(),
            row.fee_overridden(),
            row.assigned_rounds(),
            row.fee_total(),
            csv_field(row.currency()),
            row.worked_minutes(),
            row.shifted_minutes(),
            row.open_clock_in(),
            row.rounds_without_clock_in(),
        ));
    }
    out.push('\n');
    out
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

    /// `stamped_fee` is what Field recorded on the round when it was assigned.
    /// The sheet prices the month itself, so it should make no difference.
    fn assignment(caddie: &str, when: &str, stamped_fee: i64, status: &str) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            format!("asn_{caddie}_{when}"),
            caddie,
            None::<String>,
            None::<String>,
            at(when),
            Some(270),
            status,
            AssignmentRole::Primary.as_str(),
            stamped_fee,
            "JPY",
            None,
        )
        .expect("assignment")
    }

    fn fees() -> CaddieRankFees {
        CaddieRankFees::try_new(12_000, 11_000, 10_000, 9_000, "JPY").expect("valid table")
    }

    fn candidate(id: &str, staff: Option<&str>) -> PayrollCandidate {
        ranked(id, staff, CaddieRank::C, 0)
    }

    fn ranked(
        id: &str,
        staff: Option<&str>,
        rank: CaddieRank,
        base_fee_amount: i64,
    ) -> PayrollCandidate {
        PayrollCandidate {
            caddie_id: id.to_string(),
            display_name: id.to_string(),
            staff_id: staff.map(str::to_string),
            rank,
            base_fee_amount,
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
            &fees(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].assigned_rounds(), 0);
        assert_eq!(rows[0].worked_minutes(), 0);
        assert_eq!(rows[0].fee_total(), 0, "no rounds is no pay, not one round");
    }

    #[test]
    fn the_month_is_the_round_fee_times_the_rounds_worked() {
        let rows = summarize_payroll(
            &[ranked("a", Some("staff_a"), CaddieRank::B, 0)],
            &[
                assignment("a", "2026-07-03T00:00:00Z", 0, "completed"),
                assignment("a", "2026-07-11T00:00:00Z", 0, "completed"),
            ],
            &[],
            &minutes("staff_a", 900, 960),
            &fees(),
        );
        assert_eq!(rows[0].assigned_rounds(), 2);
        assert_eq!(rows[0].round_fee(), 11_000);
        assert_eq!(rows[0].fee_total(), 22_000);
        assert_eq!(rows[0].worked_minutes(), 900);
        assert_eq!(rows[0].shifted_minutes(), 960);
    }

    #[test]
    fn two_caddies_on_the_same_round_are_paid_by_their_own_rank() {
        // The whole point of ranking: same tee time, different pay.
        let rows = summarize_payroll(
            &[
                ranked("top", Some("staff_top"), CaddieRank::A, 0),
                ranked("new", Some("staff_new"), CaddieRank::D, 0),
            ],
            &[
                assignment("top", "2026-07-03T00:00:00Z", 0, "completed"),
                assignment("new", "2026-07-03T00:00:00Z", 0, "completed"),
            ],
            &[],
            &HashMap::new(),
            &fees(),
        );
        assert_eq!(rows[0].fee_total(), 12_000);
        assert_eq!(rows[1].fee_total(), 9_000);
    }

    #[test]
    fn a_caddie_with_a_fee_of_their_own_is_paid_that_instead_of_their_rank() {
        let rows = summarize_payroll(
            &[ranked("veteran", Some("staff_v"), CaddieRank::D, 15_000)],
            &[assignment(
                "veteran",
                "2026-07-03T00:00:00Z",
                0,
                "completed",
            )],
            &[],
            &HashMap::new(),
            &fees(),
        );
        assert_eq!(rows[0].round_fee(), 15_000);
        assert!(
            rows[0].fee_overridden(),
            "the sheet has to say why this one differs from its rank"
        );
    }

    #[test]
    fn the_fee_stamped_on_the_round_does_not_decide_the_month() {
        // Field stamps the rate that was current when the round was assigned.
        // Correcting the table has to correct the month, not leave the rounds
        // booked before the fix paying the old amount.
        let rows = summarize_payroll(
            &[ranked("a", Some("staff_a"), CaddieRank::A, 0)],
            &[assignment("a", "2026-07-03T00:00:00Z", 3, "completed")],
            &[],
            &HashMap::new(),
            &fees(),
        );
        assert_eq!(rows[0].fee_total(), 12_000);
    }

    #[test]
    fn a_cancelled_round_is_neither_counted_nor_paid() {
        let rows = summarize_payroll(
            &[ranked("a", Some("staff_a"), CaddieRank::C, 0)],
            &[
                assignment("a", "2026-07-03T00:00:00Z", 12_000, "completed"),
                assignment("a", "2026-07-04T00:00:00Z", 12_000, "cancelled"),
            ],
            &[],
            &HashMap::new(),
            &fees(),
        );
        assert_eq!(rows[0].assigned_rounds(), 1);
        assert_eq!(rows[0].fee_total(), 10_000);
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
            &fees(),
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
            &fees(),
        );
        assert_eq!(rows[0].assigned_rounds(), 2);
        assert_eq!(rows[0].rounds_without_clock_in(), 0);
        assert_eq!(
            rows[0].fee_total(),
            20_000,
            "both rounds are paid even though there was one clock-in"
        );
    }

    #[test]
    fn round_days_are_matched_in_the_tenant_timezone() {
        let rows = summarize_payroll_in_timezone(
            &[candidate("a", Some("staff_a"))],
            &[assignment("a", "2026-07-01T22:30:00Z", 12_000, "completed")],
            &[AttendanceDay {
                caddie_id: "a".to_string(),
                date: day("2026-07-02"),
                status: "clocked_out".to_string(),
            }],
            &HashMap::new(),
            &fees(),
            chrono_tz::Europe::Berlin,
        );
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
            &fees(),
        );
        assert!(
            rows[0].open_clock_in(),
            "an unclosed shift has no hours yet"
        );
    }

    #[test]
    fn a_caddie_with_no_staff_link_reports_no_hours_rather_than_someone_elses() {
        let rows = summarize_payroll(
            &[ranked("unlinked", None, CaddieRank::C, 0)],
            &[assignment(
                "unlinked",
                "2026-07-03T00:00:00Z",
                12_000,
                "completed",
            )],
            &[],
            &minutes("staff_a", 900, 960),
            &fees(),
        );
        assert_eq!(rows[0].worked_minutes(), 0);
        assert_eq!(rows[0].assigned_rounds(), 1, "the round still counts");
        assert_eq!(rows[0].fee_total(), 10_000, "and is still paid");
    }

    #[test]
    fn the_sheet_is_denominated_in_the_currency_the_table_is_written_in() {
        let rows = summarize_payroll(
            &[candidate("a", Some("staff_a"))],
            &[],
            &[],
            &HashMap::new(),
            &CaddieRankFees::try_new(120, 110, 100, 90, "USD").expect("valid table"),
        );
        assert_eq!(rows[0].currency(), "USD");
    }
}

#[cfg(test)]
mod csv_tests {
    use super::tests_support::*;
    use super::*;

    #[test]
    fn the_file_carries_the_amounts_the_screen_showed() {
        let csv = payroll_csv(&summary(vec![row("佐藤", CaddieRank::A, 12_000, 3)]));
        let mut lines = csv.lines();
        assert_eq!(lines.next(), Some(CSV_HEADER));
        let body = lines.next().expect("one caddie, one row");
        assert!(body.contains(",A,12000,"), "rank and unit fee: {body}");
        assert!(body.ends_with("3,36000,JPY,0,0,false,0"), "total: {body}");
    }

    #[test]
    fn a_name_with_a_comma_does_not_shift_every_column_after_it() {
        let csv = payroll_csv(&summary(vec![row("Smith, John", CaddieRank::C, 10_000, 1)]));
        assert!(csv.contains("\"Smith, John\""));
    }

    #[test]
    fn a_month_with_nobody_on_it_is_still_a_readable_file() {
        // A bare header opens; an empty file looks like the download failed.
        assert_eq!(payroll_csv(&summary(Vec::new())), format!("{CSV_HEADER}\n"));
    }
}

/// Fixtures shared by the CSV tests. Kept out of `tests` so the module above
/// stays about pricing a month.
#[cfg(test)]
mod tests_support {
    use super::*;

    pub fn row(name: &str, rank: CaddieRank, round_fee: i64, rounds: i64) -> PayrollRow {
        PayrollRow::reconstitute(
            format!("cad_{name}"),
            name,
            None,
            0,
            0,
            rounds,
            rank,
            round_fee,
            false,
            "JPY",
            false,
            0,
        )
    }

    pub fn summary(rows: Vec<PayrollRow>) -> PayrollSummary {
        PayrollSummary::new(
            crate::course::domain::PayrollPeriod::try_new("2026-07").expect("a real month"),
            rows,
        )
    }
}
