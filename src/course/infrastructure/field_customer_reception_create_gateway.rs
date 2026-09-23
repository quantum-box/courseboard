//! Field ERP customer creation for a reception sheet.
//!
//! Reception registration uses Field's ERP capability because it accepts the
//! newer birth-date, sex, address, and consent columns. It is deliberately a
//! separate port from the StoreKit [`CustomerGateway`]: Field answers this
//! endpoint with only `{id}`, while the existing manual and ledger paths rely
//! on StoreKit returning the full customer DTO.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::course::domain::{
    CourseError, Customer, CustomerReceptionCreateGateway, GatewayCredentials,
    ReceptionConsentAnswer, ReceptionCustomerInput,
};

use super::field_gateway::{field_send_json, normalize_base_url};

pub struct FieldCustomerReceptionCreateGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldCustomerReceptionCreateGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[derive(Debug, Deserialize)]
struct FieldCreatedCustomerDto {
    id: String,
}

#[async_trait]
impl CustomerReceptionCreateGateway for FieldCustomerReceptionCreateGateway {
    async fn create_reception_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &ReceptionCustomerInput,
        consents: &[ReceptionConsentAnswer],
    ) -> Result<Customer, CourseError> {
        let created: FieldCreatedCustomerDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/customers",
            credentials,
            Some(&reception_customer_body(input, consents)),
        )
        .await?;

        // ERP intentionally returns only the new id. Map the request we just
        // sent back to the domain rather than changing StoreKit's full DTO
        // contract or issuing a second GET that could observe another state.
        Ok(Customer::reconstitute(
            created.id,
            input.customer.name.clone(),
            input.customer.name_kana.clone(),
            input.customer.email.clone(),
            input.customer.phone.clone(),
        ))
    }
}

fn reception_customer_body(
    input: &ReceptionCustomerInput,
    consents: &[ReceptionConsentAnswer],
) -> Value {
    let mut body = Map::new();
    body.insert("name".into(), json!(input.customer.name));
    if let Some(value) = input.customer.name_kana.as_deref() {
        body.insert("nameKana".into(), json!(value));
    }
    if let Some(value) = input.customer.email.as_deref() {
        body.insert("email".into(), json!(value));
    }
    if let Some(value) = input.customer.phone.as_deref() {
        body.insert("phone".into(), json!(value));
    }
    if let Some(value) = input.birth_date {
        body.insert(
            "birthDate".into(),
            json!(value.format("%Y-%m-%d").to_string()),
        );
    }
    if let Some(value) = input.sex.as_deref() {
        body.insert("sex".into(), json!(value));
    }
    if let Some(address) = input.address.as_ref() {
        body.insert(
            "address".into(),
            json!({
                "postalCode": address.postal_code,
                "state": address.state,
                "city": address.city,
                "address1": address.address1,
                "address2": address.address2,
            }),
        );
    }
    let consent_values: Vec<Value> = consents
        .iter()
        .filter_map(|consent| {
            consent
                .accepted
                .map(|accepted| json!({ "consentKey": consent.key, "accepted": accepted }))
        })
        .collect();
    body.insert("consents".into(), json!(consent_values));
    body.insert("channel".into(), json!("store"));
    Value::Object(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::collections::BTreeMap;

    use crate::course::domain::{
        CustomerId, NewCustomer, ReceptionAddress, CONSENT_ANTISOCIAL_AND_COURSE_TERMS,
    };

    fn input() -> ReceptionCustomerInput {
        ReceptionCustomerInput::new(
            NewCustomer::try_new(
                "本田 康彦",
                Some("ホンダ ヤスヒコ".to_string()),
                None,
                Some("090-1234-5678".to_string()),
            )
            .unwrap(),
            Some(NaiveDate::from_ymd_opt(1984, 4, 1).unwrap()),
            Some("女性".to_string()),
            Some(ReceptionAddress {
                postal_code: "150-0001".to_string(),
                state: "東京都".to_string(),
                city: "渋谷区".to_string(),
                address1: "神宮前1-1-1".to_string(),
                address2: Some("テストビル101".to_string()),
            }),
            BTreeMap::new(),
        )
    }

    #[test]
    fn erp_body_carries_extended_customer_values_and_consents_atomically() {
        let body = reception_customer_body(
            &input(),
            &[ReceptionConsentAnswer {
                key: CONSENT_ANTISOCIAL_AND_COURSE_TERMS.to_string(),
                accepted: Some(true),
            }],
        );
        assert_eq!(body["name"], "本田 康彦");
        assert_eq!(body["nameKana"], "ホンダ ヤスヒコ");
        assert_eq!(body["birthDate"], "1984-04-01");
        assert_eq!(body["address"]["postalCode"], "150-0001");
        assert_eq!(
            body["consents"][0]["consentKey"],
            CONSENT_ANTISOCIAL_AND_COURSE_TERMS
        );
        assert_eq!(body["channel"], "store");
    }

    #[test]
    fn erp_id_is_mapped_to_the_values_sent_without_a_follow_up_get() {
        let created: FieldCreatedCustomerDto =
            serde_json::from_value(json!({ "id": "cus_1" })).unwrap();
        let customer = Customer::reconstitute(
            created.id,
            input().customer.name.clone(),
            input().customer.name_kana.clone(),
            input().customer.email.clone(),
            input().customer.phone.clone(),
        );
        assert_eq!(customer.id(), &CustomerId::new("cus_1"));
        assert_eq!(customer.name_kana(), Some("ホンダ ヤスヒコ"));
    }
}
