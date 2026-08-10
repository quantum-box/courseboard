//! ListCaddieShiftsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{CaddieShift, CaddieShiftGateway, CourseError};

pub struct ListCaddieShiftsUseCase {
    shifts: Arc<dyn CaddieShiftGateway>,
}

impl ListCaddieShiftsUseCase {
    pub fn new(shifts: Arc<dyn CaddieShiftGateway>) -> Self {
        Self { shifts }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CaddieShift>, CourseError> {
        // A backwards range would read as "no shifts anywhere", which the
        // board would draw as an empty month rather than a mistake.
        if from > to {
            return Err(CourseError::BadRequest("the range starts after it ends"));
        }
        self.shifts.list_shifts(tenant_id, from, to).await
    }
}
