//! Membership use cases: the plans a course sells, and where one customer
//! stands against them.
//!
//! Grouped in one file because they are one operation seen from two ends — the
//! settings screen configures the plans, the desk reads and grants them — and
//! splitting them would put the same gateway behind four near-identical
//! wrappers.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    AssignMembershipPlan, CourseError, CustomerId, CustomerMembership, GatewayCredentials,
    MembershipGateway, MembershipPlan, MembershipPlanId, SetMemberNumber, UpsertMembershipPlan,
};

pub struct ListMembershipPlansUseCase {
    memberships: Arc<dyn MembershipGateway>,
}

impl ListMembershipPlansUseCase {
    pub fn new(memberships: Arc<dyn MembershipGateway>) -> Self {
        Self { memberships }
    }

    /// `include_inactive` is for the settings screen, which has to show a
    /// retired plan to bring it back. The desk's own screens ask without it,
    /// so a plan the course stopped selling is not offered on a new booking.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        include_inactive: bool,
    ) -> Result<Vec<MembershipPlan>, CourseError> {
        credentials.require(actions::LIST_MEMBERSHIP).await?;
        self.memberships
            .list_membership_plans(credentials, include_inactive)
            .await
    }
}

pub struct CreateMembershipPlanUseCase {
    memberships: Arc<dyn MembershipGateway>,
}

impl CreateMembershipPlanUseCase {
    pub fn new(memberships: Arc<dyn MembershipGateway>) -> Self {
        Self { memberships }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertMembershipPlan,
    ) -> Result<MembershipPlan, CourseError> {
        credentials
            .require(actions::MANAGE_MEMBERSHIP_PLANS)
            .await?;
        self.memberships
            .create_membership_plan(credentials, &input)
            .await
    }
}

pub struct UpdateMembershipPlanUseCase {
    memberships: Arc<dyn MembershipGateway>,
}

impl UpdateMembershipPlanUseCase {
    pub fn new(memberships: Arc<dyn MembershipGateway>) -> Self {
        Self { memberships }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        plan_id: &MembershipPlanId,
        input: UpsertMembershipPlan,
    ) -> Result<MembershipPlan, CourseError> {
        credentials
            .require(actions::MANAGE_MEMBERSHIP_PLANS)
            .await?;
        self.memberships
            .update_membership_plan(credentials, plan_id, &input)
            .await
    }
}

pub struct GetCustomerMembershipUseCase {
    memberships: Arc<dyn MembershipGateway>,
}

impl GetCustomerMembershipUseCase {
    pub fn new(memberships: Arc<dyn MembershipGateway>) -> Self {
        Self { memberships }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<CustomerMembership, CourseError> {
        credentials.require(actions::LIST_MEMBERSHIP).await?;
        self.memberships
            .get_customer_membership(credentials, customer_id)
            .await
    }
}

pub struct AssignMembershipPlanUseCase {
    memberships: Arc<dyn MembershipGateway>,
}

impl AssignMembershipPlanUseCase {
    pub fn new(memberships: Arc<dyn MembershipGateway>) -> Self {
        Self { memberships }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: AssignMembershipPlan,
    ) -> Result<CustomerMembership, CourseError> {
        credentials.require(actions::ASSIGN_MEMBERSHIP).await?;
        self.memberships
            .assign_membership_plan(credentials, &input)
            .await
    }
}

/// Recording, changing, or withdrawing a member's number.
///
/// Guarded by the same action as granting a plan: both are the desk saying
/// something official about somebody's standing with the club.
pub struct SetMemberNumberUseCase {
    memberships: Arc<dyn MembershipGateway>,
}

impl SetMemberNumberUseCase {
    pub fn new(memberships: Arc<dyn MembershipGateway>) -> Self {
        Self { memberships }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: SetMemberNumber,
    ) -> Result<CustomerMembership, CourseError> {
        credentials.require(actions::ASSIGN_MEMBERSHIP).await?;
        self.memberships
            .set_member_number(credentials, &input)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    #[derive(Default)]
    struct StubMemberships {
        plans: Vec<MembershipPlan>,
        assigned: Mutex<Vec<AssignMembershipPlan>>,
        listed_including_inactive: Mutex<Vec<bool>>,
        numbered: Mutex<Vec<SetMemberNumber>>,
    }

    #[async_trait]
    impl MembershipGateway for StubMemberships {
        async fn set_member_number(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: &SetMemberNumber,
        ) -> Result<CustomerMembership, CourseError> {
            self.numbered.lock().unwrap().push(input.clone());
            Ok(CustomerMembership::visitor(input.customer_id.clone())
                .with_member_number(input.member_number.clone()))
        }

        async fn list_membership_plans(
            &self,
            _credentials: GatewayCredentials<'_>,
            include_inactive: bool,
        ) -> Result<Vec<MembershipPlan>, CourseError> {
            self.listed_including_inactive
                .lock()
                .unwrap()
                .push(include_inactive);
            Ok(self.plans.clone())
        }

        async fn create_membership_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &UpsertMembershipPlan,
        ) -> Result<MembershipPlan, CourseError> {
            unreachable!("not used by this test")
        }

        async fn update_membership_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _plan_id: &MembershipPlanId,
            _input: &UpsertMembershipPlan,
        ) -> Result<MembershipPlan, CourseError> {
            unreachable!("not used by this test")
        }

