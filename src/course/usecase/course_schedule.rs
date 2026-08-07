//! Reading, replacing, and materializing a course's weekly opening schedule.
//!
//! Field addresses schedules by generic resource. A golf course reaches one
//! through `golf_course_resources`, so every case here starts by resolving the
//! course to its resource and fails loudly when that mapping is missing —
//! writing a schedule onto the wrong resource would sell another course's tee
//! times.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    AvailabilityRule, CourseError, CourseId, GatewayCredentials, GenerationSummary,
    GolfCatalogGateway, ReservationScheduleGateway, ResourceId, ResourceKind,
};

/// Longest span one generate call may cover.
///
/// A year of 8-minute tee times is six figures of rows; the cap keeps a typo in
/// the date range from turning into a very long write.
const MAX_GENERATION_DAYS: i64 = 400;

async fn resolve_resource(
    catalog: &Arc<dyn GolfCatalogGateway>,
    credentials: GatewayCredentials<'_>,
    course_id: &CourseId,
) -> Result<ResourceId, CourseError> {
    let resources = catalog.list_resources(credentials).await?;
    resources
        .into_iter()
        .filter(|resource| resource.is_active())
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .find(|resource| resource.golf_course_id() == Some(course_id))
        .map(|resource| {
            resource
                .reservation_resource_id()
                .cloned()
                .unwrap_or_else(|| resource.id().clone())
        })
        .ok_or(CourseError::BadRequest(
            "this course is not linked to a reservation resource yet",
        ))
}

pub struct GetCourseScheduleUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl GetCourseScheduleUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self { catalog, schedules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
    ) -> Result<Vec<AvailabilityRule>, CourseError> {
        let resource_id = resolve_resource(&self.catalog, credentials, course_id).await?;
        self.schedules
            .get_resource_schedule(credentials, &resource_id)
            .await
    }
}

pub struct ReplaceCourseScheduleUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl ReplaceCourseScheduleUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self { catalog, schedules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        rules: Vec<AvailabilityRule>,
    ) -> Result<Vec<AvailabilityRule>, CourseError> {
        reject_overlaps(&rules)?;
        let courses = self.catalog.list_courses(credentials).await?;
        let course = courses
            .iter()
            .find(|course| course.id() == course_id)
            .ok_or(CourseError::NotFound("course"))?;
        let timezone = course.timezone().to_string();
        let resource_id = resolve_resource(&self.catalog, credentials, course_id).await?;
        self.schedules
            .replace_resource_schedule(credentials, &resource_id, &timezone, &rules)
            .await
    }
}

/// Two bands on one weekday that overlap would generate the same tee time
/// twice, and the second row would silently win on Field's uniqueness key.
fn reject_overlaps(rules: &[AvailabilityRule]) -> Result<(), CourseError> {
    let mut sorted: Vec<&AvailabilityRule> = rules.iter().collect();
    sorted.sort_by(|left, right| {
        left.weekday()
            .cmp(&right.weekday())
            .then_with(|| left.start_time().cmp(right.start_time()))
    });

    for pair in sorted.windows(2) {
        let (earlier, later) = (pair[0], pair[1]);
        if earlier.weekday() == later.weekday() && later.start_time() < earlier.end_time() {
            return Err(CourseError::BadRequest(
                "two bands on the same weekday overlap",
            ));
        }
    }
    Ok(())
}

pub struct GenerateCourseTimeSlotsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl GenerateCourseTimeSlotsUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self { catalog, schedules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        from: NaiveDate,
        to: NaiveDate,
        dry_run: bool,
    ) -> Result<GenerationSummary, CourseError> {
        if to < from {
            return Err(CourseError::BadRequest(
                "the end of the range must not be before its start",
            ));
        }
        if (to - from).num_days() >= MAX_GENERATION_DAYS {
            return Err(CourseError::BadRequest(
                "generate at most 400 days at a time",
            ));
        }
        let resource_id = resolve_resource(&self.catalog, credentials, course_id).await?;
        self.schedules
            .generate_resource_time_slots(credentials, &resource_id, from, to, dry_run)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(weekday: u8, start: &str, end: &str) -> AvailabilityRule {
        AvailabilityRule::try_new(None, weekday, start, end, 4, 8).expect("valid rule")
    }

    #[test]
    fn bands_that_touch_end_to_start_are_allowed() {
        // 07:00-12:00 followed by 12:00-15:00 is the ordinary morning/afternoon
        // split, not an overlap.
        let rules = vec![rule(1, "07:00", "12:00"), rule(1, "12:00", "15:00")];
        assert!(reject_overlaps(&rules).is_ok());
    }

    #[test]
    fn bands_that_overlap_on_one_weekday_are_refused() {
        let rules = vec![rule(1, "07:00", "12:00"), rule(1, "11:00", "15:00")];
        assert!(reject_overlaps(&rules).is_err());
    }

    #[test]
    fn the_same_band_on_two_weekdays_is_not_an_overlap() {
        let rules = vec![rule(1, "07:00", "12:00"), rule(2, "07:00", "12:00")];
        assert!(reject_overlaps(&rules).is_ok());
    }

    #[test]
    fn overlaps_are_found_regardless_of_the_order_they_arrive_in() {
        let rules = vec![rule(1, "11:00", "15:00"), rule(1, "07:00", "12:00")];
        assert!(reject_overlaps(&rules).is_err());
    }
}
