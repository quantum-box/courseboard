//! Reading and saving the course's pricing inputs.
//!
//! Two use cases, one public entrypoint each. The storage is a single row of
//! CourseBoard's own (ADR-0009); the tax table that row is the key into has
//! always lived here.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, GolfPricingSettings,
    PricingSettingsGateway,
};

use super::GetExtensionStatusUseCase;

/// The inputs pricing runs on, wherever they currently live.
///
/// Falls back to the extension config the settings migrated from, so a course
/// that chose its prefecture before the move keeps quoting the right tax. The
/// config read answers with the defaults when it finds nothing, so there is no
/// third step. A row of our own — even one with the prefecture deliberately
/// left open — ends the fallback. Drop it, and the config keys with it, once
/// the tenants have been through here.
///
/// Shared by the settings panel and both simulator entrypoints, because the
/// form must show the same inputs the quote just used.
pub(crate) async fn read_pricing_settings(
    commercial: &Arc<dyn GolfCommercialGateway>,
    settings: &dyn PricingSettingsGateway,
    credentials: GatewayCredentials<'_>,
) -> Result<GolfPricingSettings, CourseError> {
    if let Some(stored) = settings
        .get_pricing_settings(credentials.operator_id)
        .await?
    {
        return Ok(stored);
    }
    let status = GetExtensionStatusUseCase::new(commercial.clone())
        .execute(credentials)
        .await?;
    Ok(status
        .as_ref()
        .and_then(|item| item.config_json())
        .map(GolfPricingSettings::from_config)
        .unwrap_or_default())
}

pub struct GetPricingSettingsUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
    settings: Arc<dyn PricingSettingsGateway>,
}

impl GetPricingSettingsUseCase {
    pub fn new(
        commercial: Arc<dyn GolfCommercialGateway>,
        settings: Arc<dyn PricingSettingsGateway>,
    ) -> Self {
        Self {
            commercial,
            settings,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<GolfPricingSettings, CourseError> {
        // The action that reads quotes also reads their inputs: a screen that
        // may show the price may show what the price was built from.
        credentials.require(actions::CALCULATE_FEES).await?;
        read_pricing_settings(&self.commercial, self.settings.as_ref(), credentials).await
    }
}

pub struct ReplacePricingSettingsUseCase {
    settings: Arc<dyn PricingSettingsGateway>,
}

impl ReplacePricingSettingsUseCase {
    pub fn new(settings: Arc<dyn PricingSettingsGateway>) -> Self {
        Self { settings }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        settings: GolfPricingSettings,
    ) -> Result<GolfPricingSettings, CourseError> {
        // Same action that guarded these values when they were saved through
        // the extension config: the permission is about changing the club's
        // pricing rules, not about where they happen to be stored.
        credentials
            .require(actions::MANAGE_RESERVATION_POLICY)
            .await?;
        self.settings
            .replace_pricing_settings(credentials.operator_id, &settings)
            .await
    }
}
