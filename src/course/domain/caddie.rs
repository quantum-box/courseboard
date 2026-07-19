//! Caddie roster and assignment aggregates.

use chrono::{DateTime, Utc};

use super::CourseError;

/// Skill band used for dispatch recommendations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaddieSkillLevel {
    Junior,
    Regular,
    Veteran,
}

impl CaddieSkillLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            // Field / desktop use "rookie"; keep that wire label.
            Self::Junior => "rookie",
            Self::Regular => "regular",
            Self::Veteran => "veteran",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "veteran" => Self::Veteran,
            "regular" => Self::Regular,
            "junior" | "rookie" => Self::Junior,
            _ => Self::Regular,
        }
    }
}

/// Contract rank for monthly round targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaddieRank {
    A,
    B,
    C,
    D,
}

impl CaddieRank {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
            Self::C => "C",
            Self::D => "D",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_uppercase().as_str() {
            "A" => Self::A,
            "B" => Self::B,
            "C" => Self::C,
            "D" => Self::D,
            _ => Self::C,
        }
    }
}

/// Role of a caddie on an assigned round.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentRole {
    Primary,
    Assistant,
    Other,
}

impl AssignmentRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Assistant => "assistant",
            Self::Other => "other",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "primary" | "lead" => Self::Primary,
            "assistant" => Self::Assistant,
            _ => Self::Other,
        }
    }

    pub fn is_primary(self) -> bool {
        matches!(self, Self::Primary)
    }
}

/// Lifecycle status of a caddie assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentStatus {
    Assigned,
    InProgress,
    Completed,
    Cancelled,
    Other,
}

impl AssignmentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Assigned => "assigned",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Other => "other",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "assigned" => Self::Assigned,
            "in_progress" | "checked_in" | "on_course" => Self::InProgress,
            "completed" => Self::Completed,
            "cancelled" | "canceled" => Self::Cancelled,
            "" => Self::Other,
            _ => Self::Other,
        }
    }

    pub fn is_active(self) -> bool {
        matches!(self, Self::Assigned | Self::InProgress)
    }
}

/// Caddie profile (roster) owned by course-api.
#[derive(Debug, Clone, PartialEq)]
pub struct Caddie {
    id: String,
    display_name: String,
    staff_id: Option<String>,
    active: bool,
    skill_level: CaddieSkillLevel,
    rank: CaddieRank,
    employment_status: String,
    base_fee_amount: i64,
    currency: String,
    max_rounds_per_day: i32,
    can_two_rounds: bool,
    monthly_contract_rounds: i32,
    desired_income: i32,
    rating_average: Option<f64>,
    rating_count: i64,
}

