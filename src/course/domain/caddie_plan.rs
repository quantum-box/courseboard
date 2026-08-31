//! Which caddie takes which round, for a whole day at once.
//!
//! Planning the day is golf operations, so it belongs here — see
//! `docs/src/architecture/decisions/ADR-0005-golf-domain-ownership.md`. Field
//! held this until now and could never do it: whether a booking is played with
//! a caddie is decided by the plan behind it, and the plan lives in CourseBoard's
//! extension config. Asked for a day's assignments, Field answered `assigned: []`
//! for a board full of caddie-attached rounds, every time.
//!
//! Ordering within one round is [`super::rank_caddies`]. This module is what
//! that ranking cannot do on its own: it walks the day in tee-time order and
//! remembers what it already promised, so one caddie is not offered to two
//! rounds that overlap.
//!
//! Everything here is pure. The roster, the day's bookings, the standing
//! assignments and the shift requests arrive already gathered.

use chrono::{DateTime, Duration, Timelike, Utc};
use chrono_tz::Tz;

use super::{
    rank_caddies, AttendanceState, AutoAssignPlanItem, AutoAssignResult, AutoAssignSkippedItem,
    AvailabilityStatus, CaddieShift, CaddieSkillLevel, CourseId, RankingCandidate, RankingOptions,
    ReservationId,
};

/// How long a round occupies a caddie when the booking does not say.
///
/// Matches the tee-sheet's own fallback, so a booking with no duration blocks
/// the same stretch on both screens.
const DEFAULT_ROUND_MINUTES: i64 = 270;

/// Local noon, as minutes from midnight: the line a morning-only or
/// afternoon-only shift request is read against.
/// Local noon, the line half-day requests and duty windows are read against.
pub(crate) const MIDDAY_MINUTES: i64 = 12 * 60;

/// Reasons this module adds to the ranker's vocabulary.
///
/// Stable snake_case keys, translated by the operator screens — never prose,
/// which is how Field's English reached the board untranslated.
pub mod skip_reason {
    /// Nobody was left who could take it: everyone is off, at their limit, or
    /// already out on a round that overlaps this one.
    pub const NO_CADDIE_AVAILABLE: &str = "no_caddie_available";
    /// Everyone who could otherwise have taken it has filled their day.
    pub const ALL_AT_DAILY_LIMIT: &str = "all_caddies_at_daily_limit";
    /// Nobody is standing on the course this round tees off from. Answered by
    /// moving somebody across on the balance board, not by the shift board.
    pub const NO_CADDIE_ON_COURSE: &str = "no_caddie_on_the_course";
}

/// Reasons this module adds to a caddie the plan picked.
///
/// Same shape as [`super::reason`] — stable snake_case keys the operator
/// screens translate.
pub mod plan_reason {
    /// Put on this group to make up the two rounds they asked for.
    pub const TWO_ROUND_REQUEST: &str = "two_round_request";
}

/// Where the confirmed month put a caddie for the day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaddiePlacement {
    /// The month was never confirmed for this day. Nothing says where they
    /// stand, so the planner treats them as it always did — available to any
    /// course — rather than refusing to staff a day for want of a plan.
    Unconfirmed,
    /// Confirmed onto a course. They walk that course and no other.
    On(CourseId),
    /// Confirmed to work with no course decided. Still usable anywhere; the
    /// gap is reported on the balance board rather than costing a round.
    Unplaced,
}

impl CaddiePlacement {
    /// Stable wire token for operator-facing DTOs.
    pub fn status(&self) -> &'static str {
        match self {
            Self::Unconfirmed => "unconfirmed",
            Self::Unplaced => "unplaced",
            Self::On(_) => "on_course",
        }
    }

    /// Whether this caddie may take a round on `course_id`.
    pub fn covers(&self, course_id: Option<&CourseId>) -> bool {
        match (self, course_id) {
            (Self::On(placed), Some(course)) => placed == course,
            // A round whose course could not be resolved is not a reason to
            // leave it unstaffed.
            (Self::On(_), None) => true,
            _ => true,
        }
    }
}

