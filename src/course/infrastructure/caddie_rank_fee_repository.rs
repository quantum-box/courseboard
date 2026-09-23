//! CourseBoard's own storage for the rank fee table.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_caddie_rank_fees`). What a club pays an A is a
//! golf operating rule with nothing behind it in Field, and it used to sit in
//! the extension config object that two other screens replace wholesale
//! (ADR-0009).
//!
//! Every save also appends to `golf_caddie_rank_fee_changes`, in the same
//! transaction, so what a round paid on a given day can be answered after the
//! table has moved on (PLT-3348).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{mysql::MySqlRow, MySqlPool, Row};

use crate::course::domain::{
    CaddieRank, CaddieRankFeeChange, CaddieRankFeeChangeContext, CaddieRankFeeGateway,
    CaddieRankFees, CourseError, MAX_RANK_FEE_CHANGE_LIMIT,
};

pub struct MySqlCaddieRankFeeRepository {
    pool: MySqlPool,
}

impl MySqlCaddieRankFeeRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

fn change_from_row(row: &MySqlRow) -> Result<Option<CaddieRankFeeChange>, CourseError> {
    let previous = match (
        row.try_get::<Option<i64>, _>("previous_fee_a")
            .map_err(provider)?,
        row.try_get::<Option<i64>, _>("previous_fee_b")
            .map_err(provider)?,
        row.try_get::<Option<i64>, _>("previous_fee_c")
            .map_err(provider)?,
        row.try_get::<Option<i64>, _>("previous_fee_d")
            .map_err(provider)?,
        row.try_get::<Option<String>, _>("previous_currency")
            .map_err(provider)?,
    ) {
        (Some(a), Some(b), Some(c), Some(d), Some(currency)) => {
            CaddieRankFees::try_new(a, b, c, d, currency).ok()
        }
        _ => None,
    };
    // An entry whose amounts no longer make a table is skipped rather than
    // failing the list: one row edited by hand should not hide every other
    // change from the person trying to explain a month's pay.
    let Ok(fees) = CaddieRankFees::try_new(
        row.try_get("fee_a").map_err(provider)?,
        row.try_get("fee_b").map_err(provider)?,
        row.try_get("fee_c").map_err(provider)?,
        row.try_get("fee_d").map_err(provider)?,
        row.try_get::<String, _>("currency").map_err(provider)?,
    ) else {
        return Ok(None);
    };
    Ok(Some(CaddieRankFeeChange {
        id: row.try_get("id").map_err(provider)?,
        previous,
        fees,
        note: row.try_get("note").map_err(provider)?,
        changed_by: row.try_get("changed_by").map_err(provider)?,
        changed_by_name: row.try_get("changed_by_name").map_err(provider)?,
        changed_at: row
            .try_get::<DateTime<Utc>, _>("changed_at")
            .map_err(provider)?,
    }))
}

