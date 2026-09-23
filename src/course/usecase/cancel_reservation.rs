//! CancelReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Cancels a booking from the desk — a caller who cannot make their tee time.
//!
//! Three things happen, in an order chosen by what is recoverable. The booking
//! is read first, because once Field has cancelled it the tee time, the money,
//! and who booked are gone from every board CourseBoard draws. Then Field is
//! told, and that is the step that may fail the request: if the booking is
//! still live the desk has to know. Everything after it — the club's own
//! record of why, and taking the caddies off the group — is written on a
//! best-effort basis, because answering with an error would tell the desk the
//! cancellation did not happen and invite them to run it again.
//!
//! The reason is kept in CourseBoard rather than upstream. Field records the
//! cancellation and its moment and has nowhere to put why (PLT-3297), and the
//! club's reading of it — one of golf's own reasons, chargeable or not — is
//! ours either way (ADR-0009). Field is still told the sentence, so a booking
//! read upstream is not silent about it.
//!
//! Cancelling also takes the caddies off the group. A booking and the rows
//! saying who walks it live apart, and nothing upstream ties them together, so
//! a cancelled group used to leave its caddie assigned to a round that no
//! longer exists — counted against their daily limit, and counted again in the
//! month's payroll.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    notice_days_between, tenant_date_at, CaddieAssignment, CaddieAssignmentQuery,
    CancellationDetails, CourseError, GatewayCredentials, GolfCatalogGateway, GolfOpsGateway,
    NewReservationCancellation, Reservation, ReservationCancellationGateway, ReservationGateway,
    ReservationId, UpsertCaddieAssignment,
};

/// What a caddie's row becomes once the group is gone.
const CANCELLED_STATUS: &str = "cancelled";

pub struct CancelReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    ops: Arc<dyn GolfOpsGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    cancellations: Arc<dyn ReservationCancellationGateway>,
}

