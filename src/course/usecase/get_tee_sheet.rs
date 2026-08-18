//! Get tee-sheet use case: compose reservations + golf catalog into a day board.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    format_datetime_in_timezone, format_tenant_wall_clock, parse_tenant_timezone, Course,
    CourseError, CourseId, GatewayCredentials, GolfCatalogGateway, PlayType, Reservation,
    ReservationGateway, ReservationProduct, ReservationServiceId, Resource, TeeSheet, TeeSheetItem,
    TeeSheetQuery, TeeSheetStatus, DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR,
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
        credentials.require(actions::LIST_TEE_SHEET).await?;
        // Reservations and courses are the board. Resources and products only
        // decorate its rows, so one of them failing must not black out the
        // operator's view of the day — ADR-0005 moved the board onto several
        // independent Field endpoints, and any of them can be down alone.
        let (reservations, courses, timezone, resources, products) = tokio::join!(
            self.reservations.list_reservations(credentials),
            self.catalog.list_courses(credentials),
            self.catalog.get_tenant_timezone(credentials),
            self.catalog.list_resources(credentials),
            self.catalog.list_reservation_products(credentials),
        );
        let reservations = reservations?;
        let courses = courses?;
        let timezone = timezone?;

        let mut unavailable = Vec::new();
        let resources = resources.unwrap_or_else(|error| {
            tracing::warn!(%error, "tee sheet built without resources");
            unavailable.push("resources".to_string());
            Vec::new()
        });
        let products = products.unwrap_or_else(|error| {
            tracing::warn!(%error, "tee sheet built without reservation products");
            unavailable.push("reservationProducts".to_string());
            Vec::new()
        });

        // A range is several days of the same board, built from the one set of
        // reservations already in hand. The sheet keeps the first day as its
        // own: the day markers describe that day, and every row carries its own
        // start, which is what a caller reading more than one day goes by.
        let mut sheet = build_tee_sheet(
            query.date,
            query.golf_course_id.as_ref(),
            &reservations,
            &courses,
            &resources,
            &products,
            &timezone,
        )?;
        for date in query.dates().into_iter().skip(1) {
            let next = build_tee_sheet(
                date,
                query.golf_course_id.as_ref(),
                &reservations,
                &courses,
                &resources,
                &products,
                &timezone,
            )?;
            sheet = sheet.extended_with(next);
        }
        Ok(sheet.with_unavailable(unavailable))
    }
}

pub(crate) fn build_tee_sheet(
    date: NaiveDate,
    golf_course_id: Option<&CourseId>,
    reservations: &[Reservation],
    courses: &[Course],
    resources: &[Resource],
    products: &[ReservationProduct],
    tenant_timezone: &str,
) -> Result<TeeSheet, CourseError> {
    let timezone = parse_tenant_timezone(tenant_timezone)?;
    let product_by_service: HashMap<&ReservationServiceId, &ReservationProduct> = products
        .iter()
        .map(|product| (product.reservation_service_id(), product))
        .collect();
    let items: Vec<TeeSheetItem> = reservations
        .iter()
        .filter(|reservation| reservation.is_tee_sheet_candidate())
        .filter(|reservation| reservation.occurs_on_date(date, &timezone))
        .filter_map(|reservation| {
            let (course_id, course_name) = resolve_course(reservation, resources, courses);
            if let Some(filter_id) = golf_course_id {
                if &course_id != filter_id {
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
                tenant_timezone,
            ))
        })
        .collect::<Result<Vec<_>, CourseError>>()?;

    Ok(TeeSheet::new(
        date,
        tenant_timezone,
        format_tenant_wall_clock(date, DEFAULT_DAY_START_HOUR, 0, tenant_timezone)?,
        format_tenant_wall_clock(date, DEFAULT_DAY_END_HOUR, 0, tenant_timezone)?,
        items,
    ))
}

