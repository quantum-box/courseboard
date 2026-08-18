//! The [`CourseAuthorizer`] the running app uses, and the one its tests use.

use std::sync::Arc;

use async_trait::async_trait;

use crate::course::domain::{CourseAuthorizer, CourseError, GatewayCredentials};
use crate::course_authz::{CheckError, Decision, PolicyChecker};

/// Asks Tachyon Auth, through the same checker the route gate uses.
///
/// Sharing the checker is what keeps the two cheap together: an allowance the
/// gate already obtained for this bearer, tenant, and action is cached, so a
/// use case requiring the action its route was gated on does not pay for a
/// second round trip.
pub struct PolicyCourseAuthorizer {
    checker: Arc<dyn PolicyChecker>,
}

impl PolicyCourseAuthorizer {
    pub fn new(checker: Arc<dyn PolicyChecker>) -> Self {
        Self { checker }
    }
}

#[async_trait]
impl CourseAuthorizer for PolicyCourseAuthorizer {
    async fn require(
        &self,
        credentials: GatewayCredentials<'_>,
        action: &'static str,
    ) -> Result<(), CourseError> {
        let bearer = credentials
            .caller_bearer
            .strip_prefix("Bearer ")
            .unwrap_or(credentials.authorization)
            .trim();
        match self
            .checker
            .check(
                bearer,
                credentials.operator_id,
                credentials.platform_id,
                action,
            )
            .await
        {
            Ok(Decision::Allowed) => Ok(()),
            Ok(Decision::Denied) => Err(CourseError::Forbidden(action)),
            Err(CheckError::Unauthorized) => Err(CourseError::Unauthorized),
            Err(CheckError::TenantRejected) => Err(CourseError::TenantForbidden),
            // Fail closed, and as a provider error so the desk is told the
            // check could not be made rather than that they lack the right.
            Err(CheckError::Provider(message)) => Err(CourseError::Provider(message)),
        }
    }
}

/// Grants everything.
///
/// For the local development mode whose CLI JWT Tachyon Auth will not accept
/// (`COURSEBOARD_DISABLE_ACTION_AUTHZ`), and for tests that are about what a
/// use case does rather than who may run it. Never reachable in a normal
/// deployment: `build_app` only selects it when that switch is set.
pub struct AllowAllAuthorizer;

#[async_trait]
impl CourseAuthorizer for AllowAllAuthorizer {
    async fn require(
        &self,
        _credentials: GatewayCredentials<'_>,
        _action: &'static str,
    ) -> Result<(), CourseError> {
        Ok(())
    }
}

/// A borrowable allow-all, so tests can build credentials without owning one.
pub static ALLOW_ALL: AllowAllAuthorizer = AllowAllAuthorizer;
