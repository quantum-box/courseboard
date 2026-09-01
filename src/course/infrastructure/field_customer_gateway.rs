//! Field StoreKit customer ledger client.
//!
//! `/v1/storekit/customers` is the tenant's customer master. CourseBoard reads
//! and writes it but stores none of it (ADR-0005): the ledger is a generic ERP
//! record, and the golf meaning of an identity — member or visitor, which grade,
//! how often they play — is derived on the CourseBoard side from what is
//! attached to it.
//!
//! Field reports a customer with no email address as `""` rather than omitting
//! the field, for SDK compatibility (PLT-3358). That is an upstream encoding
//! detail: it is normalised to absent here so nothing downstream has to know
//! that an empty string means "never asked".

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::course::domain::{
    CourseError, Customer, CustomerGateway, CustomerId, CustomerSearchQuery, GatewayCredentials,
    NewCustomer,
};

use super::field_gateway::{
    field_get_items, field_send_json, field_send_unit, normalize_base_url, urlencoding_path,
};

/// Reads and writes the tenant's customer ledger in Field.
pub struct FieldCustomerGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldCustomerGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl CustomerGateway for FieldCustomerGateway {
    async fn search_customers(
        &self,
        credentials: GatewayCredentials<'_>,
        query: &CustomerSearchQuery,
    ) -> Result<Vec<Customer>, CourseError> {
        let path = format!("/v1/storekit/customers?{}", search_query_string(query)?);
        let mut items: Vec<FieldCustomerDto> =
            field_get_items(&self.client, &self.base_url, &path, credentials).await?;
        // Field echoes `limit: 0` and has answered an unlimited listing before,
        // so the cap is honoured here too rather than trusted upstream. An
        // empty search asks for the ledger, and the ledger is not bounded.
        items.truncate(query.limit as usize);
        Ok(items.into_iter().map(map_customer).collect())
    }

    async fn get_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<Customer, CourseError> {
        let path = format!(
            "/v1/storekit/customers/{}",
            urlencoding_path(customer_id.as_str())
        );
        let dto: FieldCustomerDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(map_customer(dto))
    }

    async fn create_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &NewCustomer,
    ) -> Result<Customer, CourseError> {
        let dto: FieldCustomerDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/storekit/customers",
            credentials,
            Some(&new_customer_body(input)),
        )
        .await?;
        Ok(map_customer(dto))
    }

    async fn delete_customer(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<(), CourseError> {
        let path = format!(
            "/v1/storekit/customers/{}",
            urlencoding_path(customer_id.as_str())
        );
        field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::DELETE,
            &path,
            credentials,
            None,
        )
        .await
    }
}

/// Field's customer keys are snake_case, unlike the reservation surfaces.
#[derive(Debug, Deserialize)]
struct FieldCustomerDto {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    name_kana: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    phone: Option<String>,
}

fn map_customer(dto: FieldCustomerDto) -> Customer {
    Customer::reconstitute(
        dto.id,
        dto.name.unwrap_or_default(),
        dto.name_kana,
        dto.email,
        dto.phone,
    )
}

/// Only the fields the desk filled in.
///
/// An absent key and an explicit `null` are not the same to Field's update
/// path, and sending `null` for everything the desk left blank would be a
/// request to erase it.
fn new_customer_body(input: &NewCustomer) -> Value {
    let mut body = Map::new();
    body.insert("name".into(), json!(input.name));
    if let Some(value) = input.name_kana.as_deref() {
        body.insert("name_kana".into(), json!(value));
    }
    if let Some(value) = input.email.as_deref() {
        body.insert("email".into(), json!(value));
    }
    if let Some(value) = input.phone.as_deref() {
        body.insert("phone".into(), json!(value));
    }
    Value::Object(body)
}

fn search_query_string(query: &CustomerSearchQuery) -> Result<String, CourseError> {
    let mut params: Vec<(&str, String)> = Vec::new();
    if let Some(value) = query.name.as_deref() {
        params.push(("name", value.to_string()));
    }
    if let Some(value) = query.phone.as_deref() {
        params.push(("phone", value.to_string()));
    }
    if let Some(value) = query.email.as_deref() {
        params.push(("email", value.to_string()));
    }
    params.push(("limit", query.limit.to_string()));
    // Percent-encoding rather than string concatenation: a desk searching for
    // `山田 太郎` puts a space and multi-byte text straight into the query.
    serde_urlencoded::to_string(params).map_err(|error| {
        CourseError::Provider(format!("failed to encode customer search: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_search_encodes_what_the_desk_typed_rather_than_splicing_it_into_the_url() {
        let query =
            CustomerSearchQuery::try_new(Some("山田 太郎".into()), None, None, Some(5)).unwrap();
        let encoded = search_query_string(&query).unwrap();
        assert!(encoded.contains("name=%E5%B1%B1%E7%94%B0+%E5%A4%AA%E9%83%8E"));
        assert!(encoded.contains("limit=5"));
        assert!(!encoded.contains("phone="));
    }

    #[test]
    fn an_empty_search_asks_field_for_the_ledger_with_only_a_cap() {
        let query = CustomerSearchQuery::try_new(None, None, None, None).unwrap();
        let encoded = search_query_string(&query).unwrap();
        assert_eq!(encoded, "limit=20");
    }

    #[test]
    fn a_customer_with_no_email_comes_back_as_having_none() {
        // Field answers "" rather than omitting the key (PLT-3358).
        let dto: FieldCustomerDto = serde_json::from_value(json!({
            "id": "cus_1",
            "name": "本田 康彦",
            "name_kana": null,
            "email": "",
            "phone": "090-1234-5678"
        }))
        .unwrap();
        let customer = map_customer(dto);
        assert_eq!(customer.email(), None);
        assert_eq!(customer.phone(), Some("090-1234-5678"));
        assert_eq!(customer.id(), &CustomerId::new("cus_1"));
    }

    #[test]
    fn a_visitor_taken_by_phone_is_posted_without_an_email_key_at_all() {
        let input =
            NewCustomer::try_new("本田 康彦", None, None, Some("090-1234-5678".into())).unwrap();
        let body = new_customer_body(&input);
        assert_eq!(body["name"], json!("本田 康彦"));
        assert_eq!(body["phone"], json!("090-1234-5678"));
        assert!(body.get("email").is_none());
        assert!(body.get("name_kana").is_none());
    }
}
