//! UpdateCaddieUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    Caddie, CaddieId, CaddiePatch, CourseError, GatewayCredentials, GolfOpsGateway,
};

pub struct UpdateCaddieUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl UpdateCaddieUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    /// Merges against the stored profile so fields the caller omitted keep their
    /// current values instead of being reset to creation defaults upstream.
    /// A body that already names every field skips that read.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie_id: &CaddieId,
        patch: CaddiePatch,
    ) -> Result<Caddie, CourseError> {
        let input = if patch.is_complete() {
            patch.into_upsert()?
        } else {
            let roster = self.ops.list_caddie_roster(credentials).await?;
            let current = roster
                .caddies()
                .iter()
                .find(|caddie| caddie.id() == caddie_id)
                .ok_or(CourseError::NotFound("caddie profile was not found"))?;
            patch.apply_to(current)?
        };
        self.ops.update_caddie(credentials, caddie_id, input).await
    }
}
