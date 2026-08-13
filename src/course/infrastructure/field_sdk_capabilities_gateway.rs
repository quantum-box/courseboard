//! SDK-backed adapter for TACHYON Field client capabilities.

use std::time::Duration;

use async_trait::async_trait;
use field_sdk::apis::{
    tachyon_field_identity_api::{self, GetClientCapabilitiesError},
    Error as FieldSdkError,
};

use super::field_gateway::{map_field_status_error, normalize_base_url};
use crate::course::domain::{
    CourseError, FieldAgentDocumentCapabilities, FieldCapabilitiesGateway, FieldClientCapabilities,
    FieldDocumentQueueCapabilities, FieldRequestContext,
};

const FIELD_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Stores endpoint configuration only. Authentication and tenant selection are
/// deliberately supplied per call through `FieldRequestContext`.
pub struct FieldSdkCapabilitiesGateway {
    base_url: String,
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

        let response = tokio::time::timeout(
            FIELD_REQUEST_TIMEOUT,
            tachyon_field_identity_api::get_client_capabilities(&configuration),
        )
        .await
        .map_err(|_| CourseError::Provider("Field API request timed out".to_string()))?
        .map_err(map_sdk_error)?;

        let agent_documents = *response.agent_documents;
        let invoices = *agent_documents.invoices;
        let quotations = *agent_documents.quotations;
        Ok(FieldClientCapabilities {
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
        })
    }
}

fn map_sdk_error(error: FieldSdkError<GetClientCapabilitiesError>) -> CourseError {
    match error {
        FieldSdkError::ResponseError(response) => {
            map_field_status_error(response.status, &response.content)
        }
        FieldSdkError::Reqwest(error) => {
            CourseError::Provider(format!("Field API request failed: {error}"))
        }
        FieldSdkError::Serde(error) => {
            CourseError::Provider(format!("Field API response decode failed: {error}"))
        }
        FieldSdkError::Io(error) => CourseError::Provider(format!("Field SDK I/O failed: {error}")),
    }
}
