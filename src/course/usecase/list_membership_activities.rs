//! List the Field-owned membership activity feed for one customer.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerId, GatewayCredentials, MembershipActivityGateway, MembershipActivityPage,
    MembershipActivityQuery,
};

pub struct ListMembershipActivitiesUseCase {
    activities: Arc<dyn MembershipActivityGateway>,
}

impl ListMembershipActivitiesUseCase {
    pub fn new(activities: Arc<dyn MembershipActivityGateway>) -> Self {
        Self { activities }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        query: MembershipActivityQuery,
    ) -> Result<MembershipActivityPage, CourseError> {
        credentials.require(actions::LIST_MEMBERSHIP).await?;
        self.activities
            .list_membership_activities(credentials, customer_id, &query)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::Utc;

    use crate::course::domain::actions;
    use crate::course::domain::{
        MembershipActivity, MembershipActivityActor, MembershipActivitySource,
        MembershipActivityTarget,
    };

    struct Stub {
        page: MembershipActivityPage,
    }

    #[async_trait]
    impl MembershipActivityGateway for Stub {
        async fn list_membership_activities(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &CustomerId,
            _query: &MembershipActivityQuery,
        ) -> Result<MembershipActivityPage, CourseError> {
            Ok(self.page.clone())
        }
    }

    struct Deny;

    #[async_trait]
    impl crate::course::domain::CourseAuthorizer for Deny {
        async fn require(
            &self,
            _credentials: GatewayCredentials<'_>,
            action: &'static str,
        ) -> Result<(), CourseError> {
            Err(CourseError::Forbidden(action))
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer token",
            operator_id: "tenant-1",
            platform_id: Some("prod"),
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    #[tokio::test]
    async fn returns_the_provider_page_unchanged() {
        let page = MembershipActivityPage {
            items: vec![MembershipActivity {
                id: "mact_1".into(),
                kind: "membership.future_event".into(),
                occurred_at: Utc::now(),
                actor: MembershipActivityActor {
                    kind: "user".into(),
                    id: "u_1".into(),
                },
                source: Some(MembershipActivitySource {
                    channel: Some("store".into()),
                    application: None,
                }),
                target: Some(MembershipActivityTarget {
                    kind: "customer".into(),
                    id: Some("cus_1".into()),
                }),
                before: None,
                after: Some(serde_json::json!({ "x": true })),
                schema_version: 1,
            }],
            next_cursor: Some("next".into()),
        };
        let usecase = ListMembershipActivitiesUseCase::new(Arc::new(Stub { page: page.clone() }));
        let actual = usecase
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                MembershipActivityQuery::try_new(Some(5), None).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(actual, page);
    }

    #[tokio::test]
    async fn requires_list_membership_before_calling_the_gateway() {
        let page = MembershipActivityPage {
            items: Vec::new(),
            next_cursor: None,
        };
        let usecase = ListMembershipActivitiesUseCase::new(Arc::new(Stub { page }));
        let authorizer = Deny;
        let credentials = GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer token",
            operator_id: "tenant-1",
            platform_id: Some("prod"),
            authorizer: &authorizer,
        };
        let error = usecase
            .execute(
                credentials,
                &CustomerId::new("cus_1"),
                MembershipActivityQuery::try_new(Some(5), None).unwrap(),
            )
            .await
            .expect_err("denied activity list");
        assert!(matches!(
            error,
            CourseError::Forbidden(actions::LIST_MEMBERSHIP)
        ));
    }
}
