//! What each course can staff on one day, and what it has already sold.
//!
//! The tenant-wide count (`compute_caddie_supply`) answers "can we sell one
//! more caddie-attached round today", which is the wrong question once a
//! tenant runs more than one course: a group tees off on a particular course
//! and is walked by a caddie standing on that course. Confirmed shifts carry
//! the placement, so the day can be counted course by course — and the gap
//! between two courses is what the desk moves people across.

use std::collections::HashMap;

use chrono::NaiveDate;

use super::{CaddieShift, CourseId};

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
            CourseCaddieSupply {
                working_caddies: placed.len() as i64,
                rounds_capacity: placed
                    .iter()
                    .map(|shift| i64::from(shift.rounds_capacity()))
                    .sum(),
                movable_caddies: placed
                    .iter()
                    .filter(|shift| shift.origin().is_movable())
                    .count() as i64,
                caddie_attached_groups: caddie_attached_by_course
                    .get(&course_id)
                    .copied()
                    .unwrap_or(0),
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

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 12).unwrap()
    }

    fn shift(caddie: &str, course: Option<&str>, rounds: i32, origin: ShiftOrigin) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new(caddie),
            date(),
            course.map(CourseId::new),
            true,
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
