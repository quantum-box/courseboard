//! Tee sheet day board composed from reservations + golf catalog.

use chrono::NaiveDate;
use derive_getters::Getters;

use super::party::PartyDetails;
use super::product::PlayType;
use super::{format_tenant_wall_clock, CourseError, CourseId, CustomerId, ReservationId};

pub const DEFAULT_DAY_START_HOUR: u32 = 6;
pub const DEFAULT_DAY_END_HOUR: u32 = 18;

/// Normalized status shown on the tee sheet UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeeSheetStatus {
    Confirmed,
    Completed,
    Cancelled,
    NoShow,
}

impl TeeSheetStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::NoShow => "no_show",
        }
    }

    pub fn from_reservation_status(status: &str) -> Self {
        match status {
            "completed" => Self::Completed,
            "cancelled" | "rejected" | "cancel_requested" => Self::Cancelled,
            "no_show" => Self::NoShow,
            _ => Self::Confirmed,
        }
    }
}

/// One tee-time row on a day board.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct TeeSheetItem {
    #[getter(skip)]
    id: ReservationId,
    #[getter(skip)]
    reservation_number: String,
    #[getter(skip)]
    reservation_service_id: Option<String>,
    #[getter(skip)]
    display_name: Option<String>,
    #[getter(skip)]
    golf_course_id: CourseId,
    #[getter(skip)]
    course_name: String,
    /// Courses the booked plan says it is sold on.
    ///
    /// ERP decides which course a reservation actually occupies, through the
    /// resource it books; the plan declares its allowed set. Keeping both lets
    /// the board show where the two disagree instead of silently picking a winner.
    #[getter(skip)]
    expected_course_ids: Vec<CourseId>,
    #[getter(skip)]
    tee_time: String,
    duration_minutes: i32,
    #[getter(copy)]
    play_type: PlayType,
    party_size: i32,
    #[getter(skip)]
    party_name: String,
    /// Who the booking is for in Field's ledger, once the desk has said so.
    ///
    /// `party_name` is what the desk typed when it took the call; this is who
    /// that turned out to be. Carried onto the board so reopening the booking
    /// shows the link it already has instead of an unidentified name.
    #[getter(skip)]
    customer_id: Option<CustomerId>,
    /// The competition, group number, and named players the desk keeps.
    ///
    /// Empty until someone enters them: a reservation arrives from Field with a
    /// single customer name and a headcount, which is not the same thing.
    #[getter(skip)]
    party: PartyDetails,
    #[getter(copy)]
    status: TeeSheetStatus,
    holes: i32,
    #[getter(skip)]
    notes: Option<String>,
}

impl TeeSheetItem {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<ReservationId>,
        reservation_number: impl Into<String>,
        reservation_service_id: Option<String>,
        display_name: Option<String>,
        golf_course_id: impl Into<CourseId>,
        course_name: impl Into<String>,
        expected_course_ids: Vec<CourseId>,
        tee_time: impl Into<String>,
        duration_minutes: i32,
        play_type: PlayType,
        party_size: i32,
        party_name: impl Into<String>,
        status: TeeSheetStatus,
        holes: i32,
        notes: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            reservation_number: reservation_number.into(),
            reservation_service_id: reservation_service_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            display_name: display_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            golf_course_id: golf_course_id.into(),
            course_name: course_name.into(),
            expected_course_ids,
            tee_time: tee_time.into(),
            duration_minutes: duration_minutes.max(15),
            play_type,
            party_size: party_size.max(1),
            party_name: party_name.into(),
            customer_id: None,
            party: PartyDetails::default(),
            status,
            holes: if holes > 0 { holes } else { 18 },
            notes,
        }
    }

    pub fn with_party(mut self, party: PartyDetails) -> Self {
        self.party = party;
        self
    }

    pub fn with_customer_id(mut self, customer_id: Option<CustomerId>) -> Self {
        self.customer_id = customer_id;
        self
    }

    pub fn customer_id(&self) -> Option<&CustomerId> {
        self.customer_id.as_ref()
    }

    pub fn party(&self) -> &PartyDetails {
        &self.party
    }

    /// Seats on the booking with nobody's name against them.
    ///
    /// Zero both when every seat is named and when none is: the desk reads
    /// "4名 / 名前なし" from the party being empty, not from this number.
    pub fn unnamed_seat_count(&self) -> i32 {
        if self.party.players().is_empty() {
            return 0;
        }
        (self.party_size - self.party.named_player_count()).max(0)
    }

    pub fn id(&self) -> &ReservationId {
        &self.id
    }

    pub fn reservation_number(&self) -> &str {
        &self.reservation_number
    }

    pub fn reservation_service_id(&self) -> Option<&str> {
        self.reservation_service_id.as_deref()
    }

    pub fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }

    pub fn golf_course_id(&self) -> &CourseId {
        &self.golf_course_id
    }

    pub fn course_name(&self) -> &str {
        &self.course_name
    }

    pub fn expected_course_id(&self) -> Option<&CourseId> {
        (self.expected_course_ids.len() == 1).then(|| &self.expected_course_ids[0])
    }

    pub fn expected_course_ids(&self) -> &[CourseId] {
        &self.expected_course_ids
    }

    /// The booking sits on a course its plan is not sold on.
    ///
    /// False when the plan names no course: nothing to disagree with.
    pub fn course_mismatch(&self) -> bool {
        !self.expected_course_ids.is_empty()
            && !self.expected_course_ids.contains(&self.golf_course_id)
    }

    pub fn tee_time(&self) -> &str {
        &self.tee_time
    }

    pub fn party_name(&self) -> &str {
        &self.party_name
    }

    pub fn notes(&self) -> Option<&str> {
        self.notes.as_deref()
    }

    pub fn requires_caddie(&self) -> bool {
        self.play_type.requires_caddie()
    }
}

