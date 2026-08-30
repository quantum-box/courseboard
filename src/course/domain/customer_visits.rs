//! What one person's play at this course adds up to.
//!
//! The ledger says who somebody is; this says what they have done here. It is
//! golf's reading of Field's bookings — that a booking in the past is a round
//! played, that one still ahead is not yet anything, and that a cancellation is
//! part of the record rather than an absence from it (ADR-0005).
//!
//! Read only through the person the booking was taken for. Field records one
//! customer per reservation — the one who called — and CourseBoard's
//! `golfParty.players[].customerId` is not something Field can be asked to
//! filter by. So somebody who plays every month in a colleague's group has an
//! empty history here, and the screen has to say that rather than let an empty
//! table read as "never been".

use std::collections::HashSet;

use chrono::{DateTime, Utc};

use super::{CourseId, Reservation, ReservationId};

/// How many rounds the table shows.
///
/// A caddie master reads the last handful of rounds, not eight years of them.
/// This bounds the *table* only — the figures above it are lifetime ones, and
/// capping those would be a different number wearing the same label.
pub const DEFAULT_VISIT_HISTORY_LIMIT: u32 = 50;
pub const MAX_VISIT_HISTORY_LIMIT: u32 = 200;

/// Rows fetched per upstream call. Field clamps at 500 without saying so, so
/// asking for exactly that keeps the page size the one that was requested.
pub const VISIT_HISTORY_PAGE: u32 = 500;

/// Where reading the whole history gives up.
///
/// Four full pages. A member playing weekly for forty years reaches two
/// thousand rounds, so in practice this is never hit — and when it is, the
/// figures say so rather than passing a partial count off as a lifetime.
pub const MAX_VISIT_HISTORY_ROWS: usize = 2_000;

/// What a booking turned out to be, once the clock is applied to it.
///
/// Field's status alone cannot answer this: `confirmed` is a round played or a
/// round still ahead depending only on when it starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisitKind {
    /// Played: a live booking whose tee time has passed.
    Visited,
    /// Booked and still ahead. Not a visit, and not counted as one.
    Upcoming,
    /// Booked, kept, and nobody came. The desk reads this differently from a
    /// cancellation, so it is not folded into one.
    NoShow,
    /// Cancelled, rejected, or with a cancellation in flight.
    Cancelled,
    /// A booking in a state that is neither of the above — waitlisted or
    /// suspended. Kept rather than dropped, and left to the screen to show
    /// under its own status: guessing what it means would be inventing.
    Other,
}

impl VisitKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Visited => "visited",
            Self::Upcoming => "upcoming",
            Self::NoShow => "no_show",
            Self::Cancelled => "cancelled",
            Self::Other => "other",
        }
    }

    /// Whether this booking counts towards how often somebody plays and what
    /// they are worth. Only a round that actually happened does.
    pub fn counts_as_play(self) -> bool {
        matches!(self, Self::Visited)
    }
}

/// Field statuses that mean the booking will not become a round.
const CANCELLED_STATUSES: [&str; 3] = ["cancelled", "rejected", "cancel_requested"];
/// Field statuses that are a held booking rather than a sold one.
const UNSETTLED_STATUSES: [&str; 2] = ["waiting", "suspended"];

/// One row of the history: a booking, read as golf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerVisit {
    id: ReservationId,
    reservation_number: String,
    starts_at: DateTime<Utc>,
    course_id: Option<CourseId>,
    /// How many played, not how many were in the ledger. A group of four with
    /// one named guest is still four rounds sold.
    players: i32,
    /// What Field says the booking is worth. Zero on anything booked before
    /// CourseBoard carried the money across, which is why it is told apart
    /// from a genuine zero when the average is taken.
    amount: i64,
    currency: Option<String>,
    /// Field's own status, passed through. The screen shows it for anything
    /// `kind` cannot speak for.
    status: String,
    kind: VisitKind,
    /// Whether this booking is in this person's own name.
    ///
    /// False for a round they played in somebody else's group, which only
    /// exists here because the desk checked them in — Field cannot be asked
    /// about `golfParty.players[].customerId`. The money and the headcount on
    /// such a round belong to whoever booked it, so they are left off.
    booked: bool,
    /// Whether somebody was seen at the desk, as opposed to the tee time
    /// having passed on a booking nobody cancelled. Both read as a round
    /// played; only one of them is a record of it.
    checked_in: bool,
}

