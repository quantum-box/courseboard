//! Course resource (physical tee / hole group linked to ERP reservation resources).

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

/// A bookable resource belonging to (or representing) a golf course.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resource {
    id: String,
    name: String,
    reservation_resource_id: Option<String>,
    golf_course_id: Option<String>,
    kind: ResourceKind,
    active: bool,
}

impl Resource {
    pub fn reconstitute(
        id: impl Into<String>,
        name: impl Into<String>,
        reservation_resource_id: Option<String>,
        golf_course_id: Option<String>,
        kind: ResourceKind,
        active: bool,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            reservation_resource_id: reservation_resource_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            golf_course_id: golf_course_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            kind,
            active,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn reservation_resource_id(&self) -> Option<&str> {
        self.reservation_resource_id.as_deref()
    }

    pub fn golf_course_id(&self) -> Option<&str> {
        self.golf_course_id.as_deref()
    }

    pub fn kind(&self) -> ResourceKind {
        self.kind
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Whether this resource matches an ERP reservation resource id.
    pub fn matches_reservation_resource(&self, reservation_resource_id: &str) -> bool {
        self.id == reservation_resource_id
            || self.reservation_resource_id.as_deref() == Some(reservation_resource_id)
    }

    /// Course id to attribute a reservation to when only a resource is known.
    pub fn resolved_course_id(&self) -> &str {
        self.golf_course_id.as_deref().unwrap_or(self.id.as_str())
    }
}