fn resolve_course(
    reservation: &Reservation,
    resources: &[Resource],
    courses: &[Course],
) -> (CourseId, String) {
    if let Some(course_id) = reservation.golf_course_id() {
        let course_name = courses
            .iter()
            .find(|course| course.id() == course_id)
            .map(|course| course.name().to_string())
            .or_else(|| {
                resources
                    .iter()
                    .find(|resource| resource.id().as_str() == course_id.as_str())
                    .map(|resource| resource.name().to_string())
            })
            .unwrap_or_else(|| course_id.to_string());
        return (course_id.clone(), course_name);
    }

    if let Some(resource_id) = reservation.resource_id() {
        if let Some(resource) = resources
            .iter()
            .find(|resource| resource.matches_reservation_resource(resource_id))
        {
            let course_id = resource.resolved_course_id();
            let course_name = courses
                .iter()
                .find(|course| course.id() == &course_id)
                .map(|course| course.name().to_string())
                .unwrap_or_else(|| resource.name().to_string());
            return (course_id, course_name);
        }

        if let Some(course) = courses
            .iter()
            .find(|course| course.id().as_str() == resource_id.as_str())
        {
            return (course.id().clone(), course.name().to_string());
        }
    }

    (CourseId::new(""), "Unassigned course".to_string())
}

