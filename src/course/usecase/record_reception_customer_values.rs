//! Retry filing CourseBoard-owned reception values after Field customer creation.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::Value;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CustomerGateway, CustomerId, CustomerReceptionField,
    CustomerReceptionFieldsGateway, CustomerReceptionValuesGateway, GatewayCredentials,
};

use super::create_reception_customer::{validate_reception_custom_values, values_to_persist};

pub struct RecordReceptionCustomerValuesUseCase {
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
    values: Arc<dyn CustomerReceptionValuesGateway>,
    customers: Arc<dyn CustomerGateway>,
}

impl RecordReceptionCustomerValuesUseCase {
    pub fn new(
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
        values: Arc<dyn CustomerReceptionValuesGateway>,
        customers: Arc<dyn CustomerGateway>,
    ) -> Self {
        Self {
            fields,
            values,
            customers,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        customer_id: &CustomerId,
        submitted: BTreeMap<String, Value>,
    ) -> Result<(), CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        self.customers
            .get_customer(credentials, customer_id)
            .await?;
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        let fields = CustomerReceptionField::merge_with_defaults(credentials.operator_id, stored);
        validate_reception_custom_values(&fields, &submitted)?;
        let values = values_to_persist(&fields, &submitted);
        self.values
            .record_customer_reception_values(credentials.operator_id, customer_id, &values)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        Customer, CustomerSearchQuery, NewCustomer, ReceptionFieldInput, ReceptionFieldKind,
        ReceptionFieldType,
    };

    struct StubFields;
    struct StubCustomers;

    #[async_trait]
    impl CustomerGateway for StubCustomers {
        async fn search_customers(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: &CustomerSearchQuery,
        ) -> Result<Vec<Customer>, CourseError> {
            unreachable!()
        }

        async fn get_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            customer_id: &CustomerId,
        ) -> Result<Customer, CourseError> {
            Ok(Customer::reconstitute(
                customer_id.clone(),
                "本田 康彦",
                None,
                None,
                None,
            ))
        }

        async fn create_customer(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewCustomer,
        ) -> Result<Customer, CourseError> {
            unreachable!()
        }
    }

    #[async_trait]
    impl CustomerReceptionFieldsGateway for StubFields {
        async fn list_customer_reception_fields(
            &self,
            tenant_id: &str,
        ) -> Result<Vec<CustomerReceptionField>, CourseError> {
            Ok(vec![CustomerReceptionField::try_new(
                tenant_id,
                ReceptionFieldInput {
                    field_key: "membership_class".to_string(),
                    kind: ReceptionFieldKind::Custom,
                    field_type: ReceptionFieldType::Select,
                    enabled: true,
                    required: true,
                    label: Some("会員区分".to_string()),
                    sort_order: 7,
                    options: vec!["正会員".to_string()],
                },
            )?])
        }

        async fn replace_customer_reception_fields(
            &self,
            _tenant_id: &str,
            _fields: &[CustomerReceptionField],
        ) -> Result<(), CourseError> {
            unreachable!()
        }
    }

    #[derive(Default)]
    struct StubValues {
        writes: Mutex<Vec<BTreeMap<String, Value>>>,
    }

    #[async_trait]
    impl CustomerReceptionValuesGateway for StubValues {
        async fn record_customer_reception_values(
            &self,
            _tenant_id: &str,
            _customer_id: &CustomerId,
            values: &BTreeMap<String, Value>,
        ) -> Result<(), CourseError> {
            self.writes.lock().unwrap().push(values.clone());
            Ok(())
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            caller_bearer: "Bearer caller",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    #[tokio::test]
    async fn retry_writes_only_to_the_existing_customer() {
        let values = Arc::new(StubValues::default());
        RecordReceptionCustomerValuesUseCase::new(
            Arc::new(StubFields),
            values.clone(),
            Arc::new(StubCustomers),
        )
        .execute(
            credentials(),
            &CustomerId::new("cus_existing"),
            BTreeMap::from([("membership_class".to_string(), serde_json::json!("正会員"))]),
        )
        .await
        .unwrap();
        assert_eq!(values.writes.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn retry_rejects_stale_keys_before_storage() {
        let values = Arc::new(StubValues::default());
        let error = RecordReceptionCustomerValuesUseCase::new(
            Arc::new(StubFields),
            values.clone(),
            Arc::new(StubCustomers),
        )
        .execute(
            credentials(),
            &CustomerId::new("cus_existing"),
            BTreeMap::from([("removed_field".to_string(), serde_json::json!("old"))]),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
        assert!(values.writes.lock().unwrap().is_empty());
    }
}
