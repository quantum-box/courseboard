//! CreateReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Lets the desk book an empty tee time straight from the ledger, for a
//! walk-in or phone booking that never went through a customer-facing
//! channel. The selected ledger resource is carried to Field so the booking
//! consumes generated inventory rather than a compatibility manual slot.

use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDate, Utc};

use crate::course::domain::{
    course_day_bounds, parse_jst_tee_time, reconcile_remaining, CourseError, CourseId,
    GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway, NewReservation, PartyDetails,
    Reservation, ReservationGateway, ReservationId, ReservationScheduleGateway, Resource,
    ResourceId, ResourceKind, ResourceTimeSlot,
};

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
}

pub struct CreateReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl CreateReservationUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self {
            reservations,
            commercial,
            catalog,
            schedules,
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

        let starts_at = parse_jst_tee_time(input.date, &input.tee_time)?;
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

        let (window_start, window_end) = course_day_bounds(input.date, input.date);
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
            quantity: input.quantity,
            customer_name: customer_name.to_string(),
            golf_course_id: input.golf_course_id,
            party: PartyDetails::try_new(None, None, None, Vec::new())?,
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
