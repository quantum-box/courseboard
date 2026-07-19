//! UpdateExtensionConfigUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, UpdateExtensionConfig,
};

pub struct UpdateExtensionConfigUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl UpdateExtensionConfigUseCase {
    pub fn new(commercial: Arc<dyn GolfCommercialGateway>) -> Self {
        Self { commercial }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpdateExtensionConfig,
    ) -> Result<(), CourseError> {
        self.commercial
            .update_extension_config(credentials, input)
            .await
    }
}
