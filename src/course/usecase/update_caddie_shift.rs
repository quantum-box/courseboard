//! UpdateCaddieShiftUseCase: one use case, one public entrypoint (`execute`).
//!
//! One confirmed day, changed by the desk: turned off, split to a half day,
//! or moved to another course when that course runs short. The move is what
//! sub memberships are for, so the edit is checked against them — a caddie
//! cannot be sent to a course they have no membership for.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    AvailabilityQuery, AvailabilityStatus, CaddieId, CaddieShift, CaddieShiftGateway, CourseError,
    CourseId, GatewayCredentials, GolfOpsGateway, ShiftEdit,
};

pub struct UpdateCaddieShiftUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
}

impl UpdateCaddieShiftUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, shifts: Arc<dyn CaddieShiftGateway>) -> Self {
        Self { ops, shifts }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        date: NaiveDate,
        edit: ShiftEdit,
        updated_by: Option<String>,
    ) -> Result<CaddieShift, CourseError> {
        let (memberships, filed) = tokio::try_join!(
            self.ops.list_caddie_memberships(credentials, caddie_id),
            self.ops.list_caddie_availabilities(
                credentials,
                AvailabilityQuery {
                    caddie_id: Some(caddie_id.clone()),
                    from: Some(date),
                    to: Some(date),
                    date: Some(date),
                },
            ),
        )?;

        // Main and sub together: both are places this caddie can work, which
        // is exactly the question the edit has to answer.
        let workable: Vec<CourseId> = memberships
            .iter()
            .map(|membership| membership.golf_course_id().clone())
            .collect();
        let filed_status: Option<AvailabilityStatus> = filed
            .iter()
            .find(|availability| availability.date() == date)
            .map(|availability| availability.status());

        let shift = edit.apply(caddie_id.clone(), date, &workable, filed_status, updated_by)?;
        self.shifts
            .save_shifts(credentials.operator_id, std::slice::from_ref(&shift))
            .await?;
        Ok(shift)
    }
}
