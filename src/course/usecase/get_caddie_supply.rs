//! GetCaddieSupplyUseCase: one use case, one public entrypoint (`execute`).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    compute_caddie_supply, free_halves, parse_tenant_timezone, AvailabilityQuery,
    AvailabilityStatus, CaddieAvailability, CaddieDayCapacity, CaddieDutyGateway, CaddieSupply,
    CourseError, GatewayCredentials, GolfCatalogGateway, GolfOpsGateway, ReservationGateway,
    ShiftRulesGateway,
};

/// What the caddie is left free for once the other work is taken off.
///
/// `None` means nothing is left and they are not counted at all. Both halves
/// free returns the filed request untouched, which is the ordinary day.
fn narrowed_by_duty(
    filed: Option<AvailabilityStatus>,
    free: (bool, bool),
) -> Option<Option<AvailabilityStatus>> {
    let (morning, afternoon) = free;
    if !morning && !afternoon {
        return None;
    }
    if morning && afternoon {
        return Some(filed);
    }
    let half = if morning {
        AvailabilityStatus::MorningOnly
    } else {
        AvailabilityStatus::AfternoonOnly
    };
    match filed {
        // Already off, or already narrowed to the half the job just took.
        Some(AvailabilityStatus::Unavailable) => Some(filed),
        Some(AvailabilityStatus::MorningOnly) if !morning => None,
        Some(AvailabilityStatus::AfternoonOnly) if !afternoon => None,
        Some(AvailabilityStatus::MorningOnly) | Some(AvailabilityStatus::AfternoonOnly) => {
            Some(filed)
        }
        _ => Some(Some(half)),
    }
}

/// Reservation states that already consume a caddie-attached tee slot.
const ACTIVE_STATUSES: [&str; 3] = ["requested", "payment_pending", "confirmed"];

/// How many caddie-attached groups can still be sold on a given day.
///
/// The rule is golf-specific and lives here rather than in Field: the host owns
/// caddie profiles, availability, products, and reservations as generic data,
/// and CourseBoard decides what "caddie-attached capacity" means. See
/// the public README.
pub struct GetCaddieSupplyUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    reservations: Arc<dyn ReservationGateway>,
    duties: Arc<dyn CaddieDutyGateway>,
    /// Where the tenant says how a day nobody filed for is read — the same
    /// rule the shift run uses, so supply and the plan agree about it.
    rules: Arc<dyn ShiftRulesGateway>,
}

impl GetCaddieSupplyUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        reservations: Arc<dyn ReservationGateway>,
        duties: Arc<dyn CaddieDutyGateway>,
        rules: Arc<dyn ShiftRulesGateway>,
    ) -> Self {
        Self {
            ops,
            catalog,
            reservations,
            duties,
            rules,
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

        // Other work narrows what a caddie is free for, exactly as a half-day
        // request does — so it is read as one. A morning job leaves an
        // afternoon caddie; a day covered front and back leaves nobody, and
        // the day has that much less to sell.
        let duty_days = self
            .duties
            .list_duty_assignments(credentials.operator_id, date, date)
            .await?;

        let capacities = roster.caddies().iter().filter_map(|caddie| {
            let availability = availability_by_caddie.get(caddie.id().as_str());
            let status = narrowed_by_duty(
                availability.map(|value| value.status()),
                free_halves(&duty_days, caddie.id().as_str(), date),
            )?;
            Some(CaddieDayCapacity {
                active: caddie.is_active(),
                filed: availability.is_some(),
                status,
                can_two_rounds: caddie.can_two_rounds(),
                two_round_request: availability
                    .map(|value| value.two_round_request())
                    .unwrap_or(false),
            })
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

        let policy = self.rules.get_shift_policy(credentials.operator_id).await?;

        Ok(compute_caddie_supply(
            date,
            capacities,
            safety_buffer.unwrap_or(0),
            current_caddie_attached,
            policy.unfiled_request(),
        ))
    }
}
