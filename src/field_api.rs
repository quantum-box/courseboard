use std::{
    env,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

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
    async fn cancel_staff_assignment(
        &self,
        id: &str,
        operator_id: &str,
    ) -> Result<StaffAssignment, FieldApiError>;
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
        // Prefer self-acquired OAuth2 client-credentials tokens when configured,
        // so Course Board logs in to Tachyon Auth itself instead of relying on a
        // static bearer token. Falls back to the static provider for tests and
        // gateway-fronted deployments.
        let token_provider: Arc<dyn FieldApiTokenProvider> =
            match ClientCredentialsConfig::from_env() {
                Some(config) => Arc::new(ClientCredentialsTokenProvider::new(config)),
                None => Arc::new(StaticBearerTokenProvider::new(
                    env::var("TACHYON_FIELD_API_BEARER_TOKEN").ok(),
                )),
            };
        Self::new(base_url, token_provider)
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
        operator_id: Option<&str>,
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

        // The generic Field ERP API scopes every request to a tenant via the
        // `x-operator-id` header; without it the API rejects the call with 400.
        if let Some(operator_id) = operator_id.filter(|value| !value.is_empty()) {
            request = request.header("x-operator-id", operator_id);
        }

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

        // List endpoints wrap their results in an `{ "items": [...] }` envelope.
        // Unwrap it when present so list responses deserialize into `Vec<T>`,
        // while single-resource responses (no `items` array) pass through.
        let value: Value = response.json().await.map_err(FieldApiError::Request)?;
        let value = match value {
            Value::Object(mut map) if map.get("items").is_some_and(Value::is_array) => {
                map.remove("items").unwrap_or(Value::Null)
            }
            other => other,
        };
        serde_json::from_value(value).map_err(|error| FieldApiError::Decode(error.to_string()))
    }
}

#[async_trait]
impl FieldApi for FieldApiClient {
    async fn list_staff_profiles(
        &self,
        filter: StaffProfileFilter,
    ) -> Result<Vec<StaffProfile>, FieldApiError> {
        let operator_id = filter.tenant_id.clone();
        let query = profile_query(filter);
        self.send(
            Method::GET,
            "/v1/erp/staff-profiles",
            operator_id.as_deref(),
            &query,
            None,
        )
        .await
    }

