//! LinkCourseResourceUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CourseId, GatewayCredentials, GolfCatalogGateway, Resource, ResourceKind,
    SaveCourseResource,
};

/// Give a course somewhere to keep its tee times.
///
/// Schedules and inventory hang off a generic reservation resource, and a
/// storefront reads back from the resource which course it sells. A course with
/// no resource can do neither, so this creates the resource and records the
/// mapping in one step rather than leaving an operator to curl both halves.
///
/// Running it twice is not a mistake and does not make a second resource: a
/// course that already has one gets it back unchanged.
pub struct LinkCourseResourceUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl LinkCourseResourceUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
    ) -> Result<Resource, CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        ensure_course_resources(
            self.catalog.as_ref(),
            credentials,
            std::slice::from_ref(course_id),
        )
        .await?
        .pop()
        .ok_or(CourseError::NotFound("course"))
    }
}

/// The resource each course books against, creating the ones that are missing.
///
/// A course only gets a resource when somebody asks for one, so the courses a
/// club added months ago and the course it added this morning are equally
/// likely to be without. Callers that need every course placeable — selling one
/// plan across several courses is the one that does — would otherwise have to
/// send the operator back to each course to press a button whose purpose the
/// screen never explains.
///
/// Resources come back in the order the courses were asked for. Field upserts
/// the mapping on `resource_code`, so a course that already has one keeps it
/// and running this twice does not split its tee times across two resources.
pub(crate) async fn ensure_course_resources(
    catalog: &dyn GolfCatalogGateway,
    credentials: GatewayCredentials<'_>,
    course_ids: &[CourseId],
) -> Result<Vec<Resource>, CourseError> {
    let mut resources = catalog.list_resources(credentials).await?;
    let mut courses = None;
    let mut resolved = Vec::with_capacity(course_ids.len());

    for course_id in course_ids {
        if let Some(existing) = canonical_resource(&resources, course_id) {
            resolved.push(existing.clone());
            continue;
        }

        // Only fetched once a course turns out to need one: the name is the
        // sole reason to ask, and most saves find every resource in place.
        if courses.is_none() {
            courses = Some(catalog.list_courses(credentials).await?);
        }
        let course = courses
            .iter()
            .flatten()
            .find(|course| course.id() == course_id)
            .ok_or(CourseError::NotFound("course"))?;

        let reservation_resource_id = catalog
            .create_reservation_resource(credentials, course.name())
            .await?;
        let saved = catalog
            .save_course_resource(
                credentials,
                SaveCourseResource {
                    // The course id is the one name for this course that never
                    // changes, so reusing it as the row's key keeps a rename
                    // from creating a second mapping.
                    resource_code: course_id.to_string(),
                    name: course.name().to_string(),
                    golf_course_id: course_id.clone(),
                    reservation_resource_id,
                },
            )
            .await?;
        resources.push(saved.clone());
        resolved.push(saved);
    }

    Ok(resolved)
}

