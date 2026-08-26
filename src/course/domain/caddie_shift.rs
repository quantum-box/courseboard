//! Confirmed caddie shifts: who works, on which course, on which day.
//!
//! The shift *request* (see `caddie_ops.rs`) says who would rather not work,
//! and a day nobody filed reads as available. That is enough to staff a
//! morning but not to sell one: a course's caddie-attached tee times are
//! limited by the caddies standing on that course, and the request carries no
//! course at all. So the month is confirmed up front — the requests are turned
//! into placed shifts once the filing deadline has passed, and the desk edits
//! what the generator could not know.
//!
//! Main and sub course memberships are a capability, not a quota: they say
//! which courses a caddie *can* work. How much they can take is the caddie's
//! own limit, two rounds at most in a day.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Datelike, NaiveDate, Utc, Weekday};

use super::{AvailabilityStatus, CaddieId, CourseError, CourseId};

/// Nobody goes round more than twice in a day, whatever their profile says.
pub const MAX_ROUNDS_PER_SHIFT: i32 = 2;

/// Days in a row somebody may be confirmed to work.
///
/// Labour Standards Act art. 35 requires one day off a week, or four in four
/// weeks under a rostered-holiday rule. Capping the run at six is the stricter
/// reading and the one that cannot be argued with: whichever day a week is
/// counted from, a run of six followed by a rest day leaves a day off inside
/// every seven. A month with no filed requests used to be confirmed as thirty
/// straight working days, which is what this stops.
pub const MAX_CONSECUTIVE_WORK_DAYS: i64 = 6;

/// How a caddie's month with no filed request should be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnfiledRequest {
    /// The day is confirmed as work. What dispatch has always assumed, and
    /// right for a club whose caddies file only the days they cannot come.
    Working,
    /// The day is confirmed off. Right for a club where a request is how you
    /// say you are coming — a low filing rate then costs staff, not rest.
    Off,
}

impl UnfiledRequest {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::Off => "off",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "off" => Self::Off,
            _ => Self::Working,
        }
    }
}

/// The club's rules a month is planned against.
///
/// The law fixes one of these — nobody works more than six days in a row — and
/// the rest are the club's own. They are tenant settings rather than constants
/// because clubs differ: which days fill, how many rounds a course can turn
/// round in a day, what the work rules promise, and whether a caddie who files
/// nothing is coming in or staying home.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShiftPolicy {
    avoided: HashSet<Weekday>,
    max_consecutive_work_days: i64,
    max_rounds_per_day: i32,
    min_rest_days_per_month: i64,
    unfiled: UnfiledRequest,
}

impl Default for ShiftPolicy {
    fn default() -> Self {
        Self {
            avoided: HashSet::from([Weekday::Sat, Weekday::Sun]),
            max_consecutive_work_days: MAX_CONSECUTIVE_WORK_DAYS,
            max_rounds_per_day: MAX_ROUNDS_PER_SHIFT,
            min_rest_days_per_month: 0,
            unfiled: UnfiledRequest::Working,
        }
    }
}

impl ShiftPolicy {
    /// Weekdays to keep clear of rest days, with everything else as it comes.
    pub fn new(avoided: impl IntoIterator<Item = Weekday>) -> Self {
        Self {
            avoided: avoided.into_iter().collect(),
            ..Self::default()
        }
    }

    /// Nothing is protected: rest days fall wherever the window is emptiest.
    pub fn unrestricted() -> Self {
        Self {
            avoided: HashSet::new(),
            ..Self::default()
        }
    }

    /// A club may promise more rest than the law demands, never less — a value
    /// above the statutory ceiling would be an unlawful roster, so it clamps.
    pub fn with_max_consecutive_work_days(mut self, days: i64) -> Self {
        self.max_consecutive_work_days = days.clamp(1, MAX_CONSECUTIVE_WORK_DAYS);
        self
    }

    /// Rounds a caddie may be given in a day, whatever their own profile says.
    /// Never more than two: there is not the daylight for a third.
    pub fn with_max_rounds_per_day(mut self, rounds: i32) -> Self {
        self.max_rounds_per_day = rounds.clamp(1, MAX_ROUNDS_PER_SHIFT);
        self
    }

    /// Rest days the work rules promise over a calendar month. Zero leaves the
    /// consecutive-day limit as the only rule, which is the statutory floor.
    pub fn with_min_rest_days_per_month(mut self, days: i64) -> Self {
        self.min_rest_days_per_month = days.max(0);
        self
    }

    pub fn with_unfiled_request(mut self, unfiled: UnfiledRequest) -> Self {
        self.unfiled = unfiled;
        self
    }

    pub fn avoids(&self, date: NaiveDate) -> bool {
        self.avoided.contains(&date.weekday())
    }

    pub fn max_consecutive_work_days(&self) -> i64 {
        self.max_consecutive_work_days
    }

    pub fn max_rounds_per_day(&self) -> i32 {
        self.max_rounds_per_day
    }

    pub fn min_rest_days_per_month(&self) -> i64 {
        self.min_rest_days_per_month
    }

    pub fn unfiled_request(&self) -> UnfiledRequest {
        self.unfiled
    }

    /// The protected days, Monday first, so storage and screens read the same
    /// order however the set was built.
    pub fn weekdays(&self) -> Vec<Weekday> {
        WEEK.iter()
            .copied()
            .filter(|weekday| self.avoided.contains(weekday))
            .collect()
    }

    /// `"sat,sun"`. Empty when nothing is protected.
    pub fn as_csv(&self) -> String {
        self.weekdays()
            .into_iter()
            .map(weekday_key)
            .collect::<Vec<_>>()
            .join(",")
    }

    /// Reads `"sat,sun"` into the protected days, leaving everything else at
    /// its default. Unknown names are ignored rather than failing a month's
    /// plan over a stored value nobody can fix from the screens.
    pub fn parse_csv(raw: &str) -> Self {
        Self::new(
            raw.split(',')
                .filter_map(|entry| parse_weekday(entry.trim())),
        )
    }
}

