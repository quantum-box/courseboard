//! Reading and replacing the ledger's column order.
//!
//! Kept together because the two are one decision seen from both sides, and the
//! rule that an unknown id is dropped rather than refused has to hold for both.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CourseId, CourseOrder, GatewayCredentials, GolfCatalogGateway,
};

pub struct GetCourseOrderUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl GetCourseOrderUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CourseOrder, CourseError> {
        credentials.require(actions::LIST_COURSES).await?;
        self.catalog.get_course_order(credentials).await
    }
}

pub struct ReplaceCourseOrderUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ReplaceCourseOrderUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    /// Store the arrangement, keeping only ids that name a course.
    ///
    /// A stale id is dropped rather than refused: the board is arranged from a
    /// list the browser is holding, and a course deleted in another tab must not
    /// make the whole save fail.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        ids: Vec<CourseId>,
    ) -> Result<CourseOrder, CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        let courses = self.catalog.list_courses(credentials).await?;
        let known: Vec<&CourseId> = courses.iter().map(|course| course.id()).collect();
        let order = CourseOrder::new(ids.into_iter().filter(|id| known.contains(&id)));
        self.catalog.replace_course_order(credentials, &order).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{
        Course, ProductSlot, ReservationProduct, ReservationServiceId, Resource, UpsertCourse,
        UpsertReservationProduct, DEFAULT_TIMEZONE,
    };
    use async_trait::async_trait;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeCatalog {
        courses: Vec<Course>,
        saved: Mutex<Option<CourseOrder>>,
    }

    fn course(id: &str) -> Course {
        Course::reconstitute(
            CourseId::new(id),
            id.to_string(),
            None,
            18,
            DEFAULT_TIMEZONE.to_string(),
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
            Ok(DEFAULT_TIMEZONE.to_string())
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<crate::course::domain::ResourceId, CourseError> {
            unimplemented!("not used")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: crate::course::domain::SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unimplemented!("not used")
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
            Ok(Vec::new())
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            Ok(self.saved.lock().unwrap().clone().unwrap_or_default())
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            *self.saved.lock().unwrap() = Some(order.clone());
            Ok(order.clone())
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
            unimplemented!("not used")
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
            unimplemented!("not used")
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    #[tokio::test]
    async fn the_arrangement_is_stored_in_the_order_it_was_sent() {
        let catalog = Arc::new(FakeCatalog {
            courses: vec![course("a"), course("b"), course("c")],
            saved: Mutex::new(None),
        });
        let stored = ReplaceCourseOrderUseCase::new(catalog.clone())
            .execute(
                credentials(),
                vec![CourseId::new("c"), CourseId::new("a"), CourseId::new("b")],
            )
            .await
            .unwrap();
        assert_eq!(
            stored.ids(),
            &[CourseId::new("c"), CourseId::new("a"), CourseId::new("b")]
        );
    }

    #[tokio::test]
    async fn a_course_deleted_in_another_tab_is_dropped_rather_than_failing_the_save() {
        // The browser arranges from the list it is holding, which may be stale.
        let catalog = Arc::new(FakeCatalog {
            courses: vec![course("a")],
            saved: Mutex::new(None),
        });
        let stored = ReplaceCourseOrderUseCase::new(catalog)
            .execute(
                credentials(),
                vec![CourseId::new("gone"), CourseId::new("a")],
            )
            .await
            .unwrap();
        assert_eq!(stored.ids(), &[CourseId::new("a")]);
    }

    #[tokio::test]
    async fn clearing_the_arrangement_is_allowed_and_reads_back_as_empty() {
        let catalog = Arc::new(FakeCatalog {
            courses: vec![course("a")],
            saved: Mutex::new(None),
        });
        ReplaceCourseOrderUseCase::new(catalog.clone())
            .execute(credentials(), vec![CourseId::new("a")])
            .await
            .unwrap();
        ReplaceCourseOrderUseCase::new(catalog.clone())
            .execute(credentials(), Vec::new())
            .await
            .unwrap();
        let read = GetCourseOrderUseCase::new(catalog)
            .execute(credentials())
            .await
            .unwrap();
        assert!(read.is_empty());
    }
}