    async fn create_staff_profile(
        &self,
        input: StaffProfileInput,
    ) -> Result<StaffProfile, FieldApiError> {
        let operator_id = input.tenant_id.clone();
        self.send(
            Method::POST,
            "/v1/erp/staff-profiles",
            Some(&operator_id),
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
        let operator_id = input.tenant_id.clone();
        self.send(
            Method::PATCH,
            &format!("/v1/erp/staff-profiles/{id}"),
            Some(&operator_id),
            &[],
            Some(input.into_api_payload()),
        )
        .await
    }

    async fn list_staff_availability(
        &self,
        filter: ShiftFilter,
    ) -> Result<Vec<StaffAvailability>, FieldApiError> {
        let operator_id = filter.tenant_id.clone();
        let query = shift_query(filter);
        self.send(
            Method::GET,
            "/v1/erp/staff-availability",
            operator_id.as_deref(),
            &query,
            None,
        )
        .await
    }

    async fn list_staff_assignments(
        &self,
        filter: ShiftFilter,
    ) -> Result<Vec<StaffAssignment>, FieldApiError> {
        let operator_id = filter.tenant_id.clone();
        let query = shift_query(filter);
        self.send(
            Method::GET,
            "/v1/erp/staff-assignments",
            operator_id.as_deref(),
            &query,
            None,
        )
        .await
    }

    async fn create_staff_assignment(
        &self,
        input: StaffAssignmentInput,
    ) -> Result<StaffAssignment, FieldApiError> {
        let operator_id = input.tenant_id.clone();
        self.send(
            Method::POST,
            "/v1/erp/staff-assignments",
            Some(&operator_id),
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
        let operator_id = input.tenant_id.clone();
        self.send(
            Method::PATCH,
            &format!("/v1/erp/staff-assignments/{id}"),
            Some(&operator_id),
            &[],
            Some(input.into_api_payload(false)),
        )
        .await
    }

    async fn cancel_staff_assignment(
        &self,
        id: &str,
        operator_id: &str,
    ) -> Result<StaffAssignment, FieldApiError> {
        self.send(
            Method::PATCH,
            &format!("/v1/erp/staff-assignments/{id}"),
            Some(operator_id),
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
        let operator_id = input.tenant_id.clone();
        self.send(
            Method::POST,
            &format!("/v1/erp/reservations/{reservation_id}/staff-assignment"),
            Some(&operator_id),
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
        let operator_id = input.tenant_id.clone();
        self.send(
            Method::POST,
            &format!("/v1/erp/reservations/{reservation_id}/staff-assignment/unassign"),
            Some(&operator_id),
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

fn non_empty_env(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// OAuth2 client-credentials configuration for acquiring Field API tokens.
#[derive(Clone)]
pub struct ClientCredentialsConfig {
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub scope: Option<String>,
    pub audience: Option<String>,
}

impl ClientCredentialsConfig {
    /// Builds a config when the required env vars are all present, otherwise
    /// returns `None` so callers can fall back to a static bearer token.
    pub fn from_env() -> Option<Self> {
        Some(Self {
            token_url: non_empty_env("TACHYON_FIELD_API_TOKEN_URL")?,
            client_id: non_empty_env("TACHYON_FIELD_API_CLIENT_ID")?,
            client_secret: non_empty_env("TACHYON_FIELD_API_CLIENT_SECRET")?,
            scope: non_empty_env("TACHYON_FIELD_API_SCOPE"),
            audience: non_empty_env("TACHYON_FIELD_API_AUDIENCE"),
        })
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

/// Acquires Field API access tokens via the OAuth2 client-credentials grant and
/// caches them until shortly before they expire.
pub struct ClientCredentialsTokenProvider {
    config: ClientCredentialsConfig,
    client: Client,
    cache: Mutex<Option<CachedToken>>,
}

impl ClientCredentialsTokenProvider {
    // Refresh a little before the real expiry to avoid races with the field API.
    const EXPIRY_SKEW: Duration = Duration::from_secs(60);
    const DEFAULT_TTL_SECS: u64 = 3600;

    pub fn new(config: ClientCredentialsConfig) -> Self {
        let client = Client::builder()
            .timeout(DEFAULT_HTTP_TIMEOUT)
            .build()
            .expect("reqwest client config must be valid");
        Self {
            config,
            client,
            cache: Mutex::new(None),
        }
    }

    async fn fetch_token(&self) -> Result<CachedToken, FieldApiError> {
        let mut form: Vec<(&str, &str)> = vec![("grant_type", "client_credentials")];
        if let Some(scope) = &self.config.scope {
            form.push(("scope", scope));
        }
        if let Some(audience) = &self.config.audience {
            form.push(("audience", audience));
        }

        let response = self
            .client
            .post(&self.config.token_url)
            .basic_auth(&self.config.client_id, Some(&self.config.client_secret))
            .form(&form)
            .send()
            .await
            .map_err(FieldApiError::TokenRequest)?;

        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(FieldApiError::TokenStatus { status, message });
        }

        let body = response
            .json::<TokenResponse>()
            .await
            .map_err(FieldApiError::TokenRequest)?;
        let ttl = body
            .expires_in
            .unwrap_or(Self::DEFAULT_TTL_SECS)
            .saturating_sub(Self::EXPIRY_SKEW.as_secs());

        Ok(CachedToken {
            access_token: body.access_token,
            expires_at: Instant::now() + Duration::from_secs(ttl),
        })
    }
}

#[async_trait]
impl FieldApiTokenProvider for ClientCredentialsTokenProvider {
    async fn bearer_token(&self) -> Result<String, FieldApiError> {
        if let Some(token) = self
            .cache
            .lock()
            .expect("token cache mutex must not be poisoned")
            .as_ref()
            .filter(|cached| cached.expires_at > Instant::now())
            .map(|cached| cached.access_token.clone())
        {
            return Ok(token);
        }

        let fresh = self.fetch_token().await?;
        let token = fresh.access_token.clone();
        *self
            .cache
            .lock()
            .expect("token cache mutex must not be poisoned") = Some(fresh);
        Ok(token)
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
    #[error("field API response could not be decoded: {0}")]
    Decode(String),
    #[error("field API token request failed")]
    TokenRequest(#[source] reqwest::Error),
    #[error("field API token endpoint returned {status}: {message}")]
    TokenStatus { status: StatusCode, message: String },
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
    use std::sync::Mutex;

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

    // Captures the `x-operator-id` header of the last request the test server saw.
    async fn spawn_erp_server(
        route: &'static str,
        seen_operator: Arc<Mutex<Option<String>>>,
        response_body: Value,
    ) -> std::net::SocketAddr {
        let handler = {
            let seen_operator = seen_operator.clone();
            move |headers: axum::http::HeaderMap| {
                let seen_operator = seen_operator.clone();
                let response_body = response_body.clone();
                async move {
                    *seen_operator.lock().unwrap() = headers
                        .get("x-operator-id")
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_string);
                    axum::Json(response_body)
                }
            }
        };
        let app = axum::Router::new().route(route, axum::routing::any(handler));
    async fn spawn_token_server(handler: axum::routing::MethodRouter) -> std::net::SocketAddr {
        let app = axum::Router::new().route("/token", handler);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        addr
    }

    fn test_client(addr: std::net::SocketAddr) -> FieldApiClient {
        FieldApiClient::new(
            format!("http://{addr}"),
            Arc::new(StaticBearerTokenProvider::new(Some("tok".to_string()))),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn list_staff_profiles_sends_operator_id_and_unwraps_items_envelope() {
        let seen = Arc::new(Mutex::new(None));
        let addr = spawn_erp_server(
            "/v1/erp/staff-profiles",
            seen.clone(),
            json!({ "items": [{ "id": "sp_1", "tenant_id": "scc" }] }),
        )
        .await;

        let profiles = test_client(addr)
            .list_staff_profiles(StaffProfileFilter {
                tenant_id: Some("scc".to_string()),
                status: None,
            })
            .await
            .unwrap();

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "sp_1");
        assert_eq!(seen.lock().unwrap().as_deref(), Some("scc"));
    }

    #[tokio::test]
    async fn cancel_staff_assignment_sends_operator_id() {
        let seen = Arc::new(Mutex::new(None));
        let addr = spawn_erp_server(
            "/v1/erp/staff-assignments/asg_1",
            seen.clone(),
            json!({ "id": "asg_1", "tenant_id": "scc", "status": "cancelled" }),
        )
        .await;

        let assignment = test_client(addr)
            .cancel_staff_assignment("asg_1", "scc")
            .await
            .unwrap();

        assert_eq!(assignment.id, "asg_1");
        assert_eq!(seen.lock().unwrap().as_deref(), Some("scc"));
    #[tokio::test]
    async fn client_credentials_provider_acquires_and_caches_token() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let hits = Arc::new(AtomicUsize::new(0));
        let addr = spawn_token_server(axum::routing::post({
            let hits = hits.clone();
            move || {
                let hits = hits.clone();
                async move {
                    hits.fetch_add(1, Ordering::SeqCst);
                    axum::Json(json!({ "access_token": "tok-abc", "expires_in": 3600 }))
                }
            }
        }))
        .await;

        let provider = ClientCredentialsTokenProvider::new(ClientCredentialsConfig {
            token_url: format!("http://{addr}/token"),
            client_id: "cb".to_string(),
            client_secret: "secret".to_string(),
            scope: Some("field-erp".to_string()),
            audience: None,
        });

        let first = provider.bearer_token().await.unwrap();
        let second = provider.bearer_token().await.unwrap();

        assert_eq!(first, "tok-abc");
        assert_eq!(second, "tok-abc");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "token should be cached after the first fetch"
        );
    }

    #[tokio::test]
    async fn client_credentials_provider_surfaces_token_endpoint_errors() {
        let addr = spawn_token_server(axum::routing::post(|| async {
            (StatusCode::UNAUTHORIZED, "invalid_client")
        }))
        .await;

        let provider = ClientCredentialsTokenProvider::new(ClientCredentialsConfig {
            token_url: format!("http://{addr}/token"),
            client_id: "cb".to_string(),
            client_secret: "secret".to_string(),
            scope: None,
            audience: None,
        });

        let error = provider.bearer_token().await.unwrap_err();
        assert!(matches!(
            error,
            FieldApiError::TokenStatus { status, .. } if status == StatusCode::UNAUTHORIZED
        ));
    }
}
