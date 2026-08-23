//! CourseBoard's own storage for the rank fee table.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_caddie_rank_fees`). What a club pays an A is a
//! golf operating rule with nothing behind it in Field, and it used to sit in
//! the extension config object that two other screens replace wholesale
//! (ADR-0009).

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{CaddieRankFeeGateway, CaddieRankFees, CourseError};

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
        fees: &CaddieRankFees,
    ) -> Result<CaddieRankFees, CourseError> {
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
        .bind(fees.fee_for(crate::course::domain::CaddieRank::A))
        .bind(fees.fee_for(crate::course::domain::CaddieRank::B))
        .bind(fees.fee_for(crate::course::domain::CaddieRank::C))
        .bind(fees.fee_for(crate::course::domain::CaddieRank::D))
        .bind(fees.currency())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(fees.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::CaddieRank;
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
            .replace_caddie_rank_fees(&tenant, &fees(15_000, 13_000, 11_000, 9_500))
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
            .replace_caddie_rank_fees(&tenant, &CaddieRankFees::default())
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
            .replace_caddie_rank_fees(&tenant, &fees(12_000, 11_000, 10_000, 9_000))
            .await
            .unwrap();
        repository
            .replace_caddie_rank_fees(&tenant, &fees(14_000, 12_000, 10_000, 8_000))
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
            .replace_caddie_rank_fees(&tenant, &fees(12_000, 11_000, 10_000, 0))
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
            .replace_caddie_rank_fees(&ours, &fees(15_000, 13_000, 11_000, 9_500))
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
}
