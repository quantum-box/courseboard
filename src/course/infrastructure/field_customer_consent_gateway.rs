//! Field consumer consent client.
//!
//! `POST /v1/erp/customers/{id}/consents` files what a visitor agreed to. The
//! trail is append-only and Field snapshots the terms version itself, so a
//! record made today still says what the visitor signed after the terms are
//! revised (PLT-4041). CourseBoard supplies the keys and which way each
//! printed box points; Field stores it (ADR-0005).
//!
//! Note the surface. The rest of CourseBoard's customer ledger goes through
//! `/v1/storekit/customers`, which has no consent — StoreKit's create and
//! update pass `consent: None` through to the same repository. So consents
//! take the `/v1/erp` route even though the customer beside them did not, and
//! the two are separate requests rather than the single atomic create Field's
//! own ERP surface offers.

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::course::domain::{
    CourseError, CustomerConsentGateway, CustomerId, GatewayCredentials, ReceptionConsentAnswer,
};

use super::field_gateway::{field_send_unit, normalize_base_url, urlencoding_path};

/// Where a consent was taken, in Field's vocabulary. A reception sheet is
/// handed over a counter, which is `store` — the other values are for a web
/// form and a self-service terminal, neither of which is this screen.
const RECEPTION_CONSENT_CHANNEL: &str = "store";

pub struct FieldCustomerConsentGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldCustomerConsentGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl CustomerConsentGateway for FieldCustomerConsentGateway {
    async fn record_consents(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        answers: &[ReceptionConsentAnswer],
    ) -> Result<(), CourseError> {
        let Some(body) = consent_body(answers) else {
            // Field refuses an empty `consents` array with a 400. A sheet
            // where the reader made out no box at all is a normal outcome, not
            // a request worth sending.
            return Ok(());
        };
        let path = format!(
            "/v1/erp/customers/{}/consents",
            urlencoding_path(customer_id.as_str())
        );
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            Some(&body),
        )
        .await
    }
}

/// Only the boxes that were actually answered.
///
/// An unread box is dropped rather than sent as `false`: Field would file it
/// as a refusal, and a refusal nobody made is worse than a gap the desk can
/// still fill in.
fn consent_body(answers: &[ReceptionConsentAnswer]) -> Option<Value> {
    let consents: Vec<Value> = answers
        .iter()
        .filter_map(|answer| {
            answer
                .accepted
                .map(|accepted| json!({ "consentKey": answer.key, "accepted": accepted }))
        })
        .collect();
    if consents.is_empty() {
        return None;
    }
    Some(json!({ "consents": consents, "channel": RECEPTION_CONSENT_CHANNEL }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{
        CONSENT_ANTISOCIAL_AND_COURSE_TERMS, CONSENT_CART_TERMS, CONSENT_MARKETING_CONTACT,
    };

    fn answer(key: &'static str, accepted: Option<bool>) -> ReceptionConsentAnswer {
        ReceptionConsentAnswer { key, accepted }
    }

    /// Field's request keys are camelCase, unlike the StoreKit surface the
    /// rest of the customer ledger uses. Sending `consent_key` is a 400.
    #[test]
    fn the_body_is_camel_case_and_carries_the_counter_as_the_channel() {
        let body = consent_body(&[
            answer(CONSENT_ANTISOCIAL_AND_COURSE_TERMS, Some(true)),
            answer(CONSENT_MARKETING_CONTACT, Some(false)),
        ])
        .expect("answered boxes make a body");
        assert_eq!(body["channel"], "store");
        assert_eq!(
            body["consents"][0]["consentKey"],
            CONSENT_ANTISOCIAL_AND_COURSE_TERMS
        );
        assert_eq!(body["consents"][0]["accepted"], true);
        assert_eq!(body["consents"][1]["consentKey"], CONSENT_MARKETING_CONTACT);
        assert_eq!(body["consents"][1]["accepted"], false);
    }

    /// A box the reader could not make out must not reach Field at all. Sent
    /// as `false` it becomes a refusal in an append-only trail, which nobody
    /// can distinguish afterwards from one the visitor actually made.
    #[test]
    fn an_unanswered_box_is_left_out_rather_than_filed_as_a_refusal() {
        let body = consent_body(&[
            answer(CONSENT_ANTISOCIAL_AND_COURSE_TERMS, Some(true)),
            answer(CONSENT_CART_TERMS, None),
            answer(CONSENT_MARKETING_CONTACT, None),
        ])
        .expect("one answered box is enough");
        let consents = body["consents"].as_array().expect("an array");
        assert_eq!(consents.len(), 1);
        assert_eq!(
            consents[0]["consentKey"],
            CONSENT_ANTISOCIAL_AND_COURSE_TERMS
        );
    }

    /// Field answers an empty `consents` array with a 400. A sheet whose boxes
    /// were all unreadable is a normal read, so it must not become a request.
    #[test]
    fn a_sheet_with_nothing_answered_makes_no_request() {
        assert!(consent_body(&[
            answer(CONSENT_ANTISOCIAL_AND_COURSE_TERMS, None),
            answer(CONSENT_CART_TERMS, None),
        ])
        .is_none());
        assert!(consent_body(&[]).is_none());
    }
}
