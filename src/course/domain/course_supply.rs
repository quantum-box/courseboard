//! What each course can staff on one day, and what it has already sold.
//!
//! The tenant-wide count (`compute_caddie_supply`) answers "can we sell one
//! more caddie-attached round today", which is the wrong question once a
//! tenant runs more than one course: a group tees off on a particular course
//! and is walked by a caddie standing on that course. Confirmed shifts carry
//! the placement, so the day can be counted course by course — and the gap
//! between two courses is what the desk moves people across.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};

use super::{AssignmentId, CaddieId, CaddieShift, CourseId, ReservationId};

/// A reservation/caddie assignment that can cover one tee-sheet group.
///
/// The tee sheet itself stays outside this module. The use case resolves the
/// reservation to its demand course and passes only this normalized fact into
/// the supply calculation. `tee_time` is optional so callers that already
/// provide the rows in tee-time order do not have to manufacture a timestamp;
/// the HTTP-backed use case supplies it to make the pure calculation stable on
/// its own as well.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignedCoverage {
    reservation_id: ReservationId,
    demand_course_id: CourseId,
    caddie_id: CaddieId,
    assignment_id: AssignmentId,
    tee_time: Option<DateTime<Utc>>,
}

impl AssignedCoverage {
    pub fn new(
        reservation_id: impl Into<ReservationId>,
        demand_course_id: impl Into<CourseId>,
        caddie_id: impl Into<CaddieId>,
        assignment_id: impl Into<AssignmentId>,
    ) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            demand_course_id: demand_course_id.into(),
            caddie_id: caddie_id.into(),
            assignment_id: assignment_id.into(),
            tee_time: None,
        }
    }

    /// Attach the tee time used for deterministic reservation ordering.
    pub fn with_tee_time(mut self, tee_time: DateTime<Utc>) -> Self {
        self.tee_time = Some(tee_time);
        self
    }

    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }

    pub fn demand_course_id(&self) -> &CourseId {
        &self.demand_course_id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn assignment_id(&self) -> &AssignmentId {
        &self.assignment_id
    }

    pub fn tee_time(&self) -> Option<DateTime<Utc>> {
        self.tee_time
    }
}

/// One course's day: who is on it, and how much of it is sold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CourseCaddieSupply {
    course_id: CourseId,
    course_name: String,
    working_caddies: i64,
    rounds_capacity: i64,
    caddie_attached_groups: i64,
    /// Caddies here who could be sent elsewhere: not pinned to this course.
    movable_caddies: i64,
    /// Reservations with a non-cancelled assignment on this course.
    assigned_groups: i64,
    /// Assigned groups whose caddie has a working, placed shift with capacity.
    backed_assigned_groups: i64,
    /// Assigned groups without a working, placed shift to support them.
    unbacked_assigned_groups: i64,
    /// Assigned groups whose caddie's working shift had no capacity left.
    capacity_exceeded_assigned_groups: i64,
    /// Assigned groups whose caddie was placed on another course.
    course_mismatch_assigned_groups: i64,
    /// Raw capacity after backed assignments consume one unit each.
    effective_rounds_capacity: i64,
    /// Raw demand after assignment coverage is counted once per reservation.
    effective_caddie_attached_groups: i64,
    effective_shortfall: i64,
}

impl CourseCaddieSupply {
    pub fn course_id(&self) -> &CourseId {
        &self.course_id
    }

    pub fn course_name(&self) -> &str {
        &self.course_name
    }

    pub fn working_caddies(&self) -> i64 {
        self.working_caddies
    }

    /// Rounds the caddies placed here can take between them.
    pub fn rounds_capacity(&self) -> i64 {
        self.rounds_capacity
    }

    /// Caddie-attached groups already booked onto this course.
    pub fn caddie_attached_groups(&self) -> i64 {
        self.caddie_attached_groups
    }

