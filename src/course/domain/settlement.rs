//! What a month took, and what it owes the caddies who walked it.
//!
//! Field worked this out in SQL and CourseBoard relayed the answer. Which
//! rounds belong to a month, and what a round was worth to the caddie on it,
//! are golf's own judgements (ADR-0005 Phase 1) — a business-agnostic ERP has
//! no basis for making them.
//!
//! Everything here is pure. The arithmetic deliberately mirrors Field's, down
//! to which bookings are counted and where the clamp sits, because the two run
//! side by side until a whole close is shown to agree. A difference introduced
//! on purpose would be indistinguishable from one introduced by mistake.
//!
//! Two blocks are still Field's: what is outstanding on cancellations, and the
//! Square reconciliation. Both are noted where they are merged back in.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;

use super::payroll::csv_field;
use super::{
    AssignmentStatus, CaddieAssignment, CourseError, MonthlySettlement, PayrollPeriod, Reservation,
    ReservationId, SettlementPeriod,
};

/// What a booking or a round is priced in when it says nothing else.
const DEFAULT_CURRENCY: &str = "JPY";

/// How many bookings the drill-down lists, and how many the export writes.
///
/// Both caps are Field's. The totals above them are uncapped, so a busy month
/// adds up more bookings than either list shows — the totals are the figure
/// that has to be right, and the lists are there to spot-check them.
const DRILLDOWN_LIMIT: usize = 200;
const EXPORT_LINE_LIMIT: usize = 500;

/// A named month, and the span of time it actually covers.
///
/// The month is the club's, not UTC's: an 07:00 tee time in Tokyo on the first
/// belongs to that month, and a span cut in UTC would file it under the last.
/// The span is half-open so a local midnight lands in exactly one month rather
/// than in both or neither.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettlementWindow {
    period: SettlementPeriod,
    start: DateTime<Utc>,
    end_exclusive: DateTime<Utc>,
}

impl SettlementWindow {
    pub fn try_new(year_month: &str, timezone: Tz) -> Result<Self, CourseError> {
        // A settlement month is the same calendar month a payroll month is —
        // first day to last, leap years and December included — so the two are
        // not spelled out twice.
        let month = PayrollPeriod::try_new(year_month)?;
        let start = local_midnight(month.start_date(), timezone).ok_or(CourseError::BadRequest(
            "the month does not begin at a midnight in the club's timezone",
        ))?;
        let end_exclusive = month
            .end_date()
            .succ_opt()
            .and_then(|day| local_midnight(day, timezone))
            .ok_or(CourseError::BadRequest(
                "the month does not end at a midnight in the club's timezone",
            ))?;
        Ok(Self {
            period: SettlementPeriod::new(month.year_month(), month.start_date(), month.end_date()),
            start,
            end_exclusive,
        })
    }

    pub fn period(&self) -> &SettlementPeriod {
        &self.period
    }

    /// Whether an instant falls inside the month.
    pub fn contains(&self, at: DateTime<Utc>) -> bool {
        at >= self.start && at < self.end_exclusive
    }

    /// The dates to ask upstream for, a day wider at each end.
    ///
    /// Upstream filters by local date and this window is an absolute span, so
    /// the extra day guarantees the rounds either side of a boundary arrive.
    /// [`SettlementWindow::contains`] then decides which of them the month
    /// keeps; asking for exactly the month would lose the ones that matter.
    pub fn fetch_from(&self) -> NaiveDate {
        let start = self.period.start_date();
        start.pred_opt().unwrap_or(start)
    }

    pub fn fetch_to(&self) -> NaiveDate {
        let end = self.period.end_date();
        end.succ_opt().unwrap_or(end)
    }
}

/// Midnight on `date` in the club's timezone, as an instant.
///
/// A midnight the clock passes twice resolves to the first of the two, so no
/// hour is counted into the month twice. A midnight the clock skips has no
/// instant at all; the month is refused rather than quietly shifted an hour,
/// which is what upstream does and is the only honest answer.
fn local_midnight(date: NaiveDate, timezone: Tz) -> Option<DateTime<Utc>> {
    timezone
        .from_local_datetime(&date.and_hms_opt(0, 0, 0)?)
        .earliest()
        .map(|at| at.with_timezone(&Utc))
}

