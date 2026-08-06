//! Who gets put on each of the day's rounds, and why.
//!
//! Auto-assignment used to be a straight proxy to Field. Field's planner never
//! looked at attendance, so it would fill a tee time with a caddie who had not
//! clocked in — the same blindness the QA report caught in the candidate list
//! ("the board says 0 working and still offers three candidates"), which
//! `caddie_ranking` fixed for the list but not for this.
//!
//! It also wrote its reasons as Japanese sentences compiled into the binary, so
//! an operator reading the app in English got Japanese. The reasons here are
//! stable keys the screens translate, the same as `caddie_ranking`.
//!
//! Planning the day's caddies is golf operations, so it belongs here — see
//! `docs/src/architecture/decisions/ADR-0005-golf-domain-ownership.md`. The
//! ordering keeps Field's arithmetic (contract rounds left, then rating) so an
//! operator's plan does not jump the day this takes over; attendance is added
//! ahead of it.
//!
//! Everything in this module is pure. Reservations, the roster, the day's
//! assignments, availability and the attendance snapshot arrive already
//! gathered.

use chrono::{DateTime, Timelike, Utc};

use super::{AttendanceState, AvailabilityStatus};

/// A machine-readable reason, translated by the operator screens.
pub mod reason {
    /// Why a caddie was picked.
    pub const ON_DUTY: &str = "on_duty";
    pub const NOT_CLOCKED_IN: &str = "not_clocked_in";
    pub const CLOCKED_OUT: &str = "clocked_out";
    pub const NO_STAFF_LINK: &str = "no_staff_link";
    /// `contract_remaining=5`, unpacked and translated by the screens.
    pub const CONTRACT_REMAINING: &str = "contract_remaining";
    pub const SECOND_ROUND_TODAY: &str = "second_round_today";

    /// Why a tee time was left alone.
    pub const NO_CADDIE_AVAILABLE: &str = "no_caddie_available";
}

/// One tee time waiting for a caddie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoAssignSlot {
    pub reservation_id: String,
    pub starts_at: DateTime<Utc>,
}

/// One caddie as the planner sees them.
#[derive(Debug, Clone, PartialEq)]
pub struct AutoAssignCandidate {
    pub caddie_id: String,
    pub display_name: String,
    pub is_active: bool,
    pub can_two_rounds: bool,
    pub max_rounds_per_day: i32,
    pub monthly_contract_rounds: i32,
    /// Rounds already worked this month, for the contract balance.
    pub rounds_done_this_month: i64,
    /// Rounds already on this caddie for the day being planned.
    pub rounds_assigned_today: i64,
    pub rating_average: Option<f64>,
    /// What the caddie said about the day, when they said anything.
    pub availability: Option<AvailabilityStatus>,
    pub two_round_request: bool,
    pub attendance: AttendanceState,
}

/// A tee time with a caddie against it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedAssignment {
    pub reservation_id: String,
    pub scheduled_at: DateTime<Utc>,
    pub caddie_id: String,
    pub caddie_display_name: String,
    pub rationale: Vec<String>,
}

/// A tee time nobody could be put on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedSkip {
    pub reservation_id: String,
    pub reason: String,
}

/// Both halves of a plan.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AutoAssignPlan {
    pub assigned: Vec<PlannedAssignment>,
    pub skipped: Vec<PlannedSkip>,
}

/// The hour a tee time stops counting as a morning start.
///
/// It splits `morning_only` from `afternoon_only`, which is the only thing it
/// decides. Read in UTC because that is what a reservation carries; the caller
/// hands over times already in the course's own day.
const AFTERNOON_FROM_HOUR: u32 = 12;

fn is_morning(starts_at: DateTime<Utc>) -> bool {
    starts_at.hour() < AFTERNOON_FROM_HOUR
}

/// Whether the caddie said they could work this half of the day.
fn available_for(candidate: &AutoAssignCandidate, morning: bool) -> bool {
    match candidate.availability {
        Some(AvailabilityStatus::Unavailable) => false,
        Some(AvailabilityStatus::MorningOnly) => morning,
        Some(AvailabilityStatus::AfternoonOnly) => !morning,
        // No word from the caddie reads as available, which is how the roster
        // has always behaved.
        _ => true,
    }
}

