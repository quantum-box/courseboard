use std::{collections::HashSet, net::SocketAddr};

use clap::Parser;

use crate::{
    auth::{AuthConfig, AuthConfigError},
    cancellation_fees::CancellationFeeConfig,
    course::infrastructure::DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
    field_api::{ClientCredentialsConfig, DEFAULT_FIELD_API_URL},
};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";
const DEFAULT_PUBLIC_UI_BASE_URL: &str = "http://localhost:5173";
const DEFAULT_SMS_SENDER_NAME: &str = "Course Board";
pub const DEFAULT_TACHYON_API_URL: &str = "https://api.n1.tachy.one";
const PRODUCTION_COGNITO_ISSUER_URL: &str =
    "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_8Ga4bK5M4";
const LOCAL_PRODUCTION_PKCE_CLIENT_ID: &str = "5oafg9ptonbjumdh1pc7khirp1";
/// Production `courseboard-web` browser client. Real web sessions log in with
/// this client, and the Auth.js BFF forwards its Cognito access token to
/// `/v1/course/*`. Cognito access tokens omit `aud`, so the token only carries
/// `client_id`; this id must be an accepted client or the audience check
/// rejects every browser request with `401 authorization failed`. Kept in the
/// production-issuer code allowlist alongside the PKCE client so the primary
/// production auth path survives `EXPECTED_CLIENT_ID` env drift.
const PRODUCTION_WEB_CLIENT_ID: &str = "7su0cbc8mr3dhji93gknu7pm19";
/// Explicit opt-out marker for unit/integration tests.
/// Set `TACHYON_FIELD_API_URL=empty://local` to skip remote Field calls.
/// Normal local/`cargo run` / mise API starts never select this automatically.
pub const EMPTY_COURSE_STORE_URL: &str = "empty://local";

#[derive(Debug, Clone, Parser)]
#[command(name = "courseboard", about = "Course Board API server")]
pub struct RuntimeConfig {
    #[arg(long, env = "BIND_ADDR", default_value = DEFAULT_BIND_ADDR)]
    pub bind_addr: SocketAddr,
    #[arg(long, env = "DATABASE_URL")]
    pub database_url: String,
    #[arg(long, env = "COURSEBOARD_DEV_BEARER_TOKEN")]
    pub dev_bearer_token: Option<String>,

    #[arg(long, env = "OIDC_ISSUER_URL")]
    pub oidc_issuer_url: Option<String>,
    #[arg(long, env = "TACHYON_AUTH_ISSUER_URL")]
    pub tachyon_auth_issuer_url: Option<String>,
    #[arg(long, env = "EXPECTED_AUDIENCE")]
    pub expected_audience: Option<String>,
    #[arg(long, env = "EXPECTED_CLIENT_ID")]
    pub expected_client_id: Option<String>,

    #[arg(
        long,
        env = "COURSEBOARD_PUBLIC_UI_BASE_URL",
        default_value = DEFAULT_PUBLIC_UI_BASE_URL
    )]
    pub public_ui_base_url: String,
    #[arg(
        long,
        env = "COURSEBOARD_SMS_SENDER_NAME",
        default_value = DEFAULT_SMS_SENDER_NAME
    )]
    pub sms_sender_name: String,

    /// Tachyon auth API used to resolve each tenant's platform id for /v1/me.
    /// Set to `empty://local` to disable the lookup (unit/integration tests).
    #[arg(long, env = "TACHYON_AUTH_API_URL")]
    pub tachyon_auth_api_url: Option<String>,

    #[arg(long, env = "TACHYON_FIELD_API_URL")]
    pub tachyon_field_api_url: Option<String>,
    #[arg(long, env = "FIELD_API_URL")]
    pub field_api_url: Option<String>,
    #[arg(long, env = "COURSEBOARD_FIELD_API_URL")]
    pub courseboard_field_api_url: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_BEARER_TOKEN")]
    pub field_api_bearer_token: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_TOKEN_URL")]
    pub field_api_token_url: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_CLIENT_ID")]
    pub field_api_client_id: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_CLIENT_SECRET")]
    pub field_api_client_secret: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_SCOPE")]
    pub field_api_scope: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_AUDIENCE")]
    pub field_api_audience: Option<String>,

    /// Kill switch for selling one plan on several courses (SCC-3 / PLT-3353).
    ///
    /// On by default. Set to `false` to stop CourseBoard writing the paired
    /// `golfCourseIds` / `eligibleResourceIds` shape when the Field it talks to
    /// turns out not to read the second array yet.
    #[arg(
        long,
        env = "COURSEBOARD_MULTI_COURSE_PRODUCT_WRITES",
        default_value_t = DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
        action = clap::ArgAction::Set,
    )]
    pub multi_course_product_writes: bool,

    #[arg(long, env = "TWILIO_ACCOUNT_SID")]
    pub twilio_account_sid: Option<String>,
    #[arg(long, env = "TWILIO_AUTH_TOKEN")]
    pub twilio_auth_token: Option<String>,
    #[arg(long, env = "TWILIO_MESSAGING_SERVICE_SID")]
    pub twilio_messaging_service_sid: Option<String>,
    #[arg(long, env = "TWILIO_FROM_NUMBER")]
    pub twilio_from_number: Option<String>,
}