/// The one active course resource a plan may name, if the course has it.
///
/// Matches what the canonical product writer accepts, so a course this returns
/// `None` for is exactly a course that write would have refused.
fn canonical_resource<'a>(resources: &'a [Resource], course_id: &CourseId) -> Option<&'a Resource> {
    resources
        .iter()
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .filter(|resource| resource.is_active())
        .find(|resource| resource.golf_course_id() == Some(course_id))
        .filter(|resource| resource.reservation_resource_id().is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        Course, ProductSlot, ReservationProduct, ReservationServiceId, ResourceId, UpsertCourse,
        UpsertReservationProduct,
    };

    #[derive(Default)]
    struct FakeCatalog {
        courses: Mutex<Vec<Course>>,
        resources: Mutex<Vec<Resource>>,
        created_reservation_resources: Mutex<Vec<String>>,
    }

    fn course(id: &str, name: &str) -> Course {
        Course::reconstitute(
            id,
            name,
            None,
            18,
            "Asia/Tokyo",
            8,
            true,
            None,
            None,
            None,
            None,
        )
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok(crate::course::domain::DEFAULT_TIMEZONE.to_string())
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<crate::course::domain::CourseOrder, CourseError> {
            Ok(crate::course::domain::CourseOrder::default())
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            order: &crate::course::domain::CourseOrder,
        ) -> Result<crate::course::domain::CourseOrder, CourseError> {
            Ok(order.clone())
        }

        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            Ok(self.courses.lock().expect("lock").clone())
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(self.resources.lock().expect("lock").clone())
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            name: &str,
        ) -> Result<ResourceId, CourseError> {
            let mut created = self.created_reservation_resources.lock().expect("lock");
            created.push(name.to_string());
            Ok(ResourceId::new(format!("rsrc_{}", created.len())))
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            let resource = Resource::reconstitute(
                format!("golfres_{}", input.resource_code),
                input.name,
                Some(input.reservation_resource_id.to_string()),
                Some(input.golf_course_id.to_string()),
                ResourceKind::Course,
                true,
            );
            self.resources.lock().expect("lock").push(resource.clone());
            Ok(resource)
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            Ok(Vec::new())
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn list_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            Ok(Vec::new())
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            Ok(Vec::new())
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer t",
            operator_id: "scc",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    #[tokio::test]
    async fn linking_a_course_gives_it_a_resource_that_names_it_back() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![course("golfcrs_out", "OUTコース")]),
            ..FakeCatalog::default()
        });
        let resource = LinkCourseResourceUseCase::new(catalog.clone())
            .execute(credentials(), &CourseId::new("golfcrs_out"))
            .await
            .expect("link");

        assert_eq!(
            resource
                .golf_course_id()
                .map(ToString::to_string)
                .as_deref(),
            Some("golfcrs_out")
        );
        assert_eq!(
            resource
                .reservation_resource_id()
                .map(ToString::to_string)
                .as_deref(),
            Some("rsrc_1")
        );
        assert_eq!(
            *catalog.created_reservation_resources.lock().expect("lock"),
            vec!["OUTコース".to_string()]
        );
    }

    /// Pressing the button twice must not leave the course with two resources
    /// splitting its tee times.
    #[tokio::test]
    async fn a_course_that_already_has_a_resource_keeps_it() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![course("golfcrs_in", "INコース")]),
            resources: Mutex::new(vec![Resource::reconstitute(
                "golfres_in",
                "INコース",
                Some("rsrc_existing".into()),
                Some("golfcrs_in".into()),
                ResourceKind::Course,
                true,
            )]),
            ..FakeCatalog::default()
        });
        let resource = LinkCourseResourceUseCase::new(catalog.clone())
            .execute(credentials(), &CourseId::new("golfcrs_in"))
            .await
            .expect("link");

        assert_eq!(
            resource
                .reservation_resource_id()
                .map(ToString::to_string)
                .as_deref(),
            Some("rsrc_existing")
        );
        assert!(catalog
            .created_reservation_resources
            .lock()
            .expect("lock")
            .is_empty());
    }

    /// A mapping row someone made without a resource is half a link, and
    /// leaving it that way is what the schedule page fails on.
    #[tokio::test]
    async fn a_mapping_with_no_resource_yet_is_completed() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![course("golfcrs_in", "INコース")]),
            resources: Mutex::new(vec![Resource::reconstitute(
                "golfres_in",
                "INコース",
                None,
                Some("golfcrs_in".into()),
                ResourceKind::Course,
                true,
            )]),
            ..FakeCatalog::default()
        });
        let resource = LinkCourseResourceUseCase::new(catalog)
            .execute(credentials(), &CourseId::new("golfcrs_in"))
            .await
            .expect("link");

        assert_eq!(
            resource
                .reservation_resource_id()
                .map(ToString::to_string)
                .as_deref(),
            Some("rsrc_1")
        );
    }

    #[tokio::test]
    async fn a_course_this_tenant_does_not_have_is_not_found() {
        let catalog = Arc::new(FakeCatalog::default());
        let error = LinkCourseResourceUseCase::new(catalog)
            .execute(credentials(), &CourseId::new("golfcrs_ghost"))
            .await
            .unwrap_err();
        assert!(matches!(error, CourseError::NotFound(_)));
    }
}
