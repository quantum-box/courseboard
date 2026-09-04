//! Why a booking came off the board, and whether it is owed for.
//!
//! A cancelled booking disappears from the tee sheet — that is what cancelling
//! it means — and Field keeps only the fact and the moment, never the reason
//! (PLT-3297). So the desk that comes in tomorrow sees an empty slot with
//! nothing to say a group had held it, and the club has no way to tell a
//! typhoon from a caller who simply did not turn up.
//!
//! The distinction is not administrative. It is what decides whether a
//! cancellation fee is charged, which is a golf judgement about a generic
//! booking and therefore ours (ADR-0005, ADR-0009). Field is told the
//! cancellation happened; the reading of it stays here.

use chrono::{DateTime, NaiveDate, Utc};

use super::{CourseError, CourseId, CustomerId, ReservationId};

/// Long enough for a sentence, short enough that the field stays a note.
pub const MAX_CANCELLATION_NOTE_CHARS: usize = 500;

/// The club's own reasons a tee time was given up.
///
/// A fixed set rather than free text, because "how many weather cancellations
/// did we take in June" and "who cancels on the day, every time" are the
/// questions the list exists to answer, and neither survives a typed sentence.
/// The sentence is kept too, in `reason_note` — the code is what a month is
/// counted by, the note is what makes one row make sense.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancellationReason {
    /// Rain, wind, snow, frost — the round could not be played.
    Weather,
    /// Illness or injury on the caller's side.
    Illness,
    /// The caller's own change of plan, whatever it was.
    Personal,
    /// Nobody arrived and nobody rang. Recorded by the desk after the fact.
    NoContact,
    /// The club's own doing: a closure, maintenance, an overbooked sheet.
    CourseSide,
    /// The group could not be filled.
    Shortage,
    /// A duplicate booking or a keying mistake, cancelled to tidy the sheet.
    Mistake,
    Other,
}

impl CancellationReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Weather => "weather",
            Self::Illness => "illness",
            Self::Personal => "personal",
            Self::NoContact => "no_contact",
            Self::CourseSide => "course_side",
            Self::Shortage => "shortage",
            Self::Mistake => "mistake",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value.trim() {
            "weather" => Ok(Self::Weather),
            "illness" => Ok(Self::Illness),
            "personal" => Ok(Self::Personal),
            "no_contact" => Ok(Self::NoContact),
            "course_side" => Ok(Self::CourseSide),
            "shortage" => Ok(Self::Shortage),
            "mistake" => Ok(Self::Mistake),
            "other" => Ok(Self::Other),
            _ => Err(CourseError::BadRequest("unknown cancellation reason")),
        }
    }

    /// Whether the club would normally charge for a cancellation of this kind.
    ///
    /// Derived rather than stored, so a club that changes its mind gets the
    /// new reading of its old rows instead of a backfill. It is a default the
    /// extraction starts from, never a decision: `fee_state` is what records
    /// what somebody actually did about a particular booking.
    ///
    /// Weather and the club's own closures are not the caller's fault, and a
    /// booking cancelled because it was keyed twice never existed. Everything
    /// else, including a caller who simply did not appear, is chargeable —
    /// whether the club then waives it is the club's business.
    pub fn fee_expected(self) -> bool {
        !matches!(self, Self::Weather | Self::CourseSide | Self::Mistake)
    }

    /// Every reason, for the screens that offer them and the coverage tests.
    pub const ALL: &'static [Self] = &[
        Self::Weather,
        Self::Illness,
        Self::Personal,
        Self::NoContact,
        Self::CourseSide,
        Self::Shortage,
        Self::Mistake,
        Self::Other,
    ];
}

/// Where the cancellation fee for one booking got to.
///
/// Deliberately not a payment state. Whether the invoice was paid is Field's
/// answer about the invoice, read from the invoice; keeping a second copy here
/// would give the club two numbers under one label the first time a payment
/// landed and this table did not hear about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancellationFeeState {
    /// Nobody has decided yet. This is what the extraction is for.
    Unsettled,
    /// Decided not to charge. Carries a note saying why.
    Waived,
    /// An invoice exists upstream; `fee_invoice_id` points at it.
    Invoiced,
}

