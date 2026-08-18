//! ListCourseReinforcementsUseCase: one use case, one public entrypoint (`execute`).
//!
//! Who can be sent to a course that is short on the day. The answer is not
//! "anyone spare": a caddie works a course they have a membership for, and a
//! day the desk pinned is a decision that should survive the balancing.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    reinforcements_for, CaddieCapability, CaddieId, CaddieShiftGateway, CourseError, CourseId,
    GatewayCredentials, GolfOpsGateway, ShiftSpan,
};

/// One caddie who could cover the short course today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReinforcementCandidate {
    pub caddie_id: CaddieId,
    pub display_name: String,
    /// Where they stand now. `None` means confirmed to work but unplaced.
    pub from_course_id: Option<CourseId>,
    pub rounds_capacity: i32,
    pub span: ShiftSpan,
    /// The short course is their own main course.
    pub returns_home: bool,
}

pub struct ListCourseReinforcementsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
}

impl ListCourseReinforcementsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, shifts: Arc<dyn CaddieShiftGateway>) -> Self {
        Self { ops, shifts }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        date: NaiveDate,
    ) -> Result<Vec<ReinforcementCandidate>, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        let (roster, shifts) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.shifts.list_shifts(credentials.operator_id, date, date),
        )?;

        // Only the people actually on the day need their memberships read;
        // Field answers those one caddie at a time.
        let on_duty: Vec<CaddieId> = shifts
            .iter()
            .filter(|shift| shift.date() == date && shift.is_working())
            .map(|shift| shift.caddie_id().clone())
            .collect();
        if on_duty.is_empty() {
            return Ok(Vec::new());
        }
        let memberships = self.ops.list_memberships_for(credentials, &on_duty).await?;

        let capability: HashMap<String, CaddieCapability> = memberships
            .into_iter()
            .map(|(caddie_id, memberships)| {
                let capability = CaddieCapability {
                    main_course: memberships
                        .iter()
                        .find(|membership| membership.is_primary())
                        .map(|membership| membership.golf_course_id().clone()),
                    courses: memberships
                        .into_iter()
                        .map(|membership| membership.golf_course_id().clone())
                        .collect(),
                };
                (caddie_id, capability)
            })
            .collect();

        let names: HashMap<&str, &str> = roster
            .caddies()
            .iter()
            .map(|caddie| (caddie.id().as_str(), caddie.display_name()))
            .collect();

        Ok(reinforcements_for(course_id, date, &shifts, &capability)
            .into_iter()
            .map(|candidate| ReinforcementCandidate {
                display_name: names
                    .get(candidate.shift.caddie_id().as_str())
                    .map(|name| (*name).to_string())
                    .unwrap_or_else(|| candidate.shift.caddie_id().to_string()),
                caddie_id: candidate.shift.caddie_id().clone(),
                from_course_id: candidate.shift.course_id().cloned(),
                rounds_capacity: candidate.shift.rounds_capacity(),
                span: candidate.shift.span(),
                returns_home: candidate.returns_home,
            })
            .collect())
    }
}