impl RuntimeConfig {
    pub fn from_args() -> Self {
        Self::parse()
    }

    pub fn auth_config(&self) -> Result<AuthConfig, AuthConfigError> {
        let issuer_url = first_non_empty([
            self.oidc_issuer_url.as_deref(),
            self.tachyon_auth_issuer_url.as_deref(),
        ])
        .ok_or(AuthConfigError::MissingIssuer)?;
        let expected_audience =
            non_empty(self.expected_audience.as_deref()).ok_or(AuthConfigError::MissingAudience)?;

        let mut expected_client_ids = parse_csv_set(self.expected_client_id.as_deref());
        if issuer_url.trim_end_matches('/') == PRODUCTION_COGNITO_ISSUER_URL {
            expected_client_ids.insert(LOCAL_PRODUCTION_PKCE_CLIENT_ID.to_string());
            expected_client_ids.insert(PRODUCTION_WEB_CLIENT_ID.to_string());
        }

        Ok(AuthConfig {
            issuer_url,
            expected_audience,
            expected_client_ids,
        })
    }

    pub fn cancellation_fee_config(&self) -> CancellationFeeConfig {
        let field_upstream_authorization = self.field_api_bearer_token().map(|token| {
            if token.starts_with("Bearer ") {
                token
            } else {
                format!("Bearer {token}")
            }
        });
        if field_upstream_authorization.is_some() {
            tracing::warn!(
                "TACHYON_FIELD_API_BEARER_TOKEN overrides outbound Field Authorization; \
                 normal browser-pkce forwards the inbound login bearer instead"
            );
        }
        CancellationFeeConfig {
            public_ui_base_url: non_empty(Some(&self.public_ui_base_url))
                .unwrap_or_else(|| DEFAULT_PUBLIC_UI_BASE_URL.to_string()),
            sms_sender_name: non_empty(Some(&self.sms_sender_name))
                .unwrap_or_else(|| DEFAULT_SMS_SENDER_NAME.to_string()),
            // Course `/v1/course/*` gateways always target Field (prod default
            // when unset). Explicit `empty://local` is test-only opt-out.
            field_api_url: Some(self.course_gateway_base_url()),
            field_upstream_authorization,
            twilio_account_sid: non_empty(self.twilio_account_sid.as_deref()),
            twilio_auth_token: non_empty(self.twilio_auth_token.as_deref()),
            twilio_messaging_service_sid: non_empty(self.twilio_messaging_service_sid.as_deref()),
            twilio_from_number: non_empty(self.twilio_from_number.as_deref()),
            multi_course_product_writes: self.multi_course_product_writes,
        }
    }

    /// Base URL for the admin Field API client (staff / ERP helpers).
    pub fn field_api_base_url(&self) -> String {
        first_non_empty([
            self.tachyon_field_api_url.as_deref(),
            self.field_api_url.as_deref(),
            self.courseboard_field_api_url.as_deref(),
        ])
        .unwrap_or_else(|| DEFAULT_FIELD_API_URL.to_string())
    }

    /// Upstream used by course-api Field write-through gateways.
    ///
    /// Defaults to production Field ([`DEFAULT_FIELD_API_URL`]) when unset.
    /// Local `COURSEBOARD_DEV_BEARER_TOKEN` no longer selects the empty store;
    /// set `TACHYON_FIELD_API_URL=empty://local` only for intentional test opt-out.
    pub fn course_gateway_base_url(&self) -> String {
        first_non_empty([
            self.tachyon_field_api_url.as_deref(),
            self.field_api_url.as_deref(),
            self.courseboard_field_api_url.as_deref(),
        ])
        .unwrap_or_else(|| DEFAULT_FIELD_API_URL.to_string())
    }

