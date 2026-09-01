//! Field membership activity reader.
//!
//! Membership activities are authoritative in Field and are never persisted
//! in CourseBoard.  This adapter owns the provider's wire spelling and keeps
//! the rest of the application independent of Field HTTP and JSON details.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::course::domain::{
    CourseError, CustomerId, GatewayCredentials, MembershipActivity, MembershipActivityActor,
    MembershipActivityGateway, MembershipActivityPage, MembershipActivityQuery,
    MembershipActivitySource, MembershipActivityTarget,
};

use super::field_gateway::{field_send_json, normalize_base_url, urlencoding_path};

/// Reads the append-only membership activity feed from Field.
pub struct FieldMembershipActivityGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldMembershipActivityGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl MembershipActivityGateway for FieldMembershipActivityGateway {
    async fn list_membership_activities(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        query: &MembershipActivityQuery,
    ) -> Result<MembershipActivityPage, CourseError> {
        let path = format!(
            "/v1/erp/membership/customers/{}/activities?{}",
            urlencoding_path(customer_id.as_str()),
            activity_query_string(query)?
        );
        let response: FieldMembershipActivityPageDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::GET,
            &path,
            credentials,
            None,
        )
        .await?;

        Ok(MembershipActivityPage {
            items: response
                .items
                .into_iter()
                .map(map_activity)
                .collect::<Result<Vec<_>, _>>()?,
            next_cursor: response.next_cursor,
        })
    }
}