const WEEK: [Weekday; 7] = [
    Weekday::Mon,
    Weekday::Tue,
    Weekday::Wed,
    Weekday::Thu,
    Weekday::Fri,
    Weekday::Sat,
    Weekday::Sun,
];

pub fn weekday_key(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "mon",
        Weekday::Tue => "tue",
        Weekday::Wed => "wed",
        Weekday::Thu => "thu",
        Weekday::Fri => "fri",
        Weekday::Sat => "sat",
        Weekday::Sun => "sun",
    }
}

pub fn parse_weekday(raw: &str) -> Option<Weekday> {
    match raw.to_ascii_lowercase().as_str() {
        "mon" | "monday" => Some(Weekday::Mon),
        "tue" | "tuesday" => Some(Weekday::Tue),
        "wed" | "wednesday" => Some(Weekday::Wed),
        "thu" | "thursday" => Some(Weekday::Thu),
        "fri" | "friday" => Some(Weekday::Fri),
        "sat" | "saturday" => Some(Weekday::Sat),
        "sun" | "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

/// Which part of the day a confirmed shift covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShiftSpan {
    FullDay,
    Morning,
    Afternoon,
}

impl ShiftSpan {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FullDay => "full_day",
            Self::Morning => "morning",
            Self::Afternoon => "afternoon",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "morning" => Self::Morning,
            "afternoon" => Self::Afternoon,
            _ => Self::FullDay,
        }
    }

    /// Half a day is one round: there is no time for a second.
    pub fn is_half_day(self) -> bool {
        matches!(self, Self::Morning | Self::Afternoon)
    }

    /// The span a filed request implies. `None` for a day off, which is not a
    /// span at all.
    fn from_request(status: AvailabilityStatus) -> Option<Self> {
        match status {
            AvailabilityStatus::Unavailable => None,
            AvailabilityStatus::MorningOnly => Some(Self::Morning),
            AvailabilityStatus::AfternoonOnly => Some(Self::Afternoon),
            AvailabilityStatus::Available | AvailabilityStatus::LightDuty => Some(Self::FullDay),
        }
    }
}

/// Where a confirmed shift came from, which decides what may overwrite it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShiftOrigin {
    /// Written by the monthly run from the filed requests.
    Generated,
    /// Changed by the desk.
    Edited,
    /// Changed by the desk and held: "this caddie, this course, this day".
    Pinned,
}

impl ShiftOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Generated => "generated",
            Self::Edited => "edited",
            Self::Pinned => "pinned",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "edited" => Self::Edited,
            "pinned" => Self::Pinned,
            _ => Self::Generated,
        }
    }

    /// Running the month again rewrites what the last run wrote, and leaves a
    /// pinned day alone. A plain edit is deliberately *not* protected: it is a
    /// correction to that run's output, and re-running with better requests
    /// should produce it again.
    pub fn survives_regeneration(self) -> bool {
        matches!(self, Self::Pinned)
    }

    /// Whether balancing a short day may move this shift to another course.
    pub fn is_movable(self) -> bool {
        !matches!(self, Self::Pinned)
    }
}

/// One caddie's confirmed day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieShift {
    caddie_id: CaddieId,
    date: NaiveDate,
    /// Where they work it. `None` is confirmed but unplaced — a day off, or
    /// somebody with no main course yet. An unplaced shift adds to no course's
    /// supply, which is what keeps the gap visible.
    course_id: Option<CourseId>,
    is_working: bool,
    span: ShiftSpan,
    rounds_capacity: i32,
    origin: ShiftOrigin,
    note: Option<String>,
    updated_by: Option<String>,
    updated_at: Option<DateTime<Utc>>,
}

impl CaddieShift {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        caddie_id: impl Into<CaddieId>,
        date: NaiveDate,
        course_id: Option<CourseId>,
        is_working: bool,
        span: ShiftSpan,
        rounds_capacity: i32,
        origin: ShiftOrigin,
        note: Option<String>,
        updated_by: Option<String>,
        updated_at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            date,
            course_id,
            is_working,
            span,
            rounds_capacity: rounds_capacity.max(0),
            origin,
            note: trimmed(note),
            updated_by: trimmed(updated_by),
            updated_at,
        }
    }

    /// A day nobody works: an off day, or a caddie who has left the roster.
    fn off(caddie_id: CaddieId, date: NaiveDate, origin: ShiftOrigin) -> Self {
        Self {
            caddie_id,
            date,
            course_id: None,
            is_working: false,
            span: ShiftSpan::FullDay,
            rounds_capacity: 0,
            origin,
            note: None,
            updated_by: None,
            updated_at: None,
        }
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn course_id(&self) -> Option<&CourseId> {
        self.course_id.as_ref()
    }

    pub fn is_working(&self) -> bool {
        self.is_working
    }

    pub fn span(&self) -> ShiftSpan {
        self.span
    }

    pub fn rounds_capacity(&self) -> i32 {
        self.rounds_capacity
    }

    pub fn origin(&self) -> ShiftOrigin {
        self.origin
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn updated_by(&self) -> Option<&str> {
        self.updated_by.as_deref()
    }

    pub fn updated_at(&self) -> Option<DateTime<Utc>> {
        self.updated_at
    }

    /// What this shift contributes to its course's supply for the day.
    pub fn supplies(&self, course_id: &CourseId) -> i32 {
        match self.course_id.as_ref() {
            Some(placed) if placed == course_id && self.is_working => self.rounds_capacity,
            _ => 0,
        }
    }
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// A request as filed for one day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShiftRequest {
    pub status: AvailabilityStatus,
    pub two_round_request: bool,
}

/// One caddie, as the monthly run sees them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShiftSeed {
    pub caddie_id: CaddieId,
    pub display_name: String,
    /// Retired or suspended caddies are confirmed off, not placed.
    pub is_assignable: bool,
    pub can_two_rounds: bool,
    pub max_rounds_per_day: i32,
    /// The main course membership. Without one there is nowhere to put them.
    pub main_course_id: Option<CourseId>,
    pub requests: HashMap<NaiveDate, ShiftRequest>,
}