    pub fn movable_caddies(&self) -> i64 {
        self.movable_caddies
    }

    pub fn assigned_groups(&self) -> i64 {
        self.assigned_groups
    }

    pub fn backed_assigned_groups(&self) -> i64 {
        self.backed_assigned_groups
    }

    pub fn unbacked_assigned_groups(&self) -> i64 {
        self.unbacked_assigned_groups
    }

    pub fn capacity_exceeded_assigned_groups(&self) -> i64 {
        self.capacity_exceeded_assigned_groups
    }

    pub fn course_mismatch_assigned_groups(&self) -> i64 {
        self.course_mismatch_assigned_groups
    }

    pub fn effective_rounds_capacity(&self) -> i64 {
        self.effective_rounds_capacity
    }

    pub fn effective_caddie_attached_groups(&self) -> i64 {
        self.effective_caddie_attached_groups
    }

    pub fn effective_shortfall(&self) -> i64 {
        self.effective_shortfall
    }

    /// Rounds still coverable here. Negative means the course is short and
    /// somebody has to come over from a course with room.
    pub fn shortfall(&self) -> i64 {
        self.rounds_capacity - self.caddie_attached_groups
    }

    pub fn is_short(&self) -> bool {
        self.shortfall() < 0
    }
}

/// Every course's day, plus the people confirmed to work but placed nowhere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayCaddieSupply {
    date: NaiveDate,
    courses: Vec<CourseCaddieSupply>,
    unplaced_caddies: i64,
}

impl DayCaddieSupply {
    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn courses(&self) -> &[CourseCaddieSupply] {
        &self.courses
    }

    /// Confirmed to work, on no course. They cover nothing until placed, so
    /// they are reported next to the courses rather than folded into one.
    pub fn unplaced_caddies(&self) -> i64 {
        self.unplaced_caddies
    }
}

/// Count one day, course by course.
///
/// `caddie_attached_by_course` is the demand side: how many caddie-attached
/// groups each course already holds. Courses with no shift and no booking
/// still get a row — a course nobody was placed on is exactly what the desk
/// needs to see.
pub fn compute_course_supply(
    date: NaiveDate,
    courses: impl IntoIterator<Item = (CourseId, String)>,
    shifts: &[CaddieShift],
    caddie_attached_by_course: &HashMap<CourseId, i64>,
) -> DayCaddieSupply {
    let day: Vec<&CaddieShift> = shifts
        .iter()
        .filter(|shift| shift.date() == date)
        .filter(|shift| shift.is_working())
        .collect();

    let courses = courses
        .into_iter()
        .map(|(course_id, course_name)| {
            let placed: Vec<&&CaddieShift> = day
                .iter()
                .filter(|shift| shift.course_id() == Some(&course_id))
                .collect();
            let rounds_capacity = placed
                .iter()
                .map(|shift| i64::from(shift.rounds_capacity()))
                .sum::<i64>();
            let caddie_attached_groups = caddie_attached_by_course
                .get(&course_id)
                .copied()
                .unwrap_or(0);
            CourseCaddieSupply {
                working_caddies: placed.len() as i64,
                rounds_capacity,
                movable_caddies: placed
                    .iter()
                    .filter(|shift| shift.origin().is_movable())
                    .count() as i64,
                caddie_attached_groups,
                assigned_groups: 0,
                backed_assigned_groups: 0,
                unbacked_assigned_groups: 0,
                capacity_exceeded_assigned_groups: 0,
                course_mismatch_assigned_groups: 0,
                effective_rounds_capacity: rounds_capacity,
                effective_caddie_attached_groups: caddie_attached_groups,
                effective_shortfall: rounds_capacity - caddie_attached_groups,
                course_id,
                course_name,
            }
        })
        .collect();

    DayCaddieSupply {
        date,
        courses,
        unplaced_caddies: day
            .iter()
            .filter(|shift| shift.course_id().is_none())
            .count() as i64,
    }
}

