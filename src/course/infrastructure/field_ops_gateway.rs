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
    AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshot, AttendanceSnapshotReport,
    AutoAssignPlanItem, AutoAssignResult, AutoAssignSkippedItem, AvailabilityQuery,
    AvailabilityStatus, Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
    CaddieCourseMembership, CaddieId, CaddieRating, CaddieRecommendation, CaddieRoster,
    CaddieSkillLevel, CaddieStaff, CourseError, GatewayCredentials, GolfOpsGateway,
    RecommendationQuery, ReplaceCaddieMemberships, UpsertCaddie, UpsertCaddieAssignment,
    UpsertCaddieAvailability, WorkedMinutes,
};

const GOLF: &str = "/v1/erp/extensions/golf-course";
/// Caddies are hired per round, so a staff member registered while creating one
/// starts as part-time; HRM can change it afterwards.
const DEFAULT_STAFF_EMPLOYMENT_TYPE: &str = "part_time";

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

    /// Batch-load the HRM staff index once for name resolution and UI reuse.
    async fn load_staff(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<CaddieStaff>, CourseError> {
        let items: Vec<FieldStaffMemberDto> =
            field_get_items(&self.client, &self.base_url, "/v1/erp/staff", credentials).await?;
        Ok(items
            .into_iter()
            .filter_map(|item| {
                let name = item.name.trim().to_string();
                if name.is_empty() {
                    None
                } else {
                    Some(CaddieStaff::new(item.id, name, item.active))
                }
            })
            .collect())
    }

    fn staff_names_by_id(staff: &[CaddieStaff]) -> HashMap<String, String> {
        staff
            .iter()
            .map(|item| (item.id().to_string(), item.name().to_string()))
            .collect()
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
    async fn list_caddie_roster(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieRoster, CourseError> {
        let items: Vec<FieldGolfCaddieProfileDto> = field_get_items(
            &self.client,
            &self.base_url,
            &format!("{GOLF}/caddie-profiles"),
            credentials,
        )
        .await?;
        let staff = self.load_staff(credentials).await?;
        let staff_names = Self::staff_names_by_id(&staff);
        Ok(CaddieRoster::new(
            Self::map_profiles(items, &staff_names),
            staff,
        ))
    }

    async fn create_staff(
        &self,
        credentials: GatewayCredentials<'_>,
        name: &str,
    ) -> Result<CaddieStaff, CourseError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CourseError::BadRequest("staff name is required"));
        }
        let body = json!({
            "name": name,
            "employmentType": DEFAULT_STAFF_EMPLOYMENT_TYPE,
            "active": true,
        });
        let dto: FieldStaffMemberDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/staff",
            credentials,
            Some(&body),
        )
        .await?;
        Ok(CaddieStaff::new(dto.id, dto.name, dto.active))
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
        let staff = self.load_staff(credentials).await?;
        let staff_names = Self::staff_names_by_id(&staff);
        Ok(map_caddie(dto, &staff_names))
    }

    async fn update_caddie(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
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
        let staff = self.load_staff(credentials).await?;
        let staff_names = Self::staff_names_by_id(&staff);
        Ok(map_caddie(dto, &staff_names))
    }

    async fn list_caddie_assignments(
        &self,
        credentials: GatewayCredentials<'_>,
        query: CaddieAssignmentQuery,
    ) -> Result<Vec<CaddieAssignment>, CourseError> {
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
        let path = if params.is_empty() {
            format!("{GOLF}/caddie-assignments")
        } else {
            format!("{GOLF}/caddie-assignments?{}", params.join("&"))
        };
        let items: Vec<FieldGolfCaddieAssignmentDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        items.into_iter().map(map_caddie_assignment).collect()
    }

    async fn create_caddie_assignment(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError> {
        let dto: FieldGolfCaddieAssignmentDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &format!("{GOLF}/caddie-assignments"),
            credentials,
            Some(&caddie_assignment_body(&input)),
        )
        .await?;
        map_caddie_assignment(dto)
    }

    async fn update_caddie_assignment(
        &self,
        credentials: GatewayCredentials<'_>,
        assignment_id: &AssignmentId,
        input: UpsertCaddieAssignment,
    ) -> Result<CaddieAssignment, CourseError> {
        let body = caddie_assignment_body(&input);
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
        caddie_id: &CaddieId,
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
        caddie_id: &CaddieId,
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
        caddie_id: &CaddieId,
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
                urlencoding_query(scheduled_at.to_rfc3339())
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
        let names_by_profile_id: HashMap<String, String> = self
            .list_caddie_roster(credentials)
            .await?
            .caddies()
            .iter()
            .map(|caddie| (caddie.id().to_string(), caddie.display_name().to_string()))
            .collect();
        Ok(items
            .into_iter()
            .map(|item| map_recommendation(item, &names_by_profile_id))
            .collect())
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
        let staff_names = Self::staff_names_by_id(&self.load_staff(credentials).await?);
        Ok(AttendanceSnapshotReport::new(
            dto.date,
            dto.items
                .into_iter()
                .map(|item| map_attendance(item, &staff_names))
                .collect(),
        ))
    }

    async fn list_attendance_period_snapshots(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
        let path = format!("{GOLF}/caddie-attendance-snapshots?from={from}&to={to}");
        let items: Vec<FieldAttendancePeriodSnapshotDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items
            .into_iter()
            .map(map_attendance_period_snapshot)
            .collect())
    }

    async fn list_worked_minutes(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<HashMap<String, WorkedMinutes>, CourseError> {
        // One call for the whole roster. The per-staff endpoint would be a
        // request each, which is what this replaces.
        let path = format!(
            "/v1/erp/hrm/staff-utilization?period={}",
            urlencoding_query(year_month)
        );
        let items: Vec<FieldStaffWorkloadDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        Ok(items
            .into_iter()
            .filter(|item| !item.staff_id.trim().is_empty())
            .map(|item| {
                (
                    item.staff_id,
                    WorkedMinutes {
                        worked: item.worked_minutes.unwrap_or(0).max(0),
                        shifted: item.shifted_minutes.unwrap_or(0).max(0),
                    },
                )
            })
            .collect())
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
        caddie_id: Option<&CaddieId>,
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

/// The body Field takes for a caddie assignment, on create and on update alike.
fn caddie_assignment_body(input: &UpsertCaddieAssignment) -> Value {
    json!({
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
    })
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

/// Same rule the roster uses (`resolve_caddie_display_name`): a linked staff
/// member's name wins over the extension's stored copy.
fn resolve_linked_staff_name(
    profile_display_name: &str,
    staff_id: Option<&str>,
    staff_names_by_id: &HashMap<String, String>,
) -> String {
    staff_id
        .and_then(|id| staff_names_by_id.get(id))
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .unwrap_or(profile_display_name)
        .to_string()
}

/// Recommendations carry no `staffId`, so the roster is the only bridge from a
/// caddie profile to the linked staff member's name.
fn map_recommendation(
    value: FieldRecommendationDto,
    names_by_profile_id: &HashMap<String, String>,
) -> CaddieRecommendation {
    let skill = match value.skill_level {
        Value::String(raw) => CaddieSkillLevel::parse(&raw),
        _ => CaddieSkillLevel::Regular,
    };
    let display_name = names_by_profile_id
        .get(&value.caddie_profile_id)
        .cloned()
        .unwrap_or(value.display_name);
    let pairing_display_name = value.pairing_display_name;
    CaddieRecommendation::reconstitute(
        value.caddie_profile_id,
        display_name,
        skill,
        value.rating_average,
        value.rating_count.unwrap_or(0),
        value.rounds_assigned.unwrap_or(0),
        None,
        None,
        value.recommendation_score.unwrap_or(0),
        value.recommended_role.unwrap_or_else(|| "primary".into()),
        pairing_display_name,
        value.rationale.unwrap_or_default(),
    )
}

/// Field answers with the golf extension's own `displayName`, which is a copy
/// made before a staff master existed and drifts from it. The roster already
/// resolves the linked staff name; do the same here so a caddie is not called
/// one thing on the roster and another on the attendance board.
fn map_attendance(
    value: FieldAttendanceDto,
    staff_names_by_id: &HashMap<String, String>,
) -> AttendanceSnapshot {
    let display_name = resolve_linked_staff_name(
        &value.display_name,
        value.staff_id.as_deref(),
        staff_names_by_id,
    );
    AttendanceSnapshot::reconstitute(
        value.caddie_profile_id,
        display_name,
        value.staff_id,
        value.attendance_status,
        value.today_assignments.unwrap_or(0),
        value.rounds_without_clock_in_today.unwrap_or(0),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldStaffWorkloadDto {
    staff_id: String,
    worked_minutes: Option<i64>,
    shifted_minutes: Option<i64>,
}

fn map_attendance_period_snapshot(
    value: FieldAttendancePeriodSnapshotDto,
) -> AttendancePeriodSnapshot {
    AttendancePeriodSnapshot::reconstitute(
        value.caddie_profile_id,
        value.date,
        value.attendance_status,
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
    #[serde(default)]
    active: bool,
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
struct FieldAttendancePeriodSnapshotDto {
    caddie_profile_id: String,
    date: NaiveDate,
    attendance_status: String,
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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        extract::OriginalUri,
        http::StatusCode,
        routing::{get, patch, post},
        Json, Router,
    };

    use super::*;

    const ATTENDANCE_PERIOD_PATH: &str =
        "/v1/erp/extensions/golf-course/caddie-attendance-snapshots";

    fn test_credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer test-token",
            operator_id: "operator-test",
            platform_id: Some("platform-test"),
        }
    }

    async fn spawn_field_server(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test Field API");
        let addr = listener.local_addr().expect("test Field API address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test Field API");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn attendance_period_forwards_plural_path_and_date_query() {
        let seen_uri = Arc::new(Mutex::new(None));
        let app = Router::new().route(
            ATTENDANCE_PERIOD_PATH,
            get({
                let seen_uri = seen_uri.clone();
                move |OriginalUri(uri): OriginalUri| {
                    let seen_uri = seen_uri.clone();
                    async move {
                        *seen_uri.lock().expect("lock seen URI") = Some(uri.to_string());
                        Json(json!({
                            "items": [{
                                "caddieProfileId": "caddie-1",
                                "date": "2026-07-15",
                                "attendanceStatus": "clocked_out"
                            }]
                        }))
                    }
                }
            }),
        );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldGolfOpsGateway::new(reqwest::Client::new(), Some(&base_url));
        let from = NaiveDate::from_ymd_opt(2026, 7, 1).expect("valid from date");
        let to = NaiveDate::from_ymd_opt(2026, 7, 31).expect("valid to date");

        let items = gateway
            .list_attendance_period_snapshots(test_credentials(), from, to)
            .await
            .expect("attendance period response");

        assert_eq!(
            seen_uri.lock().expect("lock seen URI").as_deref(),
            Some(
                "/v1/erp/extensions/golf-course/caddie-attendance-snapshots?from=2026-07-01&to=2026-07-31"
            )
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].caddie_id().as_str(), "caddie-1");
        assert_eq!(
            items[0].date(),
            NaiveDate::from_ymd_opt(2026, 7, 15).unwrap()
        );
        assert_eq!(items[0].attendance_status(), "clocked_out");
    }

    #[tokio::test]
    async fn attendance_period_preserves_upstream_bad_request() {
        let app = Router::new().route(
            ATTENDANCE_PERIOD_PATH,
            get(|| async {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "message": "from must be on or before to" })),
                )
            }),
        );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldGolfOpsGateway::new(reqwest::Client::new(), Some(&base_url));
        let from = NaiveDate::from_ymd_opt(2026, 7, 31).expect("valid from date");
        let to = NaiveDate::from_ymd_opt(2026, 7, 1).expect("valid to date");

        let error = gateway
            .list_attendance_period_snapshots(test_credentials(), from, to)
            .await
            .expect_err("upstream 400 must not become an empty result");

        assert!(matches!(
            error,
            CourseError::UpstreamClient { status: 400, message }
                if message == "from must be on or before to"
        ));
    }

    #[tokio::test]
    async fn caddie_staff_link_preserves_field_conflict_message() {
        let app = Router::new().route(
            "/v1/erp/extensions/golf-course/caddie-profiles/caddie-1",
            patch(|| async {
                (
                    StatusCode::CONFLICT,
                    Json(json!({
                        "error": "staff_already_linked",
                        "message": "このスタッフは田中さんに既に紐付いています"
                    })),
                )
            }),
        );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldGolfOpsGateway::new(reqwest::Client::new(), Some(&base_url));
        let input = UpsertCaddie::try_new(
            "佐藤さん",
            "regular",
            "D",
            12_000,
            Some("JPY".to_string()),
            Some("staff-1".to_string()),
            Some("staff_member".to_string()),
            Some("staff-1".to_string()),
            true,
            Some("active".to_string()),
            Some(1),
            None,
            None,
            None,
        )
        .expect("valid caddie update");

        let error = gateway
            .update_caddie(
                test_credentials(),
                &CaddieId::try_new("caddie-1").expect("valid caddie id"),
                input,
            )
            .await
            .expect_err("a duplicate staff link must remain a conflict");

        assert!(matches!(
            error,
            CourseError::UpstreamClient { status: 409, message }
                if message == "このスタッフは田中さんに既に紐付いています"
        ));
    }

    #[tokio::test]
    async fn field_auth_denials_remain_403_through_the_caddie_gateway() {
        let app = Router::new()
            .route(
                "/v1/erp/extensions/golf-course/caddie-profiles/unauthorized",
                patch(|| async {
                    (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({ "message": "Field bearer was rejected" })),
                    )
                }),
            )
            .route(
                "/v1/erp/extensions/golf-course/caddie-profiles/forbidden",
                patch(|| async {
                    (
                        StatusCode::FORBIDDEN,
                        Json(json!({ "message": "Field tenant policy denied this operation" })),
                    )
                }),
            );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldGolfOpsGateway::new(reqwest::Client::new(), Some(&base_url));

        for (caddie_id, expected_message) in [
            ("unauthorized", "Field bearer was rejected"),
            ("forbidden", "Field tenant policy denied this operation"),
        ] {
            let input = UpsertCaddie::try_new(
                "佐藤さん",
                "regular",
                "D",
                12_000,
                Some("JPY".to_string()),
                Some("staff-1".to_string()),
                Some("staff_member".to_string()),
                Some("staff-1".to_string()),
                true,
                Some("active".to_string()),
                Some(1),
                None,
                None,
                None,
            )
            .expect("valid caddie update");
            let error = gateway
                .update_caddie(
                    test_credentials(),
                    &CaddieId::try_new(caddie_id).expect("valid caddie id"),
                    input,
                )
                .await
                .expect_err("Field auth denial must not become a success");

            assert!(matches!(
                error,
                CourseError::UpstreamClient { status: 403, message }
                    if message == expected_message
            ));
        }
    }

    #[tokio::test]
    async fn create_staff_registers_the_named_hrm_member() {
        let seen_body = Arc::new(Mutex::new(None));
        let app = Router::new().route(
            "/v1/erp/staff",
            post({
                let seen_body = seen_body.clone();
                move |Json(body): Json<Value>| {
                    let seen_body = seen_body.clone();
                    async move {
                        *seen_body.lock().expect("lock seen body") = Some(body);
                        Json(json!({ "id": "staff_new", "name": "山田 花子", "active": true }))
                    }
                }
            }),
        );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldGolfOpsGateway::new(reqwest::Client::new(), Some(&base_url));

        let staff = gateway
            .create_staff(test_credentials(), " 山田 花子 ")
            .await
            .expect("staff is registered");

        assert_eq!(staff.id(), "staff_new");
        let body = seen_body.lock().expect("lock seen body").clone();
        let body = body.expect("staff endpoint was called");
        assert_eq!(body["name"], "山田 花子");
        assert_eq!(body["employmentType"], "part_time");
        assert_eq!(body["active"], true);
    }

    #[tokio::test]
    async fn create_staff_rejects_a_blank_name_before_calling_field() {
        let gateway = FieldGolfOpsGateway::new(reqwest::Client::new(), Some("http://127.0.0.1:1"));

        let error = gateway
            .create_staff(test_credentials(), "   ")
            .await
            .expect_err("a blank name cannot name a staff member");

        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    fn staff_names(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, name)| ((*id).to_string(), (*name).to_string()))
            .collect()
    }

    #[test]
    fn linked_staff_name_wins_over_the_extension_copy() {
        // Field stores a `displayName` copied before a staff master existed; the
        // roster already prefers the linked staff member, and every other screen
        // has to agree or the same person is named two ways.
        let names = staff_names(&[("staff_1", "髙田卓哉")]);
        assert_eq!(
            resolve_linked_staff_name("髙田テスト", Some("staff_1"), &names),
            "髙田卓哉"
        );
    }

    #[test]
    fn unlinked_or_unknown_staff_keeps_the_profile_name() {
        let names = staff_names(&[("staff_1", "髙田卓哉")]);
        assert_eq!(
            resolve_linked_staff_name("外部キャディ", None, &names),
            "外部キャディ"
        );
        assert_eq!(
            resolve_linked_staff_name("外部キャディ", Some("staff_missing"), &names),
            "外部キャディ"
        );
    }

    #[test]
    fn blank_staff_name_does_not_erase_the_profile_name() {
        let names = staff_names(&[("staff_1", "   ")]);
        assert_eq!(
            resolve_linked_staff_name("佐藤 彩", Some("staff_1"), &names),
            "佐藤 彩"
        );
    }
}
