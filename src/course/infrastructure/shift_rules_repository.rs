//! CourseBoard's own storage for the club's shift-planning rules.
//!
//! Which weekdays a club would rather not rest anybody on is a golf operating
//! decision with nothing behind it in Field; see ADR-0005, and the filing
//! deadline next door for the same reasoning.

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};

use crate::course::domain::{
    CourseError, DefaultWorkingHours, ShiftHours, ShiftPolicy, ShiftRulesGateway, UnfiledRequest,
};

pub struct MySqlShiftRulesRepository {
    pool: MySqlPool,
}

impl MySqlShiftRulesRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }
}

fn provider(error: sqlx::Error) -> CourseError {
    CourseError::Provider(error.to_string())
}

#[async_trait]
impl ShiftRulesGateway for MySqlShiftRulesRepository {
    async fn get_shift_policy(&self, tenant_id: &str) -> Result<ShiftPolicy, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT avoided_rest_weekdays, max_consecutive_work_days, max_rounds_per_day,
                   min_rest_days_per_month, unfiled_request
            FROM golf_shift_rules
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        // A tenant that never opened the settings gets the weekend held back
        // and the statutory limits, which is what a golf club wants until it
        // says otherwise.
        let Some(row) = row else {
            return Ok(ShiftPolicy::default());
        };
        let weekdays: String = row.try_get("avoided_rest_weekdays").map_err(provider)?;
        let unfiled: String = row.try_get("unfiled_request").map_err(provider)?;
        let consecutive: i32 = row.try_get("max_consecutive_work_days").map_err(provider)?;
        let rounds: i32 = row.try_get("max_rounds_per_day").map_err(provider)?;
        let min_rest: i32 = row.try_get("min_rest_days_per_month").map_err(provider)?;
        Ok(ShiftPolicy::parse_csv(&weekdays)
            .with_max_consecutive_work_days(i64::from(consecutive))
            .with_max_rounds_per_day(rounds)
            .with_min_rest_days_per_month(i64::from(min_rest))
            .with_unfiled_request(UnfiledRequest::parse(&unfiled)))
    }

    async fn upsert_shift_policy(
        &self,
        tenant_id: &str,
        policy: &ShiftPolicy,
    ) -> Result<ShiftPolicy, CourseError> {
        sqlx::query(
            r#"
            INSERT INTO golf_shift_rules
                (tenant_id, avoided_rest_weekdays, max_consecutive_work_days, max_rounds_per_day,
                 min_rest_days_per_month, unfiled_request)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                avoided_rest_weekdays = VALUES(avoided_rest_weekdays),
                max_consecutive_work_days = VALUES(max_consecutive_work_days),
                max_rounds_per_day = VALUES(max_rounds_per_day),
                min_rest_days_per_month = VALUES(min_rest_days_per_month),
                unfiled_request = VALUES(unfiled_request),
                updated_at = CURRENT_TIMESTAMP(6)
            "#,
        )
        .bind(tenant_id)
        .bind(policy.as_csv())
        .bind(policy.max_consecutive_work_days() as i32)
        .bind(policy.max_rounds_per_day())
        .bind(policy.min_rest_days_per_month() as i32)
        .bind(policy.unfiled_request().as_str())
        .execute(&self.pool)
        .await
        .map_err(provider)?;
        Ok(policy.clone())
    }

    async fn get_default_working_hours(
        &self,
        tenant_id: &str,
    ) -> Result<DefaultWorkingHours, CourseError> {
        let row = sqlx::query(
            r#"
            SELECT default_work_start_minutes, default_work_end_minutes, default_midday_minutes
            FROM golf_shift_rules
            WHERE tenant_id = ?
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(provider)?;

        let Some(row) = row else {
            return Ok(DefaultWorkingHours::club_default());
        };
        let start: u16 = row
            .try_get("default_work_start_minutes")
            .map_err(provider)?;
        let end: u16 = row.try_get("default_work_end_minutes").map_err(provider)?;
        let midday: u16 = row.try_get("default_midday_minutes").map_err(provider)?;

        // The CHECK constraint keeps these in order, so a row that fails to
        // describe a day has been edited around it — by hand, or on a replica
        // that never got the constraint. Falling back beats refusing: the
        // club's own default is the same answer a tenant with no row gets,
        // whereas an error here stops a month from reaching Field at all.
        let stored = ShiftHours::try_new(start, end)
            .and_then(|day| DefaultWorkingHours::try_new(day, midday));
        match stored {
            Ok(hours) => Ok(hours),
            Err(error) => {
                tracing::warn!(
                    tenant_id,
                    start,
                    end,
                    midday,
                    %error,
                    "stored working hours do not describe a day; using the club default"
                );
                Ok(DefaultWorkingHours::club_default())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, test_tenant};
    use chrono::Weekday;

    #[tokio::test]
    async fn a_tenant_that_never_set_a_rule_keeps_the_weekend_clear() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);

        let policy = repository
            .get_shift_policy(&test_tenant("rules-unset"))
            .await
            .unwrap();

        assert_eq!(policy.weekdays(), [Weekday::Sat, Weekday::Sun]);
    }

    #[tokio::test]
    async fn a_club_that_only_protects_saturday_reads_back_that_way() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("rules-saturday");
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::new([Weekday::Sat]))
            .await
            .unwrap();

        let policy = repository.get_shift_policy(&tenant).await.unwrap();

        assert_eq!(policy.weekdays(), [Weekday::Sat]);
    }

    #[tokio::test]
    async fn protecting_nothing_is_stored_rather_than_falling_back_to_the_default() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("rules-none");
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::unrestricted())
            .await
            .unwrap();

        let policy = repository.get_shift_policy(&tenant).await.unwrap();

        assert!(policy.weekdays().is_empty());
    }

    #[tokio::test]
    async fn setting_the_rule_again_replaces_it() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("rules-replace");
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::new([Weekday::Sat, Weekday::Sun]))
            .await
            .unwrap();
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::new([Weekday::Mon]))
            .await
            .unwrap();

        let policy = repository.get_shift_policy(&tenant).await.unwrap();

        assert_eq!(policy.weekdays(), [Weekday::Mon]);
    }

    #[tokio::test]
    async fn every_limit_survives_the_round_trip() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("rules-limits");
        repository
            .upsert_shift_policy(
                &tenant,
                &ShiftPolicy::new([Weekday::Sat])
                    .with_max_consecutive_work_days(5)
                    .with_max_rounds_per_day(1)
                    .with_min_rest_days_per_month(8)
                    .with_unfiled_request(UnfiledRequest::Off),
            )
            .await
            .unwrap();

        let policy = repository.get_shift_policy(&tenant).await.unwrap();

        assert_eq!(policy.max_consecutive_work_days(), 5);
        assert_eq!(policy.max_rounds_per_day(), 1);
        assert_eq!(policy.min_rest_days_per_month(), 8);
        assert_eq!(policy.unfiled_request(), UnfiledRequest::Off);
        assert_eq!(policy.weekdays(), [Weekday::Sat]);
    }

    #[tokio::test]
    async fn a_tenant_from_before_the_limits_existed_reads_the_statutory_ones() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("rules-defaults");
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::default())
            .await
            .unwrap();

        let policy = repository.get_shift_policy(&tenant).await.unwrap();

        assert_eq!(policy.max_consecutive_work_days(), 6);
        assert_eq!(policy.max_rounds_per_day(), 2);
        assert_eq!(policy.min_rest_days_per_month(), 0);
        assert_eq!(policy.unfiled_request(), UnfiledRequest::Working);
    }

    #[tokio::test]
    async fn one_tenants_rule_is_invisible_to_another() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        repository
            .upsert_shift_policy(
                &test_tenant("rules-isolation-a"),
                &ShiftPolicy::new([Weekday::Wed]),
            )
            .await
            .unwrap();

        let policy = repository
            .get_shift_policy(&test_tenant("rules-isolation-b"))
            .await
            .unwrap();

        assert_eq!(policy.weekdays(), [Weekday::Sat, Weekday::Sun]);
    }
    #[tokio::test]
    async fn a_tenant_that_never_set_hours_works_the_club_default_day() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);

        let hours = repository
            .get_default_working_hours(&test_tenant("hours-unset"))
            .await
            .unwrap();

        assert_eq!(hours, DefaultWorkingHours::club_default());
        assert_eq!(hours.full_day().start(), "07:00");
        assert_eq!(hours.full_day().end(), "17:00");
        assert_eq!(hours.midday_minutes(), 12 * 60);
    }

    #[tokio::test]
    async fn a_tenant_with_rules_but_no_hours_of_its_own_reads_the_same_day() {
        // The columns default to the club default, so inserting a policy row
        // must not change what hours the tenant works.
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("hours-policy-only");
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::new([Weekday::Sat]))
            .await
            .unwrap();

        let hours = repository.get_default_working_hours(&tenant).await.unwrap();

        assert_eq!(hours, DefaultWorkingHours::club_default());
    }

    #[tokio::test]
    async fn a_club_that_starts_at_six_is_filed_as_starting_at_six() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let tenant = test_tenant("hours-early");
        repository
            .upsert_shift_policy(&tenant, &ShiftPolicy::default())
            .await
            .unwrap();
        sqlx::query(
            r#"
            UPDATE golf_shift_rules
            SET default_work_start_minutes = ?, default_work_end_minutes = ?,
                default_midday_minutes = ?
            WHERE tenant_id = ?
            "#,
        )
        .bind(6 * 60)
        .bind(16 * 60)
        .bind(11 * 60 + 30)
        .bind(&tenant)
        .execute(&repository.pool)
        .await
        .unwrap();

        let hours = repository.get_default_working_hours(&tenant).await.unwrap();

        assert_eq!(hours.full_day().start(), "06:00");
        assert_eq!(hours.full_day().end(), "16:00");
        assert_eq!(hours.midday_minutes(), 11 * 60 + 30);
    }

    #[tokio::test]
    async fn one_tenants_hours_are_invisible_to_another() {
        let repository = MySqlShiftRulesRepository::new(test_pool().await);
        let mine = test_tenant("hours-isolation-a");
        repository
            .upsert_shift_policy(&mine, &ShiftPolicy::default())
            .await
            .unwrap();
        sqlx::query(
            "UPDATE golf_shift_rules SET default_work_start_minutes = ? WHERE tenant_id = ?",
        )
        .bind(5 * 60)
        .bind(&mine)
        .execute(&repository.pool)
        .await
        .unwrap();

        let hours = repository
            .get_default_working_hours(&test_tenant("hours-isolation-b"))
            .await
            .unwrap();

        assert_eq!(hours, DefaultWorkingHours::club_default());
    }
}
