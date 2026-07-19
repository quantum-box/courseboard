//! Get tee-sheet use case: compose reservations + golf catalog into a day board.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    format_datetime_with_offset, format_jst_wall_clock, jst_offset, Course, CourseError,
    GatewayCredentials, GolfCatalogGateway, PlayType, Reservation, ReservationGateway,
    ReservationProduct, Resource, TeeSheet, TeeSheetItem, TeeSheetQuery, TeeSheetStatus,
    DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR, DEFAULT_TIMEZONE,
};

const DEFAULT_DURATION_MINUTES: i32 = 270;

/// Application service that builds a golf tee-sheet for a calendar day.
pub struct GetTeeSheetUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl GetTeeSheetUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: TeeSheetQuery,
    ) -> Result<TeeSheet, CourseError> {
        let (reservations, courses, resources, products) = tokio::try_join!(
            self.reservations.list_reservations(credentials),
            self.catalog.list_courses(credentials),
            self.catalog.list_resources(credentials),
            self.catalog.list_reservation_products(credentials),
        )?;

        build_tee_sheet(
            query.date,
            query.golf_course_id.as_deref(),
            &reservations,
            &courses,
            &resources,
            &products,
        )
    }
}

pub(crate) fn build_tee_sheet(
    date: NaiveDate,
    golf_course_id: Option<&str>,
    reservations: &[Reservation],
    courses: &[Course],
    resources: &[Resource],
    products: &[ReservationProduct],
) -> Result<TeeSheet, CourseError> {
    let jst = jst_offset()?;
    let product_by_service: HashMap<&str, &ReservationProduct> = products
        .iter()
        .map(|product| (product.reservation_service_id(), product))
        .collect();
    let timezone = courses
        .iter()
        .map(Course::timezone)
        .find(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_TIMEZONE)
        .to_string();

    let items: Vec<TeeSheetItem> = reservations
        .iter()
        .filter(|reservation| reservation.is_tee_sheet_candidate())
        .filter(|reservation| reservation.occurs_on_date(date, &jst))
        .filter_map(|reservation| {
            let (course_id, course_name) = resolve_course(reservation, resources, courses);
            if let Some(filter_id) = golf_course_id {
                if course_id != filter_id {
                    return None;
                }
            }
            let product = reservation
                .service_id()
                .and_then(|service_id| product_by_service.get(service_id).copied());
            Some(to_tee_sheet_item(
                reservation,
                product,
                &course_id,
                &course_name,
                jst,
            ))
        })
        .collect();

    Ok(TeeSheet::new(
        date,
        timezone,
        format_jst_wall_clock(date, DEFAULT_DAY_START_HOUR, 0, jst),
        format_jst_wall_clock(date, DEFAULT_DAY_END_HOUR, 0, jst),
        items,
    ))
}

fn resolve_course(
    reservation: &Reservation,
    resources: &[Resource],
    courses: &[Course],
) -> (String, String) {
    if let Some(course_id) = reservation.golf_course_id() {
        let course_name = courses
            .iter()
            .find(|course| course.id() == course_id)
            .map(|course| course.name().to_string())
            .or_else(|| {
                resources
                    .iter()
                    .find(|resource| resource.id() == course_id)
                    .map(|resource| resource.name().to_string())
            })
            .unwrap_or_else(|| course_id.to_string());
        return (course_id.to_string(), course_name);
    }

    if let Some(resource_id) = reservation.resource_id() {
        if let Some(resource) = resources
            .iter()
            .find(|resource| resource.matches_reservation_resource(resource_id))
        {
            let course_id = resource.resolved_course_id().to_string();
            let course_name = courses
                .iter()
                .find(|course| course.id() == course_id)
                .map(|course| course.name().to_string())
                .unwrap_or_else(|| resource.name().to_string());
            return (course_id, course_name);
        }

        if let Some(course) = courses.iter().find(|course| course.id() == resource_id) {
            return (course.id().to_string(), course.name().to_string());
        }
    }

    (String::new(), "Unassigned course".to_string())
}