/// The month a run produced, and what the desk still has to decide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthShiftPlan {
    shifts: Vec<CaddieShift>,
    pinned_kept: usize,
    unplaced: Vec<String>,
    statutory_rest_days: usize,
    overworked: Vec<String>,
}

impl MonthShiftPlan {
    pub fn shifts(&self) -> &[CaddieShift] {
        &self.shifts
    }

    pub fn into_shifts(self) -> Vec<CaddieShift> {
        self.shifts
    }

    /// How many days were left as the desk had pinned them.
    pub fn pinned_kept(&self) -> usize {
        self.pinned_kept
    }

    /// Caddies who would work but have no main course, by name. Not an error:
    /// the month is still generated, and they show up unplaced so the gap is
    /// something the desk can see and fix.
    pub fn unplaced(&self) -> &[String] {
        &self.unplaced
    }

    /// Days turned into rest days because the run had reached six working days
    /// in a row. Nobody filed for them; the law requires them.
    pub fn statutory_rest_days(&self) -> usize {
        self.statutory_rest_days
    }

    /// Caddies still over the limit after the run, by name. Only pinned days
    /// can do this — the run will not overwrite a decision the desk held — so
    /// it is reported rather than silently corrected.
    pub fn overworked(&self) -> &[String] {
        &self.overworked
    }
}

/// Turn a month of filed requests into confirmed, placed shifts.
///
/// A day with no request reads as working, the same way dispatch already reads
/// it — the deadline and the submission list are what stop that from being a
/// silent guess. That alone would confirm a month of unbroken work for anybody
/// who filed nothing, so the run also inserts the rest days the law requires:
/// after [`MAX_CONSECUTIVE_WORK_DAYS`] in a row, the next day is a day off
/// whatever the requests say.
///
/// `existing` carries two things: the pinned days to keep, and the confirmed
/// days immediately *before* the month, so a run of work crossing the month
/// boundary is counted rather than reset to zero on the 1st.
pub fn plan_month_shifts(
    dates: &[NaiveDate],
    seeds: &[ShiftSeed],
    existing: &[CaddieShift],
    policy: &ShiftPolicy,
) -> MonthShiftPlan {
    let held: HashMap<(&str, NaiveDate), &CaddieShift> = existing
        .iter()
        .filter(|shift| shift.origin().survives_regeneration())
        .map(|shift| ((shift.caddie_id().as_str(), shift.date()), shift))
        .collect();
    let earlier: HashMap<(&str, NaiveDate), &CaddieShift> = match dates.first() {
        Some(first) => existing
            .iter()
            .filter(|shift| shift.date() < *first)
            .map(|shift| ((shift.caddie_id().as_str(), shift.date()), shift))
            .collect(),
        None => HashMap::new(),
    };

    let mut shifts = Vec::with_capacity(dates.len() * seeds.len());
    let mut pinned_kept = 0;
    let mut statutory_rest_days = 0;
    let mut unplaced_ids: HashSet<&str> = HashSet::new();
    let mut unplaced = Vec::new();
    let mut overworked_ids: HashSet<&str> = HashSet::new();
    let mut overworked = Vec::new();
    // How many people are already off each day. Filled in as the roster is
    // walked, so each caddie's rest day is chosen against the ones placed
    // before them and the day everybody is off never happens.
    let mut resting_by_date: HashMap<NaiveDate, usize> = HashMap::new();

    for seed in seeds {
        let preceding = run_before(&earlier, seed.caddie_id.as_str(), dates.first(), policy);
        let inserted_rest =
            place_rest_days(dates, seed, &held, preceding, policy, &mut resting_by_date);

        let mut worked_in_a_row = preceding;
        for date in dates {
            // A pinned day is the desk's decision and stands, even when it
            // pushes somebody past the limit. Saying so is the most this run
            // can do about it.
            if let Some(pinned) = held.get(&(seed.caddie_id.as_str(), *date)) {
                worked_in_a_row = if pinned.is_working() {
                    worked_in_a_row + 1
                } else {
                    0
                };
                if worked_in_a_row > policy.max_consecutive_work_days()
                    && overworked_ids.insert(seed.caddie_id.as_str())
                {
                    overworked.push(seed.display_name.clone());
                }
                shifts.push((*pinned).clone());
                pinned_kept += 1;
                continue;
            }

            let mut shift = plan_one_day(seed, *date, policy);
            if shift.is_working() && inserted_rest.contains(date) {
                shift = CaddieShift::off(seed.caddie_id.clone(), *date, ShiftOrigin::Generated);
                statutory_rest_days += 1;
            }
            worked_in_a_row = if shift.is_working() {
                worked_in_a_row + 1
            } else {
                0
            };
            if worked_in_a_row > policy.max_consecutive_work_days()
                && overworked_ids.insert(seed.caddie_id.as_str())
            {
                overworked.push(seed.display_name.clone());
            }
            if shift.is_working()
                && shift.course_id().is_none()
                && unplaced_ids.insert(seed.caddie_id.as_str())
            {
                unplaced.push(seed.display_name.clone());
            }
            shifts.push(shift);
        }
    }

    MonthShiftPlan {
        shifts,
        pinned_kept,
        unplaced,
        statutory_rest_days,
        overworked,
    }
}