/// What the month's bookings came to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReservationTotals {
    pub gross_amount: i64,
    pub collected_amount: i64,
    pub refunded_amount: i64,
    pub payment_pending_amount: i64,
    pub reservation_count: i64,
}

/// Payment states that mean money went back, or is about to.
fn is_refund(payment_status: Option<&str>) -> bool {
    payment_status.is_some_and(|status| {
        let status = status.trim();
        status.eq_ignore_ascii_case("refunded") || status.eq_ignore_ascii_case("refund_pending")
    })
}

/// Add up every booking that starts in the month.
///
/// Cancelled and rejected bookings are counted here, unlike the day's takings
/// on the budget screen. The close is a reconciliation rather than a
/// performance figure: money taken against a round that was later called off
/// still has to appear somewhere the accountant can find it, and what is
/// outstanding on those cancellations is reported separately.
///
/// The shortfall is clamped per booking rather than on the total, so an
/// overpayment on one round cannot quietly cover what is missing on another.
/// What was refunded is not deducted from what was collected: the two answer
/// different questions, and netting them would hide a refund that has been
/// agreed but not yet sent.
pub fn reservation_totals(
    reservations: &[Reservation],
    window: &SettlementWindow,
) -> ReservationTotals {
    let mut totals = ReservationTotals::default();
    for reservation in reservations
        .iter()
        .filter(|reservation| window.contains(reservation.starts_at()))
    {
        let billing = reservation.billing();
        totals.reservation_count += 1;
        totals.gross_amount += billing.price_amount;
        totals.collected_amount += billing.paid_amount;
        totals.payment_pending_amount += (billing.price_amount - billing.paid_amount).max(0);
        if is_refund(billing.payment_status.as_deref()) {
            totals.refunded_amount += billing.paid_amount;
        }
    }
    totals
}

/// What the month's rounds owe the caddies who walked them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaddieFeeTotals {
    pub total: i64,
    pub assignment_count: i64,
    pub currency: String,
}

impl Default for CaddieFeeTotals {
    fn default() -> Self {
        Self {
            total: 0,
            assignment_count: 0,
            currency: DEFAULT_CURRENCY.to_string(),
        }
    }
}

/// Add up the fees stamped on the month's rounds.
///
/// The stamp is taken as it stands, unlike the payroll sheet, which reprices
/// every round off the rank table as it is today. The two answer different
/// questions: payroll asks what a caddie should be paid, the close asks what
/// the club has already committed to. Repricing here would make the close
/// disagree with the assignments it was built from.
///
/// A cancelled round was not walked, so it is neither counted nor owed.
pub fn caddie_fee_totals(
    assignments: &[CaddieAssignment],
    window: &SettlementWindow,
) -> CaddieFeeTotals {
    let mut total = 0;
    let mut assignment_count = 0;
    let mut currency = String::new();
    for assignment in assignments.iter().filter(|assignment| {
        window.contains(assignment.scheduled_at())
            && matches!(
                assignment.status(),
                AssignmentStatus::Assigned | AssignmentStatus::Completed
            )
    }) {
        total += assignment.fee_amount();
        assignment_count += 1;
        // A club settles in one currency, so this labels the total rather than
        // converting anything. Taking the greatest of them is what upstream
        // does; keeping that means a month with two currencies reads the same
        // either side of the switch, which is what the comparison needs.
        if assignment.fee_currency() > currency.as_str() {
            currency = assignment.fee_currency().to_string();
        }
    }
    CaddieFeeTotals {
        total,
        assignment_count,
        currency: if currency.is_empty() {
            DEFAULT_CURRENCY.to_string()
        } else {
            currency
        },
    }
}

/// One booking as the export lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementReservationLine {
    pub reservation_id: ReservationId,
    pub reservation_number: String,
    pub status: String,
    pub payment_status: String,
    pub price_amount: i64,
    pub paid_amount: i64,
    pub currency: String,
}

