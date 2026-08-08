//! Field write-through gateway for commercial golf operations.

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use super::field_gateway::{
    field_get_items, field_send_json, field_send_raw, field_send_text, field_send_unit,
    normalize_base_url,
};
use crate::course::domain::{
    BudgetAchievement, CourseError, DailyBudget, DailyBudgetQuery, ExtensionStatus,
    GatewayCredentials, GolfCommercialGateway, MonthlySettlement, ReservationId, ReservationPolicy,
    SettlementPeriod, UnpaidCancellationItem, UpdateExtensionConfig, UpdateReservationPolicy,
    UpsertDailyBudget,
};

const GOLF: &str = "/v1/erp/extensions/golf-course";
const GOLF_CONFIG: &str = "/v1/erp/extensions/golf_course/config";
const EXTENSIONS_STATUS: &str = "/v1/erp/extensions/status";
const GOLF_EXTENSION_KEY: &str = "golf_course";

/// Budgets / settlement / policy / extension config via Field golf-course APIs.
pub struct FieldGolfCommercialGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldGolfCommercialGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl GolfCommercialGateway for FieldGolfCommercialGateway {
    async fn get_reservation_policy(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<ReservationPolicy, CourseError> {
        let dto: FieldPolicyDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &format!("{GOLF}/reservation-policy"),
            credentials,
            None,
        )
        .await?;
        Ok(map_policy(dto))
    }

    async fn update_reservation_policy(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateReservationPolicy,
    ) -> Result<ReservationPolicy, CourseError> {
        input.validate()?;
        let body = json!({
            "reservationTypeId": input.reservation_type_id,
            "defaultHoles": input.default_holes,
            "maxPlayersPerTeeTime": input.max_players_per_tee_time,
            "cartPolicy": input.cart_policy,
            "memberDepositBps": input.member_deposit_bps,
            "guestDepositBps": input.guest_deposit_bps,
            "cutoffHours": input.cutoff_hours,
            "policyHooksJson": input.policy_hooks_json,
            "metadataJson": input.metadata_json,
        });
        let dto: FieldPolicyDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &format!("{GOLF}/reservation-policy"),
            credentials,
            Some(&body),
        )
        .await?;
        Ok(map_policy(dto))
    }

    async fn list_daily_budgets(
        &self,
        credentials: GatewayCredentials<'_>,
        query: DailyBudgetQuery,
    ) -> Result<Vec<DailyBudget>, CourseError> {
        let mut params = Vec::new();
        if let Some(course_id) = query.golf_course_id.as_deref() {
            params.push(format!("golfCourseId={}", urlencoding_query(course_id)));
        }
        if let Some(from) = query.from {
            params.push(format!("from={from}"));
        }
        if let Some(to) = query.to {
            params.push(format!("to={to}"));
        }
        let path = if params.is_empty() {
            format!("{GOLF}/daily-budgets")
        } else {
            format!("{GOLF}/daily-budgets?{}", params.join("&"))
        };
        let items: Vec<FieldBudgetDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        items.into_iter().map(map_budget).collect()
    }

    async fn upsert_daily_budget(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertDailyBudget,
    ) -> Result<DailyBudget, CourseError> {
        let body = json!({
            "golfCourseId": input.golf_course_id,
            "date": input.date,
            "targetRevenue": input.target_revenue,
            "targetAverageSpend": input.target_average_spend,
            "targetCaddyAttachedRatio": input.target_caddy_attached_ratio,
        });
        let dto: FieldBudgetDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!("{GOLF}/daily-budgets"),
            credentials,
            Some(&body),
        )
        .await?;
        map_budget(dto)
    }

    async fn import_daily_budgets_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        csv: &str,
    ) -> Result<Vec<DailyBudget>, CourseError> {
        let value = field_send_raw(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!("{GOLF}/daily-budgets/import"),
            credentials,
            "text/csv",
            csv.as_bytes(),
        )
        .await?;
        let items: FieldItems<FieldBudgetDto> = serde_json::from_value(value).map_err(|error| {
            CourseError::Provider(format!(
                "Field API decode failed for POST {GOLF}/daily-budgets/import: {error}"
            ))
        })?;
        items.items.into_iter().map(map_budget).collect()
    }

    async fn list_budget_achievements(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<BudgetAchievement>, CourseError> {
        let path = format!("{GOLF}/daily-budgets/achievement?from={from}&to={to}");
        let items: Vec<FieldAchievementDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items.into_iter().map(map_achievement).collect())
    }

    async fn get_monthly_settlement(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<MonthlySettlement, CourseError> {
        let path = format!(
            "{GOLF}/monthly-settlement?yearMonth={}",
            urlencoding_query(year_month)
        );
        let dto: FieldSettlementDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(map_settlement(dto))
    }

    async fn export_monthly_settlement_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        let path = format!(
            "{GOLF}/monthly-settlement/export.csv?yearMonth={}",
            urlencoding_query(year_month)
        );
        field_send_text(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await
    }

    async fn get_extension_status(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<ExtensionStatus>, CourseError> {
        let items: Vec<FieldExtensionStatusDto> =
            field_get_items(&self.client, &self.base_url, EXTENSIONS_STATUS, credentials).await?;
        Ok(items
            .into_iter()
            .find(|item| item.extension_key == GOLF_EXTENSION_KEY)
            .map(map_extension_status))
    }

    async fn update_extension_config(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateExtensionConfig,
    ) -> Result<(), CourseError> {
        let body = json!({
            "scopeType": input.scope_type,
            "configJson": input.config_json,
        });
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            GOLF_CONFIG,
            credentials,
            Some(&body),
        )
        .await
    }
}