impl CustomerVisit {
    pub fn from_reservation(reservation: &Reservation, now: DateTime<Utc>) -> Self {
        Self {
            id: reservation.id().clone(),
            reservation_number: reservation.reservation_number().to_string(),
            starts_at: reservation.starts_at(),
            course_id: reservation.golf_course_id().cloned(),
            players: reservation.party_size(),
            amount: reservation.billing().price_amount,
            currency: reservation.billing().currency.clone(),
            status: reservation.status().to_string(),
            kind: classify(reservation, now),
            booked: true,
            checked_in: false,
        }
    }

    /// A round this person played in somebody else's group.
    ///
    /// Built from the check-in rather than from the booking's own customer,
    /// because the booking's customer is somebody else. What is dropped is
    /// deliberate: the takings and the headcount are the booker's, and
    /// splitting either between the group would be inventing a number.
    pub fn as_guest(reservation: &Reservation) -> Self {
        Self {
            id: reservation.id().clone(),
            reservation_number: reservation.reservation_number().to_string(),
            starts_at: reservation.starts_at(),
            course_id: reservation.golf_course_id().cloned(),
            players: 0,
            amount: 0,
            currency: None,
            status: reservation.status().to_string(),
            // Somebody stood at the desk. That is not a thing the clock can
            // take back, so it is not re-derived from the booking's status.
            kind: VisitKind::Visited,
            booked: false,
            checked_in: true,
        }
    }

    pub fn id(&self) -> &ReservationId {
        &self.id
    }

    pub fn reservation_number(&self) -> &str {
        &self.reservation_number
    }

    pub fn starts_at(&self) -> DateTime<Utc> {
        self.starts_at
    }

    pub fn course_id(&self) -> Option<&CourseId> {
        self.course_id.as_ref()
    }

    pub fn players(&self) -> i32 {
        self.players
    }

    pub fn amount(&self) -> i64 {
        self.amount
    }

    pub fn currency(&self) -> Option<&str> {
        self.currency.as_deref()
    }

    pub fn status(&self) -> &str {
        &self.status
    }

    pub fn kind(&self) -> VisitKind {
        self.kind
    }

    /// Whether the booking is in this person's own name.
    pub fn booked(&self) -> bool {
        self.booked
    }

    /// Whether the desk recorded them arriving, rather than the clock implying
    /// it.
    pub fn checked_in(&self) -> bool {
        self.checked_in
    }

    /// Marks a booking of their own as one they were actually seen at.
    ///
    /// Only ever upgrades. A booking with no check-in stays as the clock reads
    /// it, because every round played before the desk started checking people
    /// in has no row and would otherwise be demoted to "never came".
    pub fn confirm_attended(&mut self) {
        self.checked_in = true;
        if matches!(
            self.kind,
            VisitKind::Upcoming | VisitKind::Other | VisitKind::NoShow
        ) {
            self.kind = VisitKind::Visited;
        }
    }
}

fn classify(reservation: &Reservation, now: DateTime<Utc>) -> VisitKind {
    let status = reservation.status();
    if reservation.billing().is_cancelled() || CANCELLED_STATUSES.contains(&status) {
        return VisitKind::Cancelled;
    }
    if status == "no_show" {
        return VisitKind::NoShow;
    }
    if UNSETTLED_STATUSES.contains(&status) {
        return VisitKind::Other;
    }
    if reservation.starts_at() > now {
        return VisitKind::Upcoming;
    }
    VisitKind::Visited
}

