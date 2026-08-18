//! GetCaddieSupplyUseCase: one use case, one public entrypoint (`execute`).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    compute_caddie_supply, parse_tenant_timezone, AvailabilityQuery, CaddieAvailability,
    CaddieDayCapacity, CaddieSupply, CourseError, GatewayCredentials, GolfCatalogGateway,
    GolfOpsGateway, ReservationGateway,
};

/// Reservation states that already consume a caddie-attached tee slot.
const ACTIVE_STATUSES: [&str; 3] = ["requested", "payment_pending", "confirmed"];

/// How many caddie-attached groups can still be sold on a given day.
///
/// The rule is golf-specific and lives here rather than in Field: the host owns
/// caddie profiles, availability, products, and reservations as generic data,
/// and CourseBoard decides what "caddie-attached capacity" means. See
/// `docs/src/architecture/decisions/ADR-0005-golf-domain-ownership.md`.
pub struct GetCaddieSupplyUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    reservations: Arc<dyn ReservationGateway>,
}

impl GetCaddieSupplyUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        reservations: Arc<dyn ReservationGateway>,
    ) -> Self {
        Self {
            ops,
            catalog,
            reservations,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        safety_buffer: Option<i64>,
    ) -> Result<CaddieSupply, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        let roster = self.ops.list_caddie_roster(credentials).await?;
        let availabilities = self
            .ops
            .list_caddie_availabilities(
                credentials,
                AvailabilityQuery {
                    caddie_id: None,
                    from: Some(date),
                    to: Some(date),
                    date: Some(date),
                },
            )
            .await?;
        let availability_by_caddie: HashMap<&str, &CaddieAvailability> = availabilities
            .iter()
            .map(|availability| (availability.caddie_id().as_str(), availability))
            .collect();

        let capacities = roster.caddies().iter().map(|caddie| {
            let availability = availability_by_caddie.get(caddie.id().as_str());
            CaddieDayCapacity {
                active: caddie.is_active(),
                status: availability.map(|value| value.status()),
                can_two_rounds: caddie.can_two_rounds(),
                two_round_request: availability
                    .map(|value| value.two_round_request())
                    .unwrap_or(false),
            }
        });

        let products = self.catalog.list_reservation_products(credentials).await?;
        let caddie_service_ids: HashSet<&str> = products
            .iter()
            .filter(|product| product.play_type().requires_caddie())
            .map(|product| product.reservation_service_id().as_str())
            .collect();

        let tenant_timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let tenant_timezone = parse_tenant_timezone(&tenant_timezone)?;
        let reservations = self.reservations.list_reservations(credentials).await?;
        let current_caddie_attached = reservations
            .iter()
            .filter(|reservation| reservation.occurs_on_date(date, &tenant_timezone))
            .filter(|reservation| ACTIVE_STATUSES.contains(&reservation.status()))
            .filter(|reservation| {
                reservation
                    .service_id()
                    .is_some_and(|id| caddie_service_ids.contains(id.as_str()))
            })
            .count() as i64;

        Ok(compute_caddie_supply(
            date,
            capacities,
            safety_buffer.unwrap_or(0),
            current_caddie_attached,
        ))
    }
}
