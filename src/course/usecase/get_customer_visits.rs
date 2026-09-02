//! GetCustomerVisitsUseCase: one use case, one public entrypoint (`execute`).
//!
//! The play half of a customer's page. The ledger says who they are; this says
//! how often they come, what they are worth, and what they cancelled — golf's
//! reading of Field's bookings, computed here because the arithmetic is
//! CourseBoard's (ADR-0005).
//!
//! Read through the booking's own customer, which is all Field can be asked
//! for. Somebody who plays every month as a guest in a colleague's group has
//! nothing here, so the screen has to say whose bookings these are rather than
//! let an empty table read as "never been".

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerGradeRulesGateway, CustomerGradeVerdict, CustomerId, CustomerVisitHistory,
    GatewayCredentials, Reservation, ReservationGateway, VisitCheckinGateway,
    DEFAULT_VISIT_HISTORY_LIMIT, MAX_VISIT_HISTORY_LIMIT, MAX_VISIT_HISTORY_ROWS,
    VISIT_HISTORY_PAGE,
};

/// How many rounds played in other people's groups are looked up upstream.
///
/// Each one costs a call, because a check-in stores the booking it belonged to
/// and nothing else about it. Somebody who plays only as a guest reaches this
/// after years of it, and when they do the history says it is partial rather
/// than quietly stopping.
const MAX_GUEST_VISIT_LOOKUPS: usize = 100;

/// A customer's play, and what the club's ladder makes of it.
pub struct CustomerVisitReport {
    pub history: CustomerVisitHistory,
    pub grade: CustomerGradeVerdict,
}

pub struct GetCustomerVisitsUseCase {
    reservations: Arc<dyn ReservationGateway>,
    grades: Arc<dyn CustomerGradeRulesGateway>,
    checkins: Arc<dyn VisitCheckinGateway>,
}

