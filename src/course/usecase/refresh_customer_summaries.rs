//! RefreshCustomerSummariesUseCase: one use case, one public entrypoint (`execute`).
//!
//! Works out what everybody in the ledger has played and spent, and keeps it,
//! so a call list can be drawn from the ledger instead of assembled by eye.
//!
//! This is a batch, not a request, and the reason is upstream: Field's
//! reservation listing takes no date filter, offers no `updatedSince`, reports
//! no total, and silently clamps a page to 500 rows. Working out lifetime
//! figures therefore means reading the tenant's bookings from the newest
//! backwards until a page comes back short — tens of pages for a real course,
//! which is not something an API request can be asked to wait for.
//!
//! **The counting is not reimplemented here.** The figures come from the same
//! [`CustomerVisitHistory`] the customer's own page uses. A second way of
//! adding up rounds would put two different numbers under one label, and the
//! desk would learn to trust neither.
//!
//! Provisional by design. The right home for "what has this customer bought
//! from us" is Field, which owns the bookings, the billing, and the ledger;
//! this exists because there is no such generic capability to call yet. The
//! whole of it hides behind [`CustomerSummaryGateway`], so the day Field grows
//! one, the use cases above are unchanged.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerId, CustomerSummary, CustomerSummaryGateway, CustomerSummaryRunStatus,
    CustomerVisitHistory, GatewayCredentials, Reservation, ReservationGateway, VisitCheckinGateway,
};

/// Rows asked for per upstream call. Field clamps at 500 without saying so, so
/// asking for exactly that keeps the page size the one that was requested.
pub const SWEEP_PAGE: u32 = 500;

/// Where the sweep gives up.
///
/// A hundred pages. Past this the run stops and every summary it wrote is
/// marked as a partial count — which withholds the grade rather than reporting
/// a low one, the same rule the customer's own page follows. Raising it costs
/// wall-clock and memory; the real fix is an incremental listing upstream.
pub const MAX_SWEEP_ROWS: usize = 50_000;

/// What one run did, for the operator watching it and for the run log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerSummaryRefresh {
    pub reservations_scanned: usize,
    pub checkins_scanned: usize,
    pub customers_written: usize,
    /// The sweep hit its cap. The figures are a partial count of the tenant's
    /// history, and every row written says so.
    pub truncated: bool,
}

pub struct RefreshCustomerSummariesUseCase {
    reservations: Arc<dyn ReservationGateway>,
    checkins: Arc<dyn VisitCheckinGateway>,
    summaries: Arc<dyn CustomerSummaryGateway>,
}

impl RefreshCustomerSummariesUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        checkins: Arc<dyn VisitCheckinGateway>,
        summaries: Arc<dyn CustomerSummaryGateway>,
    ) -> Self {
        Self {
            reservations,
            checkins,
            summaries,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        now: DateTime<Utc>,
    ) -> Result<CustomerSummaryRefresh, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        let tenant_id = credentials.operator_id;

        // Opened before the sweep, so a process that dies leaves a `running`
        // row rather than no trace at all. A refresh that silently stopped
        // happening is the failure this table exists to make visible.
        let run = self.summaries.start_summary_run(tenant_id).await?;
        match self.sweep(credentials, now).await {
            Ok(refresh) => {
                self.summaries
                    .finish_summary_run(
                        run,
                        CustomerSummaryRunStatus::Succeeded,
                        refresh.reservations_scanned as i64,
                        refresh.customers_written as i64,
                        // A truncated sweep succeeded at what it could reach.
                        // Saying so on the run is what lets the screen explain
                        // why nobody came back graded.
                        refresh
                            .truncated
                            .then_some("reached the sweep cap; figures are a partial count"),
                    )
                    .await?;
                Ok(refresh)
            }
            Err(error) => {
                // The failure is recorded and then returned. Swallowing it
                // would leave the caller thinking the figures are fresh.
                self.summaries
                    .finish_summary_run(
                        run,
                        CustomerSummaryRunStatus::Failed,
                        0,
                        0,
                        Some(&error.to_string()),
                    )
                    .await?;
                Err(error)
            }
        }
    }

    async fn sweep(
        &self,
        credentials: GatewayCredentials<'_>,
        now: DateTime<Utc>,
    ) -> Result<CustomerSummaryRefresh, CourseError> {
        let (reservations, truncated) = self.read_reservations(credentials).await?;
        let checkins = self.read_checkins(credentials.operator_id).await?;

        // Every booking by id, so a round somebody played in another person's
        // group can be found without asking Field for it again. The
        // single-customer page has to fetch those one by one; a sweep that has
        // already read the tenant does not.
        let by_id: HashMap<&str, &Reservation> = reservations
            .iter()
            .map(|reservation| (reservation.id().as_str(), reservation))
            .collect();

        let mut booked: HashMap<&str, Vec<Reservation>> = HashMap::new();
        for reservation in &reservations {
            if let Some(customer_id) = reservation.customer_id() {
                booked
                    .entry(customer_id.as_str())
                    .or_default()
                    .push(reservation.clone());
            }
        }

        // What the desk actually saw, split the same way the customer's own
        // page splits it: an arrival against their own booking confirms a round
        // that was otherwise inferred, and an arrival against somebody else's
        // is a round no query against Field could have found.
        let mut attended: HashMap<&str, HashSet<String>> = HashMap::new();
        let mut guests: HashMap<&str, Vec<Reservation>> = HashMap::new();
        for checkin in &checkins {
            let Some(customer_id) = checkin.customer_id.as_ref() else {
                continue;
            };
            let reservation_id = checkin.reservation_id.as_str();
            let owns_booking = booked
                .get(customer_id.as_str())
                .is_some_and(|list| list.iter().any(|item| item.id().as_str() == reservation_id));
            if owns_booking {
                attended
                    .entry(customer_id.as_str())
                    .or_default()
                    .insert(reservation_id.to_string());
            } else if let Some(reservation) = by_id.get(reservation_id) {
                guests
                    .entry(customer_id.as_str())
                    .or_default()
                    .push((*reservation).clone());
            }
        }

        // Everybody either of the two halves knows about. Somebody who has only
        // ever played as a guest has no booking at all, and leaving them out
        // would drop exactly the regulars this whole exercise is meant to find.
        let mut customer_ids: Vec<&str> = booked.keys().copied().collect();
        for id in guests.keys() {
            if !booked.contains_key(id) {
                customer_ids.push(id);
            }
        }

        let mut rows = Vec::with_capacity(customer_ids.len());
        for customer_id in customer_ids {
            let history = CustomerVisitHistory::build_with_checkins(
                booked.get(customer_id).cloned().unwrap_or_default(),
                guests.get(customer_id).cloned().unwrap_or_default(),
                attended.get(customer_id).unwrap_or(&HashSet::new()),
                now,
                // The table is not kept, only the figures. One row is the
                // smallest the builder will cut to.
                1,
                truncated,
            );
            rows.push(CustomerSummary {
                customer_id: CustomerId::new(customer_id),
                summary: history.summary().clone(),
                truncated,
                computed_at: now,
            });
        }

        let written = self
            .summaries
            .upsert_customer_summaries(credentials.operator_id, &rows)
            .await?;

        Ok(CustomerSummaryRefresh {
            reservations_scanned: reservations.len(),
            checkins_scanned: checkins.len(),
            customers_written: written as usize,
            truncated,
        })
    }

    /// The tenant's bookings, newest first, until a page comes back short.
    async fn read_reservations(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<(Vec<Reservation>, bool), CourseError> {
        let mut all = Vec::new();
        loop {
            let offset = u32::try_from(all.len()).unwrap_or(u32::MAX);
            let page = self
                .reservations
                .list_tenant_reservations(credentials, SWEEP_PAGE, offset)
                .await?;
            let short_page = page.len() < SWEEP_PAGE as usize;
            all.extend(page);
            if short_page {
                return Ok((all, false));
            }
            if all.len() >= MAX_SWEEP_ROWS {
                // A full page landed on the cap, so there is more history than
                // was read. Every figure taken from this is a partial count.
                return Ok((all, true));
            }
        }
    }

    async fn read_checkins(
        &self,
        tenant_id: &str,
    ) -> Result<Vec<crate::course::domain::VisitCheckin>, CourseError> {
        let mut all = Vec::new();
        loop {
            let offset = u32::try_from(all.len()).unwrap_or(u32::MAX);
            let page = self
                .checkins
                .list_linked_checkins(tenant_id, SWEEP_PAGE, offset)
                .await?;
            let short_page = page.len() < SWEEP_PAGE as usize;
            all.extend(page);
            if short_page || all.len() >= MAX_SWEEP_ROWS {
                return Ok(all);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::TimeZone;
    use std::sync::Mutex;

    use crate::course::domain::{
        CustomerSummaryQuery, CustomerSummaryRun, NewReservation, PartyDetails, ReservationBilling,
        ReservationBookingUpdate, ReservationId, ReservationServiceId, SeededReservation,
        VisitCheckin,
    };

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 31, 0, 0, 0).unwrap()
    }

    fn at(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
    }

    fn booking(
        id: &str,
        customer: Option<&str>,
        starts_at: DateTime<Utc>,
        amount: i64,
    ) -> Reservation {
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
        .with_customer_id(customer.map(CustomerId::new))
        .with_billing(ReservationBilling {
            price_amount: amount,
            currency: Some("JPY".into()),
            ..ReservationBilling::default()
        })
    }

    fn checkin(reservation: &str, customer: &str) -> VisitCheckin {
        VisitCheckin {
            reservation_id: ReservationId::new(reservation),
            player_index: 1,
            customer_id: Some(CustomerId::new(customer)),
            player_name: "同伴 太郎".into(),
            played_on: chrono::NaiveDate::from_ymd_opt(2026, 6, 1).unwrap(),
            checked_in_at: at(2026, 6, 1),
            checked_in_by: None,
        }
    }

    #[derive(Default)]
    struct StubReservations {
        pages: Vec<Vec<Reservation>>,
        asked: Mutex<Vec<(u32, u32)>>,
    }

    #[async_trait]
    impl ReservationGateway for StubReservations {
        async fn list_tenant_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            limit: u32,
            offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            self.asked.lock().unwrap().push((limit, offset));
            let index = (offset / limit.max(1)) as usize;
            Ok(self.pages.get(index).cloned().unwrap_or_default())
        }

        async fn list_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("the refresh pages the tenant rather than asking for one batch")
        }

        async fn list_customer_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &CustomerId,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("the refresh has already read the tenant")
        }

        async fn get_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
        ) -> Result<Reservation, CourseError> {
            unreachable!("a guest round is found in what the sweep already read")
        }

        async fn update_reservation_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _service_id: &ReservationServiceId,
            _ends_at: DateTime<Utc>,
        ) -> Result<(), CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn update_reservation_booking(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _update: &ReservationBookingUpdate,
        ) -> Result<(), CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn update_reservation_party(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _party: &PartyDetails,
        ) -> Result<PartyDetails, CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn list_reservation_type_ids(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<String>, CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn list_seeded_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<SeededReservation>, CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn create_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewReservation,
        ) -> Result<ReservationId, CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn cancel_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _reason: Option<&str>,
        ) -> Result<(), CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }

        async fn replace_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _input: &NewReservation,
        ) -> Result<(), CourseError> {
            unreachable!("the refresh writes nothing upstream")
        }
    }

    #[derive(Default)]
    struct StubCheckins {
        rows: Vec<VisitCheckin>,
    }

    #[async_trait]
    impl VisitCheckinGateway for StubCheckins {
        async fn list_linked_checkins(
            &self,
            _tenant_id: &str,
            limit: u32,
            offset: u32,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            let start = offset as usize;
            Ok(self
                .rows
                .iter()
                .skip(start)
                .take(limit as usize)
                .cloned()
                .collect())
        }

        async fn record_visit_checkins(
            &self,
            _tenant_id: &str,
            _request: &crate::course::domain::VisitCheckinRequest,
            _checked_in_by: Option<&str>,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            unreachable!("the refresh records no arrivals")
        }

        async fn list_customer_checkins(
            &self,
            _tenant_id: &str,
            _customer_id: &CustomerId,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            unreachable!("the refresh reads the tenant, not one person")
        }

        async fn list_reservation_checkins(
            &self,
            _tenant_id: &str,
            _reservation_id: &ReservationId,
        ) -> Result<Vec<VisitCheckin>, CourseError> {
            unreachable!("the refresh reads the tenant, not one booking")
        }
    }

    #[derive(Default)]
    struct StubSummaries {
        written: Mutex<Vec<CustomerSummary>>,
        finished: Mutex<Vec<(CustomerSummaryRunStatus, Option<String>)>>,
    }

    #[async_trait]
    impl CustomerSummaryGateway for StubSummaries {
        async fn list_customer_summaries(
            &self,
            _tenant_id: &str,
            _query: &CustomerSummaryQuery,
            _now: DateTime<Utc>,
        ) -> Result<Vec<CustomerSummary>, CourseError> {
            unreachable!("the refresh only writes")
        }

        async fn count_customer_summaries(
            &self,
            _tenant_id: &str,
            _query: &CustomerSummaryQuery,
            _now: DateTime<Utc>,
        ) -> Result<i64, CourseError> {
            unreachable!("the refresh only writes")
        }

        async fn upsert_customer_summaries(
            &self,
            _tenant_id: &str,
            rows: &[CustomerSummary],
        ) -> Result<u64, CourseError> {
            self.written.lock().unwrap().extend_from_slice(rows);
            Ok(rows.len() as u64)
        }

        async fn latest_summary_run(
            &self,
            _tenant_id: &str,
        ) -> Result<Option<CustomerSummaryRun>, CourseError> {
            Ok(None)
        }

        async fn start_summary_run(&self, _tenant_id: &str) -> Result<i64, CourseError> {
            Ok(7)
        }

        async fn finish_summary_run(
            &self,
            _run_id: i64,
            status: CustomerSummaryRunStatus,
            _reservations_scanned: i64,
            _customers_written: i64,
            error: Option<&str>,
        ) -> Result<(), CourseError> {
            self.finished
                .lock()
                .unwrap()
                .push((status, error.map(str::to_string)));
            Ok(())
        }
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

    fn found<'a>(rows: &'a [CustomerSummary], customer: &str) -> &'a CustomerSummary {
        rows.iter()
            .find(|row| row.customer_id.as_str() == customer)
            .unwrap_or_else(|| panic!("{customer} should have been summarised"))
    }

    #[tokio::test]
    async fn the_figures_match_what_the_customers_own_page_would_have_counted() {
        let reservations = Arc::new(StubReservations {
            pages: vec![vec![
                booking("r1", Some("cus-1"), at(2026, 6, 1), 40_000),
                booking("r2", Some("cus-1"), at(2026, 7, 1), 60_000),
                // Still ahead: booked, not played, and not money taken.
                booking("r3", Some("cus-1"), at(2026, 12, 1), 50_000),
            ]],
            ..StubReservations::default()
        });
        let summaries = Arc::new(StubSummaries::default());
        let refresh = RefreshCustomerSummariesUseCase::new(
            reservations,
            Arc::new(StubCheckins::default()),
            summaries.clone(),
        )
        .execute(credentials(), now())
        .await
        .unwrap();

        assert_eq!(refresh.customers_written, 1);
        assert!(!refresh.truncated);
        let written = summaries.written.lock().unwrap();
        let row = found(&written, "cus-1");
        assert_eq!(row.summary.visits, 2);
        assert_eq!(row.summary.upcoming, 1);
        assert_eq!(row.summary.total_amount, 100_000);
        assert_eq!(row.summary.last_visit_at, Some(at(2026, 7, 1)));
    }

    #[tokio::test]
    async fn somebody_who_only_ever_played_in_other_peoples_groups_is_still_summarised() {
        // The hole this whole exercise exists to close: Field records one
        // customer per booking, so a regular who always comes in a colleague's
        // group books nothing and would otherwise be invisible to a call list.
        let reservations = Arc::new(StubReservations {
            pages: vec![vec![booking(
                "r1",
                Some("cus-host"),
                at(2026, 6, 1),
                40_000,
            )]],
            ..StubReservations::default()
        });
        let summaries = Arc::new(StubSummaries::default());
        RefreshCustomerSummariesUseCase::new(
            reservations,
            Arc::new(StubCheckins {
                rows: vec![checkin("r1", "cus-guest")],
            }),
            summaries.clone(),
        )
        .execute(credentials(), now())
        .await
        .unwrap();

        let written = summaries.written.lock().unwrap();
        let guest = found(&written, "cus-guest");
        assert_eq!(guest.summary.visits, 1);
        // The money stays with whoever booked. Splitting a group's takings
        // would be inventing a number, so the guest's round is unpriced.
        assert_eq!(guest.summary.total_amount, 0);
        assert_eq!(guest.summary.unpriced_visits, 1);
        assert_eq!(found(&written, "cus-host").summary.total_amount, 40_000);
    }

    #[tokio::test]
    async fn a_sweep_that_reaches_its_cap_marks_every_row_as_a_partial_count() {
        // A partial count that read as a lifetime would show a twenty-year
        // member as an occasional visitor, and the grade would follow it down.
        let full_page: Vec<Reservation> = (0..SWEEP_PAGE)
            .map(|index| booking(&format!("r{index}"), Some("cus-1"), at(2026, 6, 1), 1_000))
            .collect();
        let pages = vec![full_page; (MAX_SWEEP_ROWS / SWEEP_PAGE as usize) + 1];
        let summaries = Arc::new(StubSummaries::default());
        let refresh = RefreshCustomerSummariesUseCase::new(
            Arc::new(StubReservations {
                pages,
                ..StubReservations::default()
            }),
            Arc::new(StubCheckins::default()),
            summaries.clone(),
        )
        .execute(credentials(), now())
        .await
        .unwrap();

        assert!(refresh.truncated);
        assert_eq!(refresh.reservations_scanned, MAX_SWEEP_ROWS);
        assert!(summaries
            .written
            .lock()
            .unwrap()
            .iter()
            .all(|row| row.truncated));
        // The run succeeded at what it could reach, and says what it could not.
        let finished = summaries.finished.lock().unwrap();
        assert_eq!(finished[0].0, CustomerSummaryRunStatus::Succeeded);
        assert!(finished[0].1.is_some());
    }

    #[tokio::test]
    async fn paging_stops_at_the_first_short_page() {
        let reservations = Arc::new(StubReservations {
            pages: vec![vec![booking("r1", Some("cus-1"), at(2026, 6, 1), 1_000)]],
            ..StubReservations::default()
        });
        RefreshCustomerSummariesUseCase::new(
            reservations.clone(),
            Arc::new(StubCheckins::default()),
            Arc::new(StubSummaries::default()),
        )
        .execute(credentials(), now())
        .await
        .unwrap();
        assert_eq!(*reservations.asked.lock().unwrap(), vec![(SWEEP_PAGE, 0)]);
    }
}
