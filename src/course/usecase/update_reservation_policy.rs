//! UpdateReservationPolicyUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, ReservationPolicy,
    UpdateReservationPolicy,
};

pub struct UpdateReservationPolicyUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl UpdateReservationPolicyUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    /// Partial update: fields the caller did not send keep their stored value.
    ///
    /// Field overwrites every column on this write, so the merge has to happen
    /// here rather than be trusted to each screen (see
    /// [`UpdateReservationPolicy::overlay_on`]).
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateReservationPolicy,
    ) -> Result<ReservationPolicy, CourseError> {
        credentials
            .require(actions::MANAGE_RESERVATION_POLICY)
            .await?;
        input.validate()?;
        let input = match self.commercial.get_reservation_policy(credentials).await? {
            Some(current) => input.overlay_on(&current),
            // No policy yet: this write creates it, and Field's defaults are
            // the right fill for whatever the caller left out.
            None => input,
        };
        self.commercial
            .update_reservation_policy(credentials, input)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::Mutex;

    use crate::course::domain::{
        BookingHorizon, DailyBudget, DailyBudgetQuery, ExtensionStatus, MonthlySettlement,
        UpdateExtensionConfig, UpsertDailyBudget,
    };

    /// Stores what was written, with Field's replace semantics on update.
    struct PolicyStore {
        current: Mutex<Option<ReservationPolicy>>,
        written: Mutex<Vec<UpdateReservationPolicy>>,
    }

    impl PolicyStore {
        fn with(policy: Option<ReservationPolicy>) -> Arc<Self> {
            Arc::new(Self {
                current: Mutex::new(policy),
                written: Mutex::new(Vec::new()),
            })
        }
    }

    #[async_trait]
    impl GolfCommercialGateway for PolicyStore {
        async fn get_reservation_policy(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Option<ReservationPolicy>, CourseError> {
            Ok(self.current.lock().unwrap().clone())
        }

        async fn update_reservation_policy(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: UpdateReservationPolicy,
        ) -> Result<ReservationPolicy, CourseError> {
            // What Field does: every missing field becomes its default.
            let stored = ReservationPolicy::reconstitute(
                "tenant-1",
                input.reservation_type_id.clone().unwrap_or_default(),
                input.default_holes.unwrap_or(18),
                input.max_players_per_tee_time.unwrap_or(4),
                input
                    .cart_policy
                    .clone()
                    .unwrap_or_else(|| "optional".into()),
                input.member_deposit_bps.unwrap_or(2000),
                input.guest_deposit_bps.unwrap_or(3000),
                input.cutoff_hours.unwrap_or(24),
                input.policy_hooks_json.clone(),
                input.metadata_json.clone(),
            );
            *self.current.lock().unwrap() = Some(stored.clone());
            self.written.lock().unwrap().push(input);
            Ok(stored)
        }

        async fn list_daily_budgets(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: DailyBudgetQuery,
        ) -> Result<Vec<DailyBudget>, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_daily_budget(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertDailyBudget,
        ) -> Result<DailyBudget, CourseError> {
            unimplemented!("not used")
        }

        async fn import_daily_budgets_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _csv: &str,
        ) -> Result<Vec<DailyBudget>, CourseError> {
            unimplemented!("not used")
        }

        async fn get_monthly_settlement(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
            _timezone: &str,
        ) -> Result<MonthlySettlement, CourseError> {
            unimplemented!("not used")
        }

        async fn export_monthly_settlement_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
            _timezone: &str,
        ) -> Result<String, CourseError> {
            unimplemented!("not used")
        }

        async fn get_extension_status(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Option<ExtensionStatus>, CourseError> {
            unimplemented!("not used")
        }

        async fn update_extension_config(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpdateExtensionConfig,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn get_booking_horizon(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<BookingHorizon, CourseError> {
            unimplemented!("not used")
        }

        async fn set_booking_horizon(
            &self,
            _credentials: GatewayCredentials<'_>,
            _horizon: &BookingHorizon,
        ) -> Result<BookingHorizon, CourseError> {
            unimplemented!("not used")
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    fn metadata_only(metadata: serde_json::Value) -> UpdateReservationPolicy {
        UpdateReservationPolicy {
            reservation_type_id: None,
            default_holes: None,
            max_players_per_tee_time: None,
            cart_policy: None,
            member_deposit_bps: None,
            guest_deposit_bps: None,
            cutoff_hours: None,
            policy_hooks_json: None,
            metadata_json: Some(metadata),
        }
    }

    #[tokio::test]
    async fn metadata_only_save_keeps_policy_hooks_and_booking_rules() {
        let hooks = json!({
            "selfLock": {
                "enabled": true,
                "windows": [{ "weekdays": ["sat", "sun"], "start": "07:00", "end": "09:00" }],
            },
            "spendJudgment": { "enabled": true, "minPerPlayer": 12000, "action": "warn" },
        });
        let store = PolicyStore::with(Some(ReservationPolicy::reconstitute(
            "tenant-1",
            "rt_golf",
            9,
            3,
            "required",
            1500,
            5000,
            48,
            Some(hooks.clone()),
            Some(json!({ "externalSystem": "old" })),
        )));
        let use_case = UpdateReservationPolicyUseCase::new(store.clone());

        let saved = use_case
            .execute(
                credentials(),
                metadata_only(json!({ "partnerFacilityCode": "SCC-SORA" })),
            )
            .await
            .expect("metadata save");

        assert_eq!(saved.policy_hooks_json(), Some(&hooks));
        assert_eq!(
            saved.metadata_json(),
            Some(&json!({ "partnerFacilityCode": "SCC-SORA" }))
        );
        assert_eq!(saved.reservation_type_id(), "rt_golf");
        assert_eq!(saved.default_holes(), 9);
        assert_eq!(saved.max_players_per_tee_time(), 3);
        assert_eq!(saved.cart_policy(), "required");
        assert_eq!(saved.member_deposit_bps(), 1500);
        assert_eq!(saved.guest_deposit_bps(), 5000);
        assert_eq!(saved.cutoff_hours(), 48);
    }

    #[tokio::test]
    async fn sent_fields_win_over_stored_ones() {
        let store = PolicyStore::with(Some(ReservationPolicy::reconstitute(
            "tenant-1",
            "rt_golf",
            18,
            4,
            "optional",
            2000,
            3000,
            24,
            Some(json!({ "selfLock": { "enabled": false } })),
            Some(json!({ "keep": true })),
        )));
        let use_case = UpdateReservationPolicyUseCase::new(store.clone());
        let mut input = metadata_only(json!({}));
        input.metadata_json = None;
        input.cutoff_hours = Some(72);
        input.policy_hooks_json = Some(json!({ "selfLock": { "enabled": true } }));

        let saved = use_case.execute(credentials(), input).await.expect("save");

        assert_eq!(saved.cutoff_hours(), 72);
        assert_eq!(
            saved.policy_hooks_json(),
            Some(&json!({ "selfLock": { "enabled": true } }))
        );
        assert_eq!(saved.metadata_json(), Some(&json!({ "keep": true })));
    }

    #[tokio::test]
    async fn first_save_without_a_stored_policy_sends_only_what_was_given() {
        let store = PolicyStore::with(None);
        let use_case = UpdateReservationPolicyUseCase::new(store.clone());

        use_case
            .execute(credentials(), metadata_only(json!({ "a": 1 })))
            .await
            .expect("create");

        let written = store.written.lock().unwrap();
        assert_eq!(written.as_slice(), &[metadata_only(json!({ "a": 1 }))]);
    }

    #[tokio::test]
    async fn invalid_input_is_rejected_without_writing() {
        let store = PolicyStore::with(None);
        let use_case = UpdateReservationPolicyUseCase::new(store.clone());
        let mut input = metadata_only(json!({}));
        input.default_holes = Some(0);

        let error = use_case.execute(credentials(), input).await.unwrap_err();

        assert!(matches!(error, CourseError::BadRequest(_)));
        assert!(store.written.lock().unwrap().is_empty());
    }
}
