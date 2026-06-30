use std::{collections::HashSet, net::SocketAddr};

use clap::Parser;

use crate::{
    auth::{AuthConfig, AuthConfigError},
    cancellation_fees::CancellationFeeConfig,
    field_api::DEFAULT_FIELD_API_URL,
};

const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8080";
const DEFAULT_DATABASE_URL: &str = "sqlite://courseboard.db";
const DEFAULT_PUBLIC_UI_BASE_URL: &str = "http://localhost:5173";
const DEFAULT_SMS_SENDER_NAME: &str = "Course Board";

#[derive(Debug, Clone, Parser)]
#[command(name = "courseboard", about = "Course Board API server")]
pub struct RuntimeConfig {
    #[arg(long, env = "BIND_ADDR", default_value = DEFAULT_BIND_ADDR)]
    pub bind_addr: SocketAddr,
    #[arg(long, env = "DATABASE_URL", default_value = DEFAULT_DATABASE_URL)]
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

    #[arg(long, env = "TACHYON_FIELD_API_URL")]
    pub tachyon_field_api_url: Option<String>,
    #[arg(long, env = "FIELD_API_URL")]
    pub field_api_url: Option<String>,
    #[arg(long, env = "COURSEBOARD_FIELD_API_URL")]
    pub courseboard_field_api_url: Option<String>,
    #[arg(long, env = "TACHYON_FIELD_API_BEARER_TOKEN")]
    pub field_api_bearer_token: Option<String>,

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

        Ok(AuthConfig {
            issuer_url,
            expected_audience,
            expected_client_ids: parse_csv_set(self.expected_client_id.as_deref()),
        })
    }

    pub fn cancellation_fee_config(&self) -> CancellationFeeConfig {
        CancellationFeeConfig {
            public_ui_base_url: non_empty(Some(&self.public_ui_base_url))
                .unwrap_or_else(|| DEFAULT_PUBLIC_UI_BASE_URL.to_string()),
            sms_sender_name: non_empty(Some(&self.sms_sender_name))
                .unwrap_or_else(|| DEFAULT_SMS_SENDER_NAME.to_string()),
            field_api_url: Some(self.field_api_base_url()),
            twilio_account_sid: non_empty(self.twilio_account_sid.as_deref()),
            twilio_auth_token: non_empty(self.twilio_auth_token.as_deref()),
            twilio_messaging_service_sid: non_empty(self.twilio_messaging_service_sid.as_deref()),
            twilio_from_number: non_empty(self.twilio_from_number.as_deref()),
        }
    }

    pub fn field_api_base_url(&self) -> String {
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
            database_url: DEFAULT_DATABASE_URL.to_string(),
            dev_bearer_token: None,
            oidc_issuer_url: None,
            tachyon_auth_issuer_url: None,
            expected_audience: None,
            expected_client_id: None,
            public_ui_base_url: DEFAULT_PUBLIC_UI_BASE_URL.to_string(),
            sms_sender_name: DEFAULT_SMS_SENDER_NAME.to_string(),
            tachyon_field_api_url: None,
            field_api_url: None,
            courseboard_field_api_url: None,
            field_api_bearer_token: None,
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
}
