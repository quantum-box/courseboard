//! Reservation product (play package sold on the tee sheet).

use super::course::HoleCount;
use super::{CourseError, CourseId, ProductId, ProductSlotId, ReservationServiceId, TenantId};
use derive_getters::Getters;

const MAX_DISPLAY_NAME_LENGTH: usize = 255;

/// Whether a product requires a caddie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlayType {
    Caddie,
    SelfPlay,
}

impl PlayType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Caddie => "caddie",
            Self::SelfPlay => "self",
        }
    }

    pub fn parse(raw: &str) -> Self {
        if raw.eq_ignore_ascii_case("caddie") {
            Self::Caddie
        } else {
            Self::SelfPlay
        }
    }

    pub fn requires_caddie(self) -> bool {
        matches!(self, Self::Caddie)
    }
}

/// Expected duration for a round, in minutes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DurationMinutes(i32);

impl DurationMinutes {
    pub fn try_new(value: i32) -> Result<Self, CourseError> {
        if (30..=720).contains(&value) {
            Ok(Self(value))
        } else {
            Err(CourseError::BadRequest(
                "expected duration must be between 30 and 720 minutes",
            ))
        }
    }

    pub fn from_raw(value: i32) -> Self {
        if value > 0 {
            Self(value)
        } else {
            Self(270)
        }
    }

    pub fn get(self) -> i32 {
        self.0
    }

    pub fn clamp_for_tee_sheet(self) -> i32 {
        self.0.clamp(15, 24 * 60)
    }
}

/// Command to upsert a reservation product for a service id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsertReservationProduct {
    pub reservation_service_id: ReservationServiceId,
    pub display_name: Option<String>,
    pub play_type: PlayType,
    pub hole_count: HoleCount,
    pub expected_duration_minutes: DurationMinutes,
    /// Players allowed in one group.
    ///
    /// Inventory counts groups, so party size is a condition of the plan rather
    /// than a quantity of stock. `None` falls back to the reservation policy.
    pub max_players_per_group: Option<i32>,
    /// Courses this plan is sold on.
    ///
    /// An empty list only comes from the legacy scalar input when it was
    /// absent. The canonical array input requires at least one course so an
    /// accidental empty selection can never mean "sell everywhere".
    pub golf_course_ids: Vec<CourseId>,
    legacy_course_id_input: bool,
}

impl UpsertReservationProduct {
    /// Compatibility constructor for the scalar request accepted by the
    /// currently deployed SPA.
    pub fn try_new(
        reservation_service_id: impl Into<String>,
        display_name: Option<String>,
        play_type: impl AsRef<str>,
        hole_count: i32,
        expected_duration_minutes: i32,
        golf_course_id: Option<String>,
        max_players_per_group: Option<i32>,
    ) -> Result<Self, CourseError> {
        let golf_course_ids = CourseId::from_optional(golf_course_id)
            .into_iter()
            .collect();
        Self::try_new_inner(
            reservation_service_id,
            display_name,
            play_type,
            hole_count,
            expected_duration_minutes,
            golf_course_ids,
            max_players_per_group,
            true,
        )
    }

