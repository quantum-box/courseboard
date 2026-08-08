//! Listing, marking, and clearing desk marks on individual tee times.
//!
//! Kept in one file because the three cases are one decision seen from three
//! sides, and splitting them would put the "closed beats capacity" rule out of
//! reach of the case that writes it.

use std::sync::Arc;

use crate::course::domain::{
    CourseError, DeleteSlotOverrides, SlotOverride, SlotOverrideGateway, SlotOverrideQuery,
    UpsertSlotOverrides,
};

pub struct ListSlotOverridesUseCase {
    marks: Arc<dyn SlotOverrideGateway>,
}

impl ListSlotOverridesUseCase {
    pub fn new(marks: Arc<dyn SlotOverrideGateway>) -> Self {
        Self { marks }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        query: SlotOverrideQuery,
    ) -> Result<Vec<SlotOverride>, CourseError> {
        require_tenant(tenant_id)?;
        self.marks.list_slot_overrides(tenant_id, &query).await
    }
}

pub struct UpsertSlotOverridesUseCase {
    marks: Arc<dyn SlotOverrideGateway>,
}

impl UpsertSlotOverridesUseCase {
    pub fn new(marks: Arc<dyn SlotOverrideGateway>) -> Self {
        Self { marks }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        command: UpsertSlotOverrides,
    ) -> Result<Vec<SlotOverride>, CourseError> {
        require_tenant(tenant_id)?;
        let overrides = command.into_overrides()?;
        self.marks
            .upsert_slot_overrides(tenant_id, &overrides)
            .await
    }
}

pub struct DeleteSlotOverridesUseCase {
    marks: Arc<dyn SlotOverrideGateway>,
}

impl DeleteSlotOverridesUseCase {
    pub fn new(marks: Arc<dyn SlotOverrideGateway>) -> Self {
        Self { marks }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        command: DeleteSlotOverrides,
    ) -> Result<u64, CourseError> {
        require_tenant(tenant_id)?;
        if command.tee_times.is_empty() {
            return Err(CourseError::BadRequest("at least one tee time is required"));
        }
        self.marks.delete_slot_overrides(tenant_id, &command).await
    }
}

/// Marks are tenant-scoped rows in CourseBoard's own storage, so an absent
/// tenant would read or write across every course the deployment holds.
fn require_tenant(tenant_id: &str) -> Result<(), CourseError> {
    if tenant_id.trim().is_empty() {
        return Err(CourseError::BadRequest("tenant id is required"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::NaiveDate;
    use std::sync::Mutex;

    use crate::course::domain::{CourseId, SlotOverrideKind};

    #[derive(Default)]
    struct RecordingMarks {
        upserted: Mutex<Vec<SlotOverride>>,
    }

    #[async_trait]
    impl SlotOverrideGateway for RecordingMarks {
        async fn list_slot_overrides(
            &self,
            _tenant_id: &str,
            _query: &SlotOverrideQuery,
        ) -> Result<Vec<SlotOverride>, CourseError> {
            Ok(Vec::new())
        }

        async fn upsert_slot_overrides(
            &self,
            _tenant_id: &str,
            overrides: &[SlotOverride],
        ) -> Result<Vec<SlotOverride>, CourseError> {
            *self.upserted.lock().unwrap() = overrides.to_vec();
            Ok(overrides.to_vec())
        }

        async fn delete_slot_overrides(
            &self,
            _tenant_id: &str,
            command: &DeleteSlotOverrides,
        ) -> Result<u64, CourseError> {
            Ok(command.tee_times.len() as u64)
        }
    }

    fn command(tee_times: Vec<String>) -> UpsertSlotOverrides {
        UpsertSlotOverrides {
            course_id: CourseId::new("course-1"),
            date: NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
            tee_times,
            kind: SlotOverrideKind::Closed,
            label: None,
            note: None,
        }
    }

    #[tokio::test]
    async fn closing_a_band_reaches_storage_as_one_mark_per_tee_time() {
        let marks = Arc::new(RecordingMarks::default());
        let use_case = UpsertSlotOverridesUseCase::new(marks.clone());
        use_case
            .execute("tenant-1", command(vec!["07:14".into(), "07:21".into()]))
            .await
            .unwrap();
        assert_eq!(marks.upserted.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_write_with_no_tenant_is_refused_before_it_can_cross_tenants() {
        let use_case = UpsertSlotOverridesUseCase::new(Arc::new(RecordingMarks::default()));
        assert!(use_case
            .execute("  ", command(vec!["07:14".into()]))
            .await
            .is_err());
    }

    #[tokio::test]
    async fn clearing_nothing_is_refused_rather_than_reported_as_a_success() {
        let use_case = DeleteSlotOverridesUseCase::new(Arc::new(RecordingMarks::default()));
        let result = use_case
            .execute(
                "tenant-1",
                DeleteSlotOverrides {
                    course_id: CourseId::new("course-1"),
                    date: NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
                    tee_times: Vec::new(),
                },
            )
            .await;
        assert!(result.is_err());
    }
}
