//! CourseBoard's own log of caddies moved onto their rank fee.
//!
//! Reads and writes `golf_caddie_own_fee_changes`. The caddie profile upstream only
//! holds the current fee, so this is where the amount before a move is kept
//! (PLT-3346).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CaddieFeeChange, CaddieFeeChangeGateway, CaddieId, CaddieRank, CourseError,
    RecordedCaddieFeeChange,
};

pub struct MySqlCaddieFeeChangeRepository {
    pool: MySqlPool,
}

impl MySqlCaddieFeeChangeRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl CaddieFeeChangeGateway for MySqlCaddieFeeChangeRepository {
    async fn record_pending_fee_change(
        &self,
        tenant_id: &str,
        change: &CaddieFeeChange,
    ) -> Result<u64, CourseError> {
        let result = sqlx::query(
            r#"
            INSERT INTO golf_caddie_own_fee_changes
                (tenant_id, caddie_profile_id, rank_code, previous_fee, new_fee,
                 rank_fee, currency, note, changed_by, changed_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(tenant_id)
        .bind(change.caddie_id.as_str())
        .bind(change.rank.as_str())
        .bind(change.previous_fee)
        .bind(change.new_fee)
        .bind(change.rank_fee)
        .bind(&change.currency)
        .bind(change.note.as_deref())
        .bind(change.changed_by.as_deref())
        .bind(change.changed_by_name.as_deref())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(result.last_insert_id())
    }

    async fn confirm_fee_change(&self, tenant_id: &str, id: u64) -> Result<(), CourseError> {
        sqlx::query(
            r#"
            UPDATE golf_caddie_own_fee_changes
            SET applied_at = CURRENT_TIMESTAMP(6)
            WHERE tenant_id = ? AND id = ? AND applied_at IS NULL
            "#,
        )
        .bind(tenant_id)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }

    async fn discard_fee_change(&self, tenant_id: &str, id: u64) -> Result<(), CourseError> {
        // Only an unconfirmed row: a confirmed one is a pay change that
        // happened, and the log must never lose one.
        sqlx::query(
            r#"
            DELETE FROM golf_caddie_own_fee_changes
            WHERE tenant_id = ? AND id = ? AND applied_at IS NULL
            "#,
        )
        .bind(tenant_id)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(())
    }

    async fn list_fee_changes(
        &self,
        tenant_id: &str,
        limit: u32,
    ) -> Result<Vec<RecordedCaddieFeeChange>, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT id, caddie_profile_id, rank_code, previous_fee, new_fee, rank_fee,
                   currency, note, changed_by, changed_by_name, applied_at
            FROM golf_caddie_own_fee_changes
            WHERE tenant_id = ? AND applied_at IS NOT NULL
            ORDER BY applied_at DESC, id DESC
            LIMIT ?
            "#,
        )
        .bind(tenant_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        rows.into_iter()
            .map(|row| {
                let rank: String = row.try_get("rank_code").map_err(provider)?;
                let caddie_id: String = row.try_get("caddie_profile_id").map_err(provider)?;
                let changed_at: DateTime<Utc> = row.try_get("applied_at").map_err(provider)?;
                Ok(RecordedCaddieFeeChange {
                    id: row.try_get("id").map_err(provider)?,
                    change: CaddieFeeChange {
                        caddie_id: CaddieId::new(caddie_id),
                        rank: CaddieRank::parse(&rank),
                        previous_fee: row.try_get("previous_fee").map_err(provider)?,
                        new_fee: row.try_get("new_fee").map_err(provider)?,
                        rank_fee: row.try_get("rank_fee").map_err(provider)?,
                        currency: row.try_get("currency").map_err(provider)?,
                        note: row.try_get("note").map_err(provider)?,
                        changed_by: row.try_get("changed_by").map_err(provider)?,
                        changed_by_name: row.try_get("changed_by_name").map_err(provider)?,
                    },
                    changed_at,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn change(caddie: &str, previous_fee: i64) -> CaddieFeeChange {
        CaddieFeeChange {
            caddie_id: CaddieId::new(caddie),
            rank: CaddieRank::B,
            previous_fee,
            new_fee: 0,
            rank_fee: 11_000,
            currency: "JPY".into(),
            note: Some("現場合意".into()),
            changed_by: Some("user-1".into()),
            changed_by_name: Some("yamada".into()),
        }
    }

    #[tokio::test]
    async fn a_confirmed_change_reads_back_with_what_it_was_before() {
        let repository = MySqlCaddieFeeChangeRepository::new(test_pool().await);
        let tenant = test_tenant("fee-changes-confirmed");
        let id = repository
            .record_pending_fee_change(&tenant, &change("cp_1", 13_000))
            .await
            .unwrap();
        repository.confirm_fee_change(&tenant, id).await.unwrap();

        let listed = repository.list_fee_changes(&tenant, 10).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].change, change("cp_1", 13_000));
    }

    #[tokio::test]
    async fn an_unconfirmed_change_is_not_listed() {
        // The profile write never went through, so nobody's pay changed.
        let repository = MySqlCaddieFeeChangeRepository::new(test_pool().await);
        let tenant = test_tenant("fee-changes-pending");
        repository
            .record_pending_fee_change(&tenant, &change("cp_1", 13_000))
            .await
            .unwrap();
        assert!(repository
            .list_fee_changes(&tenant, 10)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn discarding_never_removes_a_change_that_happened() {
        let repository = MySqlCaddieFeeChangeRepository::new(test_pool().await);
        let tenant = test_tenant("fee-changes-discard");
        let applied = repository
            .record_pending_fee_change(&tenant, &change("cp_1", 13_000))
            .await
            .unwrap();
        repository
            .confirm_fee_change(&tenant, applied)
            .await
            .unwrap();
        repository
            .discard_fee_change(&tenant, applied)
            .await
            .unwrap();

        assert_eq!(
            repository
                .list_fee_changes(&tenant, 10)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn one_clubs_log_is_invisible_to_another() {
        let repository = MySqlCaddieFeeChangeRepository::new(test_pool().await);
        let ours = test_tenant("fee-changes-ours");
        let theirs = test_tenant("fee-changes-theirs");
        let id = repository
            .record_pending_fee_change(&ours, &change("cp_1", 13_000))
            .await
            .unwrap();
        // Confirming under the wrong tenant must not touch our row.
        repository.confirm_fee_change(&theirs, id).await.unwrap();
        assert!(repository
            .list_fee_changes(&ours, 10)
            .await
            .unwrap()
            .is_empty());
        repository.confirm_fee_change(&ours, id).await.unwrap();
        assert!(repository
            .list_fee_changes(&theirs, 10)
            .await
            .unwrap()
            .is_empty());
    }
}
