//! Caddie operations beyond roster/assignment listing:
//! memberships, availabilities, recommendations, attendance, supply,
//! auto-assign, payroll, and ratings.

use chrono::{DateTime, NaiveDate, Utc};
use derive_getters::Getters;

use super::{
    AssignmentId, AvailabilityId, Caddie, CaddieId, CaddiePlacement, CaddieRank, CaddieSkillLevel,
    CourseError, CourseId, MembershipId, RatingId, ReservationId,
};

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

    /// A caddie is a role a staff member holds, so a profile is only ever
    /// meaningful while linked. Creation resolves the link instead of demanding
    /// it up front; updates stay lenient so legacy unlinked profiles can still
    /// be edited.
    pub fn has_staff_link(&self) -> bool {
        self.staff_id.is_some() || self.staff_reference_id.is_some()
    }

    /// Attach the staff member this caddie is a role of.
    pub fn link_staff(&mut self, staff_id: impl Into<String>) {
        let staff_id = staff_id.into().trim().to_string();
        if staff_id.is_empty() {
            return;
        }
        self.staff_reference_type = Some(STAFF_MEMBER_REFERENCE_TYPE.to_string());
        self.staff_reference_id = Some(staff_id.clone());
        self.staff_id = Some(staff_id);
    }
}

/// Reference type Field uses for a caddie profile pointing at an HRM staff member.
const STAFF_MEMBER_REFERENCE_TYPE: &str = "staff_member";

/// Partial update for an existing caddie profile.
///
/// The gateway always sends a full body upstream, so anything left unset here
/// must be filled from the stored profile — otherwise fields the operator never
/// touched (rank, contract rounds) silently fall back to creation defaults.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CaddiePatch {
    pub display_name: Option<String>,
    pub skill_level: Option<String>,
    pub rank: Option<String>,
    pub base_fee_amount: Option<i64>,
    pub currency: Option<String>,
    pub staff_id: Option<String>,
    pub staff_reference_type: Option<String>,
    pub staff_reference_id: Option<String>,
    pub active: Option<bool>,
    pub employment_status: Option<String>,
    pub max_rounds_per_day: Option<i32>,
    pub monthly_contract_rounds: Option<i32>,
    pub can_two_rounds: Option<bool>,
    pub desired_income: Option<i32>,
}

impl CaddiePatch {
    /// Whether the body names every field, so no stored profile is needed to
    /// merge against. Lets the caller skip the roster round trip — which also
    /// keeps writes working when list GETs are opted out
    /// (`TACHYON_FIELD_API_URL=empty://…`).
    pub fn is_complete(&self) -> bool {
        self.display_name.is_some()
            && self.skill_level.is_some()
            && self.rank.is_some()
            && self.base_fee_amount.is_some()
            && self.currency.is_some()
            && self.active.is_some()
            && self.employment_status.is_some()
            && self.max_rounds_per_day.is_some()
            && self.monthly_contract_rounds.is_some()
            && self.can_two_rounds.is_some()
            && self.desired_income.is_some()
            && (self.staff_id.is_some() || self.staff_reference_id.is_some())
    }

    /// Only meaningful when [`Self::is_complete`] holds; anything still unset
    /// falls back to creation defaults.
    pub fn into_upsert(self) -> Result<UpsertCaddie, CourseError> {
        UpsertCaddie::try_new(
            self.display_name.unwrap_or_default(),
            self.skill_level.unwrap_or_default(),
            self.rank.unwrap_or_default(),
            self.base_fee_amount.unwrap_or_default(),
            self.currency,
            self.staff_id,
            self.staff_reference_type,
            self.staff_reference_id,
            self.active.unwrap_or_default(),
            self.employment_status,
            self.max_rounds_per_day,
            self.monthly_contract_rounds,
            self.can_two_rounds,
            self.desired_income,
        )
    }

