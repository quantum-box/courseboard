//! ListReservationProductsUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, ReservationProduct,
};

pub struct ListReservationProductsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListReservationProductsUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<ReservationProduct>, CourseError> {
        credentials.require(actions::LIST_PRODUCTS).await?;
        self.catalog.list_reservation_products(credentials).await
    }
}