/// Resolve the confirmed shift state used by recommendation and auto-assign
/// responses. An absent shift is deliberately different from an unplaced one.
pub fn placement_for_shift(shift: Option<&CaddieShift>) -> CaddiePlacement {
    match shift {
        Some(shift) => match shift.course_id() {
            Some(course_id) => CaddiePlacement::On(course_id.clone()),
            None => CaddiePlacement::Unplaced,
        },
        None => CaddiePlacement::Unconfirmed,
    }
}

/// One caddie-attached round that still needs somebody on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannableRound {
    pub reservation_id: ReservationId,
    pub starts_at: DateTime<Utc>,
    pub duration_minutes: Option<i32>,
    pub player_count: i32,
    /// The course this group tees off from, which decides who may walk it.
    pub course_id: Option<CourseId>,
}

impl PlannableRound {
    fn ends_at(&self) -> DateTime<Utc> {
        let minutes = self
            .duration_minutes
            .filter(|value| *value > 0)
            .map(i64::from)
            .unwrap_or(DEFAULT_ROUND_MINUTES);
        self.starts_at + Duration::minutes(minutes)
    }

    fn overlaps(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
        self.starts_at < end && start < self.ends_at()
    }
}

/// One caddie as the planner sees them, with everything that could rule them
/// out of a given round.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannableCaddie {
    pub caddie_id: String,
    pub display_name: String,
    pub skill_level: CaddieSkillLevel,
    pub rating_average: Option<f64>,
    pub rating_count: i64,
    pub max_rounds_per_day: i32,
    /// Rounds already on this caddie for the day, from standing assignments.
    pub rounds_assigned_today: i64,
    pub attendance: AttendanceState,
    /// The shift request for the day. Absent means no request was filed, which
    /// reads as available — the same way the roster screens read it.
    pub availability: Option<AvailabilityStatus>,
    /// Stretches already committed, from standing assignments and from earlier
    /// rounds in this same plan.
    pub busy: Vec<(DateTime<Utc>, DateTime<Utc>)>,
    /// Where the confirmed month put them for the day.
    pub placement: CaddiePlacement,
    /// Whether they can walk two rounds and asked to on this day — the two
    /// halves the supply count already reads together.
    pub wants_two_rounds: bool,
}

impl PlannableCaddie {
    fn is_free_for(&self, round: &PlannableRound) -> bool {
        !self
            .busy
            .iter()
            .any(|(start, end)| round.overlaps(*start, *end))
    }

    fn has_capacity(&self) -> bool {
        i64::from(self.max_rounds_per_day) > self.rounds_assigned_today
    }

    fn shift_covers(&self, round: &PlannableRound, timezone: Tz) -> bool {
        shift_covers_tee_time(self.availability, Some(round.starts_at), timezone)
    }

    fn stands_on(&self, round: &PlannableRound) -> bool {
        self.placement.covers(round.course_id.as_ref())
    }

    /// Whether putting them on this group is what makes their two rounds
    /// happen.
    ///
    /// Two different moments, both needed for the request to come true: the
    /// first of the two, which is only worth holding an early group for while
    /// a later group is still there to be the second, and the second itself,
    /// which they must be given or the early group they were handed bought
    /// the club nothing. The request alone is never enough — the caddie's own
    /// daily limit still has to leave room for what is being planned.
    fn needs_this_round_for_two(&self, another_round_follows: bool) -> bool {
        if !self.wants_two_rounds {
            return false;
        }
        let remaining = i64::from(self.max_rounds_per_day) - self.rounds_assigned_today;
        if self.rounds_assigned_today == 0 {
            another_round_follows && remaining >= 2
        } else {
            remaining >= 1
        }
    }
}

