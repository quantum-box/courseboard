//! CourseBoard's own storage for why bookings came off the board.
//!
//! Reads and writes `golf_reservation_cancellations` in CourseBoard's MySQL.
//! Field records that a booking was cancelled and when; the reason has nowhere
//! to go upstream (PLT-3297), and the club's reading of it — chargeable or not,
//! settled or not — is golf's own (ADR-0009).

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{MySqlPool, QueryBuilder, Row};

use crate::course::domain::{
    CancellationFeeDecision, CancellationFeeState, CancellationQuery, CancellationReason,
    CourseError, CourseId, CustomerId, NewReservationCancellation, ReservationCancellation,
    ReservationCancellationGateway, ReservationId,
};

pub struct MySqlReservationCancellationRepository {
    pool: MySqlPool,
}

impl MySqlReservationCancellationRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

const COLUMNS: &str = "reservation_id, reservation_number, customer_id, customer_name, \
     golf_course_id, tee_time, played_on, players, booking_amount, currency, \
     reason_code, reason_note, notice_days, fee_state, fee_invoice_id, fee_amount, \
     fee_settled_at, fee_note, cancelled_at, cancelled_by";

fn row_to_cancellation(
    row: &sqlx::mysql::MySqlRow,
) -> Result<ReservationCancellation, CourseError> {
    let reservation_id: String = row.try_get("reservation_id").map_err(provider)?;
    let customer_id: Option<String> = row.try_get("customer_id").map_err(provider)?;
    let golf_course_id: Option<String> = row.try_get("golf_course_id").map_err(provider)?;
    let reason_code: String = row.try_get("reason_code").map_err(provider)?;
    let fee_state: String = row.try_get("fee_state").map_err(provider)?;
    Ok(ReservationCancellation {
        reservation_id: ReservationId::new(reservation_id),
        reservation_number: row.try_get("reservation_number").map_err(provider)?,
        customer_id: customer_id.map(CustomerId::new),
        customer_name: row.try_get("customer_name").map_err(provider)?,
        golf_course_id: golf_course_id.map(CourseId::new),
        tee_time: row
            .try_get::<Option<DateTime<Utc>>, _>("tee_time")
            .map_err(provider)?,
        played_on: row
            .try_get::<Option<NaiveDate>, _>("played_on")
            .map_err(provider)?,
        players: row.try_get::<u32, _>("players").map_err(provider)?,
        booking_amount: row.try_get("booking_amount").map_err(provider)?,
        currency: row.try_get("currency").map_err(provider)?,
        // A row whose code this build no longer knows reads as `other` rather
        // than failing the page. Losing one row's shading is a smaller harm
        // than a screen that will not open at all after a code is retired.
        reason: CancellationReason::parse(&reason_code).unwrap_or(CancellationReason::Other),
        reason_note: row.try_get("reason_note").map_err(provider)?,
        notice_days: row.try_get("notice_days").map_err(provider)?,
        fee_state: CancellationFeeState::parse(&fee_state)
            .unwrap_or(CancellationFeeState::Unsettled),
        fee_invoice_id: row.try_get("fee_invoice_id").map_err(provider)?,
        fee_amount: row.try_get("fee_amount").map_err(provider)?,
        fee_settled_at: row
            .try_get::<Option<DateTime<Utc>>, _>("fee_settled_at")
            .map_err(provider)?,
        fee_note: row.try_get("fee_note").map_err(provider)?,
        cancelled_at: row
            .try_get::<DateTime<Utc>, _>("cancelled_at")
            .map_err(provider)?,
        cancelled_by: row.try_get("cancelled_by").map_err(provider)?,
    })
}

