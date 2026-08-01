//! ListAttendancePeriodSnapshotsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    AttendancePeriodSnapshot, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct ListAttendancePeriodSnapshotsUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListAttendancePeriodSnapshotsUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
        self.ops
            .list_attendance_period_snapshots(credentials, from, to)
            .await
    }
}
