//! Field ERP membership registry client (`/v1/erp/membership/*`).
//!
//! Field's membership surface is camelCase, unlike its StoreKit customer
//! surface. Both are wrapped here so nothing above the gateway has to keep
//! track of which upstream spells a key which way.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::course::domain::{
    AssignMembershipPlan, CourseError, CustomerId, CustomerMembership, GatewayCredentials,
    MembershipGateway, MembershipPlan, MembershipPlanId, UpsertMembershipPlan,
};

use super::field_gateway::{field_send_json, normalize_base_url, urlencoding_path};

/// Reads and writes the tenant's membership plans and assignments.
pub struct FieldMembershipGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldMembershipGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl MembershipGateway for FieldMembershipGateway {
    async fn list_membership_plans(
        &self,
        credentials: GatewayCredentials<'_>,
        include_inactive: bool,
    ) -> Result<Vec<MembershipPlan>, CourseError> {
        let path = format!("/v1/erp/membership/plans?includeInactive={include_inactive}");
        let response: FieldMembershipPlanListDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;
        Ok(response.items.into_iter().map(map_plan).collect())
    }

    async fn create_membership_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &UpsertMembershipPlan,
    ) -> Result<MembershipPlan, CourseError> {
        let dto: FieldMembershipPlanDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            "/v1/erp/membership/plans",
            credentials,
            Some(&create_plan_body(input)),
        )
        .await?;
        Ok(map_plan(dto))
    }

    async fn update_membership_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        plan_id: &MembershipPlanId,
        input: &UpsertMembershipPlan,
    ) -> Result<MembershipPlan, CourseError> {
        let path = format!(
            "/v1/erp/membership/plans/{}",
            urlencoding_path(plan_id.as_str())
        );
        let dto: FieldMembershipPlanDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::PATCH,
            &path,
            credentials,
            Some(&update_plan_body(input)),
        )
        .await?;
        Ok(map_plan(dto))
    }

    async fn get_customer_membership(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<CustomerMembership, CourseError> {
        let path = format!(
            "/v1/erp/membership/customers/{}",
            urlencoding_path(customer_id.as_str())
        );
        let view: FieldMembershipViewDto = match field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await
        {
            Ok(view) => view,
            // Somebody who has never been given a membership is a visitor, and
            // the desk asks this about every customer they book. Turning that
            // into an error would put a failure banner on the ordinary case.
            Err(CourseError::UpstreamClient { status: 404, .. }) => {
                return Ok(CustomerMembership::visitor(customer_id))
            }
            Err(error) => return Err(error),
        };
        Ok(map_membership(customer_id, view))
    }

    async fn assign_membership_plan(
        &self,
        credentials: GatewayCredentials<'_>,
        input: &AssignMembershipPlan,
    ) -> Result<CustomerMembership, CourseError> {
        let path = format!(
            "/v1/erp/membership/customers/{}/plan-assignments",
            urlencoding_path(input.customer_id.as_str())
        );
        let mut body = Map::new();
        body.insert("planId".into(), json!(input.plan_id.as_str()));
        if let Some(value) = input.started_on.as_deref() {
            body.insert("startedOn".into(), json!(value));
        }
        if let Some(value) = input.note.as_deref() {
            body.insert("note".into(), json!(value));
        }
        // The assignment response carries no plan, only ids. Re-read the view
        // so the caller gets the membership as it now stands rather than a
        // shape it would have to resolve the plan name out of itself.
        let _: Value = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &path,
            credentials,
            Some(&Value::Object(body)),
        )
        .await?;
        self.get_customer_membership(credentials, &input.customer_id)
            .await
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipPlanListDto {
    #[serde(default)]
    items: Vec<FieldMembershipPlanDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipPlanDto {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    fee_jpy: Option<i64>,
    #[serde(default)]
    valid_days: Option<i32>,
    #[serde(default = "default_true")]
    active: bool,
    #[serde(default)]
    sort_order: i32,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipViewDto {
    #[serde(default)]
    active_plan: Option<FieldMembershipPlanDto>,
    #[serde(default)]
    active_assignment: Option<FieldMembershipAssignmentDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipAssignmentDto {
    #[serde(default)]
    started_on: Option<String>,
}

fn map_plan(dto: FieldMembershipPlanDto) -> MembershipPlan {
    MembershipPlan::reconstitute(
        dto.id,
        dto.name.unwrap_or_default(),
        dto.description,
        dto.fee_jpy,
        dto.valid_days,
        dto.active,
        dto.sort_order,
    )
}

fn map_membership(customer_id: &CustomerId, view: FieldMembershipViewDto) -> CustomerMembership {
    CustomerMembership::reconstitute(
        customer_id.clone(),
        view.active_plan.map(map_plan),
        view.active_assignment.and_then(|value| value.started_on),
    )
}

fn create_plan_body(input: &UpsertMembershipPlan) -> Value {
    let mut body = Map::new();
    body.insert("name".into(), json!(input.name));
    if let Some(value) = input.description.as_deref() {
        body.insert("description".into(), json!(value));
    }
    if let Some(value) = input.fee_jpy {
        body.insert("feeJpy".into(), json!(value));
    }
    if let Some(value) = input.valid_days {
        body.insert("validDays".into(), json!(value));
    }
    if let Some(value) = input.sort_order {
        body.insert("sortOrder".into(), json!(value));
    }
    Value::Object(body)
}

/// Field's plan update reads an explicit `null` as "clear this field" and an
/// absent key as "leave it alone". The editor always sends the whole plan, so
/// a field the desk emptied is sent as `null` on purpose — omitting it would
/// make clearing a fee impossible.
fn update_plan_body(input: &UpsertMembershipPlan) -> Value {
    let mut body = Map::new();
    body.insert("name".into(), json!(input.name));
    body.insert("description".into(), json!(input.description));
    body.insert("feeJpy".into(), json!(input.fee_jpy));
    body.insert("validDays".into(), json!(input.valid_days));
    if let Some(value) = input.sort_order {
        body.insert("sortOrder".into(), json!(value));
    }
    if let Some(value) = input.active {
        body.insert("active".into(), json!(value));
    }
    Value::Object(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_customer_holding_a_plan_reads_as_a_member_of_that_plan() {
        let view: FieldMembershipViewDto = serde_json::from_value(json!({
            "customer": { "id": "cus_1", "name": "本田 康彦" },
            "activePlan": {
                "id": "plan_1",
                "name": "正会員",
                "feeJpy": 120000,
                "active": true,
                "sortOrder": 0
            },
            "activeAssignment": {
                "id": "asg_1",
                "customerId": "cus_1",
                "planId": "plan_1",
                "status": "active",
                "startedOn": "2026-04-01"
            }
        }))
        .unwrap();
        let membership = map_membership(&CustomerId::new("cus_1"), view);
        assert!(membership.is_member());
        assert_eq!(membership.plan_name(), Some("正会員"));
        assert_eq!(membership.started_on(), Some("2026-04-01"));
    }

    #[test]
    fn a_customer_with_no_assignment_reads_as_a_visitor() {
        let view: FieldMembershipViewDto = serde_json::from_value(json!({
            "customer": { "id": "cus_2", "name": "増田 公陽" },
            "activePlan": null,
            "activeAssignment": null
        }))
        .unwrap();
        let membership = map_membership(&CustomerId::new("cus_2"), view);
        assert!(!membership.is_member());
        assert_eq!(membership.plan_name(), None);
    }

    #[test]
    fn clearing_a_fee_is_sent_as_an_explicit_null_rather_than_omitted() {
        // An absent key means "leave it alone" upstream, so omitting the fee
        // would make a fee the desk deleted come back on the next read.
        let input =
            UpsertMembershipPlan::try_new("平日会員", None, None, None, None, Some(true)).unwrap();
        let body = update_plan_body(&input);
        assert_eq!(body["feeJpy"], Value::Null);
        assert_eq!(body["description"], Value::Null);
        assert_eq!(body["active"], json!(true));
    }

    #[test]
    fn creating_a_plan_omits_what_the_desk_left_blank() {
        let input =
            UpsertMembershipPlan::try_new("正会員", None, Some(120_000), None, None, None).unwrap();
        let body = create_plan_body(&input);
        assert_eq!(body["name"], json!("正会員"));
        assert_eq!(body["feeJpy"], json!(120_000));
        assert!(body.get("description").is_none());
        assert!(body.get("validDays").is_none());
    }
}
