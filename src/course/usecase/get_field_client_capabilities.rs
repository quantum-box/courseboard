//! Fetch the delegated caller's Field client capabilities.

use std::sync::Arc;

use crate::course::domain::{
    actions, CourseError, FieldCapabilitiesGateway, FieldClientCapabilities, FieldRequestContext,
    GatewayCredentials,
};

pub struct GetFieldClientCapabilitiesUseCase {
    field: Arc<dyn FieldCapabilitiesGateway>,
}

impl GetFieldClientCapabilitiesUseCase {
    pub fn new(field: Arc<dyn FieldCapabilitiesGateway>) -> Self {
        Self { field }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        context: FieldRequestContext,
    ) -> Result<FieldClientCapabilities, CourseError> {
        credentials.require(actions::LIST_EXTENSION_STATUS).await?;
        self.field.get_client_capabilities(&context).await
    }
}
