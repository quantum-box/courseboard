//! Moving caddies who carry a fee of their own onto their rank's fee.
//!
//! Every caddie registered before rank fees existed was entered with an amount,
//! because the form required one, so the whole roster reads as "hired on their
//! own terms" and the rank table prices nobody (PLT-3346). Setting those
//! amounts back to zero is what hands a caddie to the table.
//!
//! It is also a pay change. For some caddies the rank pays exactly what they
//! carry and nothing moves; for others it pays more; and for the veteran the
//! per-caddie amount exists for, it pays less. Which of those is acceptable is
//! the club's call, not ours, so nothing here decides who moves. It lays out
//! what each move would do, moves only the caddies the operator names, and
//! writes down every move it makes — the amount before, the rank fee it was
//! handed to, who did it and why — so a payslip that changed can be explained.

use crate::course::domain::{Caddie, CaddieId, CaddieRank, CaddieRankFees, CourseError};

/// Most caddies one request may move. A club's roster is a few dozen people; a
/// request past this is a script, not an operator reading the list.
pub const MAX_FEE_ALIGNMENT_ITEMS: usize = 200;

/// Longest reason the change log keeps.
pub const MAX_FEE_ALIGNMENT_NOTE_CHARS: usize = 500;

/// What moving a caddie onto their rank would do to their pay per round.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeeAlignmentEffect {
    /// The rank pays what they already carry. Safe to move.
    Unchanged,
    /// The rank pays more.
    Raise,
    /// The rank pays less — the pay cut the per-caddie amount exists to avoid.
    Cut,
}

impl FeeAlignmentEffect {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unchanged => "unchanged",
            Self::Raise => "raise",
            Self::Cut => "cut",
        }
    }

    fn order(self) -> u8 {
        match self {
            Self::Cut => 0,
            Self::Raise => 1,
            Self::Unchanged => 2,
        }
    }
}

/// One caddie who carries a fee of their own, set against their rank's fee.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeAlignmentCandidate {
    pub caddie_id: CaddieId,
    pub display_name: String,
    pub active: bool,
    pub rank: CaddieRank,
    pub own_fee: i64,
    pub rank_fee: i64,
}

impl FeeAlignmentCandidate {
    pub fn effect(&self) -> FeeAlignmentEffect {
        match self.rank_fee.cmp(&self.own_fee) {
            std::cmp::Ordering::Equal => FeeAlignmentEffect::Unchanged,
            std::cmp::Ordering::Greater => FeeAlignmentEffect::Raise,
            std::cmp::Ordering::Less => FeeAlignmentEffect::Cut,
        }
    }

    /// Per-round change in pay: negative for a cut.
    pub fn difference(&self) -> i64 {
        self.rank_fee - self.own_fee
    }
}

/// Everyone a move onto the rank table would affect, cuts first.
///
/// Cuts lead because they are the rows that need a person to look at them;
/// the unchanged ones at the bottom are the ones that can go without a second
/// thought. Within a group the biggest change comes first.
pub fn fee_alignment_candidates(
    caddies: &[Caddie],
    fees: &CaddieRankFees,
) -> Vec<FeeAlignmentCandidate> {
    let mut candidates: Vec<FeeAlignmentCandidate> = caddies
        .iter()
        .filter(|caddie| caddie.base_fee_amount() > 0)
        .map(|caddie| FeeAlignmentCandidate {
            caddie_id: caddie.id().clone(),
            display_name: caddie.display_name().to_string(),
            active: caddie.is_active(),
            rank: caddie.rank(),
            own_fee: caddie.base_fee_amount(),
            rank_fee: fees.fee_for(caddie.rank()),
        })
        .collect();
    candidates.sort_by(|left, right| {
        left.effect()
            .order()
            .cmp(&right.effect().order())
            .then(right.difference().abs().cmp(&left.difference().abs()))
            .then(left.display_name.cmp(&right.display_name))
    });
    candidates
}

/// One caddie the operator chose to move, with the amount their screen showed.
///
/// The amount is what makes the request safe to act on late: if somebody edited
/// the caddie's fee after the list was drawn, the operator agreed to move a
/// different number than the one now stored, and the move is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeAlignmentItem {
    pub caddie_id: CaddieId,
    pub expected_own_fee: i64,
}

/// A request to move caddies onto their rank fee.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeAlignmentRequest {
    items: Vec<FeeAlignmentItem>,
    note: Option<String>,
}