/// How many rounds this caddie can take today.
///
/// One, unless they can work two, asked to, and are not on light duty. Capped
/// by their own per-day limit so a two round request cannot exceed it.
fn rounds_allowed_today(candidate: &AutoAssignCandidate) -> i64 {
    let two_rounds = candidate.can_two_rounds
        && candidate.two_round_request
        && candidate.availability != Some(AvailabilityStatus::LightDuty);
    let wanted = if two_rounds { 2 } else { 1 };
    wanted.min(candidate.max_rounds_per_day.max(0) as i64)
}

/// Attendance ordering: on duty first, then not yet clocked in, then those the
/// board has no reason to expect back.
///
/// Not a filter on purpose. The day's plan is drawn up before the course opens,
/// when nobody has clocked in yet — filtering would leave every tee time empty
/// every morning. It orders instead, and the reason travels with the pick.
fn attendance_rank(state: AttendanceState) -> u8 {
    match state {
        AttendanceState::Working => 0,
        AttendanceState::NotClocked => 1,
        AttendanceState::ClockedOut => 2,
        AttendanceState::NotLinked => 3,
    }
}

fn attendance_reason(state: AttendanceState) -> &'static str {
    match state {
        AttendanceState::Working => reason::ON_DUTY,
        AttendanceState::NotClocked => reason::NOT_CLOCKED_IN,
        AttendanceState::ClockedOut => reason::CLOCKED_OUT,
        AttendanceState::NotLinked => reason::NO_STAFF_LINK,
    }
}

fn contract_remaining(candidate: &AutoAssignCandidate) -> i64 {
    (i64::from(candidate.monthly_contract_rounds) - candidate.rounds_done_this_month).max(0)
}

