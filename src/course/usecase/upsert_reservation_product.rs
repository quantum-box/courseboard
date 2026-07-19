//! UpsertReservationProductUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCatalogGateway, ReservationProduct,
    UpsertReservationProduct,
};

pub struct UpsertReservationProductUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl UpsertReservationProductUseCase {
    pub fn new(catalog: Arc<dyn GolfCatalogGateway>) -> Self {
        Self { catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        input: UpsertReservationProduct,
    ) -> Result<ReservationProduct, CourseError> {
        self.catalog
            .upsert_reservation_product(credentials, input)
            .await
    }
}
