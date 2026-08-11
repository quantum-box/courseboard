//! What makes someone a member rather than a visitor.
//!
//! Field keeps a generic membership registry: plans, and assignments of a
//! customer to a plan. It carries no golf in it, and it should not — a clinic
//! and a gym want the same two tables (ADR-0005).
//!
//! The golf meaning is here, and it is one sentence: **someone holding an
//! active plan assignment is a member, and everyone else is a visitor.** That
//! is a CourseBoard judgement about Field's generic data, not a column Field
//! stores. It also means a visitor is not a lesser record — both are the same
//! customer, and the ledger has to hold the visitor just as firmly, because the
//! visitor is the one nobody would otherwise write down.
//!
//! What a course calls its plans (正会員, 平日会員, 株主会員, 法人会員, …) stays
//! free text. Every club invents its own set, and an enum here would reject the
//! next one they think of — the same reasoning as the player tag on the ledger.
//!
//! Plans are configured per tenant, not per course: a club with an east and a
//! west course sells one membership across both, and splitting the plans by
//! course would make someone a member of one half of their own club.

use derive_getters::Getters;

use super::{CourseError, CustomerId, MembershipPlanId};

const MAX_TEXT_LENGTH: usize = 120;

/// A membership a course sells, as the desk configures it.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct MembershipPlan {
    #[getter(skip)]
    id: MembershipPlanId,
    #[getter(skip)]
    name: String,
    #[getter(skip)]
    description: Option<String>,
    /// Annual fee in yen, when the course records one here.
    #[getter(copy)]
    fee_jpy: Option<i64>,
    /// How long one assignment runs. `None` means it does not expire on its own.
    #[getter(copy)]
    valid_days: Option<i32>,
    #[getter(copy)]
    active: bool,
    #[getter(copy)]
    sort_order: i32,
}

impl MembershipPlan {
    pub fn reconstitute(
        id: impl Into<MembershipPlanId>,
        name: impl Into<String>,
        description: Option<String>,
        fee_jpy: Option<i64>,
        valid_days: Option<i32>,
        active: bool,
        sort_order: i32,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description,
            fee_jpy,
            valid_days,
            active,
            sort_order,
        }
    }

    pub fn id(&self) -> &MembershipPlanId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }
}

/// A plan the desk is adding or editing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsertMembershipPlan {
    pub name: String,
    pub description: Option<String>,
    pub fee_jpy: Option<i64>,
    pub valid_days: Option<i32>,
    pub sort_order: Option<i32>,
    /// Only meaningful on an update; a new plan is always created active.
    pub active: Option<bool>,
}

impl UpsertMembershipPlan {
    pub fn try_new(
        name: impl Into<String>,
        description: Option<String>,
        fee_jpy: Option<i64>,
        valid_days: Option<i32>,
        sort_order: Option<i32>,
        active: Option<bool>,
    ) -> Result<Self, CourseError> {
        let name = name.into();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CourseError::BadRequest("plan name is required"));
        }
        if trimmed.chars().count() > MAX_TEXT_LENGTH {
            return Err(CourseError::BadRequest(
                "text must be at most 120 characters",
            ));
        }
        if fee_jpy.is_some_and(|value| value < 0) {
            return Err(CourseError::BadRequest("plan fee must not be negative"));
        }
        // Zero days is a membership that expires the moment it is granted,
        // which is never what the desk means and reads as "no expiry" once
        // stored. Refuse it rather than store a plan nobody can use.
        if valid_days.is_some_and(|value| value <= 0) {
            return Err(CourseError::BadRequest("plan validity must be positive"));
        }
        Ok(Self {
            name: trimmed.to_string(),
            description: normalize_optional(description)?,
            fee_jpy,
            valid_days,
            sort_order,
            active,
        })
    }
}

/// Where a customer stands with the course today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerMembership {
    customer_id: CustomerId,
    /// The plan behind the active assignment, when there is one.
    plan: Option<MembershipPlan>,
    /// When the current membership started, as Field recorded it.
    started_on: Option<String>,
}

impl CustomerMembership {
    pub fn reconstitute(
        customer_id: impl Into<CustomerId>,
        plan: Option<MembershipPlan>,
        started_on: Option<String>,
    ) -> Self {
        Self {
            customer_id: customer_id.into(),
            plan,
            started_on,
        }
    }

    /// Nobody has an assignment, so this customer is a visitor.
    pub fn visitor(customer_id: impl Into<CustomerId>) -> Self {
        Self::reconstitute(customer_id, None, None)
    }

