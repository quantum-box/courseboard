//! Reading and setting what a round pays at each rank.
//!
//! Two use cases, one public entrypoint each. Both are thin: the table is a
//! value object that validates itself, and the storage is a single row of
//! CourseBoard's own (ADR-0009).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieRankFeeGateway, CaddieRankFees, CourseError, GatewayCredentials, GolfOpsGateway,
};

/// The table a club is paying by.
///
/// Falls back to the extension config the table used to live in, so a club that
/// priced its ranks before the move keeps being paid that way. The config read
/// answers with the defaults when it finds nothing, so there is no third step.
///
/// Reading our own storage as `Option` is what makes this safe: a club that
/// deliberately confirmed the default amounts counts as set and does not fall
/// back. Drop the fallback, and the config key with it, once the tenants have
/// been through here.
///
/// Shared by every caller — the settings screen, payroll, auto-assign, manual
/// assignment — because a fee that differs between the screen showing it and
/// the sheet paying by it is worse than either answer alone.
pub(crate) async fn read_caddie_rank_fees(
    ops: &dyn GolfOpsGateway,
    rank_fees: &dyn CaddieRankFeeGateway,
    credentials: GatewayCredentials<'_>,
) -> Result<CaddieRankFees, CourseError> {
    if let Some(stored) = rank_fees
        .get_caddie_rank_fees(credentials.operator_id)
        .await?
    {
        return Ok(stored);
    }
    ops.get_caddie_rank_fees(credentials).await
}

/// A club that has not priced its ranks in CourseBoard's own storage.
///
/// Tests that predate the move use this to keep reading the table from where
/// they always did — the fallback above — so they go on asserting what they
/// were written to assert.
#[cfg(test)]
pub(crate) struct UnsetRankFees;

#[cfg(test)]
#[async_trait::async_trait]
impl CaddieRankFeeGateway for UnsetRankFees {
    async fn get_caddie_rank_fees(
        &self,
        _tenant_id: &str,
    ) -> Result<Option<CaddieRankFees>, CourseError> {
        Ok(None)
    }

    async fn replace_caddie_rank_fees(
        &self,
        _tenant_id: &str,
        fees: &CaddieRankFees,
    ) -> Result<CaddieRankFees, CourseError> {
        Ok(fees.clone())
    }
}

pub struct GetCaddieRankFeesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
}

impl GetCaddieRankFeesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, rank_fees: Arc<dyn CaddieRankFeeGateway>) -> Self {
        Self { ops, rank_fees }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieRankFees, CourseError> {
        credentials.require(actions::LIST_CADDIE_RANK_FEES).await?;
        read_caddie_rank_fees(self.ops.as_ref(), self.rank_fees.as_ref(), credentials).await
    }
}

pub struct ReplaceCaddieRankFeesUseCase {
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
}

impl ReplaceCaddieRankFeesUseCase {
    pub fn new(rank_fees: Arc<dyn CaddieRankFeeGateway>) -> Self {
        Self { rank_fees }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        fees: CaddieRankFees,
    ) -> Result<CaddieRankFees, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_RANK_FEES)
            .await?;
        self.rank_fees
            .replace_caddie_rank_fees(credentials.operator_id, &fees)
            .await
    }
}
