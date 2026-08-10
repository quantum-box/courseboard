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
        courses
            .iter()
            .find(|course| course.id() == course_id)
            .ok_or(CourseError::NotFound("course"))?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
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
    use async_trait::async_trait;
    use chrono::{DateTime, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        Course, CourseOrder, ProductSlot, ReservationProduct, ReservationServiceId, Resource,
        ResourceTimeSlot, SaveCourseResource, UpsertCourse, UpsertReservationProduct,
    };

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

    struct FakeCatalog {
        tenant_timezone: String,
        courses: Vec<Course>,
        resources: Vec<Resource>,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok(self.tenant_timezone.clone())
        }

        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            Ok(self.courses.clone())
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used")
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(self.resources.clone())
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<ResourceId, CourseError> {
            unimplemented!("not used")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unimplemented!("not used")
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            _order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used")
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            unimplemented!("not used")
        }

        async fn list_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used")
        }
    }

    #[derive(Default)]
    struct FakeSchedules {
        timezone_used: Mutex<Option<String>>,
    }

    #[async_trait]
    impl ReservationScheduleGateway for FakeSchedules {
        async fn get_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            timezone: &str,
            rules: &[AvailabilityRule],
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            *self.timezone_used.lock().expect("lock") = Some(timezone.to_string());
            Ok(rules.to_vec())
        }

        async fn generate_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _from: NaiveDate,
            _to: NaiveDate,
            _dry_run: bool,
        ) -> Result<GenerationSummary, CourseError> {
            unimplemented!("not used")
        }

        async fn list_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _from: DateTime<Utc>,
            _to: DateTime<Utc>,
        ) -> Result<Vec<ResourceTimeSlot>, CourseError> {
            unimplemented!("not used")
        }
    }

    #[tokio::test]
    async fn replace_schedule_uses_tenant_timezone_even_when_course_value_differs() {
        let course_id = CourseId::new("course-east");
        let catalog = Arc::new(FakeCatalog {
            tenant_timezone: "Europe/Berlin".into(),
            courses: vec![Course::reconstitute(
                course_id.clone(),
                "East",
                None,
                18,
                "America/New_York",
                8,
                true,
                None,
                None,
                None,
                None,
            )],
            resources: vec![Resource::reconstitute(
                "golf-resource-east",
                "East",
                Some("reservation-resource-east".into()),
                Some(course_id.to_string()),
                ResourceKind::Course,
                true,
            )],
        });
        let schedules = Arc::new(FakeSchedules::default());
        let use_case = ReplaceCourseScheduleUseCase::new(catalog, schedules.clone());

        use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "tenant-test",
                    platform_id: None,
                },
                &course_id,
                vec![rule(1, "07:00", "12:00")],
            )
            .await
            .expect("replace schedule");

        assert_eq!(
            schedules.timezone_used.lock().expect("lock").as_deref(),
            Some("Europe/Berlin")
        );
    }
}
