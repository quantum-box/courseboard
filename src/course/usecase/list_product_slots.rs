//! ListProductSlotsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, ProductSlot, ReservationServiceId,
};

pub struct ListProductSlotsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListProductSlotsUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        service_id: &ReservationServiceId,
    ) -> Result<Vec<ProductSlot>, CourseError> {
        credentials.require(actions::LIST_PRODUCTS).await?;
        if service_id.trim().is_empty() {
            return Err(CourseError::BadRequest(
                "reservation service id is required",
            ));
        }
        self.catalog
            .list_product_slots(credentials, service_id)
            .await
    }
}
