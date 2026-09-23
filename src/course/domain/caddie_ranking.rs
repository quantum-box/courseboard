//! Who to put on the next round, and why.
//!
//! Field ranked caddies for us until now, and its query never looked at
//! attendance: a caddie who had not clocked in scored exactly the same as one
//! standing on the tee. The QA report caught it as "the board says 0 working
//! and still offers three candidates".
//!
//! Ranking is golf operations, so it belongs here — see
//! public README. The
//! three score components keep Field's arithmetic so an operator's ordering
//! does not jump the day this takes over; attendance is added on top.
//!
//! Everything in this module is pure. Ratings, assignments and the attendance
//! snapshot arrive already gathered.

use super::CaddieSkillLevel;

/// Whether the caddie is on duty for the day being planned.
///
/// Parsed from the attendance snapshot's status string, which is the same
/// vocabulary the operator screens badge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttendanceState {
    Working,
    NotClocked,
    ClockedOut,
    NotLinked,
}

impl AttendanceState {
    /// Anything unrecognised reads as "not clocked in" — the safe answer, since
    /// the snapshot is what a clock-in writes to.
    pub fn parse(status: &str) -> Self {
        match status.trim().to_ascii_lowercase().as_str() {
            "working" => Self::Working,
            "clocked_out" => Self::ClockedOut,
            "not_linked" => Self::NotLinked,
            _ => Self::NotClocked,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::NotClocked => "not_clocked",
            Self::ClockedOut => "clocked_out",
            Self::NotLinked => "not_linked",
        }
    }
}

/// Score given to a caddie nobody has rated yet, so a newcomer is neither
/// punished nor flattered by an average that does not exist.
const UNRATED_SCORE: i32 = 70;
/// Weight on the customer rating, which runs 1-5.
const RATING_WEIGHT: f64 = 20.0;
/// Each round still free today is worth this much, so load spreads out.
const REMAINING_ROUND_BONUS: i32 = 5;
/// A rookie paired with a veteran is worth putting forward.
const ROOKIE_PAIRING_BONUS: i32 = 12;
/// A foursome is heavier work; a veteran suits it.
const FOURSOME_VETERAN_BONUS: i32 = 5;
/// Being on duty is worth more than any other single component can swing, so a
/// caddie who has clocked in always outranks an equal one who has not. It is a
/// ranking weight and not a filter on purpose: the morning plan is drawn up
/// before the course opens, when nobody has clocked in yet.
const ON_DUTY_BONUS: i32 = 40;

/// A machine-readable reason, translated by the operator screens.
///
/// Field returned debug tokens (`rating_count=0`) and English prose that
/// reached the screen untranslated. These are stable keys instead.
pub mod reason {
    pub const NO_RATINGS: &str = "no_ratings";
    pub const ON_DUTY: &str = "on_duty";
    pub const NOT_CLOCKED_IN: &str = "not_clocked_in";
    pub const CLOCKED_OUT: &str = "clocked_out";
    pub const NO_STAFF_LINK: &str = "no_staff_link";
    pub const AT_DAILY_LIMIT: &str = "at_daily_limit";
    pub const ROOKIE_PAIRED: &str = "rookie_paired_with_veteran";
    pub const VETERAN_FOR_FOURSOME: &str = "veteran_for_foursome";
}

/// One caddie as the ranker sees them.
#[derive(Debug, Clone, PartialEq)]
pub struct RankingCandidate {
    pub caddie_id: String,
    pub display_name: String,
    pub skill_level: CaddieSkillLevel,
    pub rating_average: Option<f64>,
    pub rating_count: i64,
    pub rounds_assigned_today: i64,
    pub max_rounds_per_day: i32,
    pub attendance: AttendanceState,
}

/// What the operator asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RankingOptions {
    pub player_count: Option<i32>,
    pub include_rookie_pairing: bool,
    pub limit: Option<usize>,
}

/// A ranked caddie, ready to become a `CaddieRecommendation`.
#[derive(Debug, Clone, PartialEq)]
pub struct RankedCaddie {
    pub caddie_id: String,
    pub display_name: String,
    pub skill_level: CaddieSkillLevel,
    pub rating_average: Option<f64>,
    pub rating_count: i64,
    pub rounds_assigned: i64,
    pub remaining_rounds: i64,
    pub attendance: AttendanceState,
    pub score: i32,
    pub recommended_role: String,
    pub pairing_display_name: Option<String>,
    pub reasons: Vec<String>,
}

/// The most candidates any one board can use, however large a limit is asked
/// for. Beyond this the list stops being a recommendation.
const MAX_RESULTS: usize = 50;
const DEFAULT_RESULTS: usize = 10;

fn rating_component(candidate: &RankingCandidate) -> i32 {
    candidate
        .rating_average
        .map(|value| (value * RATING_WEIGHT).round() as i32)
        .unwrap_or(UNRATED_SCORE)
}

fn experience_component(skill: CaddieSkillLevel) -> i32 {
    match skill {
        CaddieSkillLevel::Junior => 0,
        CaddieSkillLevel::Regular => 6,
        CaddieSkillLevel::Veteran => 10,
    }
}

