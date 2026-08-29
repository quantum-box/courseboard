//! Work a caddie is put on when they are not walking a round.
//!
//! A caddie confirmed for the day whose tee sheet never fills is idle on the
//! board and busy in the yard. The club's own words for that work — コース整備,
//! 練習場, フロント補助 — are golf's vocabulary and stay on this side
//! (ADR-0005), in CourseBoard's own rows (ADR-0009).
//!
//! Work is filed against a stretch of the day, not the whole of it: a caddie
//! sent to the practice range until noon walks the afternoon groups. The
//! window is what every count reads — a round is refused when it overlaps one,
//! and the day's supply loses the halves the windows cover.

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;

use crate::course::domain::caddie_plan::MIDDAY_MINUTES;
use crate::course::domain::{CaddieId, CourseError};

/// Minutes in a day, which is also where an all-day window ends.
pub const MINUTES_IN_DAY: i32 = 24 * 60;

/// More jobs than this stops being a pick list.
pub const MAX_CADDIE_DUTIES: usize = 30;
/// Matches the column width; a longer label is an instruction, not a job name.
pub const MAX_CADDIE_DUTY_LENGTH: usize = 40;
/// Matches the column width on the note.
pub const MAX_CADDIE_DUTY_NOTE_LENGTH: usize = 255;

/// The jobs this club fills, in the order it arranged them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CaddieDutyOptions {
    options: Vec<String>,
}

impl CaddieDutyOptions {
    /// Validate an explicit save.
    ///
    /// Whitespace is trimmed and blank rows dropped — the form grows rows the
    /// operator may leave empty — but a duplicate, an over-long label, or too
    /// many of them is refused rather than silently pruned: the list that comes
    /// back must be the list they arranged.
    pub fn try_new(values: Vec<String>) -> Result<Self, CourseError> {
        let options: Vec<String> = values
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        if options.len() > MAX_CADDIE_DUTIES {
            return Err(CourseError::BadRequest("too many caddie duties"));
        }
        if options
            .iter()
            .any(|value| value.chars().count() > MAX_CADDIE_DUTY_LENGTH)
        {
            return Err(CourseError::BadRequest("a caddie duty name is too long"));
        }
        let mut seen: Vec<&String> = Vec::new();
        for option in &options {
            if seen.contains(&option) {
                return Err(CourseError::BadRequest(
                    "the same caddie duty appears twice",
                ));
            }
            seen.push(option);
        }
        Ok(Self { options })
    }

    /// Reconstitute from our own storage, which `try_new` guarded on the way in.
    pub fn reconstitute(options: Vec<String>) -> Self {
        Self { options }
    }

    pub fn options(&self) -> &[String] {
        &self.options
    }

    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }

    /// Whether the list still offers this job.
    ///
    /// Asked before a day is filed, so the desk cannot type a job the club
    /// never arranged. Never asked of a day already filed: an assignment keeps
    /// the label it was filed under, and retiring a job does not rewrite what
    /// last week says the caddie did.
    pub fn offers(&self, label: &str) -> bool {
        self.options.iter().any(|option| option == label)
    }
}

/// The stretch of a day one duty covers, in minutes from the club's midnight.
///
/// Half-open: a job ending at noon and one starting at noon do not overlap,
/// which is how a morning and an afternoon duty sit on the same day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DutyWindow {
    start_minute: i32,
    end_minute: i32,
}

impl DutyWindow {
    /// The whole day, which is what an unset window means.
    pub fn all_day() -> Self {
        Self {
            start_minute: 0,
            end_minute: MINUTES_IN_DAY,
        }
    }

    pub fn try_new(start_minute: i32, end_minute: i32) -> Result<Self, CourseError> {
        if !(0..=MINUTES_IN_DAY).contains(&start_minute)
            || !(0..=MINUTES_IN_DAY).contains(&end_minute)
        {
            return Err(CourseError::BadRequest("that time is not in the day"));
        }
        if end_minute <= start_minute {
            return Err(CourseError::BadRequest("the work ends before it starts"));
        }
        Ok(Self {
            start_minute,
            end_minute,
        })
    }

