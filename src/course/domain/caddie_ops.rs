//! Caddie operations beyond roster/assignment listing:
//! memberships, availabilities, recommendations, attendance, supply,
//! auto-assign, payroll, and ratings.

use chrono::{DateTime, NaiveDate, Utc};

use super::{CaddieRank, CaddieSkillLevel, CourseError};

/// Input for creating or updating a caddie profile.
#[derive(Debug, Clone, PartialEq)]
pub struct UpsertCaddie {
    pub display_name: String,
    pub skill_level: CaddieSkillLevel,
    pub rank: CaddieRank,
    pub base_fee_amount: i64,
    pub currency: String,
    pub staff_id: Option<String>,
    pub staff_reference_type: Option<String>,
    pub staff_reference_id: Option<String>,
    pub active: bool,
    pub employment_status: String,
    pub max_rounds_per_day: i32,
    pub monthly_contract_rounds: Option<i32>,
    pub can_two_rounds: Option<bool>,
    pub desired_income: Option<i32>,
}

impl UpsertCaddie {
    #[allow(clippy::too_many_arguments)]
    pub fn try_new(
        display_name: impl Into<String>,
        skill_level: impl AsRef<str>,
        rank: impl AsRef<str>,
        base_fee_amount: i64,
        currency: Option<String>,
        staff_id: Option<String>,
        staff_reference_type: Option<String>,
        staff_reference_id: Option<String>,
        active: bool,
        employment_status: Option<String>,
        max_rounds_per_day: Option<i32>,
        monthly_contract_rounds: Option<i32>,
        can_two_rounds: Option<bool>,
        desired_income: Option<i32>,
    ) -> Result<Self, CourseError> {
        let display_name = display_name.into().trim().to_string();
        if display_name.is_empty() {
            return Err(CourseError::BadRequest("display name is required"));
        }
        if base_fee_amount < 0 {
            return Err(CourseError::BadRequest("base fee amount must be >= 0"));
        }
        Ok(Self {
            display_name,
            skill_level: CaddieSkillLevel::parse(skill_level.as_ref()),
            rank: CaddieRank::parse(rank.as_ref()),
            base_fee_amount,
            currency: currency
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "JPY".into()),
            staff_id: staff_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            staff_reference_type: staff_reference_type
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            staff_reference_id: staff_reference_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            active,
            employment_status: employment_status
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "active".into()),
            max_rounds_per_day: max_rounds_per_day.unwrap_or(1).max(1),
            monthly_contract_rounds,
            can_two_rounds,
            desired_income,
        })
    }
}

/// Input for creating or updating a caddie assignment.
#[derive(Debug, Clone, PartialEq)]
pub struct UpsertCaddieAssignment {
    pub caddie_id: String,
    pub reservation_id: Option<String>,
    pub round_reference: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    pub status: Option<String>,
    pub assignment_role: Option<String>,
    pub fee_amount: Option<i64>,
    pub fee_currency: Option<String>,
    pub recommendation_score: Option<i32>,
    pub notes: Option<String>,
}

