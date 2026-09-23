//! RecordVisitCheckinUseCase: one use case, one public entrypoint (`execute`).
//!
//! The desk saying a group turned up, rather than the clock implying it later.
//! Everything a customer's page knows about play today comes from bookings, and
//! a booking cannot tell a round played from a round nobody came to, nor say
//! anything at all about the three people who came in somebody else's group.
//!
//! The day of play is worked out here from the booking's own tee time rather
//! than taken from the caller. A morning group in Japan starts before midnight
//! UTC, so "which day was this" is a tenant-timezone question, and a client
//! that answered it would be a second implementation of the same rule.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    tenant_date_at, CourseError, GatewayCredentials, GolfCatalogGateway, NewVisitCheckin,
    ReservationGateway, ReservationId, VisitCheckin, VisitCheckinGateway, VisitCheckinRequest,
};

pub struct RecordVisitCheckinUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    checkins: Arc<dyn VisitCheckinGateway>,
}

impl RecordVisitCheckinUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        checkins: Arc<dyn VisitCheckinGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
            checkins,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        players: Vec<NewVisitCheckin>,
        checked_in_by: Option<&str>,
    ) -> Result<Vec<VisitCheckin>, CourseError> {
        // Checking a group in is desk work on today's bookings, so it is
        // guarded like the rest of that work rather than by an action of its
        // own: a new action name would be fail-closed everywhere until every
        // tenant's policies were updated, and the first course to try this
        // would meet a 403 instead of a feature.
        credentials.require(actions::MANAGE_RESERVATIONS).await?;

        // Read the booking before writing: a check-in against an id nobody
        // holds is a mistake worth refusing, and the tee time is the only
        // honest source for which day this was.
        let reservation = self
            .reservations
            .get_reservation(credentials, reservation_id)
            .await?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let played_on = tenant_date_at(reservation.starts_at(), &timezone)?;

        let request = VisitCheckinRequest::try_new(reservation_id.clone(), played_on, players)?;
        self.checkins
            .record_visit_checkins(credentials.operator_id, &request, checked_in_by)
            .await
    }
}
