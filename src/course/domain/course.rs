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
    pub timezone: String,
    pub start_interval_minutes: StartIntervalMinutes,
    pub is_active: bool,
}

impl UpsertCourse {
    pub fn try_new(
        name: impl Into<String>,
        short_name: Option<String>,
        hole_count: i32,
        timezone: impl Into<String>,
        start_interval_minutes: i32,
        is_active: bool,
    ) -> Result<Self, CourseError> {
        let name = name.into();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CourseError::BadRequest("course name is required"));
        }
        let timezone = timezone.into();
        let tz = timezone.trim();
        if tz.is_empty() {
            return Err(CourseError::BadRequest("timezone is required"));
        }
        let short = short_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Ok(Self {
            name: trimmed.to_string(),
            short_name: short,
            hole_count: HoleCount::try_new(hole_count)?,
            timezone: tz.to_string(),
            start_interval_minutes: StartIntervalMinutes::try_new(start_interval_minutes)?,
            is_active,
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