fn urlencoding_query(value: impl AsRef<str>) -> String {
    let value = value.as_ref();
    value
        .chars()
        .map(|ch| match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => ch.to_string(),
            _ => format!("%{:02X}", ch as u8),
        })
        .collect()
}

fn map_policy(value: FieldPolicyDto) -> ReservationPolicy {
    ReservationPolicy::reconstitute(
        value.tenant_id.unwrap_or_default(),
        value.reservation_type_id.unwrap_or_default(),
        value.default_holes.unwrap_or(18),
        value.max_players_per_tee_time.unwrap_or(4),
        value.cart_policy.unwrap_or_else(|| "optional".into()),
        value.member_deposit_bps.unwrap_or(2000),
        value.guest_deposit_bps.unwrap_or(3000),
        value.cutoff_hours.unwrap_or(24),
        value.policy_hooks_json,
        value.metadata_json,
    )
}

fn map_budget(value: FieldBudgetDto) -> Result<DailyBudget, CourseError> {
    DailyBudget::reconstitute(
        value.id,
        value.golf_course_id,
        value.date,
        value.target_revenue,
        value.target_average_spend,
        value.target_caddy_attached_ratio,
        value.updated_at,
    )
}

fn map_achievement(value: FieldAchievementDto) -> BudgetAchievement {
    BudgetAchievement::reconstitute(
        value.date,
        value.target_revenue,
        value.actual_revenue,
        value.revenue_achievement_rate,
        value.target_average_spend,
        value.actual_average_spend,
        value.target_caddy_attached_ratio,
        value.actual_caddy_attached_ratio,
        value.reservation_count,
        value.player_count,
    )
}

fn map_settlement(value: FieldSettlementDto) -> MonthlySettlement {
    let unpaid = value
        .drilldown
        .unpaid_cancellation_items
        .into_iter()
        .map(|item| {
            UnpaidCancellationItem::reconstitute(
                item.reservation_id,
                item.reservation_number,
                item.cancellation_fee_amount,
                item.checkout_url,
                item.link_issued,
                item.payment_status,
                item.invoice_id,
            )
        })
        .collect();
    MonthlySettlement::reconstitute(
        SettlementPeriod::new(
            value.period.year_month,
            value.period.start_date,
            value.period.end_date,
        ),
        value.reservations.gross_amount,
        value.reservations.collected_amount,
        value.reservations.refunded_amount,
        value.reservations.payment_pending_amount,
        value.reservations.reservation_count,
        value.caddie_fees.total,
        value.caddie_fees.assignment_count,
        value.caddie_fees.currency,
        value.cancellations.fee_outstanding_amount,
        value.cancellations.count,
        value.square.payments_total,
        value.square.refunds_total,
        value.square.unreconciled_lines,
        value.square.warning,
        value
            .drilldown
            .reservation_ids
            .into_iter()
            .map(ReservationId::new)
            .collect(),
        value
            .drilldown
            .unpaid_cancellation_reservation_ids
            .into_iter()
            .map(ReservationId::new)
            .collect(),
        unpaid,
    )
}

