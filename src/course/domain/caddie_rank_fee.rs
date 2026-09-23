//! What one round pays a caddie, decided by the rank the club gave them.
//!
//! A club grades its caddies and pays by that grade: an A works the same round
//! as a D and is paid more for it. That is a golf operating rule, so the table
//! belongs here rather than in Field (ADR-0005) — Field knows a staff member
//! was assigned to a booking, not what a club pays an A.
//!
//! The table is the default. A caddie may still carry a fee of their own, and
//! when they do it wins: a veteran hired on their own terms is the reason the
//! per-caddie amount exists, and silently repricing them to their rank would be
//! a pay cut nobody asked for.

use chrono::{DateTime, Utc};

use crate::course::domain::{CaddieRank, CourseError};

/// A fee nobody would type on purpose. Above it, the entry is a slip — a yen
/// amount pasted where a rate belonged — and taking it would quietly commit the
/// club to paying it.
const MAX_ROUND_FEE: i64 = 1_000_000;

/// Longest reason a repricing can carry. A paragraph is plenty to say why; past
/// that it is a pasted document, and the history list is not where that lives.
pub const MAX_RANK_FEE_NOTE_CHARS: usize = 500;

/// How many changes the history answers with at most.
pub const MAX_RANK_FEE_CHANGE_LIMIT: u32 = 200;

/// Per-round fee for each rank, in one currency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieRankFees {
    a: i64,
    b: i64,
    c: i64,
    d: i64,
    currency: String,
}

impl CaddieRankFees {
    /// Amounts a club that has never opened the screen is paying by.
    ///
    /// Not zero: a zero table would read as "this month cost nothing" on the
    /// payroll sheet, which is worse than a placeholder that is visibly a round
    /// number and asks to be edited.
    pub const DEFAULT_A: i64 = 12_000;
    pub const DEFAULT_B: i64 = 11_000;
    pub const DEFAULT_C: i64 = 10_000;
    pub const DEFAULT_D: i64 = 9_000;
    pub const DEFAULT_CURRENCY: &'static str = "JPY";

    pub fn try_new(
        a: i64,
        b: i64,
        c: i64,
        d: i64,
        currency: impl Into<String>,
    ) -> Result<Self, CourseError> {
        for amount in [a, b, c, d] {
            if amount < 0 {
                return Err(CourseError::BadRequest("a round fee cannot be negative"));
            }
            if amount > MAX_ROUND_FEE {
                return Err(CourseError::BadRequest(
                    "a round fee that large is almost certainly a typo",
                ));
            }
        }
        let currency = currency.into().trim().to_ascii_uppercase();
        if currency.is_empty() {
            return Err(CourseError::BadRequest("a currency is required"));
        }
        Ok(Self {
            a,
            b,
            c,
            d,
            currency,
        })
    }

    pub fn fee_for(&self, rank: CaddieRank) -> i64 {
        match rank {
            CaddieRank::A => self.a,
            CaddieRank::B => self.b,
            CaddieRank::C => self.c,
            CaddieRank::D => self.d,
        }
    }

    /// What this caddie is paid for one round.
    ///
    /// Their own fee wins when they have one. A zero is not "free": it is a
    /// profile nobody set an amount on, so the rank decides.
    pub fn round_fee_for(&self, rank: CaddieRank, base_fee_amount: i64) -> i64 {
        if base_fee_amount > 0 {
            base_fee_amount
        } else {
            self.fee_for(rank)
        }
    }

    pub fn currency(&self) -> &str {
        &self.currency
    }
}

impl Default for CaddieRankFees {
    fn default() -> Self {
        Self {
            a: Self::DEFAULT_A,
            b: Self::DEFAULT_B,
            c: Self::DEFAULT_C,
            d: Self::DEFAULT_D,
            currency: Self::DEFAULT_CURRENCY.to_string(),
        }
    }
}

/// Who repriced the ranks, and why.
///
/// Taken from the verified token rather than the request body: a history the
/// caller can sign with any name is not an answer to "who changed my pay".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CaddieRankFeeChangeContext {
    pub changed_by: Option<String>,
    pub changed_by_name: Option<String>,
    note: Option<String>,
}

impl CaddieRankFeeChangeContext {
    pub fn try_new(
        changed_by: Option<String>,
        changed_by_name: Option<String>,
        note: Option<&str>,
    ) -> Result<Self, CourseError> {
        let note = note
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if note
            .as_deref()
            .is_some_and(|value| value.chars().count() > MAX_RANK_FEE_NOTE_CHARS)
        {
            return Err(CourseError::BadRequest(
                "the reason for the change is too long",
            ));
        }
        Ok(Self {
            changed_by,
            changed_by_name,
            note,
        })
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }
}