/// Choose this caddie's rest days for the month.
///
/// The rule is a ceiling, not a schedule: a rest day has to fall within
/// [`MAX_CONSECUTIVE_WORK_DAYS`] of the last one, and anywhere inside that
/// window will do. Taking the deadline every time — the obvious reading — puts
/// the whole roster off on the same day, because everyone counts from the same
/// 1st. So the window is a choice, made in this order:
///
/// 1. A day the caddie already filed off. It costs the course nothing.
/// 2. A day the tenant has not protected. Saturdays and Sundays are protected
///    by default — a course short of caddies on a Saturday is the expensive
///    kind of short — and the club can change which days those are.
/// 3. The day fewest colleagues are already off, which is what keeps the
///    course staffed rather than emptying it all at once.
/// 4. The latest such day, so the month spends as few days off as the law
///    allows.
///
/// Public holidays are as busy as weekends, but the tenant has no holiday
/// calendar yet; when one exists it belongs alongside the protected days.
fn place_rest_days(
    dates: &[NaiveDate],
    seed: &ShiftSeed,
    held: &HashMap<(&str, NaiveDate), &CaddieShift>,
    preceding: i64,
    policy: &ShiftPolicy,
    resting_by_date: &mut HashMap<NaiveDate, usize>,
) -> HashSet<NaiveDate> {
    let mut inserted: HashSet<NaiveDate> = HashSet::new();
    if !seed.is_assignable || dates.is_empty() {
        return inserted;
    }
    let caddie_id = seed.caddie_id.as_str();

    // A day already spoken for: filed off, or pinned off by the desk.
    let already_off = |date: NaiveDate| match held.get(&(caddie_id, date)) {
        Some(shift) => !shift.is_working(),
        None => match seed.requests.get(&date) {
            Some(request) => request.status == AvailabilityStatus::Unavailable,
            // Nothing filed: off only when the club reads silence that way.
            None => policy.unfiled_request() == UnfiledRequest::Off,
        },
    };
    // A day pinned as working cannot be turned into a rest day.
    let can_rest = |date: NaiveDate| !matches!(held.get(&(caddie_id, date)), Some(shift) if shift.is_working());

    let mut worked = preceding;
    let mut index = 0usize;
    while index < dates.len() {
        let allowance = (policy.max_consecutive_work_days() - worked).max(0) as usize;
        // Working every day of the window is allowed; the day after it is not.
        let last = index + allowance;
        if last >= dates.len() {
            // The deadline falls past the end of the month. Next month's run
            // reads back over the boundary, so nothing is owed here.
            break;
        }
        let window = &dates[index..=last];

        if let Some(offset) = window.iter().position(|date| already_off(*date)) {
            let rest = window[offset];
            *resting_by_date.entry(rest).or_insert(0) += 1;
            index += offset + 1;
            worked = 0;
            continue;
        }

        match choose_rest_day(window, policy, resting_by_date, &can_rest) {
            Some(rest) => {
                inserted.insert(rest);
                *resting_by_date.entry(rest).or_insert(0) += 1;
                let offset = window
                    .iter()
                    .position(|date| *date == rest)
                    .expect("the chosen day comes from the window");
                index += offset + 1;
                worked = 0;
            }
            None => {
                // Every day in the window is pinned as working. The run cannot
                // fix that; `overworked` reports it once the month is built.
                worked += window.len() as i64;
                index = last + 1;
            }
        }
    }

    // The consecutive-day limit alone yields four or five rest days a month.
    // Work rules often promise more, so top up to the club's figure — spread
    // over the days fewest colleagues are already off, and off the protected
    // weekdays while any other day remains.
    let mut rest_days = dates
        .iter()
        .filter(|date| already_off(**date) || inserted.contains(*date))
        .count() as i64;
    while rest_days < policy.min_rest_days_per_month() {
        let Some(pick) = dates
            .iter()
            .copied()
            .filter(|date| !inserted.contains(date))
            .filter(|date| !already_off(*date))
            .filter(|date| can_rest(*date))
            .min_by_key(|date| {
                (
                    policy.avoids(*date),
                    resting_by_date.get(date).copied().unwrap_or(0),
                    *date,
                )
            })
        else {
            // Nothing left to give: every remaining day is pinned as working.
            break;
        };
        inserted.insert(pick);
        *resting_by_date.entry(pick).or_insert(0) += 1;
        rest_days += 1;
    }

    inserted
}

/// The best day in the window to be off, or `None` when every day is pinned
/// as working.
fn choose_rest_day(
    window: &[NaiveDate],
    policy: &ShiftPolicy,
    resting_by_date: &HashMap<NaiveDate, usize>,
    can_rest: &impl Fn(NaiveDate) -> bool,
) -> Option<NaiveDate> {
    window
        .iter()
        .copied()
        .filter(|date| can_rest(*date))
        .min_by_key(|date| {
            (
                policy.avoids(*date),
                resting_by_date.get(date).copied().unwrap_or(0),
                std::cmp::Reverse(*date),
            )
        })
}

/// Working days already behind the first of the month, so a run that started
/// in the previous month is not forgiven by the calendar turning over.
fn run_before(
    earlier: &HashMap<(&str, NaiveDate), &CaddieShift>,
    caddie_id: &str,
    first: Option<&NaiveDate>,
    policy: &ShiftPolicy,
) -> i64 {
    let Some(first) = first else {
        return 0;
    };
    let mut worked = 0;
    let mut day = first.pred_opt();
    while let Some(date) = day {
        match earlier.get(&(caddie_id, date)) {
            Some(shift) if shift.is_working() => worked += 1,
            // A day off, or a day nothing was confirmed for, ends the run: an
            // unconfirmed day cannot be counted as work somebody did.
            _ => break,
        }
        if worked >= policy.max_consecutive_work_days() {
            break;
        }
        day = date.pred_opt();
    }
    worked
}

