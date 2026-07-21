use std::{
    collections::HashSet,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CLOCK_SKEW_SECONDS: u64 = 60;

pub trait TokenVerifier: Send + Sync {
    fn verify(&self, token: &str) -> Result<AuthenticatedPrincipal, AuthError>;
}

#[derive(Clone)]
pub struct StaticBearerVerifier {
    token: String,
}

impl StaticBearerVerifier {
    pub fn new(token: String) -> Self {
        Self { token }
    }
}

impl TokenVerifier for StaticBearerVerifier {
    fn verify(&self, token: &str) -> Result<AuthenticatedPrincipal, AuthError> {
        if token == self.token {
            Ok(AuthenticatedPrincipal {
                issuer: "local-dev".to_string(),
                subject: Some("local-dev".to_string()),
                client_id: Some("local-dev".to_string()),
            })
        } else {
            Err(AuthError::InvalidToken)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedPrincipal {
    pub issuer: String,
    pub subject: Option<String>,
    pub client_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub issuer_url: String,
    pub expected_audience: String,
    pub expected_client_ids: HashSet<String>,
}

#[derive(Debug, Error)]
pub enum AuthConfigError {
    #[error("OIDC_ISSUER_URL or TACHYON_AUTH_ISSUER_URL must be set")]
    MissingIssuer,
    #[error("EXPECTED_AUDIENCE must be set")]
    MissingAudience,
}

#[derive(Debug, Error)]
pub enum AuthInitError {
    #[error("discovery document request failed")]
    DiscoveryRequest(#[source] reqwest::Error),
    #[error("discovery document returned unsuccessful status {0}")]
    DiscoveryStatus(reqwest::StatusCode),
    #[error("JWKS request failed")]
    JwksRequest(#[source] reqwest::Error),
    #[error("JWKS returned unsuccessful status {0}")]
    JwksStatus(reqwest::StatusCode),
    #[error("issuer in discovery document did not match configured issuer")]
    IssuerMismatch,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("bearer token is required")]
    MissingToken,
    #[error("bearer token is malformed")]
    MalformedToken,
    #[error("token key id is missing")]
    MissingKeyId,
    #[error("token signing key was not found")]
    UnknownKeyId,
    #[error("token signature or claims are invalid")]
    InvalidToken,
    #[error("token issued-at time is in the future")]
    InvalidIssuedAt,
    #[error("token client is not authorized")]
    UnauthorizedClient,
}

impl AuthError {
    pub fn category(&self) -> &'static str {
        match self {
            Self::MissingToken => "missing_token",
            Self::MalformedToken => "malformed_token",
            Self::MissingKeyId => "missing_key_id",
            Self::UnknownKeyId => "unknown_key_id",
            Self::InvalidToken => "invalid_token",
            Self::InvalidIssuedAt => "invalid_issued_at",
            Self::UnauthorizedClient => "unauthorized_client",
        }
    }
}

#[derive(Clone)]
pub struct OidcJwtVerifier {
    issuer: String,
    expected_audience: String,
    expected_client_ids: HashSet<String>,
    jwks: Jwks,
}

impl OidcJwtVerifier {
    pub async fn discover(config: AuthConfig) -> Result<Self, AuthInitError> {
        let client = reqwest::Client::builder()
            .timeout(DEFAULT_HTTP_TIMEOUT)
            .build()
            .expect("reqwest client config must be valid");
        let discovery_url = format!(
            "{}/.well-known/openid-configuration",
            config.issuer_url.trim_end_matches('/')
        );

        let discovery_response = client
            .get(discovery_url)
            .send()
            .await
            .map_err(AuthInitError::DiscoveryRequest)?;
        if !discovery_response.status().is_success() {
            return Err(AuthInitError::DiscoveryStatus(discovery_response.status()));
        }
        let discovery = discovery_response
            .json::<DiscoveryDocument>()
            .await
            .map_err(AuthInitError::DiscoveryRequest)?;
        let configured_issuer = config.issuer_url.trim_end_matches('/');
        if discovery.issuer.trim_end_matches('/') != configured_issuer {
            return Err(AuthInitError::IssuerMismatch);
        }

        let jwks_response = client
            .get(discovery.jwks_uri)
            .send()
            .await
            .map_err(AuthInitError::JwksRequest)?;
        if !jwks_response.status().is_success() {
            return Err(AuthInitError::JwksStatus(jwks_response.status()));
        }
        let jwks = jwks_response
            .json::<Jwks>()
            .await
            .map_err(AuthInitError::JwksRequest)?;

        Ok(Self::from_jwks(config, jwks))
    }

    pub fn from_jwks(config: AuthConfig, jwks: Jwks) -> Self {
        Self {
            issuer: config.issuer_url.trim_end_matches('/').to_string(),
            expected_audience: config.expected_audience,
            expected_client_ids: config.expected_client_ids,
            jwks,
        }
    }
}

impl TokenVerifier for OidcJwtVerifier {
    fn verify(&self, token: &str) -> Result<AuthenticatedPrincipal, AuthError> {
        let header = decode_header(token).map_err(|_| AuthError::MalformedToken)?;
        let kid = header.kid.ok_or(AuthError::MissingKeyId)?;
        let key = self
            .jwks
            .keys
            .iter()
            .find(|key| key.kid.as_deref() == Some(kid.as_str()))
            .ok_or(AuthError::UnknownKeyId)?;

        if key.kty != "RSA" || key.alg.as_deref().is_some_and(|alg| alg != "RS256") {
            return Err(AuthError::InvalidToken);
        }

        let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)
            .map_err(|_| AuthError::InvalidToken)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.validate_aud = false;
        validation.validate_nbf = true;
        validation.leeway = MAX_CLOCK_SKEW_SECONDS;
        validation.required_spec_claims.insert("exp".to_string());
        validation.required_spec_claims.insert("iat".to_string());

        let token_data = decode::<JwtClaims>(token, &decoding_key, &validation)
            .map_err(|_| AuthError::InvalidToken)?;

        // Cognito signs both ID tokens and access tokens with keys from the
        // same user pool. API authorization must only accept access tokens.
        if is_cognito_issuer(&self.issuer)
            && token_data.claims.token_use.as_deref() != Some("access")
        {
            return Err(AuthError::InvalidToken);
        }

        let now = unix_timestamp();
        if token_data.claims.iat > now + MAX_CLOCK_SKEW_SECONDS {
            return Err(AuthError::InvalidIssuedAt);
        }

        let client_id = token_data
            .claims
            .client_id
            .clone()
            .or_else(|| token_data.claims.azp.clone());
        // Cognito access tokens often omit `aud` and only carry `client_id`.
        // When `aud` is present it must match EXPECTED_AUDIENCE or an allowlisted
        // EXPECTED_CLIENT_ID. When `aud` is absent, `client_id` may match either.
        let audience_matches = if audience_claim_present(&token_data.claims.aud) {
            audience_contains(&token_data.claims.aud, self.expected_audience.as_str())
                || audience_contains_any(&token_data.claims.aud, &self.expected_client_ids)
        } else {
            client_id.as_deref() == Some(self.expected_audience.as_str())
                || client_id
                    .as_ref()
                    .is_some_and(|value| self.expected_client_ids.contains(value))
        };
        if !audience_matches {
            return Err(AuthError::InvalidToken);
        }

        if !self.expected_client_ids.is_empty() {
            let authorized = client_id
                .as_ref()
                .or(token_data.claims.sub.as_ref())
                .is_some_and(|value| self.expected_client_ids.contains(value))
                || audience_contains_any(&token_data.claims.aud, &self.expected_client_ids);
            if !authorized {
                return Err(AuthError::UnauthorizedClient);
            }
        }

        Ok(AuthenticatedPrincipal {
            issuer: token_data.claims.iss,
            subject: token_data.claims.sub,
            client_id,
        })
    }
}

fn audience_claim_present(audience: &serde_json::Value) -> bool {
    match audience {
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Array(values) => values
            .iter()
            .any(|value| value.as_str().is_some_and(|entry| !entry.is_empty())),
        _ => false,
    }
}

fn is_cognito_issuer(issuer: &str) -> bool {
    issuer.starts_with("https://cognito-idp.") && issuer.contains(".amazonaws.com/")
}

fn audience_contains(audience: &serde_json::Value, expected: &str) -> bool {
    match audience {
        serde_json::Value::String(value) => value == expected,
        serde_json::Value::Array(values) => values.iter().any(|value| value == expected),
        _ => false,
    }
}

fn audience_contains_any(audience: &serde_json::Value, expected: &HashSet<String>) -> bool {
    match audience {
        serde_json::Value::String(value) => expected.contains(value),
        serde_json::Value::Array(values) => values
            .iter()
            .filter_map(|value| value.as_str())
            .any(|value| expected.contains(value)),
        _ => false,
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after UNIX_EPOCH")
        .as_secs()
}

#[derive(Debug, Deserialize)]
struct DiscoveryDocument {
    issuer: String,
    jwks_uri: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Jwks {
    pub keys: Vec<Jwk>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Jwk {
    pub kty: String,
    pub kid: Option<String>,
    pub n: String,
    pub e: String,
    pub alg: Option<String>,
    #[serde(rename = "use")]
    pub key_use: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct JwtClaims {
    iss: String,
    sub: Option<String>,
    #[serde(default)]
    aud: serde_json::Value,
    exp: u64,
    nbf: Option<u64>,
    iat: u64,
    client_id: Option<String>,
    azp: Option<String>,
    token_use: Option<String>,
}
