//! Field write-through gateway for caddie operations.
//!
//! Gateway owns Field staff → CourseBoard Caddie translation (display_name from
//! HRM staff.name when linked; golf caddie-profile supplies golf-only fields).

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use super::field_gateway::{
    field_get_items, field_send_json, field_send_text, field_send_unit, map_caddie,
    map_caddie_assignment, normalize_base_url, urlencoding_path, FieldGolfCaddieAssignmentDto,
    FieldGolfCaddieProfileDto,
};
use crate::course::domain::{
    AttendanceSnapshot, AttendanceSnapshotReport, AutoAssignPlanItem, AutoAssignResult,
    AutoAssignSkippedItem, AvailabilityQuery, AvailabilityStatus, Caddie, CaddieAssignment,
    CaddieAvailability, CaddieCourseMembership, CaddieRating, CaddieRecommendation,
    CaddieSkillLevel, CaddieSupply, CourseError, GatewayCredentials, GolfOpsGateway, PayrollPeriod,
    PayrollRow, PayrollSummary, RecommendationQuery, ReplaceCaddieMemberships, UpsertCaddie,
    UpsertCaddieAssignment, UpsertCaddieAvailability,
};

const GOLF: &str = "/v1/erp/extensions/golf-course";

/// Loads / mutates caddie ops through Field golf-course extension endpoints.
pub struct FieldGolfOpsGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldGolfOpsGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }

    /// Batch-load HRM staff names for caddie display_name resolution.
    async fn load_staff_names_by_id(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<HashMap<String, String>, CourseError> {
        let items: Vec<FieldStaffMemberDto> =
            field_get_items(&self.client, &self.base_url, "/v1/erp/staff", credentials).await?;
        Ok(items
            .into_iter()
            .filter_map(|item| {
                let name = item.name.trim().to_string();
                if name.is_empty() {
                    None
                } else {
                    Some((item.id, name))
                }
            })
            .collect())
    }

    fn map_profiles(
        items: Vec<FieldGolfCaddieProfileDto>,
        staff_names_by_id: &HashMap<String, String>,
    ) -> Vec<Caddie> {
        items
            .into_iter()
            .map(|dto| map_caddie(dto, staff_names_by_id))
            .collect()
    }
}

#[async_trait]
impl GolfOpsGateway for FieldGolfOpsGateway {
    async fn list_caddies(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<Caddie>, CourseError> {
        let items: Vec<FieldGolfCaddieProfileDto> = field_get_items(
            &self.client,
            &self.base_url,
            &format!("{GOLF}/caddie-profiles"),
            credentials,
        )
        .await?;
        let staff_names = self.load_staff_names_by_id(credentials).await?;
        Ok(Self::map_profiles(items, &staff_names))
    }

    async fn create_caddie(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        let body = upsert_caddie_body(&input);
        let dto: FieldGolfCaddieProfileDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!("{GOLF}/caddie-profiles"),
            credentials,
            Some(&body),
        )
        .await?;
        let staff_names = self.load_staff_names_by_id(credentials).await?;
        Ok(map_caddie(dto, &staff_names))
    }

    async fn update_caddie(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
        input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        let body = upsert_caddie_body(&input);
        let path = format!("{GOLF}/caddie-profiles/{}", urlencoding_path(caddie_id));
        let dto: FieldGolfCaddieProfileDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        let staff_names = self.load_staff_names_by_id(credentials).await?;
        Ok(map_caddie(dto, &staff_names))
    }

    async fn list_caddie_assignments(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<CaddieAssignment>, CourseError> {
        let items: Vec<FieldGolfCaddieAssignmentDto> = field_get_items(
            &self.client,
            &self.base_url,
            &format!("{GOLF}/caddie-assignments"),
            credentials,
        )
        .await?;
        items.into_iter().map(map_caddie_assignment).collect()
    }

    async fn update_caddie_assignment(
        &self,
        credentials: GatewayCredentials<'_>,
        assignment_id: &str,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError> {
        let body = json!({
            "caddieProfileId": input.caddie_id,
            "reservationId": input.reservation_id,
            "roundReference": input.round_reference,
            "scheduledAt": input.scheduled_at,
            "status": input.status,
            "assignmentRole": input.assignment_role,
            "feeAmount": input.fee_amount,
            "feeCurrency": input.fee_currency,
            "recommendationScore": input.recommendation_score,
            "notes": input.notes,
        });
        let path = format!(
            "{GOLF}/caddie-assignments/{}",
            urlencoding_path(assignment_id)
        );
        let dto: FieldGolfCaddieAssignmentDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        map_caddie_assignment(dto)
    }

    async fn list_caddie_memberships(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
        let path = format!(
            "{GOLF}/caddie-profiles/{}/courses",
            urlencoding_path(caddie_id)
        );
        let items: Vec<FieldMembershipDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items.into_iter().map(map_membership).collect())
    }

    async fn replace_caddie_memberships(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
        input: ReplaceCaddieMemberships,
    ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
        let body = json!({
            "courseIds": input.course_ids,
            "primaryCourseId": input.primary_course_id,
        });
        let path = format!(
            "{GOLF}/caddie-profiles/{}/courses",
            urlencoding_path(caddie_id)
        );
        let items: FieldItems<FieldMembershipDto> = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PUT,
            &path,
            credentials,
            Some(&body),
        )
        .await?;
        Ok(items.items.into_iter().map(map_membership).collect())
    }

