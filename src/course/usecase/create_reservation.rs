//! CreateReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Lets the desk book an empty tee time straight from the ledger, for a
//! walk-in or phone booking that never went through a customer-facing
//! channel. The selected ledger resource is carried to Field so the booking
//! consumes generated inventory rather than a compatibility manual slot.

use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDate, Utc};

use crate::course::domain::{
    has_room_for_one_more_caddie_round, parse_tenant_tee_time, reconcile_remaining,
    tenant_day_bounds, CaddieShiftGateway, CourseError, CourseId, CustomerId, GatewayCredentials,
    GolfCatalogGateway, GolfCommercialGateway, NewReservation, PartyDetails, Reservation,
    ReservationGateway, ReservationId, ReservationProduct, ReservationScheduleGateway, Resource,
    ResourceId, ResourceKind, ResourceTimeSlot,
};
use crate::course::usecase::GetCourseCaddieSupplyUseCase;

/// A round is a day's work at most; anything longer is a typo or an attack.
const MAX_DURATION_MINUTES: i64 = 24 * 60;
const SLOT_FILLED_MESSAGE: &str = "この枠はちょうど埋まりました";

pub struct CreateReservationInput {
    pub golf_course_id: CourseId,
    /// Exact generic reservation resource shown on the selected ledger column.
    pub reservation_resource_id: ResourceId,
    pub reservation_service_id: Option<String>,
    pub date: NaiveDate,
    /// Wall clock on the course's own day, e.g. `"07:14"`.
    pub tee_time: String,
    pub duration_minutes: i64,
    pub quantity: i32,
    pub customer_name: String,
    /// The ledger entry the desk picked for the person booking, if any.
    ///
    /// Never required. A booking must be writable from a name alone — the desk
    /// takes calls faster than it can identify people, and a booking refused
    /// for want of a ledger entry is a tee time nobody sold.
    pub customer_id: Option<CustomerId>,
    pub party: PartyDetails,
}

pub struct CreateReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
}

