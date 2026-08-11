//! ListReservationSummariesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, ReservationDaySummary, ReservationSummaryGateway, ReservationSummaryQuery,
};

pub struct ListReservationSummariesUseCase {
    summaries: Arc<dyn ReservationSummaryGateway>,
}

impl ListReservationSummariesUseCase {
    pub fn new(summaries: Arc<dyn ReservationSummaryGateway>) -> Self {
        Self { summaries }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        query: ReservationSummaryQuery,
    ) -> Result<Vec<ReservationDaySummary>, CourseError> {
        if tenant_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }
        self.summaries
            .list_reservation_summaries(tenant_id, &query)
            .await
    }
}