#[async_trait]
impl CaddieRankFeeGateway for MySqlCaddieRankFeeRepository {
    async fn get_caddie_rank_fees(
        &self,
        tenant_id: &str,
    ) -> Result<Option<CaddieRankFees>, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT fee_a, fee_b, fee_c, fee_d, currency
            FROM golf_caddie_rank_fees
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        let Some(row) = row else {
            return Ok(None);
        };
        let a: i64 = row.try_get("fee_a").map_err(provider)?;
        let b: i64 = row.try_get("fee_b").map_err(provider)?;
        let c: i64 = row.try_get("fee_c").map_err(provider)?;
        let d: i64 = row.try_get("fee_d").map_err(provider)?;
        let currency: String = row.try_get("currency").map_err(provider)?;
        // A row that no longer satisfies the value object — a currency emptied
        // by hand, say — must not take the payroll screen down with it. The
        // caller falls back to the defaults, which is what it does for a tenant
        // that never set a table at all.
        Ok(CaddieRankFees::try_new(a, b, c, d, currency).ok())
    }

    async fn replace_caddie_rank_fees(
        &self,
        tenant_id: &str,
        previous: &CaddieRankFees,
        fees: &CaddieRankFees,
        context: &CaddieRankFeeChangeContext,
    ) -> Result<CaddieRankFees, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;
        sqlx::query(
            r#"
            INSERT INTO golf_caddie_rank_fees
                (tenant_id, fee_a, fee_b, fee_c, fee_d, currency)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                fee_a = VALUES(fee_a),
                fee_b = VALUES(fee_b),
                fee_c = VALUES(fee_c),
                fee_d = VALUES(fee_d),
                currency = VALUES(currency),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(fees.fee_for(CaddieRank::A))
        .bind(fees.fee_for(CaddieRank::B))
        .bind(fees.fee_for(CaddieRank::C))
        .bind(fees.fee_for(CaddieRank::D))
        .bind(fees.currency())
        .execute(&mut *tx)
        .await
        .map_err(provider)?;
        sqlx::query(
            r#"
            INSERT INTO golf_caddie_rank_fee_changes
                (tenant_id,
                 previous_fee_a, previous_fee_b, previous_fee_c, previous_fee_d,
                 previous_currency,
                 fee_a, fee_b, fee_c, fee_d, currency,
                 note, changed_by, changed_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(tenant_id)
        .bind(previous.fee_for(CaddieRank::A))
        .bind(previous.fee_for(CaddieRank::B))
        .bind(previous.fee_for(CaddieRank::C))
        .bind(previous.fee_for(CaddieRank::D))
        .bind(previous.currency())
        .bind(fees.fee_for(CaddieRank::A))
        .bind(fees.fee_for(CaddieRank::B))
        .bind(fees.fee_for(CaddieRank::C))
        .bind(fees.fee_for(CaddieRank::D))
        .bind(fees.currency())
        .bind(context.note())
        .bind(context.changed_by.as_deref())
        .bind(context.changed_by_name.as_deref())
        .execute(&mut *tx)
        .await
        .map_err(provider)?;
        tx.commit().await.map_err(provider)?;
        Ok(fees.clone())
    }

    async fn list_caddie_rank_fee_changes(
        &self,
        tenant_id: &str,
        limit: u32,
    ) -> Result<Vec<CaddieRankFeeChange>, CourseError> {
        let limit = limit.clamp(1, MAX_RANK_FEE_CHANGE_LIMIT);
        let rows = sqlx::query(
            r#"
            SELECT id,
                   previous_fee_a, previous_fee_b, previous_fee_c, previous_fee_d,
                   previous_currency,
                   fee_a, fee_b, fee_c, fee_d, currency,
                   note, changed_by, changed_by_name, changed_at
            FROM golf_caddie_rank_fee_changes
            WHERE tenant_id = ?
            ORDER BY changed_at DESC, id DESC
            LIMIT ?
            "#,
        )
        .bind(tenant_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;
        let mut changes = Vec::with_capacity(rows.len());
        for row in &rows {
            if let Some(change) = change_from_row(row)? {
                changes.push(change);
            }
        }
        Ok(changes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlCaddieRankFeeRepository {
        MySqlCaddieRankFeeRepository::new(test_pool().await)
    }

    fn fees(a: i64, b: i64, c: i64, d: i64) -> CaddieRankFees {
        CaddieRankFees::try_new(a, b, c, d, "JPY").expect("fees")
    }

    #[tokio::test]
    async fn a_club_that_never_priced_its_ranks_reads_back_as_unset() {
        let repository = repository().await;
        let tenant = test_tenant("rank-fees-unset");
        // Not the defaults: the caller has to be able to tell that nothing was
        // set here, because that is what sends it looking in the old place.
        assert!(repository
            .get_caddie_rank_fees(&tenant)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn the_table_survives_the_round_trip() {
        let repository = repository().await;
        let tenant = test_tenant("rank-fees-round-trip");
        repository
            .replace_caddie_rank_fees(
                &tenant,
                &CaddieRankFees::default(),
                &fees(15_000, 13_000, 11_000, 9_500),
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();

        let stored = repository
            .get_caddie_rank_fees(&tenant)
            .await
            .unwrap()
            .expect("a table was set");
        assert_eq!(stored.fee_for(CaddieRank::A), 15_000);
        assert_eq!(stored.fee_for(CaddieRank::D), 9_500);
        assert_eq!(stored.currency(), "JPY");
    }

    #[tokio::test]
    async fn a_table_set_to_the_defaults_still_counts_as_set() {
        // Otherwise a club that deliberately confirmed the default amounts
        // would keep being read out of the config it was migrated away from.
        let repository = repository().await;
        let tenant = test_tenant("rank-fees-defaults");
        repository
            .replace_caddie_rank_fees(
                &tenant,
                &CaddieRankFees::default(),
                &CaddieRankFees::default(),
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();

        assert_eq!(
            repository.get_caddie_rank_fees(&tenant).await.unwrap(),
            Some(CaddieRankFees::default())
        );
    }

    #[tokio::test]
    async fn repricing_replaces_the_table_rather_than_adding_a_second() {
        let repository = repository().await;
        let tenant = test_tenant("rank-fees-reprice");
        repository
            .replace_caddie_rank_fees(
                &tenant,
                &CaddieRankFees::default(),
                &fees(12_000, 11_000, 10_000, 9_000),
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();
        repository
            .replace_caddie_rank_fees(
                &tenant,
                &CaddieRankFees::default(),
                &fees(14_000, 12_000, 10_000, 8_000),
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();

        let stored = repository
            .get_caddie_rank_fees(&tenant)
            .await
            .unwrap()
            .expect("a table was set");
        assert_eq!(stored.fee_for(CaddieRank::A), 14_000);
        assert_eq!(stored.fee_for(CaddieRank::D), 8_000);
    }

    #[tokio::test]
    async fn a_rank_nobody_works_yet_can_be_priced_at_zero() {
        let repository = repository().await;
        let tenant = test_tenant("rank-fees-zero");
        repository
            .replace_caddie_rank_fees(
                &tenant,
                &CaddieRankFees::default(),
                &fees(12_000, 11_000, 10_000, 0),
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();

        let stored = repository
            .get_caddie_rank_fees(&tenant)
            .await
            .unwrap()
            .expect("a table was set");
        assert_eq!(stored.fee_for(CaddieRank::D), 0);
    }

    #[tokio::test]
    async fn one_clubs_pay_table_is_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("rank-fees-ours");
        let theirs = test_tenant("rank-fees-theirs");
        repository
            .replace_caddie_rank_fees(
                &ours,
                &CaddieRankFees::default(),
                &fees(15_000, 13_000, 11_000, 9_500),
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();

        assert!(repository
            .get_caddie_rank_fees(&theirs)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            repository
                .get_caddie_rank_fees(&ours)
                .await
                .unwrap()
                .expect("a table was set")
                .fee_for(CaddieRank::A),
            15_000
        );
    }

    #[tokio::test]
    async fn every_save_is_kept_with_what_it_replaced_and_who_made_it() {
        let repository = repository().await;
        let tenant = test_tenant("rank-fees-history");
        let first = fees(12_000, 11_000, 10_000, 9_000);
        let second = fees(13_000, 11_000, 10_000, 8_500);
        repository
            .replace_caddie_rank_fees(
                &tenant,
                &CaddieRankFees::default(),
                &first,
                &CaddieRankFeeChangeContext::default(),
            )
            .await
            .unwrap();
        let context = CaddieRankFeeChangeContext::try_new(
            Some("sub-1".into()),
            Some("yamada".into()),
            Some("春の改定"),
        )
        .unwrap();
        repository
            .replace_caddie_rank_fees(&tenant, &first, &second, &context)
            .await
            .unwrap();

        let changes = repository
            .list_caddie_rank_fee_changes(&tenant, 50)
            .await
            .unwrap();
        assert_eq!(changes.len(), 2);
        // Newest first: the question is nearly always about the latest move.
        let latest = &changes[0];
        assert_eq!(latest.previous.as_ref(), Some(&first));
        assert_eq!(latest.fees, second);
        assert_eq!(latest.note.as_deref(), Some("春の改定"));
        assert_eq!(latest.changed_by.as_deref(), Some("sub-1"));
        assert_eq!(latest.changed_by_name.as_deref(), Some("yamada"));
        assert_eq!(latest.changed_ranks(), vec![CaddieRank::A, CaddieRank::D]);
        assert_eq!(changes[1].fees, first);
    }

    #[tokio::test]
    async fn the_history_is_limited_and_kept_per_club() {
        let repository = repository().await;
        let ours = test_tenant("rank-fees-history-ours");
        let theirs = test_tenant("rank-fees-history-theirs");
        for amount in [10_000, 11_000, 12_000] {
            repository
                .replace_caddie_rank_fees(
                    &ours,
                    &CaddieRankFees::default(),
                    &fees(amount, 11_000, 10_000, 9_000),
                    &CaddieRankFeeChangeContext::default(),
                )
                .await
                .unwrap();
        }

        let limited = repository
            .list_caddie_rank_fee_changes(&ours, 2)
            .await
            .unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].fees.fee_for(CaddieRank::A), 12_000);
        assert!(repository
            .list_caddie_rank_fee_changes(&theirs, 50)
            .await
            .unwrap()
            .is_empty());
    }
}
