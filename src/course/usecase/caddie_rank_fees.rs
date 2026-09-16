//! Reading and setting what a round pays at each rank.
//!
//! Three use cases, one public entrypoint each. All are thin: the table is a
//! value object that validates itself, and the storage is a single row of
//! CourseBoard's own (ADR-0009) with a history of every save beside it
//! (PLT-3348).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieRankFeeChange, CaddieRankFeeChangeContext, CaddieRankFeeGateway, CaddieRankFees,
    CourseError, GatewayCredentials, GolfOpsGateway,
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
        _previous: &CaddieRankFees,
        fees: &CaddieRankFees,
        _context: &CaddieRankFeeChangeContext,
    ) -> Result<CaddieRankFees, CourseError> {
        Ok(fees.clone())
    }

    async fn list_caddie_rank_fee_changes(
        &self,
        _tenant_id: &str,
        _limit: u32,
    ) -> Result<Vec<CaddieRankFeeChange>, CourseError> {
        Ok(Vec::new())
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
    ops: Arc<dyn GolfOpsGateway>,
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
}

impl ReplaceCaddieRankFeesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, rank_fees: Arc<dyn CaddieRankFeeGateway>) -> Self {
        Self { ops, rank_fees }
    }

    /// Set the table, and write down what it replaced, who, and why.
    ///
    /// "What it replaced" is what payroll was reading, not only what this
    /// storage held: for a club saving for the first time that is the defaults
    /// or the old extension config, and a history that started from nothing
    /// could not say what the first save changed.
    ///
    /// Saving the amounts already stored changes nobody's pay and leaves no
    /// entry — a history padded with no-ops buries the saves that mattered.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        fees: CaddieRankFees,
        context: CaddieRankFeeChangeContext,
    ) -> Result<CaddieRankFees, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_RANK_FEES)
            .await?;
        let stored = self
            .rank_fees
            .get_caddie_rank_fees(credentials.operator_id)
            .await?;
        if stored.as_ref() == Some(&fees) {
            return Ok(fees);
        }
        let previous = match stored {
            Some(stored) => stored,
            None => self.ops.get_caddie_rank_fees(credentials).await?,
        };
        self.rank_fees
            .replace_caddie_rank_fees(credentials.operator_id, &previous, &fees, &context)
            .await
    }
}

/// How the rank fees got to where they are, newest change first.
pub struct ListCaddieRankFeeChangesUseCase {
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
}

impl ListCaddieRankFeeChangesUseCase {
    pub fn new(rank_fees: Arc<dyn CaddieRankFeeGateway>) -> Self {
        Self { rank_fees }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        limit: u32,
    ) -> Result<Vec<CaddieRankFeeChange>, CourseError> {
        credentials.require(actions::LIST_CADDIE_RANK_FEES).await?;
        self.rank_fees
            .list_caddie_rank_fee_changes(credentials.operator_id, limit)
            .await
    }
}
