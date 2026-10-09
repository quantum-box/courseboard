//! Fetch the delegated caller's Field client capabilities.

use std::sync::Arc;

use crate::course::domain::{
    CourseError, FieldCapabilitiesGateway, FieldClientCapabilities, FieldRequestContext,
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
        _credentials: GatewayCredentials<'_>,
        context: FieldRequestContext,
    ) -> Result<FieldClientCapabilities, CourseError> {
        self.field.get_client_capabilities(&context).await
    }
}