    async fn list_caddie_availabilities(
        &self,
        credentials: GatewayCredentials<'_>,
        query: AvailabilityQuery,
    ) -> Result<Vec<CaddieAvailability>, CourseError> {
        let mut params = Vec::new();
        if let Some(caddie_id) = query.caddie_id.as_deref() {
            params.push(format!("caddieProfileId={}", urlencoding_query(caddie_id)));
        }
        if let Some(from) = query.from {
            params.push(format!("from={from}"));
        }
        if let Some(to) = query.to {
            params.push(format!("to={to}"));
        }
        if let Some(date) = query.date {
            params.push(format!("date={date}"));
        }
        let path = if params.is_empty() {
            format!("{GOLF}/caddie-availabilities")
        } else {
            format!("{GOLF}/caddie-availabilities?{}", params.join("&"))
        };
        let items: Vec<FieldAvailabilityDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items.into_iter().map(map_availability).collect())
    }

    async fn upsert_caddie_availability(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddieAvailability,
    ) -> Result<CaddieAvailability, CourseError> {
        let body = json!({
            "caddieProfileId": input.caddie_id,
            "date": input.date,
            "status": input.status.as_str(),
            "twoRoundRequest": input.two_round_request,
            "healthNote": input.health_note,
        });
        let dto: FieldAvailabilityDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!("{GOLF}/caddie-availabilities"),
            credentials,
            Some(&body),
        )
        .await?;
        Ok(map_availability(dto))
    }

    async fn delete_caddie_availability(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &str,
        date: NaiveDate,
    ) -> Result<(), CourseError> {
        let path = format!(
            "{GOLF}/caddie-availabilities/{}/{}",
            urlencoding_path(caddie_id),
            date
        );
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::DELETE,
            &path,
            credentials,
            None,
        )
        .await
    }

    async fn list_caddie_recommendations(
        &self,
        credentials: GatewayCredentials<'_>,
        query: RecommendationQuery,
    ) -> Result<Vec<CaddieRecommendation>, CourseError> {
        let mut params = Vec::new();
        if let Some(reservation_id) = query.reservation_id.as_deref() {
            params.push(format!(
                "reservationId={}",
                urlencoding_query(reservation_id)
            ));
        }
        if let Some(scheduled_at) = query.scheduled_at {
            params.push(format!(
                "scheduledAt={}",
                urlencoding_query(&scheduled_at.to_rfc3339())
            ));
        }
        if let Some(player_count) = query.player_count {
            params.push(format!("playerCount={player_count}"));
        }
        if query.include_rookie_pairing {
            params.push("includeRookiePairing=true".into());
        }
        if let Some(limit) = query.limit {
            params.push(format!("limit={limit}"));
        }
        let path = if params.is_empty() {
            format!("{GOLF}/caddie-recommendations")
        } else {
            format!("{GOLF}/caddie-recommendations?{}", params.join("&"))
        };
        let items: Vec<FieldRecommendationDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items.into_iter().map(map_recommendation).collect())
    }

    async fn get_attendance_snapshot(
        &self,
        credentials: GatewayCredentials<'_>,
        date: Option<NaiveDate>,
    ) -> Result<AttendanceSnapshotReport, CourseError> {
        let path = match date {
            Some(date) => format!("{GOLF}/caddie-attendance-snapshot?date={date}"),
            None => format!("{GOLF}/caddie-attendance-snapshot"),
        };
        let dto: FieldAttendanceReportDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(AttendanceSnapshotReport::new(
            dto.date,
            dto.items.into_iter().map(map_attendance).collect(),
        ))
    }

    async fn get_caddie_supply(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        safety_buffer: Option<i64>,
    ) -> Result<CaddieSupply, CourseError> {
        let mut path = format!("{GOLF}/caddie-supply?date={date}");
        if let Some(buffer) = safety_buffer {
            path.push_str(&format!("&safetyBuffer={buffer}"));
        }
        let dto: FieldSupplyDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(CaddieSupply::reconstitute(
            dto.date,
            dto.available_caddies,
            dto.two_round_capable,
            dto.caddie_supply,
            dto.morning_capacity,
            dto.afternoon_capacity,
            dto.safety_buffer,
            dto.caddie_attached_cap,
            dto.current_caddie_attached,
            dto.remaining,
        ))
    }

    async fn auto_assign_caddies(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        dry_run: bool,
    ) -> Result<AutoAssignResult, CourseError> {
        let body = json!({ "date": date, "dryRun": dry_run });
        let dto: FieldAutoAssignDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!("{GOLF}/caddie-auto-assignments"),
            credentials,
            Some(&body),
        )
        .await?;
        Ok(AutoAssignResult::new(
            dto.dry_run,
            dto.assigned
                .into_iter()
                .map(|item| {
                    AutoAssignPlanItem::reconstitute(
                        item.reservation_id,
                        item.scheduled_at,
                        item.caddie_profile_id,
                        item.caddie_display_name,
                        item.rationale,
                    )
                })
                .collect(),
            dto.skipped
                .into_iter()
                .map(|item| AutoAssignSkippedItem::new(item.reservation_id, item.reason))
                .collect(),
        ))
    }

    async fn get_payroll_summary(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<PayrollSummary, CourseError> {
        let path = format!(
            "{GOLF}/caddie-payroll-summary?yearMonth={}",
            urlencoding_query(year_month)
        );
        let dto: FieldPayrollDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(PayrollSummary::new(
            PayrollPeriod::new(
                dto.period.year_month,
                dto.period.start_date,
                dto.period.end_date,
            ),
            dto.items.into_iter().map(map_payroll_row).collect(),
        ))
    }

    async fn export_payroll_csv(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        let path = format!(
            "{GOLF}/caddie-payroll-summary/export.csv?yearMonth={}",
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

    async fn list_caddie_ratings(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: Option<&str>,
    ) -> Result<Vec<CaddieRating>, CourseError> {
        let path = match caddie_id {
            Some(id) => format!(
                "{GOLF}/caddie-ratings?caddieProfileId={}",
                urlencoding_query(id)
            ),
            None => format!("{GOLF}/caddie-ratings"),
        };
        let items: Vec<FieldRatingDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        items.into_iter().map(map_rating).collect()
    }
}

fn upsert_caddie_body(input: &UpsertCaddie) -> Value {
    json!({
        "displayName": input.display_name,
        "skillLevel": input.skill_level.as_str(),
        "rank": input.rank.as_str(),
        "baseFeeAmount": input.base_fee_amount,
        "currency": input.currency,
        "staffId": input.staff_id,
        "staffReferenceType": input.staff_reference_type,
        "staffReferenceId": input.staff_reference_id,
        "active": input.active,
        "employmentStatus": input.employment_status,
        "maxRoundsPerDay": input.max_rounds_per_day,
        "monthlyContractRounds": input.monthly_contract_rounds,
        "canTwoRounds": input.can_two_rounds,
        "desiredIncome": input.desired_income,
    })
}

fn urlencoding_query(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => ch.to_string(),
            _ => format!("%{:02X}", ch as u8),
        })
        .collect()
}