    pub fn customer_id(&self) -> &CustomerId {
        &self.customer_id
    }

    pub fn plan(&self) -> Option<&MembershipPlan> {
        self.plan.as_ref()
    }

    pub fn started_on(&self) -> Option<&str> {
        self.started_on.as_deref()
    }

    /// The whole golf judgement, in one place.
    ///
    /// Everything golf-side that asks "member or visitor" has to come through
    /// here rather than testing for a plan itself, so the answer stays one
    /// decision when the rule grows (a lapsed assignment, a plan on hold).
    pub fn is_member(&self) -> bool {
        self.plan.is_some()
    }

    /// What the ledger prints beside the name, or `None` for a visitor — the
    /// caller decides how to word "not a member" in the operator's language.
    pub fn plan_name(&self) -> Option<&str> {
        self.plan.as_ref().map(MembershipPlan::name)
    }
}

/// Granting a customer a membership.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignMembershipPlan {
    pub customer_id: CustomerId,
    pub plan_id: MembershipPlanId,
    /// `YYYY-MM-DD`. Absent means Field dates it today.
    pub started_on: Option<String>,
    pub note: Option<String>,
}

impl AssignMembershipPlan {
    pub fn try_new(
        customer_id: CustomerId,
        plan_id: MembershipPlanId,
        started_on: Option<String>,
        note: Option<String>,
    ) -> Result<Self, CourseError> {
        let started_on = normalize_optional(started_on)?;
        if let Some(value) = started_on.as_deref() {
            // Field answers 400 for a malformed date; catching it here keeps
            // the desk's mistake a plain message instead of an upstream 424.
            if chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() {
                return Err(CourseError::BadRequest(
                    "start date must be a YYYY-MM-DD date",
                ));
            }
        }
        Ok(Self {
            customer_id,
            plan_id,
            started_on,
            note: normalize_optional(note)?,
        })
    }
}

fn normalize_optional(value: Option<String>) -> Result<Option<String>, CourseError> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_TEXT_LENGTH {
        return Err(CourseError::BadRequest(
            "text must be at most 120 characters",
        ));
    }
    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> MembershipPlan {
        MembershipPlan::reconstitute("plan_1", "正会員", None, Some(120_000), None, true, 0)
    }

    #[test]
    fn holding_a_plan_is_what_makes_someone_a_member() {
        let member =
            CustomerMembership::reconstitute("cus_1", Some(plan()), Some("2026-04-01".to_string()));
        assert!(member.is_member());
        assert_eq!(member.plan_name(), Some("正会員"));
    }

    #[test]
    fn a_customer_with_no_plan_is_a_visitor_rather_than_an_incomplete_record() {
        let visitor = CustomerMembership::visitor("cus_2");
        assert!(!visitor.is_member());
        assert_eq!(visitor.plan_name(), None);
        assert_eq!(visitor.customer_id(), &CustomerId::new("cus_2"));
    }

    #[test]
    fn a_plan_must_actually_be_named() {
        assert!(UpsertMembershipPlan::try_new("  ", None, None, None, None, None).is_err());
    }

    #[test]
    fn a_membership_that_expires_the_day_it_starts_is_refused() {
        assert!(UpsertMembershipPlan::try_new("正会員", None, None, Some(0), None, None).is_err());
        assert!(UpsertMembershipPlan::try_new("正会員", None, None, Some(-1), None, None).is_err());
        assert!(UpsertMembershipPlan::try_new("正会員", None, None, Some(365), None, None).is_ok());
    }

    #[test]
    fn a_negative_fee_is_a_typo_rather_than_a_discount() {
        assert!(UpsertMembershipPlan::try_new("正会員", None, Some(-1), None, None, None).is_err());
    }

    #[test]
    fn a_start_date_the_desk_mistyped_is_refused_here_rather_than_upstream() {
        let assignment = AssignMembershipPlan::try_new(
            CustomerId::new("cus_1"),
            MembershipPlanId::new("plan_1"),
            Some("2026/04/01".into()),
            None,
        );
        assert!(assignment.is_err());
    }

    #[test]
    fn an_assignment_with_no_start_date_leaves_the_dating_to_field() {
        let assignment = AssignMembershipPlan::try_new(
            CustomerId::new("cus_1"),
            MembershipPlanId::new("plan_1"),
            Some("   ".into()),
            None,
        )
        .unwrap();
        assert_eq!(assignment.started_on, None);
    }
}
