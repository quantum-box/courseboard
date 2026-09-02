//! SettleCancellationFeesUseCase: one use case, one public entrypoint
//! (`execute`).
//!
//! What the desk decided about a batch of cancellation fees: this many
//! invoiced, these waived. Taken as a set because that is how the decision is
//! made — a morning's worth of cancellations selected on one screen and dealt
//! with in one action.
//!
//! This records a decision; it does not raise the invoice. The invoice is
//! Field's, created by the screen through Field's own commercial API, and its
//! id is written here afterwards so that a cancellation and the money asked
//! for it can be read together. Writing the id before the invoice existed
//! would be worse than leaving the row unsettled: an unsettled row comes back
//! on the next extraction, a row pointing at nothing never does.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CancellationFeeDecision, CourseError, GatewayCredentials, ReservationCancellation,
    ReservationCancellationGateway,
};

/// Decisions one call may carry. A screenful of rows, not a migration.
const MAX_DECISIONS: usize = 100;

pub struct SettleCancellationFeesUseCase {
    cancellations: Arc<dyn ReservationCancellationGateway>,
}

impl SettleCancellationFeesUseCase {
    pub fn new(cancellations: Arc<dyn ReservationCancellationGateway>) -> Self {
        Self { cancellations }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        decisions: &[CancellationFeeDecision],
    ) -> Result<Vec<ReservationCancellation>, CourseError> {
        credentials
            .require(actions::MANAGE_CANCELLATION_FEES)
            .await?;
        if decisions.is_empty() {
            return Err(CourseError::BadRequest(
                "there is nothing to settle in this request",
            ));
        }
        if decisions.len() > MAX_DECISIONS {
            return Err(CourseError::BadRequest(
                "settle at most 100 cancellations at a time",
            ));
        }
        // Every one is checked before any one is written. A batch half-applied
        // because the ninetieth row was malformed leaves the desk unable to
        // tell which invoices were recorded and which were not.
        for decision in decisions {
            decision.validate()?;
        }
        let mut seen: Vec<&str> = decisions
            .iter()
            .map(|decision| decision.reservation_id.as_str())
            .collect();
        seen.sort_unstable();
        seen.dedup();
        if seen.len() != decisions.len() {
            return Err(CourseError::BadRequest(
                "the same booking was settled twice in one request",
            ));
        }

        self.cancellations
            .settle_cancellation_fees(credentials.operator_id, decisions)
            .await
    }
}
