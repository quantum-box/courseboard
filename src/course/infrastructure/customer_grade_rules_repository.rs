//! CourseBoard's own storage for the customer grade ladder.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_customer_grade_rules`). Grades are golf's
//! judgement about generic bookings, so they are ours to keep (ADR-0009).

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, CustomerGradeRule, CustomerGradeRules, CustomerGradeRulesGateway,
};

pub struct MySqlCustomerGradeRulesRepository {
    pool: MySqlPool,
}

impl MySqlCustomerGradeRulesRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl CustomerGradeRulesGateway for MySqlCustomerGradeRulesRepository {
    async fn get_customer_grade_rules(
        &self,
        tenant_id: &str,
    ) -> Result<CustomerGradeRules, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT name, min_visits, min_spend_per_player, min_total_amount
            FROM golf_customer_grade_rules
            WHERE tenant_id = ?
            ORDER BY position
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut rules = Vec::with_capacity(rows.len());
        for row in &rows {
            // Reconstitute rather than validate: these rows were validated on
            // the way in, and refusing to read back a rung the club already
            // saved would take the whole ladder down with it.
            rules.push(CustomerGradeRule::try_new(
                row.try_get::<String, _>("name").map_err(provider)?,
                row.try_get::<u32, _>("min_visits").map_err(provider)?,
                row.try_get::<Option<i64>, _>("min_spend_per_player")
                    .map_err(provider)?,
                row.try_get::<Option<i64>, _>("min_total_amount")
                    .map_err(provider)?,
            )?);
        }
        Ok(CustomerGradeRules::reconstitute(rules))
    }

    async fn replace_customer_grade_rules(
        &self,
        tenant_id: &str,
        rules: &CustomerGradeRules,
    ) -> Result<CustomerGradeRules, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;

        // Delete by named rung and upsert the rest, as the player tags and the
        // course order do: a blanket per-tenant DELETE locks a range wide
        // enough that two tenants saving at once deadlock each other on TiDB.
        let existing =
            sqlx::query("SELECT name FROM golf_customer_grade_rules WHERE tenant_id = ?")
                .bind(tenant_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(provider)?;
        let mut dropped = Vec::new();
        for row in &existing {
            let name: String = row.try_get("name").map_err(provider)?;
            if !rules.rules().iter().any(|rule| rule.name() == name) {
                dropped.push(name);
            }
        }
        if !dropped.is_empty() {
            let placeholders = vec!["?"; dropped.len()].join(", ");
            let statement = format!(
                r#"
                DELETE FROM golf_customer_grade_rules
                WHERE tenant_id = ?
                  AND name IN ({placeholders})
                "#,
            );
            let mut query = sqlx::query(&statement).bind(tenant_id);
            for name in &dropped {
                query = query.bind(name);
            }
            query.execute(&mut *tx).await.map_err(provider)?;
        }

        for (position, rule) in rules.rules().iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO golf_customer_grade_rules
                    (tenant_id, name, position, min_visits, min_spend_per_player, min_total_amount)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    position = VALUES(position),
                    min_visits = VALUES(min_visits),
                    min_spend_per_player = VALUES(min_spend_per_player),
                    min_total_amount = VALUES(min_total_amount),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(rule.name())
            .bind(position as i32)
            .bind(rule.min_visits())
            .bind(rule.min_spend_per_player())
            .bind(rule.min_total_amount())
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(rules.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};

    fn rung(name: &str, min_visits: u32, spend: Option<i64>) -> CustomerGradeRule {
        CustomerGradeRule::try_new(name, min_visits, spend, None).expect("rung")
    }

    async fn repository() -> MySqlCustomerGradeRulesRepository {
        MySqlCustomerGradeRulesRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn a_club_that_never_set_a_ladder_reads_back_empty() {
        let repository = repository().await;
        let tenant = test_tenant("grades-unset");
        assert!(repository
            .get_customer_grade_rules(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn the_ladder_survives_the_round_trip_in_the_order_it_was_arranged() {
        // Order is the judgement, not decoration: it decides which rung a
        // customer clearing several of them is given.
        let repository = repository().await;
        let tenant = test_tenant("grades-round-trip");
        let ladder = CustomerGradeRules::try_new(vec![
            rung("ゴールド", 24, Some(15_000)),
            rung("シルバー", 12, None),
            rung("ブロンズ", 4, None),
        ])
        .unwrap();
        repository
            .replace_customer_grade_rules(&tenant, &ladder)
            .await
            .unwrap();

        let stored = repository.get_customer_grade_rules(&tenant).await.unwrap();
        let names: Vec<&str> = stored.rules().iter().map(CustomerGradeRule::name).collect();
        assert_eq!(names, ["ゴールド", "シルバー", "ブロンズ"]);
        assert_eq!(stored.rules()[0].min_spend_per_player(), Some(15_000));
        assert_eq!(stored.rules()[1].min_spend_per_player(), None);
    }

    #[tokio::test]
    async fn rearranging_and_dropping_replaces_the_ladder_rather_than_stacking() {
        let repository = repository().await;
        let tenant = test_tenant("grades-rearrange");
        repository
            .replace_customer_grade_rules(
                &tenant,
                &CustomerGradeRules::try_new(vec![
                    rung("ゴールド", 24, None),
                    rung("シルバー", 12, None),
                    rung("ブロンズ", 4, None),
                ])
                .unwrap(),
            )
            .await
            .unwrap();
        repository
            .replace_customer_grade_rules(
                &tenant,
                &CustomerGradeRules::try_new(vec![
                    rung("ブロンズ", 6, None),
                    rung("ゴールド", 30, None),
                ])
                .unwrap(),
            )
            .await
            .unwrap();

        let stored = repository.get_customer_grade_rules(&tenant).await.unwrap();
        let names: Vec<&str> = stored.rules().iter().map(CustomerGradeRule::name).collect();
        assert_eq!(names, ["ブロンズ", "ゴールド"]);
        assert_eq!(stored.rules()[0].min_visits(), 6);
    }

    #[tokio::test]
    async fn one_clubs_ladder_is_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("grades-ours");
        let theirs = test_tenant("grades-theirs");
        repository
            .replace_customer_grade_rules(
                &ours,
                &CustomerGradeRules::try_new(vec![rung("ゴールド", 24, None)]).unwrap(),
            )
            .await
            .unwrap();

        assert!(repository
            .get_customer_grade_rules(&theirs)
            .await
            .unwrap()
            .is_empty());
    }
}
