//! Catalog list / mutate use cases (courses, resources, reservation products).

use std::sync::Arc;

use crate::course::domain::{
    Course, CourseError, GatewayCredentials, GolfCatalogGateway, ProductSlot, ReservationProduct,
    Resource, UpsertCourse, UpsertReservationProduct,
};

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
        self.catalog.list_courses(credentials).await
    }
}

pub struct CreateCourseUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl CreateCourseUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCourse,
    ) -> Result<Course, CourseError> {
        self.catalog.create_course(credentials, input).await
    }
}

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
        course_id: &str,
        input: UpsertCourse,
    ) -> Result<Course, CourseError> {
        if course_id.trim().is_empty() {
            return Err(CourseError::BadRequest("course id is required"));
        }
        self.catalog
            .update_course(credentials, course_id, input)
            .await
    }
}

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
        course_id: &str,
    ) -> Result<(), CourseError> {
        if course_id.trim().is_empty() {
            return Err(CourseError::BadRequest("course id is required"));
        }
        self.catalog.delete_course(credentials, course_id).await
    }
}

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

pub struct ListReservationProductsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListReservationProductsUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<ReservationProduct>, CourseError> {
        self.catalog.list_reservation_products(credentials).await
    }
}

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
        self.catalog
            .upsert_reservation_product(credentials, input)
            .await
    }
}

pub struct ListProductSlotsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListProductSlotsUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &str,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        if service_id.trim().is_empty() {
            return Err(CourseError::BadRequest(
                "reservation service id is required",
            ));
        }
        self.catalog
            .list_product_slots(credentials, service_id)
            .await
    }
}

pub struct ReplaceProductSlotsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ReplaceProductSlotsUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &str,
        slots: Vec<ProductSlot>,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        if service_id.trim().is_empty() {
            return Err(CourseError::BadRequest(
                "reservation service id is required",
            ));
        }
        self.catalog
            .replace_product_slots(credentials, service_id, slots)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct FakeCatalog {
        courses: Mutex<Vec<Course>>,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            Ok(self.courses.lock().expect("lock").clone())
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            let course = Course::reconstitute(
                "course_new",
                input.name,
                input.short_name,
                input.hole_count.get(),
                input.timezone,
                input.start_interval_minutes.get(),
                input.is_active,
                None,
                None,
                None,
                None,
            );
            self.courses.lock().expect("lock").push(course.clone());
            Ok(course)
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &str,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &str,
        ) -> Result<(), CourseError> {
            Ok(())
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(Vec::new())
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
            _service_id: &str,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            Ok(Vec::new())
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &str,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            Ok(Vec::new())
        }
    }

    #[tokio::test]
    async fn create_course_persists_through_port() {
        let catalog = Arc::new(FakeCatalog {
            courses: Mutex::new(Vec::new()),
        });
        let use_case = CreateCourseUseCase::new(catalog.clone());
        let input = UpsertCourse::try_new("East", Some("E".into()), 18, "Asia/Tokyo", 8, true)
            .expect("valid");
        let course = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer t",
                    operator_id: "scc",
                },
                input,
            )
            .await
            .expect("create");
        assert_eq!(course.name(), "East");
        assert_eq!(course.hole_count().get(), 18);
        assert_eq!(catalog.courses.lock().expect("lock").len(), 1);
    }

    #[test]
    fn upsert_course_rejects_invalid_interval() {
        let error = UpsertCourse::try_new("East", None, 18, "Asia/Tokyo", 0, true).unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }
}
