//! When a membership may be played.
//!
//! 平日会員 is the whole point: a club sells a cheaper membership that is only
//! good Monday to Friday, and a shareholder membership that is good whenever.
//! Field's registry has no notion of when a plan may be used and should not —
//! a gym membership is not restricted by tee time (ADR-0005).
//!
//! **A warning, never a refusal.** The desk takes bookings the rules do not
//! cover every week: a 平日会員 playing Saturday at visitor rates, a member
//! booking on behalf of the club. A hard block would not stop those bookings —
//! it would push the desk into Field's admin to make them, which is the one
//! outcome CourseBoard is built to avoid. So this answers "say something", and
//! the save goes through either way.

use chrono::{NaiveTime, Timelike, Weekday};

use super::{CourseError, MembershipPlanId};

/// Days of the week a membership may be played, as a 7-bit set.
///
/// A set rather than a weekday/weekend flag: clubs sell 月火水会員 and
/// 平日+祝日会員, and a flag would have to be widened the first time one asks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayableDays(u8);

impl PlayableDays {
    pub const ALL: Self = Self(0b111_1111);

    /// From Monday-first booleans, as the settings form lists them.
    pub fn from_flags(flags: [bool; 7]) -> Self {
        let mut bits = 0u8;
        for (index, on) in flags.iter().enumerate() {
            if *on {
                bits |= 1 << index;
            }
        }
        Self(bits)
    }

    pub fn bits(self) -> u8 {
        self.0
    }

    pub fn from_bits(bits: u8) -> Self {
        Self(bits & 0b111_1111)
    }

    pub fn flags(self) -> [bool; 7] {
        let mut flags = [false; 7];
        for (index, flag) in flags.iter_mut().enumerate() {
            *flag = self.0 & (1 << index) != 0;
        }
        flags
    }

    /// Nothing selected asks nothing: a plan whose days are all off is one the
    /// club has not restricted, not one nobody may ever play.
    pub fn is_unrestricted(self) -> bool {
        self.0 == 0 || self.0 == Self::ALL.0
    }

    pub fn allows(self, weekday: Weekday) -> bool {
        if self.is_unrestricted() {
            return true;
        }
        self.0 & (1 << weekday.num_days_from_monday()) != 0
    }
}

/// One plan's playing rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipPlayWindow {
    plan_id: MembershipPlanId,
    days: PlayableDays,
    /// Earliest and latest tee time, in the course's own clock. Both absent
    /// means the whole day; one absent means open at that end.
    from: Option<NaiveTime>,
    to: Option<NaiveTime>,
}

impl MembershipPlayWindow {
    pub fn try_new(
        plan_id: MembershipPlanId,
        days: PlayableDays,
        from: Option<NaiveTime>,
        to: Option<NaiveTime>,
    ) -> Result<Self, CourseError> {
        if let (Some(from), Some(to)) = (from, to) {
            // A window that closes before it opens matches nothing, so every
            // booking would warn — which trains the desk to ignore warnings.
            if to <= from {
                return Err(CourseError::BadRequest(
                    "a playing window must end after it starts",
                ));
            }
        }
        Ok(Self {
            plan_id,
            days,
            from,
            to,
        })
    }

    pub fn plan_id(&self) -> &MembershipPlanId {
        &self.plan_id
    }

    pub fn days(&self) -> PlayableDays {
        self.days
    }

    pub fn from(&self) -> Option<NaiveTime> {
        self.from
    }

    pub fn to(&self) -> Option<NaiveTime> {
        self.to
    }

    /// Whether this plan asks anything at all of when it is played.
    pub fn is_unrestricted(&self) -> bool {
        self.days.is_unrestricted() && self.from.is_none() && self.to.is_none()
    }

    /// What is wrong with this tee time, if anything.
    ///
    /// `weekday` and `tee_time` are the course's local day and clock, not UTC:
    /// a 07:00 JST Saturday round is Friday in UTC, and judging it there would
    /// clear a 平日会員 for a weekend they cannot play.
    fn breach(&self, weekday: Weekday, tee_time: NaiveTime) -> Option<PlayWindowBreach> {
        if !self.days.allows(weekday) {
            return Some(PlayWindowBreach::Day);
        }
        if self.from.is_some_and(|from| tee_time < from) || self.to.is_some_and(|to| tee_time > to)
        {
            return Some(PlayWindowBreach::Time);
        }
        None
    }
}

/// Why a tee time falls outside a membership's window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayWindowBreach {
    /// Wrong day of the week — the 平日会員 on a Saturday.
    Day,
    /// Right day, outside the hours.
    Time,
}

impl PlayWindowBreach {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Time => "time",
        }
    }
}

/// Every plan's playing rule, for the tenant.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MembershipPlayWindows {
    windows: Vec<MembershipPlayWindow>,
}

impl MembershipPlayWindows {
    pub fn try_new(windows: Vec<MembershipPlayWindow>) -> Result<Self, CourseError> {
        for (index, window) in windows.iter().enumerate() {
            if windows[..index]
                .iter()
                .any(|other| other.plan_id == window.plan_id)
            {
                return Err(CourseError::BadRequest(
                    "each membership may have only one playing window",
                ));
            }
        }
        Ok(Self { windows })
    }

    pub fn reconstitute(windows: Vec<MembershipPlayWindow>) -> Self {
        Self { windows }
    }

    pub fn entries(&self) -> &[MembershipPlayWindow] {
        &self.windows
    }

    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }

    /// Whether this booking is outside the member's window, and how.
    ///
    /// `None` for a visitor, for a plan with no rule, and for a booking that
    /// fits — three different reasons for the same silence, and none of them
    /// is something to put in front of the desk.
    pub fn breach_for(
        &self,
        plan_id: Option<&MembershipPlanId>,
        weekday: Weekday,
        tee_time: NaiveTime,
    ) -> Option<PlayWindowBreach> {
        let plan_id = plan_id?;
        let window = self
            .windows
            .iter()
            .find(|entry| &entry.plan_id == plan_id)?;
        if window.is_unrestricted() {
            return None;
        }
        window.breach(weekday, tee_time)
    }
}

