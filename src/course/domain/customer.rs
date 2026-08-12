//! The customer ledger, as the desk sees it.
//!
//! The ledger itself is Field's (`commerce_customers`): it is not a golf idea,
//! and CourseBoard keeps no copy of it (ADR-0005). What lives here is the shape
//! the desk works with — enough of a person to tell two of them apart at the
//! counter, and nothing about how Field stores it.
//!
//! Members and visitors are the same kind of record. A member is someone
//! holding a membership assignment, not a different table; a visitor who comes
//! back next month is only findable because the first visit was written down.

use derive_getters::Getters;

use super::{CourseError, CustomerId};

/// Longest value the desk can type into any one field.
///
/// Matches the party editor's limit so a name that fits on the ledger also
/// fits in the ledger's customer.
const MAX_TEXT_LENGTH: usize = 120;

/// How many candidates a search hands back before the desk should type more.
///
/// A search that returns hundreds of rows is not a search, and the desk cannot
/// pick out of it. Field caps at 100; this is the smaller working default.
pub const DEFAULT_CUSTOMER_SEARCH_LIMIT: u32 = 20;
pub const MAX_CUSTOMER_SEARCH_LIMIT: u32 = 100;

/// One person in the ledger.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct Customer {
    #[getter(skip)]
    id: CustomerId,
    #[getter(skip)]
    name: String,
    /// Reading of the name. The desk searches by it because a Japanese name
    /// read aloud over the phone reaches the counter as kana, not as kanji.
    #[getter(skip)]
    name_kana: Option<String>,
    #[getter(skip)]
    email: Option<String>,
    #[getter(skip)]
    phone: Option<String>,
}

impl Customer {
    /// Rebuild from Field's answer. Trusted input: no validation, but blank
    /// strings become absent because Field represents "no email" as `""`.
    pub fn reconstitute(
        id: impl Into<CustomerId>,
        name: impl Into<String>,
        name_kana: Option<String>,
        email: Option<String>,
        phone: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            name_kana: blank_to_none(name_kana),
            email: blank_to_none(email),
            phone: blank_to_none(phone),
        }
    }

    pub fn id(&self) -> &CustomerId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn name_kana(&self) -> Option<&str> {
        self.name_kana.as_deref()
    }

    pub fn email(&self) -> Option<&str> {
        self.email.as_deref()
    }

    pub fn phone(&self) -> Option<&str> {
        self.phone.as_deref()
    }
}

/// A person the desk is putting into the ledger for the first time.
///
/// Only the name is required. A booking taken by phone often yields nothing
/// else, and refusing to record the visitor because no email was offered is
/// how a ledger ends up holding only the members.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCustomer {
    pub name: String,
    pub name_kana: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

impl NewCustomer {
    pub fn try_new(
        name: impl Into<String>,
        name_kana: Option<String>,
        email: Option<String>,
        phone: Option<String>,
    ) -> Result<Self, CourseError> {
        let name = name.into();
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CourseError::BadRequest("customer name is required"));
        }
        if trimmed.chars().count() > MAX_TEXT_LENGTH {
            return Err(CourseError::BadRequest(
                "text must be at most 120 characters",
            ));
        }
        Ok(Self {
            name: trimmed.to_string(),
            name_kana: normalize_optional(name_kana)?,
            email: normalize_optional(email)?,
            phone: normalize_optional(phone)?,
        })
    }
}

/// What the desk typed into the search box, or nothing at all.
///
/// Field matches `name` against both the display name and its kana, and `phone`
/// with separators ignored on both sides. `email` is exact — an address is
/// either the one on file or it is not.
///
/// Nothing typed means the ledger itself: the most recent arrivals, capped at
/// `limit`. A desk that has just written somebody down looks for them where it
/// wrote them, and a screen that answers an empty box with nothing reads as if
/// the save was lost. The cap is what keeps this from being a way to walk the
/// whole tenant a page at a time.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CustomerSearchQuery {
    pub name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub limit: u32,
}

impl CustomerSearchQuery {
    pub fn try_new(
        name: Option<String>,
        phone: Option<String>,
        email: Option<String>,
        limit: Option<u32>,
    ) -> Result<Self, CourseError> {
        let name = normalize_optional(name)?;
        let phone = normalize_optional(phone)?;
        let email = normalize_optional(email)?;
        Ok(Self {
            name,
            phone,
            email,
            limit: limit
                .unwrap_or(DEFAULT_CUSTOMER_SEARCH_LIMIT)
                .clamp(1, MAX_CUSTOMER_SEARCH_LIMIT),
        })
    }
}

fn blank_to_none(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_optional(value: Option<String>) -> Result<Option<String>, CourseError> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_TEXT_LENGTH {
        return Err(CourseError::BadRequest(
            "text must be at most 120 characters",
        ));
    }
    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_visitor_who_offered_only_a_name_can_still_be_recorded() {
        // The whole point: a phone booking yields a name and nothing else, and
        // that person still belongs in the ledger.
        let customer = NewCustomer::try_new("本田 康彦", None, None, None).unwrap();
        assert_eq!(customer.name, "本田 康彦");
        assert_eq!(customer.email, None);
    }

    #[test]
    fn a_customer_must_actually_be_named() {
        assert!(NewCustomer::try_new("   ", None, None, None).is_err());
    }

    #[test]
    fn blank_optional_fields_are_absent_rather_than_empty_strings() {
        let customer =
            NewCustomer::try_new("本田 康彦", Some("  ".into()), Some(String::new()), None)
                .unwrap();
        assert_eq!(customer.name_kana, None);
        assert_eq!(customer.email, None);
    }

    #[test]
    fn field_reports_a_missing_email_as_an_empty_string_and_it_reads_as_absent() {
        let customer = Customer::reconstitute(
            "cus_1",
            "本田 康彦",
            None,
            Some(String::new()),
            Some("090-1234-5678".into()),
        );
        assert_eq!(customer.email(), None);
        assert_eq!(customer.phone(), Some("090-1234-5678"));
    }

    #[test]
    fn an_empty_search_asks_for_the_ledger_itself_rather_than_being_refused() {
        // What the desk sees on opening the screen, and after a reload: the
        // ledger, not an empty page that reads as if nothing was ever saved.
        let query = CustomerSearchQuery::try_new(None, None, None, None).unwrap();
        assert_eq!(query.name, None);
        assert_eq!(query.phone, None);
        assert_eq!(query.email, None);
        // Still bounded — an empty box is a listing, not a way to walk the
        // whole tenant a page at a time.
        assert_eq!(query.limit, DEFAULT_CUSTOMER_SEARCH_LIMIT);

        let blank = CustomerSearchQuery::try_new(Some("  ".into()), None, None, None).unwrap();
        assert_eq!(blank.name, None);
    }

    #[test]
    fn a_search_limit_stays_inside_what_the_desk_can_read() {
        let query = CustomerSearchQuery::try_new(Some("本田".into()), None, None, None).unwrap();
        assert_eq!(query.limit, DEFAULT_CUSTOMER_SEARCH_LIMIT);
        let query =
            CustomerSearchQuery::try_new(Some("本田".into()), None, None, Some(5000)).unwrap();
        assert_eq!(query.limit, MAX_CUSTOMER_SEARCH_LIMIT);
        let query = CustomerSearchQuery::try_new(Some("本田".into()), None, None, Some(0)).unwrap();
        assert_eq!(query.limit, 1);
    }
}