impl FeeAlignmentRequest {
    pub fn try_new(items: Vec<FeeAlignmentItem>, note: Option<&str>) -> Result<Self, CourseError> {
        if items.is_empty() {
            return Err(CourseError::BadRequest(
                "choose at least one caddie to move onto their rank fee",
            ));
        }
        if items.len() > MAX_FEE_ALIGNMENT_ITEMS {
            return Err(CourseError::BadRequest(
                "too many caddies in one request; move them in smaller groups",
            ));
        }
        let mut seen = std::collections::HashSet::new();
        for item in &items {
            if !seen.insert(item.caddie_id.as_str()) {
                return Err(CourseError::BadRequest(
                    "the same caddie was named twice in one request",
                ));
            }
        }
        let note = note
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if note
            .as_deref()
            .is_some_and(|value| value.chars().count() > MAX_FEE_ALIGNMENT_NOTE_CHARS)
        {
            return Err(CourseError::BadRequest(
                "the reason is too long; keep it to 500 characters",
            ));
        }
        Ok(Self { items, note })
    }

    pub fn items(&self) -> &[FeeAlignmentItem] {
        &self.items
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }
}

/// Why a caddie the operator named was not moved, or that they were.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeeAlignmentOutcome {
    Aligned,
    /// They carry no fee of their own any more; the rank already prices them.
    AlreadyOnRank,
    /// Their fee is no longer the amount the operator agreed to move.
    OwnFeeChanged,
    NotFound,
    /// Their rank is priced at zero. Moving them would pay nothing per round.
    RankUnpriced,
    /// Field refused the write. The message is Field's.
    Failed(String),
}

impl FeeAlignmentOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Aligned => "aligned",
            Self::AlreadyOnRank => "already_on_rank",
            Self::OwnFeeChanged => "own_fee_changed",
            Self::NotFound => "not_found",
            Self::RankUnpriced => "rank_unpriced",
            Self::Failed(_) => "failed",
        }
    }
}

/// A move onto the rank fee, as the change log keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieFeeChange {
    pub caddie_id: CaddieId,
    pub rank: CaddieRank,
    pub previous_fee: i64,
    pub new_fee: i64,
    /// What the rank paid at the moment of the move — the table can be edited
    /// later, and the log has to say what the caddie was handed to then.
    pub rank_fee: i64,
    pub currency: String,
    pub note: Option<String>,
    /// The verified token's `sub`.
    pub changed_by: Option<String>,
    /// The username the token carried, for showing who did it.
    pub changed_by_name: Option<String>,
}

/// A logged move, read back with when it happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedCaddieFeeChange {
    pub id: u64,
    pub change: CaddieFeeChange,
    pub changed_at: chrono::DateTime<chrono::Utc>,
}

