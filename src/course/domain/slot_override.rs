//! Desk-side marks on a single tee time: closed for sale, or sold at a special
//! rate.
//!
//! Field generates tee-time inventory from the weekly schedule and has no write
//! API for one slot, so a course that wants to stop selling 07:14 on one
//! Saturday cannot say so through the schedule without changing every Saturday.
//! These marks are CourseBoard's own data (ADR-0005) and sit on top of Field's
//! inventory rather than inside it.

use chrono::NaiveDate;
use derive_getters::Getters;

use super::{CourseError, CourseId};

const MAX_TEXT_LENGTH: usize = 120;

/// What the mark does to the slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotOverrideKind {
    /// Not for sale. The slot still exists and anything already booked into it
    /// keeps its place — closing a tee time is not the same as cancelling the
    /// group standing on it.
    Closed,
    /// Sold, but not at the plan's usual rate.
    ///
    /// This marks the slot; it does not price it. The amount comes from the plan
    /// the desk picks, the same as on the paper ledger, so nothing here feeds
    /// the fee quote.
    SpecialRate,
}

impl SlotOverrideKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::SpecialRate => "special_rate",
        }
    }

    pub fn parse(raw: &str) -> Result<Self, CourseError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "closed" => Ok(Self::Closed),
            "special_rate" | "specialrate" => Ok(Self::SpecialRate),
            _ => Err(CourseError::BadRequest(
                "slot mark must be 'closed' or 'special_rate'",
            )),
        }
    }
}

/// One mark on one course's tee time on one date.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct SlotOverride {
    #[getter(skip)]
    course_id: CourseId,
    #[getter(copy)]
    date: NaiveDate,
    /// Local wall clock `HH:MM`, matching how the slot is drawn on the ledger.
    ///
    /// Stored as the wall clock rather than an instant so a mark keeps pointing
    /// at the 07:14 row after a schedule regeneration rebuilds the slot rows
    /// with new ids.
    #[getter(skip)]
    tee_time: String,
    #[getter(copy)]
    kind: SlotOverrideKind,
    #[getter(skip)]
    label: Option<String>,
    #[getter(skip)]
    note: Option<String>,
}

impl SlotOverride {
    pub fn try_new(
        course_id: CourseId,
        date: NaiveDate,
        tee_time: impl Into<String>,
        kind: SlotOverrideKind,
        label: Option<String>,
        note: Option<String>,
    ) -> Result<Self, CourseError> {
        Ok(Self {
            course_id,
            date,
            tee_time: normalize_clock(tee_time.into())?,
            kind,
            label: normalize_optional(label)?,
            note: normalize_optional(note)?,
        })
    }

    /// Rebuild from storage, which already holds normalized values.
    pub fn reconstitute(
        course_id: CourseId,
        date: NaiveDate,
        tee_time: String,
        kind: SlotOverrideKind,
        label: Option<String>,
        note: Option<String>,
    ) -> Self {
        Self {
            course_id,
            date,
            tee_time,
            kind,
            label,
            note,
        }
    }

    pub fn course_id(&self) -> &CourseId {
        &self.course_id
    }

    pub fn tee_time(&self) -> &str {
        &self.tee_time
    }

    pub fn label(&self) -> Option<&str> {
        self.label.as_deref()
    }

    pub fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    pub fn is_closed(&self) -> bool {
        matches!(self.kind, SlotOverrideKind::Closed)
    }
}

/// Which marks to load for one ledger day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotOverrideQuery {
    pub date: NaiveDate,
    /// Empty means every course, so the ledger asks for the same set of courses
    /// it is drawing columns for.
    pub course_ids: Vec<CourseId>,
}

/// One write covering a run of tee times.
///
/// The desk closes a band, not a row: "no sales 07:14 through 07:35" is one
/// decision. Sending it as one command keeps the whole band from half-applying
/// when a request fails part-way through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsertSlotOverrides {
    pub course_id: CourseId,
    pub date: NaiveDate,
    pub tee_times: Vec<String>,
    pub kind: SlotOverrideKind,
    pub label: Option<String>,
    pub note: Option<String>,
}