/// `HH:MM` as the settings form and the database hold it.
pub fn parse_play_time(raw: &str) -> Result<NaiveTime, CourseError> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M")
        .map_err(|_| CourseError::BadRequest("a playing window time must look like HH:MM"))
}

pub fn format_play_time(value: NaiveTime) -> String {
    format!("{:02}:{:02}", value.hour(), value.minute())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(hour: u32, minute: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(hour, minute, 0).unwrap()
    }

    /// 平日会員: Monday to Friday, mornings only.
    fn weekday_plan() -> MembershipPlayWindows {
        MembershipPlayWindows::try_new(vec![MembershipPlayWindow::try_new(
            MembershipPlanId::new("plan_weekday"),
            PlayableDays::from_flags([true, true, true, true, true, false, false]),
            Some(at(6, 0)),
            Some(at(12, 0)),
        )
        .unwrap()])
        .unwrap()
    }

    fn weekday_id() -> MembershipPlanId {
        MembershipPlanId::new("plan_weekday")
    }

    #[test]
    fn a_weekday_member_playing_saturday_is_flagged() {
        // The case the whole feature exists for.
        assert_eq!(
            weekday_plan().breach_for(Some(&weekday_id()), Weekday::Sat, at(8, 0)),
            Some(PlayWindowBreach::Day)
        );
    }

    #[test]
    fn a_weekday_member_playing_a_weekday_morning_is_not_flagged() {
        assert_eq!(
            weekday_plan().breach_for(Some(&weekday_id()), Weekday::Wed, at(8, 0)),
            None
        );
    }

    #[test]
    fn the_right_day_at_the_wrong_hour_is_flagged_as_a_time_not_a_day() {
        // The desk reads the two differently: one is "come back tomorrow", the
        // other is "come back this morning".
        assert_eq!(
            weekday_plan().breach_for(Some(&weekday_id()), Weekday::Wed, at(14, 0)),
            Some(PlayWindowBreach::Time)
        );
    }

    #[test]
    fn the_window_edges_are_playable() {
        let windows = weekday_plan();
        assert_eq!(
            windows.breach_for(Some(&weekday_id()), Weekday::Wed, at(6, 0)),
            None
        );
        assert_eq!(
            windows.breach_for(Some(&weekday_id()), Weekday::Wed, at(12, 0)),
            None
        );
    }

    #[test]
    fn a_visitor_is_never_flagged() {
        assert_eq!(
            weekday_plan().breach_for(None, Weekday::Sat, at(8, 0)),
            None
        );
    }

    #[test]
    fn a_plan_with_no_rule_is_never_flagged() {
        let other = MembershipPlanId::new("plan_full");
        assert_eq!(
            weekday_plan().breach_for(Some(&other), Weekday::Sat, at(8, 0)),
            None
        );
    }

    #[test]
    fn a_plan_with_every_day_selected_asks_nothing() {
        // Ticking all seven boxes is how an operator says "no restriction",
        // and it must not read the same as ticking none by accident.
        let windows = MembershipPlayWindows::try_new(vec![MembershipPlayWindow::try_new(
            MembershipPlanId::new("plan_full"),
            PlayableDays::ALL,
            None,
            None,
        )
        .unwrap()])
        .unwrap();
        assert_eq!(
            windows.breach_for(
                Some(&MembershipPlanId::new("plan_full")),
                Weekday::Sun,
                at(5, 0)
            ),
            None
        );
    }

    #[test]
    fn no_days_selected_asks_nothing_rather_than_forbidding_every_day() {
        // A row the operator started and left blank must not lock the member
        // out of the whole week.
        let windows = MembershipPlayWindows::try_new(vec![MembershipPlayWindow::try_new(
            MembershipPlanId::new("plan_full"),
            PlayableDays::from_flags([false; 7]),
            None,
            None,
        )
        .unwrap()])
        .unwrap();
        assert_eq!(
            windows.breach_for(
                Some(&MembershipPlanId::new("plan_full")),
                Weekday::Sun,
                at(5, 0)
            ),
            None
        );
    }

    #[test]
    fn a_window_that_closes_before_it_opens_is_refused() {
        // Otherwise every booking warns, and the desk learns to ignore warnings.
        assert!(MembershipPlayWindow::try_new(
            MembershipPlanId::new("plan_weekday"),
            PlayableDays::ALL,
            Some(at(12, 0)),
            Some(at(6, 0)),
        )
        .is_err());
    }

    #[test]
    fn one_plan_cannot_carry_two_windows() {
        let entries = vec![
            MembershipPlayWindow::try_new(weekday_id(), PlayableDays::ALL, None, None).unwrap(),
            MembershipPlayWindow::try_new(weekday_id(), PlayableDays::ALL, None, None).unwrap(),
        ];
        assert!(MembershipPlayWindows::try_new(entries).is_err());
    }

    #[test]
    fn day_flags_survive_the_round_trip_through_bits() {
        let days = PlayableDays::from_flags([true, false, true, false, true, false, false]);
        assert_eq!(PlayableDays::from_bits(days.bits()).flags(), days.flags());
    }

    #[test]
    fn a_time_is_read_and_written_as_hh_mm() {
        assert_eq!(parse_play_time(" 06:30 ").unwrap(), at(6, 30));
        assert_eq!(format_play_time(at(6, 30)), "06:30");
        assert!(parse_play_time("6.30").is_err());
    }
}
