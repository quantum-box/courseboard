//! Commercial golf operations: reservation policy, daily budgets,
//! monthly settlement, and tenant extension config/status.

use chrono::{DateTime, NaiveDate, Utc};
use derive_getters::Getters;
use serde_json::Value;

use super::{BudgetId, CourseError, CourseId, ReservationId, TenantId};

/// Tenant reservation policy for golf play.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct ReservationPolicy {
    #[getter(skip)]
    tenant_id: TenantId,
    #[getter(skip)]
    reservation_type_id: String,
    default_holes: i32,
    max_players_per_tee_time: i32,
    #[getter(skip)]
    cart_policy: String,
    member_deposit_bps: i32,
    guest_deposit_bps: i32,
    cutoff_hours: i32,
    #[getter(skip)]
    policy_hooks_json: Option<Value>,
    #[getter(skip)]
    metadata_json: Option<Value>,
}

impl ReservationPolicy {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        tenant_id: impl Into<TenantId>,
        reservation_type_id: impl Into<String>,
        default_holes: i32,
        max_players_per_tee_time: i32,
        cart_policy: impl Into<String>,
        member_deposit_bps: i32,
        guest_deposit_bps: i32,
        cutoff_hours: i32,
        policy_hooks_json: Option<Value>,
        metadata_json: Option<Value>,
    ) -> Self {
        Self {
            tenant_id: tenant_id.into(),
            reservation_type_id: reservation_type_id.into(),
            default_holes: default_holes.max(1),
            max_players_per_tee_time: max_players_per_tee_time.max(1),
            cart_policy: cart_policy.into(),
            member_deposit_bps: member_deposit_bps.clamp(0, 10_000),
            guest_deposit_bps: guest_deposit_bps.clamp(0, 10_000),
            cutoff_hours: cutoff_hours.max(0),
            policy_hooks_json,
            metadata_json,
        }
    }

    pub fn tenant_id(&self) -> &TenantId {
        &self.tenant_id
    }

    pub fn reservation_type_id(&self) -> &str {
        &self.reservation_type_id
    }

    pub fn cart_policy(&self) -> &str {
        &self.cart_policy
    }

    pub fn policy_hooks_json(&self) -> Option<&Value> {
        self.policy_hooks_json.as_ref()
    }

    pub fn metadata_json(&self) -> Option<&Value> {
        self.metadata_json.as_ref()
    }

    pub fn member_deposit_percent(&self) -> f64 {
        f64::from(self.member_deposit_bps) / 100.0
    }

    pub fn guest_deposit_percent(&self) -> f64 {
        f64::from(self.guest_deposit_bps) / 100.0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateReservationPolicy {
    pub reservation_type_id: Option<String>,
    pub default_holes: Option<i32>,
    pub max_players_per_tee_time: Option<i32>,
    pub cart_policy: Option<String>,
    pub member_deposit_bps: Option<i32>,
    pub guest_deposit_bps: Option<i32>,
    pub cutoff_hours: Option<i32>,
    pub policy_hooks_json: Option<Value>,
    pub metadata_json: Option<Value>,
}

impl UpdateReservationPolicy {
    pub fn validate(&self) -> Result<(), CourseError> {
        if let Some(holes) = self.default_holes {
            if holes < 1 {
                return Err(CourseError::BadRequest("default holes must be >= 1"));
            }
        }
        if let Some(players) = self.max_players_per_tee_time {
            if players < 1 {
                return Err(CourseError::BadRequest("max players must be >= 1"));
            }
        }
        if let Some(bps) = self.member_deposit_bps {
            if !(0..=10_000).contains(&bps) {
                return Err(CourseError::BadRequest(
                    "member deposit bps must be 0-10000",
                ));
            }
        }
        if let Some(bps) = self.guest_deposit_bps {
            if !(0..=10_000).contains(&bps) {
                return Err(CourseError::BadRequest("guest deposit bps must be 0-10000"));
            }
        }
        if let Some(hours) = self.cutoff_hours {
            if hours < 0 {
                return Err(CourseError::BadRequest("cutoff hours must be >= 0"));
            }
        }
        Ok(())
    }
}

/// Daily revenue / mix budget for a course.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct DailyBudget {
    #[getter(skip)]
    id: BudgetId,
    #[getter(skip)]
    golf_course_id: CourseId,
    #[getter(copy)]
    date: NaiveDate,
    target_revenue: i64,
    target_average_spend: i64,
    target_caddy_attached_ratio: f64,
    #[getter(copy)]
    updated_at: Option<DateTime<Utc>>,
}

