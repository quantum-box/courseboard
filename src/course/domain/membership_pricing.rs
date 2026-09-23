//! What a membership is worth at the first tee.
//!
//! Field sells the plan; what it takes off the green fee is golf's, so it lives
//! in CourseBoard's own rows (ADR-0009). Field's membership registry carries no
//! price rule and should not — a gym's membership discounts nothing on a green
//! fee.
//!
//! **A discount, not a member's own price.** A course posts 正会員 5,000円引き
//! rather than a flat member rate, because the green fee itself already moves
//! with the day and the season: weekday, weekend, high summer. Storing an
//! absolute member fee would freeze all of that into one number and quietly
//! undo the operator's own weekday pricing.
//!
//! Taken off the green fee before tax, deliberately. The golf course tax
//! bracket is decided by the green fee, so a member paying less can fall into a
//! lower bracket — and that is the real bill, not a rounding detail.

use super::{CourseError, MembershipPlanId};

/// Percent discounts stop being discounts past this.
const MAX_PERCENT: i64 = 100;

/// How a plan takes money off the green fee.
///
/// Two shapes because courses post both, and an enum rather than two nullable
/// columns so "5,000円引き and also 30%引き" cannot be stored at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberDiscount {
    /// Yen off the green fee.
    Yen(i64),
    /// Percent off the green fee, 1–100.
    Percent(i64),
}

impl MemberDiscount {
    pub fn try_new(kind: &str, value: i64) -> Result<Self, CourseError> {
        match kind {
            "yen" => {
                if value < 0 {
                    return Err(CourseError::BadRequest(
                        "a member discount must not be negative",
                    ));
                }
                Ok(Self::Yen(value))
            }
            "percent" => {
                if !(0..=MAX_PERCENT).contains(&value) {
                    return Err(CourseError::BadRequest(
                        "a percent discount must be between 0 and 100",
                    ));
                }
                Ok(Self::Percent(value))
            }
            _ => Err(CourseError::BadRequest(
                "a member discount is either yen or percent",
            )),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Yen(_) => "yen",
            Self::Percent(_) => "percent",
        }
    }

    pub fn value(&self) -> i64 {
        match self {
            Self::Yen(value) | Self::Percent(value) => *value,
        }
    }

    /// The green fee this member actually pays.
    ///
    /// Never below zero: a discount larger than the fee makes the round free,
    /// not a refund. A negative green fee would flow into the tax bracket and
    /// the revenue projection as a negative number nobody would spot.
    pub fn apply(&self, green_fee: i64) -> i64 {
        let discounted = match self {
            Self::Yen(off) => green_fee.saturating_sub(*off),
            // Multiply before dividing, so a fee that does not divide evenly
            // loses at most a yen rather than a percent.
            Self::Percent(off) => green_fee.saturating_mul(MAX_PERCENT - off) / MAX_PERCENT,
        };
        discounted.max(0)
    }
}

/// One plan's discount, as the club configures it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MembershipDiscount {
    plan_id: MembershipPlanId,
    discount: MemberDiscount,
}

impl MembershipDiscount {
    pub fn new(plan_id: impl Into<MembershipPlanId>, discount: MemberDiscount) -> Self {
        Self {
            plan_id: plan_id.into(),
            discount,
        }
    }

    pub fn plan_id(&self) -> &MembershipPlanId {
        &self.plan_id
    }

    pub fn discount(&self) -> MemberDiscount {
        self.discount
    }
}

/// Every plan's discount, for the tenant.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MembershipDiscounts {
    discounts: Vec<MembershipDiscount>,
}

impl MembershipDiscounts {
    pub fn try_new(discounts: Vec<MembershipDiscount>) -> Result<Self, CourseError> {
        for (index, entry) in discounts.iter().enumerate() {
            if discounts[..index]
                .iter()
                .any(|other| other.plan_id == entry.plan_id)
            {
                return Err(CourseError::BadRequest(
                    "each membership may have only one discount",
                ));
            }
        }
        Ok(Self { discounts })
    }

    pub fn reconstitute(discounts: Vec<MembershipDiscount>) -> Self {
        Self { discounts }
    }