    /// Canonical constructor for a product explicitly scoped to one or more
    /// courses.
    pub fn try_new_with_course_ids(
        reservation_service_id: impl Into<String>,
        display_name: Option<String>,
        play_type: impl AsRef<str>,
        hole_count: i32,
        expected_duration_minutes: i32,
        golf_course_ids: Vec<String>,
        max_players_per_group: Option<i32>,
    ) -> Result<Self, CourseError> {
        if golf_course_ids.is_empty() {
            return Err(CourseError::BadRequest(
                "golfCourseIds must contain at least one course",
            ));
        }
        let mut normalized = Vec::with_capacity(golf_course_ids.len());
        for course_id in golf_course_ids {
            let course_id = CourseId::try_new(course_id)?;
            if !normalized.contains(&course_id) {
                normalized.push(course_id);
            }
        }
        Self::try_new_inner(
            reservation_service_id,
            display_name,
            play_type,
            hole_count,
            expected_duration_minutes,
            normalized,
            max_players_per_group,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn try_new_inner(
        reservation_service_id: impl Into<String>,
        display_name: Option<String>,
        play_type: impl AsRef<str>,
        hole_count: i32,
        expected_duration_minutes: i32,
        golf_course_ids: Vec<CourseId>,
        max_players_per_group: Option<i32>,
        legacy_course_id_input: bool,
    ) -> Result<Self, CourseError> {
        let display_name = display_name
            .map(|value| value.trim().to_string())
            .map(|value| {
                if value.is_empty() {
                    return Err(CourseError::BadRequest("display name must not be empty"));
                }
                if value.chars().count() > MAX_DISPLAY_NAME_LENGTH {
                    return Err(CourseError::BadRequest(
                        "display name must be at most 255 characters",
                    ));
                }
                Ok(value)
            })
            .transpose()?;
        Ok(Self {
            reservation_service_id: ReservationServiceId::try_new(reservation_service_id)?,
            display_name,
            play_type: PlayType::parse(play_type.as_ref()),
            hole_count: HoleCount::try_new(hole_count).or_else(|_| {
                // Products historically allow non-9/18 in some tenants; accept positive.
                if hole_count > 0 {
                    Ok(HoleCount::from_raw(hole_count))
                } else {
                    Err(CourseError::BadRequest("hole count must be positive"))
                }
            })?,
            expected_duration_minutes: DurationMinutes::try_new(expected_duration_minutes)?,
            golf_course_ids,
            legacy_course_id_input,
            max_players_per_group: validate_group_size(max_players_per_group)?,
        })
    }

    pub fn golf_course_ids(&self) -> &[CourseId] {
        &self.golf_course_ids
    }

    pub fn golf_course_id(&self) -> Option<&CourseId> {
        (self.golf_course_ids.len() == 1).then(|| &self.golf_course_ids[0])
    }

    pub fn uses_legacy_course_id_input(&self) -> bool {
        self.legacy_course_id_input
    }
}

/// A group that holds nobody cannot be sold, and one that holds a busload is a
/// typo rather than a plan.
fn validate_group_size(value: Option<i32>) -> Result<Option<i32>, CourseError> {
    match value {
        None => Ok(None),
        Some(players) if (1..=99).contains(&players) => Ok(Some(players)),
        Some(_) => Err(CourseError::BadRequest(
            "players per group must be between 1 and 99",
        )),
    }
}

/// Sellable golf reservation product linked to an ERP reservation service.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct ReservationProduct {
    #[getter(skip)]
    id: ProductId,
    #[getter(skip)]
    tenant_id: Option<TenantId>,
    #[getter(skip)]
    reservation_service_id: ReservationServiceId,
    #[getter(skip)]
    display_name: Option<String>,
    #[getter(copy)]
    play_type: PlayType,
    #[getter(copy)]
    hole_count: HoleCount,
    #[getter(copy)]
    expected_duration_minutes: DurationMinutes,
    #[getter(skip)]
    golf_course_ids: Vec<CourseId>,
    /// True when a stored course constraint exists, including an empty or
    /// malformed canonical array. This keeps fail-closed data distinct from a
    /// product created before course scoping existed.
    #[getter(skip)]
    course_scope_declared: bool,
    #[getter(skip)]
    max_players_per_group: Option<i32>,
}

impl ReservationProduct {
    /// Rebuilds a stored product. One parameter per stored column is the point
    /// of a reconstitutor, so the argument count follows the row, not a limit.
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<ProductId>,
        tenant_id: Option<String>,
        reservation_service_id: impl Into<ReservationServiceId>,
        display_name: Option<String>,
        play_type: PlayType,
        hole_count: i32,
        expected_duration_minutes: i32,
        golf_course_id: Option<String>,
        max_players_per_group: Option<i32>,
    ) -> Self {
        let golf_course_ids: Vec<CourseId> = CourseId::from_optional(golf_course_id)
            .into_iter()
            .collect();
        let course_scope_declared = !golf_course_ids.is_empty();
        Self::reconstitute_inner(
            id,
            tenant_id,
            reservation_service_id,
            display_name,
            play_type,
            hole_count,
            expected_duration_minutes,
            golf_course_ids,
            course_scope_declared,
            max_players_per_group,
        )
    }