fn to_tee_sheet_item(
    reservation: &Reservation,
    product: Option<&ReservationProduct>,
    golf_course_id: &CourseId,
    course_name: &str,
    tenant_timezone: &str,
) -> Result<TeeSheetItem, CourseError> {
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

    Ok(TeeSheetItem::new(
        reservation.id(),
        reservation.reservation_number(),
        reservation.service_id().map(ToString::to_string),
        product
            .and_then(ReservationProduct::display_name)
            .map(str::to_string),
        golf_course_id,
        course_name,
        product
            .map(|item| item.golf_course_ids().to_vec())
            .unwrap_or_default(),
        format_datetime_in_timezone(reservation.starts_at(), tenant_timezone)?,
        duration_minutes,
        play_type,
        reservation.party_size(),
        reservation.party_display_name(),
        TeeSheetStatus::from_reservation_status(reservation.status()),
        holes,
        reservation.notes().map(str::to_string),
    )
    .with_party(reservation.party().clone())
    .with_customer_id(reservation.customer_id().cloned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::{Duration, TimeZone, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        ProductSlot, ResourceId, ResourceKind, SaveCourseResource, UpsertCourse,
        UpsertReservationProduct, DEFAULT_TIMEZONE,
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

        async fn get_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            reservation_id: &crate::course::domain::ReservationId,
        ) -> Result<Reservation, CourseError> {
            self.items
                .lock()
                .expect("lock")
                .iter()
                .find(|item| item.id() == reservation_id)
                .cloned()
                .ok_or(CourseError::NotFound("reservation not found"))
        }

        async fn update_reservation_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &crate::course::domain::ReservationId,
            _service_id: &crate::course::domain::ReservationServiceId,
            _ends_at: chrono::DateTime<chrono::Utc>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_booking(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &crate::course::domain::ReservationId,
            _update: &crate::course::domain::ReservationBookingUpdate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_party(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &crate::course::domain::ReservationId,
            party: &crate::course::domain::PartyDetails,
        ) -> Result<crate::course::domain::PartyDetails, CourseError> {
            Ok(party.clone())
        }

        async fn list_reservation_type_ids(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<String>, CourseError> {
            Ok(Vec::new())
        }

        async fn list_seeded_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<crate::course::domain::SeededReservation>, CourseError> {
            Ok(Vec::new())
        }

        async fn create_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &crate::course::domain::NewReservation,
        ) -> Result<crate::course::domain::ReservationId, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &crate::course::domain::ReservationId,
            _input: &crate::course::domain::NewReservation,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn cancel_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &crate::course::domain::ReservationId,
            _reason: Option<&str>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }
    }

    struct FakeGolfCatalogGateway {
        tenant_timezone: String,
        courses: Mutex<Vec<Course>>,
        resources: Mutex<Vec<Resource>>,
        products: Mutex<Vec<ReservationProduct>>,
        products_fail: bool,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeGolfCatalogGateway {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok(self.tenant_timezone.clone())
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
            Err(CourseError::Provider("not implemented".into()))
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            Err(CourseError::Provider("not implemented".into()))
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            Err(CourseError::Provider("not implemented".into()))
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
            _name: &str,
        ) -> Result<ResourceId, CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            Err(CourseError::Provider("unused".into()))
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            if self.products_fail {
                return Err(CourseError::Provider("Field API returned 500".into()));
            }
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

        let item =
            to_tee_sheet_item(&reservation, None, &course_id, &course_name, "Asia/Tokyo").unwrap();
        assert_eq!(item.tee_time(), "2026-07-18T07:00:00+09:00");
        assert_eq!(item.duration_minutes(), 270);
        assert_eq!(item.play_type(), PlayType::SelfPlay);
        assert_eq!(item.status(), TeeSheetStatus::Confirmed);
        assert_eq!(item.party_size(), 4);
        assert_eq!(item.reservation_service_id(), Some("svc:caddie-18"));
        assert_eq!(item.display_name(), None);
    }

    #[test]
    fn prefers_product_play_type_and_duration_fallback() {
        let mut reservation = sample_reservation();
        // Rebuild with zero-length range to force product fallback.
        reservation = Reservation::reconstitute(
            reservation.id(),
            reservation.reservation_number(),
            reservation.service_id().map(|id| id.to_string()),
            reservation.resource_id().map(|id| id.to_string()),
            reservation.customer_name().map(str::to_string),
            reservation.status(),
            reservation.starts_at(),
            reservation.starts_at(),
            reservation.quantity(),
            reservation.golf_course_id().map(|id| id.to_string()),
            reservation.notes().map(str::to_string),
        );
        let product = ReservationProduct::reconstitute(
            "product_caddie_18",
            None,
            "svc:caddie-18",
            Some("平日キャディ付き".into()),
            PlayType::Caddie,
            18,
            240,
            None,
            None,
        );
        let item = to_tee_sheet_item(
            &reservation,
            Some(&product),
            &CourseId::new("course_east"),
            "East Course",
            "Asia/Tokyo",
        )
        .unwrap();
        assert_eq!(item.play_type(), PlayType::Caddie);
        assert_eq!(item.duration_minutes(), 240);
        assert_eq!(item.holes(), 18);
        assert_eq!(item.reservation_service_id(), Some("svc:caddie-18"));
        assert_eq!(item.display_name(), Some("平日キャディ付き"));
        assert!(item.requires_caddie());
        // The plan named no course, so there is nothing to disagree with.
        assert!(!item.course_mismatch());
    }

    #[test]
    fn a_booking_is_checked_against_every_course_the_plan_sells_on() {
        // ERP decides the course through the resource; the plan only declares
        // its membership. Where the two disagree the board has to say so
        // rather than quietly trust either side.
        let reservation = sample_reservation();
        let season_pass = ReservationProduct::reconstitute_with_course_ids(
            "product_caddie_18",
            None,
            "svc:caddie-18",
            None,
            PlayType::Caddie,
            18,
            240,
            vec!["course_east".into(), "course_west".into()],
            None,
        );
        let matching = to_tee_sheet_item(
            &reservation,
            Some(&season_pass),
            &CourseId::new("course_west"),
            "West Course",
            "Asia/Tokyo",
        )
        .unwrap();
        assert!(!matching.course_mismatch());
        assert_eq!(matching.expected_course_id(), None);

        let booked_elsewhere = to_tee_sheet_item(
            &reservation,
            Some(&season_pass),
            &CourseId::new("course_north"),
            "North Course",
            "Asia/Tokyo",
        )
        .unwrap();
        assert!(booked_elsewhere.course_mismatch());
        assert_eq!(
            booked_elsewhere
                .expected_course_ids()
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["course_east", "course_west"],
        );
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
            None,
            PlayType::Caddie,
            18,
            240,
            None,
            None,
        )];

        let filter = CourseId::new("course_east");
        let sheet = build_tee_sheet(
            date,
            Some(&filter),
            &[reservation],
            &courses,
            &resources,
            &products,
            DEFAULT_TIMEZONE,
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
            tenant_timezone: "Europe/Berlin".into(),
            courses: Mutex::new(vec![Course::reconstitute(
                "course_east",
                "East Course",
                None,
                18,
                "America/New_York",
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
                None,
                PlayType::Caddie,
                18,
                240,
                None,
                None,
            )]),
            products_fail: false,
        });
        let use_case = GetTeeSheetUseCase::new(reservations, catalog);
        let sheet = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                TeeSheetQuery {
                    date,
                    to: None,
                    golf_course_id: Some(CourseId::new("course_east")),
                },
            )
            .await
            .expect("execute use case");

        assert_eq!(sheet.items().len(), 1);
        assert_eq!(sheet.items()[0].party_name(), "Yamada");
        assert_eq!(sheet.items()[0].play_type().as_str(), "caddie");
        assert_eq!(sheet.items()[0].status().as_str(), "confirmed");
        assert_eq!(sheet.timezone(), "Europe/Berlin");
        assert!(sheet.unavailable().is_empty());
    }

    #[tokio::test]
    async fn a_range_answers_every_day_it_covers_on_one_board() {
        // Staffing is planned a fortnight out, so the groups still missing a
        // caddie are asked for once rather than a day at a time.
        let first = NaiveDate::from_ymd_opt(2026, 7, 18).expect("date");
        let second_day_start = Utc.with_ymd_and_hms(2026, 7, 18, 22, 0, 0).unwrap();
        let reservations = Arc::new(FakeReservationGateway {
            items: Mutex::new(vec![
                sample_reservation(),
                Reservation::reconstitute(
                    "res_2",
                    "R-2",
                    Some("svc:caddie-18".into()),
                    Some("res_east".into()),
                    Some("Suzuki".into()),
                    "confirmed",
                    second_day_start,
                    second_day_start + Duration::minutes(270),
                    4,
                    None,
                    None,
                ),
            ]),
        });
        let catalog = Arc::new(FakeGolfCatalogGateway {
            tenant_timezone: DEFAULT_TIMEZONE.into(),
            courses: Mutex::new(vec![Course::reconstitute(
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
            )]),
            resources: Mutex::new(vec![Resource::reconstitute(
                "golfres_east",
                "East Course",
                Some("res_east".into()),
                Some("course_east".into()),
                ResourceKind::Course,
                true,
            )]),
            products: Mutex::new(Vec::new()),
            products_fail: false,
        });

        let sheet = GetTeeSheetUseCase::new(reservations, catalog)
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                TeeSheetQuery {
                    date: first,
                    to: NaiveDate::from_ymd_opt(2026, 7, 19),
                    golf_course_id: None,
                },
            )
            .await
            .expect("execute use case");

        let names: Vec<&str> = sheet.items().iter().map(|item| item.party_name()).collect();
        assert_eq!(names, vec!["Yamada", "Suzuki"]);
        // The board still describes its first day; the rows carry their own.
        assert_eq!(sheet.date(), first);
    }

    #[tokio::test]
    async fn tee_sheet_still_lists_the_day_when_products_are_unavailable() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 18).expect("date");
        let reservations = Arc::new(FakeReservationGateway {
            items: Mutex::new(vec![sample_reservation()]),
        });
        let catalog = Arc::new(FakeGolfCatalogGateway {
            tenant_timezone: DEFAULT_TIMEZONE.into(),
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
            resources: Mutex::new(Vec::new()),
            products: Mutex::new(Vec::new()),
            products_fail: true,
        });
        let sheet = GetTeeSheetUseCase::new(reservations, catalog)
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                TeeSheetQuery {
                    date,
                    to: None,
                    golf_course_id: None,
                },
            )
            .await
            .expect("a failing catalog lookup must not black out the board");

        // The row the operator needs is there.
        assert_eq!(sheet.items().len(), 1);
        assert_eq!(sheet.items()[0].party_name(), "Yamada");
        // And the caller is told which detail is a fallback, so it can say so
        // instead of presenting the defaults as fact.
        assert_eq!(sheet.unavailable(), ["reservationProducts"]);
    }
}
