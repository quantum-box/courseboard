//! CreateReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Lets the desk book an empty tee time straight from the ledger, for a
//! walk-in or phone booking that never went through a customer-facing
//! channel. The selected ledger resource is carried to Field so the booking
//! consumes generated inventory rather than a compatibility manual slot.

use std::sync::Arc;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    is_tee_time_closed, parse_tenant_tee_time, parse_tenant_timezone, reconcile_remaining,
    tenant_day_bounds, CourseError, CourseId, CustomerId, GatewayCredentials, GolfCatalogGateway,
    GolfCommercialGateway, MembershipGateway, MembershipPlayWindowsGateway, NewReservation,
    PartyDetails, PlayWindowBreach, Reservation, ReservationGateway, ReservationId,
    ReservationProduct, ReservationScheduleGateway, Resource, ResourceId, ResourceKind,
    ResourceTimeSlot, SlotOverrideGateway, SlotOverrideQuery,
};

/// A round is a day's work at most; anything longer is a typo or an attack.
const MAX_DURATION_MINUTES: i64 = 24 * 60;
const SLOT_FILLED_MESSAGE: &str = "この枠はちょうど埋まりました";
const SLOT_CLOSED_MESSAGE: &str =
    "この時刻は売り止めです。売り止めを解除するか、別の時刻を選んでください";

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

/// A booking that was written, and anything the desk should know about it.
///
/// Warnings never stop the write. The desk takes exceptions every week — a
/// 平日会員 playing Saturday at visitor rates — and refusing would push them
/// into Field's admin to make the booking, which is the outcome CourseBoard
/// exists to avoid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedReservation {
    pub id: ReservationId,
    /// `member_play_window_day` or `member_play_window_time` when the booking
    /// falls outside the customer's membership. Empty is the normal case.
    pub warnings: Vec<&'static str>,
}

pub struct CreateReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    marks: Arc<dyn SlotOverrideGateway>,
    memberships: Arc<dyn MembershipGateway>,
    play_windows: Arc<dyn MembershipPlayWindowsGateway>,
}