/// The month's bookings, latest tee time first.
///
/// The drill-down and the export read the same order, so the ids on the screen
/// and the rows in the file line up. Latest first because a month is checked
/// from its end, and both lists are capped — the oldest rounds are the ones to
/// drop when a month runs long.
pub fn settlement_reservation_lines(
    reservations: &[Reservation],
    window: &SettlementWindow,
) -> Vec<SettlementReservationLine> {
    let mut rows: Vec<&Reservation> = reservations
        .iter()
        .filter(|reservation| window.contains(reservation.starts_at()))
        .collect();
    rows.sort_by(|left, right| {
        right
            .starts_at()
            .cmp(&left.starts_at())
            .then_with(|| right.id().as_str().cmp(left.id().as_str()))
    });
    rows.into_iter()
        .take(EXPORT_LINE_LIMIT)
        .map(|reservation| {
            let billing = reservation.billing();
            SettlementReservationLine {
                reservation_id: reservation.id().clone(),
                reservation_number: reservation.reservation_number().to_string(),
                status: reservation.status().to_string(),
                payment_status: billing.payment_status.clone().unwrap_or_default(),
                price_amount: billing.price_amount,
                paid_amount: billing.paid_amount,
                currency: billing
                    .currency
                    .clone()
                    .unwrap_or_else(|| DEFAULT_CURRENCY.to_string()),
            }
        })
        .collect()
}

/// The bookings the drill-down names, taken off the head of the export order.
pub fn drilldown_reservation_ids(lines: &[SettlementReservationLine]) -> Vec<ReservationId> {
    lines
        .iter()
        .take(DRILLDOWN_LIMIT)
        .map(|line| line.reservation_id.clone())
        .collect()
}

/// Put CourseBoard's own figures where Field's used to be.
///
/// Two blocks stay upstream's. What is outstanding on cancellations lives in
/// tables CourseBoard cannot read: the business-agnostic report that holds it
/// is quarantined behind an unassigned ERP action, and even once it opens it
/// carries no golf scope and no invoice id. The Square reconciliation has no
/// business-agnostic period summary at all — and CourseBoard collects through
/// Stripe, so reproducing Square here would be work spent on a rail these
/// clubs do not use.
///
/// Both are therefore relayed unchanged rather than zeroed. A zero would read
/// as a quiet, fully reconciled month, which is the one thing a close must
/// never say when it does not know.
pub fn merge_settlement(
    window: &SettlementWindow,
    reservations: ReservationTotals,
    caddie_fees: CaddieFeeTotals,
    reservation_ids: Vec<ReservationId>,
    upstream: &MonthlySettlement,
) -> MonthlySettlement {
    MonthlySettlement::reconstitute(
        window.period().clone(),
        reservations.gross_amount,
        reservations.collected_amount,
        reservations.refunded_amount,
        reservations.payment_pending_amount,
        reservations.reservation_count,
        caddie_fees.total,
        caddie_fees.assignment_count,
        caddie_fees.currency,
        upstream.cancellations_fee_outstanding_amount(),
        upstream.cancellations_count(),
        upstream.square_payments_total(),
        upstream.square_refunds_total(),
        upstream.square_unreconciled_lines(),
        upstream.square_warning().map(str::to_string),
        reservation_ids,
        upstream.unpaid_cancellation_reservation_ids().to_vec(),
        upstream.unpaid_cancellation_items().to_vec(),
    )
}

const SUMMARY_CSV_HEADER: &str = "section,year_month,metric,amount,count,currency";
const RESERVATION_CSV_HEADER: &str =
    "reservation_id,reservation_number,status,payment_status,price_amount,paid_amount,currency";

