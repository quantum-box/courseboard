//! CourseBoard's own storage for who was actually seen at the desk.
//!
//! Reads and writes `golf_visit_checkins` in CourseBoard's MySQL. Field has
//! nowhere to put a per-player arrival — its reservation carries one customer
//! and a headcount — and the group's seats are CourseBoard's `golfParty`, so
//! this is ours to keep (ADR-0009).

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{MySqlPool, QueryBuilder, Row};

use crate::course::domain::{
    CourseError, CustomerId, ReservationId, VisitCheckin, VisitCheckinGateway, VisitCheckinRequest,
};

pub struct MySqlVisitCheckinRepository {
    pool: MySqlPool,
}

impl MySqlVisitCheckinRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn row_to_checkin(row: &sqlx::mysql::MySqlRow) -> Result<VisitCheckin, CourseError> {
    let reservation_id: String = row.try_get("reservation_id").map_err(provider)?;
    let customer_id: Option<String> = row.try_get("customer_id").map_err(provider)?;
    Ok(VisitCheckin {
        reservation_id: ReservationId::new(reservation_id),
        player_index: row.try_get::<u32, _>("player_index").map_err(provider)?,
        customer_id: customer_id.map(CustomerId::new),
        player_name: row.try_get("player_name").map_err(provider)?,
        played_on: row.try_get::<NaiveDate, _>("played_on").map_err(provider)?,
        checked_in_at: row
            .try_get::<DateTime<Utc>, _>("checked_in_at")
            .map_err(provider)?,
        checked_in_by: row.try_get("checked_in_by").map_err(provider)?,
    })
}

#[async_trait]
impl VisitCheckinGateway for MySqlVisitCheckinRepository {
    async fn record_visit_checkins(
        &self,
        tenant_id: &str,
        request: &VisitCheckinRequest,
        checked_in_by: Option<&str>,
    ) -> Result<Vec<VisitCheckin>, CourseError> {
        // One statement for the whole group. A group walks up together, and
        // four separate writes is four chances to leave half a group recorded.
        let mut builder = QueryBuilder::new(
            "INSERT INTO golf_visit_checkins \
             (tenant_id, reservation_id, player_index, customer_id, player_name, played_on, checked_in_by) ",
        );
        builder.push_values(&request.players, |mut row, player| {
            row.push_bind(tenant_id)
                .push_bind(request.reservation_id.as_str())
                .push_bind(player.player_index)
                .push_bind(player.customer_id.as_ref().map(CustomerId::as_str))
                .push_bind(player.player_name.as_str())
                .push_bind(request.played_on)
                .push_bind(checked_in_by);
        });
        // Pressing the button twice is one arrival. The later press is allowed
        // to correct who the seat turned out to be — the desk often links a
        // name to the ledger after the group has already gone out — but the
        // arrival time stays the first one, because that is when they arrived.
        builder.push(
            " ON DUPLICATE KEY UPDATE \
             customer_id = VALUES(customer_id), \
             player_name = VALUES(player_name)",
        );
        builder
            .build()
            .execute(&self.pool)
            .await
            .map_err(provider)?;

        self.list_reservation_checkins(tenant_id, &request.reservation_id)
            .await
    }