    /// Reconstitute from our own storage, which `try_new` guarded on the way in.
    pub fn reconstitute(start_minute: i32, end_minute: i32) -> Self {
        Self {
            start_minute,
            end_minute,
        }
    }

    pub fn start_minute(&self) -> i32 {
        self.start_minute
    }

    pub fn end_minute(&self) -> i32 {
        self.end_minute
    }

    pub fn is_all_day(&self) -> bool {
        self.start_minute == 0 && self.end_minute == MINUTES_IN_DAY
    }

    pub fn overlaps(&self, other: &Self) -> bool {
        self.start_minute < other.end_minute && other.start_minute < self.end_minute
    }

    /// Whether the window stands in the way of something running between these
    /// two minutes of the day.
    pub fn overlaps_minutes(&self, start_minute: i32, end_minute: i32) -> bool {
        self.start_minute < end_minute && start_minute < self.end_minute
    }

    /// The halves of the day this window takes away, read against local noon —
    /// the same line the half-day shift requests are read against.
    pub fn blocks_morning(&self) -> bool {
        self.overlaps_minutes(0, MIDDAY_MINUTES as i32)
    }

    pub fn blocks_afternoon(&self) -> bool {
        self.overlaps_minutes(MIDDAY_MINUTES as i32, MINUTES_IN_DAY)
    }
}

/// One caddie put on other work for one day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieDutyAssignment {
    /// Absent until the row is filed. A day can hold several of these, so the
    /// desk clears one by id rather than by naming the caddie and the date.
    id: Option<i64>,
    caddie_id: CaddieId,
    date: NaiveDate,
    window: DutyWindow,
    duty_label: String,
    note: Option<String>,
    updated_by: Option<String>,
}

