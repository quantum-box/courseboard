//! Caddie roster and assignment aggregates.

use chrono::{DateTime, Utc};
use derive_getters::Getters;

use super::{AssignmentId, CaddieId, CourseError, ReservationId};

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
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct Caddie {
    #[getter(skip)]
    id: CaddieId,
    #[getter(skip)]
    display_name: String,
    #[getter(skip)]
    staff_id: Option<String>,
    #[getter(rename = "is_active")]
    active: bool,
    #[getter(copy)]
    skill_level: CaddieSkillLevel,
    #[getter(copy)]
    rank: CaddieRank,
    #[getter(skip)]
    employment_status: String,
    base_fee_amount: i64,
    #[getter(skip)]
    currency: String,
    max_rounds_per_day: i32,
    can_two_rounds: bool,
    monthly_contract_rounds: i32,
    desired_income: i32,
    #[getter(copy)]
    rating_average: Option<f64>,
    rating_count: i64,
}

impl Caddie {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<CaddieId>,
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

    pub fn id(&self) -> &CaddieId {
        &self.id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn staff_id(&self) -> Option<&str> {
        self.staff_id.as_deref()
    }

    pub fn employment_status(&self) -> &str {
        &self.employment_status
    }

    pub fn currency(&self) -> &str {
        &self.currency
    }

    /// Whether this caddie can accept a new assignment in the roster sense.
    pub fn is_assignable(&self) -> bool {
        self.active && self.employment_status.eq_ignore_ascii_case("active")
    }

    pub fn remaining_round_capacity(&self, assigned_rounds_today: i32) -> i32 {
        (self.max_rounds_per_day - assigned_rounds_today).max(0)
    }
}

/// Minimal HRM staff data bundled with the caddie roster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieStaff {
    id: String,
    name: String,
    active: bool,
}

impl CaddieStaff {
    pub fn new(id: impl Into<String>, name: impl Into<String>, active: bool) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            active,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn is_active(&self) -> bool {
        self.active
    }
}

/// Caddie profiles and the HRM staff index used to resolve their names.
#[derive(Debug, Clone, PartialEq)]
pub struct CaddieRoster {
    caddies: Vec<Caddie>,
    staff: Vec<CaddieStaff>,
}

impl CaddieRoster {
    pub fn new(caddies: Vec<Caddie>, staff: Vec<CaddieStaff>) -> Self {
        Self { caddies, staff }
    }

    pub fn caddies(&self) -> &[Caddie] {
        &self.caddies
    }

    pub fn staff(&self) -> &[CaddieStaff] {
        &self.staff
    }
}

/// Assignment of a caddie to a reservation / round.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct CaddieAssignment {
    #[getter(skip)]
    id: AssignmentId,
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    reservation_id: Option<ReservationId>,
    #[getter(skip)]
    round_reference: Option<String>,
    #[getter(copy)]
    scheduled_at: DateTime<Utc>,
    #[getter(copy)]
    duration_minutes: Option<i32>,
    #[getter(copy)]
    status: AssignmentStatus,
    /// Original status token from the source system (for stable API responses).
    #[getter(skip)]
    status_label: String,
    #[getter(copy)]
    role: AssignmentRole,
    #[getter(skip)]
    role_label: String,
    fee_amount: i64,
    #[getter(skip)]
    fee_currency: String,
    #[getter(skip)]
    notes: Option<String>,
}

impl CaddieAssignment {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<AssignmentId>,
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
        let caddie_id = CaddieId::try_new(caddie_id)?;
        let status_label = status_label.into();
        let role_label = role_label.into();
        Ok(Self {
            id: id.into(),
            caddie_id,
            reservation_id: ReservationId::from_optional(reservation_id),
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

    pub fn id(&self) -> &AssignmentId {
        &self.id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn reservation_id(&self) -> Option<&ReservationId> {
        self.reservation_id.as_ref()
    }

    pub fn round_reference(&self) -> Option<&str> {
        self.round_reference.as_deref()
    }

    pub fn status_label(&self) -> &str {
        &self.status_label
    }

    pub fn role_label(&self) -> &str {
        &self.role_label
    }

    pub fn fee_currency(&self) -> &str {
        &self.fee_currency
    }

    pub fn notes(&self) -> Option<&str> {
        self.notes.as_deref()
    }

    /// Whether this assignment covers a specific reservation.
    pub fn covers_reservation(&self, reservation_id: &ReservationId) -> bool {
        self.reservation_id.as_ref() == Some(reservation_id)
    }

    pub fn is_linked_to_reservation(&self) -> bool {
        self.reservation_id.is_some()
    }

    pub fn is_active(&self) -> bool {
        self.status.is_active()
    }
}
