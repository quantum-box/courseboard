//! Reading and arranging the booking form's visitor categories.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, GatewayCredentials, GolfCommercialGateway, PlayerTagOptions,
    PlayerTagOptionsGateway,
};

use super::GetExtensionStatusUseCase;

/// The categories the booking form offers, wherever they currently live.
///
/// Falls back to the extension config the list migrated from, so a club that
/// arranged its categories before the move keeps seeing them. An empty list of
/// our own cannot be told apart from "never saved here", the same trade the
/// course order made: carrying a flag forever to serve one migration is worse
/// than the fallback showing stale categories until a non-empty save. Drop the
/// fallback, and the config key with it, once the tenants have been through.
pub(crate) async fn read_player_tag_options(
    commercial: &Arc<dyn GolfCommercialGateway>,
    tags: &dyn PlayerTagOptionsGateway,
    credentials: GatewayCredentials<'_>,
) -> Result<PlayerTagOptions, CourseError> {
    let stored = tags.get_player_tag_options(credentials.operator_id).await?;
    if !stored.is_empty() {
        return Ok(stored);
    }
    let status = GetExtensionStatusUseCase::new(commercial.clone())
        .execute(credentials)
        .await?;
    Ok(status
        .as_ref()
        .and_then(|item| item.config_json())
        .map(PlayerTagOptions::from_config)
        .unwrap_or_default())
}

pub struct GetPlayerTagOptionsUseCase {
    commercial: Arc<dyn GolfCommercialGateway>,
    tags: Arc<dyn PlayerTagOptionsGateway>,
}

impl GetPlayerTagOptionsUseCase {
    pub fn new(
        commercial: Arc<dyn GolfCommercialGateway>,
        tags: Arc<dyn PlayerTagOptionsGateway>,
    ) -> Self {
        Self { commercial, tags }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<PlayerTagOptions, CourseError> {
        // The categories exist to enter a booking on the tee board, so the
        // action that opens the board is the one that reads them.
        credentials.require(actions::LIST_TEE_SHEET).await?;
        read_player_tag_options(&self.commercial, self.tags.as_ref(), credentials).await
    }
}

pub struct ReplacePlayerTagOptionsUseCase {
    tags: Arc<dyn PlayerTagOptionsGateway>,
}

impl ReplacePlayerTagOptionsUseCase {
    pub fn new(tags: Arc<dyn PlayerTagOptionsGateway>) -> Self {
        Self { tags }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        options: PlayerTagOptions,
    ) -> Result<PlayerTagOptions, CourseError> {
        // Same action that guarded the list when it was saved through the
        // extension config.
        credentials
            .require(actions::MANAGE_RESERVATION_POLICY)
            .await?;
        self.tags
            .replace_player_tag_options(credentials.operator_id, &options)
            .await
    }
}
