//! Field write-through for the generic half of a shift: somebody is at work.
//!
//! HRM holds staff shifts as a staff member, a date, and hours. `staffId` and
//! `date` are the identity — Field refuses to move either, and asks for a
//! delete plus a new post instead (PLT-3835) — so a shift already filed is
//! reached by the id this app stored when it filed it, and everything else is
//! sent as the state the day should now be in.
//!
//! No golf crosses this file. Which course the caddie stands at and how many
//! rounds they take stay in CourseBoard's own tables (ADR-0013).

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::field_gateway::{
    field_send_json, field_send_unit, normalize_base_url, urlencoding_path,
};
use crate::course::domain::{CourseError, GatewayCredentials, StaffShiftGateway, StaffShiftInput};

const HRM_STAFF: &str = "/v1/erp/hrm/staff";

/// Writes planned shifts to Field's HRM.
pub struct FieldStaffShiftGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldStaffShiftGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }
}

#[async_trait]
impl StaffShiftGateway for FieldStaffShiftGateway {
    async fn upsert_shift(
        &self,
        credentials: GatewayCredentials<'_>,
        staff_id: &str,
        field_shift_id: Option<&str>,
        shift: StaffShiftInput,
    ) -> Result<String, CourseError> {
        let staff_id = staff_id.trim();
        if staff_id.is_empty() {
            return Err(CourseError::BadRequest(
                "a shift needs the staff member it is filed under",
            ));
        }

        if let Some(shift_id) = field_shift_id.map(str::trim).filter(|id| !id.is_empty()) {
            let body = update_body(&shift);
            let updated: Result<FieldStaffShiftDto, CourseError> = field_send_json(
                &self.client,
                &self.base_url,
                reqwest::Method::PATCH,
                &shift_path(staff_id, shift_id),
                credentials,
                Some(&body),
            )
            .await;
            match updated {
                Ok(dto) => return Ok(dto.id),
                // The id we hold names a shift Field no longer has — deleted
                // on Field's side, or never committed by a write we recorded
                // optimistically. Filing the day afresh is what the caller
                // asked for; failing would leave the caddie missing from
                // Field's roster with no way back except editing the row.
                Err(error) if is_missing(&error) => {
                    tracing::info!(
                        staff_id,
                        field_shift_id = shift_id,
                        "Field no longer holds the recorded shift; filing it again"
                    );
                }
                Err(error) => return Err(error),
            }
        }

        let body = create_body(&shift);
        let created: FieldStaffShiftDto = field_send_json(
            &self.client,
            &self.base_url,
            reqwest::Method::POST,
            &shifts_path(staff_id),
            credentials,
            Some(&body),
        )
        .await?;
        Ok(created.id)
    }

