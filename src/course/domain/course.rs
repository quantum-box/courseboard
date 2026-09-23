//! Golf course aggregate (tenant course master).

use chrono::{DateTime, Utc};
use derive_getters::Getters;

use super::{CourseError, CourseId};

/// Number of holes offered by a course or product.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HoleCount(i32);

impl HoleCount {
    pub const NINE: Self = Self(9);
    pub const EIGHTEEN: Self = Self(18);

    /// Strict constructor used when creating/updating course master data.
    pub fn try_new(value: i32) -> Result<Self, CourseError> {
        if value == 9 || value == 18 {
            Ok(Self(value))
        } else {
            Err(CourseError::BadRequest("hole count must be 9 or 18"))
        }
    }

    /// Lenient reconstitution from an external catalog that may carry other values.
    pub fn from_raw(value: i32) -> Self {
        if value > 0 {
            Self(value)
        } else {
            Self::EIGHTEEN
        }
    }

    pub fn get(self) -> i32 {
        self.0
    }
}

/// Minutes between tee starts on a course.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartIntervalMinutes(i32);

impl StartIntervalMinutes {
    pub fn try_new(value: i32) -> Result<Self, CourseError> {
        if (1..=60).contains(&value) {
            Ok(Self(value))
        } else {
            Err(CourseError::BadRequest(
                "start interval must be between 1 and 60 minutes",
            ))
        }
    }

    pub fn from_raw(value: i32) -> Self {
        if (1..=60).contains(&value) {
            Self(value)
        } else {
            Self(10)
        }
    }

    pub fn get(self) -> i32 {
        self.0
    }
}

/// Command to create or update a course.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsertCourse {
    pub name: String,
    pub short_name: Option<String>,
    pub hole_count: HoleCount,
    pub start_interval_minutes: StartIntervalMinutes,
    pub is_active: bool,
    /// When the course starts and stops sending groups out.
    ///
    /// Optional because it was not settable before this field existed, and a
    /// course saved without it must not have its hours wiped. The ledger draws
    /// its rows from these when no inventory has been generated, so a course
    /// with none gets a board built only from its bookings.
    pub business_hours: Option<BusinessHours>,
}

/// A course's opening and closing wall clock, `HH:MM`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BusinessHours {
    open: String,
    close: String,
}

impl BusinessHours {
    pub fn try_new(open: impl Into<String>, close: impl Into<String>) -> Result<Self, CourseError> {
        let open = normalize_clock(open.into())?;
        let close = normalize_clock(close.into())?;
        if open >= close {
            return Err(CourseError::BadRequest(
                "a course must close after it opens",
            ));
        }
        Ok(Self { open, close })
    }

    pub fn open(&self) -> &str {
        &self.open
    }

    pub fn close(&self) -> &str {
        &self.close
    }
}

/// `HH:MM`, accepting the `HH:MM:SS` Field may hand back.
fn normalize_clock(value: String) -> Result<String, CourseError> {
    let head: String = value.trim().chars().take(5).collect();
    let valid = head.len() == 5
        && head.as_bytes()[2] == b':'
        && head[..2].parse::<u8>().is_ok_and(|hour| hour <= 23)
        && head[3..].parse::<u8>().is_ok_and(|minute| minute <= 59);
    if !valid {
        return Err(CourseError::BadRequest(
            "opening hours must look like HH:MM",
        ));
    }
    Ok(head)
}

impl UpsertCourse {
    pub fn try_new(
        name: impl Into<String>,
        short_name: Option<String>,
        hole_count: i32,
        start_interval_minutes: i32,
        is_active: bool,
        business_hours: Option<BusinessHours>,
    ) -> Result<Self, CourseError> {
        let name = name.into();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CourseError::BadRequest("course name is required"));
        }
        let short = short_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Ok(Self {
            name: trimmed.to_string(),
            short_name: short,
            hole_count: HoleCount::try_new(hole_count)?,
            start_interval_minutes: StartIntervalMinutes::try_new(start_interval_minutes)?,
            is_active,
            business_hours,
        })
    }
}

/// Golf course master entity owned by course-api.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct Course {
    #[getter(skip)]
    id: CourseId,
    #[getter(skip)]
    name: String,
    #[getter(skip)]
    short_name: Option<String>,
    #[getter(copy)]
    hole_count: HoleCount,
    /// Legacy Field master value retained for rollback compatibility.
    ///
    /// SCC-6 makes tenant extension config the source of truth. This value may
    /// still be returned by Field, but business calculations must not read it.
    #[getter(skip)]
    timezone: String,
    #[getter(copy)]
    start_interval_minutes: StartIntervalMinutes,
    is_active: bool,
    #[getter(skip)]
    business_hours_open: Option<String>,
    #[getter(skip)]
    business_hours_close: Option<String>,
    #[getter(copy)]
    created_at: Option<DateTime<Utc>>,
    #[getter(copy)]
    updated_at: Option<DateTime<Utc>>,
}

impl Course {
    /// Reconstitute a course loaded from a gateway / store.
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<CourseId>,
        name: impl Into<String>,
        short_name: Option<String>,
        hole_count: i32,
        timezone: impl Into<String>,
        start_interval_minutes: i32,
        is_active: bool,
        business_hours_open: Option<String>,
        business_hours_close: Option<String>,
        created_at: Option<DateTime<Utc>>,
        updated_at: Option<DateTime<Utc>>,
    ) -> Self {
        let timezone = timezone.into();
        Self {
            id: id.into(),
            name: name.into(),
            short_name: short_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            hole_count: HoleCount::from_raw(hole_count),
            timezone: if timezone.trim().is_empty() {
                "Asia/Tokyo".into()
            } else {
                timezone
            },
            start_interval_minutes: StartIntervalMinutes::from_raw(start_interval_minutes),
            is_active,
            business_hours_open,
            business_hours_close,
            created_at,
            updated_at,
        }
    }

    pub fn id(&self) -> &CourseId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn short_name(&self) -> Option<&str> {
        self.short_name.as_deref()
    }

    pub fn timezone(&self) -> &str {
        &self.timezone
    }

    pub fn business_hours_open(&self) -> Option<&str> {
        self.business_hours_open.as_deref()
    }

    pub fn business_hours_close(&self) -> Option<&str> {
        self.business_hours_close.as_deref()
    }

    pub fn display_label(&self) -> &str {
        self.short_name.as_deref().unwrap_or(self.name.as_str())
    }
}