        async fn get_customer_membership(
            &self,
            _credentials: GatewayCredentials<'_>,
            customer_id: &CustomerId,
        ) -> Result<CustomerMembership, CourseError> {
            Ok(CustomerMembership::visitor(customer_id.clone()))
        }

        async fn assign_membership_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: &AssignMembershipPlan,
        ) -> Result<CustomerMembership, CourseError> {
            self.assigned.lock().unwrap().push(input.clone());
            Ok(CustomerMembership::reconstitute(
                input.customer_id.clone(),
                self.plans.first().cloned(),
                input.started_on.clone(),
            ))
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    fn plan() -> MembershipPlan {
        MembershipPlan::reconstitute("plan_1", "正会員", None, Some(120_000), None, true, 0)
    }

    #[tokio::test]
    async fn the_desk_is_not_offered_plans_the_course_stopped_selling() {
        let gateway = Arc::new(StubMemberships {
            plans: vec![plan()],
            ..StubMemberships::default()
        });
        ListMembershipPlansUseCase::new(gateway.clone())
            .execute(credentials(), false)
            .await
            .unwrap();
        assert_eq!(
            *gateway.listed_including_inactive.lock().unwrap(),
            vec![false]
        );
    }

    #[tokio::test]
    async fn a_customer_nobody_has_granted_a_membership_reads_as_a_visitor() {
        let gateway = Arc::new(StubMemberships::default());
        let membership = GetCustomerMembershipUseCase::new(gateway)
            .execute(credentials(), &CustomerId::new("cus_1"))
            .await
            .unwrap();
        assert!(!membership.is_member());
    }

    #[tokio::test]
    async fn granting_a_plan_answers_with_the_membership_as_it_now_stands() {
        let gateway = Arc::new(StubMemberships {
            plans: vec![plan()],
            ..StubMemberships::default()
        });
        let membership = AssignMembershipPlanUseCase::new(gateway.clone())
            .execute(
                credentials(),
                AssignMembershipPlan::try_new(
                    CustomerId::new("cus_1"),
                    MembershipPlanId::new("plan_1"),
                    Some("2026-04-01".into()),
                    None,
                )
                .unwrap(),
            )
            .await
            .unwrap();
        assert!(membership.is_member());
        assert_eq!(membership.plan_name(), Some("正会員"));
        assert_eq!(gateway.assigned.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_member_number_reaches_the_registry_trimmed() {
        let gateway = Arc::new(StubMemberships::default());
        let membership = SetMemberNumberUseCase::new(gateway.clone())
            .execute(
                credentials(),
                SetMemberNumber::try_new(CustomerId::new("cus_1"), Some("  A-1024  ".into()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(membership.member_number(), Some("A-1024"));
        assert_eq!(
            gateway.numbered.lock().unwrap()[0].member_number.as_deref(),
            Some("A-1024")
        );
    }

    #[tokio::test]
    async fn a_blank_member_number_withdraws_it_rather_than_storing_an_empty_string() {
        // A member numbered by mistake has to be un-numbered, and an empty
        // string on file reads as a member whose number is blank.
        let gateway = Arc::new(StubMemberships::default());
        let membership = SetMemberNumberUseCase::new(gateway.clone())
            .execute(
                credentials(),
                SetMemberNumber::try_new(CustomerId::new("cus_1"), Some("   ".into())).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(membership.member_number(), None);
        assert_eq!(gateway.numbered.lock().unwrap()[0].member_number, None);
    }

    #[test]
    fn a_member_number_longer_than_a_number_is_refused() {
        let long = "9".repeat(41);
        assert!(SetMemberNumber::try_new(CustomerId::new("cus_1"), Some(long)).is_err());
    }
}