    /// Rebuilds the canonical array shape. Presence of the array declares a
    /// restriction even when malformed input decoded to an empty list.
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute_with_course_ids(
        id: impl Into<ProductId>,
        tenant_id: Option<String>,
        reservation_service_id: impl Into<ReservationServiceId>,
        display_name: Option<String>,
        play_type: PlayType,
        hole_count: i32,
        expected_duration_minutes: i32,
        golf_course_ids: Vec<String>,
        max_players_per_group: Option<i32>,
    ) -> Self {
        let mut normalized = Vec::with_capacity(golf_course_ids.len());
        for course_id in golf_course_ids {
            if let Some(course_id) = CourseId::from_optional(Some(course_id)) {
                if !normalized.contains(&course_id) {
                    normalized.push(course_id);
                }
            }
        }
        Self::reconstitute_inner(
            id,
            tenant_id,
            reservation_service_id,
            display_name,
            play_type,
            hole_count,
            expected_duration_minutes,
            normalized,
            true,
            max_players_per_group,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn reconstitute_inner(
        id: impl Into<ProductId>,
        tenant_id: Option<String>,
        reservation_service_id: impl Into<ReservationServiceId>,
        display_name: Option<String>,
        play_type: PlayType,
        hole_count: i32,
        expected_duration_minutes: i32,
        golf_course_ids: Vec<CourseId>,
        course_scope_declared: bool,
        max_players_per_group: Option<i32>,
    ) -> Self {
        Self {
            id: id.into(),
            tenant_id: TenantId::from_optional(tenant_id),
            reservation_service_id: reservation_service_id.into(),
            display_name: display_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            play_type,
            hole_count: HoleCount::from_raw(hole_count),
            expected_duration_minutes: DurationMinutes::from_raw(expected_duration_minutes),
            golf_course_ids,
            course_scope_declared,
            max_players_per_group: max_players_per_group.filter(|value| *value > 0),
        }
    }

    pub fn id(&self) -> &ProductId {
        &self.id
    }

    pub fn tenant_id(&self) -> Option<&TenantId> {
        self.tenant_id.as_ref()
    }

    pub fn reservation_service_id(&self) -> &ReservationServiceId {
        &self.reservation_service_id
    }

    pub fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }

    pub fn golf_course_id(&self) -> Option<&CourseId> {
        (self.golf_course_ids.len() == 1).then(|| &self.golf_course_ids[0])
    }

    pub fn golf_course_ids(&self) -> &[CourseId] {
        &self.golf_course_ids
    }

    /// Whether the product may be used on the selected course.
    ///
    /// Products from before course scoping remain unrestricted. Once either a
    /// scalar or canonical scope is declared, membership is required; an empty
    /// decoded canonical scope therefore fails closed.
    pub fn is_sold_on(&self, course_id: &CourseId) -> bool {
        !self.course_scope_declared || self.golf_course_ids.contains(course_id)
    }

    pub fn max_players_per_group(&self) -> Option<i32> {
        self.max_players_per_group
    }

    pub fn requires_caddie(&self) -> bool {
        self.play_type.requires_caddie()
    }

    /// Duration used when a reservation has no usable end time.
    pub fn fallback_duration_minutes(&self) -> i32 {
        self.expected_duration_minutes.get()
    }
}

/// Weekday-scoped acceptance slot for a reservation product.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct ProductSlot {
    #[getter(skip)]
    id: Option<ProductSlotId>,
    weekday: u8,
    #[getter(skip)]
    start_time: String,
    #[getter(skip)]
    end_time: String,
    max_groups: i32,
    max_players: i32,
}

impl ProductSlot {
    pub fn reconstitute(
        id: Option<String>,
        weekday: u8,
        start_time: impl Into<String>,
        end_time: impl Into<String>,
        max_groups: i32,
        max_players: i32,
    ) -> Result<Self, CourseError> {
        if weekday > 6 {
            return Err(CourseError::BadRequest("weekday must be 0..=6"));
        }
        Ok(Self {
            id: ProductSlotId::from_optional(id),
            weekday,
            start_time: start_time.into(),
            end_time: end_time.into(),
            max_groups: max_groups.max(0),
            max_players: max_players.max(0),
        })
    }

    pub fn id(&self) -> Option<&ProductSlotId> {
        self.id.as_ref()
    }

    pub fn start_time(&self) -> &str {
        &self.start_time
    }

    pub fn end_time(&self) -> &str {
        &self.end_time
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_product_normalizes_optional_display_name() {
        let input = UpsertReservationProduct::try_new(
            "service-1",
            Some("  平日プラン  ".into()),
            "caddie",
            18,
            240,
            None,
            None,
        )
        .expect("valid product");

        assert_eq!(input.display_name.as_deref(), Some("平日プラン"));
    }

    #[test]
    fn upsert_product_rejects_empty_or_too_long_display_name() {
        let empty = UpsertReservationProduct::try_new(
            "service-1",
            Some("  ".into()),
            "self",
            18,
            240,
            None,
            None,
        );
        assert!(matches!(
            empty,
            Err(CourseError::BadRequest("display name must not be empty"))
        ));

        let too_long = UpsertReservationProduct::try_new(
            "service-1",
            Some("あ".repeat(MAX_DISPLAY_NAME_LENGTH + 1)),
            "self",
            18,
            240,
            None,
            None,
        );
        assert!(matches!(
            too_long,
            Err(CourseError::BadRequest(
                "display name must be at most 255 characters"
            ))
        ));
    }

    #[test]
    fn reconstitute_treats_blank_display_name_as_missing() {
        let product = ReservationProduct::reconstitute(
            "product-1",
            None,
            "service-1",
            Some(" ".into()),
            PlayType::SelfPlay,
            18,
            240,
            None,
            None,
        );

        assert_eq!(product.display_name(), None);
    }
}