/// Rounds the caddie could still take today, never negative.
fn remaining_rounds(candidate: &RankingCandidate) -> i64 {
    (candidate.max_rounds_per_day as i64 - candidate.rounds_assigned_today).max(0)
}

fn attendance_component(state: AttendanceState) -> (i32, &'static str) {
    match state {
        AttendanceState::Working => (ON_DUTY_BONUS, reason::ON_DUTY),
        AttendanceState::NotClocked => (0, reason::NOT_CLOCKED_IN),
        AttendanceState::ClockedOut => (0, reason::CLOCKED_OUT),
        AttendanceState::NotLinked => (0, reason::NO_STAFF_LINK),
    }
}

/// Rank the day's caddies, best first.
pub fn rank_caddies(candidates: &[RankingCandidate], options: RankingOptions) -> Vec<RankedCaddie> {
    let veteran_pair = candidates
        .iter()
        .filter(|candidate| candidate.skill_level == CaddieSkillLevel::Veteran)
        .max_by_key(|candidate| (base_score(candidate), candidate.caddie_id.clone()))
        .map(|candidate| (candidate.caddie_id.clone(), candidate.display_name.clone()));

    let mut ranked: Vec<RankedCaddie> = candidates
        .iter()
        .map(|candidate| {
            let (attendance_bonus, attendance_reason) = attendance_component(candidate.attendance);
            let remaining_rounds = remaining_rounds(candidate);
            let mut reasons = vec![attendance_reason.to_string()];
            if candidate.rating_count == 0 {
                reasons.push(reason::NO_RATINGS.to_string());
            }
            if remaining_rounds == 0 {
                reasons.push(reason::AT_DAILY_LIMIT.to_string());
            }

            let mut score = base_score(candidate) + attendance_bonus;
            let mut role = "primary".to_string();
            let mut pairing_display_name = None;

            if options.include_rookie_pairing && candidate.skill_level == CaddieSkillLevel::Junior {
                if let Some((pair_id, pair_name)) = veteran_pair.clone() {
                    if pair_id != candidate.caddie_id {
                        pairing_display_name = Some(pair_name);
                        role = "trainee".to_string();
                        score += ROOKIE_PAIRING_BONUS;
                        reasons.push(reason::ROOKIE_PAIRED.to_string());
                    }
                }
            }
            if options.player_count.is_some_and(|count| count >= 4)
                && candidate.skill_level == CaddieSkillLevel::Veteran
            {
                score += FOURSOME_VETERAN_BONUS;
                reasons.push(reason::VETERAN_FOR_FOURSOME.to_string());
            }

            RankedCaddie {
                caddie_id: candidate.caddie_id.clone(),
                display_name: candidate.display_name.clone(),
                skill_level: candidate.skill_level,
                rating_average: candidate.rating_average,
                rating_count: candidate.rating_count,
                rounds_assigned: candidate.rounds_assigned_today.max(0),
                remaining_rounds,
                attendance: candidate.attendance,
                score,
                recommended_role: role,
                pairing_display_name,
                reasons,
            }
        })
        .collect();

    // Ties break on the rating the score was built from, then on id so the same
    // day always produces the same order.
    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.rating_count.cmp(&a.rating_count))
            .then_with(|| a.caddie_id.cmp(&b.caddie_id))
    });
    ranked.truncate(options.limit.unwrap_or(DEFAULT_RESULTS).min(MAX_RESULTS));
    ranked
}

