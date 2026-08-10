//! Weekly opening schedule for a course, and the tee-time inventory it makes.
//!
//! The schedule is the source of truth for what a course can sell: a weekday, a
//! band, how many groups may be out at once, and how far apart they go out.
//! Field turns it into counted inventory; a plan only decides how that
//! inventory is sold.

use super::{CourseError, CourseId, ResourceId};
use chrono::{Duration, NaiveDate};
use derive_getters::Getters;

/// `capacity` counts groups, never players.
///
/// Field states the same contract on its side. Mixing party size into the same
/// number is what left three different meanings of "capacity" in the golf
/// tables, so the type keeps the two apart by carrying only one of them.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AvailabilityRule {
    #[getter(skip)]
    id: Option<String>,
    /// Sunday is 0, matching the rest of CourseBoard.
    weekday: u8,
    #[getter(skip)]
    start_time: String,
    #[getter(skip)]
    end_time: String,
    /// Groups that may be out at once.
    capacity: i32,
    /// Minutes between two starts.
    slot_interval_minutes: i32,
}

const MIN_INTERVAL_MINUTES: i32 = 1;
const MAX_INTERVAL_MINUTES: i32 = 24 * 60;

impl AvailabilityRule {
    pub fn try_new(
        id: Option<String>,
        weekday: u8,
        start_time: impl Into<String>,
        end_time: impl Into<String>,
        capacity: i32,
        slot_interval_minutes: i32,
    ) -> Result<Self, CourseError> {
        if weekday > 6 {
            return Err(CourseError::BadRequest("weekday must be 0..=6"));
        }
        let start_time = normalize_clock(start_time.into())?;
        let end_time = normalize_clock(end_time.into())?;
        if start_time >= end_time {
            return Err(CourseError::BadRequest(
                "the end of a band must be after its start",
            ));
        }
        if capacity < 0 {
            return Err(CourseError::BadRequest("capacity must not be negative"));
        }
        if !(MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(&slot_interval_minutes) {
            return Err(CourseError::BadRequest(
                "start interval must be between 1 and 1440 minutes",
            ));
        }
        Ok(Self {
            id: id.filter(|value| !value.trim().is_empty()),
            weekday,
            start_time,
            end_time,
            capacity,
            slot_interval_minutes,
        })
    }

    pub fn id(&self) -> Option<&str> {
        self.id.as_deref()
    }

    pub fn start_time(&self) -> &str {
        &self.start_time
    }

    pub fn end_time(&self) -> &str {
        &self.end_time
    }

    /// Field counts weekdays from Monday; CourseBoard counts from Sunday.
    pub fn field_day_of_week(&self) -> i8 {
        courseboard_weekday_to_field(self.weekday)
    }
}

/// Sunday-first (CourseBoard, JavaScript) to Monday-first (Field).
pub fn courseboard_weekday_to_field(weekday: u8) -> i8 {
    ((weekday + 6) % 7) as i8
}

/// Monday-first (Field) back to Sunday-first (CourseBoard).
pub fn field_day_of_week_to_courseboard(day_of_week: i8) -> u8 {
    (((day_of_week % 7) + 8) % 7) as u8
}

fn normalize_clock(value: String) -> Result<String, CourseError> {
    // Field answers `HH:MM:SS`; the editor speaks `HH:MM`.
    let trimmed = value.trim();
    let head: String = trimmed.chars().take(5).collect();
    let valid = head.len() == 5
        && head.as_bytes()[2] == b':'
        && head[..2].chars().all(|ch| ch.is_ascii_digit())
        && head[3..].chars().all(|ch| ch.is_ascii_digit())
        && head[..2].parse::<u8>().is_ok_and(|hour| hour <= 23)
        && head[3..].parse::<u8>().is_ok_and(|minute| minute <= 59);
    if !valid {
        return Err(CourseError::BadRequest("times must look like HH:MM"));
    }
    Ok(head)
}

/// A course's whole week, as the editor replaces it in one go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CourseSchedule {
    pub course_id: CourseId,
    pub resource_id: ResourceId,
    pub timezone: String,
    pub rules: Vec<AvailabilityRule>,
}

/// What generating inventory for a date range did, or would do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct GenerationSummary {
    pub created: i64,
    pub updated: i64,
    pub deactivated: i64,
    pub unchanged: i64,
}

/// Tee times built from a schedule, and how far out they now reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuiltInventory {
    pub summary: GenerationSummary,
    pub bookable_through: NaiveDate,
}

/// A saved week, and the inventory built from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedSchedule {
    pub rules: Vec<AvailabilityRule>,
    /// `None` when the week stored but building its tee times did not.
    ///
    /// The two are separate writes and only the first is undoable, so a failure
    /// in the second cannot be reported as a failed save: the rules really are
    /// stored, and nothing is on sale. The caller has to say both.
    pub built: Option<BuiltInventory>,
}

/// How far one course has been built, and when that was last checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InventoryWatermark {
    /// Last date inventory reaches, inclusive.
    pub generated_through: NaiveDate,
    /// Course-local day the top-up last ran for this course.
    pub checked_on: NaiveDate,
}