impl Caddie {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<String>,
        display_name: impl Into<String>,
        staff_id: Option<String>,
        active: bool,
        skill_level: CaddieSkillLevel,
        rank: CaddieRank,
        employment_status: impl Into<String>,
        base_fee_amount: i64,
        currency: impl Into<String>,
        max_rounds_per_day: i32,
        can_two_rounds: bool,
        monthly_contract_rounds: i32,
        desired_income: i32,
        rating_average: Option<f64>,
        rating_count: i64,
    ) -> Self {
        Self {
            id: id.into(),
            display_name: display_name.into(),
            staff_id: staff_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            active,
            skill_level,
            rank,
            employment_status: employment_status.into(),
            base_fee_amount: base_fee_amount.max(0),
            currency: {
                let value = currency.into();
                if value.trim().is_empty() {
                    "JPY".into()
                } else {
                    value
                }
            },
            max_rounds_per_day: max_rounds_per_day.max(1),
            can_two_rounds,
            monthly_contract_rounds: monthly_contract_rounds.max(0),
            desired_income: desired_income.max(0),
            rating_average,
            rating_count: rating_count.max(0),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn staff_id(&self) -> Option<&str> {
        self.staff_id.as_deref()
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn skill_level(&self) -> CaddieSkillLevel {
        self.skill_level
    }

    pub fn rank(&self) -> CaddieRank {
        self.rank
    }

    pub fn employment_status(&self) -> &str {
        &self.employment_status
    }

    pub fn base_fee_amount(&self) -> i64 {
        self.base_fee_amount
    }

    pub fn currency(&self) -> &str {
        &self.currency
    }

    pub fn max_rounds_per_day(&self) -> i32 {
        self.max_rounds_per_day
    }

    pub fn can_two_rounds(&self) -> bool {
        self.can_two_rounds
    }

    pub fn monthly_contract_rounds(&self) -> i32 {
        self.monthly_contract_rounds
    }

    pub fn desired_income(&self) -> i32 {
        self.desired_income
    }

    pub fn rating_average(&self) -> Option<f64> {
        self.rating_average
    }

    pub fn rating_count(&self) -> i64 {
        self.rating_count
    }

    /// Whether this caddie can accept a new assignment in the roster sense.
    pub fn is_assignable(&self) -> bool {
        self.active && self.employment_status.eq_ignore_ascii_case("active")
    }

    pub fn remaining_round_capacity(&self, assigned_rounds_today: i32) -> i32 {
        (self.max_rounds_per_day - assigned_rounds_today).max(0)
    }
}

/// Assignment of a caddie to a reservation / round.
#[derive(Debug, Clone, PartialEq)]
pub struct CaddieAssignment {
    id: String,
    caddie_id: String,
    reservation_id: Option<String>,
    round_reference: Option<String>,
    scheduled_at: DateTime<Utc>,
    duration_minutes: Option<i32>,
    status: AssignmentStatus,
    /// Original status token from the source system (for stable API responses).
    status_label: String,
    role: AssignmentRole,
    role_label: String,
    fee_amount: i64,
    fee_currency: String,
    notes: Option<String>,
}

impl CaddieAssignment {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<String>,
        caddie_id: impl Into<String>,
        reservation_id: Option<String>,
        round_reference: Option<String>,
        scheduled_at: DateTime<Utc>,
        duration_minutes: Option<i32>,
        status_label: impl Into<String>,
        role_label: impl Into<String>,
        fee_amount: i64,
        fee_currency: impl Into<String>,
        notes: Option<String>,
    ) -> Result<Self, CourseError> {
        let caddie_id = caddie_id.into();
        if caddie_id.trim().is_empty() {
            return Err(CourseError::BadRequest("caddie id is required"));
        }
        let status_label = status_label.into();
        let role_label = role_label.into();
        Ok(Self {
            id: id.into(),
            caddie_id,
            reservation_id: reservation_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            round_reference: round_reference
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            scheduled_at,
            duration_minutes: duration_minutes.filter(|value| *value > 0),
            status: AssignmentStatus::parse(status_label.as_str()),
            status_label,
            role: AssignmentRole::parse(role_label.as_str()),
            role_label,
            fee_amount: fee_amount.max(0),
            fee_currency: {
                let value = fee_currency.into();
                if value.trim().is_empty() {
                    "JPY".into()
                } else {
                    value
                }
            },
            notes,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn caddie_id(&self) -> &str {
        &self.caddie_id
    }

    pub fn reservation_id(&self) -> Option<&str> {
        self.reservation_id.as_deref()
    }

    pub fn round_reference(&self) -> Option<&str> {
        self.round_reference.as_deref()
    }

    pub fn scheduled_at(&self) -> DateTime<Utc> {
        self.scheduled_at
    }

    pub fn duration_minutes(&self) -> Option<i32> {
        self.duration_minutes
    }

    pub fn status(&self) -> AssignmentStatus {
        self.status
    }

    pub fn status_label(&self) -> &str {
        &self.status_label
    }

    pub fn role(&self) -> AssignmentRole {
        self.role
    }

    pub fn role_label(&self) -> &str {
        &self.role_label
    }

    pub fn fee_amount(&self) -> i64 {
        self.fee_amount
    }

    pub fn fee_currency(&self) -> &str {
        &self.fee_currency
    }

    pub fn notes(&self) -> Option<&str> {
        self.notes.as_deref()
    }

    /// Whether this assignment covers a specific reservation.
    pub fn covers_reservation(&self, reservation_id: &str) -> bool {
        self.reservation_id.as_deref() == Some(reservation_id)
    }

    pub fn is_linked_to_reservation(&self) -> bool {
        self.reservation_id.is_some()
    }

    pub fn is_active(&self) -> bool {
        self.status.is_active()
    }
}