fn to_tee_sheet_item(
    reservation: &Reservation,
    product: Option<&ReservationProduct>,
    golf_course_id: &str,
    course_name: &str,
    jst: chrono::FixedOffset,
) -> TeeSheetItem {
    let duration_minutes = reservation
        .duration_minutes_from_range()
        .or_else(|| product.map(|item| item.fallback_duration_minutes()))
        .unwrap_or(DEFAULT_DURATION_MINUTES);
    let play_type = product
        .map(|item| item.play_type())
        .unwrap_or(PlayType::SelfPlay);
    let holes = product
        .map(|item| item.hole_count().get())
        .filter(|value| *value > 0)
        .unwrap_or(18);

    TeeSheetItem::new(
        reservation.id(),
        reservation.reservation_number(),
        golf_course_id,
        course_name,
        format_datetime_with_offset(reservation.starts_at(), jst),
        duration_minutes,
        play_type,
        reservation.party_size(),
        reservation.party_display_name(),
        TeeSheetStatus::from_reservation_status(reservation.status()),
        holes,
        reservation.notes().map(str::to_string),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::{Duration, TimeZone, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        ProductSlot, ResourceKind, UpsertCourse, UpsertReservationProduct,
    };

    struct FakeReservationGateway {
        items: Mutex<Vec<Reservation>>,
    }

    #[async_trait]
    impl ReservationGateway for FakeReservationGateway {
        async fn list_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Reservation>, CourseError> {
            Ok(self.items.lock().expect("lock").clone())
        }
    }

    struct FakeGolfCatalogGateway {
        courses: Mutex<Vec<Course>>,
        resources: Mutex<Vec<Resource>>,
        products: Mutex<Vec<ReservationProduct>>,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeGolfCatalogGateway {
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
            Err(CourseError::Provider("not implemented".into()))
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &str,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            Err(CourseError::Provider("not implemented".into()))
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &str,
        ) -> Result<(), CourseError> {
            Err(CourseError::Provider("not implemented".into()))
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(self.resources.lock().expect("lock").clone())
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            Ok(self.products.lock().expect("lock").clone())
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            Err(CourseError::Provider("not implemented".into()))
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

    fn sample_reservation() -> Reservation {
        let starts = Utc.with_ymd_and_hms(2026, 7, 17, 22, 0, 0).unwrap(); // 07:00 JST next day
        Reservation::reconstitute(
            "res_1",
            "R-1",
            Some("svc:caddie-18".into()),
            Some("res_east".into()),
            Some("Yamada".into()),
            "confirmed",
            starts,
            starts + Duration::minutes(270),
            4,
            None,
            Some("VIP".into()),
        )
    }

    #[test]
    fn resolves_course_from_resource_link_and_formats_jst_tee_time() {
        let reservation = sample_reservation();
        let resources = vec![Resource::reconstitute(
            "golfres_east",
            "East Course",
            Some("res_east".into()),
            Some("course_east".into()),
            ResourceKind::Course,
            true,
        )];
        let courses = vec![Course::reconstitute(
            "course_east",
            "East Course",
            Some("East".into()),
            18,
            DEFAULT_TIMEZONE,
            8,
            true,
            None,
            None,
            None,
            None,
        )];

        let (course_id, course_name) = resolve_course(&reservation, &resources, &courses);
        assert_eq!(course_id, "course_east");
        assert_eq!(course_name, "East Course");

        let jst = jst_offset().unwrap();
        let item = to_tee_sheet_item(&reservation, None, &course_id, &course_name, jst);
        assert_eq!(item.tee_time(), "2026-07-18T07:00:00+09:00");
        assert_eq!(item.duration_minutes(), 270);
        assert_eq!(item.play_type(), PlayType::SelfPlay);
        assert_eq!(item.status(), TeeSheetStatus::Confirmed);
        assert_eq!(item.party_size(), 4);
    }

    #[test]
    fn prefers_product_play_type_and_duration_fallback() {
        let mut reservation = sample_reservation();
        // Rebuild with zero-length range to force product fallback.
        reservation = Reservation::reconstitute(
            reservation.id(),
            reservation.reservation_number(),
            reservation.service_id().map(str::to_string),
            reservation.resource_id().map(str::to_string),
            reservation.customer_name().map(str::to_string),
            reservation.status(),
            reservation.starts_at(),
            reservation.starts_at(),
            reservation.quantity(),
            reservation.golf_course_id().map(str::to_string),
            reservation.notes().map(str::to_string),
        );
        let product = ReservationProduct::reconstitute(
            "product_caddie_18",
            None,
            "svc:caddie-18",
            PlayType::Caddie,
            18,
            240,
        );
        let jst = jst_offset().unwrap();
        let item = to_tee_sheet_item(
            &reservation,
            Some(&product),
            "course_east",
            "East Course",
            jst,
        );
        assert_eq!(item.play_type(), PlayType::Caddie);
        assert_eq!(item.duration_minutes(), 240);
        assert_eq!(item.holes(), 18);
        assert!(item.requires_caddie());
    }

    #[test]
    fn build_tee_sheet_filters_by_date_and_course() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 18).unwrap();
        let reservation = sample_reservation();
        let resources = vec![Resource::reconstitute(
            "golfres_east",
            "East Course",
            Some("res_east".into()),
            Some("course_east".into()),
            ResourceKind::Course,
            true,
        )];
        let courses = vec![Course::reconstitute(
            "course_east",
            "East Course",
            None,
            18,
            DEFAULT_TIMEZONE,
            8,
            true,
            None,
            None,
            None,
            None,
        )];
        let products = vec![ReservationProduct::reconstitute(
            "product_caddie_18",
            None,
            "svc:caddie-18",
            PlayType::Caddie,
            18,
            240,
        )];

        let sheet = build_tee_sheet(
            date,
            Some("course_east"),
            &[reservation],
            &courses,
            &resources,
            &products,
        )
        .expect("build tee sheet");
        assert_eq!(sheet.date(), date);
        assert_eq!(sheet.timezone(), DEFAULT_TIMEZONE);
        assert_eq!(sheet.day_start(), "2026-07-18T06:00:00+09:00");
        assert_eq!(sheet.day_end(), "2026-07-18T18:00:00+09:00");
        assert_eq!(sheet.items().len(), 1);
        assert_eq!(sheet.items()[0].play_type(), PlayType::Caddie);
        assert_eq!(sheet.items()[0].golf_course_id(), "course_east");
    }

    #[tokio::test]
    async fn use_case_loads_catalog_through_ports_only() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 18).unwrap();
        let reservations = Arc::new(FakeReservationGateway {
            items: Mutex::new(vec![sample_reservation()]),
        });
        let catalog = Arc::new(FakeGolfCatalogGateway {
            courses: Mutex::new(vec![Course::reconstitute(
                "course_east",
                "East Course",
                None,
                18,
                DEFAULT_TIMEZONE,
                8,
                true,
                None,
                None,
                None,
                None,
            )]),
            resources: Mutex::new(vec![Resource::reconstitute(
                "golfres_east",
                "East Course",
                Some("res_east".into()),
                Some("course_east".into()),
                ResourceKind::Course,
                true,
            )]),
            products: Mutex::new(vec![ReservationProduct::reconstitute(
                "product_caddie_18",
                None,
                "svc:caddie-18",
                PlayType::Caddie,
                18,
                240,
            )]),
        });
        let use_case = GetTeeSheetUseCase::new(reservations, catalog);
        let sheet = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "scc",
                },
                TeeSheetQuery {
                    date,
                    golf_course_id: Some("course_east".into()),
                },
            )
            .await
            .expect("execute use case");

        assert_eq!(sheet.items().len(), 1);
        assert_eq!(sheet.items()[0].party_name(), "Yamada");
        assert_eq!(sheet.items()[0].play_type().as_str(), "caddie");
        assert_eq!(sheet.items()[0].status().as_str(), "confirmed");
    }
}