/// Whether a day's shift request covers a tee time.
///
/// A caddie who asked for the day off is not a low-ranked candidate but a wrong
/// one, so this is a filter rather than a score. Half-day requests are read
/// against local noon, the same line the supply figures use.
///
/// `starts_at` is optional because the candidate list is sometimes asked for a
/// day rather than a round. Without a time, a half-day request cannot be judged
/// and the caddie stays in — only an outright day off is certain either way.
pub fn shift_covers_tee_time(
    status: Option<AvailabilityStatus>,
    starts_at: Option<DateTime<Utc>>,
    timezone: Tz,
) -> bool {
    let Some(status) = status else {
        return true;
    };
    if !status.is_workable() {
        return false;
    }
    let Some(starts_at) = starts_at else {
        return true;
    };
    let local = starts_at.with_timezone(&timezone);
    let local_minutes = i64::from(local.hour() * 60 + local.minute());
    match status {
        AvailabilityStatus::MorningOnly => local_minutes < MIDDAY_MINUTES,
        AvailabilityStatus::AfternoonOnly => local_minutes >= MIDDAY_MINUTES,
        _ => true,
    }
}

/// What the caller asked of the planner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanOptions {
    /// Tenant clock used to read half-day shift requests against local noon.
    pub timezone: Tz,
    pub dry_run: bool,
}

