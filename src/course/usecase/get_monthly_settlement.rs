//! Build the monthly settlement together with booking details operators can read.

use std::collections::HashMap;
use std::sync::Arc;

use crate::config::SettlementSource;
use crate::course::domain::actions;
use crate::course::domain::{
    caddie_fee_totals, drilldown_reservation_ids, merge_settlement, parse_tenant_timezone,
    reservation_totals, settlement_reservation_lines, CaddieAssignmentQuery, Course, CourseError,
    GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway, GolfOpsGateway,
    MonthlySettlement, Reservation, ReservationGateway, ReservationId, Resource,
    SettlementReservationLine, SettlementWindow,
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
    /// The month's bookings in export order. Empty when the booking lookup
    /// failed, in which case the export falls back to the one Field renders.
    lines: Vec<SettlementReservationLine>,
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

    pub fn lines(&self) -> &[SettlementReservationLine] {
        &self.lines
    }
}

pub struct GetMonthlySettlementUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    ops: Arc<dyn GolfOpsGateway>,
    source: SettlementSource,
}

impl GetMonthlySettlementUseCase {
    pub fn new(
        commercial: Arc<dyn GolfCommercialGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        ops: Arc<dyn GolfOpsGateway>,
        source: SettlementSource,
    ) -> Self {
        Self {
            commercial,
            reservations,
            catalog,
            ops,
            source,
        }
    }

