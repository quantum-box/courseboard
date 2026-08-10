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

use crate::course::domain::{CaddieRank, CourseError};

/// A fee nobody would type on purpose. Above it, the entry is a slip — a yen
/// amount pasted where a rate belonged — and taking it would quietly commit the
/// club to paying it.
const MAX_ROUND_FEE: i64 = 1_000_000;

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
}
