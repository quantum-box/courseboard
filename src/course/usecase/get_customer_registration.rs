//! GetCustomerRegistrationUseCase: one use case, one public entrypoint
//! (`execute`).
//!
//! Where this ledger entry came from. Absent for everybody registered before
//! CourseBoard started keeping it, which is most of the ledger for a long
//! while — the screen shows that as "not recorded", not as an error.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerId, CustomerRegistration, CustomerRegistrationGateway, GatewayCredentials,
};

pub struct GetCustomerRegistrationUseCase {
    registrations: Arc<dyn CustomerRegistrationGateway>,
}

impl GetCustomerRegistrationUseCase {
    pub fn new(registrations: Arc<dyn CustomerRegistrationGateway>) -> Self {
        Self { registrations }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
    ) -> Result<Option<CustomerRegistration>, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        self.registrations
            .get_customer_registration(credentials.operator_id, customer_id)
            .await
    }
}
