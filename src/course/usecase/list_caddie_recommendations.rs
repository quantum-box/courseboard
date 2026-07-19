//! ListCaddieRecommendationsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CaddieRecommendation, CourseError, GatewayCredentials, GolfOpsGateway, RecommendationQuery,
};

pub struct ListCaddieRecommendationsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddieRecommendationsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: RecommendationQuery,
    ) -> Result<Vec<CaddieRecommendation>, CourseError> {
        self.ops
            .list_caddie_recommendations(credentials, query)
            .await
    }
}