    pub fn field_api_bearer_token(&self) -> Option<String> {
        non_empty(self.field_api_bearer_token.as_deref())
    }

    /// Shared Tachyon API base for identity lookups and feature evaluation.
    pub fn tachyon_api_base_url(&self) -> String {
        non_empty(self.tachyon_auth_api_url.as_deref())
            .unwrap_or_else(|| DEFAULT_TACHYON_API_URL.to_string())
    }

    pub fn field_api_client_credentials_config(&self) -> Option<ClientCredentialsConfig> {
        Some(ClientCredentialsConfig {
            token_url: non_empty(self.field_api_token_url.as_deref())?,
            client_id: non_empty(self.field_api_client_id.as_deref())?,
            client_secret: non_empty(self.field_api_client_secret.as_deref())?,
            scope: non_empty(self.field_api_scope.as_deref()),
            audience: non_empty(self.field_api_audience.as_deref()),
        })
    }

    pub fn dev_bearer_token(&self) -> Option<String> {
        non_empty(self.dev_bearer_token.as_deref())
    }
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            bind_addr: DEFAULT_BIND_ADDR
                .parse()
                .expect("default bind address must be valid"),
            database_url: String::new(),
            dev_bearer_token: None,
            oidc_issuer_url: None,
            tachyon_auth_issuer_url: None,
            expected_audience: None,
            expected_client_id: None,
            public_ui_base_url: DEFAULT_PUBLIC_UI_BASE_URL.to_string(),
            sms_sender_name: DEFAULT_SMS_SENDER_NAME.to_string(),
            tachyon_auth_api_url: None,
            tachyon_field_api_url: None,
            field_api_url: None,
            courseboard_field_api_url: None,
            field_api_bearer_token: None,
            field_api_token_url: None,
            field_api_client_id: None,
            field_api_client_secret: None,
            field_api_scope: None,
            field_api_audience: None,
            multi_course_product_writes: DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
            twilio_account_sid: None,
            twilio_auth_token: None,
            twilio_messaging_service_sid: None,
            twilio_from_number: None,
        }
    }
}