impl CancellationFeeState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unsettled => "unsettled",
            Self::Waived => "waived",
            Self::Invoiced => "invoiced",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value.trim() {
            "unsettled" => Ok(Self::Unsettled),
            "waived" => Ok(Self::Waived),
            "invoiced" => Ok(Self::Invoiced),
            _ => Err(CourseError::BadRequest("unknown cancellation fee state")),
        }
    }
}

/// One cancelled booking, as the club reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationCancellation {
    pub reservation_id: ReservationId,
    pub reservation_number: Option<String>,
    pub customer_id: Option<CustomerId>,
    /// What the booking was taken under. Kept even when the ledger link is
    /// there, because a row whose customer Field will not answer for is still
    /// a row somebody has to chase.
    pub customer_name: Option<String>,
    pub golf_course_id: Option<CourseId>,
    pub tee_time: Option<DateTime<Utc>>,
    pub played_on: Option<NaiveDate>,
    pub players: u32,
    pub booking_amount: Option<i64>,
    pub currency: Option<String>,
    pub reason: CancellationReason,
    pub reason_note: Option<String>,
    /// Whole days of notice. Negative when the call came after the tee time.
    pub notice_days: Option<i64>,
    pub fee_state: CancellationFeeState,
    pub fee_invoice_id: Option<String>,
    pub fee_amount: Option<i64>,
    pub fee_settled_at: Option<DateTime<Utc>>,
    pub fee_note: Option<String>,
    pub cancelled_at: DateTime<Utc>,
    pub cancelled_by: Option<String>,
}

impl ReservationCancellation {
    /// Whether this row is what the desk should still be looking at: a reason
    /// the club charges for, and nobody has yet said what to do about it.
    pub fn awaiting_fee_decision(&self) -> bool {
        self.fee_state == CancellationFeeState::Unsettled && self.reason.fee_expected()
    }
}

/// A cancellation on its way in.
///
/// The snapshot fields are read off the booking by the caller before Field is
/// asked to cancel it, because afterwards the only honest source for what the
/// booking was worth is gone from every board.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReservationCancellation {
    pub reservation_id: ReservationId,
    pub reservation_number: Option<String>,
    pub customer_id: Option<CustomerId>,
    pub customer_name: Option<String>,
    pub golf_course_id: Option<CourseId>,
    pub tee_time: Option<DateTime<Utc>>,
    pub played_on: Option<NaiveDate>,
    pub players: u32,
    pub booking_amount: Option<i64>,
    pub currency: Option<String>,
    pub reason: CancellationReason,
    pub reason_note: Option<String>,
    pub notice_days: Option<i64>,
    pub cancelled_by: Option<String>,
}

/// What the desk chose in the cancel dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancellationDetails {
    pub reason: CancellationReason,
    pub note: Option<String>,
}

impl CancellationDetails {
    pub fn try_new(reason: CancellationReason, note: Option<&str>) -> Result<Self, CourseError> {
        let note = note
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if note
            .as_deref()
            .is_some_and(|value| value.chars().count() > MAX_CANCELLATION_NOTE_CHARS)
        {
            return Err(CourseError::BadRequest(
                "the cancellation reason is too long",
            ));
        }
        Ok(Self { reason, note })
    }

    /// The sentence Field is told, which is all Field can hold.
    ///
    /// The code goes with it rather than only the note: Field's record is what
    /// somebody reading the booking upstream will see, and "no_contact" there
    /// is worth more than an empty reason. It is a courtesy copy — the row in
    /// CourseBoard is the one the club works from.
    pub fn upstream_reason(&self) -> String {
        match &self.note {
            Some(note) => format!("[{}] {note}", self.reason.as_str()),
            None => format!("[{}]", self.reason.as_str()),
        }
    }
}

