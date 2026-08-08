//! Course resource (physical tee / hole group linked to ERP reservation resources).

use derive_getters::Getters;

use super::{CourseId, ResourceId};

/// Kind of bookable golf resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceKind {
    Course,
    Tee,
    Other,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Course => "course",
            Self::Tee => "tee",
            Self::Other => "other",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "course" => Self::Course,
            "tee" => Self::Tee,
            _ => Self::Other,
        }
    }
}

/// The course ↔ reservation-resource mapping to write.
///
/// `resource_code` is the row's tenant-unique key on the Field side, so saving
/// the same code twice updates the mapping instead of adding a second one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveCourseResource {
    pub resource_code: String,
    pub name: String,
    pub golf_course_id: CourseId,
    pub reservation_resource_id: ResourceId,
}

/// A bookable resource belonging to (or representing) a golf course.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct Resource {
    #[getter(skip)]
    id: ResourceId,
    #[getter(skip)]
    name: String,
    #[getter(skip)]
    reservation_resource_id: Option<ResourceId>,
    #[getter(skip)]
    golf_course_id: Option<CourseId>,
    #[getter(copy)]
    kind: ResourceKind,
    #[getter(rename = "is_active")]
    active: bool,
}

impl Resource {
    pub fn reconstitute(
        id: impl Into<ResourceId>,
        name: impl Into<String>,
        reservation_resource_id: Option<String>,
        golf_course_id: Option<String>,
        kind: ResourceKind,
        active: bool,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            reservation_resource_id: ResourceId::from_optional(reservation_resource_id),
            golf_course_id: CourseId::from_optional(golf_course_id),
            kind,
            active,
        }
    }

    pub fn id(&self) -> &ResourceId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn reservation_resource_id(&self) -> Option<&ResourceId> {
        self.reservation_resource_id.as_ref()
    }

    pub fn golf_course_id(&self) -> Option<&CourseId> {
        self.golf_course_id.as_ref()
    }

    /// Whether this resource matches an ERP reservation resource id.
    pub fn matches_reservation_resource(&self, reservation_resource_id: &ResourceId) -> bool {
        &self.id == reservation_resource_id
            || self.reservation_resource_id.as_ref() == Some(reservation_resource_id)
    }

    /// Course id to attribute a reservation to when only a resource is known.
    ///
    /// When `golf_course_id` is absent, the resource id string is reused as a
    /// course key (legacy Field layouts where the resource row is the course).
    pub fn resolved_course_id(&self) -> CourseId {
        self.golf_course_id
            .clone()
            .unwrap_or_else(|| CourseId::new(self.id.as_str()))
    }
}
