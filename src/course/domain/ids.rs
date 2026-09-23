//! Typed opaque identifiers for the course domain.
//!
//! IDs are string newtypes so aggregate identities compare with `Eq`/`PartialEq`
//! without mixing unrelated string fields. HTTP/JSON edges may still use `String`
//! and parse into these value objects at the boundary.

use std::fmt;

use super::CourseError;

macro_rules! define_string_id {
    ($(#[$meta:meta])* $name:ident, $label:literal) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            /// Construct without validation (gateway reconstitution of trusted data).
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            /// Construct from a caller-supplied value; rejects empty/whitespace-only.
            pub fn try_new(value: impl Into<String>) -> Result<Self, CourseError> {
                let value = value.into();
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    return Err(CourseError::BadRequest(concat!($label, " is required")));
                }
                if trimmed.len() == value.len() && trimmed == value {
                    Ok(Self(value))
                } else {
                    Ok(Self(trimmed.to_string()))
                }
            }

            /// Optional id from an external payload; empty becomes `None`.
            pub fn from_optional(value: Option<impl Into<String>>) -> Option<Self> {
                value
                    .map(Into::into)
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .map(Self)
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub fn into_inner(self) -> String {
                self.0
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl std::borrow::Borrow<str> for $name {
            fn borrow(&self) -> &str {
                &self.0
            }
        }

        impl std::ops::Deref for $name {
            type Target = str;

            fn deref(&self) -> &Self::Target {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_string())
            }
        }

        impl From<&$name> for $name {
            fn from(value: &$name) -> Self {
                value.clone()
            }
        }

        impl PartialEq<str> for $name {
            fn eq(&self, other: &str) -> bool {
                self.0 == other
            }
        }

        impl PartialEq<&str> for $name {
            fn eq(&self, other: &&str) -> bool {
                self.0 == *other
            }
        }

        impl PartialEq<$name> for str {
            fn eq(&self, other: &$name) -> bool {
                self == other.0.as_str()
            }
        }

        impl PartialEq<$name> for &str {
            fn eq(&self, other: &$name) -> bool {
                *self == other.0.as_str()
            }
        }
    };
}

define_string_id!(
    /// Identity of a golf course master record.
    CourseId,
    "course id"
);
define_string_id!(
    /// Identity of a caddie profile.
    CaddieId,
    "caddie id"
);
define_string_id!(
    /// Identity of an ERP / Field reservation.
    ReservationId,
    "reservation id"
);
define_string_id!(
    /// Identity of a reservation product (play package).
    ProductId,
    "product id"
);
define_string_id!(
    /// Identity of a bookable golf resource (tee / course resource).
    ResourceId,
    "resource id"
);
define_string_id!(
    /// Identity of a caddie-to-reservation assignment.
    AssignmentId,
    "assignment id"
);
define_string_id!(
    /// Tenant scope identifier.
    TenantId,
    "tenant id"
);
define_string_id!(
    /// ERP reservation service id linked to a golf product.
    ReservationServiceId,
    "reservation service id"
);
define_string_id!(
    /// Identity of a daily budget row.
    BudgetId,
    "budget id"
);
define_string_id!(
    /// Identity of a caddie course-membership row.
    MembershipId,
    "membership id"
);
define_string_id!(
    /// Identity of a caddie availability row.
    AvailabilityId,
    "availability id"
);
define_string_id!(
    /// Identity of a caddie rating row.
    RatingId,
    "rating id"
);
define_string_id!(
    /// Identity of a product acceptance slot.
    ProductSlotId,
    "product slot id"
);
define_string_id!(
    /// Identity of a membership plan a course sells (正会員, 平日会員, …).
    ///
    /// Distinct from `MembershipId`, which is a caddie's membership of a course
    /// — an unrelated relation that happens to share the English word.
    MembershipPlanId,
    "membership plan id"
);
define_string_id!(
    /// Identity of a customer in Field's ledger.
    ///
    /// Members and visitors share one identifier space: whether someone is a
    /// member is a membership assignment they hold, not a different kind of
    /// record.
    CustomerId,
    "customer id"
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_ids_compare_by_value() {
        let a = CourseId::new("course_1");
        let b = CourseId::new("course_1");
        let c = CourseId::new("course_2");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a, "course_1");
        assert_eq!("course_1", a);
    }

    #[test]
    fn try_new_rejects_blank() {
        assert!(CourseId::try_new("  ").is_err());
        assert!(CaddieId::try_new("").is_err());
    }

    #[test]
    fn distinct_id_types_are_not_interchangeable() {
        let course = CourseId::new("same");
        let caddie = CaddieId::new("same");
        assert_eq!(course.as_str(), caddie.as_str());
        // Compile-time: CourseId and CaddieId cannot be compared directly.
        assert_ne!(course.as_str(), "other");
    }
}
