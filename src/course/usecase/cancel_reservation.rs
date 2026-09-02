//! CancelReservationUseCase: one use case, one public entrypoint (`execute`).
//!
//! Cancels a booking from the desk — a caller who cannot make their tee time.
//! The reason the desk types is passed through to Field; Field cannot store
//! one yet (PLT-3297), so today it is only carried, not kept.
//!
//! Cancelling also takes the caddies off the group. A booking and the rows
//! saying who walks it live apart, and nothing upstream ties them together, so
//! a cancelled group used to leave its caddie assigned to a round that no
//! longer exists — counted against their daily limit, and counted again in the
//! month's payroll.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieAssignment, CaddieAssignmentQuery, CourseError, GatewayCredentials, GolfOpsGateway,
    ReservationGateway, ReservationId, UpsertCaddieAssignment,
};

/// Long enough for a sentence, short enough that the field stays a note.
const MAX_REASON_CHARS: usize = 500;

/// What a caddie's row becomes once the group is gone.
const CANCELLED_STATUS: &str = "cancelled";

pub struct CancelReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    ops: Arc<dyn GolfOpsGateway>,
}

impl CancelReservationUseCase {
    pub fn new(reservations: Arc<dyn ReservationGateway>, ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { reservations, ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        reservation_id: &ReservationId,
        reason: Option<&str>,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        if reservation_id.trim().is_empty() {
            return Err(CourseError::BadRequest("reservation id is required"));
        }
        let reason = reason.map(str::trim).filter(|value| !value.is_empty());
        if reason.is_some_and(|value| value.chars().count() > MAX_REASON_CHARS) {
            return Err(CourseError::BadRequest(
                "the cancellation reason is too long",
            ));
        }
        self.reservations
            .cancel_reservation(credentials, reservation_id, reason)
            .await?;
        self.release_caddies(credentials, reservation_id).await;
        Ok(())
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
        CaddieRoster, CaddieStaff, NewReservation, PartyDetails, ReplaceCaddieMemberships,
        Reservation, SeededReservation, UpsertCaddie, UpsertCaddieAvailability,
    };

    struct FakeReservations {
        cancelled: Mutex<Vec<String>>,
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
            unimplemented!("not used")
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
            _reason: Option<&str>,
        ) -> Result<(), CourseError> {
            self.cancelled
                .lock()
                .expect("lock")
                .push(reservation_id.to_string());
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

    #[tokio::test]
    async fn cancelling_a_booking_takes_its_caddie_off_the_round() {
        let ops = Arc::new(FakeOps::holding(vec![assignment(
            "asn_1", "rsv_1", "assigned",
        )]));
        let reservations = Arc::new(FakeReservations {
            cancelled: Mutex::new(Vec::new()),
        });

        CancelReservationUseCase::new(reservations.clone(), ops.clone())
            .execute(credentials(), &ReservationId::new("rsv_1"), None)
            .await
            .expect("cancel");

        assert_eq!(reservations.cancelled.lock().expect("lock").len(), 1);
        let writes = ops.writes.lock().expect("lock");
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, "asn_1");
        assert_eq!(writes[0].1.status.as_deref(), Some("cancelled"));
    }

    #[tokio::test]
    async fn a_caddie_on_another_group_is_left_where_they_are() {
        let ops = Arc::new(FakeOps::holding(vec![
            assignment("asn_1", "rsv_1", "assigned"),
            assignment("asn_2", "rsv_2", "assigned"),
        ]));
        let reservations = Arc::new(FakeReservations {
            cancelled: Mutex::new(Vec::new()),
        });

        CancelReservationUseCase::new(reservations, ops.clone())
            .execute(credentials(), &ReservationId::new("rsv_1"), None)
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
        let reservations = Arc::new(FakeReservations {
            cancelled: Mutex::new(Vec::new()),
        });

        CancelReservationUseCase::new(reservations, ops.clone())
            .execute(credentials(), &ReservationId::new("rsv_1"), None)
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
        let reservations = Arc::new(FakeReservations {
            cancelled: Mutex::new(Vec::new()),
        });

        let result = CancelReservationUseCase::new(reservations.clone(), ops)
            .execute(credentials(), &ReservationId::new("rsv_1"), None)
            .await;

        assert!(result.is_ok());
        assert_eq!(reservations.cancelled.lock().expect("lock").len(), 1);
    }
}