/// Day board for a tenant-local calendar date.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct TeeSheet {
    #[getter(copy)]
    date: NaiveDate,
    #[getter(skip)]
    timezone: String,
    #[getter(skip)]
    day_start: String,
    #[getter(skip)]
    day_end: String,
    #[getter(skip)]
    items: Vec<TeeSheetItem>,
    /// Catalog lookups that failed. The board is still built, but anything those
    /// lookups supply is a fallback — the caller has to say so rather than
    /// present a guess as fact.
    #[getter(skip)]
    unavailable: Vec<String>,
}

impl TeeSheet {
    pub fn new(
        date: NaiveDate,
        timezone: impl Into<String>,
        day_start: impl Into<String>,
        day_end: impl Into<String>,
        mut items: Vec<TeeSheetItem>,
    ) -> Self {
        items.sort_by(|left, right| {
            left.tee_time()
                .cmp(right.tee_time())
                .then_with(|| left.course_name().cmp(right.course_name()))
                .then_with(|| left.reservation_number().cmp(right.reservation_number()))
        });
        Self {
            date,
            timezone: timezone.into(),
            day_start: day_start.into(),
            day_end: day_end.into(),
            items,
            unavailable: Vec::new(),
        }
    }

    pub fn with_unavailable(mut self, unavailable: Vec<String>) -> Self {
        self.unavailable = unavailable;
        self
    }

    /// Append a later day's rows, keeping this sheet's own day markers.
    ///
    /// Used when the caller asked for a range: the answer stays one board, and
    /// its `date`, `day_start` and `day_end` go on describing the first day.
    /// Rows carry their own start, so a reader of several days is not misled.
    pub fn extended_with(mut self, later: Self) -> Self {
        self.items.extend(later.items);
        self
    }

    pub fn unavailable(&self) -> &[String] {
        &self.unavailable
    }

    pub fn empty_day(date: NaiveDate, timezone: impl Into<String>) -> Result<Self, CourseError> {
        let timezone = timezone.into();
        Ok(Self::new(
            date,
            &timezone,
            format_tenant_wall_clock(date, DEFAULT_DAY_START_HOUR, 0, &timezone)?,
            format_tenant_wall_clock(date, DEFAULT_DAY_END_HOUR, 0, &timezone)?,
            Vec::new(),
        ))
    }

    pub fn timezone(&self) -> &str {
        &self.timezone
    }

    pub fn day_start(&self) -> &str {
        &self.day_start
    }

    pub fn day_end(&self) -> &str {
        &self.day_end
    }

    pub fn items(&self) -> &[TeeSheetItem] {
        &self.items
    }

    pub fn into_items(self) -> Vec<TeeSheetItem> {
        self.items
    }
}

/// Widen a date range before handing it to Field.
///
/// Some legacy Field list contracts still filter timestamped rows on their
/// **UTC** date. A tenant-local date can span two UTC dates, so callers ask one
/// day wide on both sides and narrow with [`tenant_day_bounds`](super::tenant_day_bounds).
pub fn widen_for_utc_date_filter(from: NaiveDate, to: NaiveDate) -> (NaiveDate, NaiveDate) {
    (
        from - chrono::Duration::days(1),
        to + chrono::Duration::days(1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_course_day_is_bounded_by_local_midnight_not_utc_midnight() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let (open, close) = super::super::tenant_day_bounds(date, date, "Asia/Tokyo").unwrap();

        assert_eq!(open.to_rfc3339(), "2026-08-07T15:00:00+00:00");
        assert_eq!(close.to_rfc3339(), "2026-08-08T15:00:00+00:00");
    }

    #[test]
    fn a_month_runs_from_the_first_local_morning_to_the_last_local_night() {
        let (open, close) = super::super::tenant_day_bounds(
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(),
            "Asia/Tokyo",
        )
        .unwrap();

        assert_eq!(open.to_rfc3339(), "2026-07-31T15:00:00+00:00");
        assert_eq!(close.to_rfc3339(), "2026-08-31T15:00:00+00:00");
    }

    #[test]
    fn the_upstream_window_reaches_a_day_past_each_end() {
        // A tenant day can start on the UTC date before or finish on the UTC
        // date after. Asking narrow can therefore drop part of it.
        let (from, to) = widen_for_utc_date_filter(
            NaiveDate::from_ymd_opt(2026, 8, 8).unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 8).unwrap(),
        );

        assert_eq!(from, NaiveDate::from_ymd_opt(2026, 8, 7).unwrap());
        assert_eq!(to, NaiveDate::from_ymd_opt(2026, 8, 9).unwrap());
    }
}