/// What the rows add up to.
///
/// Every field here is over the rows that were read, which is the whole history
/// only when `truncated` is false. A count that silently meant "the last fifty"
/// while reading as "ever" is the failure this type exists to prevent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CustomerVisitSummary {
    /// Rounds played.
    pub visits: u32,
    /// Rounds sold across those visits — a foursome counts four.
    pub players: i64,
    pub total_amount: i64,
    /// Rounds whose booking carries no money. Excluded from the average, and
    /// reported so the screen can say what the average left out instead of
    /// quietly dragging it towards zero.
    pub unpriced_visits: u32,
    /// Takings per round sold, over the visits that have money on them.
    /// `None` when none of them do — an unknown average, not a zero one.
    pub spend_per_player: Option<i64>,
    pub cancelled: u32,
    pub no_shows: u32,
    pub upcoming: u32,
    /// Absent when the history was truncated: the earliest row that was read is
    /// not the first time this person played.
    pub first_visit_at: Option<DateTime<Utc>>,
    pub last_visit_at: Option<DateTime<Utc>>,
}

/// One person's play, newest first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerVisitHistory {
    visits: Vec<CustomerVisit>,
    summary: CustomerVisitSummary,
    truncated: bool,
}

impl CustomerVisitHistory {
    /// Build from every booking the gateway could read, newest first.
    ///
    /// `reservations` is the whole history, not a screenful: the summary is
    /// taken over all of it, and only the table is cut to `display_limit`.
    /// `truncated` says the caller gave up before reaching the end, which is
    /// what makes the figures a partial count rather than a lifetime.
    pub fn build(
        reservations: Vec<Reservation>,
        now: DateTime<Utc>,
        display_limit: u32,
        truncated: bool,
    ) -> Self {
        Self::build_with_checkins(
            reservations,
            Vec::new(),
            &HashSet::new(),
            now,
            display_limit,
            truncated,
        )
    }

    /// Build from the bookings this person took, plus what the desk saw.
    ///
    /// Two separate corrections to a history read from bookings alone.
    /// `attended` names their own bookings somebody was checked in against, so
    /// those stop being an inference. `guest_reservations` are rounds they
    /// played in other people's groups, which no query against Field can find:
    /// it records one customer per reservation, and the rest of the group is
    /// in CourseBoard's own `golfParty`.
    pub fn build_with_checkins(
        reservations: Vec<Reservation>,
        guest_reservations: Vec<Reservation>,
        attended: &HashSet<String>,
        now: DateTime<Utc>,
        display_limit: u32,
        truncated: bool,
    ) -> Self {
        let display_limit = display_limit.clamp(1, MAX_VISIT_HISTORY_LIMIT) as usize;
        let mut all: Vec<CustomerVisit> = reservations
            .iter()
            .map(|reservation| {
                let mut visit = CustomerVisit::from_reservation(reservation, now);
                if attended.contains(reservation.id().as_str()) {
                    visit.confirm_attended();
                }
                visit
            })
            .chain(guest_reservations.iter().map(CustomerVisit::as_guest))
            .collect();
        // Field orders by start time descending, but a history that silently
        // depended on upstream ordering would reorder itself the day that
        // changes.
        all.sort_by_key(|visit| std::cmp::Reverse(visit.starts_at));
        // Summarise everything, then cut the table. The other order would make
        // "rounds played" mean "rounds played that fit on screen".
        let summary = summarize(&all, truncated);
        all.truncate(display_limit);
        Self {
            visits: all,
            summary,
            truncated,
        }
    }

    pub fn visits(&self) -> &[CustomerVisit] {
        &self.visits
    }

    pub fn summary(&self) -> &CustomerVisitSummary {
        &self.summary
    }

