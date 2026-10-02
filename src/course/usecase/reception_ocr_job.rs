//! ReceptionOcrJobUseCase: persistent reads for sheets too large for one request.
//!
//! [`DraftCustomerReceptionUseCase`] asks Field to read a document carried in
//! the request body, which is exactly the body the platform drops past 4MB —
//! the upload never arrives and nobody can say why. This use case moves the
//! bytes around that limit: create returns presigned Tachyon Storage PUTs the
//! caller writes to directly, confirm verifies they landed, and each advance
//! reads one bounded piece until the draft is whole. The schema still comes
//! from CourseBoard here, not the browser — which columns a golf reception
//! sheet has is golf knowledge (ADR-0005), and a job a caller could reshape
//! is a read nobody can reproduce when it comes back wrong.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    active_reception_consent_definitions, reception_sheet_schema_for_fields_and_consents,
    CourseError, CustomerConsentCatalogGateway, CustomerReceptionField,
    CustomerReceptionFieldsGateway, CustomerReceptionOcrJobGateway, GatewayCredentials,
    ReceptionConsentDefinition, ReceptionOcrJob, ReceptionOcrJobCreated, ReceptionOcrJobSheets,
};

pub struct ReceptionOcrJobUseCase {
    jobs: Arc<dyn CustomerReceptionOcrJobGateway>,
    fields: Arc<dyn CustomerReceptionFieldsGateway>,
    consents: Arc<dyn CustomerConsentCatalogGateway>,
}

struct ReadContext {
    fields: Vec<CustomerReceptionField>,
    consents: Vec<ReceptionConsentDefinition>,
}

impl ReceptionOcrJobUseCase {
    pub fn new(
        jobs: Arc<dyn CustomerReceptionOcrJobGateway>,
        fields: Arc<dyn CustomerReceptionFieldsGateway>,
        consents: Arc<dyn CustomerConsentCatalogGateway>,
    ) -> Self {
        Self {
            jobs,
            fields,
            consents,
        }
    }

    /// The permission plus the schema inputs every job step needs. Draft
    /// mapping happens on this side of the Field boundary, so confirm,
    /// advance and cancel all want the same tenant configuration create did.
    async fn context(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<ReadContext, CourseError> {
        credentials.require(actions::MANAGE_CUSTOMERS).await?;
        let stored = self
            .fields
            .list_customer_reception_fields(credentials.operator_id)
            .await?;
        let fields = CustomerReceptionField::merge_with_defaults(credentials.operator_id, stored);
        let catalog = self.consents.list_consent_items(credentials, false).await?;
        let consents = active_reception_consent_definitions(&catalog);
        reception_sheet_schema_for_fields_and_consents(&fields, &consents)?;
        Ok(ReadContext { fields, consents })
    }

    /// Reserves the job and answers with the presigned upload targets. The
    /// sheets are declarations — type and size — so the heavy part of the
    /// request is upstream's problem, not this body's.
    pub async fn create(
        &self,
        credentials: GatewayCredentials<'_>,
        idempotency_key: &str,
        sheets: ReceptionOcrJobSheets,
    ) -> Result<ReceptionOcrJobCreated, CourseError> {
        let context = self.context(credentials).await?;
        self.jobs
            .create_reception_ocr_job(
                credentials,
                idempotency_key,
                &sheets,
                &context.fields,
                &context.consents,
            )
            .await
    }

    /// Verifies the uploads landed. Retried confirms replay the same job.
    pub async fn confirm(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<ReceptionOcrJob, CourseError> {
        let context = self.context(credentials).await?;
        self.jobs
            .confirm_reception_ocr_job(credentials, job_id, &context.fields, &context.consents)
            .await
    }

    /// Reads the current status without advancing the job.
    pub async fn get(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<ReceptionOcrJob, CourseError> {
        let context = self.context(credentials).await?;
        self.jobs
            .get_reception_ocr_job(credentials, job_id, &context.fields, &context.consents)
            .await
    }

    /// Reads the next bounded piece of the job's sheets. The caller loops
    /// until the status is completed; each call is one upstream-sized read
    /// under the caller's own bearer, so billing and rate limits surface the
    /// same way the synchronous path surfaces them.
    pub async fn advance(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<ReceptionOcrJob, CourseError> {
        let context = self.context(credentials).await?;
        self.jobs
            .advance_reception_ocr_job(credentials, job_id, &context.fields, &context.consents)
            .await
    }

    /// Abandons the job and retires its stored sheets. Terminal jobs answer
    /// their stored state instead of failing — a cancel racing a finish
    /// still tells the desk what the read came to.
    pub async fn cancel(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<ReceptionOcrJob, CourseError> {
        let context = self.context(credentials).await?;
        self.jobs
            .cancel_reception_ocr_job(credentials, job_id, &context.fields, &context.consents)
            .await
    }
}
