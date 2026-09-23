//! GetAttendanceSnapshotUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    AttendanceSnapshotReport, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct GetAttendanceSnapshotUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetAttendanceSnapshotUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: Option<NaiveDate>,
        timezone: &str,
    ) -> Result<AttendanceSnapshotReport, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        self.ops
            .get_attendance_snapshot(credentials, date, timezone)
            .await
    }
}