impl CreateReservationUseCase {
    // Seven ports, because writing a booking touches seven things: the
    // booking, the catalogue, the schedule, the desk's own marks, and the
    // member's standing. Grouping them into a struct would only move the list.
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        marks: Arc<dyn SlotOverrideGateway>,
        memberships: Arc<dyn MembershipGateway>,
        play_windows: Arc<dyn MembershipPlayWindowsGateway>,
    ) -> Self {
        Self {
            reservations,
            commercial,
            catalog,
            schedules,
            marks,
            memberships,
            play_windows,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: CreateReservationInput,
    ) -> Result<CreatedReservation, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
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

        self.refuse_a_tee_time_the_desk_shut(credentials, &input)
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
        // Kept before the move into `NewReservation`: the membership check
        // below needs the course's own clock to read the weekday.
        let course_timezone = timezone.clone();
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

        let customer_id = new_reservation.customer_id.clone();
        let id = self
            .reservations
            .create_reservation(credentials, &new_reservation)
            .await
            .map_err(normalize_inventory_conflict)?;

        // Checked after the write, deliberately. The booking is not in question
        // — only whether the desk should be told something about it — and a
        // membership read that fails must not lose a tee time that is already
        // sold.
        let warnings = self
            .member_play_window_warnings(
                credentials,
                customer_id.as_ref(),
                starts_at,
                &course_timezone,
            )
            .await;
        Ok(CreatedReservation { id, warnings })
    }

    /// Whether this booking falls outside the customer's membership window.
    ///
    /// Answers with no warning on any failure. This is advice; an unreachable
    /// membership registry is not a reason to put a scare on a booking that is
    /// already written, nor to fail the request that wrote it.
    async fn member_play_window_warnings(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: Option<&CustomerId>,
        starts_at: DateTime<Utc>,
        timezone: &str,
    ) -> Vec<&'static str> {
        let Some(customer_id) = customer_id else {
            return Vec::new();
        };
        let Ok(windows) = self
            .play_windows
            .get_membership_play_windows(credentials.operator_id)
            .await
        else {
            return Vec::new();
        };
        if windows.is_empty() {
            return Vec::new();
        }
        let Ok(membership) = self
            .memberships
            .get_customer_membership(credentials, customer_id)
            .await
        else {
            return Vec::new();
        };
        let Some(plan) = membership.plan() else {
            return Vec::new();
        };
        // The course's own day and clock. A 07:00 JST Saturday round is Friday
        // in UTC, and judging it there would clear a 平日会員 for a weekend.
        let Ok(zone) = parse_tenant_timezone(timezone) else {
            return Vec::new();
        };
        let local = starts_at.with_timezone(&zone);
        match windows.breach_for(Some(plan.id()), local.weekday(), local.time()) {
            Some(PlayWindowBreach::Day) => vec!["member_play_window_day"],
            Some(PlayWindowBreach::Time) => vec!["member_play_window_time"],
            None => Vec::new(),
        }
    }

    /// Refuse a tee time the desk has marked closed.
    ///
    /// The mark is CourseBoard's own record and Field knows nothing about it,
    /// so nothing upstream refuses this booking. The rule used to be enforced
    /// only by the ledger's own code, which made 売り止め a convention of one
    /// screen rather than a property of the tee time — anything arriving at the
    /// API another way sold the slot regardless.
    ///
    /// A read that fails refuses the booking rather than waving it through. The
    /// table is local and ours, so if it cannot be read then one unsold tee
    /// time is the smaller of the club's problems; a group standing on a slot
    /// somebody deliberately shut is not something the desk can undo by
    /// looking at the board.
    async fn refuse_a_tee_time_the_desk_shut(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &CreateReservationInput,
    ) -> Result<(), CourseError> {
        let query = SlotOverrideQuery {
            date: input.date,
            course_ids: vec![input.golf_course_id.clone()],
        };
        let marks = self
            .marks
            .list_slot_overrides(credentials.operator_id, &query)
            .await?;
        if is_tee_time_closed(&marks, &input.tee_time)? {
            return Err(CourseError::BadRequest(SLOT_CLOSED_MESSAGE));
        }
        Ok(())
    }

    /// The plan the desk picked, if it named one.
    ///
    /// Naming none is allowed: the desk takes calls faster than it can decide
    /// what to sell, and a booking refused for want of a plan is a tee time
    /// nobody sold. A name that matches nothing is a different thing — the
    /// ledger the caller is working from is stale, or nobody is working from
    /// one at all.
    async fn product_for_service(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: Option<&str>,
    ) -> Result<Option<ReservationProduct>, CourseError> {
        let Some(service_id) = service_id.map(str::trim).filter(|id| !id.is_empty()) else {
            return Ok(None);
        };
        let products = self.catalog.list_reservation_products(credentials).await?;
        find_named_product(products, service_id).map(Some)
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

/// Resolve a named plan, refusing a name that matches nothing.
///
/// Answering "no plan" to a name the catalog does not carry looked harmless,
/// but the plan is what [`validate_product_course`] checks the course against
/// and what decides whether the round needs a caddie. A booking naming a plan
/// that does not exist was therefore taking the path of a booking that named
/// none, skipping both — a stale ledger could sell a course its plan was never
/// scoped to.
fn find_named_product(
    products: Vec<ReservationProduct>,
    service_id: &str,
) -> Result<ReservationProduct, CourseError> {
    products
        .into_iter()
        .find(|product| product.reservation_service_id().as_str() == service_id)
        .ok_or(CourseError::BadRequest(
            "選んだプレー商品が見つかりません。台帳を読み込み直してから、もう一度お試しください",
        ))
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
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        AvailabilityRule, BookingHorizon, Course, CourseOrder, DailyBudget, DailyBudgetQuery,
        DeleteSlotOverrides, ExtensionStatus, GenerationSummary, MonthlySettlement, PlayType,
        ProductSlot, ReservationBookingUpdate, ReservationPolicy, ReservationServiceId,
        SaveCourseResource, SeededReservation, SlotOverride, SlotOverrideKind,
        UpdateExtensionConfig, UpdateReservationPolicy, UpsertCourse, UpsertDailyBudget,
        UpsertReservationProduct,
    };

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

    fn mark(tee_time: &str, kind: SlotOverrideKind) -> SlotOverride {
        SlotOverride::try_new(
            CourseId::new("course-1"),
            NaiveDate::from_ymd_opt(2026, 8, 12).unwrap(),
            tee_time,
            kind,
            None,
            None,
        )
        .unwrap()
    }

    #[test]
    fn a_plan_the_catalog_does_not_carry_is_refused_rather_than_read_as_no_plan() {
        let catalog = vec![product(vec!["course-east"])];
        assert!(find_named_product(catalog.clone(), "service-1").is_ok());
        // Reading this as "no plan" skipped the course check the named plan
        // would have gone through, so a stale ledger could sell a course the
        // plan was never scoped to.
        assert!(matches!(
            find_named_product(catalog, "service-gone"),
            Err(CourseError::BadRequest(_))
        ));
    }

    #[test]
    fn a_closed_tee_time_is_refused_however_the_booking_arrived() {
        let marks = vec![mark("07:14", SlotOverrideKind::Closed)];
        assert!(is_tee_time_closed(&marks, "07:14").unwrap());
        // The rows either side of a closed one stay on sale: the desk shuts a
        // tee time, not the morning around it.
        assert!(!is_tee_time_closed(&marks, "07:07").unwrap());
    }

    #[test]
    fn a_special_rate_slot_still_sells() {
        // The mark says what it costs, not whether it may be sold. Treating the
        // two alike would take the course's busiest rows off the board.
        let marks = vec![mark("07:14", SlotOverrideKind::SpecialRate)];
        assert!(!is_tee_time_closed(&marks, "07:14").unwrap());
    }

    #[test]
    fn a_tee_time_that_is_not_a_clock_is_refused_rather_than_read_as_unmarked() {
        // Answering "not closed" to something that cannot be compared would let
        // a malformed tee time walk straight past the mark.
        let marks = vec![mark("07:14", SlotOverrideKind::Closed)];
        assert!(matches!(
            is_tee_time_closed(&marks, "7:14"),
            Err(CourseError::BadRequest(_))
        ));
    }

    #[test]
    fn field_full_conflicts_are_normalized_for_the_ledger() {
        let error = normalize_inventory_conflict(CourseError::UpstreamClient {
            status: 400,
            message: "この時間帯は空きがありません（受付枠が埋まっています）".into(),
        });
        assert!(matches!(error, CourseError::Conflict(SLOT_FILLED_MESSAGE)));
    }

    #[derive(Default)]
    struct RecordingReservationGateway {
        created: Mutex<Vec<NewReservation>>,
    }

    #[async_trait]
    impl ReservationGateway for RecordingReservationGateway {
        async fn list_customer_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &CustomerId,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("booking a tee time never reads a customer's history")
        }

        async fn list_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Reservation>, CourseError> {
            Ok(Vec::new())
        }

        async fn get_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
        ) -> Result<Reservation, CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _service_id: &ReservationServiceId,
            _ends_at: DateTime<Utc>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_booking(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _update: &ReservationBookingUpdate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_party(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _party: &PartyDetails,
        ) -> Result<PartyDetails, CourseError> {
            unimplemented!("not used")
        }

        async fn list_reservation_type_ids(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<String>, CourseError> {
            Ok(vec!["reservation-type-1".to_string()])
        }

        async fn list_seeded_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<SeededReservation>, CourseError> {
            unimplemented!("not used")
        }

        async fn create_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: &NewReservation,
        ) -> Result<ReservationId, CourseError> {
            self.created.lock().expect("lock").push(input.clone());
            Ok(ReservationId::new("reservation-created"))
        }

        async fn cancel_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _reason: Option<&str>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn replace_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _input: &NewReservation,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }
    }

    fn caddie_product() -> ReservationProduct {
        ReservationProduct::reconstitute_with_course_ids(
            "product-caddie-1",
            None,
            "service-1",
            Some("キャディ付き".to_string()),
            PlayType::Caddie,
            18,
            240,
            vec!["course-1".to_string()],
            None,
        )
    }

    struct BookingCatalogGateway;

    #[async_trait]
    impl GolfCatalogGateway for BookingCatalogGateway {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok("Asia/Tokyo".to_string())
        }

        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            unimplemented!("not used")
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used")
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(vec![resource("course-1", "inventory-1")])
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<ResourceId, CourseError> {
            unimplemented!("not used")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unimplemented!("not used")
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            _order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used")
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            Ok(vec![caddie_product()])
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            unimplemented!("not used")
        }

        async fn list_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used")
        }
    }

    struct NoReservationPolicyGateway;

    #[async_trait]
    impl GolfCommercialGateway for NoReservationPolicyGateway {
        async fn get_reservation_policy(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<ReservationPolicy, CourseError> {
            Err(CourseError::NotFound("reservation policy"))
        }

        async fn update_reservation_policy(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpdateReservationPolicy,
        ) -> Result<ReservationPolicy, CourseError> {
            unimplemented!("not used")
        }

        async fn list_daily_budgets(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: DailyBudgetQuery,
        ) -> Result<Vec<DailyBudget>, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_daily_budget(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertDailyBudget,
        ) -> Result<DailyBudget, CourseError> {
            unimplemented!("not used")
        }

        async fn import_daily_budgets_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _csv: &str,
        ) -> Result<Vec<DailyBudget>, CourseError> {
            unimplemented!("not used")
        }

        async fn get_monthly_settlement(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
            _timezone: &str,
        ) -> Result<MonthlySettlement, CourseError> {
            unimplemented!("not used")
        }

        async fn export_monthly_settlement_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
            _timezone: &str,
        ) -> Result<String, CourseError> {
            unimplemented!("not used")
        }

        async fn get_extension_status(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Option<ExtensionStatus>, CourseError> {
            unimplemented!("not used")
        }

        async fn update_extension_config(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpdateExtensionConfig,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn get_booking_horizon(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<BookingHorizon, CourseError> {
            unimplemented!("not used")
        }

        async fn set_booking_horizon(
            &self,
            _credentials: GatewayCredentials<'_>,
            _horizon: &BookingHorizon,
        ) -> Result<BookingHorizon, CourseError> {
            unimplemented!("not used")
        }
    }

    struct OpenReservationScheduleGateway;

    #[async_trait]
    impl ReservationScheduleGateway for OpenReservationScheduleGateway {
        async fn get_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _timezone: &str,
            _rules: &[AvailabilityRule],
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            unimplemented!("not used")
        }

        async fn generate_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _from: NaiveDate,
            _to: NaiveDate,
            _dry_run: bool,
        ) -> Result<GenerationSummary, CourseError> {
            unimplemented!("not used")
        }

        async fn list_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _from: DateTime<Utc>,
            _to: DateTime<Utc>,
        ) -> Result<Vec<ResourceTimeSlot>, CourseError> {
            Ok(vec![slot(1, 1)])
        }
    }

    struct EmptySlotOverrideGateway;

    #[async_trait]
    impl SlotOverrideGateway for EmptySlotOverrideGateway {
        async fn list_slot_overrides(
            &self,
            _tenant_id: &str,
            _query: &SlotOverrideQuery,
        ) -> Result<Vec<SlotOverride>, CourseError> {
            Ok(Vec::new())
        }

        async fn upsert_slot_overrides(
            &self,
            _tenant_id: &str,
            _overrides: &[SlotOverride],
        ) -> Result<Vec<SlotOverride>, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_slot_overrides(
            &self,
            _tenant_id: &str,
            _command: &DeleteSlotOverrides,
        ) -> Result<u64, CourseError> {
            unimplemented!("not used")
        }
    }

    fn booking_credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer test",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    fn caddie_booking_input() -> CreateReservationInput {
        CreateReservationInput {
            golf_course_id: CourseId::new("course-1"),
            reservation_resource_id: ResourceId::new("inventory-1"),
            reservation_service_id: Some("service-1".to_string()),
            date: NaiveDate::from_ymd_opt(2026, 8, 12).expect("date"),
            tee_time: "07:30".to_string(),
            duration_minutes: 240,
            quantity: 4,
            customer_name: "予約者".to_string(),
            customer_id: None,
            party: PartyDetails::default(),
        }
    }

    /// Never consulted: this booking carries nobody from the ledger, so there
    /// is no membership to check a playing window against.
    struct UnreadMembershipGateway;

    #[async_trait]
    impl crate::course::domain::MembershipGateway for UnreadMembershipGateway {
        async fn list_membership_plans(
            &self,
            _credentials: GatewayCredentials<'_>,
            _include_inactive: bool,
        ) -> Result<Vec<crate::course::domain::MembershipPlan>, CourseError> {
            unreachable!("booking a tee time never lists the plans")
        }

        async fn create_membership_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &crate::course::domain::UpsertMembershipPlan,
        ) -> Result<crate::course::domain::MembershipPlan, CourseError> {
            unreachable!("booking a tee time never sells a plan")
        }

        async fn update_membership_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _plan_id: &crate::course::domain::MembershipPlanId,
            _input: &crate::course::domain::UpsertMembershipPlan,
        ) -> Result<crate::course::domain::MembershipPlan, CourseError> {
            unreachable!("booking a tee time never edits a plan")
        }

        async fn get_customer_membership(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &CustomerId,
        ) -> Result<crate::course::domain::CustomerMembership, CourseError> {
            unreachable!("this booking has no customer to read a membership for")
        }

        async fn assign_membership_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &crate::course::domain::AssignMembershipPlan,
        ) -> Result<crate::course::domain::CustomerMembership, CourseError> {
            unreachable!("booking a tee time never grants a membership")
        }

        async fn set_member_number(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &crate::course::domain::SetMemberNumber,
        ) -> Result<crate::course::domain::CustomerMembership, CourseError> {
            unreachable!("booking a tee time never numbers a member")
        }
    }

    /// A club that restricts no membership: the ordinary case, and the one
    /// where a booking must go through without a word about playing windows.
    struct NoPlayWindowsGateway;

    #[async_trait]
    impl MembershipPlayWindowsGateway for NoPlayWindowsGateway {
        async fn get_membership_play_windows(
            &self,
            _tenant_id: &str,
        ) -> Result<crate::course::domain::MembershipPlayWindows, CourseError> {
            Ok(crate::course::domain::MembershipPlayWindows::default())
        }

        async fn replace_membership_play_windows(
            &self,
            _tenant_id: &str,
            _windows: &crate::course::domain::MembershipPlayWindows,
        ) -> Result<crate::course::domain::MembershipPlayWindows, CourseError> {
            unreachable!("booking a tee time never writes the playing windows")
        }
    }

    #[tokio::test]
    async fn a_caddie_booking_reaches_field_without_a_caddie_supply_guard() {
        // The constructor signature is structural evidence: no caddie-supply
        // gateway can enter this path. It cannot detect a guard reintroduced
        // through a different data source, so the fixture assertion below
        // keeps this regression focused on a caddie booking.
        assert_eq!(caddie_product().play_type(), PlayType::Caddie);
        let reservations = std::sync::Arc::new(RecordingReservationGateway::default());
        let use_case = CreateReservationUseCase::new(
            reservations.clone(),
            std::sync::Arc::new(NoReservationPolicyGateway),
            std::sync::Arc::new(BookingCatalogGateway),
            std::sync::Arc::new(OpenReservationScheduleGateway),
            std::sync::Arc::new(EmptySlotOverrideGateway),
            std::sync::Arc::new(UnreadMembershipGateway),
            std::sync::Arc::new(NoPlayWindowsGateway),
        );

        let created = use_case
            .execute(booking_credentials(), caddie_booking_input())
            .await
            .expect("caddie booking should be created");

        assert_eq!(created.id, ReservationId::new("reservation-created"));
        // A booking with nobody from the ledger on it has nothing to warn about.
        assert!(created.warnings.is_empty());
        let created_inputs = reservations.created.lock().expect("lock");
        assert_eq!(created_inputs.len(), 1);
        assert_eq!(
            created_inputs[0].reservation_service_id.as_deref(),
            Some("service-1")
        );
    }
}