/// What the desk is asking the cancellation list for.
///
/// Every field narrows; an empty query is "everything, newest first". Dates are
/// tenant-local play days rather than cancellation timestamps, because the
/// question the club asks is "what did we lose in June", and a booking
/// cancelled in May for a June tee time was lost in June.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancellationQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub customer_id: Option<CustomerId>,
    pub reasons: Vec<CancellationReason>,
    pub fee_states: Vec<CancellationFeeState>,
    /// Keep only the rows the club would charge for. The reason ladder decides,
    /// so this narrows without the caller having to name the seven codes it
    /// currently means.
    pub fee_expected_only: bool,
    /// Keep only rows that carry a ledger link, which is what a fee can be
    /// billed against.
    pub linked_only: bool,
    pub limit: u32,
    pub offset: u32,
}

/// Rows one page asks for at once. Matches what the screen draws.
pub const CANCELLATION_PAGE_LIMIT: u32 = 100;
const MAX_CANCELLATION_PAGE_LIMIT: u32 = 200;

impl Default for CancellationQuery {
    fn default() -> Self {
        Self {
            from: None,
            to: None,
            customer_id: None,
            reasons: Vec::new(),
            fee_states: Vec::new(),
            fee_expected_only: false,
            linked_only: false,
            limit: CANCELLATION_PAGE_LIMIT,
            offset: 0,
        }
    }
}

impl CancellationQuery {
    pub fn with_paging(mut self, limit: Option<u32>, offset: Option<u32>) -> Self {
        self.limit = limit.unwrap_or(CANCELLATION_PAGE_LIMIT);
        self.offset = offset.unwrap_or(0);
        self
    }

    pub fn validate(&self) -> Result<(), CourseError> {
        if let (Some(from), Some(to)) = (self.from, self.to) {
            if to < from {
                return Err(CourseError::BadRequest("the period ends before it starts"));
            }
        }
        if self.limit == 0 || self.limit > MAX_CANCELLATION_PAGE_LIMIT {
            return Err(CourseError::BadRequest(
                "ask for between 1 and 200 cancellations",
            ));
        }
        Ok(())
    }
}

/// What somebody decided about one booking's fee.
///
/// Written after the invoice exists upstream, not before: an invoice id that
/// points at nothing is worse than a row still marked unsettled, because the
/// second one comes back on the next extraction and the first one never does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancellationFeeDecision {
    pub reservation_id: ReservationId,
    pub state: CancellationFeeState,
    pub invoice_id: Option<String>,
    pub amount: Option<i64>,
    pub note: Option<String>,
}

impl CancellationFeeDecision {
    pub fn validate(&self) -> Result<(), CourseError> {
        if self.reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }
        match self.state {
            // The whole point of the state is the pointer it carries.
            CancellationFeeState::Invoiced
                if self
                    .invoice_id
                    .as_deref()
                    .map(str::trim)
                    .is_none_or(str::is_empty) =>
            {
                Err(CourseError::BadRequest(
                    "an invoiced cancellation needs its invoice id",
                ))
            }
            _ if self
                .note
                .as_deref()
                .is_some_and(|note| note.chars().count() > MAX_CANCELLATION_NOTE_CHARS) =>
            {
                Err(CourseError::BadRequest("the fee note is too long"))
            }
            _ if self.amount.is_some_and(|amount| amount < 0) => {
                Err(CourseError::BadRequest("a fee cannot be negative"))
            }
            _ => Ok(()),
        }
    }
}