impl CancelReservationUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        ops: Arc<dyn GolfOpsGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        cancellations: Arc<dyn ReservationCancellationGateway>,
    ) -> Self {
        Self {
            reservations,
            ops,
            catalog,
            cancellations,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        details: &CancellationDetails,
        cancelled_by: Option<&str>,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        if reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }

        // Read before writing. What the booking was worth and when it would
        // have been played is only answerable while it is still a booking, and
        // it is what the fee is later worked out from.
        //
        // A read that fails does not stop the cancellation: the caller is on
        // the phone and the tee time has to come off the sheet. It costs the
        // snapshot, and the row is still written with the reason on it.
        let booking = match self
            .reservations
            .get_reservation(credentials, reservation_id)
            .await
        {
            Ok(booking) => Some(booking),
            Err(error) => {
                tracing::warn!(
                    %reservation_id,
                    %error,
                    "could not read the booking before cancelling it; \
                     the cancellation will be recorded without its detail",
                );
                None
            }
        };

        self.reservations
            .cancel_reservation(
                credentials,
                reservation_id,
                Some(&details.upstream_reason()),
            )
            .await?;

        self.record(
            credentials,
            reservation_id,
            booking.as_ref(),
            details,
            cancelled_by,
        )
        .await;
        self.release_caddies(credentials, reservation_id).await;
        Ok(())
    }

    /// Keep the club's own reading of the cancellation.
    ///
    /// Best effort by the time this runs: the booking is already gone upstream,
    /// and a failure here loses the reason rather than leaving a tee time the
    /// desk thinks they cancelled.
    async fn record(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        booking: Option<&Reservation>,
        details: &CancellationDetails,
        cancelled_by: Option<&str>,
    ) {
        // The day of play is a tenant-timezone question — a morning group in
        // Japan starts before midnight UTC — so it is answered here rather
        // than by whichever screen happens to be asking. A timezone that
        // cannot be read costs the day, not the row.
        let timezone = match self.catalog.get_tenant_timezone(credentials).await {
            Ok(timezone) => Some(timezone),
            Err(error) => {
                tracing::warn!(%reservation_id, %error, "could not read the tenant timezone");
                None
            }
        };
        let played_on = booking.zip(timezone.as_deref()).and_then(|(booking, tz)| {
            tenant_date_at(booking.starts_at(), tz)
                .inspect_err(|error| tracing::warn!(%reservation_id, %error, "unreadable timezone"))
                .ok()
        });
        let cancelled_on = timezone
            .as_deref()
            .and_then(|tz| tenant_date_at(chrono::Utc::now(), tz).ok());
        let cancellation = NewReservationCancellation {
            reservation_id: reservation_id.clone(),
            reservation_number: booking.map(|booking| booking.reservation_number().to_string()),
            customer_id: booking.and_then(|booking| booking.customer_id().cloned()),
            customer_name: booking.and_then(|booking| booking.customer_name().map(str::to_string)),
            golf_course_id: booking.and_then(|booking| booking.golf_course_id().cloned()),
            tee_time: booking.map(Reservation::starts_at),
            played_on,
            players: booking
                .map(|booking| booking.party_size().max(0) as u32)
                .unwrap_or(0),
            booking_amount: booking.map(|booking| booking.billing().price_amount),
            currency: booking.and_then(|booking| booking.billing().currency.clone()),
            reason: details.reason,
            reason_note: details.note.clone(),
            notice_days: played_on
                .zip(cancelled_on)
                .map(|(played_on, cancelled_on)| notice_days_between(cancelled_on, played_on)),
            cancelled_by: cancelled_by.map(str::to_string),
        };
        if let Err(error) = self
            .cancellations
            .record_cancellation(credentials.operator_id, &cancellation)
            .await
        {
            tracing::warn!(
                %reservation_id,
                %error,
                "cancelled the booking but could not record why; \
                 it will not appear on the cancellation list",
            );
        }
    }

    /// Take the caddies off a group that is no longer being played.
    ///
    /// The booking is already cancelled by the time this runs, so a failure
    /// here is recorded and swallowed rather than returned: answering with an
    /// error would tell the desk the cancellation did not happen and invite
    /// them to run it again. What a failure leaves behind is the state this
    /// code exists to fix, never a worse one.
    async fn release_caddies(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
    ) {
        let query = CaddieAssignmentQuery {
            reservation_id: Some(reservation_id.clone()),
            ..CaddieAssignmentQuery::default()
        };
        let assignments = match self.ops.list_caddie_assignments(credentials, query).await {
            Ok(assignments) => assignments,
            Err(error) => {
                tracing::warn!(
                    %reservation_id,
                    %error,
                    "cancelled the booking but could not read its caddie assignments; \
                     they may still show the caddie as booked",
                );
                return;
            }
        };
        // The query already asks for this booking, but releasing a caddie from
        // someone else's group would be a far worse bug than leaving one on a
        // cancelled one — so the booking is checked again on what came back.
        for assignment in assignments
            .iter()
            .filter(|assignment| assignment.covers_reservation(reservation_id))
            .filter(|assignment| assignment.holds_the_round())
        {
            if let Err(error) = self
                .ops
                .update_caddie_assignment(credentials, assignment.id(), cancelled_from(assignment))
                .await
            {
                tracing::warn!(
                    %reservation_id,
                    assignment_id = %assignment.id(),
                    %error,
                    "cancelled the booking but could not release its caddie",
                );
            }
        }
    }
}