/// The close as a CSV file: nine summary rows, then a row per booking.
///
/// The header strings, the metric names and the column order are Field's,
/// unchanged. Accounting may well be reading this file with a script, and a
/// renamed column would break it somewhere nobody is watching.
pub fn settlement_csv(report: &MonthlySettlement, lines: &[SettlementReservationLine]) -> String {
    let year_month = csv_field(report.period().year_month());
    let mut out = String::from(SUMMARY_CSV_HEADER);
    let summary: [(&str, i64, i64, &str); 9] = [
        (
            "reservations_gross",
            report.reservations_gross_amount(),
            report.reservation_count(),
            "",
        ),
        (
            "reservations_collected",
            report.reservations_collected_amount(),
            report.reservation_count(),
            "",
        ),
        (
            "reservations_refunded",
            report.reservations_refunded_amount(),
            0,
            "",
        ),
        (
            "reservations_payment_pending",
            report.reservations_payment_pending_amount(),
            0,
            "",
        ),
        (
            "caddie_fees_total",
            report.caddie_fees_total(),
            report.caddie_assignment_count(),
            report.caddie_fees_currency(),
        ),
        (
            "cancellation_fee_outstanding",
            report.cancellations_fee_outstanding_amount(),
            report.cancellations_count(),
            "",
        ),
        (
            "square_payments_total",
            report.square_payments_total(),
            0,
            "",
        ),
        ("square_refunds_total", report.square_refunds_total(), 0, ""),
        (
            "square_unreconciled_lines",
            report.square_unreconciled_lines(),
            0,
            "",
        ),
    ];
    for (metric, amount, count, currency) in summary {
        out.push('\n');
        out.push_str(&format!(
            "summary,{year_month},{metric},{amount},{count},{}",
            csv_field(currency)
        ));
    }
    if let Some(warning) = report.square_warning() {
        // The reason goes in the currency column. Odd, but it is where upstream
        // put it, and a script reading the file by column index would trip over
        // a tenth field appended anywhere else.
        out.push('\n');
        out.push_str(&format!(
            "summary,{year_month},square_warning,0,0,{}",
            csv_field(warning)
        ));
    }
    out.push('\n');
    out.push_str(RESERVATION_CSV_HEADER);
    for line in lines {
        out.push('\n');
        out.push_str(&format!(
            "{},{},{},{},{},{},{}",
            csv_field(line.reservation_id.as_str()),
            csv_field(&line.reservation_number),
            csv_field(&line.status),
            csv_field(&line.payment_status),
            line.price_amount,
            line.paid_amount,
            csv_field(&line.currency),
        ));
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{AssignmentRole, ReservationBilling};

    fn tokyo() -> Tz {
        chrono_tz::Asia::Tokyo
    }

    fn window(year_month: &str) -> SettlementWindow {
        SettlementWindow::try_new(year_month, tokyo()).expect("a fixture month is valid")
    }

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }

    fn booking(
        id: &str,
        starts_at: &str,
        status: &str,
        billing: ReservationBilling,
    ) -> Reservation {
        let starts_at = at(starts_at);
        Reservation::reconstitute(
            id,
            format!("R-{id}"),
            None,
            None,
            None,
            status,
            starts_at,
            starts_at + chrono::Duration::hours(4),
            4,
            None,
            None,
        )
        .with_billing(billing)
    }

    fn priced(price: i64, paid: i64, payment_status: &str) -> ReservationBilling {
        ReservationBilling {
            price_amount: price,
            paid_amount: paid,
            payment_status: Some(payment_status.into()),
            currency: Some("JPY".into()),
            ..ReservationBilling::default()
        }
    }

    fn round(id: &str, scheduled_at: &str, status: &str, fee: i64) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            id,
            "caddie-1",
            None,
            None,
            at(scheduled_at),
            Some(240),
            status,
            AssignmentRole::Primary.as_str(),
            fee,
            "JPY",
            None,
        )
        .expect("a fixture assignment is valid")
    }

    #[test]
    fn the_month_runs_from_local_midnight_to_local_midnight() {
        let august = window("2026-08");

        // 15:00 UTC on 31 July is 00:00 on 1 August in Tokyo: the first instant
        // of the month, and the last instant of July was the one before it.
        assert!(august.contains(at("2026-07-31T15:00:00Z")));
        assert!(!august.contains(at("2026-07-31T14:59:59Z")));
        // The same boundary at the far end belongs to September, not to both.
        assert!(august.contains(at("2026-08-31T14:59:59Z")));
        assert!(!august.contains(at("2026-08-31T15:00:00Z")));
    }

    #[test]
    fn the_month_is_the_whole_calendar_month_including_a_leap_february() {
        let february = window("2028-02");

        assert_eq!(february.period().year_month(), "2028-02");
        assert_eq!(
            february.period().end_date(),
            NaiveDate::from_ymd_opt(2028, 2, 29).unwrap()
        );
        // Upstream is asked for a day either side, because it filters by local
        // date and this window is an absolute span.
        assert_eq!(
            february.fetch_from(),
            NaiveDate::from_ymd_opt(2028, 1, 31).unwrap()
        );
        assert_eq!(
            february.fetch_to(),
            NaiveDate::from_ymd_opt(2028, 3, 1).unwrap()
        );
    }

    #[test]
    fn a_month_that_is_not_a_calendar_month_is_refused() {
        assert!(SettlementWindow::try_new("2026-13", tokyo()).is_err());
        assert!(SettlementWindow::try_new("2026-8", tokyo()).is_err());
        assert!(SettlementWindow::try_new("bad", tokyo()).is_err());
    }

    #[test]
    fn every_booking_in_the_month_counts_cancelled_ones_included() {
        let bookings = [
            booking(
                "a",
                "2026-08-10T00:00:00Z",
                "confirmed",
                priced(48_000, 48_000, "paid"),
            ),
            booking(
                "b",
                "2026-08-11T00:00:00Z",
                "cancelled",
                priced(32_000, 10_000, "fee_due"),
            ),
            // September in Tokyo, so not this month's.
            booking(
                "c",
                "2026-08-31T15:00:00Z",
                "confirmed",
                priced(99_000, 0, "unpaid"),
            ),
        ];

        let totals = reservation_totals(&bookings, &window("2026-08"));

        assert_eq!(totals.reservation_count, 2);
        assert_eq!(totals.gross_amount, 80_000);
        assert_eq!(totals.collected_amount, 58_000);
        assert_eq!(totals.payment_pending_amount, 22_000);
    }

    #[test]
    fn an_overpaid_booking_does_not_settle_what_another_still_owes() {
        let bookings = [
            booking(
                "over",
                "2026-08-10T00:00:00Z",
                "confirmed",
                priced(10_000, 25_000, "paid"),
            ),
            booking(
                "under",
                "2026-08-11T00:00:00Z",
                "confirmed",
                priced(40_000, 10_000, "partial"),
            ),
        ];

        let totals = reservation_totals(&bookings, &window("2026-08"));

        // 30,000 is still owed on the second booking. Summing the difference
        // across the month instead would report 15,000 and read as half paid.
        assert_eq!(totals.payment_pending_amount, 30_000);
    }

    #[test]
    fn a_refund_is_reported_beside_what_was_collected_not_taken_out_of_it() {
        let bookings = [booking(
            "a",
            "2026-08-10T00:00:00Z",
            "cancelled",
            priced(48_000, 48_000, "refund_pending"),
        )];

        let totals = reservation_totals(&bookings, &window("2026-08"));

        assert_eq!(totals.collected_amount, 48_000);
        assert_eq!(totals.refunded_amount, 48_000);
    }

    #[test]
    fn rounds_owe_what_was_stamped_on_them_and_a_cancelled_round_owes_nothing() {
        let rounds = [
            round("1", "2026-08-10T00:00:00Z", "assigned", 5_000),
            round("2", "2026-08-11T00:00:00Z", "completed", 6_000),
            round("3", "2026-08-12T00:00:00Z", "cancelled", 7_000),
            // July in Tokyo.
            round("4", "2026-07-31T14:00:00Z", "completed", 9_000),
        ];

        let totals = caddie_fee_totals(&rounds, &window("2026-08"));

        assert_eq!(totals.total, 11_000);
        assert_eq!(totals.assignment_count, 2);
        assert_eq!(totals.currency, "JPY");
    }

    #[test]
    fn a_month_with_no_rounds_still_names_a_currency() {
        assert_eq!(caddie_fee_totals(&[], &window("2026-08")).currency, "JPY");
    }

    #[test]
    fn the_export_lists_the_latest_tee_time_first_and_the_drilldown_follows_it() {
        let bookings = [
            booking(
                "a",
                "2026-08-10T00:00:00Z",
                "confirmed",
                priced(1, 0, "unpaid"),
            ),
            booking(
                "c",
                "2026-08-20T00:00:00Z",
                "confirmed",
                priced(3, 0, "unpaid"),
            ),
            booking(
                "b",
                "2026-08-15T00:00:00Z",
                "confirmed",
                priced(2, 0, "unpaid"),
            ),
        ];

        let lines = settlement_reservation_lines(&bookings, &window("2026-08"));

        assert_eq!(
            lines
                .iter()
                .map(|line| line.reservation_id.as_str())
                .collect::<Vec<_>>(),
            vec!["c", "b", "a"]
        );
        assert_eq!(
            drilldown_reservation_ids(&lines)
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>(),
            vec!["c", "b", "a"]
        );
    }

    fn report(warning: Option<&str>) -> MonthlySettlement {
        merge_settlement(
            &window("2026-08"),
            ReservationTotals {
                gross_amount: 80_000,
                collected_amount: 58_000,
                refunded_amount: 0,
                payment_pending_amount: 22_000,
                reservation_count: 2,
            },
            CaddieFeeTotals {
                total: 11_000,
                assignment_count: 2,
                currency: "JPY".into(),
            },
            vec![ReservationId::new("a")],
            &MonthlySettlement::reconstitute(
                SettlementPeriod::new("2026-08", NaiveDate::MIN, NaiveDate::MAX),
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                "USD",
                4_000,
                1,
                12,
                3,
                7,
                warning.map(str::to_string),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ),
        )
    }

    #[test]
    fn the_blocks_courseboard_cannot_work_out_are_relayed_rather_than_zeroed() {
        let merged = report(None);

        assert_eq!(merged.reservations_gross_amount(), 80_000);
        assert_eq!(merged.caddie_fees_total(), 11_000);
        // Cancellations and Square are still upstream's, and a zero here would
        // read as a month with nothing outstanding.
        assert_eq!(merged.cancellations_fee_outstanding_amount(), 4_000);
        assert_eq!(merged.square_unreconciled_lines(), 7);
        // The period is CourseBoard's, so the file is named by the month asked
        // for rather than by whatever upstream echoed back.
        assert_eq!(
            merged.period().end_date(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap()
        );
    }

    #[test]
    fn the_export_keeps_upstreams_headers_metrics_and_column_order() {
        let lines = settlement_reservation_lines(
            &[booking(
                "a",
                "2026-08-10T00:00:00Z",
                "confirmed",
                priced(48_000, 48_000, "paid"),
            )],
            &window("2026-08"),
        );

        let csv = settlement_csv(&report(None), &lines);
        let rows: Vec<&str> = csv.lines().collect();

        assert_eq!(rows[0], SUMMARY_CSV_HEADER);
        assert_eq!(rows[1], "summary,2026-08,reservations_gross,80000,2,");
        assert_eq!(rows[5], "summary,2026-08,caddie_fees_total,11000,2,JPY");
        assert_eq!(
            rows[6],
            "summary,2026-08,cancellation_fee_outstanding,4000,1,"
        );
        assert_eq!(rows[9], "summary,2026-08,square_unreconciled_lines,7,0,");
        assert_eq!(rows[10], RESERVATION_CSV_HEADER);
        assert_eq!(rows[11], "a,R-a,confirmed,paid,48000,48000,JPY");
        assert!(csv.ends_with('\n'));
    }

    #[test]
    fn a_square_warning_is_written_as_its_own_row_before_the_bookings() {
        let csv = settlement_csv(&report(Some("summary unavailable: nope, commas")), &[]);
        let rows: Vec<&str> = csv.lines().collect();

        assert_eq!(
            rows[10],
            "summary,2026-08,square_warning,0,0,\"summary unavailable: nope, commas\""
        );
        assert_eq!(rows[11], RESERVATION_CSV_HEADER);
    }
}
