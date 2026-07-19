//! Reservation product (play package sold on the tee sheet).

use super::course::HoleCount;
use super::CourseError;

/// Whether a product requires a caddie.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    pub reservation_service_id: String,
    pub play_type: PlayType,
    pub hole_count: HoleCount,
    pub expected_duration_minutes: DurationMinutes,
}

impl UpsertReservationProduct {
    pub fn try_new(
        reservation_service_id: impl Into<String>,
        play_type: impl AsRef<str>,
        hole_count: i32,
        expected_duration_minutes: i32,
    ) -> Result<Self, CourseError> {
        let service_id = reservation_service_id.into();
        let trimmed = service_id.trim();
        if trimmed.is_empty() {
            return Err(CourseError::BadRequest(
                "reservation service id is required",
            ));
        }
        Ok(Self {
            reservation_service_id: trimmed.to_string(),
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
        })
    }
}

/// Sellable golf reservation product linked to an ERP reservation service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationProduct {
    id: String,
    tenant_id: Option<String>,
    reservation_service_id: String,
    play_type: PlayType,
    hole_count: HoleCount,
    expected_duration_minutes: DurationMinutes,
}

impl ReservationProduct {
    pub fn reconstitute(
        id: impl Into<String>,
        tenant_id: Option<String>,
        reservation_service_id: impl Into<String>,
        play_type: PlayType,
        hole_count: i32,
        expected_duration_minutes: i32,
    ) -> Self {
        Self {
            id: id.into(),
            tenant_id: tenant_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            reservation_service_id: reservation_service_id.into(),
            play_type,
            hole_count: HoleCount::from_raw(hole_count),
            expected_duration_minutes: DurationMinutes::from_raw(expected_duration_minutes),
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }

    pub fn reservation_service_id(&self) -> &str {
        &self.reservation_service_id
    }

    pub fn play_type(&self) -> PlayType {
        self.play_type
    }

    pub fn hole_count(&self) -> HoleCount {
        self.hole_count
    }

    pub fn expected_duration_minutes(&self) -> DurationMinutes {
        self.expected_duration_minutes
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductSlot {
    id: Option<String>,
    weekday: u8,
    start_time: String,
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
            id,
            weekday,
            start_time: start_time.into(),
            end_time: end_time.into(),
            max_groups: max_groups.max(0),
            max_players: max_players.max(0),
        })
    }

    pub fn id(&self) -> Option<&str> {
        self.id.as_deref()
    }

    pub fn weekday(&self) -> u8 {
        self.weekday
    }

    pub fn start_time(&self) -> &str {
        &self.start_time
    }

    pub fn end_time(&self) -> &str {
        &self.end_time
    }

    pub fn max_groups(&self) -> i32 {
        self.max_groups
    }

    pub fn max_players(&self) -> i32 {
        self.max_players
    }
}