/// One repricing, as the history keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieRankFeeChange {
    pub id: i64,
    /// What payroll was reading just before. `None` only for the entry seeded
    /// when the history began, where nothing earlier was recorded.
    pub previous: Option<CaddieRankFees>,
    pub fees: CaddieRankFees,
    pub note: Option<String>,
    pub changed_by: Option<String>,
    pub changed_by_name: Option<String>,
    pub changed_at: DateTime<Utc>,
}

impl CaddieRankFeeChange {
    /// The ranks whose amount moved. Empty for the seeded entry, which moved
    /// nothing — it only says what was already in force.
    pub fn changed_ranks(&self) -> Vec<CaddieRank> {
        let Some(previous) = &self.previous else {
            return Vec::new();
        };
        CaddieRank::ALL
            .into_iter()
            .filter(|rank| previous.fee_for(*rank) != self.fees.fee_for(*rank))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fees() -> CaddieRankFees {
        CaddieRankFees::try_new(12_000, 11_000, 10_000, 9_000, "JPY").expect("valid table")
    }

    #[test]
    fn a_higher_rank_is_paid_more_for_the_same_round() {
        let table = fees();
        assert!(table.fee_for(CaddieRank::A) > table.fee_for(CaddieRank::D));
    }

    #[test]
    fn a_caddie_with_no_fee_of_their_own_is_paid_by_rank() {
        assert_eq!(fees().round_fee_for(CaddieRank::B, 0), 11_000);
    }

    #[test]
    fn a_caddie_hired_on_their_own_terms_keeps_that_amount() {
        // Repricing them to their rank would be a pay change nobody asked for.
        assert_eq!(fees().round_fee_for(CaddieRank::D, 15_000), 15_000);
    }

    #[test]
    fn a_negative_fee_is_refused_rather_than_clamped() {
        // Clamping to zero would look saved and pay nothing.
        assert!(CaddieRankFees::try_new(12_000, -1, 10_000, 9_000, "JPY").is_err());
    }

    #[test]
    fn an_amount_far_past_any_real_fee_is_refused() {
        assert!(CaddieRankFees::try_new(12_000_000, 11_000, 10_000, 9_000, "JPY").is_err());
    }

    #[test]
    fn a_currency_is_stored_the_way_codes_are_written() {
        let table =
            CaddieRankFees::try_new(1, 1, 1, 1, " jpy ").expect("a lowercase code is still a code");
        assert_eq!(table.currency(), "JPY");
        assert!(CaddieRankFees::try_new(1, 1, 1, 1, "  ").is_err());
    }

    #[test]
    fn a_club_that_never_opened_the_screen_still_has_a_table() {
        // A zero table would read as "this month cost nothing".
        let table = CaddieRankFees::default();
        assert!(table.fee_for(CaddieRank::C) > 0);
        assert_eq!(table.currency(), "JPY");
    }

    #[test]
    fn a_reason_is_kept_trimmed_and_a_blank_one_is_no_reason() {
        let context = CaddieRankFeeChangeContext::try_new(None, None, Some("  春の改定  "))
            .expect("a short reason");
        assert_eq!(context.note(), Some("春の改定"));
        let blank = CaddieRankFeeChangeContext::try_new(None, None, Some("   ")).expect("blank");
        assert_eq!(blank.note(), None);
    }

    #[test]
    fn a_reason_longer_than_a_paragraph_is_refused() {
        let long = "あ".repeat(MAX_RANK_FEE_NOTE_CHARS + 1);
        assert!(CaddieRankFeeChangeContext::try_new(None, None, Some(&long)).is_err());
    }

    #[test]
    fn a_change_names_only_the_ranks_whose_amount_moved() {
        let change = CaddieRankFeeChange {
            id: 1,
            previous: Some(fees()),
            fees: CaddieRankFees::try_new(13_000, 11_000, 10_000, 8_000, "JPY").unwrap(),
            note: None,
            changed_by: None,
            changed_by_name: None,
            changed_at: Utc::now(),
        };
        assert_eq!(change.changed_ranks(), vec![CaddieRank::A, CaddieRank::D]);
    }

    #[test]
    fn the_entry_the_history_began_with_moved_nothing() {
        let change = CaddieRankFeeChange {
            id: 1,
            previous: None,
            fees: fees(),
            note: None,
            changed_by: None,
            changed_by_name: None,
            changed_at: Utc::now(),
        };
        assert!(change.changed_ranks().is_empty());
    }
}
