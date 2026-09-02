//! DraftCustomerReceptionUseCase: one use case, one public entrypoint (`execute`).
//!
//! Turns a scanned reception sheet into rows the desk can check. Deliberately
//! not a create: nothing here writes to the ledger, because a name read off a
//! photo and registered unseen is a duplicate nobody notices until the member
//! complains. The desk approves each row on the screen that shows the original
//! beside it, and registration goes through `CreateCustomerUseCase` as usual.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    active_reception_consent_definitions, reception_sheet_schema_for_fields_and_consents,
    CourseError, CustomerConsentCatalogGateway, CustomerReceptionField,
    CustomerReceptionFieldsGateway, CustomerReceptionOcrGateway, GatewayCredentials,
    ReceptionDraft, ReceptionSheet,
};

pub struct DraftCustomerReceptionUseCase {
    reader: Arc<dyn CustomerReceptionOcrGateway>,
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
    consents: Arc<dyn CustomerConsentCatalogGateway>,
}

impl DraftCustomerReceptionUseCase {
    pub fn new(
        reader: Arc<dyn CustomerReceptionOcrGateway>,
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
        consents: Arc<dyn CustomerConsentCatalogGateway>,
    ) -> Self {
        Self {
            reader,
            fields,
            consents,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        sheet: ReceptionSheet,
    ) -> Result<ReceptionDraft, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        let fields = CustomerReceptionField::merge_with_defaults(credentials.operator_id, stored);
        let catalog = self.consents.list_consent_items(credentials, false).await?;
        let consents = active_reception_consent_definitions(&catalog);
        reception_sheet_schema_for_fields_and_consents(&fields, &consents)?;
        self.reader
            .draft_reception(credentials, sheet, &fields, &consents)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::course::domain::{
        CreateCustomerConsentItem, CustomerConsentCatalogGateway, CustomerConsentItem,
        ReceptionConsentDefinition, ReceptionDraftRow, ReceptionFormProposal,
        ReceptionSheetMediaType,
    };

    struct StubReader {
        seen: Mutex<Vec<ReceptionSheetMediaType>>,
        answer: Mutex<Option<Result<ReceptionDraft, CourseError>>>,
    }

    impl StubReader {
        fn answering(answer: Result<ReceptionDraft, CourseError>) -> Self {
            Self {
                seen: Mutex::new(Vec::new()),
                answer: Mutex::new(Some(answer)),
            }
        }
    }

    #[async_trait]
    impl CustomerReceptionOcrGateway for StubReader {
        async fn draft_reception(
            &self,
            _credentials: GatewayCredentials<'_>,
            sheet: ReceptionSheet,
            _fields: &[CustomerReceptionField],
            _consents: &[ReceptionConsentDefinition],
        ) -> Result<ReceptionDraft, CourseError> {
            self.seen.lock().unwrap().push(sheet.media_type());
            self.answer.lock().unwrap().take().expect("one call")
        }

        async fn analyze_reception_form(
            &self,
            _credentials: GatewayCredentials<'_>,
            _sheet: ReceptionSheet,
        ) -> Result<ReceptionFormProposal, CourseError> {
            unreachable!("not used by this use case")
        }
    }

    #[derive(Default)]
    struct StubFields;

    #[derive(Default)]
    struct StubConsents;

    #[async_trait]
    impl CustomerConsentCatalogGateway for StubConsents {
        async fn list_consent_items(
            &self,
            _credentials: GatewayCredentials<'_>,
            _include_inactive: bool,
        ) -> Result<Vec<CustomerConsentItem>, CourseError> {
            Ok(Vec::new())
        }

        async fn create_consent_item(
            &self,
            _credentials: GatewayCredentials<'_>,
            _item: &CreateCustomerConsentItem,
        ) -> Result<CustomerConsentItem, CourseError> {
            unreachable!("not used by this use case")
        }
    }

    #[async_trait]
    impl CustomerReceptionFieldsGateway for StubFields {
        async fn list_customer_reception_fields(
            &self,
            _tenant_id: &str,
        ) -> Result<Vec<CustomerReceptionField>, CourseError> {
            Ok(Vec::new())
        }

        async fn replace_customer_reception_fields(
            &self,
            _tenant_id: &str,
            _fields: &[CustomerReceptionField],
        ) -> Result<(), CourseError> {
            unreachable!("not used by this use case")
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer token",
            operator_id: "tenant-1",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    fn sheet() -> ReceptionSheet {
        ReceptionSheet::try_new(vec![0xff, 0xd8, 0xff, 0x00], "image/jpeg").unwrap()
    }

    #[tokio::test]
    async fn a_scanned_group_comes_back_as_rows_to_check() {
        let reader = Arc::new(StubReader::answering(Ok(ReceptionDraft::new(
            vec![ReceptionDraftRow::new(
                Some("本田 康彦".into()),
                Some("ホンダ ヤスヒコ".into()),
                None,
                None,
            )],
            vec![],
        ))));
        let draft = DraftCustomerReceptionUseCase::new(
            reader.clone(),
            Arc::new(StubFields),
            Arc::new(StubConsents),
        )
        .execute(credentials(), sheet())
        .await
        .unwrap();
        assert_eq!(draft.rows().len(), 1);
        assert_eq!(draft.rows()[0].name_kana(), Some("ホンダ ヤスヒコ"));
        assert_eq!(
            reader.seen.lock().unwrap().as_slice(),
            [ReceptionSheetMediaType::Jpeg]
        );
    }

    #[tokio::test]
    async fn an_upstream_reader_that_is_down_surfaces_as_a_provider_failure() {
        let reader = Arc::new(StubReader::answering(Err(CourseError::Provider(
            "ocr provider unavailable".into(),
        ))));
        let error = DraftCustomerReceptionUseCase::new(
            reader,
            Arc::new(StubFields),
            Arc::new(StubConsents),
        )
        .execute(credentials(), sheet())
        .await
        .unwrap_err();
        // Not a 5xx: Cloudflare replaces an origin 5xx with CORS-less HTML, and
        // the desk would see "Failed to fetch" instead of "try again".
        assert!(matches!(error, CourseError::Provider(_)));
    }
}