/// Work out who takes each round.
///
/// Rounds are planned in tee-time order so the earliest start gets the pick of
/// the roster, and each choice is remembered against the caddie before the next
/// round is considered.
pub fn plan_caddie_assignments(
    rounds: &[PlannableRound],
    caddies: &[PlannableCaddie],
    options: PlanOptions,
) -> AutoAssignResult {
    let mut pool: Vec<PlannableCaddie> = caddies.to_vec();
    let mut ordered: Vec<&PlannableRound> = rounds.iter().collect();
    ordered.sort_by(|left, right| {
        left.starts_at.cmp(&right.starts_at).then_with(|| {
            left.reservation_id
                .as_str()
                .cmp(right.reservation_id.as_str())
        })
    });

    // The last tee time still to be staffed. Whether a group is "early" is
    // read against this rather than the clock: an 09:00 group is early on a
    // day that runs to 13:00 and the last chance of the day on one that does
    // not, and only the first kind can be somebody's first of two.
    let last_start = ordered.last().map(|round| round.starts_at);

    let mut assigned = Vec::new();
    let mut skipped = Vec::new();

    for round in ordered {
        let eligible: Vec<usize> = pool
            .iter()
            .enumerate()
            .filter(|(_, caddie)| {
                caddie.has_capacity()
                    && caddie.stands_on(round)
                    && caddie.shift_covers(round, options.timezone)
                    && caddie.is_free_for(round)
            })
            .map(|(index, _)| index)
            .collect();

        if eligible.is_empty() {
            // Naming "everyone is full" separately matters: it is answered by
            // raising a limit or calling somebody in, while the general case is
            // answered on the shift board. Nobody was eligible, so anyone who is
            // on shift and free of an overlapping round can only have been
            // stopped by their daily limit.
            let stopped_only_by_the_limit = pool.iter().any(|caddie| {
                caddie.stands_on(round)
                    && caddie.shift_covers(round, options.timezone)
                    && caddie.is_free_for(round)
            });
            // Nobody on this course at all is a different problem from a busy
            // course, and it is fixed somewhere else — say so.
            let nobody_stands_here = !pool.iter().any(|caddie| caddie.stands_on(round));
            skipped.push(AutoAssignSkippedItem::new(
                round.reservation_id.clone(),
                if stopped_only_by_the_limit {
                    skip_reason::ALL_AT_DAILY_LIMIT
                } else if nobody_stands_here {
                    skip_reason::NO_CADDIE_ON_COURSE
                } else {
                    skip_reason::NO_CADDIE_AVAILABLE
                },
            ));
            continue;
        }

        // A caddie who asked for two rounds comes first, on the group that
        // starts their pair and again on the one that finishes it. Left to the
        // ranking alone the early groups go to whoever scores highest and the
        // two-round requests end up on a single afternoon round — the club
        // sells the day's supply as two-round caddies and then does not walk
        // them. Nobody is ruled out: with no such request in the eligible list
        // the day is planned exactly as it always was.
        let another_round_follows = last_start.is_some_and(|last| last >= round.ends_at());
        let keen: Vec<usize> = eligible
            .iter()
            .copied()
            .filter(|index| pool[*index].needs_this_round_for_two(another_round_follows))
            .collect();
        let shortlist = if keen.is_empty() { &eligible } else { &keen };

        let candidates: Vec<RankingCandidate> = shortlist
            .iter()
            .map(|index| {
                let caddie = &pool[*index];
                RankingCandidate {
                    caddie_id: caddie.caddie_id.clone(),
                    display_name: caddie.display_name.clone(),
                    skill_level: caddie.skill_level,
                    rating_average: caddie.rating_average,
                    rating_count: caddie.rating_count,
                    rounds_assigned_today: caddie.rounds_assigned_today,
                    max_rounds_per_day: caddie.max_rounds_per_day,
                    attendance: caddie.attendance,
                }
            })
            .collect();

        // Pairing a rookie with a veteran is a suggestion for the operator
        // reading the candidate list, not a second caddie this plan can put on
        // the round, so it stays off here.
        let ranked = rank_caddies(
            &candidates,
            RankingOptions {
                player_count: Some(round.player_count),
                include_rookie_pairing: false,
                limit: Some(1),
            },
        );
        let Some(mut pick) = ranked.into_iter().next() else {
            skipped.push(AutoAssignSkippedItem::new(
                round.reservation_id.clone(),
                skip_reason::NO_CADDIE_AVAILABLE,
            ));
            continue;
        };

        let Some(index) = pool
            .iter()
            .position(|caddie| caddie.caddie_id == pick.caddie_id)
        else {
            continue;
        };
        let placement = pool[index].placement.clone();
        if !keen.is_empty() {
            pick.reasons
                .push(plan_reason::TWO_ROUND_REQUEST.to_string());
        }
        let caddie = &mut pool[index];
        caddie.rounds_assigned_today += 1;
        caddie.busy.push((round.starts_at, round.ends_at()));

        assigned.push(AutoAssignPlanItem::reconstitute_with_placement(
            round.reservation_id.clone(),
            round.starts_at,
            pick.caddie_id,
            pick.display_name,
            pick.reasons,
            placement,
        ));
    }

    AutoAssignResult::new(options.dry_run, assigned, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn options() -> PlanOptions {
        PlanOptions {
            timezone: chrono_tz::Asia::Tokyo,
            dry_run: true,
        }
    }

    /// `hour` is the local tee time in JST.
    fn round(id: &str, hour: u32, players: i32) -> PlannableRound {
        PlannableRound {
            reservation_id: ReservationId::new(id),
            starts_at: Utc
                .with_ymd_and_hms(2026, 8, 8, hour.saturating_sub(9), 0, 0)
                .unwrap(),
            duration_minutes: Some(270),
            player_count: players,
            course_id: None,
        }
    }

    fn caddie(id: &str, name: &str) -> PlannableCaddie {
        PlannableCaddie {
            caddie_id: id.into(),
            display_name: name.into(),
            skill_level: CaddieSkillLevel::Regular,
            rating_average: None,
            rating_count: 0,
            max_rounds_per_day: 2,
            rounds_assigned_today: 0,
            attendance: AttendanceState::Working,
            availability: None,
            busy: Vec::new(),
            placement: CaddiePlacement::Unconfirmed,
            wants_two_rounds: false,
        }
    }

    /// Two caddies who differ only in what the ranker sees, so a plan that
    /// ignored the two-round request would always hand the group to `strong`.
    fn a_strong_and_a_keen_caddie() -> (PlannableCaddie, PlannableCaddie) {
        let mut strong = caddie("cad_strong", "Strong");
        strong.rating_average = Some(5.0);
        strong.rating_count = 10;
        let mut keen = caddie("cad_keen", "Keen");
        keen.rating_average = Some(1.0);
        keen.rating_count = 10;
        keen.wants_two_rounds = true;
        (strong, keen)
    }

    #[test]
    fn a_two_round_request_is_walked_as_two_rounds() {
        // The early group starts the pair and the later one finishes it. Left
        // to the ranking, the better-rated caddie takes both and the request
        // is answered with nothing.
        let (strong, keen) = a_strong_and_a_keen_caddie();

        let plan = plan_caddie_assignments(
            &[round("rsv_early", 9, 4), round("rsv_late", 14, 4)],
            &[strong, keen],
            options(),
        );

        assert_eq!(plan.assigned()[0].reservation_id().as_str(), "rsv_early");
        assert_eq!(plan.assigned()[0].caddie_id().as_str(), "cad_keen");
        assert_eq!(plan.assigned()[1].caddie_id().as_str(), "cad_keen");
        assert!(plan.assigned()[0]
            .rationale()
            .contains(&plan_reason::TWO_ROUND_REQUEST.to_string()));
    }

    #[test]
    fn the_last_group_of_the_day_is_not_held_for_a_two_round_request() {
        // Nothing follows an 09:00 round on a one-group day, so the request
        // buys nobody a second round and the ranking decides as it always did.
        let (strong, keen) = a_strong_and_a_keen_caddie();

        let plan = plan_caddie_assignments(&[round("rsv_only", 9, 4)], &[strong, keen], options());

        assert_eq!(plan.assigned()[0].caddie_id().as_str(), "cad_strong");
        assert!(plan.assigned()[0]
            .rationale()
            .iter()
            .all(|reason| reason != plan_reason::TWO_ROUND_REQUEST));
    }

    #[test]
    fn a_request_the_daily_limit_refuses_changes_nothing() {
        // Asking for two rounds does not raise the caddie's own limit, and a
        // one-round caddie holding an early group would answer the request by
        // making the day worse.
        let (strong, mut keen) = a_strong_and_a_keen_caddie();
        keen.max_rounds_per_day = 1;

        let plan = plan_caddie_assignments(
            &[round("rsv_early", 9, 4), round("rsv_late", 14, 4)],
            &[strong, keen],
            options(),
        );

        assert_eq!(plan.assigned()[0].caddie_id().as_str(), "cad_strong");
    }

    #[test]
    fn a_two_round_caddie_out_on_one_round_is_not_offered_an_overlapping_second() {
        // The pair still has to be two rounds one person can walk. The request
        // reorders the candidates; it never puts a caddie in two places.
        let (_, mut keen) = a_strong_and_a_keen_caddie();
        keen.rounds_assigned_today = 1;
        keen.busy = vec![(
            Utc.with_ymd_and_hms(2026, 8, 8, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 8, 4, 30, 0).unwrap(),
        )];
        let plain = caddie("cad_plain", "Plain");

        let plan = plan_caddie_assignments(
            &[round("rsv_overlapping", 11, 4)],
            &[keen, plain],
            options(),
        );

        assert_eq!(plan.assigned()[0].caddie_id().as_str(), "cad_plain");
    }

    #[test]
    fn a_two_round_request_nobody_can_honour_still_gets_the_day_staffed() {
        // Everyone left asked for two rounds and none of them may walk two.
        // The shortlist empties, and the plan must fall back to the whole
        // eligible list rather than reporting the group as unstaffable.
        let mut keen = caddie("cad_keen", "Keen");
        keen.wants_two_rounds = true;
        keen.max_rounds_per_day = 1;

        let plan = plan_caddie_assignments(
            &[round("rsv_early", 9, 4), round("rsv_late", 14, 4)],
            &[keen],
            options(),
        );

        assert_eq!(plan.assigned().len(), 1);
        assert_eq!(plan.assigned()[0].caddie_id().as_str(), "cad_keen");
    }

    #[test]
    fn every_caddie_attached_round_gets_somebody() {
        let plan = plan_caddie_assignments(
            &[round("rsv_1", 7, 4), round("rsv_2", 13, 2)],
            &[caddie("cad_1", "Sato"), caddie("cad_2", "Tanaka")],
            options(),
        );

        assert_eq!(plan.assigned().len(), 2);
        assert!(plan.skipped().is_empty());
    }

    #[test]
    fn one_caddie_is_not_promised_to_two_rounds_at_once() {
        // 07:00 and 08:00 overlap on a 270-minute round, so the second has to
        // fall to somebody else however well the first one ranked.
        let plan = plan_caddie_assignments(
            &[round("rsv_1", 7, 4), round("rsv_2", 8, 4)],
            &[caddie("cad_1", "Sato"), caddie("cad_2", "Tanaka")],
            options(),
        );

        assert_eq!(plan.assigned().len(), 2);
        let first = plan.assigned()[0].caddie_id().as_str().to_string();
        let second = plan.assigned()[1].caddie_id().as_str().to_string();
        assert_ne!(first, second);
    }

    #[test]
    fn a_round_nobody_can_take_is_reported_rather_than_dropped() {
        // Silence here would read as "the day is fully staffed", which is the
        // one thing the operator must not believe.
        let plan = plan_caddie_assignments(
            &[round("rsv_1", 7, 4), round("rsv_2", 8, 4)],
            &[caddie("cad_1", "Sato")],
            options(),
        );

        assert_eq!(plan.assigned().len(), 1);
        assert_eq!(plan.skipped().len(), 1);
        assert_eq!(plan.skipped()[0].reservation_id().as_str(), "rsv_2");
    }

    #[test]
    fn a_day_off_request_takes_the_caddie_out_of_the_plan() {
        let mut off = caddie("cad_off", "Off");
        off.availability = Some(AvailabilityStatus::Unavailable);
        let plan = plan_caddie_assignments(&[round("rsv_1", 7, 4)], &[off], options());

        assert!(plan.assigned().is_empty());
        assert_eq!(plan.skipped()[0].reason(), skip_reason::NO_CADDIE_AVAILABLE);
    }

    #[test]
    fn a_morning_only_request_is_read_against_the_courses_own_noon() {
        let mut morning = caddie("cad_am", "Morning");
        morning.availability = Some(AvailabilityStatus::MorningOnly);

        // 07:00 JST is 22:00 UTC the day before: reading the tee time in UTC
        // would put this round in the evening and refuse a morning shift.
        let taken =
            plan_caddie_assignments(&[round("rsv_am", 7, 4)], &[morning.clone()], options());
        assert_eq!(taken.assigned().len(), 1);

        let refused = plan_caddie_assignments(&[round("rsv_pm", 14, 4)], &[morning], options());
        assert!(refused.assigned().is_empty());
    }

    #[test]
    fn half_day_requests_follow_the_tenant_dst_offset() {
        let summer_morning = Utc.with_ymd_and_hms(2026, 7, 1, 5, 0, 0).unwrap();
        assert!(shift_covers_tee_time(
            Some(AvailabilityStatus::MorningOnly),
            Some(summer_morning),
            chrono_tz::Europe::Berlin,
        ));
        assert!(!shift_covers_tee_time(
            Some(AvailabilityStatus::AfternoonOnly),
            Some(summer_morning),
            chrono_tz::Europe::Berlin,
        ));
    }

    #[test]
    fn a_caddie_at_their_daily_limit_is_named_as_such() {
        let mut full = caddie("cad_full", "Full");
        full.max_rounds_per_day = 1;
        full.rounds_assigned_today = 1;

        let plan = plan_caddie_assignments(&[round("rsv_1", 7, 4)], &[full], options());

        assert_eq!(plan.skipped()[0].reason(), skip_reason::ALL_AT_DAILY_LIMIT);
    }

    #[test]
    fn a_standing_assignment_blocks_the_stretch_it_covers() {
        let mut committed = caddie("cad_1", "Sato");
        committed.busy = vec![(
            Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 8, 2, 30, 0).unwrap(),
        )];
        committed.rounds_assigned_today = 1;

        let plan = plan_caddie_assignments(&[round("rsv_1", 7, 4)], &[committed], options());

        assert!(plan.assigned().is_empty());
        assert_eq!(plan.skipped()[0].reason(), skip_reason::NO_CADDIE_AVAILABLE);
    }

    #[test]
    fn the_earliest_round_picks_first() {
        // Given out of order, the 07:00 round still gets the better-rated
        // caddie: the day is planned forwards, not in the order it arrived.
        let mut strong = caddie("cad_strong", "Strong");
        strong.rating_average = Some(5.0);
        strong.rating_count = 10;
        strong.max_rounds_per_day = 1;
        let mut weak = caddie("cad_weak", "Weak");
        weak.rating_average = Some(1.0);
        weak.rating_count = 10;
        weak.max_rounds_per_day = 1;

        let plan = plan_caddie_assignments(
            &[round("rsv_late", 8, 4), round("rsv_early", 7, 4)],
            &[weak, strong],
            options(),
        );

        assert_eq!(plan.assigned()[0].reservation_id().as_str(), "rsv_early");
        assert_eq!(plan.assigned()[0].caddie_id().as_str(), "cad_strong");
    }
}

