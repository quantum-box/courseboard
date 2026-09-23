//! ListReservationCheckinsUseCase: one use case, one public entrypoint
//! (`execute`).
//!
//! What the desk has already done to this group, so the screen can show it
//! rather than make somebody press the button again to find out.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, ReservationId, VisitCheckin, VisitCheckinGateway,
};

pub struct ListReservationCheckinsUseCase {
    checkins: Arc<dyn VisitCheckinGateway>,
}

impl ListReservationCheckinsUseCase {
    pub fn new(checkins: Arc<dyn VisitCheckinGateway>) -> Self {
        Self { checkins }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
    ) -> Result<Vec<VisitCheckin>, CourseError> {
        // Reading the day's board, which is what this is part of.
        credentials.require(actions::LIST_TEE_SHEET).await?;
        self.checkins
            .list_reservation_checkins(credentials.operator_id, reservation_id)
            .await
    }
}
