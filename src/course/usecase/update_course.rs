//! UpdateCourseUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    Course, CourseError, CourseId, GatewayCredentials, GolfCatalogGateway, UpsertCourse,
};

pub struct UpdateCourseUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl UpdateCourseUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        input: UpsertCourse,
    ) -> Result<Course, CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        self.catalog
            .update_course(credentials, course_id, input)
            .await
    }
}