#[cfg(test)]
mod course_tests {
    use super::*;
    use chrono::TimeZone;

    fn options() -> PlanOptions {
        PlanOptions {
            timezone: chrono_tz::Asia::Tokyo,
            dry_run: true,
        }
    }

    fn round_on(id: &str, course: Option<&str>) -> PlannableRound {
        PlannableRound {
            reservation_id: ReservationId::new(id),
            starts_at: Utc.with_ymd_and_hms(2026, 8, 8, 22, 0, 0).unwrap(),
            duration_minutes: Some(270),
            player_count: 4,
            course_id: course.map(CourseId::new),
        }
    }

    fn caddie_at(id: &str, placement: CaddiePlacement) -> PlannableCaddie {
        PlannableCaddie {
            caddie_id: id.into(),
            display_name: id.into(),
            skill_level: CaddieSkillLevel::Regular,
            rating_average: None,
            rating_count: 0,
            max_rounds_per_day: 2,
            rounds_assigned_today: 0,
            attendance: AttendanceState::Working,
            availability: None,
            busy: Vec::new(),
            placement,
            wants_two_rounds: false,
        }
    }

    #[test]
    fn a_round_is_walked_by_somebody_standing_on_its_own_course() {
        let result = plan_caddie_assignments(
            &[round_on("r1", Some("out"))],
            &[
                caddie_at("on-in", CaddiePlacement::On(CourseId::new("in"))),
                caddie_at("on-out", CaddiePlacement::On(CourseId::new("out"))),
            ],
            options(),
        );

        assert_eq!(result.assigned().len(), 1);
        assert_eq!(result.assigned()[0].caddie_id().as_str(), "on-out");
        assert_eq!(
            result.assigned()[0].placement(),
            &CaddiePlacement::On(CourseId::new("out"))
        );
    }

