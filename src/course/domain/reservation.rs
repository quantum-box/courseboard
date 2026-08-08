//! Generic ERP reservation used when composing a tee sheet.
//!
//! This is not a Field DTO: gateway extracts golf-relevant fields before it enters
//! the domain.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use derive_getters::Getters;

use super::{CourseId, PartyDetails, ReservationId, ReservationServiceId, ResourceId};

/// Party reservation that may appear on a tee sheet.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct Reservation {
    #[getter(skip)]
    id: ReservationId,
    #[getter(skip)]
    reservation_number: String,
    #[getter(skip)]
    service_id: Option<ReservationServiceId>,
    #[getter(skip)]
    resource_id: Option<ResourceId>,
    #[getter(skip)]
    customer_name: Option<String>,
    #[getter(skip)]
    status: String,
    #[getter(copy)]
    starts_at: DateTime<Utc>,
    #[getter(copy)]
    ends_at: DateTime<Utc>,
    quantity: i32,
    #[getter(skip)]
    golf_course_id: Option<CourseId>,
    /// Group detail CourseBoard keeps in the reservation's custom fields.
    #[getter(skip)]
    party: PartyDetails,
    #[getter(skip)]
    notes: Option<String>,
}

impl Reservation {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<ReservationId>,
        reservation_number: impl Into<String>,
        service_id: Option<String>,
        resource_id: Option<String>,
        customer_name: Option<String>,
        status: impl Into<String>,
        starts_at: DateTime<Utc>,
        ends_at: DateTime<Utc>,
        quantity: i32,
        golf_course_id: Option<String>,
        notes: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            reservation_number: reservation_number.into(),
            service_id: ReservationServiceId::from_optional(service_id),
            resource_id: ResourceId::from_optional(resource_id),
            customer_name: customer_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            status: status.into(),
            starts_at,
            ends_at,
            quantity: quantity.max(1),
            golf_course_id: CourseId::from_optional(golf_course_id),
            party: PartyDetails::default(),
            notes,
        }
    }

    pub fn with_party(mut self, party: PartyDetails) -> Self {
        self.party = party;
        self
    }

    pub fn party(&self) -> &PartyDetails {
        &self.party
    }

    pub fn id(&self) -> &ReservationId {
        &self.id
    }

    pub fn reservation_number(&self) -> &str {
        &self.reservation_number
    }

    pub fn service_id(&self) -> Option<&ReservationServiceId> {
        self.service_id.as_ref()
    }

    pub fn resource_id(&self) -> Option<&ResourceId> {
        self.resource_id.as_ref()
    }

    pub fn customer_name(&self) -> Option<&str> {
        self.customer_name.as_deref()
    }

    pub fn status(&self) -> &str {
        &self.status
    }

    pub fn golf_course_id(&self) -> Option<&CourseId> {
        self.golf_course_id.as_ref()
    }

    pub fn notes(&self) -> Option<&str> {
        self.notes.as_deref()
    }

    pub fn party_size(&self) -> i32 {
        self.quantity.max(1)
    }

    pub fn party_display_name(&self) -> &str {
        self.customer_name.as_deref().unwrap_or("Guest")
    }

    /// Whether this reservation should appear on an operations tee sheet.
    pub fn is_tee_sheet_candidate(&self) -> bool {
        matches!(
            self.status.as_str(),
            "requested"
                | "payment_pending"
                | "confirmed"
                | "change_requested"
                | "admin_review"
                | "completed"
                | "no_show"
        )
    }

    /// Calendar date of the tee time in the provided fixed offset (e.g. JST).
    pub fn tee_date_in<Tz: TimeZone>(&self, tz: &Tz) -> NaiveDate {
        self.starts_at.with_timezone(tz).date_naive()
    }

    pub fn occurs_on_date<Tz: TimeZone>(&self, date: NaiveDate, tz: &Tz) -> bool {
        self.tee_date_in(tz) == date
    }

    pub fn duration_minutes_from_range(&self) -> Option<i32> {
        let minutes = (self.ends_at - self.starts_at).num_minutes();
        if minutes > 0 {
            Some(minutes.clamp(15, 24 * 60) as i32)
        } else {
            None
        }
    }
}

/// A booking the seed writes into Field.
///
/// Not a general reservation-create command: it carries only what a demo day
/// needs, and it carries `seed_key`, which is how a re-run finds the booking it
/// wrote last time instead of adding a second one beside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReservation {
    pub reservation_type_id: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub quantity: i32,
    pub customer_name: String,
    pub golf_course_id: CourseId,
    pub party: PartyDetails,
    pub seed_key: String,
}

/// A booking the seed already wrote, as found on a re-run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeededReservation {
    pub id: ReservationId,
    pub seed_key: String,
}