/// The `WHERE` every read shares, so the list and its count can never select
/// different rows — a total that disagrees with the page under it is the kind
/// of bug nobody reports and everybody distrusts.
fn push_filters<'a>(builder: &mut QueryBuilder<'a, sqlx::MySql>, query: &'a CancellationQuery) {
    if let Some(from) = query.from {
        builder.push(" AND played_on >= ").push_bind(from);
    }
    if let Some(to) = query.to {
        builder.push(" AND played_on <= ").push_bind(to);
    }
    if let Some(customer_id) = &query.customer_id {
        builder
            .push(" AND customer_id = ")
            .push_bind(customer_id.as_str());
    }
    if !query.reasons.is_empty() {
        builder.push(" AND reason_code IN (");
        let mut separated = builder.separated(", ");
        for reason in &query.reasons {
            separated.push_bind(reason.as_str());
        }
        builder.push(")");
    }
    if !query.fee_states.is_empty() {
        builder.push(" AND fee_state IN (");
        let mut separated = builder.separated(", ");
        for state in &query.fee_states {
            separated.push_bind(state.as_str());
        }
        builder.push(")");
    }
    if query.fee_expected_only {
        // Spelled out from the ladder rather than hard-coded here, so the club
        // changing which reasons it charges for is one edit in the domain.
        builder.push(" AND reason_code IN (");
        let mut separated = builder.separated(", ");
        for reason in CancellationReason::ALL
            .iter()
            .filter(|reason| reason.fee_expected())
        {
            separated.push_bind(reason.as_str());
        }
        builder.push(")");
    }
    if query.linked_only {
        builder.push(" AND customer_id IS NOT NULL");
    }
}