fn activity_query_string(query: &MembershipActivityQuery) -> Result<String, CourseError> {
    let mut params = vec![("limit", query.limit.to_string())];
    if let Some(cursor) = query.cursor.as_deref() {
        params.push(("cursor", cursor.to_string()));
    }
    serde_urlencoded::to_string(params)
        .map_err(|error| CourseError::Provider(format!("failed to encode activity query: {error}")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipActivityPageDto {
    items: Vec<FieldMembershipActivityDto>,
    #[serde(default, alias = "next_cursor")]
    next_cursor: Option<String>,
}

/// Field's activity DTO.  The nested actor/source/target form is the v1
/// contract.  A few aliases make the reader tolerant of older deployments
/// that returned the same values as flat camelCase keys; that tolerance is
/// important because this proxy must not turn a provider-side additive change
/// into a CourseBoard outage.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldMembershipActivityDto {
    id: String,
    kind: String,
    occurred_at: DateTime<Utc>,
    #[serde(default)]
    actor: Option<FieldActivityActorDto>,
    #[serde(default)]
    actor_type: Option<String>,
    #[serde(default)]
    actor_id: Option<String>,
    #[serde(default)]
    source: Option<FieldActivitySourceDto>,
    #[serde(default)]
    source_channel: Option<String>,
    #[serde(default)]
    source_application: Option<String>,
    #[serde(default)]
    target: Option<FieldActivityTargetDto>,
    #[serde(default)]
    target_type: Option<String>,
    #[serde(default)]
    target_id: Option<String>,
    #[serde(default)]
    before: Option<Value>,
    #[serde(default)]
    after: Option<Value>,
    schema_version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldActivityActorDto {
    #[serde(
        rename = "type",
        alias = "kind",
        alias = "actorType",
        alias = "actor_type"
    )]
    kind: String,
    #[serde(alias = "actorId", alias = "actor_id")]
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldActivitySourceDto {
    #[serde(default, alias = "sourceChannel", alias = "source_channel")]
    channel: Option<String>,
    #[serde(default, alias = "sourceApplication", alias = "source_application")]
    application: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldActivityTargetDto {
    #[serde(
        rename = "type",
        alias = "kind",
        alias = "targetType",
        alias = "target_type"
    )]
    kind: String,
    #[serde(default, alias = "targetId", alias = "target_id")]
    id: Option<String>,
}

fn map_activity(dto: FieldMembershipActivityDto) -> Result<MembershipActivity, CourseError> {
    let actor = dto
        .actor
        .map(|actor| MembershipActivityActor {
            kind: actor.kind,
            id: actor.id,
        })
        .or_else(|| {
            dto.actor_type
                .zip(dto.actor_id)
                .map(|(kind, id)| MembershipActivityActor { kind, id })
        })
        .ok_or_else(|| {
            CourseError::Provider("Field membership activity response is missing actor".to_string())
        })?;
    if actor.kind.trim().is_empty() || actor.id.trim().is_empty() {
        return Err(CourseError::Provider(
            "Field membership activity response contains an invalid actor".to_string(),
        ));
    }

    let source = dto.source.or_else(|| {
        if dto.source_channel.is_some() || dto.source_application.is_some() {
            Some(FieldActivitySourceDto {
                channel: dto.source_channel,
                application: dto.source_application,
            })
        } else {
            None
        }
    });

    let target = dto
        .target
        .map(|target| MembershipActivityTarget {
            kind: target.kind,
            id: target.id,
        })
        .or_else(|| {
            dto.target_type.map(|kind| MembershipActivityTarget {
                kind,
                id: dto.target_id,
            })
        });
    if let Some(target) = target.as_ref() {
        if target.kind.trim().is_empty()
            || target.id.as_deref().is_some_and(|id| id.trim().is_empty())
        {
            return Err(CourseError::Provider(
                "Field membership activity response contains an invalid target".to_string(),
            ));
        }
    }

    if dto.id.trim().is_empty() || dto.kind.trim().is_empty() {
        return Err(CourseError::Provider(
            "Field membership activity response contains an invalid id or kind".to_string(),
        ));
    }

    Ok(MembershipActivity {
        id: dto.id,
        kind: dto.kind,
        occurred_at: dto.occurred_at,
        actor,
        source: source.map(|source| MembershipActivitySource {
            channel: source.channel,
            application: source.application,
        }),
        target,
        before: dto.before,
        after: dto.after,
        schema_version: dto.schema_version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        extract::State,
        http::{Request, StatusCode},
        response::{IntoResponse, Response},
        routing::any,
        Json, Router,
    };
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct ActivityServerState {
        status: StatusCode,
        request: Arc<Mutex<Option<ActivityRequest>>>,
    }

    #[derive(Debug, Clone)]
    struct ActivityRequest {
        uri: String,
        authorization: Option<String>,
        operator_id: Option<String>,
        platform_id: Option<String>,
    }

    async fn activity_endpoint(
        State(state): State<ActivityServerState>,
        request: Request<Body>,
    ) -> Response {
        let headers = request.headers();
        *state.request.lock().expect("request lock") = Some(ActivityRequest {
            uri: request.uri().to_string(),
            authorization: headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
            operator_id: headers
                .get("x-operator-id")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
            platform_id: headers
                .get("x-platform-id")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
        });
        if state.status.is_success() {
            (
                state.status,
                Json(json!({
                    "items": [{
                        "id": "mact_1",
                        "kind": "membership.future_event",
                        "occurredAt": "2026-09-01T00:00:00Z",
                        "actor": { "type": "service_account", "id": "svc_1" },
                        "source": { "channel": null, "application": null },
                        "target": { "type": "consent", "id": null },
                        "before": null,
                        "after": { "future": true },
                        "schemaVersion": 1
                    }],
                    "nextCursor": "next"
                })),
            )
                .into_response()
        } else {
            (state.status, "upstream failure").into_response()
        }
    }

    async fn spawn_activity_server(
        status: StatusCode,
    ) -> (String, ActivityServerState, tokio::task::JoinHandle<()>) {
        let state = ActivityServerState {
            status,
            request: Arc::new(Mutex::new(None)),
        };
        let app = Router::new()
            .fallback(any(activity_endpoint))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock Field");
        let address = listener.local_addr().expect("mock Field address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve mock Field");
        });
        (format!("http://{address}"), state, server)
    }

    fn activity_credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer activity-token",
            operator_id: "operator-activity",
            platform_id: Some("platform-activity"),
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer caller-token",
        }
    }

    #[test]
    fn query_uses_limit_and_percent_encodes_cursor() {
        let query =
            MembershipActivityQuery::try_new(Some(5), Some("eyJ0eXBlIjoi/".into())).unwrap();
        let encoded = activity_query_string(&query).unwrap();
        assert_eq!(encoded, "limit=5&cursor=eyJ0eXBlIjoi%2F");
    }

    #[test]
    fn nested_wire_shape_keeps_string_kind_and_json_snapshots() {
        let dto: FieldMembershipActivityDto = serde_json::from_value(json!({
            "id": "mact_01",
            "kind": "membership.future_event",
            "occurredAt": "2026-09-01T00:00:00Z",
            "actor": { "type": "service_account", "id": "svc_1" },
            "source": { "channel": null, "application": null },
            "target": { "type": "customer", "id": "cus_1" },
            "before": null,
            "after": { "newField": [1, 2] },
            "schemaVersion": 1
        }))
        .unwrap();
        let activity = map_activity(dto).unwrap();
        assert_eq!(activity.kind, "membership.future_event");
        assert_eq!(activity.actor.kind, "service_account");
        assert_eq!(activity.source.as_ref().unwrap().application, None);
        assert_eq!(activity.after, Some(json!({ "newField": [1, 2] })));
    }

    #[test]
    fn flat_legacy_shape_is_read_without_losing_the_snapshots() {
        let dto: FieldMembershipActivityDto = serde_json::from_value(json!({
            "id": "mact_02",
            "kind": "membership.subject_updated",
            "occurredAt": "2026-09-01T00:00:00Z",
            "actorType": "user",
            "actorId": "usr_1",
            "sourceChannel": "store",
            "targetType": "subject",
            "targetId": "sub_1",
            "schemaVersion": 1,
            "before": { "name": "旧" },
            "after": { "name": "新" }
        }))
        .unwrap();
        let activity = map_activity(dto).unwrap();
        assert_eq!(activity.actor.id, "usr_1");
        assert_eq!(activity.source.unwrap().channel.as_deref(), Some("store"));
        assert_eq!(activity.target.as_ref().unwrap().kind, "subject");
        assert_eq!(activity.before, Some(json!({ "name": "旧" })));
    }

    #[test]
    fn missing_actor_is_a_provider_response_error_not_an_empty_actor() {
        let dto: FieldMembershipActivityDto = serde_json::from_value(json!({
            "id": "mact_missing_actor",
            "kind": "membership.subject_updated",
            "occurredAt": "2026-09-01T00:00:00Z",
            "schemaVersion": 1,
            "target": { "type": "subject", "id": "sub_1" }
        }))
        .unwrap();
        assert!(matches!(
            map_activity(dto),
            Err(CourseError::Provider(message)) if message.contains("missing actor")
        ));
    }

    #[test]
    fn empty_actor_values_are_a_provider_response_error() {
        let dto: FieldMembershipActivityDto = serde_json::from_value(json!({
            "id": "mact_empty_actor",
            "kind": "membership.subject_updated",
            "occurredAt": "2026-09-01T00:00:00Z",
            "schemaVersion": 1,
            "actor": { "type": "", "id": "" }
        }))
        .unwrap();
        assert!(matches!(
            map_activity(dto),
            Err(CourseError::Provider(message)) if message.contains("invalid actor")
        ));
    }

    #[test]
    fn required_page_and_schema_fields_are_not_silently_defaulted() {
        assert!(serde_json::from_value::<FieldMembershipActivityPageDto>(json!({})).is_err());
        assert!(serde_json::from_value::<FieldMembershipActivityDto>(json!({
            "id": "mact_1",
            "kind": "membership.subject_updated",
            "occurredAt": "2026-09-01T00:00:00Z",
            "actor": { "type": "user", "id": "u_1" }
        }))
        .is_err());
    }

    #[test]
    fn empty_target_ids_are_a_provider_response_error() {
        let dto: FieldMembershipActivityDto = serde_json::from_value(json!({
            "id": "mact_empty_target",
            "kind": "membership.subject_updated",
            "occurredAt": "2026-09-01T00:00:00Z",
            "schemaVersion": 1,
            "actor": { "type": "user", "id": "u_1" },
            "target": { "type": "subject", "id": "" }
        }))
        .unwrap();
        assert!(matches!(
            map_activity(dto),
            Err(CourseError::Provider(message)) if message.contains("invalid target")
        ));
    }

    #[tokio::test]
    async fn forwards_bearer_operator_platform_and_preserves_page() {
        let (base_url, state, server) = spawn_activity_server(StatusCode::OK).await;
        let gateway = FieldMembershipActivityGateway::new(reqwest::Client::new(), Some(&base_url));
        let customer_id = CustomerId::new("customer/1");
        let query = MembershipActivityQuery::try_new(Some(7), Some("opaque/?".into())).unwrap();
        let page = gateway
            .list_membership_activities(activity_credentials(), &customer_id, &query)
            .await
            .expect("activity page");

        assert_eq!(page.next_cursor.as_deref(), Some("next"));
        assert_eq!(
            page.items[0]
                .target
                .as_ref()
                .and_then(|target| target.id.as_deref()),
            None
        );
        let request = state
            .request
            .lock()
            .expect("request lock")
            .clone()
            .expect("captured request");
        assert_eq!(
            request.uri,
            "/v1/erp/membership/customers/customer%2F1/activities?limit=7&cursor=opaque%2F%3F"
        );
        assert_eq!(
            request.authorization.as_deref(),
            Some("Bearer activity-token")
        );
        assert_eq!(request.operator_id.as_deref(), Some("operator-activity"));
        assert_eq!(request.platform_id.as_deref(), Some("platform-activity"));
        server.abort();
    }

    #[tokio::test]
    async fn field_404_is_not_converted_to_an_empty_page() {
        let (base_url, _state, server) = spawn_activity_server(StatusCode::NOT_FOUND).await;
        let gateway = FieldMembershipActivityGateway::new(reqwest::Client::new(), Some(&base_url));
        let query = MembershipActivityQuery::try_new(None, None).unwrap();
        let error = gateway
            .list_membership_activities(activity_credentials(), &CustomerId::new("cus_1"), &query)
            .await
            .expect_err("Field 404");
        assert!(matches!(
            error,
            CourseError::UpstreamClient { status: 404, .. }
        ));
        server.abort();
    }

    #[tokio::test]
    async fn field_5xx_remains_a_provider_failure() {
        let (base_url, _state, server) = spawn_activity_server(StatusCode::BAD_GATEWAY).await;
        let gateway = FieldMembershipActivityGateway::new(reqwest::Client::new(), Some(&base_url));
        let query = MembershipActivityQuery::try_new(None, None).unwrap();
        let error = gateway
            .list_membership_activities(activity_credentials(), &CustomerId::new("cus_1"), &query)
            .await
            .expect_err("Field 502");
        assert!(matches!(error, CourseError::Provider(message) if message.contains("502")));
        server.abort();
    }
}