/// Whether `caddie` can be moved as the operator asked, and the log entry if so.
pub fn plan_fee_alignment(
    caddie: Option<&Caddie>,
    item: &FeeAlignmentItem,
    fees: &CaddieRankFees,
    note: Option<&str>,
    changed_by: Option<&str>,
    changed_by_name: Option<&str>,
) -> Result<CaddieFeeChange, FeeAlignmentOutcome> {
    let caddie = caddie.ok_or(FeeAlignmentOutcome::NotFound)?;
    let own_fee = caddie.base_fee_amount();
    if own_fee <= 0 {
        return Err(FeeAlignmentOutcome::AlreadyOnRank);
    }
    if own_fee != item.expected_own_fee {
        return Err(FeeAlignmentOutcome::OwnFeeChanged);
    }
    let rank_fee = fees.fee_for(caddie.rank());
    if rank_fee <= 0 {
        return Err(FeeAlignmentOutcome::RankUnpriced);
    }
    Ok(CaddieFeeChange {
        caddie_id: caddie.id().clone(),
        rank: caddie.rank(),
        previous_fee: own_fee,
        new_fee: 0,
        rank_fee,
        currency: fees.currency().to_string(),
        note: note.map(str::to_string),
        changed_by: changed_by.map(str::to_string),
        changed_by_name: changed_by_name.map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::CaddieSkillLevel;

    fn caddie(id: &str, name: &str, rank: CaddieRank, own_fee: i64) -> Caddie {
        Caddie::reconstitute(
            id,
            name,
            None,
            true,
            CaddieSkillLevel::Regular,
            rank,
            "active",
            own_fee,
            "JPY",
            2,
            true,
            20,
            0,
            None,
            0,
        )
    }

    fn fees() -> CaddieRankFees {
        CaddieRankFees::try_new(12_000, 11_000, 10_000, 0, "JPY").expect("fees")
    }

    fn item(id: &str, expected: i64) -> FeeAlignmentItem {
        FeeAlignmentItem {
            caddie_id: CaddieId::new(id),
            expected_own_fee: expected,
        }
    }

    #[test]
    fn a_caddie_already_paid_by_rank_is_not_a_candidate() {
        let roster = [caddie("new", "新人", CaddieRank::C, 0)];
        assert!(fee_alignment_candidates(&roster, &fees()).is_empty());
    }

    #[test]
    fn candidates_say_what_the_move_would_do_to_pay() {
        let roster = [
            caddie("same", "同額", CaddieRank::C, 10_000),
            caddie("up", "増額", CaddieRank::A, 11_500),
            caddie("down", "減額", CaddieRank::B, 13_000),
        ];
        let listed = fee_alignment_candidates(&roster, &fees());
        let effects: Vec<_> = listed
            .iter()
            .map(|candidate| (candidate.caddie_id.as_str(), candidate.effect()))
            .collect();
        // Cuts first: they are the rows somebody has to look at.
        assert_eq!(
            effects,
            [
                ("down", FeeAlignmentEffect::Cut),
                ("up", FeeAlignmentEffect::Raise),
                ("same", FeeAlignmentEffect::Unchanged),
            ]
        );
        assert_eq!(listed[0].difference(), -2_000);
        assert_eq!(listed[1].difference(), 500);
    }

    #[test]
    fn the_biggest_cut_leads_its_group() {
        let roster = [
            caddie("small", "小", CaddieRank::C, 10_500),
            caddie("big", "大", CaddieRank::C, 15_000),
        ];
        let listed = fee_alignment_candidates(&roster, &fees());
        assert_eq!(listed[0].caddie_id.as_str(), "big");
    }

    #[test]
    fn a_move_is_logged_with_the_amount_before_and_the_rank_fee_it_went_to() {
        let veteran = caddie("v", "ベテラン", CaddieRank::B, 13_000);
        let change = plan_fee_alignment(
            Some(&veteran),
            &item("v", 13_000),
            &fees(),
            Some("9/1 現場合意"),
            Some("user-1"),
            Some("yamada"),
        )
        .expect("movable");
        assert_eq!(change.previous_fee, 13_000);
        assert_eq!(change.new_fee, 0);
        assert_eq!(change.rank_fee, 11_000);
        assert_eq!(change.note.as_deref(), Some("9/1 現場合意"));
        assert_eq!(change.changed_by.as_deref(), Some("user-1"));
    }

    #[test]
    fn a_fee_edited_after_the_list_was_drawn_is_not_moved() {
        // The operator agreed to move 12,000, not whatever is stored now.
        let edited = caddie("v", "ベテラン", CaddieRank::B, 14_000);
        assert_eq!(
            plan_fee_alignment(Some(&edited), &item("v", 12_000), &fees(), None, None, None),
            Err(FeeAlignmentOutcome::OwnFeeChanged)
        );
    }

    #[test]
    fn a_rank_priced_at_zero_does_not_take_anybody() {
        // Moving onto a zero rank would pay nothing per round.
        let d = caddie("d", "D ランク", CaddieRank::D, 9_000);
        assert_eq!(
            plan_fee_alignment(Some(&d), &item("d", 9_000), &fees(), None, None, None),
            Err(FeeAlignmentOutcome::RankUnpriced)
        );
    }

    #[test]
    fn missing_and_already_moved_caddies_are_reported_not_rewritten() {
        assert_eq!(
            plan_fee_alignment(None, &item("gone", 10_000), &fees(), None, None, None),
            Err(FeeAlignmentOutcome::NotFound)
        );
        let moved = caddie("m", "済", CaddieRank::C, 0);
        assert_eq!(
            plan_fee_alignment(Some(&moved), &item("m", 10_000), &fees(), None, None, None),
            Err(FeeAlignmentOutcome::AlreadyOnRank)
        );
    }

    #[test]
    fn a_request_names_someone_once_and_at_least_one_person() {
        assert!(FeeAlignmentRequest::try_new(vec![], None).is_err());
        assert!(FeeAlignmentRequest::try_new(vec![item("a", 1), item("a", 1)], None).is_err());
        let too_many = (0..=MAX_FEE_ALIGNMENT_ITEMS)
            .map(|index| item(&format!("c{index}"), 1))
            .collect();
        assert!(FeeAlignmentRequest::try_new(too_many, None).is_err());
    }

    #[test]
    fn a_blank_reason_is_no_reason_and_a_long_one_is_refused() {
        let request = FeeAlignmentRequest::try_new(vec![item("a", 1)], Some("   ")).unwrap();
        assert_eq!(request.note(), None);
        let long = "あ".repeat(MAX_FEE_ALIGNMENT_NOTE_CHARS + 1);
        assert!(FeeAlignmentRequest::try_new(vec![item("a", 1)], Some(&long)).is_err());
    }
}