/// Apply assignment coverage to an already computed raw supply.
///
/// A reservation is counted at most once, even when Field returns duplicate
/// assignment rows. Within one reservation, a caddie with remaining capacity
/// wins over a caddie whose capacity is exhausted; ties are resolved by caddie
/// id and assignment id. Reservations are processed by tee time and then id,
/// so a caddie's capacity contention never depends on a map's iteration order.
///
/// The demand side is reduced for every selected assignment. Supply is reduced
/// only when the selected caddie has a working, placed shift with capacity. An
/// assignment that is not supported by a shift therefore remains visible via
/// its anomaly count instead of silently becoming confirmed supply.
pub fn apply_assignment_coverage(
    supply: &mut DayCaddieSupply,
    shifts: &[CaddieShift],
    coverage: &[AssignedCoverage],
) {
    for course in &mut supply.courses {
        course.effective_rounds_capacity = course.rounds_capacity;
        course.effective_caddie_attached_groups = course.caddie_attached_groups;
        course.effective_shortfall =
            course.effective_rounds_capacity - course.effective_caddie_attached_groups;
    }

    let mut shift_by_caddie: HashMap<String, Vec<ShiftCapacity>> = HashMap::new();
    for shift in shifts.iter().filter(|shift| shift.date() == supply.date) {
        shift_by_caddie
            .entry(shift.caddie_id().to_string())
            .or_default()
            .push(ShiftCapacity {
                working: shift.is_working(),
                course_id: shift.course_id().cloned(),
                remaining: i64::from(shift.rounds_capacity()),
            });
    }
    for entries in shift_by_caddie.values_mut() {
        entries.sort_by_key(shift_capacity_order);
    }

    let mut groups: HashMap<ReservationId, Vec<&AssignedCoverage>> = HashMap::new();
    for item in coverage {
        groups
            .entry(item.reservation_id.clone())
            .or_default()
            .push(item);
    }
    let mut groups: Vec<Vec<&AssignedCoverage>> = groups.into_values().collect();
    for group in &mut groups {
        group.sort_by(|left, right| {
            left.caddie_id
                .as_str()
                .cmp(right.caddie_id.as_str())
                .then_with(|| {
                    left.assignment_id
                        .as_str()
                        .cmp(right.assignment_id.as_str())
                })
        });
    }
    groups.sort_by(|left, right| {
        group_tee_time(left)
            .cmp(&group_tee_time(right))
            .then_with(|| {
                left[0]
                    .reservation_id
                    .as_str()
                    .cmp(right[0].reservation_id.as_str())
            })
    });

    for group in groups {
        let Some(first) = group.first() else {
            continue;
        };
        let Some(target_index) = supply
            .courses
            .iter()
            .position(|course| course.course_id == first.demand_course_id)
        else {
            // The use case only creates coverage from active tee-sheet rows.
            // Keep the pure function defensive when handed a stale course id.
            continue;
        };

        {
            let target = &mut supply.courses[target_index];
            target.assigned_groups += 1;
            target.effective_caddie_attached_groups -= 1;
        }

        let selected_index = group
            .iter()
            .position(|candidate| {
                shift_by_caddie
                    .get(candidate.caddie_id.as_str())
                    .is_some_and(|entries| {
                        entries.iter().any(|entry| {
                            entry.working && entry.course_id.is_some() && entry.remaining > 0
                        })
                    })
            })
            .unwrap_or(0);
        let selected = group[selected_index];

        let mut backed = false;
        let provider_course = shift_by_caddie
            .get_mut(selected.caddie_id.as_str())
            .and_then(|entries| {
                if let Some(entry) = entries
                    .iter_mut()
                    .find(|entry| entry.working && entry.course_id.is_some() && entry.remaining > 0)
                {
                    entry.remaining -= 1;
                    backed = true;
                    entry.course_id.clone()
                } else {
                    entries
                        .iter()
                        .find(|entry| entry.working && entry.course_id.is_some())
                        .and_then(|entry| entry.course_id.clone())
                }
            });

        let Some(provider_course) = provider_course else {
            supply.courses[target_index].unbacked_assigned_groups += 1;
            continue;
        };

        if backed {
            supply.courses[target_index].backed_assigned_groups += 1;
        } else {
            supply.courses[target_index].capacity_exceeded_assigned_groups += 1;
        }
        if provider_course != supply.courses[target_index].course_id {
            supply.courses[target_index].course_mismatch_assigned_groups += 1;
        }
        if let Some(provider) = supply
            .courses
            .iter_mut()
            .find(|course| course.course_id == provider_course)
        {
            provider.effective_rounds_capacity -= if backed { 1 } else { 0 };
        }
    }

    for course in &mut supply.courses {
        course.effective_shortfall =
            course.effective_rounds_capacity - course.effective_caddie_attached_groups;
    }
}

