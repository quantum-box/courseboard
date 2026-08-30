//! How a club sorts its regulars.
//!
//! Not a membership. A member holds a plan the club sold them; a grade is what
//! the club worked out about somebody from how they actually play — and a
//! visitor who comes fortnightly and spends well can outrank a 正会員 who has
//! not been seen in three years. Both readings are needed, and neither
//! substitutes for the other.
//!
//! The thresholds are golf's, so they live in CourseBoard's own rows rather
//! than in Field (ADR-0009). The names are free text for the same reason plan
//! names are: every club invents its own ladder (ゴールド / シルバー, A / B / C,
//! 特別会員待遇), and an enum here would reject the next one they think of.
//!
//! **A grade is never guessed from a partial history.** It is read off lifetime
//! figures, so when the read gave up early there is no grade — not a low one.
//! Showing a twenty-year member as ungraded because the count stopped at two
//! thousand rounds is a bug the desk would never catch.

use super::{CourseError, CustomerVisitSummary};

/// More rungs than this stops being a ladder anybody can hold in their head.
pub const MAX_GRADE_RULES: usize = 10;
/// Matches the plan name limit; a longer label is prose, not a grade.
const MAX_TEXT_LENGTH: usize = 120;

/// One rung: a name, and what somebody has to have done to reach it.
///
/// Every threshold set on a rule must be met. An unset threshold asks nothing —
/// a club grading purely on how often people come leaves the money ones empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerGradeRule {
    name: String,
    min_visits: u32,
    /// Takings per round sold. `None` asks nothing of it.
    min_spend_per_player: Option<i64>,
    min_total_amount: Option<i64>,
}

impl CustomerGradeRule {
    pub fn try_new(
        name: impl Into<String>,
        min_visits: u32,
        min_spend_per_player: Option<i64>,
        min_total_amount: Option<i64>,
    ) -> Result<Self, CourseError> {
        let name = name.into();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CourseError::BadRequest("grade name is required"));
        }
        if trimmed.chars().count() > MAX_TEXT_LENGTH {
            return Err(CourseError::BadRequest(
                "text must be at most 120 characters",
            ));
        }
        if min_spend_per_player.is_some_and(|value| value < 0)
            || min_total_amount.is_some_and(|value| value < 0)
        {
            return Err(CourseError::BadRequest(
                "grade thresholds must not be negative",
            ));
        }
        Ok(Self {
            name: trimmed.to_string(),
            min_visits,
            min_spend_per_player,
            min_total_amount,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn min_visits(&self) -> u32 {
        self.min_visits
    }

    pub fn min_spend_per_player(&self) -> Option<i64> {
        self.min_spend_per_player
    }

    pub fn min_total_amount(&self) -> Option<i64> {
        self.min_total_amount
    }

    /// Whether these lifetime figures reach this rung.
    ///
    /// A threshold on money the summary cannot answer for is *not* met: an
    /// unknown average is unknown, and treating it as passing would promote
    /// somebody on the strength of bookings that carry no amount at all.
    fn is_reached_by(&self, summary: &CustomerVisitSummary) -> bool {
        if summary.visits < self.min_visits {
            return false;
        }
        if let Some(required) = self.min_spend_per_player {
            match summary.spend_per_player {
                Some(actual) if actual >= required => {}
                _ => return false,
            }
        }
        if let Some(required) = self.min_total_amount {
            if summary.total_amount < required {
                return false;
            }
        }
        true
    }
}

/// The club's ladder, highest rung first.
///
/// Order is the club's, not sorted for them: the rungs are judged top down and
/// the first one reached wins, so a club that wants 来場回数 to outrank spend
/// arranges it that way rather than arguing with a sort.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CustomerGradeRules {
    rules: Vec<CustomerGradeRule>,
}

impl CustomerGradeRules {
    /// Validate an explicit save.
    ///
    /// Blank rows are dropped before this — the form grows rows the operator
    /// may leave empty — but a duplicate name or too many rungs is refused
    /// rather than quietly pruned: the ladder that comes back must be the one
    /// they arranged.
    pub fn try_new(rules: Vec<CustomerGradeRule>) -> Result<Self, CourseError> {
        if rules.len() > MAX_GRADE_RULES {
            return Err(CourseError::BadRequest("too many customer grades"));
        }
        for (index, rule) in rules.iter().enumerate() {
            if rules[..index].iter().any(|other| other.name == rule.name) {
                return Err(CourseError::BadRequest(
                    "each customer grade must have its own name",
                ));
            }
        }
        Ok(Self { rules })
    }

    /// Trusted input from CourseBoard's own rows.
    pub fn reconstitute(rules: Vec<CustomerGradeRule>) -> Self {
        Self { rules }
    }

    pub fn rules(&self) -> &[CustomerGradeRule] {
        &self.rules
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// The rung this person has reached, if any.
    ///
    /// `None` covers three different things the caller must not conflate, so
    /// the screen asks about them separately: no ladder configured, a history
    /// too partial to judge, or somebody who simply has not reached the lowest
    /// rung yet. Only the last is "ungraded"; see [`Self::grade_for`].
    pub fn grade_for(
        &self,
        summary: &CustomerVisitSummary,
        truncated: bool,
    ) -> CustomerGradeVerdict {
        if self.rules.is_empty() {
            return CustomerGradeVerdict::NotConfigured;
        }
        // A grade read off a partial history understates exactly the people it
        // matters most for. Withheld, not guessed.
        if truncated {
            return CustomerGradeVerdict::Unknown;
        }
        match self.rules.iter().find(|rule| rule.is_reached_by(summary)) {
            Some(rule) => CustomerGradeVerdict::Graded(rule.name.clone()),
            None => CustomerGradeVerdict::BelowLowest,
        }
    }
}

/// Why somebody does or does not have a grade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CustomerGradeVerdict {
    Graded(String),
    /// Reached no rung. A real answer about a real customer.
    BelowLowest,
    /// The history was not read to the end, so no honest answer exists.
    Unknown,
    /// This club has not set up a ladder. Not a fact about the customer.
    NotConfigured,
}

