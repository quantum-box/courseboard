//! ListCoursesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{Course, CourseError, GatewayCredentials, GolfCatalogGateway};

pub struct ListCoursesUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListCoursesUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Course>, CourseError> {
        credentials.require(actions::LIST_COURSES).await?;
        self.catalog.list_courses(credentials).await
    }
}