    async fn list_customer_checkins(
        &self,
        tenant_id: &str,
        customer_id: &CustomerId,
    ) -> Result<Vec<VisitCheckin>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT reservation_id, player_index, customer_id, player_name,
                   played_on, checked_in_at, checked_in_by
            FROM golf_visit_checkins
            WHERE tenant_id = ? AND customer_id = ?
            ORDER BY played_on DESC, checked_in_at DESC
            "#,
        )
        .bind(tenant_id)
        .bind(customer_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.iter().map(row_to_checkin).collect()
    }

    async fn list_reservation_checkins(
        &self,
        tenant_id: &str,
        reservation_id: &ReservationId,
    ) -> Result<Vec<VisitCheckin>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT reservation_id, player_index, customer_id, player_name,
                   played_on, checked_in_at, checked_in_by
            FROM golf_visit_checkins
            WHERE tenant_id = ? AND reservation_id = ?
            ORDER BY player_index
            "#,
        )
        .bind(tenant_id)
        .bind(reservation_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.iter().map(row_to_checkin).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::NewVisitCheckin;
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlVisitCheckinRepository {
        MySqlVisitCheckinRepository::new(test_pool().await)
    }

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 30).unwrap()
    }

    fn request(reservation: &str, players: Vec<NewVisitCheckin>) -> VisitCheckinRequest {
        VisitCheckinRequest::try_new(ReservationId::new(reservation), day(), players).unwrap()
    }

    fn seat(index: u32, customer: Option<&str>, name: &str) -> NewVisitCheckin {
        NewVisitCheckin::try_new(index, customer.map(CustomerId::new), name).unwrap()
    }

    #[tokio::test]
    async fn a_group_is_written_and_read_back_in_seat_order() {
        let repository = repository().await;
        let tenant = test_tenant("checkin-group");
        let stored = repository
            .record_visit_checkins(
                &tenant,
                &request(
                    "res_1",
                    vec![
                        seat(1, Some("cus_2"), "佐藤 花子"),
                        seat(0, Some("cus_1"), "本田 康彦"),
                    ],
                ),
                Some("user-1"),
            )
            .await
            .unwrap();

        let names: Vec<&str> = stored
            .iter()
            .map(|checkin| checkin.player_name.as_str())
            .collect();
        assert_eq!(names, ["本田 康彦", "佐藤 花子"]);
        assert_eq!(stored[0].played_on, day());
        assert_eq!(stored[0].checked_in_by.as_deref(), Some("user-1"));
    }

    #[tokio::test]
    async fn pressing_the_button_twice_is_one_arrival() {
        let repository = repository().await;
        let tenant = test_tenant("checkin-idempotent");
        let group = request("res_1", vec![seat(0, Some("cus_1"), "本田 康彦")]);
        repository
            .record_visit_checkins(&tenant, &group, None)
            .await
            .unwrap();
        let stored = repository
            .record_visit_checkins(&tenant, &group, None)
            .await
            .unwrap();
        assert_eq!(stored.len(), 1);
    }

    #[tokio::test]
    async fn a_seat_can_be_linked_to_the_ledger_after_the_group_has_gone_out() {
        // The common case: four names go down at the desk and who two of them
        // are is settled later. The arrival already happened either way.
        let repository = repository().await;
        let tenant = test_tenant("checkin-late-link");
        repository
            .record_visit_checkins(
                &tenant,
                &request("res_1", vec![seat(0, None, "同伴者")]),
                None,
            )
            .await
            .unwrap();
        repository
            .record_visit_checkins(
                &tenant,
                &request("res_1", vec![seat(0, Some("cus_9"), "本田 康彦")]),
                None,
            )
            .await
            .unwrap();

        let seen = repository
            .list_customer_checkins(&tenant, &CustomerId::new("cus_9"))
            .await
            .unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].player_name, "本田 康彦");
    }

    #[tokio::test]
    async fn a_person_is_found_through_somebody_elses_booking() {
        // The whole point: Field cannot answer this, because the booking's
        // customer is the person who called, not this one.
        let repository = repository().await;
        let tenant = test_tenant("checkin-guest");
        repository
            .record_visit_checkins(
                &tenant,
                &request("res_host", vec![seat(2, Some("cus_guest"), "本田 康彦")]),
                None,
            )
            .await
            .unwrap();

        let seen = repository
            .list_customer_checkins(&tenant, &CustomerId::new("cus_guest"))
            .await
            .unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].reservation_id, ReservationId::new("res_host"));
    }

    #[tokio::test]
    async fn one_clubs_check_ins_are_invisible_to_another() {
        let repository = repository().await;
        let mine = test_tenant("checkin-mine");
        let theirs = test_tenant("checkin-theirs");
        repository
            .record_visit_checkins(
                &mine,
                &request("res_1", vec![seat(0, Some("cus_1"), "本田 康彦")]),
                None,
            )
            .await
            .unwrap();

        assert!(repository
            .list_customer_checkins(&theirs, &CustomerId::new("cus_1"))
            .await
            .unwrap()
            .is_empty());
    }
}