impl DailyBudget {
    pub fn id(&self) -> &BudgetId {
        &self.id
    }

    pub fn golf_course_id(&self) -> &CourseId {
        &self.golf_course_id
    }

    pub fn reconstitute(
        id: impl Into<BudgetId>,
        golf_course_id: impl Into<CourseId>,
        date: NaiveDate,
        target_revenue: i64,
        target_average_spend: i64,
        target_caddy_attached_ratio: f64,
        updated_at: Option<DateTime<Utc>>,
    ) -> Result<Self, CourseError> {
        if !(0.0..=1.0).contains(&target_caddy_attached_ratio) {
            return Err(CourseError::BadRequest(
                "caddy attached ratio must be 0.0-1.0",
            ));
        }
        Ok(Self {
            id: id.into(),
            golf_course_id: golf_course_id.into(),
            date,
            target_revenue: target_revenue.max(0),
            target_average_spend: target_average_spend.max(0),
            target_caddy_attached_ratio,
            updated_at,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpsertDailyBudget {
    pub golf_course_id: CourseId,
    pub date: NaiveDate,
    pub target_revenue: i64,
    pub target_average_spend: i64,
    pub target_caddy_attached_ratio: f64,
}

impl UpsertDailyBudget {
    pub fn try_new(
        golf_course_id: impl Into<String>,
        date: NaiveDate,
        target_revenue: i64,
        target_average_spend: i64,
        target_caddy_attached_ratio: f64,
    ) -> Result<Self, CourseError> {
        if target_revenue < 0 || target_average_spend < 0 {
            return Err(CourseError::BadRequest("budget amounts must be >= 0"));
        }
        if !(0.0..=1.0).contains(&target_caddy_attached_ratio) {
            return Err(CourseError::BadRequest(
                "caddy attached ratio must be 0.0-1.0",
            ));
        }
        Ok(Self {
            golf_course_id: CourseId::try_new(golf_course_id)?,
            date,
            target_revenue,
            target_average_spend,
            target_caddy_attached_ratio,
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DailyBudgetQuery {
    pub golf_course_id: Option<CourseId>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq, Getters)]
pub struct BudgetAchievement {
    #[getter(copy)]
    date: NaiveDate,
    target_revenue: i64,
    actual_revenue: i64,
    #[getter(copy)]
    revenue_achievement_rate: Option<f64>,
    target_average_spend: i64,
    #[getter(copy)]
    actual_average_spend: Option<i64>,
    target_caddy_attached_ratio: f64,
    #[getter(copy)]
    actual_caddy_attached_ratio: Option<f64>,
    reservation_count: i64,
    player_count: i64,
}

impl BudgetAchievement {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        date: NaiveDate,
        target_revenue: i64,
        actual_revenue: i64,
        revenue_achievement_rate: Option<f64>,
        target_average_spend: i64,
        actual_average_spend: Option<i64>,
        target_caddy_attached_ratio: f64,
        actual_caddy_attached_ratio: Option<f64>,
        reservation_count: i64,
        player_count: i64,
    ) -> Self {
        Self {
            date,
            target_revenue,
            actual_revenue,
            revenue_achievement_rate,
            target_average_spend,
            actual_average_spend,
            target_caddy_attached_ratio,
            actual_caddy_attached_ratio,
            reservation_count,
            player_count,
        }
    }

    pub fn met_revenue_target(&self) -> bool {
        self.revenue_achievement_rate
            .map(|rate| rate >= 1.0)
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct SettlementPeriod {
    #[getter(skip)]
    year_month: String,
    #[getter(copy)]
    start_date: NaiveDate,
    #[getter(copy)]
    end_date: NaiveDate,
}

impl SettlementPeriod {
    pub fn year_month(&self) -> &str {
        &self.year_month
    }

    pub fn new(year_month: impl Into<String>, start_date: NaiveDate, end_date: NaiveDate) -> Self {
        Self {
            year_month: year_month.into(),
            start_date,
            end_date,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct UnpaidCancellationItem {
    #[getter(skip)]
    reservation_id: ReservationId,
    #[getter(skip)]
    reservation_number: String,
    cancellation_fee_amount: i64,
    #[getter(skip)]
    checkout_url: Option<String>,
    link_issued: bool,
    #[getter(skip)]
    payment_status: String,
    #[getter(skip)]
    invoice_id: Option<String>,
}

impl UnpaidCancellationItem {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        reservation_id: impl Into<ReservationId>,
        reservation_number: impl Into<String>,
        cancellation_fee_amount: i64,
        checkout_url: Option<String>,
        link_issued: bool,
        payment_status: impl Into<String>,
        invoice_id: Option<String>,
    ) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            reservation_number: reservation_number.into(),
            cancellation_fee_amount: cancellation_fee_amount.max(0),
            checkout_url,
            link_issued,
            payment_status: payment_status.into(),
            invoice_id,
        }
    }

    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }

    pub fn reservation_number(&self) -> &str {
        &self.reservation_number
    }

    pub fn checkout_url(&self) -> Option<&str> {
        self.checkout_url.as_deref()
    }

    pub fn payment_status(&self) -> &str {
        &self.payment_status
    }

    pub fn invoice_id(&self) -> Option<&str> {
        self.invoice_id.as_deref()
    }
}

/// Monthly settlement report for golf operations.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct MonthlySettlement {
    period: SettlementPeriod,
    reservations_gross_amount: i64,
    reservations_collected_amount: i64,
    reservations_refunded_amount: i64,
    reservations_payment_pending_amount: i64,
    reservation_count: i64,
    caddie_fees_total: i64,
    caddie_assignment_count: i64,
    #[getter(skip)]
    caddie_fees_currency: String,
    cancellations_fee_outstanding_amount: i64,
    cancellations_count: i64,
    square_payments_total: i64,
    square_refunds_total: i64,
    square_unreconciled_lines: i64,
    #[getter(skip)]
    square_warning: Option<String>,
    #[getter(skip)]
    reservation_ids: Vec<ReservationId>,
    #[getter(skip)]
    unpaid_cancellation_reservation_ids: Vec<ReservationId>,
    #[getter(skip)]
    unpaid_cancellation_items: Vec<UnpaidCancellationItem>,
}

impl MonthlySettlement {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        period: SettlementPeriod,
        reservations_gross_amount: i64,
        reservations_collected_amount: i64,
        reservations_refunded_amount: i64,
        reservations_payment_pending_amount: i64,
        reservation_count: i64,
        caddie_fees_total: i64,
        caddie_assignment_count: i64,
        caddie_fees_currency: impl Into<String>,
        cancellations_fee_outstanding_amount: i64,
        cancellations_count: i64,
        square_payments_total: i64,
        square_refunds_total: i64,
        square_unreconciled_lines: i64,
        square_warning: Option<String>,
        reservation_ids: Vec<ReservationId>,
        unpaid_cancellation_reservation_ids: Vec<ReservationId>,
        unpaid_cancellation_items: Vec<UnpaidCancellationItem>,
    ) -> Self {
        Self {
            period,
            reservations_gross_amount,
            reservations_collected_amount,
            reservations_refunded_amount,
            reservations_payment_pending_amount,
            reservation_count,
            caddie_fees_total,
            caddie_assignment_count,
            caddie_fees_currency: caddie_fees_currency.into(),
            cancellations_fee_outstanding_amount,
            cancellations_count,
            square_payments_total,
            square_refunds_total,
            square_unreconciled_lines,
            square_warning,
            reservation_ids,
            unpaid_cancellation_reservation_ids,
            unpaid_cancellation_items,
        }
    }

    pub fn caddie_fees_currency(&self) -> &str {
        &self.caddie_fees_currency
    }

    pub fn square_warning(&self) -> Option<&str> {
        self.square_warning.as_deref()
    }

    pub fn reservation_ids(&self) -> &[ReservationId] {
        &self.reservation_ids
    }

    pub fn unpaid_cancellation_reservation_ids(&self) -> &[ReservationId] {
        &self.unpaid_cancellation_reservation_ids
    }

    pub fn unpaid_cancellation_items(&self) -> &[UnpaidCancellationItem] {
        &self.unpaid_cancellation_items
    }

    pub fn has_outstanding_cancellations(&self) -> bool {
        self.cancellations_fee_outstanding_amount > 0
    }
}

/// Golf extension runtime status (single tenant-scoped row).
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct ExtensionStatus {
    #[getter(skip)]
    extension_key: String,
    #[getter(skip)]
    name: Option<String>,
    #[getter(skip)]
    version: Option<String>,
    #[getter(skip)]
    registry_status: Option<String>,
    #[getter(skip)]
    tenant_status: Option<String>,
    #[getter(copy)]
    config_version: Option<i64>,
    #[getter(skip)]
    config_json: Option<Value>,
    validation_valid: bool,
    #[getter(skip)]
    validation_errors: Vec<String>,
    #[getter(copy)]
    updated_at: Option<DateTime<Utc>>,
}

impl ExtensionStatus {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        extension_key: impl Into<String>,
        name: Option<String>,
        version: Option<String>,
        registry_status: Option<String>,
        tenant_status: Option<String>,
        config_version: Option<i64>,
        config_json: Option<Value>,
        validation_valid: bool,
        validation_errors: Vec<String>,
        updated_at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            extension_key: extension_key.into(),
            name,
            version,
            registry_status,
            tenant_status,
            config_version,
            config_json,
            validation_valid,
            validation_errors,
            updated_at,
        }
    }

    pub fn extension_key(&self) -> &str {
        &self.extension_key
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }

    pub fn registry_status(&self) -> Option<&str> {
        self.registry_status.as_deref()
    }

    pub fn tenant_status(&self) -> Option<&str> {
        self.tenant_status.as_deref()
    }

    pub fn config_json(&self) -> Option<&Value> {
        self.config_json.as_ref()
    }

    pub fn validation_errors(&self) -> &[String] {
        &self.validation_errors
    }

    pub fn is_enabled(&self) -> bool {
        self.tenant_status
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case("enabled"))
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateExtensionConfig {
    pub scope_type: String,
    pub config_json: Value,
}

impl UpdateExtensionConfig {
    pub fn try_new(scope_type: impl Into<String>, config_json: Value) -> Result<Self, CourseError> {
        let scope_type = scope_type.into().trim().to_string();
        if scope_type.is_empty() {
            return Err(CourseError::BadRequest("scope type is required"));
        }
        if !config_json.is_object() {
            return Err(CourseError::BadRequest("configJson must be an object"));
        }
        Ok(Self {
            scope_type,
            config_json,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use serde_json::json;

    #[test]
    fn reservation_policy_clamps_deposit_bps_and_exposes_percent() {
        let policy = ReservationPolicy::reconstitute(
            "tn_1", "golf", 18, 4, "optional", 12_000, -50, 24, None, None,
        );
        assert_eq!(policy.member_deposit_bps(), 10_000);
        assert_eq!(policy.guest_deposit_bps(), 0);
        assert_eq!(policy.member_deposit_percent(), 100.0);
        assert_eq!(policy.guest_deposit_percent(), 0.0);
    }

    #[test]
    fn daily_budget_rejects_ratio_outside_unit_interval() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 18).unwrap();
        assert!(UpsertDailyBudget::try_new("course_east", date, 1_000_000, 20_000, 1.2).is_err());
        assert!(DailyBudget::reconstitute(
            "budget_1",
            "course_east",
            date,
            1_000_000,
            20_000,
            -0.1,
            None,
        )
        .is_err());
        let ok = UpsertDailyBudget::try_new("course_east", date, 1_000_000, 20_000, 0.7).unwrap();
        assert_eq!(ok.target_caddy_attached_ratio, 0.7);
    }

    #[test]
    fn extension_config_requires_object_json() {
        assert!(UpdateExtensionConfig::try_new("tenant", json!([])).is_err());
        let ok = UpdateExtensionConfig::try_new(
            "tenant",
            json!({ "defaultCurrency": "JPY", "timezone": "Asia/Tokyo" }),
        )
        .unwrap();
        assert_eq!(ok.scope_type, "tenant");
    }
}
