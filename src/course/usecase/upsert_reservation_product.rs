//! UpsertReservationProductUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, ReservationProduct,
    UpsertReservationProduct,
};

use super::link_course_resource::ensure_course_resources;

pub struct UpsertReservationProductUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl UpsertReservationProductUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertReservationProduct,
    ) -> Result<ReservationProduct, CourseError> {
        // Selling one plan on several courses stores the resources Field places
        // reservations on, and a course only gets a resource when somebody asks
        // for one. Asking here is that somebody: the operator picked the course
        // on the plan, which is the whole of what they mean, and refusing the
        // save until they visit each course's tee-sheet screen makes them learn
        // a piece of Field's model to say it.
        //
        // A plan on one course keeps the legacy shape and needs nothing, so
        // tenants with no resources at all still save exactly as before.
        if input.golf_course_ids().len() > 1 {
            ensure_course_resources(self.catalog.as_ref(), credentials, input.golf_course_ids())
                .await?;
        }

        self.catalog
            .upsert_reservation_product(credentials, input)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        Course, CourseId, CourseOrder, PlayType, ProductSlot, ReservationServiceId, Resource,
        ResourceId, ResourceKind, SaveCourseResource, UpsertCourse, DEFAULT_TIMEZONE,
    };

    #[derive(Default)]
    struct FakeCatalog {
        courses: Mutex<Vec<Course>>,
        resources: Mutex<Vec<Resource>>,
        created_reservation_resources: Mutex<Vec<String>>,
        saved_course_ids: Mutex<Vec<String>>,
    }

    fn course(id: &str, name: &str) -> Course {
        Course::reconstitute(
            id,
            name,
            None,
            18,
            DEFAULT_TIMEZONE,
            8,
            true,
            None,
            None,
            None,
            None,
        )
    }

    fn course_resource(course_id: &str) -> Resource {
        Resource::reconstitute(
            format!("golfres_{course_id}"),
            course_id,
            Some(format!("rsrc_{course_id}")),
            Some(course_id.to_string()),
            ResourceKind::Course,
            true,
        )
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok(DEFAULT_TIMEZONE.to_string())
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            Ok(CourseOrder::default())
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
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
            Ok(ResourceId::new(format!("rsrc_new_{}", created.len())))
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            self.saved_course_ids
                .lock()
                .expect("lock")
                .push(input.golf_course_id.to_string());
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

        /// Stands in for the canonical writer: it refuses the same courses the
        /// real one refuses, so a test that saves proves the resources exist.
        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            if input.golf_course_ids().len() > 1 {
                let resources = self.resources.lock().expect("lock");
                for course_id in input.golf_course_ids() {
                    let placeable = resources.iter().any(|resource| {
                        resource.kind() == ResourceKind::Course
                            && resource.is_active()
                            && resource.golf_course_id() == Some(course_id)
                            && resource.reservation_resource_id().is_some()
                    });
                    if !placeable {
                        return Err(CourseError::BadRequest(
                            "every selected course must have a canonical active reservation resource",
                        ));
                    }
                }
            }
            Ok(ReservationProduct::reconstitute_with_course_ids(
                input.reservation_service_id.to_string(),
                None,
                input.reservation_service_id.to_string(),
                input.display_name.clone(),
                PlayType::Caddie,
                18,
                240,
                input
                    .golf_course_ids()
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                None,
            ))
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
        }
    }

    fn multi_course_input(course_ids: Vec<&str>) -> UpsertReservationProduct {
        UpsertReservationProduct::try_new_with_course_ids(
            "svc:season-pass",
            Some("シーズンパス".to_string()),
            "caddie",
            18,
            240,
            course_ids.into_iter().map(ToString::to_string).collect(),
            None,
        )
        .expect("input")
    }

    /// The point of the fix: picking a course that never had a tee-sheet
    /// resource saves, instead of failing with a message about Field's model.
    #[tokio::test]
    async fn a_course_with_no_resource_yet_gets_one_and_the_plan_saves() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![
                course("golfcrs_in", "藻岩IN"),
                course("golfcrs_out", "藻岩OUT"),
            ]),
            resources: Mutex::new(vec![course_resource("golfcrs_out")]),
            ..FakeCatalog::default()
        });

        let product = UpsertReservationProductUseCase::new(catalog.clone())
            .execute(
                credentials(),
                multi_course_input(vec!["golfcrs_out", "golfcrs_in"]),
            )
            .await
            .expect("save");

        assert_eq!(
            product
                .golf_course_ids()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["golfcrs_out".to_string(), "golfcrs_in".to_string()]
        );
        assert_eq!(
            *catalog.created_reservation_resources.lock().expect("lock"),
            vec!["藻岩IN".to_string()],
            "only the course that was missing one is given a resource"
        );
    }

    /// Saving a plan again must not keep minting resources the courses then
    /// have to share their tee times between.
    #[tokio::test]
    async fn courses_that_already_have_resources_are_left_alone() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![
                course("golfcrs_in", "藻岩IN"),
                course("golfcrs_out", "藻岩OUT"),
            ]),
            resources: Mutex::new(vec![
                course_resource("golfcrs_in"),
                course_resource("golfcrs_out"),
            ]),
            ..FakeCatalog::default()
        });

        UpsertReservationProductUseCase::new(catalog.clone())
            .execute(
                credentials(),
                multi_course_input(vec!["golfcrs_out", "golfcrs_in"]),
            )
            .await
            .expect("save");

        assert!(catalog
            .created_reservation_resources
            .lock()
            .expect("lock")
            .is_empty());
        assert!(catalog.saved_course_ids.lock().expect("lock").is_empty());
    }

    /// A one-course plan keeps the legacy shape, so it must not start creating
    /// resources on tenants that have none.
    #[tokio::test]
    async fn a_one_course_plan_creates_nothing() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![course("golfcrs_in", "藻岩IN")]),
            ..FakeCatalog::default()
        });

        UpsertReservationProductUseCase::new(catalog.clone())
            .execute(credentials(), multi_course_input(vec!["golfcrs_in"]))
            .await
            .expect("save");

        assert!(catalog
            .created_reservation_resources
            .lock()
            .expect("lock")
            .is_empty());
    }

    /// A course id the tenant does not have is a mistake to report, not a
    /// resource to invent.
    #[tokio::test]
    async fn an_unknown_course_is_refused() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(vec![course("golfcrs_in", "藻岩IN")]),
            resources: Mutex::new(vec![course_resource("golfcrs_in")]),
            ..FakeCatalog::default()
        });

        let error = UpsertReservationProductUseCase::new(catalog.clone())
            .execute(
                credentials(),
                multi_course_input(vec!["golfcrs_in", "golfcrs_ghost"]),
            )
            .await
            .expect_err("unknown course");

        assert!(matches!(error, CourseError::NotFound("course")));
        assert!(catalog
            .created_reservation_resources
            .lock()
            .expect("lock")
            .is_empty());
    }
}