impl GetCustomerVisitsUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        grades: Arc<dyn CustomerGradeRulesGateway>,
        checkins: Arc<dyn VisitCheckinGateway>,
    ) -> Self {
        Self {
            reservations,
            grades,
            checkins,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        limit: Option<u32>,
        now: DateTime<Utc>,
    ) -> Result<CustomerVisitReport, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        let display_limit = limit
            .unwrap_or(DEFAULT_VISIT_HISTORY_LIMIT)
            .clamp(1, MAX_VISIT_HISTORY_LIMIT);

        // The whole history, not a screenful. How often somebody plays and what
        // they are worth are lifetime figures, and the desk reads them as such
        // — so they are taken over everything, and only the table is cut.
        //
        // Almost always one call: a customer with fewer bookings than a page
        // comes back short and the loop stops. Paging is what keeps the twenty
        // year member from being the one case the figures are wrong about.
        let mut reservations = Vec::new();
        let mut truncated = false;
        loop {
            let offset = u32::try_from(reservations.len()).unwrap_or(u32::MAX);
            let page = self
                .reservations
                .list_customer_reservations(credentials, customer_id, VISIT_HISTORY_PAGE, offset)
                .await?;
            let short_page = page.len() < VISIT_HISTORY_PAGE as usize;
            reservations.extend(page);
            if short_page {
                break;
            }
            if reservations.len() >= MAX_VISIT_HISTORY_ROWS {
                // A full page landed on the cap, so there may well be more.
                // Saying so is what stops a partial count reading as a lifetime.
                truncated = true;
                break;
            }
        }

        // What the desk actually saw. Two things a booking cannot say: which of
        // their own rounds somebody was really at, and which rounds they played
        // in a colleague's group. Only the second needs upstream work.
        let seen = self
            .checkins
            .list_customer_checkins(credentials.operator_id, customer_id)
            .await?;
        let booked_ids: HashSet<String> = reservations
            .iter()
            .map(|reservation| reservation.id().to_string())
            .collect();
        let mut attended = HashSet::new();
        let mut guest_ids = Vec::new();
        for checkin in &seen {
            let id = checkin.reservation_id.to_string();
            if booked_ids.contains(&id) {
                attended.insert(id);
            } else if !guest_ids.contains(&id) {
                guest_ids.push(id);
            }
        }

        let mut guest_truncated = false;
        if guest_ids.len() > MAX_GUEST_VISIT_LOOKUPS {
            guest_ids.truncate(MAX_GUEST_VISIT_LOOKUPS);
            guest_truncated = true;
        }
        let guest_reservations = self.load_guest_reservations(credentials, &guest_ids).await;

        let history = CustomerVisitHistory::build_with_checkins(
            reservations,
            guest_reservations,
            &attended,
            now,
            display_limit,
            truncated || guest_truncated,
        );
        // Judged here rather than on the screen: the ladder is the club's rule
        // and the figures are ours, so the verdict is one decision in one
        // place — the same discipline `CustomerMembership::is_member` keeps.
        let ladder = self
            .grades
            .get_customer_grade_rules(credentials.operator_id)
            .await?;
        let grade = ladder.grade_for(history.summary(), history.truncated());
        Ok(CustomerVisitReport { history, grade })
    }

    /// Reads the bookings behind rounds played as somebody's guest.
    ///
    /// Concurrent because these are independent reads of one screen's worth of
    /// history, and serial calls would make a guest-heavy page take as long as
    /// its longest chain. A booking that cannot be read is dropped rather than
    /// failing the page: the customer's own history is the larger part of it,
    /// and losing all of it over one unreadable row helps nobody.
    async fn load_guest_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
        guest_ids: &[String],
    ) -> Vec<Reservation> {
        let fetched = futures::future::join_all(guest_ids.iter().map(|id| async move {
            let reservation_id = crate::course::domain::ReservationId::new(id.clone());
            self.reservations
                .get_reservation(credentials, &reservation_id)
                .await
        }))
        .await;

        fetched
            .into_iter()
            .filter_map(|result| match result {
                Ok(reservation) => Some(reservation),
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        "a round played as a guest could not be read and was left off the history"
                    );
                    None
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::TimeZone;
    use std::sync::Mutex;

    use crate::course::domain::{
        CustomerGradeRules, NewReservation, PartyDetails, Reservation, ReservationBilling,
        ReservationBookingUpdate, ReservationId, ReservationServiceId, SeededReservation,
        VisitCheckin, VisitKind,
    };

    fn at(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
    }

    fn booking(id: &str, starts_at: DateTime<Utc>, amount: i64) -> Reservation {
        Reservation::reconstitute(
            id,
            format!("R-{id}"),
            None,
            None,
            Some("本田 康彦".into()),
            "completed",
            starts_at,
            starts_at,
            4,
            Some("course_out".into()),
            None,
        )
        .with_billing(ReservationBilling {
            price_amount: amount,
            currency: Some("JPY".into()),
            ..ReservationBilling::default()
        })
    }

    #[derive(Default)]
    struct StubReservations {
        asked: Mutex<Vec<(String, u32, u32)>>,
        answer: Vec<Reservation>,
        /// Bookings this person only attended, looked up one at a time because
        /// a check-in stores the booking it belonged to and nothing else.
        guest: Vec<Reservation>,
    }

    #[async_trait]
    impl ReservationGateway for StubReservations {
        async fn list_tenant_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("only the summary refresh sweeps the tenant")
        }

        async fn list_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("a customer page must not walk the whole tenant")
        }

        async fn list_customer_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            customer_id: &CustomerId,
            limit: u32,
            offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            self.asked
                .lock()
                .unwrap()
                .push((customer_id.to_string(), limit, offset));
            let start = offset as usize;
            Ok(self
                .answer
                .iter()
                .skip(start)
                .take(limit as usize)
                .cloned()
                .collect())
        }

        async fn get_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            reservation_id: &ReservationId,
        ) -> Result<Reservation, CourseError> {
            self.guest
                .iter()
                .find(|reservation| reservation.id() == reservation_id)
                .cloned()
                .ok_or(CourseError::NotFound("reservation"))
        }

        async fn update_reservation_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _service_id: &ReservationServiceId,
            _ends_at: DateTime<Utc>,
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
        }

        async fn update_reservation_booking(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _update: &ReservationBookingUpdate,
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
        }

        async fn update_reservation_party(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _party: &PartyDetails,
        ) -> Result<PartyDetails, CourseError> {
            unreachable!("not used by this use case")
        }

        async fn list_reservation_type_ids(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<String>, CourseError> {
            unreachable!("not used by this use case")
        }

        async fn list_seeded_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<SeededReservation>, CourseError> {
            unreachable!("not used by this use case")
        }

        async fn create_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewReservation,
        ) -> Result<ReservationId, CourseError> {
            unreachable!("not used by this use case")
        }

        async fn cancel_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _reason: Option<&str>,
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
        }

        async fn replace_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _input: &NewReservation,
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
        }
    }

    #[derive(Default)]
    struct StubGrades {
        answer: CustomerGradeRules,
    }

    #[async_trait]
    impl CustomerGradeRulesGateway for StubGrades {
        async fn get_customer_grade_rules(
            &self,
            _tenant_id: &str,
        ) -> Result<CustomerGradeRules, CourseError> {
            Ok(self.answer.clone())
        }

        async fn replace_customer_grade_rules(
            &self,
            _tenant_id: &str,
            _rules: &CustomerGradeRules,
        ) -> Result<CustomerGradeRules, CourseError> {
            unreachable!("reading a customer never writes the ladder")
        }
    }

    #[derive(Default)]
    struct StubCheckins {
        answer: Vec<VisitCheckin>,
    }

    #[async_trait]
    impl VisitCheckinGateway for StubCheckins {
        async fn list_linked_checkins(
            &self,
            _tenant_id: &str,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            unreachable!("only the summary refresh sweeps the tenant")
        }

        async fn record_visit_checkins(
            &self,
            _tenant_id: &str,
            _request: &crate::course::domain::VisitCheckinRequest,
            _checked_in_by: Option<&str>,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            unreachable!("reading a customer never checks anybody in")
        }

        async fn list_customer_checkins(
            &self,
            _tenant_id: &str,
            _customer_id: &CustomerId,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            Ok(self.answer.clone())
        }

        async fn list_reservation_checkins(
            &self,
            _tenant_id: &str,
            _reservation_id: &ReservationId,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            unreachable!("not used by this use case")
        }
    }

    fn nobody_seen() -> Arc<StubCheckins> {
        Arc::new(StubCheckins::default())
    }

    fn seen(reservation_id: &str, played_on: (i32, u32, u32)) -> VisitCheckin {
        VisitCheckin {
            reservation_id: ReservationId::new(reservation_id),
            player_index: 1,
            customer_id: Some(CustomerId::new("cus_1")),
            player_name: "本田 康彦".to_string(),
            played_on: chrono::NaiveDate::from_ymd_opt(played_on.0, played_on.1, played_on.2)
                .unwrap(),
            checked_in_at: at(played_on.0, played_on.1, played_on.2),
            checked_in_by: Some("user-1".to_string()),
        }
    }

    fn no_ladder() -> Arc<StubGrades> {
        Arc::new(StubGrades::default())
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    #[tokio::test]
    async fn the_history_is_asked_of_upstream_for_one_person_rather_than_filtered_here() {
        // A tenant's reservation table is years of play. Reading it all to keep
        // one customer's rows is both slow and silently wrong: Field clamps the
        // page and says nothing about what it dropped.
        let gateway = Arc::new(StubReservations {
            answer: vec![booking("r1", at(2026, 6, 1), 40_000)],
            ..StubReservations::default()
        });
        let report = GetCustomerVisitsUseCase::new(gateway.clone(), no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();
        assert_eq!(report.history.summary().visits, 1);
        assert_eq!(
            *gateway.asked.lock().unwrap(),
            vec![("cus_1".to_string(), VISIT_HISTORY_PAGE, 0)]
        );
    }

    #[tokio::test]
    async fn a_short_page_ends_the_read_rather_than_asking_for_another() {
        // The common case, and the reason a lifetime summary costs one call:
        // anybody with fewer bookings than a page is complete after the first.
        let gateway = Arc::new(StubReservations {
            answer: vec![booking("r1", at(2026, 6, 1), 40_000)],
            ..StubReservations::default()
        });
        GetCustomerVisitsUseCase::new(gateway.clone(), no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();
        assert_eq!(gateway.asked.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_history_longer_than_one_page_is_read_to_the_end() {
        // The twenty-year member: the one customer whose figures matter most,
        // and the one a single page would be wrong about.
        let answer: Vec<Reservation> = (0..(VISIT_HISTORY_PAGE + 20))
            .map(|index| {
                booking(
                    &format!("r{index}"),
                    at(2020, 1, 1) + chrono::Duration::days(i64::from(index)),
                    40_000,
                )
            })
            .collect();
        let gateway = Arc::new(StubReservations {
            answer,
            ..StubReservations::default()
        });
        let report = GetCustomerVisitsUseCase::new(gateway.clone(), no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();

        assert_eq!(report.history.summary().visits, VISIT_HISTORY_PAGE + 20);
        assert!(!report.history.truncated());
        // The table stays a screenful even though the figures cover everything.
        assert_eq!(
            report.history.visits().len(),
            DEFAULT_VISIT_HISTORY_LIMIT as usize
        );
        let asked = gateway.asked.lock().unwrap().clone();
        assert_eq!(
            asked,
            vec![
                ("cus_1".to_string(), VISIT_HISTORY_PAGE, 0),
                ("cus_1".to_string(), VISIT_HISTORY_PAGE, VISIT_HISTORY_PAGE),
            ]
        );
    }

    #[tokio::test]
    async fn a_history_past_the_cap_says_so_instead_of_passing_for_a_lifetime() {
        let answer: Vec<Reservation> = (0..(MAX_VISIT_HISTORY_ROWS + 10))
            .map(|index| {
                booking(
                    &format!("r{index}"),
                    at(2000, 1, 1) + chrono::Duration::days(index as i64),
                    40_000,
                )
            })
            .collect();
        let gateway = Arc::new(StubReservations {
            answer,
            ..StubReservations::default()
        });
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();

        assert!(report.history.truncated());
        assert_eq!(
            report.history.summary().visits,
            MAX_VISIT_HISTORY_ROWS as u32
        );
        // Withheld, because the oldest row read is not the first round played.
        assert_eq!(report.history.summary().first_visit_at, None);
    }

    #[tokio::test]
    async fn an_oversized_display_limit_is_clamped_without_shrinking_the_figures() {
        let answer: Vec<Reservation> = (0..10)
            .map(|index| {
                booking(
                    &format!("r{index}"),
                    at(2026, 1, 1) + chrono::Duration::days(i64::from(index)),
                    40_000,
                )
            })
            .collect();
        let gateway = Arc::new(StubReservations {
            answer,
            ..StubReservations::default()
        });
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                Some(100_000),
                at(2026, 8, 27),
            )
            .await
            .unwrap();
        assert_eq!(report.history.summary().visits, 10);
        assert_eq!(report.history.visits().len(), 10);
    }

    #[tokio::test]
    async fn somebody_who_has_never_booked_reads_as_an_empty_history() {
        // Not an error: most of the ledger is visitors who came once, and a
        // page that failed for them would fail on the common case.
        let gateway = Arc::new(StubReservations::default());
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();
        assert!(report.history.visits().is_empty());
        assert_eq!(report.history.summary().visits, 0);
    }

    #[tokio::test]
    async fn a_round_played_in_somebody_elses_group_reaches_the_history() {
        // The hole this exists for. Field records one customer per reservation,
        // so a person who only ever plays as a colleague's guest has no
        // bookings of their own and reads as somebody who has never been.
        let gateway = Arc::new(StubReservations {
            answer: Vec::new(),
            guest: vec![booking("r_host", at(2026, 6, 1), 80_000)],
            ..StubReservations::default()
        });
        let checkins = Arc::new(StubCheckins {
            answer: vec![seen("r_host", (2026, 6, 1))],
        });
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), checkins)
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();

        assert_eq!(report.history.summary().visits, 1);
        assert_eq!(report.history.visits().len(), 1);
        assert!(!report.history.visits()[0].booked());
        assert!(report.history.visits()[0].checked_in());
    }

    #[tokio::test]
    async fn a_guest_round_adds_a_visit_but_not_somebody_elses_takings() {
        // The money and the seats on that booking belong to whoever booked it.
        // Splitting either between the group would be inventing a number, and
        // it would land in the grade the club sorts people by.
        let gateway = Arc::new(StubReservations {
            answer: Vec::new(),
            guest: vec![booking("r_host", at(2026, 6, 1), 80_000)],
            ..StubReservations::default()
        });
        let checkins = Arc::new(StubCheckins {
            answer: vec![seen("r_host", (2026, 6, 1))],
        });
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), checkins)
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();

        let summary = report.history.summary();
        assert_eq!(summary.visits, 1);
        assert_eq!(summary.total_amount, 0);
        assert_eq!(summary.players, 0);
        assert_eq!(summary.spend_per_player, None);
        // Said out loud rather than left to drag the average towards zero.
        assert_eq!(summary.unpriced_visits, 1);
    }

    #[tokio::test]
    async fn a_check_in_turns_their_own_booking_from_an_inference_into_a_record() {
        let gateway = Arc::new(StubReservations {
            answer: vec![booking("r1", at(2026, 6, 1), 40_000)],
            ..StubReservations::default()
        });
        let checkins = Arc::new(StubCheckins {
            answer: vec![seen("r1", (2026, 6, 1))],
        });
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), checkins)
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();

        assert_eq!(report.history.summary().visits, 1);
        assert!(report.history.visits()[0].checked_in());
        assert!(report.history.visits()[0].booked());
    }

    #[tokio::test]
    async fn a_booking_nobody_checked_in_is_still_read_as_played() {
        // Absence cannot demote: every round played before the desk started
        // checking people in has no row, and reading those as "never came"
        // would empty the ledger's history on the day this shipped.
        let gateway = Arc::new(StubReservations {
            answer: vec![booking("r1", at(2026, 6, 1), 40_000)],
            ..StubReservations::default()
        });
        let report = GetCustomerVisitsUseCase::new(gateway, no_ladder(), nobody_seen())
            .execute(
                credentials(),
                &CustomerId::new("cus_1"),
                None,
                at(2026, 8, 27),
            )
            .await
            .unwrap();

        assert_eq!(report.history.summary().visits, 1);
        assert_eq!(report.history.visits()[0].kind(), VisitKind::Visited);
        assert!(!report.history.visits()[0].checked_in());
    }
}