/// Plan the day, earliest tee time first.
///
/// Each pick is taken into account for the ones after it, so a caddie put on
/// the 07:00 round is not offered the 07:10 one unless they can work two.
pub fn plan_auto_assignments(
    slots: &[AutoAssignSlot],
    candidates: &[AutoAssignCandidate],
) -> AutoAssignPlan {
    let mut load: Vec<i64> = candidates
        .iter()
        .map(|candidate| candidate.rounds_assigned_today)
        .collect();

    let mut slots: Vec<&AutoAssignSlot> = slots.iter().collect();
    slots.sort_by(|left, right| {
        left.starts_at
            .cmp(&right.starts_at)
            .then_with(|| left.reservation_id.cmp(&right.reservation_id))
    });

    let mut plan = AutoAssignPlan::default();

    for slot in slots {
        let morning = is_morning(slot.starts_at);

        let mut eligible: Vec<usize> = (0..candidates.len())
            .filter(|&index| {
                let candidate = &candidates[index];
                candidate.is_active
                    && available_for(candidate, morning)
                    && load[index] < rounds_allowed_today(candidate)
            })
            .collect();

        // Attendance first, then Field's order: the emptiest contract, then the
        // better rating. `caddie_id` last so two equal caddies always come out
        // in the same order rather than however the roster happened to arrive.
        eligible.sort_by(|&left, &right| {
            let a = &candidates[left];
            let b = &candidates[right];
            attendance_rank(a.attendance)
                .cmp(&attendance_rank(b.attendance))
                .then_with(|| contract_remaining(b).cmp(&contract_remaining(a)))
                .then_with(|| {
                    b.rating_average
                        .unwrap_or(0.0)
                        .partial_cmp(&a.rating_average.unwrap_or(0.0))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| a.caddie_id.cmp(&b.caddie_id))
        });

        let Some(&index) = eligible.first() else {
            plan.skipped.push(PlannedSkip {
                reservation_id: slot.reservation_id.clone(),
                reason: reason::NO_CADDIE_AVAILABLE.to_string(),
            });
            continue;
        };

        let candidate = &candidates[index];
        let mut rationale = vec![
            attendance_reason(candidate.attendance).to_string(),
            format!(
                "{}={}",
                reason::CONTRACT_REMAINING,
                contract_remaining(candidate)
            ),
        ];
        if load[index] > 0 {
            rationale.push(reason::SECOND_ROUND_TODAY.to_string());
        }

        load[index] += 1;
        plan.assigned.push(PlannedAssignment {
            reservation_id: slot.reservation_id.clone(),
            scheduled_at: slot.starts_at,
            caddie_id: candidate.caddie_id.clone(),
            caddie_display_name: candidate.display_name.clone(),
            rationale,
        });
    }

    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 7, hour, minute, 0).unwrap()
    }

    fn slot(id: &str, hour: u32, minute: u32) -> AutoAssignSlot {
        AutoAssignSlot {
            reservation_id: id.to_string(),
            starts_at: at(hour, minute),
        }
    }

    fn caddie(id: &str) -> AutoAssignCandidate {
        AutoAssignCandidate {
            caddie_id: id.to_string(),
            display_name: format!("caddie {id}"),
            is_active: true,
            can_two_rounds: false,
            max_rounds_per_day: 2,
            monthly_contract_rounds: 20,
            rounds_done_this_month: 0,
            rounds_assigned_today: 0,
            rating_average: Some(4.0),
            availability: None,
            two_round_request: false,
            attendance: AttendanceState::NotClocked,
        }
    }

    #[test]
    fn a_caddie_who_has_clocked_in_is_taken_before_one_who_has_not() {
        // Field's planner never read attendance, so the two ranked the same and
        // the round could go to somebody who had not turned up.
        let absent = AutoAssignCandidate {
            // Ranked ahead on every other component, to prove attendance wins.
            monthly_contract_rounds: 30,
            rating_average: Some(5.0),
            ..caddie("absent")
        };
        let present = AutoAssignCandidate {
            attendance: AttendanceState::Working,
            ..caddie("present")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0)], &[absent, present]);

        assert_eq!(plan.assigned.len(), 1);
        assert_eq!(plan.assigned[0].caddie_id, "present");
        assert!(plan.assigned[0]
            .rationale
            .contains(&reason::ON_DUTY.to_string()));
    }

    #[test]
    fn the_morning_plan_still_fills_when_nobody_has_clocked_in_yet() {
        // The plan is drawn up before the course opens. Filtering on attendance
        // instead of ordering by it would empty every tee time every morning.
        let plan = plan_auto_assignments(&[slot("r1", 7, 0)], &[caddie("a")]);

        assert_eq!(plan.assigned.len(), 1);
        assert!(plan.skipped.is_empty());
        assert!(plan.assigned[0]
            .rationale
            .contains(&reason::NOT_CLOCKED_IN.to_string()));
    }

    #[test]
    fn the_emptiest_contract_goes_first_when_attendance_is_equal() {
        let behind = AutoAssignCandidate {
            monthly_contract_rounds: 30,
            rounds_done_this_month: 2,
            ..caddie("behind")
        };
        let ahead = AutoAssignCandidate {
            monthly_contract_rounds: 10,
            rounds_done_this_month: 9,
            ..caddie("ahead")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0)], &[ahead, behind]);

        assert_eq!(plan.assigned[0].caddie_id, "behind");
        assert!(plan.assigned[0]
            .rationale
            .contains(&format!("{}=28", reason::CONTRACT_REMAINING)));
    }

    #[test]
    fn one_caddie_does_not_take_two_tee_times_unless_they_asked_to() {
        let plan = plan_auto_assignments(&[slot("r1", 7, 0), slot("r2", 7, 10)], &[caddie("only")]);

        assert_eq!(plan.assigned.len(), 1);
        assert_eq!(plan.skipped.len(), 1);
        assert_eq!(plan.skipped[0].reservation_id, "r2");
        assert_eq!(plan.skipped[0].reason, reason::NO_CADDIE_AVAILABLE);
    }

    #[test]
    fn a_caddie_who_asked_for_two_rounds_takes_two() {
        let willing = AutoAssignCandidate {
            can_two_rounds: true,
            two_round_request: true,
            ..caddie("willing")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0), slot("r2", 7, 10)], &[willing]);

        assert_eq!(plan.assigned.len(), 2);
        assert!(plan.skipped.is_empty());
        // Only the second one is called out as a second round.
        assert!(!plan.assigned[0]
            .rationale
            .contains(&reason::SECOND_ROUND_TODAY.to_string()));
        assert!(plan.assigned[1]
            .rationale
            .contains(&reason::SECOND_ROUND_TODAY.to_string()));
    }

    #[test]
    fn light_duty_refuses_the_second_round_even_when_asked_for() {
        let light = AutoAssignCandidate {
            can_two_rounds: true,
            two_round_request: true,
            availability: Some(AvailabilityStatus::LightDuty),
            ..caddie("light")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0), slot("r2", 7, 10)], &[light]);

        assert_eq!(plan.assigned.len(), 1);
        assert_eq!(plan.skipped.len(), 1);
    }

    #[test]
    fn a_half_day_caddie_only_takes_their_half() {
        let mornings = AutoAssignCandidate {
            availability: Some(AvailabilityStatus::MorningOnly),
            ..caddie("mornings")
        };
        let afternoons = AutoAssignCandidate {
            availability: Some(AvailabilityStatus::AfternoonOnly),
            ..caddie("afternoons")
        };

        let plan = plan_auto_assignments(
            &[slot("morning", 7, 0), slot("afternoon", 13, 0)],
            &[mornings, afternoons],
        );

        let by_reservation = |id: &str| {
            plan.assigned
                .iter()
                .find(|item| item.reservation_id == id)
                .map(|item| item.caddie_id.clone())
        };
        assert_eq!(by_reservation("morning"), Some("mornings".to_string()));
        assert_eq!(by_reservation("afternoon"), Some("afternoons".to_string()));
    }

    #[test]
    fn a_caddie_who_said_they_cannot_work_is_left_out_entirely() {
        let away = AutoAssignCandidate {
            availability: Some(AvailabilityStatus::Unavailable),
            attendance: AttendanceState::Working,
            ..caddie("away")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0)], &[away]);

        assert!(plan.assigned.is_empty());
        assert_eq!(plan.skipped.len(), 1);
    }

    #[test]
    fn a_caddie_off_the_roster_is_not_planned_in() {
        let retired = AutoAssignCandidate {
            is_active: false,
            attendance: AttendanceState::Working,
            ..caddie("retired")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0)], &[retired]);

        assert!(plan.assigned.is_empty());
        assert_eq!(plan.skipped[0].reason, reason::NO_CADDIE_AVAILABLE);
    }

    #[test]
    fn rounds_already_on_the_board_count_against_the_day() {
        let busy = AutoAssignCandidate {
            rounds_assigned_today: 1,
            ..caddie("busy")
        };

        let plan = plan_auto_assignments(&[slot("r1", 7, 0)], &[busy]);

        assert!(plan.assigned.is_empty());
    }

    #[test]
    fn the_same_roster_always_produces_the_same_plan() {
        // Two caddies alike in every component. Without the tiebreak the plan
        // would follow whatever order the roster arrived in.
        let first = caddie("aaa");
        let second = caddie("bbb");

        let one = plan_auto_assignments(&[slot("r1", 7, 0)], &[first.clone(), second.clone()]);
        let other = plan_auto_assignments(&[slot("r1", 7, 0)], &[second, first]);

        assert_eq!(one.assigned[0].caddie_id, other.assigned[0].caddie_id);
    }

    #[test]
    fn tee_times_are_planned_earliest_first_whatever_order_they_arrive_in() {
        let plan = plan_auto_assignments(
            &[slot("late", 13, 0), slot("early", 7, 0)],
            &[caddie("only")],
        );

        // The one caddie goes on the earlier round, not whichever came first.
        assert_eq!(plan.assigned.len(), 1);
        assert_eq!(plan.assigned[0].reservation_id, "early");
        assert_eq!(plan.skipped[0].reservation_id, "late");
    }
}