    pub fn entries(&self) -> &[MembershipDiscount] {
        &self.discounts
    }

    pub fn is_empty(&self) -> bool {
        self.discounts.is_empty()
    }

    /// What this plan takes off, or nothing.
    ///
    /// A plan with no row here discounts nothing — which is different from a
    /// plan the club has not configured yet only in that the club can tell.
    pub fn for_plan(&self, plan_id: &MembershipPlanId) -> Option<MemberDiscount> {
        self.discounts
            .iter()
            .find(|entry| &entry.plan_id == plan_id)
            .map(MembershipDiscount::discount)
    }

    /// The green fee somebody on this plan pays, or the posted fee when they
    /// are a visitor or their plan discounts nothing.
    pub fn green_fee_for(&self, green_fee: i64, plan_id: Option<&MembershipPlanId>) -> i64 {
        match plan_id.and_then(|id| self.for_plan(id)) {
            Some(discount) => discount.apply(green_fee),
            None => green_fee,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(id: &str) -> MembershipPlanId {
        MembershipPlanId::new(id)
    }

    #[test]
    fn yen_off_comes_straight_off_the_posted_fee() {
        assert_eq!(MemberDiscount::Yen(5_000).apply(15_000), 10_000);
    }

    #[test]
    fn percent_off_keeps_the_rest_of_the_fee() {
        assert_eq!(MemberDiscount::Percent(30).apply(15_000), 10_500);
    }

    #[test]
    fn a_percent_that_does_not_divide_evenly_loses_a_yen_not_a_percent() {
        // 3333 * 70 / 100 = 2333.1. Dividing first would give 33 * 70 = 2310,
        // a 23 yen error on one round and a real one across a season.
        assert_eq!(MemberDiscount::Percent(30).apply(3_333), 2_333);
    }

    #[test]
    fn a_discount_larger_than_the_fee_makes_the_round_free_rather_than_negative() {
        // A negative green fee would flow into the tax bracket and the revenue
        // projection, where nobody would spot it.
        assert_eq!(MemberDiscount::Yen(20_000).apply(15_000), 0);
        assert_eq!(MemberDiscount::Percent(100).apply(15_000), 0);
    }

    #[test]
    fn a_visitor_pays_the_posted_fee() {
        let discounts = MembershipDiscounts::try_new(vec![MembershipDiscount::new(
            plan("plan_full"),
            MemberDiscount::Yen(5_000),
        )])
        .unwrap();
        assert_eq!(discounts.green_fee_for(15_000, None), 15_000);
    }

    #[test]
    fn a_plan_with_no_discount_configured_pays_the_posted_fee() {
        // Not an error, and not a zero fee: most plans start this way.
        let discounts = MembershipDiscounts::default();
        assert_eq!(
            discounts.green_fee_for(15_000, Some(&plan("plan_full"))),
            15_000
        );
    }

    #[test]
    fn a_member_pays_their_own_plans_discount_and_not_another() {
        let discounts = MembershipDiscounts::try_new(vec![
            MembershipDiscount::new(plan("plan_full"), MemberDiscount::Yen(5_000)),
            MembershipDiscount::new(plan("plan_weekday"), MemberDiscount::Percent(20)),
        ])
        .unwrap();
        assert_eq!(
            discounts.green_fee_for(15_000, Some(&plan("plan_full"))),
            10_000
        );
        assert_eq!(
            discounts.green_fee_for(15_000, Some(&plan("plan_weekday"))),
            12_000
        );
    }

    #[test]
    fn one_plan_cannot_carry_two_discounts() {
        let entries = vec![
            MembershipDiscount::new(plan("plan_full"), MemberDiscount::Yen(5_000)),
            MembershipDiscount::new(plan("plan_full"), MemberDiscount::Percent(20)),
        ];
        assert!(MembershipDiscounts::try_new(entries).is_err());
    }

    #[test]
    fn a_negative_or_impossible_discount_is_refused() {
        assert!(MemberDiscount::try_new("yen", -1).is_err());
        assert!(MemberDiscount::try_new("percent", 101).is_err());
        assert!(MemberDiscount::try_new("percent", -1).is_err());
        assert!(MemberDiscount::try_new("free", 1).is_err());
    }
}