    pub fn apply_to(self, current: &Caddie) -> Result<UpsertCaddie, CourseError> {
        // Echo back what upstream actually holds. `Caddie::display_name` is the
        // linked staff member's name and `Caddie::staff_id` merges staffId with
        // staffReferenceId, so falling back to either would rewrite the stored
        // profile — turning an untouched field into a silent overwrite.
        let upstream = current.upstream_identity();
        let staff_id = self.staff_id.or_else(|| upstream.staff_id.clone());
        let staff_reference_id = self
            .staff_reference_id
            .or_else(|| upstream.staff_reference_id.clone());
        let staff_reference_type = self
            .staff_reference_type
            .or_else(|| upstream.staff_reference_type.clone());

        // Retiring someone by employment status alone must not leave them
        // flagged active upstream.
        let employment_status = self
            .employment_status
            .unwrap_or_else(|| current.employment_status().to_string());
        let active = self
            .active
            .unwrap_or_else(|| employment_status.eq_ignore_ascii_case("active"));

        UpsertCaddie::try_new(
            self.display_name.unwrap_or_else(|| {
                upstream
                    .profile_display_name
                    .clone()
                    .unwrap_or_else(|| current.display_name().to_string())
            }),
            self.skill_level
                .unwrap_or_else(|| current.skill_level().as_str().to_string()),
            self.rank
                .unwrap_or_else(|| current.rank().as_str().to_string()),
            self.base_fee_amount.unwrap_or(current.base_fee_amount()),
            Some(
                self.currency
                    .unwrap_or_else(|| current.currency().to_string()),
            ),
            staff_id,
            staff_reference_type,
            staff_reference_id,
            active,
            Some(employment_status),
            Some(
                self.max_rounds_per_day
                    .unwrap_or(current.max_rounds_per_day()),
            ),
            Some(
                self.monthly_contract_rounds
                    .unwrap_or(current.monthly_contract_rounds()),
            ),
            Some(self.can_two_rounds.unwrap_or(current.can_two_rounds())),
            Some(self.desired_income.unwrap_or(current.desired_income())),
        )
    }
}

