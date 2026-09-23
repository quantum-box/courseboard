//! How a ledger entry came to exist.
//!
//! Field owns the customer; it does not own the act of writing one down. That
//! act is reception work, and it is the only thing that can answer "which sheet
//! did this Yamada Taro come off?" a week after two of them are in the ledger
//! (ADR-0009).
//!
//! Written once, at creation, and never updated. This is provenance, not an
//! audit trail: a record of where an entry came from, not of everything that
//! has happened to it since.

use chrono::{DateTime, Utc};
use derive_getters::Getters;

use super::{CourseError, CustomerId};

const MAX_ACTOR_LENGTH: usize = 255;

/// Which way into the ledger this person came.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomerRegistrationSource {
    /// Typed at the counter, from the customer screen's own form.
    Manual,
    /// Read off a scanned reception sheet and approved by the desk.
    ReceptionSheet,
    /// Answered from the names already written on a booking, after it was
    /// taken.
    Ledger,
}

impl CustomerRegistrationSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::ReceptionSheet => "reception_sheet",
            Self::Ledger => "ledger",
        }
    }

    /// Reads a stored or requested source.
    ///
    /// An unknown value is refused on the way in rather than folded into
    /// `Manual`: a source nobody recognises is a caller sending the wrong
    /// thing, and answering "typed at the counter" would be inventing history.
    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value {
            "manual" => Ok(Self::Manual),
            "reception_sheet" => Ok(Self::ReceptionSheet),
            "ledger" => Ok(Self::Ledger),
            _ => Err(CourseError::BadRequest(
                "unknown customer registration source",
            )),
        }
    }
}

/// What the desk is about to record, before it has a row.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct NewCustomerRegistration {
    #[getter(skip)]
    customer_id: CustomerId,
    #[getter(skip)]
    source: CustomerRegistrationSource,
    #[getter(skip)]
    registered_by: Option<String>,
    #[getter(skip)]
    source_row_index: Option<u32>,
}

impl NewCustomerRegistration {
    pub fn new(
        customer_id: CustomerId,
        source: CustomerRegistrationSource,
        registered_by: Option<String>,
        source_row_index: Option<u32>,
    ) -> Self {
        Self {
            customer_id,
            source,
            // A subject longer than the column is a token this service did not
            // issue; keeping the row matters more than keeping every byte of
            // an identifier nobody will read back.
            registered_by: registered_by.map(|actor| truncate(actor, MAX_ACTOR_LENGTH)),
            // A row number only means anything against a sheet. Carrying one
            // on a customer typed at the counter would point at nothing.
            source_row_index: match source {
                CustomerRegistrationSource::ReceptionSheet => source_row_index,
                _ => None,
            },
        }
    }

    pub fn customer_id(&self) -> &CustomerId {
        &self.customer_id
    }

    pub fn source(&self) -> CustomerRegistrationSource {
        self.source
    }

    pub fn registered_by(&self) -> Option<&str> {
        self.registered_by.as_deref()
    }

    pub fn source_row_index(&self) -> Option<u32> {
        self.source_row_index
    }
}

/// A registration as it was stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerRegistration {
    pub customer_id: CustomerId,
    pub source: CustomerRegistrationSource,
    pub registered_by: Option<String>,
    pub source_row_index: Option<u32>,
    pub created_at: DateTime<Utc>,
}

fn truncate(value: String, max: usize) -> String {
    if value.chars().count() <= max {
        return value;
    }
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_row_number_is_only_kept_for_a_sheet() {
        let typed = NewCustomerRegistration::new(
            CustomerId::new("cus_1"),
            CustomerRegistrationSource::Manual,
            None,
            Some(2),
        );
        assert_eq!(typed.source_row_index(), None);

        let scanned = NewCustomerRegistration::new(
            CustomerId::new("cus_1"),
            CustomerRegistrationSource::ReceptionSheet,
            None,
            Some(2),
        );
        assert_eq!(scanned.source_row_index(), Some(2));
    }

    #[test]
    fn an_unknown_source_is_refused_rather_than_guessed() {
        assert!(CustomerRegistrationSource::parse("scanner").is_err());
        assert_eq!(
            CustomerRegistrationSource::parse("reception_sheet").unwrap(),
            CustomerRegistrationSource::ReceptionSheet
        );
    }

    #[test]
    fn an_over_long_subject_shortens_instead_of_losing_the_row() {
        let actor = "a".repeat(MAX_ACTOR_LENGTH + 10);
        let entry = NewCustomerRegistration::new(
            CustomerId::new("cus_1"),
            CustomerRegistrationSource::Manual,
            Some(actor),
            None,
        );
        assert_eq!(entry.registered_by().map(str::len), Some(MAX_ACTOR_LENGTH));
    }
}
