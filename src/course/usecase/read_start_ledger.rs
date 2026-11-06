//! ReadStartLedgerUseCase: drives Field's OCR job for a start-ledger PDF and
//! answers with the sheet already split into one group per tee time.
//!
//! The job protocol (create → Storage PUT → confirm → advance) is Field's;
//! what this adds is the permission (reading a ledger is the first half of
//! writing bookings) and the parsing, so every screen sees the same groups for
//! the same read.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    actions, parse_start_ledger_rows, CourseError, GatewayCredentials, ReceptionOcrJobSheets,
    ReceptionOcrJobStatus, ReceptionOcrJobUpload, StartLedgerOcrGateway, StartLedgerOcrJob,
    StartLedgerOcrStep, StartLedgerParty,
};

/// A read as the review screen needs it.
#[derive(Debug, Clone, PartialEq)]
pub struct StartLedgerRead {
    pub id: String,
    pub status: ReceptionOcrJobStatus,
    pub completed_units: u32,
    pub total_units: Option<u32>,
    pub date: Option<NaiveDate>,
    pub parties: Vec<StartLedgerParty>,
    pub warnings: Vec<String>,
    pub failure_code: Option<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<StartLedgerOcrJob> for StartLedgerRead {
    fn from(job: StartLedgerOcrJob) -> Self {
        Self {
            parties: parse_start_ledger_rows(&job.draft.rows),
            id: job.id,
            status: job.status,
            completed_units: job.completed_units,
            total_units: job.total_units,
            date: job.draft.date,
            warnings: job.draft.warnings,
            failure_code: job.failure_code,
            expires_at: job.expires_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StartLedgerReadCreated {
    pub read: StartLedgerRead,
    pub uploads: Vec<ReceptionOcrJobUpload>,
}

pub struct ReadStartLedgerUseCase {
    ocr: Arc<dyn StartLedgerOcrGateway>,
}

impl ReadStartLedgerUseCase {
    pub fn new(ocr: Arc<dyn StartLedgerOcrGateway>) -> Self {
        Self { ocr }
    }

    pub async fn create(
        &self,
        credentials: GatewayCredentials<'_>,
        idempotency_key: &str,
        sheets: ReceptionOcrJobSheets,
    ) -> Result<StartLedgerReadCreated, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        if sheets
            .iter()
            .any(|sheet| sheet.content_type() != "application/pdf" || sheet.sha256().is_none())
        {
            return Err(CourseError::BadRequest(
                "a start ledger is read from the original PDF and its SHA-256",
            ));
        }
        let created = self
            .ocr
            .create_job(credentials, idempotency_key, &sheets)
            .await?;
        Ok(StartLedgerReadCreated {
            read: created.job.into(),
            uploads: created.uploads,
        })
    }

    pub async fn step(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
        step: StartLedgerOcrStep,
    ) -> Result<StartLedgerRead, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        Ok(self.ocr.step_job(credentials, job_id, step).await?.into())
    }

    pub async fn get(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<StartLedgerRead, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        Ok(self.ocr.get_job(credentials, job_id).await?.into())
    }

    pub async fn cancel(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<StartLedgerRead, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        Ok(self.ocr.cancel_job(credentials, job_id).await?.into())
    }
}
