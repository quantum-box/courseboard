//! What a golf reception sheet asks a visitor to agree to.
//!
//! Field owns both the tenant consent catalog and the append-only evidence.
//! CourseBoard fetches that catalog for each reception flow and does not keep a
//! projection. The constants below are compatibility fixtures for tenants and
//! callers that predate the catalog integration; the one CourseBoard-specific
//! behavior that remains is the legacy marketing opt-out polarity (ADR-0014).
//!
//! The direction is the part that is easy to get wrong. A Japanese reception
//! sheet asks for marketing the wrong way round: the visitor ticks the box to
//! say they do *not* want to hear from the club. Field's filter selects the
//! customers whose consent is `accepted`, so a box recorded as it was printed
//! would mail exactly the people who asked not to be mailed. The reader is
//! still asked what the paper says — the desk checks the read against the
//! original, and an inverted question would not match the page in front of
//! them — and the flip happens here, once, on the way to Field.

use serde::Serialize;

/// Which way a printed box points once it becomes a consent record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsentPolarity {
    /// The box is ticked to agree. Most of the sheet.
    TickMeansAccepted,
    /// The box is ticked to refuse — an opt-out. Recorded inverted, so that
    /// `accepted` always means the visitor said yes to being contacted.
    TickMeansDeclined,
}

impl ConsentPolarity {
    /// What Field should store for a box the reader saw in the given state.
    ///
    /// An unread box is not a refusal: `None` stays `None` so the desk is
    /// asked rather than a silent `false` being filed as a decision.
    pub fn accepted_from_tick(self, ticked: Option<bool>) -> Option<bool> {
        ticked.map(|ticked| match self {
            Self::TickMeansAccepted => ticked,
            Self::TickMeansDeclined => !ticked,
        })
    }
}

/// One box on the reception sheet.
#[derive(Clone, Copy, Debug)]
pub struct ReceptionConsent {
    /// The tenant-defined key in Field's checklist. Prefixed so a course that
    /// also runs a restaurant or a hotel on the same tenant does not collide
    /// with their consents.
    ///
    /// Field accepts `^[a-z][a-z0-9_]{0,63}$` and answers anything else with a
    /// 400, so the prefix is `golf_` rather than the `golf.` a namespace would
    /// normally use. See [`tests::keys_are_shaped_the_way_field_accepts`].
    pub key: &'static str,
    /// What the desk calls it on screen.
    pub label: &'static str,
    /// What the reader is asked to look for. Phrased as the paper phrases it,
    /// including when the paper is an opt-out — the desk compares the read
    /// against the original, so the question has to match the page.
    pub prompt: &'static str,
    /// A visitor cannot be registered from this sheet without it. Only the
    /// declaration the sheet itself marks 「必ず☑をご記入下さい」.
    pub required: bool,
    pub polarity: ConsentPolarity,
}

/// A consent definition projected from Field's tenant catalog for one
/// reception-sheet read.
///
/// CourseBoard deliberately does not persist this value.  The Field catalog
/// is loaded immediately before OCR or registration and this owned form keeps
/// the OCR port independent of the HTTP/Field DTO.  `body` is preferred as
/// the OCR prompt when present; otherwise the catalog label is used.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceptionConsentDefinition {
    pub key: String,
    pub label: String,
    pub body: Option<String>,
    pub required: bool,
    pub sort_order: i32,
    pub polarity: ConsentPolarity,
}

impl ReceptionConsentDefinition {
    pub fn new(
        key: impl Into<String>,
        label: impl Into<String>,
        body: Option<String>,
        required: bool,
        sort_order: i32,
    ) -> Self {
        let key = key.into();
        let label = label.into();
        let polarity = if key == CONSENT_MARKETING_CONTACT {
            ConsentPolarity::TickMeansDeclined
        } else {
            ConsentPolarity::TickMeansAccepted
        };
        Self {
            key,
            label,
            body,
            required,
            sort_order,
            polarity,
        }
    }

    /// The text the OCR reader should look for on the paper.
    pub fn prompt(&self) -> &str {
        self.body
            .as_deref()
            .filter(|body| !body.trim().is_empty())
            .unwrap_or(self.label.as_str())
    }

    /// Convert the printed tick to Field's `accepted` direction.
    pub fn accepted_from_tick(&self, ticked: Option<bool>) -> Option<bool> {
        self.polarity.accepted_from_tick(ticked)
    }
}

/// The declaration the sheet requires of everyone: not a member of an
/// organised crime group, and bound by the course's terms of use. One printed
/// box covers both, so it is one consent rather than two — splitting it would
/// file two records the visitor never separately agreed to.
pub const CONSENT_ANTISOCIAL_AND_COURSE_TERMS: &str = "golf_antisocial_and_course_terms";
/// Agreeing to the cart terms. Separate because it only binds a visitor who
/// takes a cart, and a walking group leaves it blank.
pub const CONSENT_CART_TERMS: &str = "golf_cart_terms";
/// Whether the club may contact the visitor about campaigns and products.
/// Printed as an opt-out; stored as a yes.
pub const CONSENT_MARKETING_CONTACT: &str = "golf_marketing_contact";