fn map_extension_status(value: FieldExtensionStatusDto) -> ExtensionStatus {
    let validation = value.validation.unwrap_or_default();
    ExtensionStatus::reconstitute(
        value.extension_key,
        value.name,
        value.version,
        value.registry_status,
        value.tenant_status,
        value.config_version,
        value.config_json,
        validation.valid.unwrap_or(true),
        validation.errors.unwrap_or_default(),
        value.updated_at,
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldItems<T> {
    items: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldPolicyDto {
    #[serde(default)]
    tenant_id: Option<String>,
    #[serde(default)]
    reservation_type_id: Option<String>,
    #[serde(default)]
    default_holes: Option<i32>,
    #[serde(default)]
    max_players_per_tee_time: Option<i32>,
    #[serde(default)]
    cart_policy: Option<String>,
    #[serde(default)]
    member_deposit_bps: Option<i32>,
    #[serde(default)]
    guest_deposit_bps: Option<i32>,
    #[serde(default)]
    cutoff_hours: Option<i32>,
    #[serde(default)]
    policy_hooks_json: Option<Value>,
    #[serde(default)]
    metadata_json: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldBudgetDto {
    id: String,
    golf_course_id: String,
    date: NaiveDate,
    target_revenue: i64,
    target_average_spend: i64,
    target_caddy_attached_ratio: f64,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAchievementDto {
    date: NaiveDate,
    target_revenue: i64,
    actual_revenue: i64,
    #[serde(default)]
    revenue_achievement_rate: Option<f64>,
    target_average_spend: i64,
    #[serde(default)]
    actual_average_spend: Option<i64>,
    target_caddy_attached_ratio: f64,
    #[serde(default)]
    actual_caddy_attached_ratio: Option<f64>,
    reservation_count: i64,
    player_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementDto {
    period: FieldSettlementPeriodDto,
    reservations: FieldSettlementReservationsDto,
    caddie_fees: FieldSettlementCaddieFeesDto,
    cancellations: FieldSettlementCancellationsDto,
    square: FieldSettlementSquareDto,
    drilldown: FieldSettlementDrilldownDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementPeriodDto {
    year_month: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementReservationsDto {
    gross_amount: i64,
    collected_amount: i64,
    refunded_amount: i64,
    payment_pending_amount: i64,
    reservation_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementCaddieFeesDto {
    total: i64,
    assignment_count: i64,
    currency: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementCancellationsDto {
    fee_outstanding_amount: i64,
    count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementSquareDto {
    payments_total: i64,
    refunds_total: i64,
    unreconciled_lines: i64,
    #[serde(default)]
    warning: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSettlementDrilldownDto {
    #[serde(default)]
    reservation_ids: Vec<String>,
    #[serde(default)]
    unpaid_cancellation_reservation_ids: Vec<String>,
    #[serde(default)]
    unpaid_cancellation_items: Vec<FieldUnpaidCancellationDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldUnpaidCancellationDto {
    reservation_id: String,
    reservation_number: String,
    cancellation_fee_amount: i64,
    #[serde(default)]
    checkout_url: Option<String>,
    link_issued: bool,
    payment_status: String,
    #[serde(default)]
    invoice_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldExtensionStatusDto {
    extension_key: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    registry_status: Option<String>,
    #[serde(default)]
    tenant_status: Option<String>,
    #[serde(default)]
    config_version: Option<i64>,
    #[serde(default)]
    config_json: Option<Value>,
    #[serde(default)]
    validation: Option<FieldValidationDto>,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldValidationDto {
    #[serde(default)]
    valid: Option<bool>,
    #[serde(default)]
    errors: Option<Vec<String>>,
}
