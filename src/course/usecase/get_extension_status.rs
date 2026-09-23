//! GetExtensionStatusUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, ExtensionStatus, GatewayCredentials, GolfCommercialGateway,
};

pub struct GetExtensionStatusUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl GetExtensionStatusUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<ExtensionStatus>, CourseError> {
        credentials.require(actions::LIST_EXTENSION_STATUS).await?;
        self.commercial.get_extension_status(credentials).await
    }
}
