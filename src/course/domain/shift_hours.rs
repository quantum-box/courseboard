//! What clock times a confirmed shift covers.
//!
//! CourseBoard records a shift as a span — the whole day, the morning, the
//! afternoon — because that is the decision the desk makes. Field's
//! `StaffShift` wants a start and an end, so somebody has to turn one into the
//! other before a shift can be written there.
//!
//! The club already answers this question every week. A course's reception
//! schedule says which weekdays it sends groups out and between which times,
//! and the ledger cannot draw a tee sheet without it. Reading the shift's
//! hours off that schedule keeps one answer in one place: change the schedule
//! and the hours follow, per course, with no second setting to keep in step.
//!
//! Two cases the schedule cannot answer, and both are real:
//!
//! - a shift confirmed with no course on it (`golf_course_id IS NULL`)
//! - a weekday the course does not open
//!
//! Those fall back to the club's default working hours. Inventing a number
//! here would put made-up minutes into Field's payroll, so the default is a
//! tenant setting rather than a constant in this file.

use super::{CourseError, ShiftSpan};

/// A shift's clock times, as Field wants them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShiftHours {
    start_minutes: u16,
    end_minutes: u16,
}

impl ShiftHours {
    pub fn try_new(start_minutes: u16, end_minutes: u16) -> Result<Self, CourseError> {
        if start_minutes >= end_minutes {
            return Err(CourseError::BadRequest("a shift must end after it starts"));
        }
        // 23:59 is the last time `format_clock` can render and `parse_clock`
        // can read back. Allowing 24:00 would build a value that formats as an
        // hour Field has no way to accept.
        if end_minutes >= MINUTES_IN_DAY {
            return Err(CourseError::BadRequest("a shift must end within the day"));
        }
        Ok(Self {
            start_minutes,
            end_minutes,
        })
    }

    /// `HH:MM`, which is the shape Field's `startTime` / `endTime` take.
    pub fn start(&self) -> String {
        format_clock(self.start_minutes)
    }

    pub fn end(&self) -> String {
        format_clock(self.end_minutes)
    }

    pub fn start_minutes(&self) -> u16 {
        self.start_minutes
    }

    pub fn end_minutes(&self) -> u16 {
        self.end_minutes
    }
}

const MINUTES_IN_DAY: u16 = 24 * 60;

/// One opening band on the weekday being asked about, in minutes past midnight.
///
/// The caller flattens whatever it reads — reception rules today — into this,
/// so the arithmetic below never depends on where the bands came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpeningBand {
    start_minutes: u16,
    end_minutes: u16,
}

impl OpeningBand {
    pub fn try_new(start: &str, end: &str) -> Result<Self, CourseError> {
        let start_minutes = parse_clock(start)?;
        let end_minutes = parse_clock(end)?;
        if start_minutes >= end_minutes {
            return Err(CourseError::BadRequest(
                "an opening band must end after it starts",
            ));
        }
        Ok(Self {
            start_minutes,
            end_minutes,
        })
    }
}

/// The club's answer when the schedule has none: used for a shift with no
/// course on it, and for a weekday the course stays shut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefaultWorkingHours {
    full_day: ShiftHours,
    /// Where a single band splits into a morning and an afternoon. Kept apart
    /// from `full_day` because a club that plays through lunch still has a
    /// handover time, and it is not always the midpoint.
    midday_minutes: u16,
}

impl DefaultWorkingHours {
    pub fn try_new(full_day: ShiftHours, midday_minutes: u16) -> Result<Self, CourseError> {
        if midday_minutes <= full_day.start_minutes || midday_minutes >= full_day.end_minutes {
            return Err(CourseError::BadRequest(
                "the midday handover must fall inside the working day",
            ));
        }
        Ok(Self {
            full_day,
            midday_minutes,
        })
    }

    /// What a club that has said nothing works: 07:00-17:00, handing over at
    /// noon.
    ///
    /// The same numbers the `golf_shift_rules` columns default to, so a tenant
    /// with no row and a tenant with a freshly inserted one answer alike. A
    /// club whose courses have a reception schedule never reaches these.
    pub fn club_default() -> Self {
        Self {
            full_day: ShiftHours {
                start_minutes: DEFAULT_WORK_START_MINUTES,
                end_minutes: DEFAULT_WORK_END_MINUTES,
            },
            midday_minutes: DEFAULT_MIDDAY_MINUTES,
        }
    }

