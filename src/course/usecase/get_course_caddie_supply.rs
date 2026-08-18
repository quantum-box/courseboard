//! GetCourseCaddieSupplyUseCase: one use case, one public entrypoint (`execute`).
//!
//! One day, counted course by course: how many rounds the caddies confirmed
//! onto each course can walk, and how many caddie-attached groups that course
//! already holds. The difference is what the desk balances by moving somebody
//! from a course with room to one that is short.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    compute_course_supply, CaddieShiftGateway, CourseError, CourseId, DayCaddieSupply,
    GatewayCredentials, GolfCatalogGateway, ReservationGateway, TeeSheetQuery, TeeSheetStatus,
};
use crate::course::usecase::GetTeeSheetUseCase;

pub struct GetCourseCaddieSupplyUseCase {
    shifts: Arc<dyn CaddieShiftGateway>,
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl GetCourseCaddieSupplyUseCase {
    pub fn new(
        shifts: Arc<dyn CaddieShiftGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self {
            shifts,
            reservations,
            catalog,
        }
    }

    /// The supply screen: reading how the day is staffed is an insight.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
    ) -> Result<DayCaddieSupply, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        self.supply(credentials, date).await
    }

    /// The same figures, for a caller that is booking rather than looking.
    ///
    /// Taking a caddie round has to know whether the day has room for it, so
    /// the guard inside `CreateReservationUseCase` runs this. Requiring the
    /// insights permission here would mean a front-desk role could take a self
    /// round but not a caddie one, which is not a distinction anybody asked
    /// for — the caller has already been authorized to make the booking.
    pub(crate) async fn for_capacity_guard(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
    ) -> Result<DayCaddieSupply, CourseError> {
        self.supply(credentials, date).await
    }

    async fn supply(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
    ) -> Result<DayCaddieSupply, CourseError> {
        let sheet = GetTeeSheetUseCase::new(self.reservations.clone(), self.catalog.clone());
        let (sheet, shifts, courses) = tokio::try_join!(
            sheet.execute(
                credentials,
                TeeSheetQuery {
                    date,
                    to: None,
                    golf_course_id: None,
                },
            ),
            self.shifts.list_shifts(credentials.operator_id, date, date),
            self.catalog.list_courses(credentials),
        )?;

        let demand = caddie_attached_by_course(&sheet);
        Ok(compute_course_supply(
            date,
            courses
                .iter()
                .filter(|course| course.is_active())
                .map(|course| (course.id().clone(), course.name().to_string())),
            &shifts,
            &demand,
        ))
    }
}

/// Caddie-attached groups each course holds for the day.
///
/// A cancelled row asks nothing of anybody; a completed one was walked, and
/// counting it is what keeps a finished morning from reading as spare
/// capacity somebody could be moved away from.
fn caddie_attached_by_course(sheet: &crate::course::domain::TeeSheet) -> HashMap<CourseId, i64> {
    let mut demand: HashMap<CourseId, i64> = HashMap::new();
    for item in sheet
        .items()
        .iter()
        .filter(|item| item.requires_caddie())
        .filter(|item| item.status() != TeeSheetStatus::Cancelled)
    {
        *demand.entry(item.golf_course_id().clone()).or_insert(0) += 1;
    }
    demand
}