fn map_membership(value: FieldMembershipDto) -> CaddieCourseMembership {
    CaddieCourseMembership::reconstitute(
        value.id,
        value.caddie_profile_id,
        value.golf_course_id,
        value.is_primary.unwrap_or(false),
    )
}

fn map_availability(value: FieldAvailabilityDto) -> CaddieAvailability {
    CaddieAvailability::reconstitute(
        value.id,
        value.caddie_profile_id,
        value.date,
        AvailabilityStatus::parse(value.status.as_str()),
        value.two_round_request.unwrap_or(false),
        value.health_note,
        value.updated_at,
    )
}

fn map_recommendation(value: FieldRecommendationDto) -> CaddieRecommendation {
    let skill = match value.skill_level {
        Value::String(raw) => CaddieSkillLevel::parse(&raw),
        _ => CaddieSkillLevel::Regular,
    };
    CaddieRecommendation::reconstitute(
        value.caddie_profile_id,
        value.display_name,
        skill,
        value.rating_average,
        value.rating_count.unwrap_or(0),
        value.rounds_assigned.unwrap_or(0),
        value.recommendation_score.unwrap_or(0),
        value.recommended_role.unwrap_or_else(|| "primary".into()),
        value.pairing_display_name,
        value.rationale.unwrap_or_default(),
    )
}