    pub fn full_day(&self) -> ShiftHours {
        self.full_day
    }

    pub fn midday_minutes(&self) -> u16 {
        self.midday_minutes
    }
}

const DEFAULT_WORK_START_MINUTES: u16 = 7 * 60;
const DEFAULT_WORK_END_MINUTES: u16 = 17 * 60;
const DEFAULT_MIDDAY_MINUTES: u16 = 12 * 60;

/// The hours a span covers on one day at one course.
///
/// `bands` is that course's opening bands for that weekday, in any order and
/// possibly empty. Empty is not an error: it is a day the course does not
/// open, or a shift nobody placed on a course, and the club's default answers
/// for both.
pub fn hours_for_span(
    span: ShiftSpan,
    bands: &[OpeningBand],
    defaults: DefaultWorkingHours,
) -> Result<ShiftHours, CourseError> {
    let mut sorted: Vec<OpeningBand> = bands.to_vec();
    sorted.sort_by_key(|band| (band.start_minutes, band.end_minutes));

    let Some(first) = sorted.first() else {
        return default_hours(span, defaults);
    };
    let opens = first.start_minutes;
    // The latest finish, not the finish of the latest-starting band. Sorting by
    // start puts a short band that opens late at the end of the list, and a
    // band nested inside a longer one would otherwise close the day early —
    // an afternoon shift ending hours before the course stops sending groups.
    let closes = sorted
        .iter()
        .map(|band| band.end_minutes)
        .max()
        .expect("a non-empty list has a latest finish");

    match span {
        ShiftSpan::FullDay => ShiftHours::try_new(opens, closes),
        ShiftSpan::Morning | ShiftSpan::Afternoon => {
            // A break between bands *is* a handover the club already runs: a
            // course going 07:00-12:00 then 12:00-15:00 has said where its
            // half-days meet, and splitting the outer window at its midpoint
            // would move that to 11:00. With several breaks the one nearest
            // the middle of the day is the one that halves it — taking the
            // first would call an opening hour "the morning" on a course that
            // runs 07:00-08:00, 08:30-12:00, 12:30-16:00. A single band states
            // no handover at all, so there the midpoint is all we have.
            let handover = handover_between(&sorted, opens, closes);
            match span {
                ShiftSpan::Morning => ShiftHours::try_new(opens, handover),
                _ => ShiftHours::try_new(handover, closes),
            }
        }
    }
}

fn default_hours(
    span: ShiftSpan,
    defaults: DefaultWorkingHours,
) -> Result<ShiftHours, CourseError> {
    match span {
        ShiftSpan::FullDay => Ok(defaults.full_day),
        ShiftSpan::Morning => {
            ShiftHours::try_new(defaults.full_day.start_minutes, defaults.midday_minutes)
        }
        ShiftSpan::Afternoon => {
            ShiftHours::try_new(defaults.midday_minutes, defaults.full_day.end_minutes)
        }
    }
}

/// Where the morning hands over to the afternoon.
///
/// Every gap between one band's finish and the next one's start is a handover
/// the club already runs; the one nearest the middle of the day is the one
/// that divides it into halves. Ties go to the earlier break so the same
/// schedule always answers the same way.
fn handover_between(sorted: &[OpeningBand], opens: u16, closes: u16) -> u16 {
    let middle = midpoint(opens, closes);
    sorted
        .iter()
        .take(sorted.len().saturating_sub(1))
        .map(|band| band.end_minutes)
        .filter(|finish| *finish > opens && *finish < closes)
        .min_by_key(|finish| finish.abs_diff(middle))
        .unwrap_or(middle)
}

/// Rounded to the minute below, so a window of an odd length gives the morning
/// the shorter half rather than overlapping the afternoon by thirty seconds.
fn midpoint(opens: u16, closes: u16) -> u16 {
    opens + (closes - opens) / 2
}

fn format_clock(minutes: u16) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