fn plan_one_day(seed: &ShiftSeed, date: NaiveDate, policy: &ShiftPolicy) -> CaddieShift {
    if !seed.is_assignable {
        return CaddieShift::off(seed.caddie_id.clone(), date, ShiftOrigin::Generated);
    }
    let request = seed.requests.get(&date).copied();
    let status = request
        .map(|request| request.status)
        .unwrap_or(match policy.unfiled_request() {
            UnfiledRequest::Working => AvailabilityStatus::Available,
            UnfiledRequest::Off => AvailabilityStatus::Unavailable,
        });
    let Some(span) = ShiftSpan::from_request(status) else {
        return CaddieShift::off(seed.caddie_id.clone(), date, ShiftOrigin::Generated);
    };

    let wants_two = request
        .map(|request| request.two_round_request)
        .unwrap_or(false);
    let rounds_capacity = capacity_for(seed, span, status, wants_two, policy);

    CaddieShift {
        caddie_id: seed.caddie_id.clone(),
        date,
        course_id: seed.main_course_id.clone(),
        is_working: true,
        span,
        rounds_capacity,
        origin: ShiftOrigin::Generated,
        note: None,
        updated_by: None,
        updated_at: None,
    }
}

/// Two rounds only when the caddie can, asked to, and has the whole day for
/// it. Light duty is a full day at one round, as the supply count already
/// treats it.
fn capacity_for(
    seed: &ShiftSeed,
    span: ShiftSpan,
    status: AvailabilityStatus,
    wants_two: bool,
    policy: &ShiftPolicy,
) -> i32 {
    let base = if span.is_half_day() || status == AvailabilityStatus::LightDuty {
        1
    } else if seed.can_two_rounds && wants_two {
        MAX_ROUNDS_PER_SHIFT
    } else {
        1
    };
    // Three ceilings, all real: the caddie's own limit, the club's, and the
    // daylight.
    base.min(seed.max_rounds_per_day.max(1))
        .min(policy.max_rounds_per_day())
        .min(MAX_ROUNDS_PER_SHIFT)
}

/// What the desk changes about one confirmed day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShiftEdit {
    pub is_working: bool,
    pub span: ShiftSpan,
    pub rounds_capacity: i32,
    pub course_id: Option<CourseId>,
    pub pinned: bool,
    pub note: Option<String>,
}

impl ShiftEdit {
    /// Apply the edit, refusing the ones that would put a caddie somewhere
    /// they cannot work or quietly overwrite a filed day off.
    ///
    /// `workable_courses` is the caddie's memberships, main and sub together:
    /// a sub course is exactly the permission to be moved there when a day
    /// runs short. `filed` is the request on file for that day, which is left
    /// untouched — the shift is what changes, and the request stays as the
    /// record of what was asked for.
    pub fn apply(
        self,
        caddie_id: CaddieId,
        date: NaiveDate,
        workable_courses: &[CourseId],
        filed: Option<AvailabilityStatus>,
        updated_by: Option<String>,
    ) -> Result<CaddieShift, CourseError> {
        let note = trimmed(self.note);
        let origin = if self.pinned {
            ShiftOrigin::Pinned
        } else {
            ShiftOrigin::Edited
        };

        if !self.is_working {
            return Ok(CaddieShift {
                caddie_id,
                date,
                course_id: None,
                is_working: false,
                span: ShiftSpan::FullDay,
                rounds_capacity: 0,
                origin,
                note,
                updated_by: trimmed(updated_by),
                updated_at: None,
            });
        }

        if let Some(course_id) = self.course_id.as_ref() {
            if !workable_courses.contains(course_id) {
                return Err(CourseError::BadRequest(
                    "the caddie has no membership for that course",
                ));
            }
        }

        if filed == Some(AvailabilityStatus::Unavailable) && note.is_none() {
            return Err(CourseError::BadRequest(
                "working a day filed off needs a reason",
            ));
        }

        if self.rounds_capacity < 1 || self.rounds_capacity > MAX_ROUNDS_PER_SHIFT {
            return Err(CourseError::BadRequest(
                "a working day is one or two rounds",
            ));
        }
        if self.span.is_half_day() && self.rounds_capacity > 1 {
            return Err(CourseError::BadRequest("half a day is one round"));
        }

        Ok(CaddieShift {
            caddie_id,
            date,
            course_id: self.course_id,
            is_working: true,
            span: self.span,
            rounds_capacity: self.rounds_capacity,
            origin,
            note,
            updated_by: trimmed(updated_by),
            updated_at: None,
        })
    }
}

/// Which Field shift stands behind one confirmed day.
///
/// A caddie being at work is a fact Field's HRM holds too, and the id it gave
/// back is how a later edit reaches that same shift rather than stacking a
/// second one on the day (ADR-0013, PLT-3835). It is bookkeeping about the
/// write-through, not part of what the desk decided, so it travels beside
/// [`CaddieShift`] instead of inside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldShiftLink {
    pub caddie_id: CaddieId,
    pub date: NaiveDate,
    /// `None` withdraws the link: Field holds nothing for this day any more,
    /// because the day was turned off or the caddie has no staff record to
    /// file it under.
    pub field_shift_id: Option<String>,
}

impl FieldShiftLink {
    pub fn new(
        caddie_id: impl Into<CaddieId>,
        date: NaiveDate,
        field_shift_id: Option<String>,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            date,
            field_shift_id: trimmed(field_shift_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, day).unwrap()
    }

    fn course(id: &str) -> CourseId {
        CourseId::new(id)
    }

