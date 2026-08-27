//! CourseBoard's own storage for when each membership may be played.
//!
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_membership_play_windows`). Field sells the plan;
//! when it may be used is golf's (ADR-0009).

use async_trait::async_trait;
use chrono::NaiveTime;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, MembershipPlanId, MembershipPlayWindow, MembershipPlayWindows,
    MembershipPlayWindowsGateway, PlayableDays,
};

pub struct MySqlMembershipPlayWindowsRepository {
    pool: MySqlPool,
}

impl MySqlMembershipPlayWindowsRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl MembershipPlayWindowsGateway for MySqlMembershipPlayWindowsRepository {
    async fn get_membership_play_windows(
        &self,
        tenant_id: &str,
    ) -> Result<MembershipPlayWindows, CourseError> {
        let rows = sqlx::query(
            r#"
            SELECT plan_id, playable_days, from_time, to_time
            FROM golf_membership_play_windows
            WHERE tenant_id = ?
            ORDER BY plan_id
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(provider)?;

        let mut windows = Vec::with_capacity(rows.len());
        for row in &rows {
            windows.push(MembershipPlayWindow::try_new(
                MembershipPlanId::new(row.try_get::<String, _>("plan_id").map_err(provider)?),
                PlayableDays::from_bits(row.try_get::<u8, _>("playable_days").map_err(provider)?),
                row.try_get::<Option<NaiveTime>, _>("from_time")
                    .map_err(provider)?,
                row.try_get::<Option<NaiveTime>, _>("to_time")
                    .map_err(provider)?,
            )?);
        }
        Ok(MembershipPlayWindows::reconstitute(windows))
    }

    async fn replace_membership_play_windows(
        &self,
        tenant_id: &str,
        windows: &MembershipPlayWindows,
    ) -> Result<MembershipPlayWindows, CourseError> {
        let mut tx = self.pool.begin().await.map_err(provider)?;

        // Delete by named plan and upsert the rest, as the other CourseBoard
        // tables do: a blanket per-tenant DELETE locks a range wide enough that
        // two tenants saving at once deadlock each other on TiDB.
        let existing =
            sqlx::query("SELECT plan_id FROM golf_membership_play_windows WHERE tenant_id = ?")
                .bind(tenant_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(provider)?;
        let mut dropped = Vec::new();
        for row in &existing {
            let plan_id: String = row.try_get("plan_id").map_err(provider)?;
            if !windows
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
                DELETE FROM golf_membership_play_windows
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

        for entry in windows.entries() {
            sqlx::query(
                r#"
                INSERT INTO golf_membership_play_windows
                    (tenant_id, plan_id, playable_days, from_time, to_time)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    playable_days = VALUES(playable_days),
                    from_time = VALUES(from_time),
                    to_time = VALUES(to_time),
                    updated_at = CURRENT_TIMESTAMP(6)
                "#,
            )
            .bind(tenant_id)
            .bind(entry.plan_id().as_str())
            .bind(entry.days().bits())
            .bind(entry.from())
            .bind(entry.to())
            .execute(&mut *tx)
            .await
            .map_err(provider)?;
        }
        tx.commit().await.map_err(provider)?;
        Ok(windows.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::PlayWindowBreach;
    use crate::test_support::{test_pool, test_tenant};
    use chrono::Weekday;

    fn at(hour: u32, minute: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(hour, minute, 0).unwrap()
    }

    async fn repository() -> MySqlMembershipPlayWindowsRepository {
        MySqlMembershipPlayWindowsRepository::new(test_pool().await)
    }

    fn weekday_mornings() -> MembershipPlayWindows {
        MembershipPlayWindows::try_new(vec![MembershipPlayWindow::try_new(
            MembershipPlanId::new("plan_weekday"),
            PlayableDays::from_flags([true, true, true, true, true, false, false]),
            Some(at(6, 0)),
            Some(at(12, 0)),
        )
        .unwrap()])
        .unwrap()
    }

    #[tokio::test]
    async fn a_club_that_restricts_nothing_reads_back_empty() {
        let repository = repository().await;
        let tenant = test_tenant("play-windows-unset");
        assert!(repository
            .get_membership_play_windows(&tenant)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn the_window_survives_the_round_trip_and_still_judges_the_same() {
        // Days are stored as a bit set and times as SQL TIME, so the round trip
        // is where a Saturday quietly becoming playable would show.
        let repository = repository().await;
        let tenant = test_tenant("play-windows-round-trip");
        repository
            .replace_membership_play_windows(&tenant, &weekday_mornings())
            .await
            .unwrap();

        let stored = repository
            .get_membership_play_windows(&tenant)
            .await
            .unwrap();
        let plan = MembershipPlanId::new("plan_weekday");
        assert_eq!(
            stored.breach_for(Some(&plan), Weekday::Sat, at(8, 0)),
            Some(PlayWindowBreach::Day)
        );
        assert_eq!(
            stored.breach_for(Some(&plan), Weekday::Wed, at(14, 0)),
            Some(PlayWindowBreach::Time)
        );
        assert_eq!(stored.breach_for(Some(&plan), Weekday::Wed, at(8, 0)), None);
    }

    #[tokio::test]
    async fn lifting_a_restriction_removes_it_rather_than_leaving_the_old_one() {
        // The failure this guards: a club opening 平日会員 to weekends and the
        // desk still being warned every Saturday.
        let repository = repository().await;
        let tenant = test_tenant("play-windows-lift");
        repository
            .replace_membership_play_windows(&tenant, &weekday_mornings())
            .await
            .unwrap();
        repository
            .replace_membership_play_windows(&tenant, &MembershipPlayWindows::default())
            .await
            .unwrap();

        let stored = repository
            .get_membership_play_windows(&tenant)
            .await
            .unwrap();
        assert!(stored.is_empty());
        assert_eq!(
            stored.breach_for(
                Some(&MembershipPlanId::new("plan_weekday")),
                Weekday::Sat,
                at(8, 0)
            ),
            None
        );
    }

    #[tokio::test]
    async fn one_clubs_windows_are_invisible_to_another() {
        let repository = repository().await;
        let ours = test_tenant("play-windows-ours");
        let theirs = test_tenant("play-windows-theirs");
        repository
            .replace_membership_play_windows(&ours, &weekday_mornings())
            .await
            .unwrap();

        assert!(repository
            .get_membership_play_windows(&theirs)
            .await
            .unwrap()
            .is_empty());
    }
}