    /// The month's close.
    ///
    /// What the bookings came to and what the rounds owe the caddies is worked
    /// out here (ADR-0005 Phase 1). Field is still asked for the whole report
    /// regardless, because what is outstanding on cancellations and the Square
    /// reconciliation are blocks CourseBoard has no way to read yet — see
    /// [`merge_settlement`].
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<MonthlySettlementView, CourseError> {
        credentials.require(actions::LIST_SETTLEMENT).await?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let window = SettlementWindow::try_new(year_month, parse_tenant_timezone(&timezone)?)?;
        let upstream = self
            .commercial
            .get_monthly_settlement(credentials, year_month, &timezone)
            .await?;

        // A month Field says is empty needs no bookings fetched to decorate —
        // but only when Field is the one adding it up. Once the close is
        // CourseBoard's, an empty answer upstream is exactly the case worth
        // checking rather than agreeing with.
        if self.source == SettlementSource::Field && upstream.reservation_ids().is_empty() {
            return Ok(MonthlySettlementView {
                report: upstream,
                reservations: Vec::new(),
                reservation_details_unavailable: false,
                lines: Vec::new(),
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
                // Without the bookings there is nothing to add up here either,
                // so the month falls back to what Field worked out rather than
                // reporting a close built from half its materials.
                tracing::warn!(%error, "monthly settlement built without booking details");
                return Ok(MonthlySettlementView {
                    report: upstream,
                    reservations: Vec::new(),
                    reservation_details_unavailable: true,
                    lines: Vec::new(),
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

        let lines = settlement_reservation_lines(&reservations, &window);
        let report = match self.source {
            SettlementSource::Field => upstream,
            // Compare mode must not be able to break the month it is only
            // watching: a local build that fails costs an observation, not the
            // answer the operator asked for.
            SettlementSource::Compare => {
                match self
                    .local_settlement(credentials, &window, &reservations, &lines, &upstream)
                    .await
                {
                    Ok(local) => log_settlement_difference(year_month, &upstream, &local),
                    Err(error) => tracing::warn!(
                        target: "settlement_source_compare",
                        %error,
                        year_month,
                        "the close could not be built here; nothing to compare"
                    ),
                }
                upstream
            }
            SettlementSource::Courseboard => {
                self.local_settlement(credentials, &window, &reservations, &lines, &upstream)
                    .await?
            }
        };

        let items = build_settlement_reservations(
            report.reservation_ids(),
            &reservations,
            &courses,
            &resources,
            &timezone,
        )?;

        Ok(MonthlySettlementView {
            report,
            reservations: items,
            reservation_details_unavailable: false,
            lines,
        })
    }

    async fn local_settlement(
        &self,
        credentials: GatewayCredentials<'_>,
        window: &SettlementWindow,
        reservations: &[Reservation],
        lines: &[SettlementReservationLine],
        upstream: &MonthlySettlement,
    ) -> Result<MonthlySettlement, CourseError> {
        // Asked for a day either side of the month: Field filters these by
        // local date and the window is an absolute span.
        let assignments = self
            .ops
            .list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.fetch_from()),
                    to: Some(window.fetch_to()),
                    reservation_id: None,
                },
            )
            .await?;
        Ok(merge_settlement(
            window,
            reservation_totals(reservations, window),
            caddie_fee_totals(&assignments, window),
            drilldown_reservation_ids(lines),
            upstream,
        ))
    }
}

/// Compare mode: Field's answer was the one served. Say where the local one
/// differs, so a whole close can be watched before the switch.
///
/// Only the blocks CourseBoard works out are compared; the rest were relayed
/// and cannot disagree with themselves.
fn log_settlement_difference(
    year_month: &str,
    upstream: &MonthlySettlement,
    local: &MonthlySettlement,
) {
    let differences: Vec<String> = [
        delta(
            "reservations.grossAmount",
            upstream.reservations_gross_amount(),
            local.reservations_gross_amount(),
        ),
        delta(
            "reservations.collectedAmount",
            upstream.reservations_collected_amount(),
            local.reservations_collected_amount(),
        ),
        delta(
            "reservations.refundedAmount",
            upstream.reservations_refunded_amount(),
            local.reservations_refunded_amount(),
        ),
        delta(
            "reservations.paymentPendingAmount",
            upstream.reservations_payment_pending_amount(),
            local.reservations_payment_pending_amount(),
        ),
        delta(
            "reservations.reservationCount",
            upstream.reservation_count(),
            local.reservation_count(),
        ),
        delta(
            "caddieFees.total",
            upstream.caddie_fees_total(),
            local.caddie_fees_total(),
        ),
        delta(
            "caddieFees.assignmentCount",
            upstream.caddie_assignment_count(),
            local.caddie_assignment_count(),
        ),
    ]
    .into_iter()
    .flatten()
    .collect();

    if differences.is_empty() {
        tracing::info!(
            target: "settlement_source_compare",
            year_month,
            bookings = local.reservation_count(),
            "settlement sources agree"
        );
    } else {
        tracing::warn!(
            target: "settlement_source_compare",
            year_month,
            ?differences,
            "settlement sources disagree; a short reservationCount means the \
             booking list was cut off before the month was covered (PLT-3858), \
             not that the arithmetic differs"
        );
    }
}

fn delta(field: &str, upstream: i64, local: i64) -> Option<String> {
    (upstream != local).then(|| {
        format!(
            "{field}: field={upstream} courseboard={local} delta={}",
            local - upstream
        )
    })
}

fn build_settlement_reservations(
    ids: &[ReservationId],
    reservations: &[Reservation],
    courses: &[Course],
    resources: &[Resource],
    timezone: &str,
) -> Result<Vec<MonthlySettlementReservation>, CourseError> {
    let timezone = parse_tenant_timezone(timezone)?;
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
                tee_time: Some(
                    reservation
                        .starts_at()
                        .with_timezone(&timezone)
                        .format("%Y-%m-%dT%H:%M:%S%:z")
                        .to_string(),
                ),
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

        let rows =
            build_settlement_reservations(&ids, &reservations, &[], &[], "Asia/Tokyo").unwrap();

        assert_eq!(rows[0].reservation_id().as_str(), "rsv_missing");
        assert_eq!(rows[0].customer_name(), None);
        assert_eq!(rows[1].reservation_number(), Some("R-100"));
        assert_eq!(rows[1].customer_name(), Some("山田 太郎"));
        assert_eq!(rows[1].tee_time(), Some("2026-08-10T07:30:00+09:00"));
    }

    #[test]
    fn only_the_blocks_courseboard_adds_up_are_reported_as_differing() {
        assert_eq!(delta("caddieFees.total", 11_000, 11_000), None);
        assert_eq!(
            delta("caddieFees.total", 11_000, 9_000).as_deref(),
            Some("caddieFees.total: field=11000 courseboard=9000 delta=-2000")
        );
    }
}