    /// Whether reading stopped before the end of the history, which makes the
    /// summary a partial count rather than a lifetime one.
    pub fn truncated(&self) -> bool {
        self.truncated
    }
}

fn summarize(visits: &[CustomerVisit], truncated: bool) -> CustomerVisitSummary {
    let mut summary = CustomerVisitSummary::default();
    let mut priced_players: i64 = 0;
    for visit in visits {
        match visit.kind {
            VisitKind::Visited => {
                summary.visits += 1;
                // A round played in somebody else's group adds to how often
                // this person comes and to nothing else: the seats and the
                // takings are the booker's.
                if visit.booked {
                    summary.players += i64::from(visit.players.max(0));
                }
                summary.total_amount += visit.amount;
                if visit.amount > 0 {
                    priced_players += i64::from(visit.players.max(0));
                } else {
                    summary.unpriced_visits += 1;
                }
                summary.last_visit_at = Some(match summary.last_visit_at {
                    Some(latest) if latest >= visit.starts_at => latest,
                    _ => visit.starts_at,
                });
                summary.first_visit_at = Some(match summary.first_visit_at {
                    Some(earliest) if earliest <= visit.starts_at => earliest,
                    _ => visit.starts_at,
                });
            }
            VisitKind::Cancelled => summary.cancelled += 1,
            VisitKind::NoShow => summary.no_shows += 1,
            VisitKind::Upcoming => summary.upcoming += 1,
            VisitKind::Other => {}
        }
    }
    if priced_players > 0 {
        summary.spend_per_player = Some(summary.total_amount / priced_players);
    }
    if truncated {
        // The oldest row read is only the oldest one asked for.
        summary.first_visit_at = None;
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::ReservationBilling;
    use chrono::TimeZone;

    fn at(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
    }

    fn now() -> DateTime<Utc> {
        at(2026, 8, 27)
    }

    fn booking(
        id: &str,
        starts_at: DateTime<Utc>,
        status: &str,
        players: i32,
        amount: i64,
    ) -> Reservation {
        Reservation::reconstitute(
            id,
            format!("R-{id}"),
            None,
            None,
            Some("本田 康彦".into()),
            status,
            starts_at,
            starts_at,
            players,
            Some("course_out".into()),
            None,
        )
        .with_billing(ReservationBilling {
            price_amount: amount,
            currency: Some("JPY".into()),
            ..ReservationBilling::default()
        })
    }

    #[test]
    fn a_booking_still_ahead_is_not_counted_as_a_round_played() {
        // The whole point of applying a clock: `confirmed` says nothing about
        // whether anybody has walked the course yet.
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2026, 9, 10), "confirmed", 4, 40_000),
                booking("r2", at(2026, 7, 10), "confirmed", 4, 40_000),
            ],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.summary().visits, 1);
        assert_eq!(history.summary().upcoming, 1);
        assert_eq!(history.summary().last_visit_at, Some(at(2026, 7, 10)));
    }

    #[test]
    fn a_cancellation_and_a_no_show_stay_apart() {
        // The desk treats them differently — one is a phone call, the other is
        // an empty tee time — so a single "did not play" count would lose what
        // it is looking at.
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2026, 6, 1), "cancelled", 4, 0),
                booking("r2", at(2026, 5, 1), "no_show", 2, 20_000),
                booking("r3", at(2026, 4, 1), "rejected", 4, 0),
            ],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.summary().cancelled, 2);
        assert_eq!(history.summary().no_shows, 1);
        assert_eq!(history.summary().visits, 0);
    }

    #[test]
    fn a_booking_field_marked_cancelled_counts_as_cancelled_whatever_its_status_says() {
        let mut reservation = booking("r1", at(2026, 6, 1), "confirmed", 4, 40_000);
        reservation = reservation.with_billing(ReservationBilling {
            price_amount: 40_000,
            cancelled_at: Some(at(2026, 5, 30)),
            ..ReservationBilling::default()
        });
        let history = CustomerVisitHistory::build(
            vec![reservation],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.visits()[0].kind(), VisitKind::Cancelled);
    }

    #[test]
    fn spend_per_player_ignores_rounds_that_carry_no_money() {
        // Bookings taken before CourseBoard carried the amount across have a
        // zero on them. Averaging those in would report a regular player as
        // worth half what they are.
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2026, 6, 1), "completed", 4, 60_000),
                booking("r2", at(2026, 5, 1), "completed", 4, 0),
            ],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.summary().visits, 2);
        assert_eq!(history.summary().players, 8);
        assert_eq!(history.summary().unpriced_visits, 1);
        assert_eq!(history.summary().spend_per_player, Some(15_000));
    }

    #[test]
    fn nobody_with_money_recorded_gets_an_unknown_average_rather_than_zero() {
        let history = CustomerVisitHistory::build(
            vec![booking("r1", at(2026, 6, 1), "completed", 4, 0)],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.summary().spend_per_player, None);
    }

    #[test]
    fn cutting_the_table_does_not_cut_the_figures() {
        // The distinction the whole type exists for: the desk sees one row but
        // the count says two, because two is how often this person has played.
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2026, 6, 1), "completed", 4, 40_000),
                booking("r2", at(2026, 5, 1), "completed", 4, 40_000),
            ],
            now(),
            1,
            false,
        );
        assert!(!history.truncated());
        assert_eq!(history.visits().len(), 1);
        assert_eq!(history.summary().visits, 2);
        assert_eq!(history.summary().first_visit_at, Some(at(2026, 5, 1)));
    }

    #[test]
    fn a_truncated_history_refuses_to_name_a_first_visit() {
        // Reading gave up before the end, so the oldest row read is not the
        // first round this person played — and a screen showing it as such
        // would be wrong about the thing it is most likely to be read for.
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2026, 6, 1), "completed", 4, 40_000),
                booking("r2", at(2026, 5, 1), "completed", 4, 40_000),
            ],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            true,
        );
        assert_eq!(history.summary().first_visit_at, None);
        assert_eq!(history.summary().last_visit_at, Some(at(2026, 6, 1)));
    }

    #[test]
    fn a_complete_history_names_both_ends() {
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2026, 6, 1), "completed", 4, 40_000),
                booking("r2", at(2024, 5, 1), "completed", 4, 40_000),
            ],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert!(!history.truncated());
        assert_eq!(history.summary().first_visit_at, Some(at(2024, 5, 1)));
        assert_eq!(history.summary().last_visit_at, Some(at(2026, 6, 1)));
    }

    #[test]
    fn rows_come_back_newest_first_even_when_upstream_does_not_order_them() {
        let history = CustomerVisitHistory::build(
            vec![
                booking("r1", at(2024, 5, 1), "completed", 4, 40_000),
                booking("r2", at(2026, 6, 1), "completed", 4, 40_000),
            ],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.visits()[0].reservation_number(), "R-r2");
    }

    #[test]
    fn a_waitlisted_booking_is_neither_played_nor_cancelled() {
        let history = CustomerVisitHistory::build(
            vec![booking("r1", at(2026, 6, 1), "waiting", 4, 0)],
            now(),
            DEFAULT_VISIT_HISTORY_LIMIT,
            false,
        );
        assert_eq!(history.visits()[0].kind(), VisitKind::Other);
        assert_eq!(history.summary().visits, 0);
        assert_eq!(history.summary().cancelled, 0);
    }

    #[test]
    fn somebody_with_no_bookings_reads_as_empty_rather_than_as_an_error() {
        let history =
            CustomerVisitHistory::build(vec![], now(), DEFAULT_VISIT_HISTORY_LIMIT, false);
        assert!(history.visits().is_empty());
        assert_eq!(history.summary(), &CustomerVisitSummary::default());
        assert!(!history.truncated());
    }
}
