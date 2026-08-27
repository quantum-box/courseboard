//! CourseBoard's own storage for what a membership takes off the green fee.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_membership_discounts`). Field sells the plan; the
//! price rule against it is golf's (ADR-0009).

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, MemberDiscount, MembershipDiscount, MembershipDiscounts,
    MembershipDiscountsGateway,
};

pub struct MySqlMembershipDiscountsRepository {
    pool: MySqlPool,
}

impl MySqlMembershipDiscountsRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl MembershipDiscountsGateway for MySqlMembershipDiscountsRepository {
    async fn get_membership_discounts(
        &self,
        tenant_id: &str,
    ) -> Result<MembershipDiscounts, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT plan_id, discount_kind, discount_value
            FROM golf_membership_discounts
            WHERE tenant_id = ?
            ORDER BY plan_id
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut discounts = Vec::with_capacity(rows.len());
        for row in &rows {
            let kind: String = row.try_get("discount_kind").map_err(provider)?;
            let value: i64 = row.try_get("discount_value").map_err(provider)?;
            discounts.push(MembershipDiscount::new(
                row.try_get::<String, _>("plan_id").map_err(provider)?,
                MemberDiscount::try_new(&kind, value)?,
            ));
        }
        Ok(MembershipDiscounts::reconstitute(discounts))
    }

    async fn replace_membership_discounts(
        &self,
        tenant_id: &str,
        discounts: &MembershipDiscounts,
    ) -> Result<MembershipDiscounts, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;

        // Delete by named plan and upsert the rest, as the other CourseBoard
        // tables do: a blanket per-tenant DELETE locks a range wide enough that
        // two tenants saving at once deadlock each other on TiDB.
        let existing =
            sqlx::query("SELECT plan_id FROM golf_membership_discounts WHERE tenant_id = ?")
                .bind(tenant_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(provider)?;
        let mut dropped = Vec::new();
        for row in &existing {
            let plan_id: String = row.try_get("plan_id").map_err(provider)?;
            if !discounts
                .entries()
                .iter()
                .any(|entry| entry.plan_id().as_str() == plan_id)
            {
                dropped.push(plan_id);
            }
        }
        if !dropped.is_empty() {
            let placeholders = vec!["?"; dropped.len()].join(", ");
            let statement = format!(
                r#"
                DELETE FROM golf_membership_discounts
                WHERE tenant_id = ?
                  AND plan_id IN ({placeholders})
                "#,
            );
            let mut query = sqlx::query(&statement).bind(tenant_id);
            for plan_id in &dropped {
                query = query.bind(plan_id);
            }
            query.execute(&mut *tx).await.map_err(provider)?;
        }

        for entry in discounts.entries() {
            sqlx::query(
                r#"
                INSERT INTO golf_membership_discounts
                    (tenant_id, plan_id, discount_kind, discount_value)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    discount_kind = VALUES(discount_kind),
                    discount_value = VALUES(discount_value),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(entry.plan_id().as_str())
            .bind(entry.discount().kind())
            .bind(entry.discount().value())
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(discounts.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::MembershipPlanId;
    use crate::test_support::{test_pool, test_tenant};

    async fn repository() -> MySqlMembershipDiscountsRepository {
        MySqlMembershipDiscountsRepository::new(test_pool().await)
    }

    #[tokio::test]
    async fn a_club_that_discounts_nothing_reads_back_empty() {
        let repository = repository().await;
        let tenant = test_tenant("discounts-unset");
        assert!(repository
            .get_membership_discounts(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn both_discount_shapes_survive_the_round_trip() {
        // Yen and percent are stored in one column pair, so a round trip is
        // where a shape silently turning into the other would show.
        let repository = repository().await;
        let tenant = test_tenant("discounts-round-trip");
        repository
            .replace_membership_discounts(
                &tenant,
                &MembershipDiscounts::try_new(vec![
                    MembershipDiscount::new("plan_full", MemberDiscount::Yen(5_000)),
                    MembershipDiscount::new("plan_weekday", MemberDiscount::Percent(20)),
                ])
                .unwrap(),
            )
            .await
            .unwrap();

        let stored = repository.get_membership_discounts(&tenant).await.unwrap();
        assert_eq!(
            stored.for_plan(&MembershipPlanId::new("plan_full")),
            Some(MemberDiscount::Yen(5_000))
        );
        assert_eq!(
            stored.for_plan(&MembershipPlanId::new("plan_weekday")),
            Some(MemberDiscount::Percent(20))
        );
    }

    #[tokio::test]
    async fn clearing_a_plans_discount_removes_it_rather_than_leaving_the_old_one() {
        // The failure this guards: a club withdrawing 平日会員's discount and
        // the counter still quoting it.
        let repository = repository().await;
        let tenant = test_tenant("discounts-clear");
        repository
            .replace_membership_discounts(
                &tenant,
                &MembershipDiscounts::try_new(vec![
                    MembershipDiscount::new("plan_full", MemberDiscount::Yen(5_000)),
                    MembershipDiscount::new("plan_weekday", MemberDiscount::Percent(20)),
                ])
                .unwrap(),
            )
            .await
            .unwrap();
        repository
            .replace_membership_discounts(
                &tenant,
                &MembershipDiscounts::try_new(vec![MembershipDiscount::new(
                    "plan_full",
                    MemberDiscount::Yen(6_000),
                )])
                .unwrap(),
            )
            .await
            .unwrap();

        let stored = repository.get_membership_discounts(&tenant).await.unwrap();
        assert_eq!(stored.entries().len(), 1);
        assert_eq!(
            stored.for_plan(&MembershipPlanId::new("plan_full")),
            Some(MemberDiscount::Yen(6_000))
        );
        assert_eq!(
            stored.for_plan(&MembershipPlanId::new("plan_weekday")),
            None
        );
    }

    #[tokio::test]
    async fn one_clubs_discounts_are_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("discounts-ours");
        let theirs = test_tenant("discounts-theirs");
        repository
            .replace_membership_discounts(
                &ours,
                &MembershipDiscounts::try_new(vec![MembershipDiscount::new(
                    "plan_full",
                    MemberDiscount::Yen(5_000),
                )])
                .unwrap(),
            )
            .await
            .unwrap();

        assert!(repository
            .get_membership_discounts(&theirs)
            .await
            .unwrap()
            .is_empty());
    }
}