/// Input for creating or updating a caddie assignment.
#[derive(Debug, Clone, PartialEq)]
pub struct UpsertCaddieAssignment {
    pub caddie_id: CaddieId,
    pub reservation_id: Option<ReservationId>,
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
        Ok(Self {
            caddie_id: CaddieId::try_new(caddie_id)?,
            reservation_id: ReservationId::from_optional(reservation_id),
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
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct CaddieCourseMembership {
    #[getter(skip)]
    id: MembershipId,
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    golf_course_id: CourseId,
    is_primary: bool,
}

impl CaddieCourseMembership {
    pub fn id(&self) -> &MembershipId {
        &self.id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn golf_course_id(&self) -> &CourseId {
        &self.golf_course_id
    }

    pub fn reconstitute(
        id: impl Into<MembershipId>,
        caddie_id: impl Into<CaddieId>,
        golf_course_id: impl Into<CourseId>,
        is_primary: bool,
    ) -> Self {
        Self {
            id: id.into(),
            caddie_id: caddie_id.into(),
            golf_course_id: golf_course_id.into(),
            is_primary,
        }
    }
}

/// Replacement set for a caddie's course memberships.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplaceCaddieMemberships {
    pub course_ids: Vec<CourseId>,
    pub primary_course_id: Option<CourseId>,
}

impl ReplaceCaddieMemberships {
    pub fn try_new(
        course_ids: Vec<String>,
        primary_course_id: Option<String>,
    ) -> Result<Self, CourseError> {
        let course_ids: Vec<CourseId> = course_ids
            .into_iter()
            .filter_map(|value| CourseId::from_optional(Some(value)))
            .collect();
        let primary_course_id = CourseId::from_optional(primary_course_id);
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
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct CaddieAvailability {
    #[getter(skip)]
    id: AvailabilityId,
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(copy)]
    date: NaiveDate,
    #[getter(copy)]
    status: AvailabilityStatus,
    two_round_request: bool,
    #[getter(skip)]
    health_note: Option<String>,
    #[getter(copy)]
    updated_at: Option<DateTime<Utc>>,
}

impl CaddieAvailability {
    pub fn reconstitute(
        id: impl Into<AvailabilityId>,
        caddie_id: impl Into<CaddieId>,
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

    pub fn id(&self) -> &AvailabilityId {
        &self.id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn health_note(&self) -> Option<&str> {
        self.health_note.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpsertCaddieAvailability {
    pub caddie_id: CaddieId,
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
        Ok(Self {
            caddie_id: CaddieId::try_new(caddie_id)?,
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
    pub caddie_id: Option<CaddieId>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CaddieAssignmentQuery {
    pub caddie_id: Option<CaddieId>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// Only the assignments standing on one booking.
    ///
    /// Field accepts this filter upstream. Adapters still narrow the returned
    /// rows themselves so older Field deployments cannot leak other bookings.
    pub reservation_id: Option<ReservationId>,
}

/// Dispatch recommendation candidate.
#[derive(Debug, Clone, PartialEq, Getters)]
pub struct CaddieRecommendation {
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    display_name: String,
    #[getter(copy)]
    skill_level: CaddieSkillLevel,
    #[getter(copy)]
    rating_average: Option<f64>,
    rating_count: i64,
    rounds_assigned: i64,
    #[getter(copy)]
    remaining_rounds: Option<i64>,
    #[getter(skip)]
    attendance_status: Option<String>,
    /// Confirmed shift placement for the recommendation day.
    #[getter(skip)]
    placement: CaddiePlacement,
    recommendation_score: i32,
    #[getter(skip)]
    recommended_role: String,
    #[getter(skip)]
    pairing_display_name: Option<String>,
    #[getter(skip)]
    rationale: Vec<String>,
}

impl CaddieRecommendation {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        caddie_id: impl Into<CaddieId>,
        display_name: impl Into<String>,
        skill_level: CaddieSkillLevel,
        rating_average: Option<f64>,
        rating_count: i64,
        rounds_assigned: i64,
        remaining_rounds: Option<i64>,
        attendance_status: Option<String>,
        recommendation_score: i32,
        recommended_role: impl Into<String>,
        pairing_display_name: Option<String>,
        rationale: Vec<String>,
    ) -> Self {
        Self::reconstitute_with_placement(
            caddie_id,
            display_name,
            skill_level,
            rating_average,
            rating_count,
            rounds_assigned,
            remaining_rounds,
            attendance_status,
            recommendation_score,
            recommended_role,
            pairing_display_name,
            rationale,
            CaddiePlacement::Unconfirmed,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute_with_placement(
        caddie_id: impl Into<CaddieId>,
        display_name: impl Into<String>,
        skill_level: CaddieSkillLevel,
        rating_average: Option<f64>,
        rating_count: i64,
        rounds_assigned: i64,
        remaining_rounds: Option<i64>,
        attendance_status: Option<String>,
        recommendation_score: i32,
        recommended_role: impl Into<String>,
        pairing_display_name: Option<String>,
        rationale: Vec<String>,
        placement: CaddiePlacement,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            display_name: display_name.into(),
            skill_level,
            rating_average,
            rating_count: rating_count.max(0),
            rounds_assigned: rounds_assigned.max(0),
            remaining_rounds: remaining_rounds.map(|value| value.max(0)),
            attendance_status,
            placement,
            recommendation_score,
            recommended_role: recommended_role.into(),
            pairing_display_name,
            rationale,
        }
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn recommended_role(&self) -> &str {
        &self.recommended_role
    }

    pub fn attendance_status(&self) -> Option<&str> {
        self.attendance_status.as_deref()
    }

    pub fn placement(&self) -> &CaddiePlacement {
        &self.placement
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
    pub reservation_id: Option<ReservationId>,
    /// The course the round tees off from. Given, the candidates are the
    /// caddies confirmed onto that course for the day.
    pub golf_course_id: Option<CourseId>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub player_count: Option<i32>,
    pub include_rookie_pairing: bool,
    pub limit: Option<u32>,
}

/// Attendance snapshot row for an operation date.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AttendanceSnapshot {
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    display_name: String,
    #[getter(skip)]
    staff_id: Option<String>,
    #[getter(skip)]
    attendance_status: String,
    today_assignments: i64,
    rounds_without_clock_in_today: i64,
}

impl AttendanceSnapshot {
    pub fn reconstitute(
        caddie_id: impl Into<CaddieId>,
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

    pub fn caddie_id(&self) -> &CaddieId {
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

    pub fn is_working(&self) -> bool {
        self.attendance_status.eq_ignore_ascii_case("working")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AttendanceSnapshotReport {
    #[getter(copy)]
    date: NaiveDate,
    #[getter(skip)]
    items: Vec<AttendanceSnapshot>,
}

impl AttendanceSnapshotReport {
    pub fn items(&self) -> &[AttendanceSnapshot] {
        &self.items
    }

    pub fn new(date: NaiveDate, items: Vec<AttendanceSnapshot>) -> Self {
        Self { date, items }
    }
}

/// Attendance status for one caddie on one date within an inclusive period.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AttendancePeriodSnapshot {
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(copy)]
    date: NaiveDate,
    #[getter(skip)]
    attendance_status: String,
}

impl AttendancePeriodSnapshot {
    pub fn reconstitute(
        caddie_id: impl Into<CaddieId>,
        date: NaiveDate,
        attendance_status: impl Into<String>,
    ) -> Self {
        Self {
            caddie_id: caddie_id.into(),
            date,
            attendance_status: attendance_status.into(),
        }
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn attendance_status(&self) -> &str {
        &self.attendance_status
    }
}

/// Caddie-attached tee capacity derived from supply.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct CaddieSupply {
    #[getter(copy)]
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

    pub fn is_over_capacity(&self) -> bool {
        self.remaining < 0
    }
}

/// One caddie's inputs to the daily supply calculation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaddieDayCapacity {
    pub active: bool,
    /// Declared availability for the day. `None` means no declaration, which
    /// counts as fully available.
    pub status: Option<AvailabilityStatus>,
    pub can_two_rounds: bool,
    /// Whether the caddie asked for two rounds on this specific day.
    pub two_round_request: bool,
}

/// `(works, morning, afternoon, light_duty)` for a declared availability.
fn availability_flags(status: Option<AvailabilityStatus>) -> (bool, bool, bool, bool) {
    match status {
        Some(AvailabilityStatus::Unavailable) => (false, false, false, false),
        Some(AvailabilityStatus::MorningOnly) => (true, true, false, false),
        Some(AvailabilityStatus::AfternoonOnly) => (true, false, true, false),
        Some(AvailabilityStatus::LightDuty) => (true, true, true, true),
        // Available, or no declaration at all, which defaults to working.
        _ => (true, true, true, false),
    }
}

/// How many caddie-attached groups can safely be sold on `date`.
///
/// A caddie who can and wants to work two rounds counts as two groups. Light
/// duty never counts as two rounds even when the caddie asked for it.
pub fn compute_caddie_supply(
    date: NaiveDate,
    capacities: impl IntoIterator<Item = CaddieDayCapacity>,
    safety_buffer: i64,
    current_caddie_attached: i64,
) -> CaddieSupply {
    let safety_buffer = safety_buffer.max(0);
    let mut available_caddies = 0;
    let mut two_round_capable = 0;
    let mut caddie_supply = 0;
    let mut morning_capacity = 0;
    let mut afternoon_capacity = 0;

    for capacity in capacities {
        if !capacity.active {
            continue;
        }
        let (works, morning, afternoon, light_duty) = availability_flags(capacity.status);
        if !works {
            continue;
        }
        available_caddies += 1;
        if morning {
            morning_capacity += 1;
        }
        if afternoon {
            afternoon_capacity += 1;
        }
        let two_rounds = capacity.can_two_rounds && capacity.two_round_request && !light_duty;
        if two_rounds {
            two_round_capable += 1;
        }
        caddie_supply += if two_rounds { 2 } else { 1 };
    }

    let caddie_attached_cap = (caddie_supply - safety_buffer).max(0);
    CaddieSupply::reconstitute(
        date,
        available_caddies,
        two_round_capable,
        caddie_supply,
        morning_capacity,
        afternoon_capacity,
        safety_buffer,
        caddie_attached_cap,
        current_caddie_attached,
        caddie_attached_cap - current_caddie_attached,
    )
}

#[cfg(test)]
mod supply_tests {
    use super::*;

    fn capacity(
        active: bool,
        status: Option<AvailabilityStatus>,
        can_two_rounds: bool,
        two_round_request: bool,
    ) -> CaddieDayCapacity {
        CaddieDayCapacity {
            active,
            status,
            can_two_rounds,
            two_round_request,
        }
    }

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 25).expect("valid date")
    }

    #[test]
    fn counts_rounds_and_half_days() {
        let supply = compute_caddie_supply(
            date(),
            [
                capacity(true, Some(AvailabilityStatus::Available), true, true),
                capacity(true, Some(AvailabilityStatus::Available), true, false),
                capacity(true, Some(AvailabilityStatus::MorningOnly), false, false),
                capacity(true, Some(AvailabilityStatus::Unavailable), true, true),
                capacity(false, Some(AvailabilityStatus::Available), true, true),
                capacity(true, None, false, false),
            ],
            0,
            0,
        );

        assert_eq!(supply.available_caddies(), 4);
        assert_eq!(supply.two_round_capable(), 1);
        assert_eq!(supply.caddie_supply(), 5);
        assert_eq!(supply.morning_capacity(), 4);
        assert_eq!(supply.afternoon_capacity(), 3);
    }

    #[test]
    fn light_duty_never_counts_two_rounds() {
        let supply = compute_caddie_supply(
            date(),
            [capacity(
                true,
                Some(AvailabilityStatus::LightDuty),
                true,
                true,
            )],
            0,
            0,
        );
        assert_eq!(supply.two_round_capable(), 0);
        assert_eq!(supply.caddie_supply(), 1);
    }

    #[test]
    fn safety_buffer_lowers_the_cap_but_never_below_zero() {
        let supply = compute_caddie_supply(date(), [capacity(true, None, false, false)], 5, 0);
        assert_eq!(supply.safety_buffer(), 5);
        assert_eq!(supply.caddie_attached_cap(), 0);
        assert_eq!(supply.remaining(), 0);
    }

    #[test]
    fn remaining_goes_negative_when_bookings_exceed_the_cap() {
        let supply = compute_caddie_supply(
            date(),
            [
                capacity(true, None, false, false),
                capacity(true, None, false, false),
            ],
            0,
            3,
        );
        assert_eq!(supply.caddie_attached_cap(), 2);
        assert_eq!(supply.remaining(), -1);
        assert!(supply.is_over_capacity());
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AutoAssignPlanItem {
    #[getter(skip)]
    reservation_id: ReservationId,
    #[getter(copy)]
    scheduled_at: DateTime<Utc>,
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    caddie_display_name: String,
    #[getter(skip)]
    rationale: Vec<String>,
    /// Confirmed shift placement of the selected caddie.
    #[getter(skip)]
    placement: CaddiePlacement,
}

impl AutoAssignPlanItem {
    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn caddie_display_name(&self) -> &str {
        &self.caddie_display_name
    }

    pub fn rationale(&self) -> &[String] {
        &self.rationale
    }

    pub fn placement(&self) -> &CaddiePlacement {
        &self.placement
    }

    pub fn reconstitute(
        reservation_id: impl Into<ReservationId>,
        scheduled_at: DateTime<Utc>,
        caddie_id: impl Into<CaddieId>,
        caddie_display_name: impl Into<String>,
        rationale: Vec<String>,
    ) -> Self {
        Self::reconstitute_with_placement(
            reservation_id,
            scheduled_at,
            caddie_id,
            caddie_display_name,
            rationale,
            CaddiePlacement::Unconfirmed,
        )
    }

    pub fn reconstitute_with_placement(
        reservation_id: impl Into<ReservationId>,
        scheduled_at: DateTime<Utc>,
        caddie_id: impl Into<CaddieId>,
        caddie_display_name: impl Into<String>,
        rationale: Vec<String>,
        placement: CaddiePlacement,
    ) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            scheduled_at,
            caddie_id: caddie_id.into(),
            caddie_display_name: caddie_display_name.into(),
            rationale,
            placement,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AutoAssignSkippedItem {
    #[getter(skip)]
    reservation_id: ReservationId,
    #[getter(skip)]
    reason: String,
}

impl AutoAssignSkippedItem {
    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }

    pub fn reason(&self) -> &str {
        &self.reason
    }

    pub fn new(reservation_id: impl Into<ReservationId>, reason: impl Into<String>) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            reason: reason.into(),
        }
    }
}

/// Carried on an auto-assign result when the month's filing deadline has
/// passed and caddies remain who never filed a shift request for it.
///
/// This does not block the run — the desk may have already handled the gap by
/// phone — it only makes the gap visible instead of letting a silent
/// `Available` default speak for someone who was never asked.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct DeadlineWarning {
    #[getter(copy)]
    deadline_date: NaiveDate,
    #[getter(skip)]
    unsubmitted_caddie_names: Vec<String>,
}

impl DeadlineWarning {
    pub fn new(deadline_date: NaiveDate, unsubmitted_caddie_names: Vec<String>) -> Self {
        Self {
            deadline_date,
            unsubmitted_caddie_names,
        }
    }

    pub fn unsubmitted_caddie_names(&self) -> &[String] {
        &self.unsubmitted_caddie_names
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct AutoAssignResult {
    dry_run: bool,
    #[getter(skip)]
    assigned: Vec<AutoAssignPlanItem>,
    #[getter(skip)]
    skipped: Vec<AutoAssignSkippedItem>,
    #[getter(skip)]
    deadline_warning: Option<DeadlineWarning>,
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
            deadline_warning: None,
        }
    }

    pub fn with_deadline_warning(mut self, deadline_warning: Option<DeadlineWarning>) -> Self {
        self.deadline_warning = deadline_warning;
        self
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

    pub fn deadline_warning(&self) -> Option<&DeadlineWarning> {
        self.deadline_warning.as_ref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct PayrollPeriod {
    #[getter(skip)]
    year_month: String,
    #[getter(copy)]
    start_date: NaiveDate,
    #[getter(copy)]
    end_date: NaiveDate,
}

impl PayrollPeriod {
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

    /// The whole calendar month named by `YYYY-MM`, first day to last.
    ///
    /// The end is found by stepping to the first of the next month and back a
    /// day, so it does not depend on the month's length or on a leap year.
    pub fn try_new(year_month: &str) -> Result<Self, CourseError> {
        const MALFORMED: CourseError =
            CourseError::BadRequest("yearMonth must be a calendar month written as YYYY-MM");
        let (year, month) = year_month.split_once('-').ok_or(MALFORMED)?;
        if year.len() != 4 || month.len() != 2 {
            return Err(MALFORMED);
        }
        let year: i32 = year.parse().map_err(|_| MALFORMED)?;
        let month: u32 = month.parse().map_err(|_| MALFORMED)?;
        let start = NaiveDate::from_ymd_opt(year, month, 1).ok_or(MALFORMED)?;
        let next = if month == 12 {
            NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(year, month + 1, 1)
        }
        .ok_or(MALFORMED)?;
        Ok(Self::new(
            year_month,
            start,
            next.pred_opt().ok_or(MALFORMED)?,
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Getters)]
pub struct PayrollRow {
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    display_name: String,
    #[getter(skip)]
    staff_id: Option<String>,
    worked_minutes: i64,
    shifted_minutes: i64,
    assigned_rounds: i64,
    /// The rank the fee was read off, so the sheet can be checked by hand.
    #[getter(copy)]
    rank: CaddieRank,
    /// What one round pays this caddie.
    round_fee: i64,
    /// True when the amount came from the caddie's own fee rather than the
    /// rank table — the one case where two caddies of the same rank differ.
    fee_overridden: bool,
    /// `round_fee` × the rounds that were worked.
    fee_total: i64,
    #[getter(skip)]
    currency: String,
    open_clock_in: bool,
    rounds_without_clock_in: i64,
}

impl PayrollRow {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        caddie_id: impl Into<CaddieId>,
        display_name: impl Into<String>,
        staff_id: Option<String>,
        worked_minutes: i64,
        shifted_minutes: i64,
        assigned_rounds: i64,
        rank: CaddieRank,
        round_fee: i64,
        fee_overridden: bool,
        currency: impl Into<String>,
        open_clock_in: bool,
        rounds_without_clock_in: i64,
    ) -> Self {
        let assigned_rounds = assigned_rounds.max(0);
        let round_fee = round_fee.max(0);
        Self {
            caddie_id: caddie_id.into(),
            display_name: display_name.into(),
            staff_id,
            worked_minutes: worked_minutes.max(0),
            shifted_minutes: shifted_minutes.max(0),
            assigned_rounds,
            rank,
            round_fee,
            fee_overridden,
            fee_total: round_fee * assigned_rounds,
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

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn staff_id(&self) -> Option<&str> {
        self.staff_id.as_deref()
    }

    pub fn currency(&self) -> &str {
        &self.currency
    }
}

#[derive(Debug, Clone, PartialEq, Getters)]
pub struct PayrollSummary {
    period: PayrollPeriod,
    #[getter(skip)]
    items: Vec<PayrollRow>,
}

impl PayrollSummary {
    pub fn new(period: PayrollPeriod, items: Vec<PayrollRow>) -> Self {
        Self { period, items }
    }

    pub fn items(&self) -> &[PayrollRow] {
        &self.items
    }

    pub fn total_confirmed_fees(&self) -> i64 {
        self.items.iter().map(PayrollRow::fee_total).sum()
    }
}

#[derive(Debug, Clone, PartialEq, Getters)]
pub struct CaddieRating {
    #[getter(skip)]
    id: RatingId,
    #[getter(skip)]
    caddie_id: CaddieId,
    #[getter(skip)]
    assignment_id: Option<AssignmentId>,
    #[getter(skip)]
    reservation_id: Option<ReservationId>,
    #[getter(skip)]
    customer_id: String,
    score: i32,
    #[getter(skip)]
    comment: Option<String>,
    #[getter(copy)]
    created_at: Option<DateTime<Utc>>,
}

impl CaddieRating {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<RatingId>,
        caddie_id: impl Into<CaddieId>,
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
            assignment_id: AssignmentId::from_optional(assignment_id),
            reservation_id: ReservationId::from_optional(reservation_id),
            customer_id: customer_id.into(),
            score,
            comment,
            created_at,
        })
    }

    pub fn id(&self) -> &RatingId {
        &self.id
    }

    pub fn caddie_id(&self) -> &CaddieId {
        &self.caddie_id
    }

    pub fn assignment_id(&self) -> Option<&AssignmentId> {
        self.assignment_id.as_ref()
    }

    pub fn reservation_id(&self) -> Option<&ReservationId> {
        self.reservation_id.as_ref()
    }

    pub fn customer_id(&self) -> &str {
        &self.customer_id
    }

    pub fn comment(&self) -> Option<&str> {
        self.comment.as_deref()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_payroll_period_covers_the_month_it_names() {
        let july = PayrollPeriod::try_new("2026-07").expect("period");
        assert_eq!(july.start_date().to_string(), "2026-07-01");
        assert_eq!(july.end_date().to_string(), "2026-07-31");
    }

    #[test]
    fn a_short_month_ends_on_its_own_last_day() {
        // Stepping back from the first of the next month, so neither the
        // month's length nor a leap year has to be special-cased.
        assert_eq!(
            PayrollPeriod::try_new("2026-02")
                .expect("period")
                .end_date()
                .to_string(),
            "2026-02-28"
        );
        assert_eq!(
            PayrollPeriod::try_new("2028-02")
                .expect("period")
                .end_date()
                .to_string(),
            "2028-02-29"
        );
        assert_eq!(
            PayrollPeriod::try_new("2026-12")
                .expect("period")
                .end_date()
                .to_string(),
            "2026-12-31"
        );
    }

    #[test]
    fn something_that_is_not_a_month_is_refused_rather_than_guessed() {
        for value in ["2026-13", "2026-00", "26-07", "2026-7", "2026", "", "july"] {
            assert!(
                PayrollPeriod::try_new(value).is_err(),
                "{value} must not be read as a month"
            );
        }
    }

    use super::*;
    use crate::course::domain::CaddieUpstreamIdentity;

    fn upsert(staff_id: Option<&str>, staff_reference_id: Option<&str>) -> UpsertCaddie {
        UpsertCaddie::try_new(
            "山田 花子",
            "regular",
            "C",
            12_000,
            None,
            staff_id.map(String::from),
            staff_id.map(|_| "staff_member".to_string()),
            staff_reference_id.map(String::from),
            true,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("valid upsert input")
    }

    #[test]
    fn has_staff_link_accepts_staff_id() {
        assert!(upsert(Some("staff_001"), Some("staff_001")).has_staff_link());
    }

    #[test]
    fn has_staff_link_accepts_reference_only() {
        assert!(upsert(None, Some("staff_001")).has_staff_link());
    }

    #[test]
    fn has_staff_link_reports_an_unlinked_input() {
        assert!(!upsert(None, None).has_staff_link());
    }

    #[test]
    fn has_staff_link_treats_a_blank_staff_id_as_unlinked() {
        // try_new normalizes whitespace-only ids to None.
        assert!(!upsert(Some("  "), Some("  ")).has_staff_link());
    }

    #[test]
    fn link_staff_fills_both_the_id_and_the_reference() {
        // Field reads `staffId` on some surfaces and the reference pair on
        // others, so a half-filled link would show up as unlinked somewhere.
        let mut input = upsert(None, None);
        input.link_staff(" staff_001 ");

        assert_eq!(input.staff_id.as_deref(), Some("staff_001"));
        assert_eq!(input.staff_reference_type.as_deref(), Some("staff_member"));
        assert_eq!(input.staff_reference_id.as_deref(), Some("staff_001"));
    }

    #[test]
    fn link_staff_ignores_a_blank_id() {
        let mut input = upsert(None, None);
        input.link_staff("   ");

        assert!(!input.has_staff_link());
    }

    /// Mirrors what the gateway produces for a profile that Field stores with a
    /// `staffReferenceId`-only link: the merged view differs from the raw one.
    fn stored_caddie() -> Caddie {
        stored_caddie_with(CaddieUpstreamIdentity {
            profile_display_name: Some("プロフィール名".into()),
            staff_id: None,
            staff_reference_type: Some("erp_staff".into()),
            staff_reference_id: Some("staff_001".into()),
        })
    }

    fn stored_caddie_with(upstream: CaddieUpstreamIdentity) -> Caddie {
        Caddie::reconstitute(
            "golfcad_1",
            // The gateway substitutes the linked staff member's name here.
            "山田 花子",
            Some("staff_001".into()),
            true,
            CaddieSkillLevel::Veteran,
            CaddieRank::A,
            "active",
            12_000,
            "JPY",
            2,
            true,
            41,
            500_000,
            Some(4.8),
            42,
        )
        .with_upstream_identity(upstream)
    }

    #[test]
    fn patch_keeps_untouched_fields() {
        let patched = CaddiePatch {
            max_rounds_per_day: Some(1),
            ..CaddiePatch::default()
        }
        .apply_to(&stored_caddie())
        .expect("apply patch");

        assert_eq!(patched.max_rounds_per_day, 1);
        // Regression: these used to fall back to creation defaults, silently
        // rewriting a caddie's rank on every unrelated edit.
        assert_eq!(patched.rank, CaddieRank::A);
        assert_eq!(patched.monthly_contract_rounds, Some(41));
        assert_eq!(patched.can_two_rounds, Some(true));
        assert_eq!(patched.desired_income, Some(500_000));
        assert_eq!(patched.skill_level, CaddieSkillLevel::Veteran);
        assert_eq!(patched.employment_status, "active");
        assert_eq!(patched.base_fee_amount, 12_000);
    }

    #[test]
    fn patch_keeps_the_stored_profile_name_not_the_staff_name() {
        let patched = CaddiePatch::default()
            .apply_to(&stored_caddie())
            .expect("apply patch");

        // Echoing the merged view back would overwrite the profile's own name
        // with the linked staff member's name, permanently.
        assert_eq!(patched.display_name, "プロフィール名");
    }

    #[test]
    fn patch_preserves_the_upstream_staff_reference_shape() {
        let patched = CaddiePatch::default()
            .apply_to(&stored_caddie())
            .expect("apply patch");

        // `Caddie::staff_id` merges staffId with staffReferenceId, so echoing it
        // would promote a reference into staffId and invent a reference type.
        assert_eq!(patched.staff_id, None);
        assert_eq!(patched.staff_reference_id.as_deref(), Some("staff_001"));
        assert_eq!(patched.staff_reference_type.as_deref(), Some("erp_staff"));
    }

    #[test]
    fn patch_keeps_a_direct_staff_link_direct() {
        let caddie = stored_caddie_with(CaddieUpstreamIdentity {
            profile_display_name: Some("プロフィール名".into()),
            staff_id: Some("staff_001".into()),
            staff_reference_type: Some("staff_member".into()),
            staff_reference_id: Some("staff_001".into()),
        });
        let patched = CaddiePatch::default()
            .apply_to(&caddie)
            .expect("apply patch");

        assert_eq!(patched.staff_id.as_deref(), Some("staff_001"));
        assert_eq!(
            patched.staff_reference_type.as_deref(),
            Some("staff_member")
        );
    }

    #[test]
    fn patch_applies_provided_fields() {
        let patched = CaddiePatch {
            rank: Some("D".into()),
            employment_status: Some("suspended".into()),
            ..CaddiePatch::default()
        }
        .apply_to(&stored_caddie())
        .expect("apply patch");

        assert_eq!(patched.rank, CaddieRank::D);
        assert_eq!(patched.employment_status, "suspended");
        // Retiring by status alone must not leave the profile flagged active.
        assert!(!patched.active);
    }

    #[test]
    fn patch_respects_an_explicit_active_flag() {
        let patched = CaddiePatch {
            employment_status: Some("suspended".into()),
            active: Some(true),
            ..CaddiePatch::default()
        }
        .apply_to(&stored_caddie())
        .expect("apply patch");

        assert!(patched.active);
    }
}