impl UpsertSlotOverrides {
    pub fn into_overrides(self) -> Result<Vec<SlotOverride>, CourseError> {
        if self.tee_times.is_empty() {
            return Err(CourseError::BadRequest("at least one tee time is required"));
        }
        self.tee_times
            .iter()
            .map(|tee_time| {
                SlotOverride::try_new(
                    self.course_id.clone(),
                    self.date,
                    tee_time.clone(),
                    self.kind,
                    self.label.clone(),
                    self.note.clone(),
                )
            })
            .collect()
    }
}

/// Which marks to remove.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteSlotOverrides {
    pub course_id: CourseId,
    pub date: NaiveDate,
    pub tee_times: Vec<String>,
}

/// `HH:MM`, accepting the `HH:MM:SS` that Field's slot rows carry.
fn normalize_clock(value: String) -> Result<String, CourseError> {
    let trimmed = value.trim();
    let head: String = trimmed.chars().take(5).collect();
    let valid = head.len() == 5
        && head.as_bytes()[2] == b':'
        && head[..2].chars().all(|ch| ch.is_ascii_digit())
        && head[3..].chars().all(|ch| ch.is_ascii_digit())
        && head[..2].parse::<u8>().is_ok_and(|hour| hour <= 23)
        && head[3..].parse::<u8>().is_ok_and(|minute| minute <= 59);
    if !valid {
        return Err(CourseError::BadRequest("tee times must look like HH:MM"));
    }
    Ok(head)
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

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 20).unwrap()
    }

    #[test]
    fn field_slot_rows_carry_seconds_and_the_ledger_draws_minutes() {
        let mark = SlotOverride::try_new(
            CourseId::new("course-1"),
            date(),
            "07:14:00",
            SlotOverrideKind::Closed,
            None,
            None,
        )
        .unwrap();
        assert_eq!(mark.tee_time(), "07:14");
    }

    #[test]
    fn a_tee_time_that_is_not_a_clock_is_refused() {
        for raw in ["", "7:14", "25:00", "07:60", "morning"] {
            assert!(
                SlotOverride::try_new(
                    CourseId::new("course-1"),
                    date(),
                    raw,
                    SlotOverrideKind::Closed,
                    None,
                    None,
                )
                .is_err(),
                "{raw} should be refused"
            );
        }
    }

    #[test]
    fn closing_a_band_expands_into_one_mark_per_tee_time() {
        let command = UpsertSlotOverrides {
            course_id: CourseId::new("course-1"),
            date: date(),
            tee_times: vec!["07:14".into(), "07:21".into()],
            kind: SlotOverrideKind::SpecialRate,
            label: Some("特別料金".into()),
            note: None,
        };
        let marks = command.into_overrides().unwrap();
        assert_eq!(marks.len(), 2);
        assert_eq!(marks[0].tee_time(), "07:14");
        assert_eq!(marks[1].tee_time(), "07:21");
        assert!(marks.iter().all(|mark| mark.label() == Some("特別料金")));
    }

    #[test]
    fn a_write_covering_no_tee_time_is_refused_rather_than_silently_doing_nothing() {
        let command = UpsertSlotOverrides {
            course_id: CourseId::new("course-1"),
            date: date(),
            tee_times: Vec::new(),
            kind: SlotOverrideKind::Closed,
            label: None,
            note: None,
        };
        assert!(command.into_overrides().is_err());
    }

    #[test]
    fn only_the_two_marks_the_desk_can_make_are_accepted() {
        assert_eq!(
            SlotOverrideKind::parse("closed").unwrap(),
            SlotOverrideKind::Closed
        );
        assert_eq!(
            SlotOverrideKind::parse("special_rate").unwrap(),
            SlotOverrideKind::SpecialRate
        );
        assert!(SlotOverrideKind::parse("half_price").is_err());
    }
}
