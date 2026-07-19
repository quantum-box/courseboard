//! Generic ERP reservation used when composing a tee sheet.
//!
//! This is not a Field DTO: gateway extracts golf-relevant fields before it enters
//! the domain.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};

/// Party reservation that may appear on a tee sheet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reservation {
    id: String,
    reservation_number: String,
    service_id: Option<String>,
    resource_id: Option<String>,
    customer_name: Option<String>,
    status: String,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    quantity: i32,
    golf_course_id: Option<String>,
    notes: Option<String>,
}

impl Reservation {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<String>,
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
            service_id: service_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            resource_id: resource_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            customer_name: customer_name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            status: status.into(),
            starts_at,
            ends_at,
            quantity: quantity.max(1),
            golf_course_id: golf_course_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            notes,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn reservation_number(&self) -> &str {
        &self.reservation_number
    }

    pub fn service_id(&self) -> Option<&str> {
        self.service_id.as_deref()
    }

    pub fn resource_id(&self) -> Option<&str> {
        self.resource_id.as_deref()
    }

    pub fn customer_name(&self) -> Option<&str> {
        self.customer_name.as_deref()
    }

    pub fn status(&self) -> &str {
        &self.status
    }

    pub fn starts_at(&self) -> DateTime<Utc> {
        self.starts_at
    }

    pub fn ends_at(&self) -> DateTime<Utc> {
        self.ends_at
    }

    pub fn quantity(&self) -> i32 {
        self.quantity
    }

    pub fn golf_course_id(&self) -> Option<&str> {
        self.golf_course_id.as_deref()
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