fn map_attendance(value: FieldAttendanceDto) -> AttendanceSnapshot {
    AttendanceSnapshot::reconstitute(
        value.caddie_profile_id,
        value.display_name,
        value.staff_id,
        value.attendance_status,
        value.today_assignments.unwrap_or(0),
        value.rounds_without_clock_in_today.unwrap_or(0),
    )
}

fn map_payroll_row(value: FieldPayrollRowDto) -> PayrollRow {
    PayrollRow::reconstitute(
        value.caddie_profile_id,
        value.display_name,
        value.staff_id,
        value.worked_minutes.unwrap_or(0),
        value.shifted_minutes.unwrap_or(0),
        value.assigned_rounds.unwrap_or(0),
        value.confirmed_fee_total.unwrap_or(0),
        value.currency.unwrap_or_else(|| "JPY".into()),
        value.open_clock_in.unwrap_or(false),
        value.rounds_without_clock_in.unwrap_or(0),
    )
}

fn map_rating(value: FieldRatingDto) -> Result<CaddieRating, CourseError> {
    CaddieRating::reconstitute(
        value.id,
        value.caddie_profile_id,
        value.assignment_id,
        value.reservation_id,
        value.customer_id.unwrap_or_default(),
        value.score,
        value.comment,
        value.created_at,
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldItems<T> {
    items: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldStaffMemberDto {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipDto {
    id: String,
    caddie_profile_id: String,
    golf_course_id: String,
    #[serde(default)]
    is_primary: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAvailabilityDto {
    id: String,
    caddie_profile_id: String,
    date: NaiveDate,
    status: String,
    #[serde(default)]
    two_round_request: Option<bool>,
    #[serde(default)]
    health_note: Option<String>,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldRecommendationDto {
    caddie_profile_id: String,
    display_name: String,
    #[serde(default)]
    skill_level: Value,
    #[serde(default)]
    rating_average: Option<f64>,
    #[serde(default)]
    rating_count: Option<i64>,
    #[serde(default)]
    rounds_assigned: Option<i64>,
    #[serde(default)]
    recommendation_score: Option<i32>,
    #[serde(default)]
    recommended_role: Option<String>,
    #[serde(default)]
    pairing_display_name: Option<String>,
    #[serde(default)]
    rationale: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAttendanceReportDto {
    date: NaiveDate,
    items: Vec<FieldAttendanceDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAttendanceDto {
    caddie_profile_id: String,
    display_name: String,
    #[serde(default)]
    staff_id: Option<String>,
    attendance_status: String,
    #[serde(default)]
    today_assignments: Option<i64>,
    #[serde(default)]
    rounds_without_clock_in_today: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldSupplyDto {
    date: NaiveDate,
    available_caddies: i64,
    two_round_capable: i64,
    caddie_supply: i64,
    morning_capacity: i64,
    afternoon_capacity: i64,
    safety_buffer: i64,
    caddie_attached_cap: i64,
    current_caddie_attached: i64,
    remaining: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAutoAssignDto {
    dry_run: bool,
    assigned: Vec<FieldAutoAssignItemDto>,
    skipped: Vec<FieldAutoAssignSkippedDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAutoAssignItemDto {
    reservation_id: String,
    scheduled_at: DateTime<Utc>,
    caddie_profile_id: String,
    caddie_display_name: String,
    #[serde(default)]
    rationale: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldAutoAssignSkippedDto {
    reservation_id: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldPayrollDto {
    period: FieldPayrollPeriodDto,
    items: Vec<FieldPayrollRowDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldPayrollPeriodDto {
    year_month: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldPayrollRowDto {
    caddie_profile_id: String,
    display_name: String,
    #[serde(default)]
    staff_id: Option<String>,
    #[serde(default)]
    worked_minutes: Option<i64>,
    #[serde(default)]
    shifted_minutes: Option<i64>,
    #[serde(default)]
    assigned_rounds: Option<i64>,
    #[serde(default)]
    confirmed_fee_total: Option<i64>,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    open_clock_in: Option<bool>,
    #[serde(default)]
    rounds_without_clock_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldRatingDto {
    id: String,
    caddie_profile_id: String,
    #[serde(default)]
    assignment_id: Option<String>,
    #[serde(default)]
    reservation_id: Option<String>,
    #[serde(default)]
    customer_id: Option<String>,
    score: i32,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    created_at: Option<DateTime<Utc>>,
}
