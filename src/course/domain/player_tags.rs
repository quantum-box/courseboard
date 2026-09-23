//! The visitor categories a booking can be tagged with.
//!
//! Free words the club sorts its players by — 会員, 優待, WEB. CourseBoard's
//! own vocabulary, stored in CourseBoard's own table (ADR-0009); anything not
//! on the list can still be typed by hand at the desk.

use serde_json::Value;

use crate::course::domain::CourseError;

/// More choices than this stops being a pick list.
pub const MAX_PLAYER_TAG_OPTIONS: usize = 20;
/// Matches the column width; a longer label is prose, not a category.
pub const MAX_PLAYER_TAG_LENGTH: usize = 40;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlayerTagOptions {
    options: Vec<String>,
}

impl PlayerTagOptions {
    /// Validate an explicit save.
    ///
    /// Whitespace is trimmed and blank entries dropped — the form grows rows
    /// the operator may leave empty — but a duplicate, an over-long label, or
    /// too many of them is refused rather than silently pruned: the list that
    /// comes back must be the list they arranged.
    pub fn try_new(values: Vec<String>) -> Result<Self, CourseError> {
        let options: Vec<String> = values
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        if options.len() > MAX_PLAYER_TAG_OPTIONS {
            return Err(CourseError::BadRequest("too many player categories"));
        }
        if options
            .iter()
            .any(|value| value.chars().count() > MAX_PLAYER_TAG_LENGTH)
        {
            return Err(CourseError::BadRequest("a player category is too long"));
        }
        let mut seen = Vec::new();
        for option in &options {
            if seen.contains(&option) {
                return Err(CourseError::BadRequest(
                    "the same player category appears twice",
                ));
            }
            seen.push(option);
        }
        Ok(Self { options })
    }

    /// Read the list out of the extension config it migrated from.
    ///
    /// Forgiving where `try_new` refuses: this bag has other writers, and a
    /// broken entry someone else left must not take the booking form down.
    /// Whatever cannot be a category is skipped.
    pub fn from_config(config: &Value) -> Self {
        let Some(values) = config.get("playerTagOptions").and_then(Value::as_array) else {
            return Self::default();
        };
        let mut options: Vec<String> = Vec::new();
        for value in values {
            let Some(option) = value.as_str().map(str::trim).filter(|v| !v.is_empty()) else {
                continue;
            };
            if option.chars().count() > MAX_PLAYER_TAG_LENGTH
                || options.iter().any(|seen| seen == option)
            {
                continue;
            }
            options.push(option.to_string());
            if options.len() >= MAX_PLAYER_TAG_OPTIONS {
                break;
            }
        }
        Self { options }
    }

    /// Reconstitute from our own storage, which `try_new` guarded on the way in.
    pub fn reconstitute(options: Vec<String>) -> Self {
        Self { options }
    }

    pub fn options(&self) -> &[String] {
        &self.options
    }

    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn blank_rows_are_dropped_but_real_entries_are_kept_in_order() {
        let tags =
            PlayerTagOptions::try_new(vec![" 会員 ".into(), "".into(), "WEB".into()]).unwrap();
        assert_eq!(tags.options(), ["会員", "WEB"]);
    }

    #[test]
    fn a_duplicate_category_is_refused_rather_than_pruned() {
        assert!(PlayerTagOptions::try_new(vec!["会員".into(), " 会員".into()]).is_err());
    }

    #[test]
    fn the_config_reader_skips_what_it_cannot_use_instead_of_failing() {
        let tags = PlayerTagOptions::from_config(&json!({
            "playerTagOptions": ["会員", 7, null, "会員", "  ", "優待"],
        }));
        assert_eq!(tags.options(), ["会員", "優待"]);
    }

    #[test]
    fn a_config_without_the_key_reads_as_no_categories() {
        assert!(PlayerTagOptions::from_config(&json!({})).is_empty());
    }
}
