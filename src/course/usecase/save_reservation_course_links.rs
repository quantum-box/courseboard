//! SaveReservationCourseLinksUseCase: reading and recording which course each
//! name in the booking system's export refers to.
//!
//! Reading and writing sit in one file because they are one decision seen from
//! two sides: the screen shows what is on file so the desk can change it, and
//! saves the whole list back.

use std::sync::Arc;

use crate::course::domain::{CourseError, ReservationCourseLink, ReservationCourseLinkGateway};

pub struct SaveReservationCourseLinksUseCase {
    links: Arc<dyn ReservationCourseLinkGateway>,
}

impl SaveReservationCourseLinksUseCase {
    pub fn new(links: Arc<dyn ReservationCourseLinkGateway>) -> Self {
        Self { links }
    }

    pub async fn list(&self, tenant_id: &str) -> Result<Vec<ReservationCourseLink>, CourseError> {
        require_tenant(tenant_id)?;
        self.links.list_course_links(tenant_id).await
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        links: &[ReservationCourseLink],
        updated_by: Option<&str>,
    ) -> Result<Vec<ReservationCourseLink>, CourseError> {
        require_tenant(tenant_id)?;
        if links.is_empty() {
            return Err(CourseError::BadRequest(
                "at least one course name is required",
            ));
        }
        self.links
            .save_course_links(tenant_id, links, updated_by)
            .await
    }
}

fn require_tenant(tenant_id: &str) -> Result<(), CourseError> {
    if tenant_id.trim().is_empty() {
        return Err(CourseError::BadRequest("tenant id is required"));
    }
    Ok(())
}
