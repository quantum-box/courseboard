//! ListResourcesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{CourseError, GatewayCredentials, GolfCatalogGateway, Resource};

pub struct ListResourcesUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListResourcesUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Resource>, CourseError> {
        self.catalog.list_resources(credentials).await
    }
}