/// Whole days of notice between cancelling and the tee time.
///
/// Counted in tenant-local days rather than in hours, because that is how the
/// club's own rules are written ("the day before", "three days before"). A
/// call that comes after the round should have started gives negative notice,
/// which is how a no-show reads.
pub fn notice_days_between(cancelled_on: NaiveDate, played_on: NaiveDate) -> i64 {
    (played_on - cancelled_on).num_days()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_reason_round_trips_through_its_wire_name() {
        for reason in CancellationReason::ALL {
            assert_eq!(CancellationReason::parse(reason.as_str()).unwrap(), *reason);
        }
    }

    #[test]
    fn the_club_charges_for_what_the_caller_could_have_avoided() {
        assert!(!CancellationReason::Weather.fee_expected());
        assert!(!CancellationReason::CourseSide.fee_expected());
        assert!(!CancellationReason::Mistake.fee_expected());
        assert!(CancellationReason::NoContact.fee_expected());
        assert!(CancellationReason::Personal.fee_expected());
    }

    #[test]
    fn an_unknown_reason_is_refused_rather_than_stored_as_other() {
        // Storing it as `other` would quietly lose a screen's typo into a
        // bucket the club counts, and nobody would ever find it again.
        assert!(CancellationReason::parse("typhoon").is_err());
    }

    #[test]
    fn the_note_field_stays_a_note() {
        let long = "あ".repeat(MAX_CANCELLATION_NOTE_CHARS + 1);
        assert!(CancellationDetails::try_new(CancellationReason::Other, Some(&long)).is_err());
    }

    #[test]
    fn a_blank_note_is_no_note() {
        let details =
            CancellationDetails::try_new(CancellationReason::Personal, Some("   ")).unwrap();
        assert_eq!(details.note, None);
        assert_eq!(details.upstream_reason(), "[personal]");
    }

    #[test]
    fn field_is_told_the_code_alongside_the_sentence() {
        let details =
            CancellationDetails::try_new(CancellationReason::Illness, Some("発熱のため")).unwrap();
        assert_eq!(details.upstream_reason(), "[illness] 発熱のため");
    }

    #[test]
    fn an_invoiced_decision_without_an_invoice_is_refused() {
        let decision = CancellationFeeDecision {
            reservation_id: ReservationId::new("res_1"),
            state: CancellationFeeState::Invoiced,
            invoice_id: Some("  ".to_string()),
            amount: Some(5_000),
            note: None,
        };
        assert!(decision.validate().is_err());
    }

    #[test]
    fn waiving_needs_nothing_but_the_booking() {
        let decision = CancellationFeeDecision {
            reservation_id: ReservationId::new("res_1"),
            state: CancellationFeeState::Waived,
            invoice_id: None,
            amount: None,
            note: Some("常連のため".to_string()),
        };
        assert!(decision.validate().is_ok());
    }

    #[test]
    fn a_period_that_ends_before_it_starts_is_refused() {
        let query = CancellationQuery {
            from: Some(NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()),
            to: Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()),
            ..CancellationQuery::default()
        };
        assert!(query.validate().is_err());
    }

    #[test]
    fn notice_is_negative_once_the_tee_time_has_gone() {
        let played = NaiveDate::from_ymd_opt(2026, 6, 10).unwrap();
        assert_eq!(
            notice_days_between(NaiveDate::from_ymd_opt(2026, 6, 3).unwrap(), played),
            7
        );
        assert_eq!(
            notice_days_between(NaiveDate::from_ymd_opt(2026, 6, 11).unwrap(), played),
            -1
        );
    }

    #[test]
    fn only_a_chargeable_reason_nobody_has_settled_still_wants_a_decision() {
        let row = |reason, fee_state| ReservationCancellation {
            reservation_id: ReservationId::new("res_1"),
            reservation_number: None,
            customer_id: None,
            customer_name: None,
            golf_course_id: None,
            tee_time: None,
            played_on: None,
            players: 4,
            booking_amount: None,
            currency: None,
            reason,
            reason_note: None,
            notice_days: None,
            fee_state,
            fee_invoice_id: None,
            fee_amount: None,
            fee_settled_at: None,
            fee_note: None,
            cancelled_at: Utc::now(),
            cancelled_by: None,
        };
        assert!(row(
            CancellationReason::Personal,
            CancellationFeeState::Unsettled
        )
        .awaiting_fee_decision());
        assert!(
            !row(CancellationReason::Weather, CancellationFeeState::Unsettled)
                .awaiting_fee_decision()
        );
        assert!(
            !row(CancellationReason::Personal, CancellationFeeState::Waived)
                .awaiting_fee_decision()
        );
    }
}