impl CreateReservationUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        shifts: Arc<dyn CaddieShiftGateway>,
    ) -> Self {
        Self {
            reservations,
            commercial,
            catalog,
            schedules,
            shifts,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: CreateReservationInput,
    ) -> Result<ReservationId, CourseError> {
        let customer_name = input.customer_name.trim();
        if customer_name.is_empty() {
            return Err(CourseError::BadRequest("customer name is required"));
        }
        if input.quantity <= 0 {
            return Err(CourseError::BadRequest("quantity must be positive"));
        }
        // Bounded, not just positive: chrono panics well before i64 runs out,
        // so an absurd number would abort the request instead of answering 400.
        if input.duration_minutes <= 0 || input.duration_minutes > MAX_DURATION_MINUTES {
            return Err(CourseError::BadRequest(
                "duration must be between 1 minute and 24 hours",
            ));
        }

        let product = self
            .product_for_service(credentials, input.reservation_service_id.as_deref())
            .await?;
        validate_product_course(product.as_ref(), &input.golf_course_id)?;

        self.refuse_a_round_the_course_cannot_walk(credentials, &input, product.as_ref())
            .await?;

        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let starts_at = parse_tenant_tee_time(input.date, &input.tee_time, &timezone)?;
        let ends_at = starts_at + Duration::minutes(input.duration_minutes);

        // Never trust an id posted by the browser merely because it appeared on
        // an earlier ledger response. Re-read the mapping and require the exact
        // inventory resource belonging to the selected course.
        let resources = self.catalog.list_resources(credentials).await?;
        validate_course_resource(
            &resources,
            &input.golf_course_id,
            &input.reservation_resource_id,
        )?;

        let (window_start, window_end) = tenant_day_bounds(input.date, input.date, &timezone)?;
        let (slots, reservations) = tokio::join!(
            self.schedules.list_resource_time_slots(
                credentials,
                &input.reservation_resource_id,
                window_start,
                window_end,
            ),
            self.reservations.list_reservations(credentials),
        );
        ensure_slot_available(
            &slots?,
            &reservations?,
            starts_at,
            &input.golf_course_id,
            &input.reservation_resource_id,
        )?;

        let reservation_type_id = self.reservation_type_id(credentials).await?;
        let new_reservation = NewReservation {
            reservation_type_id,
            reservation_service_id: input.reservation_service_id,
            reservation_resource_id: Some(input.reservation_resource_id),
            starts_at,
            ends_at,
            timezone,
            quantity: input.quantity,
            customer_name: customer_name.to_string(),
            customer_id: input.customer_id,
            golf_course_id: input.golf_course_id,
            party: input.party,
            // A phone booking is paid at the course. Field therefore converts
            // its hold to reserved inventory in the create transaction instead
            // of leaving a checkout-dependent hold behind.
            prepayment_policy: Some("none".to_string()),
            seed_key: None,
        };

        self.reservations
            .create_reservation(credentials, &new_reservation)
            .await
            .map_err(normalize_inventory_conflict)
    }

    /// Stop a caddie-attached round being sold onto a course that has no
    /// caddie left to walk it.
    ///
    /// Only once the month is confirmed: before that nothing says who stands
    /// where, and refusing every booking for want of a plan would be worse
    /// than the overbooking this prevents. A self-play round is never
    /// affected, and neither is a booking whose plan cannot be identified —
    /// the guard is for the case it can prove.
    async fn refuse_a_round_the_course_cannot_walk(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &CreateReservationInput,
        product: Option<&ReservationProduct>,
    ) -> Result<(), CourseError> {
        let needs_caddie = product
            .map(|product| product.play_type().requires_caddie())
            .unwrap_or(false);
        if !needs_caddie {
            return Ok(());
        }

        let confirmed = self
            .shifts
            .list_shifts(credentials.operator_id, input.date, input.date)
            .await?;
        if confirmed.is_empty() {
            return Ok(());
        }

        let supply = GetCourseCaddieSupplyUseCase::new(
            self.shifts.clone(),
            self.reservations.clone(),
            self.catalog.clone(),
        )
        .execute(credentials, input.date)
        .await?;
        if has_room_for_one_more_caddie_round(&supply, &input.golf_course_id) {
            return Ok(());
        }
        Err(CourseError::BadRequest(
            "この日はこのコースのキャディがふさがっています。他のコースから応援を回すか、セルフでの受付をご検討ください",
        ))
    }

    async fn product_for_service(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: Option<&str>,
    ) -> Result<Option<ReservationProduct>, CourseError> {
        let Some(service_id) = service_id else {
            return Ok(None);
        };
        Ok(self
            .catalog
            .list_reservation_products(credentials)
            .await?
            .into_iter()
            .find(|product| product.reservation_service_id().as_str() == service_id))
    }

    /// The reservation type every Field booking needs.
    ///
    /// The club's policy names one, but a tenant can be operating without a
    /// policy row — the ledger works fine without one, so a booking should
    /// too. Falling back to the tenant's own reservation type keeps the desk
    /// working instead of stopping it on a setting it never chose.
    async fn reservation_type_id(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<String, CourseError> {
        match self.commercial.get_reservation_policy(credentials).await {
            Ok(policy) => {
                let from_policy = policy.reservation_type_id().trim().to_string();
                if !from_policy.is_empty() {
                    return Ok(from_policy);
                }
            }
            // Only "there is no policy" falls through — Field answers that as a
            // 404. A timeout or a 5xx is a real upstream failure, and swallowing
            // it would book the round under whichever type happened to be first.
            Err(CourseError::NotFound(_)) => {}
            Err(CourseError::UpstreamClient { status: 404, .. }) => {}
            Err(error) => return Err(error),
        }
        self.reservations
            .list_reservation_type_ids(credentials)
            .await?
            .into_iter()
            .next()
            .ok_or(CourseError::BadRequest(
                "この施設ではまだ予約を受け付ける準備ができていません。導入担当にご連絡ください",
            ))
    }
}

fn validate_product_course(
    product: Option<&ReservationProduct>,
    course_id: &CourseId,
) -> Result<(), CourseError> {
    if product.is_some_and(|product| !product.is_sold_on(course_id)) {
        return Err(CourseError::BadRequest(
            "選択した商品はこのコースでは利用できません。商品を選び直してください",
        ));
    }
    Ok(())
}

fn validate_course_resource(
    resources: &[Resource],
    course_id: &CourseId,
    requested_resource_id: &ResourceId,
) -> Result<(), CourseError> {
    let resource = resources
        .iter()
        .filter(|resource| resource.is_active())
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .filter(|resource| resource.golf_course_id() == Some(course_id))
        .find(|resource| resource.matches_reservation_resource(requested_resource_id))
        .ok_or(CourseError::BadRequest(
            "選択したコースと予約枠が一致しません。台帳を読み込み直してください",
        ))?;
    let canonical = resource
        .reservation_resource_id()
        .unwrap_or_else(|| resource.id());
    if canonical != requested_resource_id {
        return Err(CourseError::BadRequest(
            "選択した予約枠はこのコースの在庫ではありません。台帳を読み込み直してください",
        ));
    }
    Ok(())
}

fn ensure_slot_available(
    slots: &[ResourceTimeSlot],
    reservations: &[Reservation],
    starts_at: DateTime<Utc>,
    course_id: &CourseId,
    resource_id: &ResourceId,
) -> Result<(), CourseError> {
    let matching_slots: Vec<&ResourceTimeSlot> = slots
        .iter()
        .filter(|slot| slot.starts_at() == starts_at)
        .collect();
    if matching_slots.is_empty() || !matching_slots.iter().any(|slot| slot.is_active()) {
        return Err(CourseError::Conflict(SLOT_FILLED_MESSAGE));
    }

    // Use the same conservative reconciliation as the ledger. Field's count
    // sees holds and reservations already using generated inventory; the
    // reservation list also sees older CourseBoard bookings that went through
    // the compatibility manual-slot path. The smaller answer cannot oversell.
    let capacity = matching_slots.iter().map(|slot| slot.capacity()).sum();
    let upstream_remaining = matching_slots
        .iter()
        .map(|slot| slot.available_quantity())
        .sum();
    let booked_groups = reservations
        .iter()
        .filter(|reservation| reservation.is_tee_sheet_candidate())
        .filter(|reservation| reservation.starts_at() == starts_at)
        .filter(|reservation| {
            reservation.golf_course_id() == Some(course_id)
                || reservation.resource_id() == Some(resource_id)
        })
        .count() as i32;
    let remaining =
        reconcile_remaining(Some(capacity), Some(upstream_remaining), booked_groups).unwrap_or(0);
    if remaining <= 0 {
        return Err(CourseError::Conflict(SLOT_FILLED_MESSAGE));
    }
    Ok(())
}

/// Field's guarded update is the final race-safe check. Its public create API
/// currently reports a full generated row as 400, while missing generated
/// inventory is 409; normalize both stale-ledger outcomes to the CourseBoard
/// conflict contract without relabelling unrelated policy/input errors.
fn normalize_inventory_conflict(error: CourseError) -> CourseError {
    match error {
        CourseError::UpstreamClient { status: 409, .. } => {
            CourseError::Conflict(SLOT_FILLED_MESSAGE)
        }
        CourseError::UpstreamClient {
            status: 400,
            message,
        } if message.contains("この時間帯は空きがありません") => {
            CourseError::Conflict(SLOT_FILLED_MESSAGE)
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource(course_id: &str, reservation_resource_id: &str) -> Resource {
        Resource::reconstitute(
            format!("link-{course_id}"),
            "空沼OUT",
            Some(reservation_resource_id.to_string()),
            Some(course_id.to_string()),
            ResourceKind::Course,
            true,
        )
    }

    fn slot(capacity: i32, available: i32) -> ResourceTimeSlot {
        let starts_at = "2026-08-11T22:30:00Z".parse().unwrap();
        ResourceTimeSlot::reconstitute(
            "slot-1",
            starts_at,
            starts_at + Duration::minutes(7),
            capacity,
            capacity - available,
            0,
            available,
            true,
        )
    }

    fn reservation(resource_id: Option<&str>, course_id: Option<&str>) -> Reservation {
        Reservation::reconstitute(
            "rsv-1",
            "R-1",
            Some("service-1".into()),
            resource_id.map(str::to_string),
            Some("本田 康彦".into()),
            "confirmed",
            "2026-08-11T22:30:00Z".parse().unwrap(),
            "2026-08-12T03:00:00Z".parse().unwrap(),
            4,
            course_id.map(str::to_string),
            None,
        )
    }

    fn product(course_ids: Vec<&str>) -> ReservationProduct {
        ReservationProduct::reconstitute_with_course_ids(
            "product-1",
            None,
            "service-1",
            Some("シーズンパス".to_string()),
            crate::course::domain::PlayType::SelfPlay,
            18,
            240,
            course_ids.into_iter().map(str::to_string).collect(),
            None,
        )
    }

    #[test]
    fn product_membership_guards_courseboard_bookings_too() {
        let season_pass = product(vec!["course-east", "course-west"]);
        assert!(validate_product_course(Some(&season_pass), &CourseId::new("course-west")).is_ok());
        assert!(matches!(
            validate_product_course(Some(&season_pass), &CourseId::new("course-north")),
            Err(CourseError::BadRequest(_))
        ));

        // Presence of a canonical but empty scope is fail closed.
        let malformed = product(Vec::new());
        assert!(matches!(
            validate_product_course(Some(&malformed), &CourseId::new("course-east")),
            Err(CourseError::BadRequest(_))
        ));

        // A product from before course scoping existed keeps its compatibility
        // behavior until an operator assigns it a course.
        let legacy_unrestricted = ReservationProduct::reconstitute(
            "legacy-product",
            None,
            "legacy-service",
            None,
            crate::course::domain::PlayType::SelfPlay,
            18,
            240,
            None,
            None,
        );
        assert!(
            validate_product_course(Some(&legacy_unrestricted), &CourseId::new("course-any"))
                .is_ok()
        );
    }

    #[test]
    fn selected_resource_must_be_the_courses_canonical_inventory_resource() {
        let resources = vec![resource("course-1", "inventory-1")];
        assert!(validate_course_resource(
            &resources,
            &CourseId::new("course-1"),
            &ResourceId::new("inventory-1")
        )
        .is_ok());
        assert!(matches!(
            validate_course_resource(
                &resources,
                &CourseId::new("course-2"),
                &ResourceId::new("inventory-1")
            ),
            Err(CourseError::BadRequest(_))
        ));
        assert!(matches!(
            validate_course_resource(
                &resources,
                &CourseId::new("course-1"),
                &ResourceId::new("link-course-1")
            ),
            Err(CourseError::BadRequest(_))
        ));
    }

    #[test]
    fn an_old_manual_booking_fills_the_slot_even_when_field_still_reports_it_open() {
        let result = ensure_slot_available(
            &[slot(1, 1)],
            &[reservation(None, Some("course-1"))],
            "2026-08-11T22:30:00Z".parse().unwrap(),
            &CourseId::new("course-1"),
            &ResourceId::new("inventory-1"),
        );
        assert!(matches!(result, Err(CourseError::Conflict(_))));
    }

    #[test]
    fn fields_held_inventory_wins_when_no_visible_booking_explains_it() {
        let result = ensure_slot_available(
            &[slot(1, 0)],
            &[],
            "2026-08-11T22:30:00Z".parse().unwrap(),
            &CourseId::new("course-1"),
            &ResourceId::new("inventory-1"),
        );
        assert!(matches!(result, Err(CourseError::Conflict(_))));
    }

    #[test]
    fn a_time_without_generated_inventory_is_not_recreated_as_a_manual_slot() {
        let result = ensure_slot_available(
            &[],
            &[],
            "2026-08-11T22:30:00Z".parse().unwrap(),
            &CourseId::new("course-1"),
            &ResourceId::new("inventory-1"),
        );
        assert!(matches!(result, Err(CourseError::Conflict(_))));
    }

    #[test]
    fn an_open_generated_slot_accepts_one_more_group() {
        assert!(ensure_slot_available(
            &[slot(2, 2)],
            &[reservation(None, Some("course-1"))],
            "2026-08-11T22:30:00Z".parse().unwrap(),
            &CourseId::new("course-1"),
            &ResourceId::new("inventory-1"),
        )
        .is_ok());
    }

    #[test]
    fn field_full_conflicts_are_normalized_for_the_ledger() {
        let error = normalize_inventory_conflict(CourseError::UpstreamClient {
            status: 400,
            message: "この時間帯は空きがありません（受付枠が埋まっています）".into(),
        });
        assert!(matches!(error, CourseError::Conflict(SLOT_FILLED_MESSAGE)));
    }
}