fn parse_clock(value: &str) -> Result<u16, CourseError> {
    let (hours, minutes) = value
        .split_once(':')
        .ok_or(CourseError::BadRequest("a clock time reads as HH:MM"))?;
    let hours: u16 = hours
        .parse()
        .map_err(|_| CourseError::BadRequest("a clock time reads as HH:MM"))?;
    // Seconds are accepted and dropped: Field and the schedule have both been
    // seen to send `HH:MM:SS`, and refusing it would fail a shift over a
    // trailing `:00` nobody typed.
    let minutes: u16 = minutes
        .split(':')
        .next()
        .unwrap_or_default()
        .parse()
        .map_err(|_| CourseError::BadRequest("a clock time reads as HH:MM"))?;
    if hours > 23 || minutes > 59 {
        return Err(CourseError::BadRequest("a clock time reads as HH:MM"));
    }
    Ok(hours * 60 + minutes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> DefaultWorkingHours {
        DefaultWorkingHours::try_new(
            ShiftHours::try_new(7 * 60, 17 * 60).expect("valid day"),
            12 * 60,
        )
        .expect("valid defaults")
    }

    fn band(start: &str, end: &str) -> OpeningBand {
        OpeningBand::try_new(start, end).expect("valid band")
    }

    #[test]
    fn a_full_day_covers_the_course_from_first_start_to_last_finish() {
        let hours = hours_for_span(
            ShiftSpan::FullDay,
            &[band("07:00", "12:00"), band("12:00", "15:00")],
            defaults(),
        )
        .expect("hours");
        assert_eq!(hours.start(), "07:00");
        assert_eq!(hours.end(), "15:00");
    }

    #[test]
    fn two_bands_are_the_morning_and_the_afternoon() {
        // The club has already said where the handover is. Splitting
        // 07:00-15:00 at its midpoint would put it at 11:00 and move a caddie's
        // finish an hour earlier than the course actually hands over.
        let bands = [band("07:00", "12:00"), band("12:00", "15:00")];
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
        let afternoon = hours_for_span(ShiftSpan::Afternoon, &bands, defaults()).expect("hours");
        assert_eq!(
            (morning.start(), morning.end()),
            ("07:00".into(), "12:00".into())
        );
        assert_eq!(
            (afternoon.start(), afternoon.end()),
            ("12:00".into(), "15:00".into())
        );
    }

    #[test]
    fn bands_out_of_order_read_the_same() {
        let bands = [band("12:00", "15:00"), band("07:00", "12:00")];
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
        assert_eq!(
            (morning.start(), morning.end()),
            ("07:00".into(), "12:00".into())
        );
    }

    #[test]
    fn one_band_splits_at_its_midpoint() {
        // Nothing on the day says where the handover is, so the only division
        // available is the middle of the window the course does open.
        let bands = [band("06:00", "14:00")];
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
        let afternoon = hours_for_span(ShiftSpan::Afternoon, &bands, defaults()).expect("hours");
        assert_eq!(morning.end(), "10:00");
        assert_eq!(afternoon.start(), "10:00");
    }

    #[test]
    fn an_odd_window_gives_the_morning_the_shorter_half() {
        let bands = [band("07:00", "14:01")];
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
        assert_eq!(morning.end(), "10:30");
    }

    #[test]
    fn a_day_the_course_does_not_open_falls_back_to_the_club() {
        // Not an error: a caddie can be confirmed for a day this course rests,
        // and Field still needs hours for the shift.
        let full = hours_for_span(ShiftSpan::FullDay, &[], defaults()).expect("hours");
        let morning = hours_for_span(ShiftSpan::Morning, &[], defaults()).expect("hours");
        let afternoon = hours_for_span(ShiftSpan::Afternoon, &[], defaults()).expect("hours");
        assert_eq!((full.start(), full.end()), ("07:00".into(), "17:00".into()));
        assert_eq!(
            (morning.start(), morning.end()),
            ("07:00".into(), "12:00".into())
        );
        assert_eq!(
            (afternoon.start(), afternoon.end()),
            ("12:00".into(), "17:00".into())
        );
    }

    #[test]
    fn a_tie_between_two_breaks_goes_to_the_earlier_one() {
        // 07:00-16:00 puts the middle at 11:30, and the breaks at 10:00 and
        // 13:00 sit ninety minutes either side of it. Neither halves the day
        // better than the other, so the rule has to pick the same one every
        // time or the same schedule would answer differently between runs.
        let bands = [
            band("07:00", "10:00"),
            band("10:30", "13:00"),
            band("13:30", "16:00"),
        ];
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
        let afternoon = hours_for_span(ShiftSpan::Afternoon, &bands, defaults()).expect("hours");
        assert_eq!(
            (morning.start(), morning.end()),
            ("07:00".into(), "10:00".into())
        );
        assert_eq!(
            (afternoon.start(), afternoon.end()),
            ("10:00".into(), "16:00".into())
        );
    }

    #[test]
    fn seconds_on_a_schedule_time_are_dropped_rather_than_refused() {
        let bands = [band("06:53:00", "14:30:00")];
        let full = hours_for_span(ShiftSpan::FullDay, &bands, defaults()).expect("hours");
        assert_eq!((full.start(), full.end()), ("06:53".into(), "14:30".into()));
    }

    #[test]
    fn a_band_nested_inside_a_longer_one_does_not_close_the_day_early() {
        // Sorting by start puts the short late band last, so reading the close
        // off it would end the day at 09:00 while the course keeps sending
        // groups out until 15:00 — and an afternoon caddie would be recorded
        // as going home six hours before the course did.
        let bands = [band("07:00", "15:00"), band("08:00", "09:00")];
        let full = hours_for_span(ShiftSpan::FullDay, &bands, defaults()).expect("hours");
        assert_eq!((full.start(), full.end()), ("07:00".into(), "15:00".into()));
    }

    #[test]
    fn the_handover_is_the_break_nearest_the_middle_of_the_day() {
        // 07:00-16:00 with breaks at 08:00 and 12:00. Taking the first would
        // make "the morning" a single opening hour and hand the afternoon
        // caddie eight; the middle of the day is 11:30, so 12:00 is the break
        // that actually halves it.
        let bands = [
            band("07:00", "08:00"),
            band("08:30", "12:00"),
            band("12:30", "16:00"),
        ];
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
        let afternoon = hours_for_span(ShiftSpan::Afternoon, &bands, defaults()).expect("hours");
        assert_eq!(
            (morning.start(), morning.end()),
            ("07:00".into(), "12:00".into())
        );
        assert_eq!(
            (afternoon.start(), afternoon.end()),
            ("12:00".into(), "16:00".into())
        );
    }

    #[test]
    fn the_two_halves_always_meet_and_never_overlap() {
        // Whatever the schedule looks like, a caddie is on one side of the
        // handover or the other. A gap would lose paid minutes and an overlap
        // would bill them twice.
        for bands in [
            vec![band("07:00", "15:00")],
            vec![band("07:00", "12:00"), band("12:00", "15:00")],
            vec![band("07:00", "10:00"), band("10:30", "16:00")],
            vec![band("06:53", "14:30")],
        ] {
            let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).expect("hours");
            let afternoon =
                hours_for_span(ShiftSpan::Afternoon, &bands, defaults()).expect("hours");
            let full = hours_for_span(ShiftSpan::FullDay, &bands, defaults()).expect("hours");
            assert_eq!(morning.end_minutes(), afternoon.start_minutes());
            assert_eq!(morning.start_minutes(), full.start_minutes());
            assert_eq!(afternoon.end_minutes(), full.end_minutes());
        }
    }

    #[test]
    fn a_shift_cannot_be_built_on_an_hour_that_cannot_be_written() {
        // 24:00 formats out of this type but no clock reads it back.
        assert!(ShiftHours::try_new(23 * 60, 24 * 60).is_err());
        assert!(ShiftHours::try_new(23 * 60, 23 * 60 + 59).is_ok());
    }

    #[test]
    fn a_band_that_ends_before_it_starts_is_refused() {
        assert!(OpeningBand::try_new("15:00", "07:00").is_err());
        assert!(OpeningBand::try_new("07:00", "07:00").is_err());
    }

    #[test]
    fn a_clock_time_that_is_not_hh_mm_is_refused() {
        assert!(OpeningBand::try_new("7", "15:00").is_err());
        assert!(OpeningBand::try_new("25:00", "26:00").is_err());
        assert!(OpeningBand::try_new("07:60", "15:00").is_err());
    }

    #[test]
    fn a_midday_handover_outside_the_working_day_is_refused() {
        let day = ShiftHours::try_new(7 * 60, 17 * 60).expect("valid day");
        assert!(DefaultWorkingHours::try_new(day, 6 * 60).is_err());
        assert!(DefaultWorkingHours::try_new(day, 18 * 60).is_err());
        assert!(DefaultWorkingHours::try_new(day, 7 * 60).is_err());
    }
}