#[async_trait]
impl ReservationCancellationGateway for MySqlReservationCancellationRepository {
    async fn record_cancellation(
        &self,
        tenant_id: &str,
        cancellation: &NewReservationCancellation,
    ) -> Result<(), CourseError> {
        sqlx::query(
            r#"
            INSERT INTO golf_reservation_cancellations (
                tenant_id, reservation_id, reservation_number, customer_id, customer_name,
                golf_course_id, tee_time, played_on, players, booking_amount, currency,
                reason_code, reason_note, notice_days, cancelled_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                reason_code = VALUES(reason_code),
                reason_note = VALUES(reason_note),
                cancelled_by = VALUES(cancelled_by)
            "#,
        )
        .bind(tenant_id)
        .bind(cancellation.reservation_id.as_str())
        .bind(cancellation.reservation_number.as_deref())
        .bind(cancellation.customer_id.as_ref().map(CustomerId::as_str))
        .bind(cancellation.customer_name.as_deref())
        .bind(cancellation.golf_course_id.as_ref().map(CourseId::as_str))
        .bind(cancellation.tee_time)
        .bind(cancellation.played_on)
        .bind(cancellation.players)
        .bind(cancellation.booking_amount)
        .bind(cancellation.currency.as_deref())
        .bind(cancellation.reason.as_str())
        .bind(cancellation.reason_note.as_deref())
        .bind(cancellation.notice_days)
        .bind(cancellation.cancelled_by.as_deref())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }

    async fn list_cancellations(
        &self,
        tenant_id: &str,
        query: &CancellationQuery,
    ) -> Result<Vec<ReservationCancellation>, CourseError> {
        let mut builder = QueryBuilder::new("SELECT ");
        builder.push(COLUMNS);
        builder.push(" FROM golf_reservation_cancellations WHERE tenant_id = ");
        builder.push_bind(tenant_id);
        push_filters(&mut builder, query);
        // The column comes from a closed enum, never from the request. A blank
        // goes last in both directions — an unrecorded amount at the top of a
        // descending column would read as the largest. The day of play, then
        // `id`, break ties so two equal rows cannot swap places between pages,
        // which would show one twice and the other never.
        let column = query.sort.column();
        let direction = if query.descending { " DESC" } else { " ASC" };
        builder.push(" ORDER BY ").push(column).push(" IS NULL, ");
        builder.push(column).push(direction);
        builder.push(", played_on DESC, id DESC LIMIT ");
        builder.push_bind(query.limit);
        builder.push(" OFFSET ");
        builder.push_bind(query.offset);

        let rows = builder
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(provider)?;
        rows.iter().map(row_to_cancellation).collect()
    }

    async fn count_cancellations(
        &self,
        tenant_id: &str,
        query: &CancellationQuery,
    ) -> Result<i64, CourseError> {
        let mut builder = QueryBuilder::new(
            "SELECT COUNT(*) AS total FROM golf_reservation_cancellations WHERE tenant_id = ",
        );
        builder.push_bind(tenant_id);
        push_filters(&mut builder, query);
        let row = builder
            .build()
            .fetch_one(&self.pool)
            .await
            .map_err(provider)?;
        row.try_get::<i64, _>("total").map_err(provider)
    }

    async fn settle_cancellation_fees(
        &self,
        tenant_id: &str,
        decisions: &[CancellationFeeDecision],
    ) -> Result<Vec<ReservationCancellation>, CourseError> {
        if decisions.is_empty() {
            return Ok(Vec::new());
        }
        // One transaction for the batch: the desk bills a morning's worth as
        // one action, and half of it recorded is worse than none — the rows
        // that did land would never come back on the next extraction, and the
        // invoices behind them would be the only trace.
        let mut transaction = self.pool.begin().await.map_err(provider)?;
        for decision in decisions {
            let settled_at = match decision.state {
                CancellationFeeState::Unsettled => None,
                _ => Some(Utc::now()),
            };
            sqlx::query(
                r#"
                UPDATE golf_reservation_cancellations
                SET fee_state = ?,
                    fee_invoice_id = ?,
                    fee_amount = ?,
                    fee_note = ?,
                    fee_settled_at = ?
                WHERE tenant_id = ? AND reservation_id = ?
                "#,
            )
            .bind(decision.state.as_str())
            .bind(decision.invoice_id.as_deref())
            .bind(decision.amount)
            .bind(decision.note.as_deref())
            .bind(settled_at)
            .bind(tenant_id)
            .bind(decision.reservation_id.as_str())
            .execute(&mut *transaction)
            .await
            .map_err(provider)?;
        }
        transaction.commit().await.map_err(provider)?;

        let mut builder = QueryBuilder::new("SELECT ");
        builder.push(COLUMNS);
        builder.push(" FROM golf_reservation_cancellations WHERE tenant_id = ");
        builder.push_bind(tenant_id);
        builder.push(" AND reservation_id IN (");
        let mut separated = builder.separated(", ");
        for decision in decisions {
            separated.push_bind(decision.reservation_id.as_str());
        }
        builder.push(")");
        let rows = builder
            .build()
            .fetch_all(&self.pool)
            .await
            .map_err(provider)?;
        rows.iter().map(row_to_cancellation).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::CancellationSort;
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlReservationCancellationRepository {
        MySqlReservationCancellationRepository::new(test_pool().await)
    }

    fn day(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, day).unwrap()
    }

    fn cancellation(
        reservation: &str,
        customer: Option<&str>,
        played_on: NaiveDate,
        reason: CancellationReason,
    ) -> NewReservationCancellation {
        NewReservationCancellation {
            reservation_id: ReservationId::new(reservation),
            reservation_number: Some(format!("RSV-{reservation}")),
            customer_id: customer.map(CustomerId::new),
            customer_name: Some("本田 康彦".to_string()),
            golf_course_id: Some(CourseId::new("course_east")),
            tee_time: Some(Utc::now()),
            played_on: Some(played_on),
            players: 4,
            booking_amount: Some(48_000),
            currency: Some("JPY".to_string()),
            reason,
            reason_note: Some("前日に電話".to_string()),
            notice_days: Some(1),
            cancelled_by: Some("user-1".to_string()),
        }
    }

    #[tokio::test]
    async fn a_cancellation_is_written_and_read_back_whole() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-write");
        repository
            .record_cancellation(
                &tenant,
                &cancellation("res_1", Some("cus_1"), day(10), CancellationReason::Illness),
            )
            .await
            .unwrap();

        let rows = repository
            .list_cancellations(&tenant, &CancellationQuery::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reason, CancellationReason::Illness);
        assert_eq!(rows[0].reason_note.as_deref(), Some("前日に電話"));
        assert_eq!(rows[0].players, 4);
        assert_eq!(rows[0].booking_amount, Some(48_000));
        assert_eq!(rows[0].fee_state, CancellationFeeState::Unsettled);
    }

    #[tokio::test]
    async fn cancelling_the_same_booking_twice_corrects_the_reason() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-idempotent");
        repository
            .record_cancellation(
                &tenant,
                &cancellation(
                    "res_1",
                    Some("cus_1"),
                    day(10),
                    CancellationReason::Personal,
                ),
            )
            .await
            .unwrap();
        repository
            .record_cancellation(
                &tenant,
                &cancellation("res_1", Some("cus_1"), day(10), CancellationReason::Weather),
            )
            .await
            .unwrap();

