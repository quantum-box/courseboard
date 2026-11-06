//! GetStartLedgerImportContextUseCase: what the review screen needs to turn
//! printed names into this tenant's courses and plans, and to see which tee
//! times on that day are already booked.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    actions, parse_tenant_timezone, CourseError, CourseId, GatewayCredentials, GolfCatalogGateway,
    ReservationGateway, ReservationId,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartLedgerCourseChoice {
    pub id: CourseId,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartLedgerPlanChoice {
    pub reservation_service_id: String,
    pub name: String,
    /// The plan, not the sheet, decides whether a caddie goes out.
    pub requires_caddie: bool,
    /// `None` when the plan is sold on every course.
    pub course_ids: Option<Vec<CourseId>>,
}

/// A tee time on the day that already has a group, so the screen can say
/// which read groups will be skipped rather than booked twice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartLedgerBookedTeeTime {
    pub course_id: CourseId,
    pub tee_time: String,
    pub reservation_id: ReservationId,
    pub customer_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartLedgerImportContext {
    pub courses: Vec<StartLedgerCourseChoice>,
    pub plans: Vec<StartLedgerPlanChoice>,
    pub booked: Vec<StartLedgerBookedTeeTime>,
}

pub struct GetStartLedgerImportContextUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    reservations: Arc<dyn ReservationGateway>,
}

impl GetStartLedgerImportContextUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        reservations: Arc<dyn ReservationGateway>,
    ) -> Self {
        Self {
            catalog,
            reservations,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
    ) -> Result<StartLedgerImportContext, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        let (timezone, courses, products, reservations) = tokio::try_join!(
            self.catalog.get_tenant_timezone(credentials),
            self.catalog.list_courses(credentials),
            self.catalog.list_reservation_products(credentials),
            self.reservations.list_reservations(credentials),
        )?;
        let zone = parse_tenant_timezone(&timezone)?;
        let courses = courses
            .into_iter()
            .filter(|course| course.is_active())
            .map(|course| StartLedgerCourseChoice {
                id: course.id().clone(),
                name: course.name().to_string(),
            })
            .collect();
        let plans = products
            .into_iter()
            .map(|product| StartLedgerPlanChoice {
                reservation_service_id: product.reservation_service_id().as_str().to_string(),
                name: product
                    .display_name()
                    .unwrap_or(product.reservation_service_id().as_str())
                    .to_string(),
                requires_caddie: product.requires_caddie(),
                course_ids: product
                    .course_scope_declared()
                    .then(|| product.golf_course_ids().to_vec()),
            })
            .collect();
        let booked = reservations
            .iter()
            .filter(|reservation| reservation.is_tee_sheet_candidate())
            .filter(|reservation| reservation.occurs_on_date(date, &zone))
            .filter_map(|reservation| {
                Some(StartLedgerBookedTeeTime {
                    course_id: reservation.golf_course_id()?.clone(),
                    tee_time: reservation
                        .starts_at()
                        .with_timezone(&zone)
                        .format("%H:%M")
                        .to_string(),
                    reservation_id: reservation.id().clone(),
                    customer_name: reservation.customer_name().map(str::to_string),
                })
            })
            .collect();
        Ok(StartLedgerImportContext {
            courses,
            plans,
            booked,
        })
    }
}
