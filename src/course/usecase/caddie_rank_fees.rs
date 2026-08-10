//! Reading and setting what a round pays at each rank.
//!
//! Two use cases, one public entrypoint each. Both are thin: the table is a
//! value object that validates itself, and the gateway does the read-modify-
//! write against the shared extension config.

use std::sync::Arc;

use crate::course::domain::{CaddieRankFees, CourseError, GatewayCredentials, GolfOpsGateway};

pub struct GetCaddieRankFeesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetCaddieRankFeesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieRankFees, CourseError> {
        self.ops.get_caddie_rank_fees(credentials).await
    }
}

pub struct ReplaceCaddieRankFeesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ReplaceCaddieRankFeesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        fees: CaddieRankFees,
    ) -> Result<CaddieRankFees, CourseError> {
        self.ops.replace_caddie_rank_fees(credentials, &fees).await
    }
}
