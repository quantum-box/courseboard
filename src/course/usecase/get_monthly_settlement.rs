//! Build the monthly settlement together with booking details operators can read.

use std::collections::HashMap;
use std::sync::Arc;

use crate::course::domain::{
    format_datetime_with_offset, jst_offset, Course, CourseError, GatewayCredentials,
    GolfCatalogGateway, GolfCommercialGateway, MonthlySettlement, Reservation, ReservationGateway,
    ReservationId, Resource,
};

/// One booking included in the monthly total, decorated for the close screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthlySettlementReservation {
    reservation_id: ReservationId,
    reservation_number: Option<String>,
    customer_name: Option<String>,
    tee_time: Option<String>,
    course_name: Option<String>,
}

impl MonthlySettlementReservation {
    fn unavailable(reservation_id: ReservationId) -> Self {
        Self {
            reservation_id,
            reservation_number: None,
            customer_name: None,
            tee_time: None,
            course_name: None,
        }
    }

    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }

    pub fn reservation_number(&self) -> Option<&str> {
        self.reservation_number.as_deref()
    }

    pub fn customer_name(&self) -> Option<&str> {
        self.customer_name.as_deref()
    }

    pub fn tee_time(&self) -> Option<&str> {
        self.tee_time.as_deref()
    }

    pub fn course_name(&self) -> Option<&str> {
        self.course_name.as_deref()
    }
}

/// The commercial total remains usable even if its optional booking lookup fails.
pub struct MonthlySettlementView {
    report: MonthlySettlement,
    reservations: Vec<MonthlySettlementReservation>,
    reservation_details_unavailable: bool,
}

impl MonthlySettlementView {
    pub fn report(&self) -> &MonthlySettlement {
        &self.report
    }

    pub fn reservations(&self) -> &[MonthlySettlementReservation] {
        &self.reservations
    }

    pub fn reservation_details_unavailable(&self) -> bool {
        self.reservation_details_unavailable
    }
}

pub struct GetMonthlySettlementUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl GetMonthlySettlementUseCase {
    pub fn new(
        commercial: Arc<dyn GolfCommercialGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self {
            commercial,
            reservations,
            catalog,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<MonthlySettlementView, CourseError> {
        let report = self
            .commercial
            .get_monthly_settlement(credentials, year_month)
            .await?;

        if report.reservation_ids().is_empty() {
            return Ok(MonthlySettlementView {
                report,
                reservations: Vec::new(),
                reservation_details_unavailable: false,
            });
        }

        // Booking identity is required for reconciliation. Course and resource
        // catalogs only decorate it, so their temporary failure must not hide
        // the customer and tee time that can still be shown.
        let (reservations, courses, resources) = tokio::join!(
            self.reservations.list_reservations(credentials),
            self.catalog.list_courses(credentials),
            self.catalog.list_resources(credentials),
        );

        let reservations = match reservations {
            Ok(items) => items,
            Err(error) => {
                tracing::warn!(%error, "monthly settlement built without booking details");
                return Ok(MonthlySettlementView {
                    report,
                    reservations: Vec::new(),
                    reservation_details_unavailable: true,
                });
            }
        };
        let courses = courses.unwrap_or_else(|error| {
            tracing::warn!(%error, "monthly settlement built without course catalog");
            Vec::new()
        });
        let resources = resources.unwrap_or_else(|error| {
            tracing::warn!(%error, "monthly settlement built without course resources");
            Vec::new()
        });
        let items = build_settlement_reservations(
            report.reservation_ids(),
            &reservations,
            &courses,
            &resources,
        )?;

        Ok(MonthlySettlementView {
            report,
            reservations: items,
            reservation_details_unavailable: false,
        })
    }
}

fn build_settlement_reservations(
    ids: &[ReservationId],
    reservations: &[Reservation],
    courses: &[Course],
    resources: &[Resource],
) -> Result<Vec<MonthlySettlementReservation>, CourseError> {
    let jst = jst_offset()?;
    let by_id: HashMap<&str, &Reservation> = reservations
        .iter()
        .map(|reservation| (reservation.id().as_str(), reservation))
        .collect();

    Ok(ids
        .iter()
        .map(|id| {
            let Some(reservation) = by_id.get(id.as_str()) else {
                return MonthlySettlementReservation::unavailable(id.clone());
            };
            MonthlySettlementReservation {
                reservation_id: id.clone(),
                reservation_number: non_blank(reservation.reservation_number()),
                customer_name: reservation.customer_name().and_then(non_blank),
                tee_time: Some(format_datetime_with_offset(reservation.starts_at(), jst)),
                course_name: settlement_course_name(reservation, courses, resources),
            }
        })
        .collect())
}

fn non_blank(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn settlement_course_name(
    reservation: &Reservation,
    courses: &[Course],
    resources: &[Resource],
) -> Option<String> {
    if let Some(course_id) = reservation.golf_course_id() {
        if let Some(course) = courses.iter().find(|course| course.id() == course_id) {
            return non_blank(course.name());
        }
        if let Some(resource) = resources
            .iter()
            .find(|resource| resource.golf_course_id() == Some(course_id))
        {
            return non_blank(resource.name());
        }
    }

    let resource_id = reservation.resource_id()?;
    let resource = resources
        .iter()
        .find(|resource| resource.matches_reservation_resource(resource_id))?;
    let course_id = resource.resolved_course_id();
    courses
        .iter()
        .find(|course| course.id() == &course_id)
        .and_then(|course| non_blank(course.name()))
        .or_else(|| non_blank(resource.name()))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;

    #[test]
    fn monthly_rows_keep_the_settlement_order_and_add_readable_booking_details() {
        let reservations = vec![Reservation::reconstitute(
            "rsv_1",
            "R-100",
            None,
            None,
            Some("山田 太郎".into()),
            "completed",
            Utc.with_ymd_and_hms(2026, 8, 9, 22, 30, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 10, 3, 0, 0).unwrap(),
            4,
            None,
            None,
        )];
        let ids = vec![
            ReservationId::new("rsv_missing"),
            ReservationId::new("rsv_1"),
        ];

        let rows = build_settlement_reservations(&ids, &reservations, &[], &[]).unwrap();

        assert_eq!(rows[0].reservation_id().as_str(), "rsv_missing");
        assert_eq!(rows[0].customer_name(), None);
        assert_eq!(rows[1].reservation_number(), Some("R-100"));
        assert_eq!(rows[1].customer_name(), Some("山田 太郎"));
        assert_eq!(rows[1].tee_time(), Some("2026-08-10T07:30:00+09:00"));
    }
}