    fn seed(requests: Vec<(NaiveDate, AvailabilityStatus, bool)>) -> ShiftSeed {
        ShiftSeed {
            caddie_id: CaddieId::new("caddie-1"),
            display_name: "山田".to_string(),
            is_assignable: true,
            can_two_rounds: true,
            max_rounds_per_day: 2,
            main_course_id: Some(course("out")),
            requests: requests
                .into_iter()
                .map(|(date, status, two_round_request)| {
                    (
                        date,
                        ShiftRequest {
                            status,
                            two_round_request,
                        },
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn a_day_nobody_filed_is_confirmed_as_a_working_day_on_the_main_course() {
        let plan = plan_month_shifts(
            &[date(1)],
            &[seed(Vec::new())],
            &[],
            &ShiftPolicy::default(),
        );

        let shift = &plan.shifts()[0];
        assert!(shift.is_working());
        assert_eq!(shift.course_id(), Some(&course("out")));
        assert_eq!(shift.span(), ShiftSpan::FullDay);
        assert_eq!(shift.rounds_capacity(), 1);
        assert!(plan.unplaced().is_empty());
    }

    #[test]
    fn a_filed_day_off_is_confirmed_off_and_placed_nowhere() {
        let plan = plan_month_shifts(
            &[date(1)],
            &[seed(vec![(
                date(1),
                AvailabilityStatus::Unavailable,
                false,
            )])],
            &[],
            &ShiftPolicy::default(),
        );

        let shift = &plan.shifts()[0];
        assert!(!shift.is_working());
        assert_eq!(shift.course_id(), None);
        assert_eq!(shift.rounds_capacity(), 0);
    }

    #[test]
    fn a_morning_request_is_half_a_day_and_one_round() {
        let plan = plan_month_shifts(
            &[date(1)],
            &[seed(vec![(date(1), AvailabilityStatus::MorningOnly, true)])],
            &[],
            &ShiftPolicy::default(),
        );

        let shift = &plan.shifts()[0];
        assert_eq!(shift.span(), ShiftSpan::Morning);
        assert_eq!(shift.rounds_capacity(), 1);
    }

    #[test]
    fn asking_to_go_round_twice_is_two_rounds_when_the_caddie_can() {
        let plan = plan_month_shifts(
            &[date(1)],
            &[seed(vec![(date(1), AvailabilityStatus::Available, true)])],
            &[],
            &ShiftPolicy::default(),
        );

        assert_eq!(plan.shifts()[0].rounds_capacity(), 2);
    }

    #[test]
    fn asking_to_go_round_twice_is_still_one_when_the_caddie_cannot() {
        let mut seed = seed(vec![(date(1), AvailabilityStatus::Available, true)]);
        seed.can_two_rounds = false;

        let plan = plan_month_shifts(&[date(1)], &[seed], &[], &ShiftPolicy::default());

        assert_eq!(plan.shifts()[0].rounds_capacity(), 1);
    }

    #[test]
    fn light_duty_stays_a_single_round_even_when_two_were_asked_for() {
        let plan = plan_month_shifts(
            &[date(1)],
            &[seed(vec![(date(1), AvailabilityStatus::LightDuty, true)])],
            &[],
            &ShiftPolicy::default(),
        );

        assert_eq!(plan.shifts()[0].rounds_capacity(), 1);
    }

    #[test]
    fn a_caddie_off_the_roster_is_confirmed_off_whatever_they_filed() {
        let mut seed = seed(vec![(date(1), AvailabilityStatus::Available, true)]);
        seed.is_assignable = false;

        let plan = plan_month_shifts(&[date(1)], &[seed], &[], &ShiftPolicy::default());

        assert!(!plan.shifts()[0].is_working());
    }

    #[test]
    fn a_caddie_with_no_main_course_is_confirmed_working_but_reported_unplaced() {
        let mut seed = seed(Vec::new());
        seed.main_course_id = None;

        let plan = plan_month_shifts(&[date(1), date(2)], &[seed], &[], &ShiftPolicy::default());

        assert!(plan.shifts()[0].is_working());
        assert_eq!(plan.shifts()[0].course_id(), None);
        // Named once, however many days they would have worked.
        assert_eq!(plan.unplaced(), ["山田"]);
    }

    #[test]
    fn a_pinned_day_survives_the_next_run_and_a_plain_edit_does_not() {
        let pinned = CaddieShift::reconstitute(
            CaddieId::new("caddie-1"),
            date(1),
            Some(course("in")),
            true,
            ShiftSpan::FullDay,
            2,
            ShiftOrigin::Pinned,
            None,
            None,
            None,
        );
        let edited = CaddieShift::reconstitute(
            CaddieId::new("caddie-1"),
            date(2),
            Some(course("in")),
            true,
            ShiftSpan::FullDay,
            2,
            ShiftOrigin::Edited,
            None,
            None,
            None,
        );

        let plan = plan_month_shifts(
            &[date(1), date(2)],
            &[seed(Vec::new())],
            &[pinned, edited],
            &ShiftPolicy::default(),
        );

        assert_eq!(plan.shifts()[0].course_id(), Some(&course("in")));
        assert_eq!(plan.shifts()[0].rounds_capacity(), 2);
        assert_eq!(plan.pinned_kept(), 1);
        assert_eq!(plan.shifts()[1].course_id(), Some(&course("out")));
        assert_eq!(plan.shifts()[1].rounds_capacity(), 1);
    }

    /// The longest run of confirmed working days anywhere in a plan.
    fn longest_run(plan: &MonthShiftPlan) -> i64 {
        let mut longest = 0;
        let mut run = 0;
        for shift in plan.shifts() {
            run = if shift.is_working() { run + 1 } else { 0 };
            longest = longest.max(run);
        }
        longest
    }

    #[test]
    fn a_month_nobody_filed_for_never_runs_past_the_limit() {
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();

        let plan = plan_month_shifts(&dates, &[seed(Vec::new())], &[], &ShiftPolicy::default());

        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
        assert!(plan.statutory_rest_days() > 0);
        assert!(plan.overworked().is_empty());
    }

    #[test]
    fn rest_days_keep_off_the_weekend_while_the_window_allows_it() {
        // 2026-09-01 is a Tuesday, so every window has weekdays to choose from.
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();

        let plan = plan_month_shifts(&dates, &[seed(Vec::new())], &[], &ShiftPolicy::default());

        let weekend_rest = plan
            .shifts()
            .iter()
            .filter(|shift| !shift.is_working())
            .filter(|shift| ShiftPolicy::default().avoids(shift.date()))
            .count();
        assert_eq!(weekend_rest, 0);
    }

    #[test]
    fn the_roster_does_not_all_take_the_same_day_off() {
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();
        let roster: Vec<ShiftSeed> = (1..=5)
            .map(|index| {
                let mut seed = seed(Vec::new());
                seed.caddie_id = CaddieId::new(format!("caddie-{index}"));
                seed.display_name = format!("キャディ{index}");
                seed
            })
            .collect();

        let plan = plan_month_shifts(&dates, &roster, &[], &ShiftPolicy::default());

        let mut resting: HashMap<NaiveDate, usize> = HashMap::new();
        for shift in plan.shifts().iter().filter(|shift| !shift.is_working()) {
            *resting.entry(shift.date()).or_insert(0) += 1;
        }
        // The course is never emptied: one of the five off on any given day.
        assert_eq!(resting.values().copied().max(), Some(1));
    }

    #[test]
    fn a_filed_day_off_counts_as_the_rest_day_and_nothing_extra_is_inserted() {
        let dates: Vec<NaiveDate> = (1..=8).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(vec![(
                date(4),
                AvailabilityStatus::Unavailable,
                false,
            )])],
            &[],
            &ShiftPolicy::default(),
        );

        let working: Vec<bool> = plan.shifts().iter().map(CaddieShift::is_working).collect();
        assert_eq!(working, [true, true, true, false, true, true, true, true]);
        assert_eq!(plan.statutory_rest_days(), 0);
    }

    #[test]
    fn a_run_that_started_last_month_is_counted_from_where_it_left_off() {
        let previous: Vec<CaddieShift> = (1..=5)
            .map(|day| {
                CaddieShift::reconstitute(
                    CaddieId::new("caddie-1"),
                    NaiveDate::from_ymd_opt(2026, 8, 26 + day).unwrap(),
                    Some(course("out")),
                    true,
                    ShiftSpan::FullDay,
                    1,
                    ShiftOrigin::Generated,
                    None,
                    None,
                    None,
                )
            })
            .collect();

        let plan = plan_month_shifts(
            &[date(1), date(2), date(3)],
            &[seed(Vec::new())],
            &previous,
            &ShiftPolicy::default(),
        );

        let working: Vec<bool> = plan.shifts().iter().map(CaddieShift::is_working).collect();
        // Five behind us, so the 1st is the sixth day and the 2nd must be off.
        assert_eq!(working, [true, false, true]);
    }

    #[test]
    fn a_half_day_still_counts_as_a_working_day() {
        let dates: Vec<NaiveDate> = (1..=7).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(vec![(
                date(3),
                AvailabilityStatus::MorningOnly,
                false,
            )])],
            &[],
            &ShiftPolicy::default(),
        );

        // The morning-only day is work, so a rest day is still owed inside the
        // seven.
        assert_eq!(plan.statutory_rest_days(), 1);
        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
    }

    fn pinned_working(day: u32) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new("caddie-1"),
            date(day),
            Some(course("out")),
            true,
            ShiftSpan::FullDay,
            1,
            ShiftOrigin::Pinned,
            None,
            None,
            None,
        )
    }

    #[test]
    fn a_pinned_working_day_is_planned_around_rather_than_overwritten() {
        let dates: Vec<NaiveDate> = (1..=7).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(Vec::new())],
            &[pinned_working(7)],
            &ShiftPolicy::default(),
        );

        // The pinned day stands; the rest day moves earlier in the window so
        // the run still breaks inside seven days.
        assert!(plan.shifts()[6].is_working());
        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
        assert!(plan.overworked().is_empty());
    }

    #[test]
    fn a_week_pinned_solid_leaves_nowhere_to_put_a_rest_day_and_says_so() {
        let dates: Vec<NaiveDate> = (1..=7).map(date).collect();
        let pinned: Vec<CaddieShift> = (1..=7).map(pinned_working).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(Vec::new())],
            &pinned,
            &ShiftPolicy::default(),
        );

        assert!(plan.shifts().iter().all(CaddieShift::is_working));
        assert_eq!(plan.overworked(), ["山田"]);
    }

    #[test]
    fn somebody_off_the_roster_needs_no_rest_days_inserted() {
        let dates: Vec<NaiveDate> = (1..=10).map(date).collect();
        let mut seed = seed(Vec::new());
        seed.is_assignable = false;

        let plan = plan_month_shifts(&dates, &[seed], &[], &ShiftPolicy::default());

        assert_eq!(plan.statutory_rest_days(), 0);
        assert!(plan.shifts().iter().all(|shift| !shift.is_working()));
    }

    #[test]
    fn a_club_that_only_protects_saturday_rests_people_on_sunday() {
        // 2026-09-05 is a Saturday and the 6th a Sunday.
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(Vec::new())],
            &[],
            &ShiftPolicy::new([Weekday::Sat]),
        );

        let rest_weekdays: HashSet<Weekday> = plan
            .shifts()
            .iter()
            .filter(|shift| !shift.is_working())
            .map(|shift| shift.date().weekday())
            .collect();
        assert!(!rest_weekdays.contains(&Weekday::Sat));
        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
    }

    #[test]
    fn protecting_nothing_leaves_the_run_length_as_the_only_rule() {
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(Vec::new())],
            &[],
            &ShiftPolicy::unrestricted(),
        );

        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
    }

    #[test]
    fn a_protected_day_is_still_used_when_the_window_holds_nothing_else() {
        // Protecting every day leaves the planner no unprotected choice, and
        // the law still has to be met.
        let dates: Vec<NaiveDate> = (1..=14).map(date).collect();

        let plan = plan_month_shifts(&dates, &[seed(Vec::new())], &[], &ShiftPolicy::new(WEEK));

        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
    }

    #[test]
    fn the_protected_days_survive_a_round_trip_through_storage_form() {
        let policy = ShiftPolicy::new([Weekday::Sat, Weekday::Wed]);

        assert_eq!(policy.as_csv(), "wed,sat");
        assert_eq!(ShiftPolicy::parse_csv("wed,sat"), policy);
        // A stored value nobody can fix from the screens must not fail a month.
        assert_eq!(
            ShiftPolicy::parse_csv("sat,nonsense").weekdays(),
            [Weekday::Sat]
        );
        assert!(ShiftPolicy::parse_csv("").weekdays().is_empty());
    }

    #[test]
    fn a_club_that_rosters_at_most_five_days_in_a_row_gets_five() {
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(Vec::new())],
            &[],
            &ShiftPolicy::default().with_max_consecutive_work_days(5),
        );

        assert!(longest_run(&plan) <= 5);
    }

    #[test]
    fn asking_for_more_than_the_law_allows_is_clamped_to_it() {
        let policy = ShiftPolicy::default().with_max_consecutive_work_days(10);

        assert_eq!(
            policy.max_consecutive_work_days(),
            MAX_CONSECUTIVE_WORK_DAYS
        );
    }

    #[test]
    fn a_club_that_runs_one_round_a_day_never_confirms_two() {
        let plan = plan_month_shifts(
            &[date(1)],
            &[seed(vec![(date(1), AvailabilityStatus::Available, true)])],
            &[],
            &ShiftPolicy::default().with_max_rounds_per_day(1),
        );

        assert_eq!(plan.shifts()[0].rounds_capacity(), 1);
    }

    #[test]
    fn the_month_is_topped_up_to_the_rest_days_the_work_rules_promise() {
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(Vec::new())],
            &[],
            &ShiftPolicy::default().with_min_rest_days_per_month(8),
        );

        let rest = plan
            .shifts()
            .iter()
            .filter(|shift| !shift.is_working())
            .count();
        assert_eq!(rest, 8);
        assert!(longest_run(&plan) <= MAX_CONSECUTIVE_WORK_DAYS);
    }

    #[test]
    fn a_filed_day_off_counts_towards_the_monthly_promise() {
        let dates: Vec<NaiveDate> = (1..=30).map(date).collect();
        let filed: Vec<(NaiveDate, AvailabilityStatus, bool)> = (1..=6)
            .map(|day| (date(day * 3), AvailabilityStatus::Unavailable, false))
            .collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(filed)],
            &[],
            &ShiftPolicy::default().with_min_rest_days_per_month(8),
        );

        let rest = plan
            .shifts()
            .iter()
            .filter(|shift| !shift.is_working())
            .count();
        assert_eq!(rest, 8);
    }

    #[test]
    fn a_club_that_reads_silence_as_a_day_off_confirms_nothing_nobody_filed_for() {
        let dates: Vec<NaiveDate> = (1..=10).map(date).collect();

        let plan = plan_month_shifts(
            &dates,
            &[seed(vec![(date(3), AvailabilityStatus::Available, false)])],
            &[],
            &ShiftPolicy::default().with_unfiled_request(UnfiledRequest::Off),
        );

        let working: Vec<NaiveDate> = plan
            .shifts()
            .iter()
            .filter(|shift| shift.is_working())
            .map(CaddieShift::date)
            .collect();
        // Only the day they actually said they could work.
        assert_eq!(working, [date(3)]);
    }

    fn edit(course_id: Option<CourseId>) -> ShiftEdit {
        ShiftEdit {
            is_working: true,
            span: ShiftSpan::FullDay,
            rounds_capacity: 1,
            course_id,
            pinned: false,
            note: None,
        }
    }

    #[test]
    fn a_sub_course_membership_is_what_lets_the_desk_move_somebody_there() {
        let shift = edit(Some(course("in")))
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out"), course("in")],
                None,
                Some("desk".to_string()),
            )
            .unwrap();

        assert_eq!(shift.course_id(), Some(&course("in")));
        assert_eq!(shift.origin(), ShiftOrigin::Edited);
        assert_eq!(shift.updated_by(), Some("desk"));
    }

    #[test]
    fn a_course_the_caddie_has_no_membership_for_is_refused() {
        let error = edit(Some(course("west")))
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out"), course("in")],
                None,
                None,
            )
            .unwrap_err();

        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn putting_somebody_to_work_on_a_day_they_filed_off_needs_a_reason() {
        let error = edit(Some(course("out")))
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out")],
                Some(AvailabilityStatus::Unavailable),
                None,
            )
            .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));

        let mut with_reason = edit(Some(course("out")));
        with_reason.note = Some("本人了承済み".to_string());
        let shift = with_reason
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out")],
                Some(AvailabilityStatus::Unavailable),
                None,
            )
            .unwrap();
        assert_eq!(shift.note(), Some("本人了承済み"));
    }

    #[test]
    fn pinning_a_day_marks_it_held_against_the_next_run_and_against_moves() {
        let mut held = edit(Some(course("out")));
        held.pinned = true;

        let shift = held
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out")],
                None,
                None,
            )
            .unwrap();

        assert_eq!(shift.origin(), ShiftOrigin::Pinned);
        assert!(shift.origin().survives_regeneration());
        assert!(!shift.origin().is_movable());
    }

    #[test]
    fn a_day_turned_off_keeps_no_course_and_no_rounds() {
        let mut off = edit(Some(course("out")));
        off.is_working = false;

        let shift = off
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out")],
                None,
                None,
            )
            .unwrap();

        assert_eq!(shift.course_id(), None);
        assert_eq!(shift.rounds_capacity(), 0);
    }

    #[test]
    fn half_a_day_cannot_be_stretched_to_two_rounds() {
        let mut two_in_a_morning = edit(Some(course("out")));
        two_in_a_morning.span = ShiftSpan::Morning;
        two_in_a_morning.rounds_capacity = 2;

        let error = two_in_a_morning
            .apply(
                CaddieId::new("caddie-1"),
                date(1),
                &[course("out")],
                None,
                None,
            )
            .unwrap_err();

        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn a_working_day_supplies_its_rounds_to_the_course_it_is_placed_on_only() {
        let shift = CaddieShift::reconstitute(
            CaddieId::new("caddie-1"),
            date(1),
            Some(course("out")),
            true,
            ShiftSpan::FullDay,
            2,
            ShiftOrigin::Generated,
            None,
            None,
            None,
        );

        assert_eq!(shift.supplies(&course("out")), 2);
        assert_eq!(shift.supplies(&course("in")), 0);
    }
}