#[derive(Debug, Clone)]
struct ShiftCapacity {
    working: bool,
    course_id: Option<CourseId>,
    remaining: i64,
}

fn shift_capacity_order(value: &ShiftCapacity) -> (u8, String) {
    let category = match (value.working, value.course_id.is_some()) {
        (true, true) => 0,
        (true, false) => 1,
        (false, true) => 2,
        (false, false) => 3,
    };
    (
        category,
        value
            .course_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default(),
    )
}

fn group_tee_time(group: &[&AssignedCoverage]) -> Option<DateTime<Utc>> {
    group.iter().filter_map(|item| item.tee_time).min()
}

/// What a caddie is allowed to work, as the memberships say.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CaddieCapability {
    /// Every course they may work, main and sub together.
    pub courses: Vec<CourseId>,
    pub main_course: Option<CourseId>,
}

impl CaddieCapability {
    fn can_work(&self, course_id: &CourseId) -> bool {
        self.courses.contains(course_id)
    }
}

/// Somebody who could be sent to a short course for the day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reinforcement<'a> {
    pub shift: &'a CaddieShift,
    /// The short course is this caddie's own main course, so sending them
    /// there is putting them back rather than borrowing them.
    pub returns_home: bool,
}

/// Who can be moved onto `target` for the day.
///
/// Only caddies with a membership for it: a sub membership is exactly the
/// permission to be borrowed, and without one the edit would be refused
/// anyway. Pinned days are left alone — that is what pinning is for — and
/// somebody already on the course has nothing to be moved.
///
/// Ordered by how little the move costs: people placed nowhere first, then
/// those coming home to their main course, then everyone else.
pub fn reinforcements_for<'a>(
    target: &CourseId,
    date: NaiveDate,
    shifts: &'a [CaddieShift],
    capability: &HashMap<String, CaddieCapability>,
) -> Vec<Reinforcement<'a>> {
    let mut candidates: Vec<Reinforcement<'a>> = shifts
        .iter()
        .filter(|shift| shift.date() == date)
        .filter(|shift| shift.is_working())
        .filter(|shift| shift.origin().is_movable())
        .filter(|shift| shift.course_id() != Some(target))
        .filter_map(|shift| {
            let capability = capability.get(shift.caddie_id().as_str())?;
            if !capability.can_work(target) {
                return None;
            }
            Some(Reinforcement {
                shift,
                returns_home: capability.main_course.as_ref() == Some(target),
            })
        })
        .collect();
    candidates.sort_by_key(|candidate| {
        let cost = if candidate.shift.course_id().is_none() {
            0
        } else if candidate.returns_home {
            1
        } else {
            2
        };
        (cost, candidate.shift.caddie_id().to_string())
    });
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{CaddieId, ShiftOrigin, ShiftSpan};
    use chrono::{DateTime, Utc};

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 12).unwrap()
    }

    fn shift(caddie: &str, course: Option<&str>, rounds: i32, origin: ShiftOrigin) -> CaddieShift {
        shift_state(caddie, course, rounds, origin, true)
    }

    fn shift_state(
        caddie: &str,
        course: Option<&str>,
        rounds: i32,
        origin: ShiftOrigin,
        is_working: bool,
    ) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new(caddie),
            date(),
            course.map(CourseId::new),
            is_working,
            ShiftSpan::FullDay,
            rounds,
            origin,
            None,
            None,
            None,
        )
    }

    fn courses() -> Vec<(CourseId, String)> {
        vec![
            (CourseId::new("out"), "OUT".to_string()),
            (CourseId::new("in"), "IN".to_string()),
        ]
    }

    fn demand(pairs: &[(&str, i64)]) -> HashMap<CourseId, i64> {
        pairs
            .iter()
            .map(|(id, count)| (CourseId::new(*id), *count))
            .collect()
    }

    fn coverage(
        reservation: &str,
        course: &str,
        caddie: &str,
        assignment: &str,
        tee_time: &str,
    ) -> AssignedCoverage {
        AssignedCoverage::new(reservation, course, caddie, assignment).with_tee_time(
            DateTime::parse_from_rfc3339(tee_time)
                .unwrap()
                .with_timezone(&Utc),
        )
    }

    #[test]
    fn a_courses_capacity_is_the_rounds_of_the_caddies_placed_on_it() {
        let supply = compute_course_supply(
            date(),
            courses(),
            &[
                shift("a", Some("out"), 2, ShiftOrigin::Generated),
                shift("b", Some("out"), 1, ShiftOrigin::Generated),
                shift("c", Some("in"), 1, ShiftOrigin::Generated),
            ],
            &demand(&[]),
        );

        let out = &supply.courses()[0];
        assert_eq!(out.working_caddies(), 2);
        assert_eq!(out.rounds_capacity(), 3);
        assert_eq!(supply.courses()[1].rounds_capacity(), 1);
    }

    #[test]
    fn a_course_holding_more_groups_than_it_can_walk_reads_as_short() {
        let supply = compute_course_supply(
            date(),
            courses(),
            &[shift("a", Some("out"), 1, ShiftOrigin::Generated)],
            &demand(&[("out", 3), ("in", 0)]),
        );

        let out = &supply.courses()[0];
        assert_eq!(out.shortfall(), -2);
        assert!(out.is_short());
        assert!(!supply.courses()[1].is_short());
    }

    #[test]
    fn a_pinned_caddie_is_counted_but_not_offered_as_somebody_to_move() {
        let supply = compute_course_supply(
            date(),
            courses(),
            &[
                shift("a", Some("out"), 1, ShiftOrigin::Pinned),
                shift("b", Some("out"), 1, ShiftOrigin::Edited),
            ],
            &demand(&[]),
        );

        let out = &supply.courses()[0];
        assert_eq!(out.working_caddies(), 2);
        assert_eq!(out.movable_caddies(), 1);
    }

    #[test]
    fn a_day_off_adds_to_nothing() {
        let off = CaddieShift::reconstitute(
            CaddieId::new("a"),
            date(),
            None,
            false,
            ShiftSpan::FullDay,
            0,
            ShiftOrigin::Generated,
            None,
            None,
            None,
        );

        let supply = compute_course_supply(date(), courses(), &[off], &demand(&[]));

        assert_eq!(supply.courses()[0].rounds_capacity(), 0);
        assert_eq!(supply.unplaced_caddies(), 0);
    }

    #[test]
    fn somebody_working_with_nowhere_to_be_is_reported_beside_the_courses() {
        let supply = compute_course_supply(
            date(),
            courses(),
            &[shift("a", None, 1, ShiftOrigin::Generated)],
            &demand(&[]),
        );

        assert_eq!(supply.unplaced_caddies(), 1);
        assert_eq!(supply.courses()[0].rounds_capacity(), 0);
    }

    #[test]
    fn another_days_shift_is_not_counted_into_this_one() {
        let tomorrow = CaddieShift::reconstitute(
            CaddieId::new("a"),
            date().succ_opt().unwrap(),
            Some(CourseId::new("out")),
            true,
            ShiftSpan::FullDay,
            2,
            ShiftOrigin::Generated,
            None,
            None,
            None,
        );

        let supply = compute_course_supply(date(), courses(), &[tomorrow], &demand(&[]));

        assert_eq!(supply.courses()[0].rounds_capacity(), 0);
    }

    #[test]
    fn a_course_nobody_was_placed_on_still_gets_a_row() {
        let supply = compute_course_supply(date(), courses(), &[], &demand(&[("in", 2)]));

        assert_eq!(supply.courses().len(), 2);
        assert_eq!(supply.courses()[1].caddie_attached_groups(), 2);
        assert_eq!(supply.courses()[1].shortfall(), -2);
        assert_eq!(supply.courses()[1].effective_shortfall(), -2);
    }

    #[test]
    fn one_assignment_backed_on_the_same_course_reduces_capacity_and_demand_once() {
        let shifts = [shift("a", Some("out"), 1, ShiftOrigin::Generated)];
        let mut supply = compute_course_supply(date(), courses(), &shifts, &demand(&[("out", 1)]));

        apply_assignment_coverage(
            &mut supply,
            &shifts,
            &[coverage(
                "reservation-1",
                "out",
                "a",
                "assignment-1",
                "2026-09-12T00:00:00Z",
            )],
        );

        let out = &supply.courses()[0];
        assert_eq!(out.assigned_groups(), 1);
        assert_eq!(out.backed_assigned_groups(), 1);
        assert_eq!(out.unbacked_assigned_groups(), 0);
        assert_eq!(out.effective_rounds_capacity(), 0);
        assert_eq!(out.effective_caddie_attached_groups(), 0);
        assert_eq!(out.effective_shortfall(), 0);
    }

    #[test]
    fn duplicate_assignment_rows_for_one_reservation_consume_one_capacity_unit() {
        let shifts = [shift("a", Some("out"), 2, ShiftOrigin::Generated)];
        let mut supply = compute_course_supply(date(), courses(), &shifts, &demand(&[("out", 1)]));
        let rows = [
            coverage(
                "reservation-1",
                "out",
                "a",
                "assignment-2",
                "2026-09-12T00:00:00Z",
            ),
            coverage(
                "reservation-1",
                "out",
                "a",
                "assignment-1",
                "2026-09-12T00:00:00Z",
            ),
        ];

        apply_assignment_coverage(&mut supply, &shifts, &rows);

        let out = &supply.courses()[0];
        assert_eq!(out.assigned_groups(), 1);
        assert_eq!(out.backed_assigned_groups(), 1);
        assert_eq!(out.effective_rounds_capacity(), 1);
        assert_eq!(out.effective_caddie_attached_groups(), 0);
    }

    #[test]
    fn unconfirmed_unplaced_and_nonworking_assignments_are_unbacked() {
        let shifts = [
            shift("unplaced", None, 1, ShiftOrigin::Generated),
            shift_state("off", Some("out"), 0, ShiftOrigin::Generated, false),
        ];
        let mut supply = compute_course_supply(date(), courses(), &shifts, &demand(&[("out", 2)]));
        let rows = [
            coverage(
                "reservation-unplaced",
                "out",
                "unplaced",
                "assignment-1",
                "2026-09-12T00:00:00Z",
            ),
            coverage(
                "reservation-off",
                "out",
                "off",
                "assignment-2",
                "2026-09-12T01:00:00Z",
            ),
            coverage(
                "reservation-unconfirmed",
                "out",
                "unknown",
                "assignment-3",
                "2026-09-12T02:00:00Z",
            ),
        ];

        apply_assignment_coverage(&mut supply, &shifts, &rows);

        let out = &supply.courses()[0];
        assert_eq!(out.assigned_groups(), 3);
        assert_eq!(out.backed_assigned_groups(), 0);
        assert_eq!(out.unbacked_assigned_groups(), 3);
        assert_eq!(out.capacity_exceeded_assigned_groups(), 0);
        assert_eq!(out.effective_rounds_capacity(), 0);
        assert_eq!(out.effective_caddie_attached_groups(), -1);
    }

    #[test]
    fn a_capacity_exceeded_assignment_keeps_cross_course_mismatch() {
        let shifts = [shift("a", Some("out"), 1, ShiftOrigin::Generated)];
        let mut supply = compute_course_supply(
            date(),
            courses(),
            &shifts,
            &demand(&[("out", 1), ("in", 1)]),
        );
        let rows = [
            coverage(
                "reservation-out",
                "out",
                "a",
                "assignment-out",
                "2026-09-12T00:00:00Z",
            ),
            coverage(
                "reservation-in",
                "in",
                "a",
                "assignment-in",
                "2026-09-12T01:00:00Z",
            ),
        ];

        apply_assignment_coverage(&mut supply, &shifts, &rows);

        let out = &supply.courses()[0];
        let incoming = &supply.courses()[1];
        assert_eq!(out.effective_rounds_capacity(), 0);
        assert_eq!(incoming.assigned_groups(), 1);
        assert_eq!(incoming.backed_assigned_groups(), 0);
        assert_eq!(incoming.capacity_exceeded_assigned_groups(), 1);
        assert_eq!(incoming.course_mismatch_assigned_groups(), 1);
        assert_eq!(incoming.effective_caddie_attached_groups(), 0);
    }

    #[test]
    fn a_backed_cross_course_assignment_reduces_provider_capacity() {
        let shifts = [shift("a", Some("out"), 1, ShiftOrigin::Generated)];
        let mut supply = compute_course_supply(date(), courses(), &shifts, &demand(&[("in", 1)]));

        apply_assignment_coverage(
            &mut supply,
            &shifts,
            &[coverage(
                "reservation-in",
                "in",
                "a",
                "assignment-in",
                "2026-09-12T00:00:00Z",
            )],
        );

        assert_eq!(supply.courses()[0].effective_rounds_capacity(), 0);
        assert_eq!(supply.courses()[1].backed_assigned_groups(), 1);
        assert_eq!(supply.courses()[1].course_mismatch_assigned_groups(), 1);
    }

    #[test]
    fn capacity_competition_is_ordered_by_tee_time_then_reservation_id() {
        let shifts = [shift("a", Some("out"), 1, ShiftOrigin::Generated)];
        let mut supply = compute_course_supply(
            date(),
            courses(),
            &shifts,
            &demand(&[("out", 1), ("in", 2)]),
        );
        let rows = [
            coverage(
                "reservation-late",
                "in",
                "a",
                "assignment-late",
                "2026-09-12T02:00:00Z",
            ),
            coverage(
                "reservation-early",
                "in",
                "a",
                "assignment-early",
                "2026-09-12T01:00:00Z",
            ),
        ];

        apply_assignment_coverage(&mut supply, &shifts, &rows);

        let incoming = &supply.courses()[1];
        assert_eq!(incoming.backed_assigned_groups(), 1);
        assert_eq!(incoming.capacity_exceeded_assigned_groups(), 1);

        let mut same_time_supply = compute_course_supply(
            date(),
            courses(),
            &shifts,
            &demand(&[("out", 0), ("in", 2)]),
        );
        let same_time = [
            coverage(
                "reservation-z",
                "in",
                "a",
                "assignment-z",
                "2026-09-12T03:00:00Z",
            ),
            coverage(
                "reservation-a",
                "in",
                "a",
                "assignment-a",
                "2026-09-12T03:00:00Z",
            ),
        ];
        apply_assignment_coverage(&mut same_time_supply, &shifts, &same_time);
        assert_eq!(same_time_supply.courses()[1].backed_assigned_groups(), 1);
        assert_eq!(
            same_time_supply.courses()[1].capacity_exceeded_assigned_groups(),
            1
        );
    }
}