/// How far ahead the club sells tee times.
///
/// Generated inventory *is* the bookable window: a date with no slot row is
/// refused outright when a booking is taken, so this number is what decides how
/// far out the desk can write one. It is a golf operating rule, not an ERP
/// concept, so CourseBoard owns it (ADR-0005) and keeps it in the tenant's golf
/// extension config.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BookingHorizon {
    days: i64,
}

impl BookingHorizon {
    /// Six months out: long enough for the season bookings a club takes by
    /// phone, short enough that saving a schedule does not write a year of rows.
    pub const DEFAULT_DAYS: i64 = 180;
    pub const MIN_DAYS: i64 = 1;
    /// One short of the generate cap, because the range is `today ..= today + days`.
    pub const MAX_DAYS: i64 = 399;

    pub fn try_new(days: i64) -> Result<Self, CourseError> {
        if !(Self::MIN_DAYS..=Self::MAX_DAYS).contains(&days) {
            return Err(CourseError::BadRequest(
                "booking horizon must be between 1 and 399 days",
            ));
        }
        Ok(Self { days })
    }

    pub fn days(&self) -> i64 {
        self.days
    }

    /// The last date a booking may land on, counted from `today`.
    pub fn last_bookable_date(&self, today: NaiveDate) -> NaiveDate {
        today + Duration::days(self.days)
    }
}

impl Default for BookingHorizon {
    fn default() -> Self {
        Self {
            days: Self::DEFAULT_DAYS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekday_numbering_survives_the_round_trip_in_both_directions() {
        // The two systems disagree on which day is zero, and a rotation that is
        // wrong by one silently sells Monday's tee times on Sunday.
        for weekday in 0u8..=6 {
            let field = courseboard_weekday_to_field(weekday);
            assert_eq!(field_day_of_week_to_courseboard(field), weekday);
        }

        // Spot-check the two ends rather than trusting the loop alone.
        assert_eq!(
            courseboard_weekday_to_field(0),
            6,
            "Sunday is last for Field"
        );
        assert_eq!(
            courseboard_weekday_to_field(1),
            0,
            "Monday is first for Field"
        );
        assert_eq!(field_day_of_week_to_courseboard(6), 0);
        assert_eq!(field_day_of_week_to_courseboard(0), 1);
    }

    #[test]
    fn a_rule_keeps_the_shape_the_editor_sends() {
        let rule = AvailabilityRule::try_new(None, 1, "07:30", "14:00", 4, 8).expect("valid rule");
        assert_eq!(rule.start_time(), "07:30");
        assert_eq!(rule.capacity(), 4);
        assert_eq!(rule.field_day_of_week(), 0);
    }

    #[test]
    fn seconds_from_field_are_trimmed_back_to_the_editor_shape() {
        let rule =
            AvailabilityRule::try_new(None, 1, "07:30:00", "14:00:00", 4, 8).expect("valid rule");
        assert_eq!(rule.start_time(), "07:30");
        assert_eq!(rule.end_time(), "14:00");
    }

    #[test]
    fn a_band_that_ends_before_it_starts_is_refused() {
        assert!(AvailabilityRule::try_new(None, 1, "14:00", "07:30", 4, 8).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "07:30", "07:30", 4, 8).is_err());
    }

    #[test]
    fn an_interval_of_zero_is_refused_because_it_would_generate_forever() {
        assert!(AvailabilityRule::try_new(None, 1, "07:30", "14:00", 4, 0).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "07:30", "14:00", 4, -8).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "07:30", "14:00", 4, 1441).is_err());
    }

    #[test]
    fn nonsense_weekdays_and_negative_capacity_are_refused() {
        assert!(AvailabilityRule::try_new(None, 7, "07:30", "14:00", 4, 8).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "07:30", "14:00", -1, 8).is_err());
    }

    #[test]
    fn a_horizon_stays_inside_what_one_generate_call_may_cover() {
        // The generate cap refuses a span of 400 days or more, and the range
        // starts at today, so 399 is the largest horizon that can be written.
        assert!(BookingHorizon::try_new(399).is_ok());
        assert!(BookingHorizon::try_new(400).is_err());
        assert!(BookingHorizon::try_new(0).is_err());
        assert!(BookingHorizon::try_new(-1).is_err());
    }

    #[test]
    fn the_last_bookable_date_is_the_horizon_counted_from_today() {
        let today = NaiveDate::from_ymd_opt(2026, 8, 10).expect("valid date");
        let horizon = BookingHorizon::try_new(30).expect("valid horizon");
        assert_eq!(
            horizon.last_bookable_date(today),
            NaiveDate::from_ymd_opt(2026, 9, 9).expect("valid date")
        );
        assert_eq!(BookingHorizon::default().days(), 180);
    }

    #[test]
    fn times_that_are_not_clock_times_are_refused() {
        assert!(AvailabilityRule::try_new(None, 1, "7:30", "14:00", 4, 8).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "25:00", "26:00", 4, 8).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "07:60", "14:00", 4, 8).is_err());
        assert!(AvailabilityRule::try_new(None, 1, "", "14:00", 4, 8).is_err());
    }
}
