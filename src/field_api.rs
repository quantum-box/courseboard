use std::{env, sync::Arc, time::Duration};

use async_trait::async_trait;
use reqwest::{header::AUTHORIZATION, Client, Method, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

const DEFAULT_HTTP_TIMEOUT: Duration = Duration::from_secs(10);

#[async_trait]
pub trait FieldApi: Send + Sync {
    async fn list_staff_profiles(
        &self,
        filter: StaffProfileFilter,
    ) -> Result<Vec<StaffProfile>, FieldApiError>;
    async fn create_staff_profile(
        &self,
        input: StaffProfileInput,
    ) -> Result<StaffProfile, FieldApiError>;
    async fn update_staff_profile(
        &self,
        id: &str,
        input: StaffProfileInput,
    ) -> Result<StaffProfile, FieldApiError>;
    async fn list_staff_availability(
        &self,
        filter: ShiftFilter,
    ) -> Result<Vec<StaffAvailability>, FieldApiError>;
    async fn list_staff_assignments(
        &self,
        filter: ShiftFilter,
    ) -> Result<Vec<StaffAssignment>, FieldApiError>;
    async fn create_staff_assignment(
        &self,
        input: StaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError>;
    async fn update_staff_assignment(
        &self,
        id: &str,
        input: StaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError>;
    async fn cancel_staff_assignment(&self, id: &str) -> Result<StaffAssignment, FieldApiError>;
    async fn assign_reservation_staff(
        &self,
        reservation_id: &str,
        input: ReservationStaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError>;
    async fn unassign_reservation_staff(
        &self,
        reservation_id: &str,
        input: ReservationStaffUnassignmentInput,
    ) -> Result<StaffAssignment, FieldApiError>;
}

pub type DynFieldApi = Arc<dyn FieldApi>;

#[derive(Clone)]
pub struct FieldApiClient {
    base_url: Url,
    token_provider: Arc<dyn FieldApiTokenProvider>,
    client: Client,
}

impl FieldApiClient {
    pub fn from_env() -> Result<Self, FieldApiConfigError> {
        let base_url =
            env::var("TACHYON_FIELD_API_URL").map_err(|_| FieldApiConfigError::MissingBaseUrl)?;
        let bearer_token = env::var("TACHYON_FIELD_API_BEARER_TOKEN").ok();
        Self::new(
            base_url,
            Arc::new(StaticBearerTokenProvider::new(bearer_token)),
        )
    }

    pub fn new(
        base_url: impl AsRef<str>,
        token_provider: Arc<dyn FieldApiTokenProvider>,
    ) -> Result<Self, FieldApiConfigError> {
        let base_url =
            Url::parse(base_url.as_ref()).map_err(|_| FieldApiConfigError::InvalidBaseUrl)?;
        let client = Client::builder()
            .timeout(DEFAULT_HTTP_TIMEOUT)
            .build()
            .expect("reqwest client config must be valid");

        Ok(Self {
            base_url,
            token_provider,
            client,
        })
    }

    async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<T, FieldApiError> {
        let token = self.token_provider.bearer_token().await?;
        let url = self
            .base_url
            .join(path.trim_start_matches('/'))
            .map_err(|_| FieldApiError::InvalidUrl)?;
        let mut request = self
            .client
            .request(method, url)
            .header(AUTHORIZATION, format!("Bearer {token}"));

        for (key, value) in query.iter().filter(|(_, value)| !value.is_empty()) {
            request = request.query(&[(key, value)]);
        }

        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request.send().await.map_err(FieldApiError::Request)?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(FieldApiError::Status { status, message });
        }

        response.json::<T>().await.map_err(FieldApiError::Request)
    }
}

#[async_trait]
impl FieldApi for FieldApiClient {
    async fn list_staff_profiles(
        &self,
        filter: StaffProfileFilter,
    ) -> Result<Vec<StaffProfile>, FieldApiError> {
        let query = profile_query(filter);
        self.send(Method::GET, "/v1/erp/staff-profiles", &query, None)
            .await
    }

    async fn create_staff_profile(
        &self,
        input: StaffProfileInput,
    ) -> Result<StaffProfile, FieldApiError> {
        self.send(
            Method::POST,
            "/v1/erp/staff-profiles",
            &[],
            Some(input.into_api_payload()),
        )
        .await
    }

    async fn update_staff_profile(
        &self,
        id: &str,
        input: StaffProfileInput,
    ) -> Result<StaffProfile, FieldApiError> {
        self.send(
            Method::PATCH,
            &format!("/v1/erp/staff-profiles/{id}"),
            &[],
            Some(input.into_api_payload()),
        )
        .await
    }

    async fn list_staff_availability(
        &self,
        filter: ShiftFilter,
    ) -> Result<Vec<StaffAvailability>, FieldApiError> {
        let query = shift_query(filter);
        self.send(Method::GET, "/v1/erp/staff-availability", &query, None)
            .await
    }

    async fn list_staff_assignments(
        &self,
        filter: ShiftFilter,
    ) -> Result<Vec<StaffAssignment>, FieldApiError> {
        let query = shift_query(filter);
        self.send(Method::GET, "/v1/erp/staff-assignments", &query, None)
            .await
    }

    async fn create_staff_assignment(
        &self,
        input: StaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError> {
        self.send(
            Method::POST,
            "/v1/erp/staff-assignments",
            &[],
            Some(input.into_api_payload(false)),
        )
        .await
    }

    async fn update_staff_assignment(
        &self,
        id: &str,
        input: StaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError> {
        self.send(
            Method::PATCH,
            &format!("/v1/erp/staff-assignments/{id}"),
            &[],
            Some(input.into_api_payload(false)),
        )
        .await
    }

    async fn cancel_staff_assignment(&self, id: &str) -> Result<StaffAssignment, FieldApiError> {
        self.send(
            Method::PATCH,
            &format!("/v1/erp/staff-assignments/{id}"),
            &[],
            Some(json!({ "status": "cancelled" })),
        )
        .await
    }

    async fn assign_reservation_staff(
        &self,
        reservation_id: &str,
        input: ReservationStaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError> {
        self.send(
            Method::POST,
            &format!("/v1/erp/reservations/{reservation_id}/staff-assignment"),
            &[],
            Some(input.into_api_payload()),
        )
        .await
    }

    async fn unassign_reservation_staff(
        &self,
        reservation_id: &str,
        input: ReservationStaffUnassignmentInput,
    ) -> Result<StaffAssignment, FieldApiError> {
        self.send(
            Method::POST,
            &format!("/v1/erp/reservations/{reservation_id}/staff-assignment/unassign"),
            &[],
            Some(input.into_api_payload()),
        )
        .await
    }
}

fn profile_query(filter: StaffProfileFilter) -> Vec<(&'static str, String)> {
    vec![
        ("tenant_id", filter.tenant_id.unwrap_or_default()),
        ("status", filter.status.unwrap_or_default()),
    ]
}

fn shift_query(filter: ShiftFilter) -> Vec<(&'static str, String)> {
    vec![
        ("tenant_id", filter.tenant_id.unwrap_or_default()),
        ("date_from", filter.date_from.unwrap_or_default()),
        ("date_to", filter.date_to.unwrap_or_default()),
        (
            "staff_profile_id",
            filter.staff_profile_id.unwrap_or_default(),
        ),
        ("reservation_id", filter.reservation_id.unwrap_or_default()),
    ]
}

#[async_trait]
pub trait FieldApiTokenProvider: Send + Sync {
    async fn bearer_token(&self) -> Result<String, FieldApiError>;
}

#[derive(Clone)]
pub struct StaticBearerTokenProvider {
    bearer_token: Option<String>,
}

impl StaticBearerTokenProvider {
    pub fn new(bearer_token: Option<String>) -> Self {
        Self { bearer_token }
    }
}

#[async_trait]
impl FieldApiTokenProvider for StaticBearerTokenProvider {
    async fn bearer_token(&self) -> Result<String, FieldApiError> {
        self.bearer_token
            .as_ref()
            .filter(|token| !token.trim().is_empty())
            .cloned()
            .ok_or(FieldApiError::MissingToken)
    }
}

#[derive(Debug, Error)]
pub enum FieldApiConfigError {
    #[error("TACHYON_FIELD_API_URL must be set for the admin UI")]
    MissingBaseUrl,
    #[error("TACHYON_FIELD_API_URL must be a valid URL")]
    InvalidBaseUrl,
}

#[derive(Debug, Error)]
pub enum FieldApiError {
    #[error("field API bearer token is not configured")]
    MissingToken,
    #[error("field API URL could not be constructed")]
    InvalidUrl,
    #[error("field API request failed")]
    Request(#[source] reqwest::Error),
    #[error("field API returned {status}: {message}")]
    Status { status: StatusCode, message: String },
}

#[derive(Debug, Clone, Default)]
pub struct StaffProfileFilter {
    pub tenant_id: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StaffProfile {
    pub id: String,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub staff_member_id: Option<String>,
    #[serde(default, alias = "name")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, flatten)]
    pub extra: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StaffProfileInput {
    pub tenant_id: String,
    pub staff_member_id: String,
    pub display_name: String,
    pub status: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
}

impl StaffProfileInput {
    fn into_api_payload(self) -> Value {
        json!({
            "tenant_id": self.tenant_id,
            "staff_member_id": self.staff_member_id,
            "display_name": self.display_name,
            "status": self.status,
            "role": "caddie",
            "phone": self.phone.unwrap_or_default(),
            "email": self.email.unwrap_or_default(),
            "notes": self.notes.unwrap_or_default()
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct ShiftFilter {
    pub tenant_id: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub staff_profile_id: Option<String>,
    pub reservation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StaffAvailability {
    pub id: String,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub staff_profile_id: Option<String>,
    #[serde(default)]
    pub staff_member_id: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub ends_at: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default, flatten)]
    pub extra: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StaffAssignment {
    pub id: String,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub staff_profile_id: Option<String>,
    #[serde(default)]
    pub staff_member_id: Option<String>,
    #[serde(default)]
    pub reservation_id: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub ends_at: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default, flatten)]
    pub extra: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StaffAssignmentInput {
    pub tenant_id: String,
    pub staff_profile_id: String,
    pub reservation_id: Option<String>,
    pub date: String,
    pub starts_at: String,
    pub ends_at: String,
    pub status: Option<String>,
    pub note: Option<String>,
}

impl StaffAssignmentInput {
    fn into_api_payload(self, cancelled: bool) -> Value {
        json!({
            "tenant_id": self.tenant_id,
            "staff_profile_id": self.staff_profile_id,
            "reservation_id": self.reservation_id.unwrap_or_default(),
            "date": self.date,
            "starts_at": self.starts_at,
            "ends_at": self.ends_at,
            "status": if cancelled { "cancelled".to_string() } else { self.status.unwrap_or_else(|| "scheduled".to_string()) },
            "note": self.note.unwrap_or_default()
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReservationStaffAssignmentInput {
    pub tenant_id: String,
    pub staff_profile_id: String,
    pub date: String,
    pub starts_at: String,
    pub ends_at: String,
    pub note: Option<String>,
}

impl ReservationStaffAssignmentInput {
    fn into_api_payload(self) -> Value {
        json!({
            "tenant_id": self.tenant_id,
            "staff_profile_id": self.staff_profile_id,
            "date": self.date,
            "starts_at": self.starts_at,
            "ends_at": self.ends_at,
            "status": "assigned",
            "note": self.note.unwrap_or_default()
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReservationStaffUnassignmentInput {
    pub tenant_id: String,
}

impl ReservationStaffUnassignmentInput {
    fn into_api_payload(self) -> Value {
        json!({ "tenant_id": self.tenant_id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staff_profile_accepts_generic_staff_member_fields() {
        let profile: StaffProfile = serde_json::from_value(json!({
            "id": "sp_123",
            "tenant_id": "scc",
            "staff_member_id": "sm_456",
            "display_name": "Aiko Sato",
            "status": "active",
            "skill_level": "senior"
        }))
        .unwrap();

        assert_eq!(profile.id, "sp_123");
        assert_eq!(profile.staff_member_id.as_deref(), Some("sm_456"));
        assert_eq!(profile.display_name.as_deref(), Some("Aiko Sato"));
        assert_eq!(profile.extra["skill_level"], "senior");
    }

    #[test]
    fn staff_profile_input_maps_caddie_role_to_generic_payload() {
        let payload = StaffProfileInput {
            tenant_id: "scc".to_string(),
            staff_member_id: "sm_456".to_string(),
            display_name: "Aiko Sato".to_string(),
            status: "active".to_string(),
            phone: None,
            email: Some("aiko@example.test".to_string()),
            notes: None,
        }
        .into_api_payload();

        assert_eq!(payload["staff_member_id"], "sm_456");
        assert_eq!(payload["display_name"], "Aiko Sato");
        assert_eq!(payload["role"], "caddie");
        assert_eq!(payload["email"], "aiko@example.test");
    }

    #[test]
    fn reservation_assignment_payload_uses_generic_staff_profile() {
        let payload = ReservationStaffAssignmentInput {
            tenant_id: "scc".to_string(),
            staff_profile_id: "sp_123".to_string(),
            date: "2026-06-01".to_string(),
            starts_at: "08:00".to_string(),
            ends_at: "12:30".to_string(),
            note: Some("front nine support".to_string()),
        }
        .into_api_payload();

        assert_eq!(payload["tenant_id"], "scc");
        assert_eq!(payload["staff_profile_id"], "sp_123");
        assert_eq!(payload["status"], "assigned");
        assert_eq!(payload["note"], "front nine support");
    }
}
