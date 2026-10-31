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
            .require(actions::FIELD_MANAGE_CANCELLATION_FEES)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{CancellationQuery, CourseAuthorizer, NewReservationCancellation};

    /// Grants exactly the actions it was given.
    struct Granting(&'static [&'static str]);

    #[async_trait::async_trait]
    impl CourseAuthorizer for Granting {
        async fn require(
            &self,
            _: GatewayCredentials<'_>,
            action: &'static str,
        ) -> Result<(), CourseError> {
            if self.0.contains(&action) {
                Ok(())
            } else {
                Err(CourseError::Forbidden(action))
            }
        }
    }

    struct Unreached;

    #[async_trait::async_trait]
    impl ReservationCancellationGateway for Unreached {
        async fn record_cancellation(
            &self,
            _: &str,
            _: &NewReservationCancellation,
        ) -> Result<(), CourseError> {
            unreachable!()
        }
        async fn list_cancellations(
            &self,
            _: &str,
            _: &CancellationQuery,
        ) -> Result<Vec<ReservationCancellation>, CourseError> {
            unreachable!()
        }
        async fn count_cancellations(
            &self,
            _: &str,
            _: &CancellationQuery,
        ) -> Result<i64, CourseError> {
            unreachable!()
        }
        async fn settle_cancellation_fees(
            &self,
            _: &str,
            _: &[CancellationFeeDecision],
        ) -> Result<Vec<ReservationCancellation>, CourseError> {
            unreachable!("an empty batch never reaches storage")
        }
    }

    async fn settle_as(granted: &'static [&'static str]) -> Result<(), CourseError> {
        let authorizer = Granting(granted);
        let credentials = GatewayCredentials {
            authorization: "Bearer caller",
            caller_bearer: "Bearer caller",
            operator_id: "tenant-a",
            platform_id: None,
            authorizer: &authorizer,
        };
        // An empty batch: past the permission check it is a 400, before it a
        // 403, so the error says which side of the check the caller landed on.
        SettleCancellationFeesUseCase::new(Arc::new(Unreached))
            .execute(credentials, &[])
            .await
            .map(|_| ())
    }

    #[tokio::test]
    async fn the_field_action_settles() {
        assert!(matches!(
            settle_as(&[actions::FIELD_MANAGE_CANCELLATION_FEES]).await,
            Err(CourseError::BadRequest(_))
        ));
    }

    #[tokio::test]
    async fn the_retired_golf_action_is_refused() {
        assert!(matches!(
            settle_as(&["field_extension_golf:ManageCancellationFees"]).await,
            Err(CourseError::Forbidden("field:ManageCancellationFees"))
        ));
    }

    #[tokio::test]
    async fn listing_alone_is_refused() {
        assert!(matches!(
            settle_as(&["field:ListCancellationFees"]).await,
            Err(CourseError::Forbidden("field:ManageCancellationFees"))
        ));
    }
}