fn base_score(candidate: &RankingCandidate) -> i32 {
    rating_component(candidate)
        + experience_component(candidate.skill_level)
        + (remaining_rounds(candidate) * REMAINING_ROUND_BONUS as i64) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(
        id: &str,
        skill: CaddieSkillLevel,
        attendance: AttendanceState,
    ) -> RankingCandidate {
        RankingCandidate {
            caddie_id: id.to_string(),
            display_name: id.to_string(),
            skill_level: skill,
            rating_average: None,
            rating_count: 0,
            rounds_assigned_today: 0,
            max_rounds_per_day: 2,
            attendance,
        }
    }

    #[test]
    fn a_caddie_on_duty_outranks_an_otherwise_identical_one_who_is_not() {
        // The whole point: Field scored these two the same, so the board offered
        // someone who had not turned up.
        let candidates = [
            candidate(
                "absent",
                CaddieSkillLevel::Regular,
                AttendanceState::NotClocked,
            ),
            candidate(
                "present",
                CaddieSkillLevel::Regular,
                AttendanceState::Working,
            ),
        ];
        let ranked = rank_caddies(&candidates, RankingOptions::default());
        assert_eq!(ranked[0].caddie_id, "present");
        assert!(ranked[0].reasons.contains(&reason::ON_DUTY.to_string()));
        assert!(ranked[1]
            .reasons
            .contains(&reason::NOT_CLOCKED_IN.to_string()));
    }

    #[test]
    fn nobody_is_dropped_for_not_having_clocked_in_yet() {
        // The morning plan is drawn up before the course opens. Filtering here
        // would leave the dispatch board empty every day.
        let candidates = [
            candidate("a", CaddieSkillLevel::Regular, AttendanceState::NotClocked),
            candidate("b", CaddieSkillLevel::Junior, AttendanceState::ClockedOut),
        ];
        assert_eq!(
            rank_caddies(&candidates, RankingOptions::default()).len(),
            2
        );
    }

    #[test]
    fn on_duty_outweighs_being_the_more_experienced_hand() {
        let mut veteran = candidate(
            "veteran",
            CaddieSkillLevel::Veteran,
            AttendanceState::NotClocked,
        );
        veteran.rating_average = Some(5.0);
        veteran.rating_count = 20;
        let regular = candidate(
            "regular",
            CaddieSkillLevel::Regular,
            AttendanceState::Working,
        );
        let ranked = rank_caddies(&[veteran, regular], RankingOptions::default());
        // veteran: 100 + 10 + 10 = 120; regular: 70 + 6 + 10 + 40 = 126
        assert_eq!(ranked[0].caddie_id, "regular");
    }

    #[test]
    fn the_three_components_still_add_up_the_way_they_used_to() {
        // Parity with the query this replaces, so nobody's ordering jumps on the
        // day it takes over. Attendance is the only thing added.
        let mut c = candidate("c", CaddieSkillLevel::Veteran, AttendanceState::NotClocked);
        c.rating_average = Some(4.6);
        c.rating_count = 5;
        c.rounds_assigned_today = 1;
        c.max_rounds_per_day = 3;
        let ranked = rank_caddies(&[c], RankingOptions::default());
        // rating 4.6*20=92, experience 10, remaining (3-1)*5=10
        assert_eq!(ranked[0].score, 112);
        assert_eq!(ranked[0].remaining_rounds, 2);
        assert_eq!(ranked[0].attendance, AttendanceState::NotClocked);
    }

    #[test]
    fn a_caddie_who_has_used_up_the_day_says_so() {
        let mut c = candidate("c", CaddieSkillLevel::Regular, AttendanceState::Working);
        c.rounds_assigned_today = 5;
        c.max_rounds_per_day = 2;
        let ranked = rank_caddies(&[c], RankingOptions::default());
        assert!(ranked[0]
            .reasons
            .contains(&reason::AT_DAILY_LIMIT.to_string()));
        // Remaining rounds never go negative and never subtract from the score.
        assert_eq!(ranked[0].score, UNRATED_SCORE + 6 + ON_DUTY_BONUS);
    }

    #[test]
    fn a_rookie_is_put_forward_with_the_strongest_veteran() {
        let candidates = [
            candidate("rookie", CaddieSkillLevel::Junior, AttendanceState::Working),
            candidate(
                "veteran",
                CaddieSkillLevel::Veteran,
                AttendanceState::Working,
            ),
        ];
        let ranked = rank_caddies(
            &candidates,
            RankingOptions {
                include_rookie_pairing: true,
                ..Default::default()
            },
        );
        let rookie = ranked
            .iter()
            .find(|r| r.caddie_id == "rookie")
            .expect("rookie");
        assert_eq!(rookie.pairing_display_name.as_deref(), Some("veteran"));
        assert_eq!(rookie.recommended_role, "trainee");
        assert!(rookie.reasons.contains(&reason::ROOKIE_PAIRED.to_string()));
    }

    #[test]
    fn a_veteran_is_favoured_for_a_full_foursome() {
        let candidates = [candidate(
            "veteran",
            CaddieSkillLevel::Veteran,
            AttendanceState::Working,
        )];
        let plain = rank_caddies(&candidates, RankingOptions::default());
        let foursome = rank_caddies(
            &candidates,
            RankingOptions {
                player_count: Some(4),
                ..Default::default()
            },
        );
        assert_eq!(foursome[0].score - plain[0].score, FOURSOME_VETERAN_BONUS);
        assert!(foursome[0]
            .reasons
            .contains(&reason::VETERAN_FOR_FOURSOME.to_string()));
    }

    #[test]
    fn no_reason_reaches_the_screen_as_english_prose() {
        // Field pushed sentences like "no historical ratings yet; neutral score
        // applied" straight through to the operator.
        let ranked = rank_caddies(
            &[candidate(
                "c",
                CaddieSkillLevel::Junior,
                AttendanceState::NotClocked,
            )],
            RankingOptions {
                include_rookie_pairing: true,
                player_count: Some(4),
                ..Default::default()
            },
        );
        for reason in &ranked[0].reasons {
            assert!(
                reason.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "reason {reason:?} is not a stable key"
            );
        }
    }

    #[test]
    fn the_list_is_capped_however_large_a_limit_is_asked_for() {
        let many: Vec<_> = (0..80)
            .map(|i| {
                candidate(
                    &format!("c{i:02}"),
                    CaddieSkillLevel::Regular,
                    AttendanceState::Working,
                )
            })
            .collect();
        assert_eq!(
            rank_caddies(&many, RankingOptions::default()).len(),
            DEFAULT_RESULTS
        );
        let asked = RankingOptions {
            limit: Some(500),
            ..Default::default()
        };
        assert_eq!(rank_caddies(&many, asked).len(), MAX_RESULTS);
    }
}