impl CaddieDutyAssignment {
    /// What the desk filed, checked against the club's list of jobs.
    pub fn try_new(
        caddie_id: CaddieId,
        date: NaiveDate,
        window: DutyWindow,
        duty_label: impl Into<String>,
        note: Option<String>,
        updated_by: Option<String>,
    ) -> Result<Self, CourseError> {
        let duty_label = duty_label.into().trim().to_string();
        if duty_label.is_empty() {
            return Err(CourseError::BadRequest("name the work to be done"));
        }
        if duty_label.chars().count() > MAX_CADDIE_DUTY_LENGTH {
            return Err(CourseError::BadRequest("a caddie duty name is too long"));
        }
        let note = note
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if note
            .as_ref()
            .is_some_and(|value| value.chars().count() > MAX_CADDIE_DUTY_NOTE_LENGTH)
        {
            return Err(CourseError::BadRequest("the note is too long"));
        }
        Ok(Self {
            id: None,
            caddie_id,
            date,
            window,
            duty_label,
            note,
            updated_by: updated_by
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }

    /// Reconstitute from our own storage.
    pub fn reconstitute(
        id: Option<i64>,
        caddie_id: CaddieId,
        date: NaiveDate,
        window: DutyWindow,
        duty_label: String,
        note: Option<String>,
        updated_by: Option<String>,
    ) -> Self {
        Self {
            id,
            caddie_id,
            date,
            window,
            duty_label,
            note,
            updated_by,
        }
    }

    pub fn id(&self) -> Option<i64> {
        self.id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn window(&self) -> DutyWindow {
        self.window
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn duty_label(&self) -> &str {
        &self.duty_label
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn updated_by(&self) -> Option<&str> {
        self.updated_by.as_deref()
    }
}

/// The windows one caddie is on other work for, on one day.
pub fn duty_windows_for(
    assignments: &[CaddieDutyAssignment],
    caddie_id: &str,
    date: NaiveDate,
) -> Vec<DutyWindow> {
    assignments
        .iter()
        .filter(|assignment| assignment.date() == date)
        .filter(|assignment| assignment.caddie_id().as_str() == caddie_id)
        .map(|assignment| assignment.window())
        .collect()
}

/// A round's stretch of the day, as minutes from the club's midnight.
///
/// A round that would run past midnight is clamped to the end of the day: the
/// windows it is compared against cannot reach into tomorrow either, and a
/// caddie kept on until 2am is not a case the board is asked about.
pub fn round_minutes(starts_at: DateTime<Utc>, occupied_minutes: i64, timezone: Tz) -> (i32, i32) {
    let local = starts_at.with_timezone(&timezone);
    let start =
        i32::try_from(chrono::Timelike::hour(&local) * 60 + chrono::Timelike::minute(&local))
            .unwrap_or(0);
    let end = i32::try_from(i64::from(start) + occupied_minutes.max(1)).unwrap_or(MINUTES_IN_DAY);
    (start, end.min(MINUTES_IN_DAY))
}

/// Whether other work stands in the way of a round this caddie would walk.
///
/// Overlap, not the bare fact of a duty: the point of filing a stretch of the
/// day is that the rest of it is still the caddie's to work.
pub fn duty_blocks_round(
    assignments: &[CaddieDutyAssignment],
    caddie_id: &str,
    date: NaiveDate,
    starts_at: DateTime<Utc>,
    occupied_minutes: i64,
    timezone: Tz,
) -> bool {
    let (start, end) = round_minutes(starts_at, occupied_minutes, timezone);
    duty_windows_for(assignments, caddie_id, date)
        .iter()
        .any(|window| window.overlaps_minutes(start, end))
}

/// `(morning, afternoon)` — the halves of the day this caddie has left.
///
/// This is what the aggregate counts read. They count rounds, not minutes, so
/// a window is spent as the halves it covers: the club sells a morning group
/// and an afternoon group, and a caddie on the range until noon can still walk
/// one of them.
pub fn free_halves(
    assignments: &[CaddieDutyAssignment],
    caddie_id: &str,
    date: NaiveDate,
) -> (bool, bool) {
    let windows = duty_windows_for(assignments, caddie_id, date);
    (
        !windows.iter().any(DutyWindow::blocks_morning),
        !windows.iter().any(DutyWindow::blocks_afternoon),
    )
}

/// How many of the day's two rounds this caddie is still free for.
pub fn free_rounds(assignments: &[CaddieDutyAssignment], caddie_id: &str, date: NaiveDate) -> i32 {
    let (morning, afternoon) = free_halves(assignments, caddie_id, date);
    i32::from(morning) + i32::from(afternoon)
}

/// The caddies whose whole day is taken by other work, as ids the counts drop.
pub fn caddies_off_the_day(assignments: &[CaddieDutyAssignment], date: NaiveDate) -> Vec<&str> {
    assignments
        .iter()
        .filter(|assignment| assignment.date() == date)
        .map(|assignment| assignment.caddie_id().as_str())
        .filter(|caddie_id| free_rounds(assignments, caddie_id, date) == 0)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 29).expect("date")
    }

    fn duties(labels: &[&str]) -> CaddieDutyOptions {
        CaddieDutyOptions::try_new(labels.iter().map(|label| label.to_string()).collect())
            .expect("duties")
    }

    fn at(hour: i32, minute: i32) -> i32 {
        hour * 60 + minute
    }

    fn window(from: (i32, i32), to: (i32, i32)) -> DutyWindow {
        DutyWindow::try_new(at(from.0, from.1), at(to.0, to.1)).expect("window")
    }

    fn filed(caddie: &str, window: DutyWindow) -> CaddieDutyAssignment {
        CaddieDutyAssignment::reconstitute(
            Some(1),
            CaddieId::new(caddie),
            date(),
            window,
            "コース整備".to_string(),
            None,
            None,
        )
    }

    #[test]
    fn blank_rows_are_dropped_but_real_entries_are_kept_in_order() {
        let list = duties(&[" コース整備 ", "", "練習場"]);
        assert_eq!(list.options(), ["コース整備", "練習場"]);
    }

    #[test]
    fn a_duplicate_job_is_refused_rather_than_pruned() {
        assert!(CaddieDutyOptions::try_new(vec!["練習場".into(), " 練習場".into()]).is_err());
    }

    #[test]
    fn a_job_the_club_never_arranged_is_not_offered() {
        let list = duties(&["コース整備"]);
        assert!(list.offers("コース整備"));
        assert!(!list.offers("練習場"));
    }

    #[test]
    fn a_window_has_to_end_after_it_starts_and_stay_inside_the_day() {
        assert!(DutyWindow::try_new(at(12, 0), at(12, 0)).is_err());
        assert!(DutyWindow::try_new(at(13, 0), at(9, 0)).is_err());
        assert!(DutyWindow::try_new(-30, at(9, 0)).is_err());
        assert!(DutyWindow::try_new(at(9, 0), MINUTES_IN_DAY + 1).is_err());
        assert!(DutyWindow::all_day().is_all_day());
    }

    #[test]
    fn a_morning_job_and_an_afternoon_one_sit_on_the_same_day() {
        let morning = window((8, 0), (12, 0));
        let afternoon = window((12, 0), (15, 0));
        assert!(!morning.overlaps(&afternoon));
        assert!(morning.overlaps(&window((11, 30), (13, 0))));
    }

    #[test]
    fn a_window_is_spent_as_the_halves_it_covers() {
        let morning = window((8, 0), (12, 0));
        assert!(morning.blocks_morning());
        assert!(!morning.blocks_afternoon());

        let over_noon = window((11, 30), (12, 30));
        assert!(over_noon.blocks_morning());
        assert!(over_noon.blocks_afternoon());

        assert!(DutyWindow::all_day().blocks_morning());
        assert!(DutyWindow::all_day().blocks_afternoon());
    }

    #[test]
    fn a_day_has_to_name_the_work() {
        assert!(CaddieDutyAssignment::try_new(
            CaddieId::new("cp_1"),
            date(),
            DutyWindow::all_day(),
            "   ",
            None,
            None
        )
        .is_err());
    }

    #[test]
    fn an_empty_note_is_no_note_rather_than_a_blank_one() {
        let assignment = CaddieDutyAssignment::try_new(
            CaddieId::new("cp_1"),
            date(),
            DutyWindow::all_day(),
            "コース整備",
            Some("  ".into()),
            Some(" 受付 ".into()),
        )
        .expect("assignment");
        assert_eq!(assignment.note(), None);
        assert_eq!(assignment.updated_by(), Some("受付"));
    }

    /// 07:00 and 13:00 JST on the test day.
    fn morning_tee() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 28, 22, 0, 0).unwrap()
    }

    fn afternoon_tee() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 29, 4, 0, 0).unwrap()
    }

    #[test]
    fn a_morning_job_refuses_the_morning_round_and_leaves_the_afternoon_one() {
        let filed = vec![filed("cp_1", window((8, 0), (12, 0)))];
        // The morning round runs 07:00–11:30, into the job.
        assert!(duty_blocks_round(
            &filed,
            "cp_1",
            date(),
            morning_tee(),
            270,
            chrono_tz::Asia::Tokyo,
        ));
        assert!(!duty_blocks_round(
            &filed,
            "cp_1",
            date(),
            afternoon_tee(),
            270,
            chrono_tz::Asia::Tokyo,
        ));
    }

    #[test]
    fn another_caddies_job_never_stands_in_this_ones_way() {
        let filed = vec![filed("cp_2", DutyWindow::all_day())];
        assert!(!duty_blocks_round(
            &filed,
            "cp_1",
            date(),
            morning_tee(),
            270,
            chrono_tz::Asia::Tokyo,
        ));
    }

    #[test]
    fn the_counts_read_a_window_as_the_halves_it_leaves() {
        let morning = vec![filed("cp_1", window((8, 0), (12, 0)))];
        assert_eq!(free_halves(&morning, "cp_1", date()), (false, true));
        assert_eq!(free_rounds(&morning, "cp_1", date()), 1);
        assert!(caddies_off_the_day(&morning, date()).is_empty());

        let both = vec![
            filed("cp_1", window((8, 0), (12, 0))),
            filed("cp_1", window((13, 0), (17, 0))),
        ];
        assert_eq!(free_halves(&both, "cp_1", date()), (false, false));
        assert_eq!(caddies_off_the_day(&both, date()), ["cp_1", "cp_1"]);

        let untouched = vec![filed("cp_2", DutyWindow::all_day())];
        assert_eq!(free_rounds(&untouched, "cp_1", date()), 2);
    }

    #[test]
    fn a_day_nobody_filed_leaves_both_halves_free() {
        assert_eq!(free_halves(&[], "cp_1", date()), (true, true));
    }
}