    async fn delete_shift(
        &self,
        credentials: GatewayCredentials<'_>,
        staff_id: &str,
        field_shift_id: &str,
    ) -> Result<(), CourseError> {
        let staff_id = staff_id.trim();
        let field_shift_id = field_shift_id.trim();
        if staff_id.is_empty() || field_shift_id.is_empty() {
            return Err(CourseError::BadRequest(
                "a shift can only be withdrawn by staff member and shift id",
            ));
        }

        let deleted = field_send_unit(
            &self.client,
            &self.base_url,
            reqwest::Method::DELETE,
            &shift_path(staff_id, field_shift_id),
            credentials,
            None,
        )
        .await;
        match deleted {
            Ok(()) => Ok(()),
            // Already gone is the state the caller asked for. A desk turning
            // the same day off twice, and a retry after a delete that did
            // land, both arrive here.
            Err(error) if is_missing(&error) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

fn shifts_path(staff_id: &str) -> String {
    format!("{HRM_STAFF}/{}/shifts", urlencoding_path(staff_id))
}

fn shift_path(staff_id: &str, shift_id: &str) -> String {
    format!("{}/{}", shifts_path(staff_id), urlencoding_path(shift_id))
}

/// The whole day, because Field has nothing to merge it into yet.
fn create_body(shift: &StaffShiftInput) -> Value {
    let mut body = json!({
        "date": shift.date.to_string(),
        "startTime": shift.start_time,
        "endTime": shift.end_time,
    });
    if let Some(shift_type) = trimmed(shift.shift_type.as_deref()) {
        body["shiftType"] = json!(shift_type);
    }
    if let Some(notes) = trimmed(shift.notes.as_deref()) {
        body["notes"] = json!(notes);
    }
    body
}

/// The mutable part, stated in full rather than as a delta.
///
/// The caller is declaring what the day now is, so a note it no longer carries
/// has to be cleared rather than left behind — `notes` is nullable on the
/// shift Field hands back, so `null` is a state it can hold.
///
/// `shiftType` is not: Field always answers with one, so it has a default of
/// its own and no null to be set to. Omitting it leaves that default alone
/// instead of asking Field to store something it cannot represent.
fn update_body(shift: &StaffShiftInput) -> Value {
    let mut body = json!({
        "startTime": shift.start_time,
        "endTime": shift.end_time,
        "notes": trimmed(shift.notes.as_deref()),
    });
    if let Some(shift_type) = trimmed(shift.shift_type.as_deref()) {
        body["shiftType"] = json!(shift_type);
    }
    body
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Whether Field's answer means "there is no such shift".
fn is_missing(error: &CourseError) -> bool {
    matches!(
        error,
        CourseError::NotFound(_) | CourseError::UpstreamClient { status: 404, .. }
    )
}

#[derive(Debug, Deserialize)]
struct FieldStaffShiftDto {
    id: String,
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;

    fn shift() -> StaffShiftInput {
        StaffShiftInput {
            date: NaiveDate::from_ymd_opt(2026, 8, 26).expect("a real date"),
            start_time: "07:00".into(),
            end_time: "12:00".into(),
            shift_type: None,
            notes: None,
        }
    }

    #[test]
    fn a_new_shift_is_filed_under_the_staff_member_and_the_day() {
        let body = create_body(&shift());
        assert_eq!(body["date"], json!("2026-08-26"));
        assert_eq!(body["startTime"], json!("07:00"));
        assert_eq!(body["endTime"], json!("12:00"));
        assert!(body.get("notes").is_none());
        assert!(body.get("shiftType").is_none());
    }

    #[test]
    fn an_edit_clears_a_note_the_day_no_longer_carries() {
        // Omitting `notes` would leave yesterday's note attached to hours it
        // no longer describes.
        let body = update_body(&shift());
        assert_eq!(body["notes"], Value::Null);
        assert_eq!(body["startTime"], json!("07:00"));
        assert!(body.get("date").is_none());
    }

    #[test]
    fn an_edit_leaves_fields_shift_type_alone_when_the_caller_names_none() {
        let body = update_body(&shift());
        assert!(body.get("shiftType").is_none());

        let named = update_body(&StaffShiftInput {
            shift_type: Some("morning".into()),
            ..shift()
        });
        assert_eq!(named["shiftType"], json!("morning"));
    }

    #[test]
    fn blank_text_is_no_text_rather_than_an_empty_note() {
        let body = create_body(&StaffShiftInput {
            notes: Some("   ".into()),
            shift_type: Some("".into()),
            ..shift()
        });
        assert!(body.get("notes").is_none());
        assert!(body.get("shiftType").is_none());
    }

    #[test]
    fn a_staff_id_with_a_slash_cannot_reach_a_different_hrm_resource() {
        assert_eq!(
            shifts_path("stf/../../tenants"),
            "/v1/erp/hrm/staff/stf%2F..%2F..%2Ftenants/shifts"
        );
        assert_eq!(
            shift_path("stf_1", "shift/1"),
            "/v1/erp/hrm/staff/stf_1/shifts/shift%2F1"
        );
    }

    #[test]
    fn only_a_shift_field_does_not_have_reads_as_missing() {
        assert!(is_missing(&CourseError::UpstreamClient {
            status: 404,
            message: "not found".into(),
        }));
        assert!(!is_missing(&CourseError::UpstreamClient {
            status: 409,
            message: "conflict".into(),
        }));
        assert!(!is_missing(&CourseError::Provider("upstream down".into())));
    }
}