#[cfg(test)]
mod reinforcement_tests {
    use super::*;
    use crate::course::domain::{CaddieId, ShiftOrigin, ShiftSpan};

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 12).unwrap()
    }

    fn shift(caddie: &str, course: Option<&str>, origin: ShiftOrigin) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new(caddie),
            date(),
            course.map(CourseId::new),
            true,
            ShiftSpan::FullDay,
            1,
            origin,
            None,
            None,
            None,
        )
    }

    fn capability(entries: &[(&str, &[&str], Option<&str>)]) -> HashMap<String, CaddieCapability> {
        entries
            .iter()
            .map(|(caddie, courses, main)| {
                (
                    (*caddie).to_string(),
                    CaddieCapability {
                        courses: courses.iter().map(|id| CourseId::new(*id)).collect(),
                        main_course: main.map(CourseId::new),
                    },
                )
            })
            .collect()
    }

    #[test]
    fn a_sub_membership_is_what_puts_somebody_on_the_list() {
        let shifts = [
            shift("with-sub", Some("out"), ShiftOrigin::Generated),
            shift("out-only", Some("out"), ShiftOrigin::Generated),
        ];
        let capability = capability(&[
            ("with-sub", &["out", "in"], Some("out")),
            ("out-only", &["out"], Some("out")),
        ]);

        let candidates = reinforcements_for(&CourseId::new("in"), date(), &shifts, &capability);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].shift.caddie_id().as_str(), "with-sub");
        assert!(!candidates[0].returns_home);
    }

    #[test]
    fn a_pinned_day_and_somebody_already_there_are_both_left_alone() {
        let shifts = [
            shift("pinned", Some("out"), ShiftOrigin::Pinned),
            shift("already-there", Some("in"), ShiftOrigin::Generated),
        ];
        let capability = capability(&[
            ("pinned", &["out", "in"], Some("out")),
            ("already-there", &["out", "in"], Some("in")),
        ]);

        let candidates = reinforcements_for(&CourseId::new("in"), date(), &shifts, &capability);

        assert!(candidates.is_empty());
    }

    #[test]
    fn the_cheapest_moves_come_first() {
        let shifts = [
            shift("borrowed", Some("out"), ShiftOrigin::Generated),
            shift("unplaced", None, ShiftOrigin::Generated),
            shift("coming-home", Some("out"), ShiftOrigin::Generated),
        ];
        let capability = capability(&[
            ("borrowed", &["out", "in"], Some("out")),
            ("unplaced", &["in"], None),
            ("coming-home", &["out", "in"], Some("in")),
        ]);

        let candidates = reinforcements_for(&CourseId::new("in"), date(), &shifts, &capability);

        let order: Vec<&str> = candidates
            .iter()
            .map(|candidate| candidate.shift.caddie_id().as_str())
            .collect();
        assert_eq!(order, ["unplaced", "coming-home", "borrowed"]);
        assert!(candidates[1].returns_home);
    }

    #[test]
    fn a_day_off_is_not_somebody_to_call_in() {
        let off = CaddieShift::reconstitute(
            CaddieId::new("resting"),
            date(),
            None,
            false,
            ShiftSpan::FullDay,
            0,
            ShiftOrigin::Generated,
            None,
            None,
            None,
        );
        let capability = capability(&[("resting", &["out", "in"], Some("out"))]);

        let shifts = [off];
        let candidates = reinforcements_for(&CourseId::new("in"), date(), &shifts, &capability);

        assert!(candidates.is_empty());
    }
}
