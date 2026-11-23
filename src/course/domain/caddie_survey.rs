//! The caddie survey: one shared QR a guest scans after the round, picks the
//! caddie who walked with them, and rates them 1–5 with a comment.
//!
//! The form itself is Field's (Field Forms, template `survey`); each answer
//! lands in the caddie ratings Field already keeps, which is what the roster's
//! average and the 評価 tab read. CourseBoard's part is to build that form with
//! the club's caddies in it, keep the list in step with the roster, and hand
//! the desk the URL to print.

use super::CourseError;

/// Name of the form in Field's form list, and the title the guest sees.
pub const CADDIE_SURVEY_NAME: &str = "キャディアンケート";

/// The operator-facing reason a gateway gives when Field Forms is not part of
/// the tenant's Field plan. Matched by [`is_forms_not_provided`], so the
/// status read can answer "not available" instead of failing the screen.
pub const FORMS_NOT_PROVIDED_MESSAGE: &str =
    "TACHYON Field forms are not available for this tenant";

/// A gateway's error for "Field Forms is not delivered to this tenant".
pub fn forms_not_provided() -> CourseError {
    CourseError::UpstreamClient {
        status: 403,
        message: FORMS_NOT_PROVIDED_MESSAGE.to_string(),
    }
}

pub fn is_forms_not_provided(error: &CourseError) -> bool {
    matches!(
        error,
        CourseError::UpstreamClient { status: 403, message } if message == FORMS_NOT_PROVIDED_MESSAGE
    )
}

/// One caddie as the survey lists them: the value the answer carries and the
/// name the guest picks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurveyCaddieChoice {
    pub id: String,
    pub name: String,
}

/// The survey form as Field holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieSurveyForm {
    pub id: String,
    pub public_id: String,
    /// `draft` / `published` / `paused` / `archived`.
    pub status: String,
    /// Whether a version has ever been published.
    pub published: bool,
    pub has_unpublished_changes: bool,
    /// The caddies the published version lists, in its order. Empty when
    /// nothing is published.
    pub published_caddies: Vec<SurveyCaddieChoice>,
}

impl CaddieSurveyForm {
    /// An archived form answers nobody, so it counts as no survey at all.
    pub fn is_archived(&self) -> bool {
        self.status == "archived"
    }
}

/// Where the club's survey stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaddieSurveyStatus {
    /// Field Forms is not part of the tenant's Field plan.
    FormsUnavailable,
    /// Field offers no caddie to rate: no active caddie, or the golf
    /// extension is off.
    NoCaddies,
    /// Ready to be made; `caddie_count` caddies would be listed.
    NotCreated {
        caddie_count: usize,
    },
    Ready(CaddieSurveyOverview),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaddieSurveyOverview {
    pub form: CaddieSurveyForm,
    /// The page a guest opens from the QR.
    pub public_url: String,
    /// Caddies Field would list if the survey were rebuilt now.
    pub current_caddie_count: usize,
    /// The published list no longer matches the roster: someone joined, left,
    /// or was renamed.
    pub caddies_changed: bool,
}

/// Whether the published list differs from the caddies Field offers now.
///
/// Order is ignored — the roster's order is not something the guest needs
/// kept — but a renamed caddie counts, since the guest picks by name.
pub fn caddies_changed(published: &[SurveyCaddieChoice], current: &[SurveyCaddieChoice]) -> bool {
    let key = |choice: &SurveyCaddieChoice| (choice.id.clone(), choice.name.clone());
    let mut published: Vec<_> = published.iter().map(key).collect();
    let mut current: Vec<_> = current.iter().map(key).collect();
    published.sort();
    current.sort();
    published != current
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(id: &str, name: &str) -> SurveyCaddieChoice {
        SurveyCaddieChoice {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn the_same_caddies_in_another_order_are_unchanged() {
        assert!(!caddies_changed(
            &[choice("c1", "佐藤"), choice("c2", "鈴木")],
            &[choice("c2", "鈴木"), choice("c1", "佐藤")],
        ));
    }

    #[test]
    fn a_new_caddie_a_departure_or_a_rename_is_a_change() {
        let published = [choice("c1", "佐藤"), choice("c2", "鈴木")];
        assert!(caddies_changed(
            &published,
            &[
                choice("c1", "佐藤"),
                choice("c2", "鈴木"),
                choice("c3", "高橋")
            ],
        ));
        assert!(caddies_changed(&published, &[choice("c1", "佐藤")]));
        assert!(caddies_changed(
            &published,
            &[choice("c1", "佐藤"), choice("c2", "鈴木 花子")],
        ));
    }

    #[test]
    fn only_the_forms_gate_reads_as_forms_unavailable() {
        assert!(is_forms_not_provided(&forms_not_provided()));
        assert!(!is_forms_not_provided(&CourseError::UpstreamClient {
            status: 403,
            message: "this operation requires field:ManageForms".into(),
        }));
        assert!(!is_forms_not_provided(&CourseError::Forbidden("x")));
    }
}