impl CustomerGradeVerdict {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Graded(_) => "graded",
            Self::BelowLowest => "below_lowest",
            Self::Unknown => "unknown",
            Self::NotConfigured => "not_configured",
        }
    }

    pub fn name(&self) -> Option<&str> {
        match self {
            Self::Graded(name) => Some(name.as_str()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(visits: u32, spend: Option<i64>, total: i64) -> CustomerVisitSummary {
        CustomerVisitSummary {
            visits,
            spend_per_player: spend,
            total_amount: total,
            ..CustomerVisitSummary::default()
        }
    }

    fn ladder() -> CustomerGradeRules {
        CustomerGradeRules::try_new(vec![
            CustomerGradeRule::try_new("ゴールド", 24, Some(15_000), None).unwrap(),
            CustomerGradeRule::try_new("シルバー", 12, None, None).unwrap(),
            CustomerGradeRule::try_new("ブロンズ", 4, None, None).unwrap(),
        ])
        .unwrap()
    }

    #[test]
    fn the_highest_rung_reached_is_the_one_awarded() {
        // Top down, first match wins: somebody clearing ゴールド also clears
        // シルバー, and the club means the higher one.
        let verdict = ladder().grade_for(&summary(30, Some(20_000), 0), false);
        assert_eq!(verdict, CustomerGradeVerdict::Graded("ゴールド".into()));
    }

    #[test]
    fn missing_one_threshold_drops_to_the_rung_below() {
        // Comes often enough for ゴールド but does not spend enough, so the
        // club's answer is シルバー rather than nothing.
        let verdict = ladder().grade_for(&summary(30, Some(9_000), 0), false);
        assert_eq!(verdict, CustomerGradeVerdict::Graded("シルバー".into()));
    }

    #[test]
    fn a_spend_threshold_is_not_met_by_an_unknown_spend() {
        // The average is unknown when no booking carries money. Passing on
        // unknown would promote somebody on the strength of missing data.
        let verdict = ladder().grade_for(&summary(30, None, 0), false);
        assert_eq!(verdict, CustomerGradeVerdict::Graded("シルバー".into()));
    }

    #[test]
    fn somebody_below_the_lowest_rung_is_answered_about_rather_than_skipped() {
        let verdict = ladder().grade_for(&summary(2, Some(20_000), 0), false);
        assert_eq!(verdict, CustomerGradeVerdict::BelowLowest);
    }

    #[test]
    fn a_partial_history_yields_no_grade_rather_than_a_low_one() {
        // The failure this guards: the longest-standing member is exactly the
        // one whose history is most likely to have been cut short, and
        // grading them off the tail would read as a demotion.
        let verdict = ladder().grade_for(&summary(2_000, Some(20_000), 0), true);
        assert_eq!(verdict, CustomerGradeVerdict::Unknown);
    }

    #[test]
    fn a_club_with_no_ladder_is_told_apart_from_a_customer_with_no_grade() {
        let verdict = CustomerGradeRules::default().grade_for(&summary(30, Some(20_000), 0), false);
        assert_eq!(verdict, CustomerGradeVerdict::NotConfigured);
    }

    #[test]
    fn a_total_spend_threshold_is_read_off_lifetime_takings() {
        let rules = CustomerGradeRules::try_new(vec![CustomerGradeRule::try_new(
            "法人優待",
            0,
            None,
            Some(1_000_000),
        )
        .unwrap()])
        .unwrap();
        assert_eq!(
            rules.grade_for(&summary(10, None, 1_200_000), false),
            CustomerGradeVerdict::Graded("法人優待".into())
        );
        assert_eq!(
            rules.grade_for(&summary(10, None, 900_000), false),
            CustomerGradeVerdict::BelowLowest
        );
    }

    #[test]
    fn a_grade_must_actually_be_named() {
        assert!(CustomerGradeRule::try_new("  ", 1, None, None).is_err());
    }

    #[test]
    fn two_rungs_cannot_share_a_name() {
        // Two answers to one question. The desk would never know which applied.
        let rules = vec![
            CustomerGradeRule::try_new("ゴールド", 24, None, None).unwrap(),
            CustomerGradeRule::try_new("ゴールド", 4, None, None).unwrap(),
        ];
        assert!(CustomerGradeRules::try_new(rules).is_err());
    }

    #[test]
    fn a_negative_threshold_is_a_typo_rather_than_a_rule() {
        assert!(CustomerGradeRule::try_new("ゴールド", 1, Some(-1), None).is_err());
        assert!(CustomerGradeRule::try_new("ゴールド", 1, None, Some(-1)).is_err());
    }

    #[test]
    fn a_ladder_longer_than_ten_rungs_is_refused() {
        let rules: Vec<CustomerGradeRule> = (0..(MAX_GRADE_RULES + 1))
            .map(|index| {
                CustomerGradeRule::try_new(format!("grade-{index}"), index as u32, None, None)
                    .unwrap()
            })
            .collect();
        assert!(CustomerGradeRules::try_new(rules).is_err());
    }
}
