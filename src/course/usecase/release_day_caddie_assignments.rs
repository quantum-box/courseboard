//! Release the unstarted booking assignments on one tenant-local day.
use std::sync::Arc;

use chrono::NaiveDate;
use serde::Serialize;
use utoipa::ToSchema;

use crate::course::domain::{
    actions, tenant_day_bounds, widen_for_utc_date_filter, AssignmentStatus, CaddieAssignment,
    CaddieAssignmentQuery, CourseError, GatewayCredentials, GolfOpsGateway, UpsertCaddieAssignment,
};

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDayAssignmentsResult {
    pub released_assignment_ids: Vec<String>,
    pub failed: Vec<ReleaseDayAssignmentFailure>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDayAssignmentFailure {
    pub assignment_id: String,
    pub message: String,
}

pub struct ReleaseDayCaddieAssignmentsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ReleaseDayCaddieAssignmentsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        timezone: &str,
    ) -> Result<ReleaseDayAssignmentsResult, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_ASSIGNMENTS)
            .await?;
        credentials
            .require(actions::LIST_CADDIE_ASSIGNMENTS)
            .await?;
        let bounds = tenant_day_bounds(date, date, timezone)?;
        let window = widen_for_utc_date_filter(date, date);
        let assignments = self
            .ops
            .list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    reservation_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
                },
            )
            .await?;
        release_assignments(assignments, bounds, |assignment, input| async move {
            self.ops
                .update_caddie_assignment(credentials, assignment.id(), input)
                .await
                .map(|_| ())
        })
        .await
    }
}

// Field writes are individual, so report each failure and continue. Repeating
// the request is safe: cancelled and started rounds are excluded on every read.
async fn release_assignments<F, Fut>(
    assignments: Vec<CaddieAssignment>,
    bounds: (chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>),
    mut update: F,
) -> Result<ReleaseDayAssignmentsResult, CourseError>
where
    F: FnMut(CaddieAssignment, UpsertCaddieAssignment) -> Fut,
    Fut: std::future::Future<Output = Result<(), CourseError>>,
{
    let mut result = ReleaseDayAssignmentsResult {
        released_assignment_ids: vec![],
        failed: vec![],
    };
    for assignment in assignments {
        if assignment.status() != AssignmentStatus::Assigned
            || assignment.reservation_id().is_none()
            || assignment.scheduled_at() < bounds.0
            || assignment.scheduled_at() >= bounds.1
        {
            continue;
        }
        let id = assignment.id().to_string();
        let input = UpsertCaddieAssignment {
            caddie_id: assignment.caddie_id().clone(),
            reservation_id: assignment.reservation_id().cloned(),
            round_reference: assignment.round_reference().map(str::to_string),
            scheduled_at: assignment.scheduled_at(),
            status: Some("cancelled".into()),
            assignment_role: Some(assignment.role_label().into()),
            fee_amount: Some(assignment.fee_amount()),
            fee_currency: Some(assignment.fee_currency().into()),
            recommendation_score: None,
            notes: assignment.notes().map(str::to_string),
        };
        match update(assignment, input).await {
            Ok(()) => result.released_assignment_ids.push(id),
            Err(error) => {
                tracing::warn!(assignment_id = %id, error = %error, "Failed to release day assignment");
                result.failed.push(ReleaseDayAssignmentFailure {
                    assignment_id: id,
                    message: "Failed to release assignment; retry the request".into(),
                });
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    fn assignment(id: &str, status: &str, at: &str, booking: bool) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            id.to_string(),
            "c1",
            booking.then(|| "r1".into()),
            Some("Group".into()),
            DateTime::parse_from_rfc3339(at).unwrap().to_utc(),
            None,
            status,
            "primary",
            10000,
            "JPY",
            Some("note".into()),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn filters_local_day_status_and_booking_and_preserves_fields() {
        let bounds = tenant_day_bounds(
            NaiveDate::from_ymd_opt(2026, 11, 6).unwrap(),
            NaiveDate::from_ymd_opt(2026, 11, 6).unwrap(),
            "Asia/Tokyo",
        )
        .unwrap();
        let rows = vec![
            assignment("start", "assigned", "2026-11-05T15:00:00Z", true),
            assignment("end", "assigned", "2026-11-06T15:00:00Z", true),
            assignment("before", "assigned", "2026-11-05T14:59:59Z", true),
            assignment("started", "checked_in", "2026-11-06T01:00:00Z", true),
            assignment("done", "completed", "2026-11-06T01:00:00Z", true),
            assignment("cancelled", "cancelled", "2026-11-06T01:00:00Z", true),
            assignment("other", "assigned", "2026-11-06T01:00:00Z", false),
        ];
        let result = release_assignments(rows, bounds, |_, input| async move {
            assert_eq!(input.status.as_deref(), Some("cancelled"));
            assert_eq!(input.fee_amount, Some(10000));
            assert_eq!(input.notes.as_deref(), Some("note"));
            assert_eq!(input.round_reference.as_deref(), Some("Group"));
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(result.released_assignment_ids, ["start"]);
        assert!(result.failed.is_empty());
    }
    #[tokio::test]
    async fn reports_partial_failure_and_continues() {
        let date = NaiveDate::from_ymd_opt(2026, 11, 6).unwrap();
        let rows = vec![
            assignment("fail", "assigned", "2026-11-06T01:00:00Z", true),
            assignment("ok", "assigned", "2026-11-06T01:00:00Z", true),
        ];
        let result = release_assignments(
            rows,
            tenant_day_bounds(date, date, "Asia/Tokyo").unwrap(),
            |a, _| async move {
                if a.id().to_string() == "fail" {
                    Err(CourseError::Provider("offline".into()))
                } else {
                    Ok(())
                }
            },
        )
        .await
        .unwrap();
        assert_eq!(result.released_assignment_ids, ["ok"]);
        assert_eq!(result.failed[0].assignment_id, "fail");
    }
}