/// The same row, marked cancelled.
///
/// Field replaces the whole assignment on a write, so every field it keeps is
/// sent back as it stands. The recommendation score is the exception: the
/// assignment does not carry one once read, and a row nobody will walk has no
/// use for it.
fn cancelled_from(assignment: &CaddieAssignment) -> UpsertCaddieAssignment {
    UpsertCaddieAssignment {
        caddie_id: assignment.caddie_id().clone(),
        reservation_id: assignment.reservation_id().cloned(),
        round_reference: assignment.round_reference().map(str::to_string),
        scheduled_at: assignment.scheduled_at(),
        status: Some(CANCELLED_STATUS.to_string()),
        assignment_role: Some(assignment.role_label().to_string()),
        fee_amount: Some(assignment.fee_amount()),
        fee_currency: Some(assignment.fee_currency().to_string()),
        recommendation_score: None,
        notes: assignment.notes().map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::{NaiveDate, TimeZone, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, Caddie,
        CaddieAvailability, CaddieCourseMembership, CaddieId, CaddieRankFees, CaddieRating,
        CaddieRoster, CaddieStaff, CancellationQuery, CancellationReason, Course, CourseId,
        CourseOrder, NewReservation, PartyDetails, ProductSlot, ReplaceCaddieMemberships,
        Reservation, ReservationBilling, ReservationCancellation, ReservationProduct,
        ReservationServiceId, Resource, SeededReservation, UpsertCaddie, UpsertCaddieAvailability,
        UpsertCourse, UpsertReservationProduct, DEFAULT_TIMEZONE,
    };

    /// A booking that reads like a real one: a customer, a tee time, and a
    /// price, which is everything the recorded cancellation snapshots.
    fn booking() -> Reservation {
        Reservation::reconstitute(
            "rsv_1",
            "RSV-1001",
            None,
            None,
            Some("本田 康彦".to_string()),
            "confirmed",
            Utc.with_ymd_and_hms(2026, 8, 9, 23, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 10, 3, 30, 0).unwrap(),
            4,
            Some("course_east".to_string()),
            None,
        )
        .with_customer_id(Some(crate::course::domain::CustomerId::new("cus_1")))
        .with_billing(ReservationBilling {
            price_amount: 48_000,
            currency: Some("JPY".to_string()),
            ..ReservationBilling::default()
        })
    }

    /// CourseBoard's own storage for why a booking came off the board.
    #[derive(Default)]
    struct FakeCancellations {
        recorded: Mutex<Vec<NewReservationCancellation>>,
        write_fails: bool,
    }

    #[async_trait]
    impl ReservationCancellationGateway for FakeCancellations {
        async fn record_cancellation(
            &self,
            _tenant_id: &str,
            cancellation: &NewReservationCancellation,
        ) -> Result<(), CourseError> {
            if self.write_fails {
                return Err(CourseError::Provider("the database is down".into()));
            }
            self.recorded
                .lock()
                .expect("lock")
                .push(cancellation.clone());
            Ok(())
        }

        async fn list_cancellations(
            &self,
            _tenant_id: &str,
            _query: &CancellationQuery,
        ) -> Result<Vec<ReservationCancellation>, CourseError> {
            unimplemented!("not used")
        }

        async fn count_cancellations(
            &self,
            _tenant_id: &str,
            _query: &CancellationQuery,
        ) -> Result<i64, CourseError> {
            unimplemented!("not used")
        }

        async fn settle_cancellation_fees(
            &self,
            _tenant_id: &str,
            _decisions: &[crate::course::domain::CancellationFeeDecision],
        ) -> Result<Vec<ReservationCancellation>, CourseError> {
            unimplemented!("not used")
        }
    }

    /// Only ever asked for the tenant's timezone here.
    struct FakeCatalog;

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok(DEFAULT_TIMEZONE.to_string())
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<crate::course::domain::ResourceId, CourseError> {
            unimplemented!("not used")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: crate::course::domain::SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unimplemented!("not used")
        }

        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            Ok(Vec::new())
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
            Ok(Vec::new())
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            Ok(CourseOrder::default())
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            Ok(order.clone())
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            Ok(Vec::new())
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
            Ok(Vec::new())
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

    struct FakeReservations {
        cancelled: Mutex<Vec<(String, Option<String>)>>,
        booking: Option<Reservation>,
    }

    impl FakeReservations {
        fn holding_a_booking() -> Self {
            Self {
                cancelled: Mutex::new(Vec::new()),
                booking: Some(booking()),
            }
        }
    }

    #[async_trait]
    impl ReservationGateway for FakeReservations {
        async fn list_tenant_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("only the summary refresh sweeps the tenant")
        }

        async fn list_customer_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &crate::course::domain::CustomerId,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("not used by this test")
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
            self.booking
                .clone()
                .ok_or(CourseError::Provider("field is down".into()))
        }

        async fn update_reservation_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _service_id: &crate::course::domain::ReservationServiceId,
            _ends_at: chrono::DateTime<chrono::Utc>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_booking(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _update: &crate::course::domain::ReservationBookingUpdate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_party(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            party: &PartyDetails,
        ) -> Result<PartyDetails, CourseError> {
            Ok(party.clone())
        }

        async fn list_reservation_type_ids(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<String>, CourseError> {
            Ok(Vec::new())
        }

        async fn list_seeded_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<SeededReservation>, CourseError> {
            Ok(Vec::new())
        }

        async fn create_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewReservation,
        ) -> Result<ReservationId, CourseError> {
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

        async fn cancel_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            reservation_id: &ReservationId,
            reason: Option<&str>,
        ) -> Result<(), CourseError> {
            self.cancelled
                .lock()
                .expect("lock")
                .push((reservation_id.to_string(), reason.map(str::to_string)));
            Ok(())
        }
    }

    /// Answers every assignment it holds, whatever the query asks for: the
    /// booking filter belongs to the adapter, and the use case must not depend
    /// on it having been applied.
    struct FakeOps {
        assignments: Vec<CaddieAssignment>,
        writes: Mutex<Vec<(String, UpsertCaddieAssignment)>>,
        write_fails: bool,
    }

    impl FakeOps {
        fn holding(assignments: Vec<CaddieAssignment>) -> Self {
            Self {
                assignments,
                writes: Mutex::new(Vec::new()),
                write_fails: false,
            }
        }
    }

    #[async_trait]
    impl GolfOpsGateway for FakeOps {
        async fn list_caddie_roster(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRoster, CourseError> {
            Ok(CaddieRoster::new(vec![], vec![]))
        }

        async fn create_staff(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<CaddieStaff, CourseError> {
            unimplemented!("not used")
        }

        async fn create_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            unimplemented!("not used")
        }

        async fn update_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn list_caddie_assignments(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: CaddieAssignmentQuery,
        ) -> Result<Vec<CaddieAssignment>, CourseError> {
            Ok(self.assignments.clone())
        }

        async fn create_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            unimplemented!("not used")
        }

        async fn update_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            assignment_id: &AssignmentId,
            input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            if self.write_fails {
                return Err(CourseError::Provider("field is down".into()));
            }
            self.writes
                .lock()
                .expect("lock")
                .push((assignment_id.to_string(), input.clone()));
            Ok(assignment(
                assignment_id,
                input.reservation_id.as_deref().unwrap_or(""),
                input.status.as_deref().unwrap_or("assigned"),
            ))
        }

        async fn list_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            Ok(vec![])
        }

        async fn list_memberships_for(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_ids: &[CaddieId],
        ) -> Result<std::collections::HashMap<String, Vec<CaddieCourseMembership>>, CourseError>
        {
            Ok(std::collections::HashMap::new())
        }

        async fn replace_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: ReplaceCaddieMemberships,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            Ok(vec![])
        }

        async fn list_caddie_availabilities(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: crate::course::domain::AvailabilityQuery,
        ) -> Result<Vec<CaddieAvailability>, CourseError> {
            Ok(vec![])
        }

        async fn upsert_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAvailability,
        ) -> Result<CaddieAvailability, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _date: NaiveDate,
        ) -> Result<(), CourseError> {
            Ok(())
        }

        async fn get_attendance_snapshot(
            &self,
            _credentials: GatewayCredentials<'_>,
            date: Option<NaiveDate>,
            _timezone: &str,
        ) -> Result<AttendanceSnapshotReport, CourseError> {
            Ok(AttendanceSnapshotReport::new(
                date.unwrap_or_else(|| NaiveDate::from_ymd_opt(2026, 8, 10).unwrap()),
                vec![],
            ))
        }

        async fn list_attendance_period_snapshots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
            Ok(vec![])
        }

        async fn get_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRankFees, CourseError> {
            Ok(CaddieRankFees::default())
        }

        async fn replace_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
            fees: &CaddieRankFees,
        ) -> Result<CaddieRankFees, CourseError> {
            Ok(fees.clone())
        }

        async fn list_caddie_ratings(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: Option<&CaddieId>,
        ) -> Result<Vec<CaddieRating>, CourseError> {
            Ok(vec![])
        }

        async fn list_worked_minutes(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
        ) -> Result<
            std::collections::HashMap<String, crate::course::domain::WorkedMinutes>,
            CourseError,
        > {
            Ok(std::collections::HashMap::new())
        }
    }

    fn assignment(id: &str, reservation_id: &str, status: &str) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            id,
            "cad_1",
            Some(reservation_id.to_string()),
            None,
            Utc.with_ymd_and_hms(2026, 8, 9, 22, 0, 0).unwrap(),
            Some(270),
            status,
            "primary",
            12_000,
            "JPY",
            None,
        )
        .expect("assignment")
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer t",
            operator_id: "scc",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    fn details(reason: CancellationReason, note: Option<&str>) -> CancellationDetails {
        CancellationDetails::try_new(reason, note).expect("details")
    }

    /// The four collaborators, wired the way `execute` takes them.
    fn use_case(
        reservations: Arc<FakeReservations>,
        ops: Arc<FakeOps>,
        cancellations: Arc<FakeCancellations>,
    ) -> CancelReservationUseCase {
        CancelReservationUseCase::new(reservations, ops, Arc::new(FakeCatalog), cancellations)
    }

    #[tokio::test]
    async fn cancelling_a_booking_takes_its_caddie_off_the_round() {
        let ops = Arc::new(FakeOps::holding(vec![assignment(
            "asn_1", "rsv_1", "assigned",
        )]));
        let reservations = Arc::new(FakeReservations::holding_a_booking());

        use_case(reservations.clone(), ops.clone(), Arc::default())
            .execute(
                credentials(),
                &ReservationId::new("rsv_1"),
                &details(CancellationReason::Personal, None),
                None,
            )
            .await
            .expect("cancel");

        assert_eq!(reservations.cancelled.lock().expect("lock").len(), 1);
        let writes = ops.writes.lock().expect("lock");
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, "asn_1");
        assert_eq!(writes[0].1.status.as_deref(), Some("cancelled"));
    }

    #[tokio::test]
    async fn the_reason_is_kept_here_with_what_the_booking_was_worth() {
        // The point of reading the booking first: once Field has cancelled it,
        // the tee time and the price are gone from every board, and they are
        // what a cancellation fee is later worked out from.
        let cancellations = Arc::new(FakeCancellations::default());
        use_case(
            Arc::new(FakeReservations::holding_a_booking()),
            Arc::new(FakeOps::holding(vec![])),
            cancellations.clone(),
        )
        .execute(
            credentials(),
            &ReservationId::new("rsv_1"),
            &details(CancellationReason::NoContact, Some("連絡がつかず")),
            Some("user-1"),
        )
        .await
        .expect("cancel");

        let recorded = cancellations.recorded.lock().expect("lock");
        assert_eq!(recorded.len(), 1);
        let row = &recorded[0];
        assert_eq!(row.reason, CancellationReason::NoContact);
        assert_eq!(row.reason_note.as_deref(), Some("連絡がつかず"));
        assert_eq!(
            row.customer_id.as_ref().map(|id| id.as_str()),
            Some("cus_1")
        );
        assert_eq!(row.customer_name.as_deref(), Some("本田 康彦"));
        assert_eq!(row.reservation_number.as_deref(), Some("RSV-1001"));
        assert_eq!(row.booking_amount, Some(48_000));
        assert_eq!(row.players, 4);
        assert_eq!(row.cancelled_by.as_deref(), Some("user-1"));
        // 23:00 UTC on the 9th is the morning of the 10th in Tokyo. Getting
        // this wrong would file a whole morning's cancellations under the day
        // before, and every period filter would be off by one.
        assert_eq!(
            row.played_on,
            Some(NaiveDate::from_ymd_opt(2026, 8, 10).unwrap())
        );
    }

    #[tokio::test]
    async fn field_is_still_told_why_even_though_it_cannot_keep_it() {
        let reservations = Arc::new(FakeReservations::holding_a_booking());
        use_case(
            reservations.clone(),
            Arc::new(FakeOps::holding(vec![])),
            Arc::default(),
        )
        .execute(
            credentials(),
            &ReservationId::new("rsv_1"),
            &details(CancellationReason::Weather, Some("大雨のため")),
            None,
        )
        .await
        .expect("cancel");

        let cancelled = reservations.cancelled.lock().expect("lock");
        assert_eq!(cancelled[0].1.as_deref(), Some("[weather] 大雨のため"));
    }

    #[tokio::test]
    async fn a_booking_that_could_not_be_read_is_still_cancelled_and_still_recorded() {
        // The caller is on the phone. Losing the snapshot is a cost; leaving
        // the tee time on the sheet is a failure.
        let reservations = Arc::new(FakeReservations {
            cancelled: Mutex::new(Vec::new()),
            booking: None,
        });
        let cancellations = Arc::new(FakeCancellations::default());

        use_case(
            reservations.clone(),
            Arc::new(FakeOps::holding(vec![])),
            cancellations.clone(),
        )
        .execute(
            credentials(),
            &ReservationId::new("rsv_1"),
            &details(CancellationReason::Personal, None),
            None,
        )
        .await
        .expect("cancel");

        assert_eq!(reservations.cancelled.lock().expect("lock").len(), 1);
        let recorded = cancellations.recorded.lock().expect("lock");
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].reason, CancellationReason::Personal);
        assert_eq!(recorded[0].played_on, None);
        assert_eq!(recorded[0].booking_amount, None);
    }

    #[tokio::test]
    async fn a_cancellation_that_could_not_be_recorded_is_not_reported_as_failed() {
        let reservations = Arc::new(FakeReservations::holding_a_booking());
        let result = use_case(
            reservations.clone(),
            Arc::new(FakeOps::holding(vec![])),
            Arc::new(FakeCancellations {
                recorded: Mutex::new(Vec::new()),
                write_fails: true,
            }),
        )
        .execute(
            credentials(),
            &ReservationId::new("rsv_1"),
            &details(CancellationReason::Personal, None),
            None,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(reservations.cancelled.lock().expect("lock").len(), 1);
    }

    #[tokio::test]
    async fn a_caddie_on_another_group_is_left_where_they_are() {
        let ops = Arc::new(FakeOps::holding(vec![
            assignment("asn_1", "rsv_1", "assigned"),
            assignment("asn_2", "rsv_2", "assigned"),
        ]));

        use_case(
            Arc::new(FakeReservations::holding_a_booking()),
            ops.clone(),
            Arc::default(),
        )
        .execute(
            credentials(),
            &ReservationId::new("rsv_1"),
            &details(CancellationReason::Personal, None),
            None,
        )
        .await
        .expect("cancel");

        let writes = ops.writes.lock().expect("lock");
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, "asn_1");
    }

    #[tokio::test]
    async fn an_already_cancelled_assignment_is_not_written_again() {
        let ops = Arc::new(FakeOps::holding(vec![assignment(
            "asn_1",
            "rsv_1",
            "cancelled",
        )]));

        use_case(
            Arc::new(FakeReservations::holding_a_booking()),
            ops.clone(),
            Arc::default(),
        )
        .execute(
            credentials(),
            &ReservationId::new("rsv_1"),
            &details(CancellationReason::Personal, None),
            None,
        )
        .await
        .expect("cancel");

        assert!(ops.writes.lock().expect("lock").is_empty());
    }

    #[tokio::test]
    async fn a_booking_that_cancelled_is_not_reported_as_failed_when_the_caddie_cannot_be_released()
    {
        let ops = Arc::new(FakeOps {
            assignments: vec![assignment("asn_1", "rsv_1", "assigned")],
            writes: Mutex::new(Vec::new()),
            write_fails: true,
        });
        let reservations = Arc::new(FakeReservations::holding_a_booking());

        let result = use_case(reservations.clone(), ops, Arc::default())
            .execute(
                credentials(),
                &ReservationId::new("rsv_1"),
                &details(CancellationReason::Personal, None),
                None,
            )
            .await;

        assert!(result.is_ok());
        assert_eq!(reservations.cancelled.lock().expect("lock").len(), 1);
    }
}
