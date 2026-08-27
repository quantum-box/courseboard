//! GetCourseCaddieSupplyUseCase: one use case, one public entrypoint (`execute`).
//!
//! One day, counted course by course: how many rounds the caddies confirmed
//! onto each course can walk, and how many caddie-attached groups that course
//! already holds. The difference is what the desk balances by moving somebody
//! from a course with room to one that is short.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    compute_course_supply, CaddieShift, CaddieShiftGateway, CourseError, CourseId, DayCaddieSupply,
    GatewayCredentials, GolfCatalogGateway, GolfOpsGateway, ReservationGateway, TeeSheetQuery,
    TeeSheetStatus,
};
use crate::course::usecase::GetTeeSheetUseCase;

pub struct GetCourseCaddieSupplyUseCase {
    shifts: Arc<dyn CaddieShiftGateway>,
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetCourseCaddieSupplyUseCase {
    /// Constructs the supply reader for the screen, including unplaced caddies.
    /// The roster is required to exclude shifts whose caddie no longer exists.
    pub fn with_roster(
        shifts: Arc<dyn CaddieShiftGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        ops: Arc<dyn GolfOpsGateway>,
    ) -> Self {
        Self {
            shifts,
            reservations,
            catalog,
            ops,
        }
    }

    /// The supply screen: reading how the day is staffed is an insight.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
    ) -> Result<DayCaddieSupply, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        // A confirmed shift outlives the caddie it names. Deleting a caddie
        // removes their profile upstream but leaves `golf_caddie_shifts`
        // untouched — this side keeps golf's own columns keyed by an id the
        // other side may drop (ADR-0013). The per-course numbers survive that,
        // because a stray shift carries no course and lands in nobody's
        // column; the "placed nowhere" count does not, and read 9 on a roster
        // of 8. So the screen counts against the roster.
        let known = self
            .ops
            .list_caddie_roster(credentials)
            .await?
            .caddies()
            .iter()
            .map(|caddie| caddie.id().to_string())
            .collect::<HashSet<String>>();
        self.supply(credentials, date, &known).await
    }

    /// `known_caddies` drops shifts whose caddie is no longer on the roster.
    async fn supply(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        known_caddies: &HashSet<String>,
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

        let shifts: Vec<CaddieShift> = shifts
            .into_iter()
            .filter(|shift| known_caddies.contains(shift.caddie_id().as_str()))
            .collect();

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