    #[test]
    fn a_course_nobody_stands_on_says_so_rather_than_blaming_the_shift_board() {
        let result = plan_caddie_assignments(
            &[round_on("r1", Some("out"))],
            &[caddie_at("on-in", CaddiePlacement::On(CourseId::new("in")))],
            options(),
        );

        assert_eq!(result.assigned().len(), 0);
        assert_eq!(
            result.skipped()[0].reason(),
            skip_reason::NO_CADDIE_ON_COURSE
        );
    }

    #[test]
    fn a_day_the_month_was_never_confirmed_for_is_planned_as_it_always_was() {
        let result = plan_caddie_assignments(
            &[round_on("r1", Some("out"))],
            &[caddie_at("anywhere", CaddiePlacement::Unconfirmed)],
            options(),
        );

        assert_eq!(result.assigned().len(), 1);
        assert_eq!(
            result.assigned()[0].placement(),
            &CaddiePlacement::Unconfirmed
        );
    }

    #[test]
    fn somebody_confirmed_with_no_course_can_still_take_a_round() {
        let result = plan_caddie_assignments(
            &[round_on("r1", Some("out"))],
            &[caddie_at("unplaced", CaddiePlacement::Unplaced)],
            options(),
        );

        assert_eq!(result.assigned().len(), 1);
        assert_eq!(result.assigned()[0].placement(), &CaddiePlacement::Unplaced);
    }
}
