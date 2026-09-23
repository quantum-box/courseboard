//! ReplaceProductSlotsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, ProductSlot, ReservationServiceId,
};

pub struct ReplaceProductSlotsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ReplaceProductSlotsUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &ReservationServiceId,
        slots: Vec<ProductSlot>,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        credentials.require(actions::MANAGE_PRODUCTS).await?;
        if service_id.trim().is_empty() {
            return Err(CourseError::BadRequest(
                "reservation service id is required",
            ));
        }
        self.catalog
            .replace_product_slots(credentials, service_id, slots)
            .await
    }
}
