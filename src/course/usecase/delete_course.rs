//! DeleteCourseUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{CourseError, CourseId, GatewayCredentials, GolfCatalogGateway};

pub struct DeleteCourseUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl DeleteCourseUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
    ) -> Result<(), CourseError> {
        self.catalog.delete_course(credentials, course_id).await
    }
}
