//! UpdateCaddieShiftUseCase: one use case, one public entrypoint (`execute`).
//!
//! One confirmed day, changed by the desk: turned off, split to a half day,
//! or moved to another course when that course runs short. The move is what
//! sub memberships are for, so the edit is checked against them — a caddie
//! cannot be sent to a course they have no membership for.
//!
//! The day is also mirrored into Field, which holds the generic half of it:
//! that this staff member is at work, and between which times (ADR-0013).
//! Field is written first — see [`MirrorShiftToField`] for why the order is
//! not the other way round.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    AvailabilityQuery, AvailabilityStatus, CaddieId, CaddieShift, CaddieShiftGateway, CourseError,
    CourseId, GatewayCredentials, GolfOpsGateway, ShiftEdit, ShiftRulesGateway,
};
use crate::course::usecase::MirrorShiftToField;

pub struct UpdateCaddieShiftUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
    rules: Arc<dyn ShiftRulesGateway>,
    mirror: Arc<MirrorShiftToField>,
}

impl UpdateCaddieShiftUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        shifts: Arc<dyn CaddieShiftGateway>,
        rules: Arc<dyn ShiftRulesGateway>,
        mirror: Arc<MirrorShiftToField>,
    ) -> Self {
        Self {
            ops,
            shifts,
            rules,
            mirror,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        date: NaiveDate,
        edit: ShiftEdit,
        updated_by: Option<String>,
    ) -> Result<CaddieShift, CourseError> {
        credentials.require(actions::MANAGE_SHIFTS).await?;
        let (memberships, filed, roster, links, defaults) = tokio::try_join!(
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
            // The staff member the day is filed under in Field. Read from the
            // roster because that is where the link between a caddie profile
            // and an HRM staff record lives.
            self.ops.list_caddie_roster(credentials),
            self.shifts
                .field_shift_links(credentials.operator_id, date, date),
            self.rules
                .get_default_working_hours(credentials.operator_id),
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

        // Only a staff member Field still has counts as a link. Field soft-
        // deletes staff and a deleted one stops resolving, so a profile that
        // still names it would have every write refused (PLT-3588) — and the
        // profile keeps the id, because deleting the staff on Field's own
        // screens does not reach back to clear it.
        //
        // The edit goes through either way. The desk cannot close that gap
        // from this screen, and refusing would leave tomorrow's roster
        // unfixable because somebody deleted a staff record.
        let staff_id = roster
            .caddies()
            .iter()
            .find(|caddie| caddie.id() == caddie_id)
            .and_then(|caddie| caddie.staff_id())
            .filter(|staff_id| roster.staff().iter().any(|member| member.id() == *staff_id));
        let existing = links
            .iter()
            .find(|link| &link.caddie_id == caddie_id && link.date == date)
            .and_then(|link| link.field_shift_id.as_deref());

        // Field first (ADR-0013 rule 4). If this fails nothing is written
        // anywhere, which is the one outcome that leaves no new drift behind.
        let hours = self
            .mirror
            .opening_hours(credentials, shift.course_id().cloned())
            .await?;
        let link = self
            .mirror
            .execute(credentials, staff_id, &shift, existing, defaults, &hours)
            .await?;

        self.shifts
            .save_shifts(credentials.operator_id, std::slice::from_ref(&shift))
            .await?;
        self.shifts
            .set_field_shift_links(credentials.operator_id, std::slice::from_ref(&link))
            .await?;
        Ok(shift)
    }
}
