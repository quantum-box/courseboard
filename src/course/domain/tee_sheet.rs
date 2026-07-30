//! Tee sheet day board composed from reservations + golf catalog.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveTime, TimeZone};
use derive_getters::Getters;

use super::product::PlayType;
use super::{CourseError, CourseId, ReservationId};

const JST_OFFSET_SECS: i32 = 9 * 3600;
pub const DEFAULT_TIMEZONE: &str = "Asia/Tokyo";
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
    #[getter(skip)]
    tee_time: String,
    duration_minutes: i32,
    #[getter(copy)]
    play_type: PlayType,
    party_size: i32,
    #[getter(skip)]
    party_name: String,
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
            tee_time: tee_time.into(),
            duration_minutes: duration_minutes.max(15),
            play_type,
            party_size: party_size.max(1),
            party_name: party_name.into(),
            status,
            holes: if holes > 0 { holes } else { 18 },
            notes,
        }
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

    pub fn unavailable(&self) -> &[String] {
        &self.unavailable
    }

    pub fn empty_day(date: NaiveDate, timezone: impl Into<String>) -> Result<Self, CourseError> {
        let jst = jst_offset()?;
        Ok(Self::new(
            date,
            timezone,
            format_jst_wall_clock(date, DEFAULT_DAY_START_HOUR, 0, jst),
            format_jst_wall_clock(date, DEFAULT_DAY_END_HOUR, 0, jst),
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

pub fn jst_offset() -> Result<FixedOffset, CourseError> {
    FixedOffset::east_opt(JST_OFFSET_SECS)
        .ok_or_else(|| CourseError::Provider("invalid JST offset".into()))
}

pub fn format_datetime_with_offset(value: DateTime<chrono::Utc>, offset: FixedOffset) -> String {
    value
        .with_timezone(&offset)
        .format("%Y-%m-%dT%H:%M:%S%:z")
        .to_string()
}

pub fn format_jst_wall_clock(date: NaiveDate, hour: u32, minute: u32, jst: FixedOffset) -> String {
    let naive = date.and_time(NaiveTime::from_hms_opt(hour, minute, 0).unwrap_or(NaiveTime::MIN));
    jst.from_local_datetime(&naive)
        .single()
        .unwrap_or_else(|| jst.from_utc_datetime(&naive))
        .format("%Y-%m-%dT%H:%M:%S%:z")
        .to_string()
}