impl UpsertCaddieAssignment {
    #[allow(clippy::too_many_arguments)]
    pub fn try_new(
        caddie_id: impl Into<String>,
        reservation_id: Option<String>,
        round_reference: Option<String>,
        scheduled_at: DateTime<Utc>,
        status: Option<String>,
        assignment_role: Option<String>,
        fee_amount: Option<i64>,
        fee_currency: Option<String>,
        recommendation_score: Option<i32>,
        notes: Option<String>,
    ) -> Result<Self, CourseError> {
        let caddie_id = caddie_id.into().trim().to_string();
        if caddie_id.is_empty() {
            return Err(CourseError::BadRequest("caddie id is required"));
        }
        Ok(Self {
            caddie_id,
            reservation_id: reservation_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            round_reference: round_reference
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            scheduled_at,
            status: status
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            assignment_role: assignment_role
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            fee_amount: fee_amount.filter(|value| *value >= 0),
            fee_currency: fee_currency
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            recommendation_score,
            notes: notes
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }
}

/// Course membership for a caddie (many-to-many).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieCourseMembership {
    id: String,
    caddie_id: String,
    golf_course_id: String,
    is_primary: bool,
}

impl CaddieCourseMembership {
    pub fn reconstitute(
        id: impl Into<String>,
        caddie_id: impl Into<String>,
        golf_course_id: impl Into<String>,
        is_primary: bool,
    ) -> Self {
        Self {
            id: id.into(),
            caddie_id: caddie_id.into(),
            golf_course_id: golf_course_id.into(),
            is_primary,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn golf_course_id(&self) -> &str {
        &self.golf_course_id
    }

    pub fn is_primary(&self) -> bool {
        self.is_primary
    }
}

/// Replacement set for a caddie's course memberships.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplaceCaddieMemberships {
    pub course_ids: Vec<String>,
    pub primary_course_id: Option<String>,
}

impl ReplaceCaddieMemberships {
    pub fn try_new(
        course_ids: Vec<String>,
        primary_course_id: Option<String>,
    ) -> Result<Self, CourseError> {
        let course_ids: Vec<String> = course_ids
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let primary_course_id = primary_course_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if let Some(primary) = primary_course_id.as_ref() {
            if !course_ids.iter().any(|id| id == primary) {
                return Err(CourseError::BadRequest(
                    "primary course must be included in course ids",
                ));
            }
        }
        Ok(Self {
            course_ids,
            primary_course_id,
        })
    }
}

/// Day-level availability status for dispatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AvailabilityStatus {
    Available,
    Unavailable,
    MorningOnly,
    AfternoonOnly,
    LightDuty,
}

impl AvailabilityStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Unavailable => "unavailable",
            Self::MorningOnly => "morning_only",
            Self::AfternoonOnly => "afternoon_only",
            Self::LightDuty => "light_duty",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "unavailable" => Self::Unavailable,
            "morning_only" => Self::MorningOnly,
            "afternoon_only" => Self::AfternoonOnly,
            "light_duty" => Self::LightDuty,
            _ => Self::Available,
        }
    }

    pub fn is_workable(self) -> bool {
        !matches!(self, Self::Unavailable)
    }
}

/// Caddie day availability record.
#[derive(Debug, Clone, PartialEq)]
pub struct CaddieAvailability {
    id: String,
    caddie_id: String,
    date: NaiveDate,
    status: AvailabilityStatus,
    two_round_request: bool,
    health_note: Option<String>,
    updated_at: Option<DateTime<Utc>>,
}