fn first_non_empty<const N: usize>(values: [Option<&str>; N]) -> Option<String> {
    values.into_iter().find_map(non_empty)
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_csv_set(value: Option<&str>) -> HashSet<String> {
    value
        .into_iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_api_url_prefers_primary_env_name_then_aliases_then_default() {
        let config = RuntimeConfig::default();
        assert_eq!(config.field_api_base_url(), DEFAULT_FIELD_API_URL);

        let config = RuntimeConfig {
            field_api_url: Some("https://field-alias.example".to_string()),
            courseboard_field_api_url: Some("https://courseboard-alias.example".to_string()),
            ..RuntimeConfig::default()
        };
        assert_eq!(config.field_api_base_url(), "https://field-alias.example");

        let config = RuntimeConfig {
            tachyon_field_api_url: Some("https://tachyon-field.example".to_string()),
            field_api_url: Some("https://field-alias.example".to_string()),
            ..RuntimeConfig::default()
        };
        assert_eq!(config.field_api_base_url(), "https://tachyon-field.example");
    }

    #[test]
    fn tachyon_api_url_is_shared_by_identity_and_feature_evaluation() {
        assert_eq!(
            RuntimeConfig::default().tachyon_api_base_url(),
            DEFAULT_TACHYON_API_URL
        );

        let config = RuntimeConfig {
            tachyon_auth_api_url: Some("https://tachyon.example/base".to_string()),
            ..RuntimeConfig::default()
        };
        assert_eq!(
            config.tachyon_api_base_url(),
            "https://tachyon.example/base"
        );
    }

    #[test]
    fn course_gateway_defaults_to_prod_field_even_with_dev_bearer() {
        let config = RuntimeConfig {
            dev_bearer_token: Some("local-dev-token".to_string()),
            ..RuntimeConfig::default()
        };
        assert_eq!(config.course_gateway_base_url(), DEFAULT_FIELD_API_URL);
        assert_eq!(config.field_api_base_url(), DEFAULT_FIELD_API_URL);

        let config = RuntimeConfig {
            dev_bearer_token: Some("local-dev-token".to_string()),
            tachyon_field_api_url: Some("http://127.0.0.1:50056".to_string()),
            ..RuntimeConfig::default()
        };
        assert_eq!(config.course_gateway_base_url(), "http://127.0.0.1:50056");

        // Explicit empty://local remains available as intentional test opt-out.
        let config = RuntimeConfig {
            dev_bearer_token: Some("local-dev-token".to_string()),
            tachyon_field_api_url: Some(EMPTY_COURSE_STORE_URL.to_string()),
            ..RuntimeConfig::default()
        };
        assert_eq!(config.course_gateway_base_url(), EMPTY_COURSE_STORE_URL);
    }

    #[test]
    fn auth_config_uses_oidc_alias_and_parses_client_ids() {
        let config = RuntimeConfig {
            oidc_issuer_url: Some("https://issuer.example".to_string()),
            tachyon_auth_issuer_url: Some("https://tachyon-auth.example".to_string()),
            expected_audience: Some("courseboard".to_string()),
            expected_client_id: Some("field-core, field-admin".to_string()),
            ..RuntimeConfig::default()
        };

        let auth = config.auth_config().expect("auth config");
        assert_eq!(auth.issuer_url, "https://issuer.example");
        assert_eq!(auth.expected_audience, "courseboard");
        assert!(auth.expected_client_ids.contains("field-core"));
        assert!(auth.expected_client_ids.contains("field-admin"));
    }

    #[test]
    fn auth_config_keeps_known_local_prod_client_when_provider_env_drifts() {
        let config = RuntimeConfig {
            oidc_issuer_url: Some(PRODUCTION_COGNITO_ISSUER_URL.to_string()),
            expected_audience: Some("courseboard-web".to_string()),
            expected_client_id: Some("courseboard-web".to_string()),
            ..RuntimeConfig::default()
        };

        let auth = config.auth_config().expect("auth config");
        assert!(auth
            .expected_client_ids
            .contains(LOCAL_PRODUCTION_PKCE_CLIENT_ID));
        // The production browser client (courseboard-web) is the primary
        // production auth path: real web sessions forward its Cognito access
        // token, so it must stay accepted even if EXPECTED_CLIENT_ID drifts.
        assert!(auth.expected_client_ids.contains(PRODUCTION_WEB_CLIENT_ID));
    }

    #[test]
    fn auth_config_does_not_add_prod_client_for_other_issuers() {
        let config = RuntimeConfig {
            oidc_issuer_url: Some("https://issuer.example".to_string()),
            expected_audience: Some("courseboard-web".to_string()),
            expected_client_id: Some("courseboard-web".to_string()),
            ..RuntimeConfig::default()
        };

        let auth = config.auth_config().expect("auth config");
        assert!(!auth
            .expected_client_ids
            .contains(LOCAL_PRODUCTION_PKCE_CLIENT_ID));
        assert!(!auth.expected_client_ids.contains(PRODUCTION_WEB_CLIENT_ID));
    }

    #[test]
    fn cancellation_fee_config_omits_field_upstream_without_static_bearer() {
        let config = RuntimeConfig::default().cancellation_fee_config();
        assert!(config.field_upstream_authorization.is_none());

        let config = RuntimeConfig {
            field_api_bearer_token: Some("cli-override".to_string()),
            ..RuntimeConfig::default()
        }
        .cancellation_fee_config();
        assert_eq!(
            config.field_upstream_authorization.as_deref(),
            Some("Bearer cli-override")
        );
    }

    #[test]
    fn field_api_client_credentials_requires_all_required_values() {
        let incomplete = RuntimeConfig {
            field_api_token_url: Some("https://auth.example/token".to_string()),
            field_api_client_id: Some("client".to_string()),
            ..RuntimeConfig::default()
        };
        assert!(incomplete.field_api_client_credentials_config().is_none());

        let complete = RuntimeConfig {
            field_api_token_url: Some("https://auth.example/token".to_string()),
            field_api_client_id: Some("client".to_string()),
            field_api_client_secret: Some("secret".to_string()),
            field_api_scope: Some("field:read".to_string()),
            field_api_audience: Some("field-api".to_string()),
            ..RuntimeConfig::default()
        };
        let config = complete
            .field_api_client_credentials_config()
            .expect("client credentials config");
        assert_eq!(config.token_url, "https://auth.example/token");
        assert_eq!(config.client_id, "client");
        assert_eq!(config.client_secret, "secret");
        assert_eq!(config.scope.as_deref(), Some("field:read"));
        assert_eq!(config.audience.as_deref(), Some("field-api"));
    }
}