/// The boxes a golf reception sheet carries.
///
/// Order is the order they are printed in, which is the order the desk reads
/// them off the page.
pub const RECEPTION_CONSENTS: [ReceptionConsent; 3] = [
    ReceptionConsent {
        key: CONSENT_ANTISOCIAL_AND_COURSE_TERMS,
        label: "反社会的勢力でないことの表明・ゴルフ場利用約款の遵守",
        prompt: "「反社会的勢力でないことを表明し、ゴルフ場利用約款を遵守します」のチェック欄。チェックが入っていれば true",
        required: true,
        polarity: ConsentPolarity::TickMeansAccepted,
    },
    ReceptionConsent {
        key: CONSENT_CART_TERMS,
        label: "カート利用約款の遵守",
        prompt: "「乗用カート使用の際は、カート利用約款を遵守します」のチェック欄。チェックが入っていれば true",
        required: false,
        polarity: ConsentPolarity::TickMeansAccepted,
    },
    ReceptionConsent {
        key: CONSENT_MARKETING_CONTACT,
        label: "クラブからの情報提供",
        prompt: "「当クラブからの情報提供が不要の場合はチェック」の欄。不要としてチェックが入っていれば true",
        required: false,
        polarity: ConsentPolarity::TickMeansDeclined,
    },
];

/// Look one up by the column key the reader answers under.
pub fn reception_consent(key: &str) -> Option<&'static ReceptionConsent> {
    RECEPTION_CONSENTS.iter().find(|consent| consent.key == key)
}

/// The consents a sheet must carry before a visitor can be registered from it.
pub fn required_reception_consents() -> impl Iterator<Item = &'static ReceptionConsent> {
    RECEPTION_CONSENTS.iter().filter(|consent| consent.required)
}

/// The legacy three-box catalog used only as a compatibility fallback for
/// callers that predate Field's tenant consent catalog.
pub fn legacy_reception_consent_definitions() -> Vec<ReceptionConsentDefinition> {
    RECEPTION_CONSENTS
        .iter()
        .map(|consent| ReceptionConsentDefinition {
            key: consent.key.to_string(),
            label: consent.label.to_string(),
            body: Some(consent.prompt.to_string()),
            required: consent.required,
            sort_order: 0,
            polarity: consent.polarity,
        })
        .collect()
}

/// One consent as read off a sheet, before anybody has looked at it.
///
/// `accepted` is already in Field's direction — the printed opt-out has been
/// flipped — so nothing downstream has to remember which way the paper ran.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionConsentAnswer {
    pub key: String,
    pub accepted: Option<bool>,
}

impl ReceptionConsentAnswer {
    pub fn new(key: impl Into<String>, accepted: Option<bool>) -> Self {
        Self {
            key: key.into(),
            accepted,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tick_on_an_ordinary_box_is_a_yes() {
        assert_eq!(
            ConsentPolarity::TickMeansAccepted.accepted_from_tick(Some(true)),
            Some(true)
        );
        assert_eq!(
            ConsentPolarity::TickMeansAccepted.accepted_from_tick(Some(false)),
            Some(false)
        );
    }

    #[test]
    fn a_tick_on_an_opt_out_box_is_a_no() {
        assert_eq!(
            ConsentPolarity::TickMeansDeclined.accepted_from_tick(Some(true)),
            Some(false)
        );
        assert_eq!(
            ConsentPolarity::TickMeansDeclined.accepted_from_tick(Some(false)),
            Some(true)
        );
    }

    /// An unread box has to stay unread. Filing it as `false` would record a
    /// refusal the visitor never made, and for the required declaration it
    /// would look like they declined rather than like the scan was poor.
    #[test]
    fn an_unread_box_is_not_a_decision() {
        assert_eq!(
            ConsentPolarity::TickMeansAccepted.accepted_from_tick(None),
            None
        );
        assert_eq!(
            ConsentPolarity::TickMeansDeclined.accepted_from_tick(None),
            None
        );
    }

    /// The sheet marks exactly one box 「必ず☑をご記入下さい」. If a second one
    /// ever becomes required, the desk starts refusing rows it used to accept,
    /// so the count is worth pinning.
    #[test]
    fn only_the_printed_declaration_is_required() {
        let required: Vec<&str> = required_reception_consents()
            .map(|consent| consent.key)
            .collect();
        assert_eq!(required, vec![CONSENT_ANTISOCIAL_AND_COURSE_TERMS]);
    }

    /// The keys are the contract with the tenant's checklist in Field. A
    /// rename here silently stops matching the rows already recorded.
    #[test]
    fn keys_are_namespaced_and_unique() {
        let mut keys: Vec<&str> = RECEPTION_CONSENTS.iter().map(|c| c.key).collect();
        let count = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), count);
        assert!(keys.iter().all(|key| key.starts_with("golf_")));
    }

    /// Field validates the key against `^[a-z][a-z0-9_]{0,63}$` and answers a
    /// violation with a 400 the desk cannot act on. The obvious namespace
    /// separator — a dot — is exactly what it rejects, so this is worth
    /// failing here rather than against the tenant's first real sheet.
    #[test]
    fn keys_are_shaped_the_way_field_accepts() {
        for consent in RECEPTION_CONSENTS.iter() {
            let key = consent.key;
            assert!(!key.is_empty() && key.len() <= 64, "{key} is out of range");
            let mut characters = key.chars();
            assert!(
                characters
                    .next()
                    .is_some_and(|first| first.is_ascii_lowercase()),
                "{key} must start with a lowercase letter"
            );
            assert!(
                characters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{key} may only carry lowercase letters, digits and underscores"
            );
        }
    }

    #[test]
    fn marketing_is_the_only_inverted_box() {
        let inverted: Vec<&str> = RECEPTION_CONSENTS
            .iter()
            .filter(|c| c.polarity == ConsentPolarity::TickMeansDeclined)
            .map(|c| c.key)
            .collect();
        assert_eq!(inverted, vec![CONSENT_MARKETING_CONTACT]);
    }

    #[test]
    fn lookup_finds_every_declared_consent() {
        for consent in RECEPTION_CONSENTS.iter() {
            assert_eq!(
                reception_consent(consent.key).map(|c| c.key),
                Some(consent.key)
            );
        }
        assert!(reception_consent("golf_not_a_consent").is_none());
    }
}
