//! SDK-backed adapter for TACHYON Field client capabilities.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::Method;
use serde::Deserialize;

use super::field_gateway::{map_field_status_error, normalize_base_url};
use crate::course::domain::{
    CourseError, FieldAgentDocumentCapabilities, FieldCancellationFeeCapabilities,
    FieldCapabilitiesGateway, FieldCapabilityCoverage, FieldClientCapabilities,
    FieldDocumentQueueCapabilities, FieldOtherBusinessCapabilities, FieldRequestContext,
};

const FIELD_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Stores endpoint configuration only. Authentication and tenant selection are
/// deliberately supplied per call through `FieldRequestContext`.
pub struct FieldSdkCapabilitiesGateway {
    base_url: String,
}

/// The checked-in Field SDK predates the cancellation-fee capability fields.
/// Keep the outbound configuration from that SDK, but decode the response
/// locally so CourseBoard can consume the additive fields before a regenerated
/// SDK revision is available. `cancellationFees`, `capabilityCoverage`, and
/// `otherBusiness` are optional for rolling deploys against an older Field API
/// and therefore fail closed.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientCapabilitiesResponse {
    agent_documents: AgentDocumentCapabilitiesResponse,
    #[serde(default)]
    cancellation_fees: Option<CancellationFeeCapabilitiesResponse>,
    #[serde(default)]
    capability_coverage: Option<String>,
    #[serde(default)]
    other_business: Option<OtherBusinessCapabilitiesResponse>,
}

#[derive(Debug, Deserialize)]
struct AgentDocumentCapabilitiesResponse {
    invoices: DocumentQueueCapabilitiesResponse,
    quotations: DocumentQueueCapabilitiesResponse,
}

#[derive(Debug, Deserialize)]
struct DocumentQueueCapabilitiesResponse {
    list: bool,
    send: bool,
}

#[derive(Debug, Deserialize)]
struct CancellationFeeCapabilitiesResponse {
    list: bool,
    manage: bool,
}

#[derive(Debug, Deserialize)]
struct OtherBusinessCapabilitiesResponse {
    #[serde(default)]
    has_any: Option<bool>,
    #[serde(default)]
    reservations: bool,
    #[serde(default)]
    hrm: bool,
    #[serde(default)]
    customers: bool,
    #[serde(default)]
    memberships: bool,
    #[serde(default)]
    usage: bool,
}

impl FieldSdkCapabilitiesGateway {
    pub fn new(field_api_url: Option<&str>) -> Self {
        Self {
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl FieldCapabilitiesGateway for FieldSdkCapabilitiesGateway {
    async fn get_client_capabilities(
        &self,
        context: &FieldRequestContext,
    ) -> Result<FieldClientCapabilities, CourseError> {
        // Configuration contains the delegated bearer and tenant headers, so
        // it must remain a request-local value and must never enter AppState.
        let mut configuration = field_sdk::field::configuration_for_platform(
            context.access_token(),
            context.operator_id(),
            context.platform_id(),
        )
        .map_err(|error| {
            CourseError::Provider(format!("Field SDK tenant configuration failed: {error}"))
        })?;
        configuration.base_path = self.base_url.clone();

        let url = format!("{}/v1/field/client-capabilities", configuration.base_path);
        let response = tokio::time::timeout(
            FIELD_REQUEST_TIMEOUT,
            configuration
                .client
                .request(Method::GET, url)
                .bearer_auth(context.access_token())
                .send(),
        )
        .await
        .map_err(|_| CourseError::Provider("Field API request timed out".to_string()))?
        .map_err(|error| {
            if error.is_timeout() {
                CourseError::Provider("Field API request timed out".to_string())
            } else {
                CourseError::Provider(format!("Field API request failed: {error}"))
            }
        })?;

        let status = response.status();
        let body = response.text().await.map_err(|error| {
            CourseError::Provider(format!("Field capabilities response read failed: {error}"))
        })?;
        if !status.is_success() {
            return Err(map_field_status_error(status, &body));
        }
        let response =
            serde_json::from_str::<ClientCapabilitiesResponse>(&body).map_err(|error| {
                CourseError::Provider(format!(
                    "Field capabilities response decode failed: {error}"
                ))
            })?;

        let invoices = response.agent_documents.invoices;
        let quotations = response.agent_documents.quotations;
        let cancellation_fees = response
            .cancellation_fees
            .map(|value| FieldCancellationFeeCapabilities {
                list: value.list,
                manage: value.manage,
            })
            .unwrap_or(FieldCancellationFeeCapabilities {
                list: false,
                manage: false,
            });
        let capability_coverage = match response.capability_coverage.as_deref() {
            Some("complete") => FieldCapabilityCoverage::Complete,
            _ => FieldCapabilityCoverage::Partial,
        };
        let other_business = response
            .other_business
            .map(|value| FieldOtherBusinessCapabilities {
                has_any: value.has_any.unwrap_or(false),
                reservations: value.reservations,
                hrm: value.hrm,
                customers: value.customers,
                memberships: value.memberships,
                usage: value.usage,
            })
            .unwrap_or_default();
        Ok(FieldClientCapabilities {
            capability_coverage,
            other_business,
            agent_documents: FieldAgentDocumentCapabilities {
                invoices: FieldDocumentQueueCapabilities {
                    list: invoices.list,
                    send: invoices.send,
                },
                quotations: FieldDocumentQueueCapabilities {
                    list: quotations.list,
                    send: quotations.send,
                },
            },
            cancellation_fees,
        })
    }
}