        let rows = repository
            .list_cancellations(&tenant, &CancellationQuery::default())
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reason, CancellationReason::Weather);
    }

    #[tokio::test]
    async fn a_second_cancel_never_undoes_a_fee_somebody_already_settled() {
        // The desk re-runs a cancel that already went through, and the invoice
        // raised for it an hour ago must not go back to being unsettled.
        let repository = repository().await;
        let tenant = test_tenant("cancel-keeps-fee");
        let row = cancellation(
            "res_1",
            Some("cus_1"),
            day(10),
            CancellationReason::Personal,
        );
        repository.record_cancellation(&tenant, &row).await.unwrap();
        repository
            .settle_cancellation_fees(
                &tenant,
                &[CancellationFeeDecision {
                    reservation_id: ReservationId::new("res_1"),
                    state: CancellationFeeState::Invoiced,
                    invoice_id: Some("inv_1".to_string()),
                    amount: Some(5_000),
                    note: None,
                }],
            )
            .await
            .unwrap();
        repository.record_cancellation(&tenant, &row).await.unwrap();

        let rows = repository
            .list_cancellations(&tenant, &CancellationQuery::default())
            .await
            .unwrap();
        assert_eq!(rows[0].fee_state, CancellationFeeState::Invoiced);
        assert_eq!(rows[0].fee_invoice_id.as_deref(), Some("inv_1"));
    }

    #[tokio::test]
    async fn the_period_selects_by_the_day_of_play() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-period");
        for (reservation, played) in [("res_1", day(5)), ("res_2", day(15)), ("res_3", day(25))] {
            repository
                .record_cancellation(
                    &tenant,
                    &cancellation(
                        reservation,
                        Some("cus_1"),
                        played,
                        CancellationReason::Personal,
                    ),
                )
                .await
                .unwrap();
        }

        let query = CancellationQuery {
            from: Some(day(10)),
            to: Some(day(20)),
            ..CancellationQuery::default()
        };
        let rows = repository
            .list_cancellations(&tenant, &query)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reservation_id, ReservationId::new("res_2"));
        assert_eq!(
            repository
                .count_cancellations(&tenant, &query)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn only_the_reasons_the_club_charges_for_are_selected() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-chargeable");
        repository
            .record_cancellation(
                &tenant,
                &cancellation(
                    "res_weather",
                    Some("cus_1"),
                    day(10),
                    CancellationReason::Weather,
                ),
            )
            .await
            .unwrap();
        repository
            .record_cancellation(
                &tenant,
                &cancellation(
                    "res_noshow",
                    Some("cus_2"),
                    day(10),
                    CancellationReason::NoContact,
                ),
            )
            .await
            .unwrap();

        let query = CancellationQuery {
            fee_expected_only: true,
            ..CancellationQuery::default()
        };
        let rows = repository
            .list_cancellations(&tenant, &query)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reservation_id, ReservationId::new("res_noshow"));
    }

    #[tokio::test]
    async fn a_booking_nobody_linked_is_left_out_when_a_fee_needs_somebody_to_bill() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-linked");
        repository
            .record_cancellation(
                &tenant,
                &cancellation("res_1", None, day(10), CancellationReason::Personal),
            )
            .await
            .unwrap();

        let query = CancellationQuery {
            linked_only: true,
            ..CancellationQuery::default()
        };
        assert!(repository
            .list_cancellations(&tenant, &query)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            repository
                .count_cancellations(&tenant, &query)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn a_batch_of_decisions_lands_together_and_answers_with_the_rows() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-settle");
        for reservation in ["res_1", "res_2"] {
            repository
                .record_cancellation(
                    &tenant,
                    &cancellation(
                        reservation,
                        Some("cus_1"),
                        day(10),
                        CancellationReason::Personal,
                    ),
                )
                .await
                .unwrap();
        }

        let settled = repository
            .settle_cancellation_fees(
                &tenant,
                &[
                    CancellationFeeDecision {
                        reservation_id: ReservationId::new("res_1"),
                        state: CancellationFeeState::Invoiced,
                        invoice_id: Some("inv_1".to_string()),
                        amount: Some(5_000),
                        note: None,
                    },
                    CancellationFeeDecision {
                        reservation_id: ReservationId::new("res_2"),
                        state: CancellationFeeState::Waived,
                        invoice_id: None,
                        amount: None,
                        note: Some("常連のため".to_string()),
                    },
                ],
            )
            .await
            .unwrap();

        assert_eq!(settled.len(), 2);
        let invoiced = settled
            .iter()
            .find(|row| row.reservation_id == ReservationId::new("res_1"))
            .unwrap();
        assert_eq!(invoiced.fee_state, CancellationFeeState::Invoiced);
        assert_eq!(invoiced.fee_amount, Some(5_000));
        assert!(invoiced.fee_settled_at.is_some());
        let waived = settled
            .iter()
            .find(|row| row.reservation_id == ReservationId::new("res_2"))
            .unwrap();
        assert_eq!(waived.fee_state, CancellationFeeState::Waived);
        assert_eq!(waived.fee_note.as_deref(), Some("常連のため"));
    }

    #[tokio::test]
    async fn one_clubs_cancellations_are_invisible_to_another() {
        let repository = repository().await;
        let mine = test_tenant("cancel-mine");
        let theirs = test_tenant("cancel-theirs");
        repository
            .record_cancellation(
                &mine,
                &cancellation(
                    "res_1",
                    Some("cus_1"),
                    day(10),
                    CancellationReason::Personal,
                ),
            )
            .await
            .unwrap();

        assert!(repository
            .list_cancellations(&theirs, &CancellationQuery::default())
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn settling_a_booking_that_belongs_to_another_club_changes_nothing() {
        let repository = repository().await;
        let mine = test_tenant("cancel-settle-mine");
        let theirs = test_tenant("cancel-settle-theirs");
        repository
            .record_cancellation(
                &mine,
                &cancellation(
                    "res_1",
                    Some("cus_1"),
                    day(10),
                    CancellationReason::Personal,
                ),
            )
            .await
            .unwrap();

        let settled = repository
            .settle_cancellation_fees(
                &theirs,
                &[CancellationFeeDecision {
                    reservation_id: ReservationId::new("res_1"),
                    state: CancellationFeeState::Waived,
                    invoice_id: None,
                    amount: None,
                    note: None,
                }],
            )
            .await
            .unwrap();
        assert!(settled.is_empty());

        let rows = repository
            .list_cancellations(&mine, &CancellationQuery::default())
            .await
            .unwrap();
        assert_eq!(rows[0].fee_state, CancellationFeeState::Unsettled);
    }

    #[tokio::test]
    async fn a_sort_orders_the_whole_period_and_leaves_blanks_last() {
        let repository = repository().await;
        let tenant = test_tenant("cancel-sort");
        let mut small = cancellation("res_small", None, day(10), CancellationReason::Illness);
        small.booking_amount = Some(12_000);
        let mut large = cancellation("res_large", None, day(11), CancellationReason::Illness);
        large.booking_amount = Some(96_000);
        let mut blank = cancellation("res_blank", None, day(12), CancellationReason::Illness);
        blank.booking_amount = None;
        for row in [&small, &large, &blank] {
            repository.record_cancellation(&tenant, row).await.unwrap();
        }

        let ids = |rows: Vec<ReservationCancellation>| {
            rows.into_iter()
                .map(|row| row.reservation_id.as_str().to_string())
                .collect::<Vec<_>>()
        };
        for (descending, expected) in [
            (true, ["res_large", "res_small", "res_blank"]),
            (false, ["res_small", "res_large", "res_blank"]),
        ] {
            let query = CancellationQuery {
                sort: CancellationSort::BookingAmount,
                descending,
                ..CancellationQuery::default()
            };
            let rows = repository
                .list_cancellations(&tenant, &query)
                .await
                .unwrap();
            assert_eq!(ids(rows), expected);
        }

        // The second page continues the same order rather than restarting it.
        let query = CancellationQuery {
            sort: CancellationSort::BookingAmount,
            descending: true,
            ..CancellationQuery::default()
        }
        .with_paging(Some(1), Some(1));
        let rows = repository
            .list_cancellations(&tenant, &query)
            .await
            .unwrap();
        assert_eq!(ids(rows), ["res_small"]);
    }
}
