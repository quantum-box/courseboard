use crate::course::domain::{
    data_exports::{data_export_objects, DataExportGateway, DataExportObject},
    CourseError, GatewayCredentials,
};
use std::{collections::HashMap, sync::Arc};

pub struct DataExportsUseCase {
    gateway: Arc<dyn DataExportGateway>,
}
impl DataExportsUseCase {
    pub fn new(gateway: Arc<dyn DataExportGateway>) -> Self {
        Self { gateway }
    }
    pub async fn objects(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<DataExportObject>, CourseError> {
        let mut decisions = HashMap::new();
        let mut objects = Vec::new();
        for object in data_export_objects() {
            let action = object.required_action();
            let allowed = if let Some(allowed) = decisions.get(action) {
                *allowed
            } else {
                let allowed = match credentials.require(action).await {
                    Ok(()) => true,
                    Err(CourseError::Forbidden(_)) => false,
                    Err(error) => return Err(error),
                };
                decisions.insert(action, allowed);
                allowed
            };
            if allowed {
                let mut object = object.clone();
                if object.key == "reception" {
                    object
                        .fields
                        .extend(self.gateway.custom_fields(credentials.operator_id).await?);
                }
                objects.push(object);
            }
        }
        Ok(objects)
    }
    pub async fn rows(
        &self,
        credentials: GatewayCredentials<'_>,
        key: &str,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<serde_json::Value>, CourseError> {
        let object = data_export_objects()
            .iter()
            .find(|object| object.key == key)
            .ok_or(CourseError::BadRequest("unknown data export source"))?;
        credentials.require(object.required_action()).await?;
        if offset > 100_000 || !(1..=500).contains(&limit) {
            return Err(CourseError::BadRequest("invalid data export page"));
        }
        self.gateway.rows(credentials, object, offset, limit).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{actions, data_exports::DataExportField, CourseAuthorizer};
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct SpyGateway(AtomicUsize);
    #[async_trait::async_trait]
    impl DataExportGateway for SpyGateway {
        async fn custom_fields(&self, tenant: &str) -> Result<Vec<DataExportField>, CourseError> {
            assert_eq!(tenant, "tenant-a");
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(vec![DataExportField {
                field: "custom.membership_type".into(),
                label: "Membership".into(),
            }])
        }
        async fn rows(
            &self,
            _: GatewayCredentials<'_>,
            _: &DataExportObject,
            _: u32,
            _: u32,
        ) -> Result<Vec<serde_json::Value>, CourseError> {
            panic!("a denied reader must not reach storage")
        }
    }
    struct CustomerReader;
    #[async_trait::async_trait]
    impl CourseAuthorizer for CustomerReader {
        async fn require(
            &self,
            _: GatewayCredentials<'_>,
            action: &'static str,
        ) -> Result<(), CourseError> {
            if action == actions::LIST_CUSTOMERS {
                Ok(())
            } else {
                Err(CourseError::Forbidden(action))
            }
        }
    }
    #[tokio::test]
    async fn data_export_refusal_happens_before_any_storage_read() {
        let gateway = Arc::new(SpyGateway(AtomicUsize::new(0)));
        let use_case = DataExportsUseCase::new(gateway.clone());
        let credentials = GatewayCredentials::for_outbound("Bearer caller", "tenant-a", None);
        assert!(matches!(
            use_case.rows(credentials, "reception", 0, 100).await,
            Err(CourseError::Forbidden(_))
        ));
        assert!(use_case.objects(credentials).await.unwrap().is_empty());
        assert_eq!(gateway.0.load(Ordering::SeqCst), 0);
    }
    #[tokio::test]
    async fn data_export_catalogue_only_discloses_permitted_sources_and_own_custom_fields() {
        let gateway = Arc::new(SpyGateway(AtomicUsize::new(0)));
        let credentials = GatewayCredentials {
            authorization: "Bearer caller",
            caller_bearer: "Bearer caller",
            operator_id: "tenant-a",
            platform_id: None,
            authorizer: &CustomerReader,
        };
        let objects = DataExportsUseCase::new(gateway.clone())
            .objects(credentials)
            .await
            .unwrap();
        assert!(objects
            .iter()
            .all(|object| object.required_action() == actions::LIST_CUSTOMERS));
        assert!(objects
            .iter()
            .find(|object| object.key == "reception")
            .unwrap()
            .fields
            .iter()
            .any(|field| field.field == "custom.membership_type"));
        assert!(!objects.iter().any(|object| object.key == "payroll"));
        assert_eq!(gateway.0.load(Ordering::SeqCst), 1);
    }
}