impl CaddieAvailability {
    pub fn reconstitute(
        id: impl Into<String>,
        caddie_id: impl Into<String>,
        date: NaiveDate,
        status: AvailabilityStatus,
        two_round_request: bool,
        health_note: Option<String>,
        updated_at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            id: id.into(),
            caddie_id: caddie_id.into(),
            date,
            status,
            two_round_request,
            health_note: health_note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            updated_at,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn status(&self) -> AvailabilityStatus {
        self.status
    }

    pub fn two_round_request(&self) -> bool {
        self.two_round_request
    }

    pub fn health_note(&self) -> Option<&str> {
        self.health_note.as_deref()
    }

    pub fn updated_at(&self) -> Option<DateTime<Utc>> {
        self.updated_at
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpsertCaddieAvailability {
    pub caddie_id: String,
    pub date: NaiveDate,
    pub status: AvailabilityStatus,
    pub two_round_request: bool,
    pub health_note: Option<String>,
}

impl UpsertCaddieAvailability {
    pub fn try_new(
        caddie_id: impl Into<String>,
        date: NaiveDate,
        status: impl AsRef<str>,
        two_round_request: bool,
        health_note: Option<String>,
    ) -> Result<Self, CourseError> {
        let caddie_id = caddie_id.into().trim().to_string();
        if caddie_id.is_empty() {
            return Err(CourseError::BadRequest("caddie id is required"));
        }
        Ok(Self {
            caddie_id,
            date,
            status: AvailabilityStatus::parse(status.as_ref()),
            two_round_request,
            health_note: health_note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AvailabilityQuery {
    pub caddie_id: Option<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub date: Option<NaiveDate>,
}

/// Dispatch recommendation candidate.
#[derive(Debug, Clone, PartialEq)]
pub struct CaddieRecommendation {
    caddie_id: String,
    display_name: String,
    skill_level: CaddieSkillLevel,
    rating_average: Option<f64>,
    rating_count: i64,
    rounds_assigned: i64,
    recommendation_score: i32,
    recommended_role: String,
    pairing_display_name: Option<String>,
    rationale: Vec<String>,
}

impl CaddieRecommendation {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        caddie_id: impl Into<String>,
        display_name: impl Into<String>,
        skill_level: CaddieSkillLevel,
        rating_average: Option<f64>,
        rating_count: i64,
        rounds_assigned: i64,
        recommendation_score: i32,
        recommended_role: impl Into<String>,
        pairing_display_name: Option<String>,
        rationale: Vec<String>,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            display_name: display_name.into(),
            skill_level,
            rating_average,
            rating_count: rating_count.max(0),
            rounds_assigned: rounds_assigned.max(0),
            recommendation_score,
            recommended_role: recommended_role.into(),
            pairing_display_name,
            rationale,
        }
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn skill_level(&self) -> CaddieSkillLevel {
        self.skill_level
    }

    pub fn rating_average(&self) -> Option<f64> {
        self.rating_average
    }

    pub fn rating_count(&self) -> i64 {
        self.rating_count
    }

    pub fn rounds_assigned(&self) -> i64 {
        self.rounds_assigned
    }

    pub fn recommendation_score(&self) -> i32 {
        self.recommendation_score
    }

    pub fn recommended_role(&self) -> &str {
        &self.recommended_role
    }

    pub fn pairing_display_name(&self) -> Option<&str> {
        self.pairing_display_name.as_deref()
    }

    pub fn rationale(&self) -> &[String] {
        &self.rationale
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RecommendationQuery {
    pub reservation_id: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub player_count: Option<i32>,
    pub include_rookie_pairing: bool,
    pub limit: Option<u32>,
}

/// Attendance snapshot row for an operation date.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttendanceSnapshot {
    caddie_id: String,
    display_name: String,
    staff_id: Option<String>,
    attendance_status: String,
    today_assignments: i64,
    rounds_without_clock_in_today: i64,
}

impl AttendanceSnapshot {
    pub fn reconstitute(
        caddie_id: impl Into<String>,
        display_name: impl Into<String>,
        staff_id: Option<String>,
        attendance_status: impl Into<String>,
        today_assignments: i64,
        rounds_without_clock_in_today: i64,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            display_name: display_name.into(),
            staff_id,
            attendance_status: attendance_status.into(),
            today_assignments: today_assignments.max(0),
            rounds_without_clock_in_today: rounds_without_clock_in_today.max(0),
        }
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn staff_id(&self) -> Option<&str> {
        self.staff_id.as_deref()
    }

    pub fn attendance_status(&self) -> &str {
        &self.attendance_status
    }

    pub fn today_assignments(&self) -> i64 {
        self.today_assignments
    }

    pub fn rounds_without_clock_in_today(&self) -> i64 {
        self.rounds_without_clock_in_today
    }

    pub fn is_working(&self) -> bool {
        self.attendance_status.eq_ignore_ascii_case("working")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttendanceSnapshotReport {
    date: NaiveDate,
    items: Vec<AttendanceSnapshot>,
}

impl AttendanceSnapshotReport {
    pub fn new(date: NaiveDate, items: Vec<AttendanceSnapshot>) -> Self {
        Self { date, items }
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn items(&self) -> &[AttendanceSnapshot] {
        &self.items
    }
}

/// Caddie-attached tee capacity derived from supply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieSupply {
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

impl CaddieSupply {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
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
    ) -> Self {
        Self {
            date,
            available_caddies,
            two_round_capable,
            caddie_supply,
            morning_capacity,
            afternoon_capacity,
            safety_buffer: safety_buffer.max(0),
            caddie_attached_cap,
            current_caddie_attached,
            remaining,
        }
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn available_caddies(&self) -> i64 {
        self.available_caddies
    }

    pub fn two_round_capable(&self) -> i64 {
        self.two_round_capable
    }

    pub fn caddie_supply(&self) -> i64 {
        self.caddie_supply
    }

    pub fn morning_capacity(&self) -> i64 {
        self.morning_capacity
    }

    pub fn afternoon_capacity(&self) -> i64 {
        self.afternoon_capacity
    }

    pub fn safety_buffer(&self) -> i64 {
        self.safety_buffer
    }

    pub fn caddie_attached_cap(&self) -> i64 {
        self.caddie_attached_cap
    }

    pub fn current_caddie_attached(&self) -> i64 {
        self.current_caddie_attached
    }

    pub fn remaining(&self) -> i64 {
        self.remaining
    }

    pub fn is_over_capacity(&self) -> bool {
        self.remaining < 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoAssignPlanItem {
    reservation_id: String,
    scheduled_at: DateTime<Utc>,
    caddie_id: String,
    caddie_display_name: String,
    rationale: Vec<String>,
}

impl AutoAssignPlanItem {
    pub fn reconstitute(
        reservation_id: impl Into<String>,
        scheduled_at: DateTime<Utc>,
        caddie_id: impl Into<String>,
        caddie_display_name: impl Into<String>,
        rationale: Vec<String>,
    ) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            scheduled_at,
            caddie_id: caddie_id.into(),
            caddie_display_name: caddie_display_name.into(),
            rationale,
        }
    }

    pub fn reservation_id(&self) -> &str {
        &self.reservation_id
    }

    pub fn scheduled_at(&self) -> DateTime<Utc> {
        self.scheduled_at
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn caddie_display_name(&self) -> &str {
        &self.caddie_display_name
    }

    pub fn rationale(&self) -> &[String] {
        &self.rationale
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoAssignSkippedItem {
    reservation_id: String,
    reason: String,
}

impl AutoAssignSkippedItem {
    pub fn new(reservation_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            reason: reason.into(),
        }
    }

    pub fn reservation_id(&self) -> &str {
        &self.reservation_id
    }

    pub fn reason(&self) -> &str {
        &self.reason
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoAssignResult {
    dry_run: bool,
    assigned: Vec<AutoAssignPlanItem>,
    skipped: Vec<AutoAssignSkippedItem>,
}

impl AutoAssignResult {
    pub fn new(
        dry_run: bool,
        assigned: Vec<AutoAssignPlanItem>,
        skipped: Vec<AutoAssignSkippedItem>,
    ) -> Self {
        Self {
            dry_run,
            assigned,
            skipped,
        }
    }

    pub fn dry_run(&self) -> bool {
        self.dry_run
    }

    pub fn assigned(&self) -> &[AutoAssignPlanItem] {
        &self.assigned
    }

    pub fn skipped(&self) -> &[AutoAssignSkippedItem] {
        &self.skipped
    }

    pub fn assigned_count(&self) -> usize {
        self.assigned.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayrollPeriod {
    year_month: String,
    start_date: NaiveDate,
    end_date: NaiveDate,
}

impl PayrollPeriod {
    pub fn new(year_month: impl Into<String>, start_date: NaiveDate, end_date: NaiveDate) -> Self {
        Self {
            year_month: year_month.into(),
            start_date,
            end_date,
        }
    }

    pub fn year_month(&self) -> &str {
        &self.year_month
    }

    pub fn start_date(&self) -> NaiveDate {
        self.start_date
    }

    pub fn end_date(&self) -> NaiveDate {
        self.end_date
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PayrollRow {
    caddie_id: String,
    display_name: String,
    staff_id: Option<String>,
    worked_minutes: i64,
    shifted_minutes: i64,
    assigned_rounds: i64,
    confirmed_fee_total: i64,
    currency: String,
    open_clock_in: bool,
    rounds_without_clock_in: i64,
}

impl PayrollRow {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        caddie_id: impl Into<String>,
        display_name: impl Into<String>,
        staff_id: Option<String>,
        worked_minutes: i64,
        shifted_minutes: i64,
        assigned_rounds: i64,
        confirmed_fee_total: i64,
        currency: impl Into<String>,
        open_clock_in: bool,
        rounds_without_clock_in: i64,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            display_name: display_name.into(),
            staff_id,
            worked_minutes: worked_minutes.max(0),
            shifted_minutes: shifted_minutes.max(0),
            assigned_rounds: assigned_rounds.max(0),
            confirmed_fee_total: confirmed_fee_total.max(0),
            currency: {
                let value = currency.into();
                if value.trim().is_empty() {
                    "JPY".into()
                } else {
                    value
                }
            },
            open_clock_in,
            rounds_without_clock_in: rounds_without_clock_in.max(0),
        }
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn staff_id(&self) -> Option<&str> {
        self.staff_id.as_deref()
    }

    pub fn worked_minutes(&self) -> i64 {
        self.worked_minutes
    }

    pub fn shifted_minutes(&self) -> i64 {
        self.shifted_minutes
    }

    pub fn assigned_rounds(&self) -> i64 {
        self.assigned_rounds
    }

    pub fn confirmed_fee_total(&self) -> i64 {
        self.confirmed_fee_total
    }

    pub fn currency(&self) -> &str {
        &self.currency
    }

    pub fn open_clock_in(&self) -> bool {
        self.open_clock_in
    }

    pub fn rounds_without_clock_in(&self) -> i64 {
        self.rounds_without_clock_in
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PayrollSummary {
    period: PayrollPeriod,
    items: Vec<PayrollRow>,
}

impl PayrollSummary {
    pub fn new(period: PayrollPeriod, items: Vec<PayrollRow>) -> Self {
        Self { period, items }
    }

    pub fn period(&self) -> &PayrollPeriod {
        &self.period
    }

    pub fn items(&self) -> &[PayrollRow] {
        &self.items
    }

    pub fn total_confirmed_fees(&self) -> i64 {
        self.items.iter().map(PayrollRow::confirmed_fee_total).sum()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CaddieRating {
    id: String,
    caddie_id: String,
    assignment_id: Option<String>,
    reservation_id: Option<String>,
    customer_id: String,
    score: i32,
    comment: Option<String>,
    created_at: Option<DateTime<Utc>>,
}

impl CaddieRating {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<String>,
        caddie_id: impl Into<String>,
        assignment_id: Option<String>,
        reservation_id: Option<String>,
        customer_id: impl Into<String>,
        score: i32,
        comment: Option<String>,
        created_at: Option<DateTime<Utc>>,
    ) -> Result<Self, CourseError> {
        if !(1..=5).contains(&score) {
            return Err(CourseError::BadRequest("rating score must be 1-5"));
        }
        Ok(Self {
            id: id.into(),
            caddie_id: caddie_id.into(),
            assignment_id,
            reservation_id,
            customer_id: customer_id.into(),
            score,
            comment,
            created_at,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn assignment_id(&self) -> Option<&str> {
        self.assignment_id.as_deref()
    }

    pub fn reservation_id(&self) -> Option<&str> {
        self.reservation_id.as_deref()
    }

    pub fn customer_id(&self) -> &str {
        &self.customer_id
    }

    pub fn score(&self) -> i32 {
        self.score
    }

    pub fn comment(&self) -> Option<&str> {
        self.comment.as_deref()
    }

    pub fn created_at(&self) -> Option<DateTime<Utc>> {
        self.created_at
    }
}
