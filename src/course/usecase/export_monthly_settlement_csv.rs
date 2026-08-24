//! ExportMonthlySettlementCsvUseCase: one use case, one public entrypoint (`execute`).
//!
//! The file is built from the same report the screen shows, so what an
//! operator hands to accounting says what they were looking at when they
//! pressed the button. The header strings and column order stay Field's,
//! because accounting may be reading the file with a script.

use std::sync::Arc;

use crate::config::SettlementSource;
use crate::course::domain::actions;
use crate::course::domain::{
    settlement_csv, CourseError, GatewayCredentials, GolfCatalogGateway, GolfCommercialGateway,
    GolfOpsGateway, ReservationGateway,
};

use super::GetMonthlySettlementUseCase;

pub struct ExportMonthlySettlementCsvUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    report: GetMonthlySettlementUseCase,
    source: SettlementSource,
}

impl ExportMonthlySettlementCsvUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        reservations: Arc<dyn ReservationGateway>,
        ops: Arc<dyn GolfOpsGateway>,
        source: SettlementSource,
    ) -> Self {
        Self {
            catalog: catalog.clone(),
            commercial: commercial.clone(),
            report: GetMonthlySettlementUseCase::new(
                commercial,
                reservations,
                catalog,
                ops,
                source,
            ),
            source,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<String, CourseError> {
        credentials.require(actions::LIST_SETTLEMENT).await?;
        if self.source == SettlementSource::Courseboard {
            let view = self.report.execute(credentials, year_month).await?;
            if !view.reservation_details_unavailable() {
                return Ok(settlement_csv(view.report(), view.lines()));
            }
            // The month's bookings could not be read, so the report fell back
            // to Field's and the file follows it. A summary with no rows under
            // it reads like a month that simply had none.
            tracing::warn!(
                year_month,
                "monthly settlement export fell back to Field's file"
            );
        }

        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let upstream = self
            .commercial
            .export_monthly_settlement_csv(credentials, year_month, &timezone)
            .await?;
        if self.source == SettlementSource::Compare {
            // Serve upstream's file and say whether ours is the same bytes.
            // A file is easier to check by eye than a log, so the log only has
            // to say which month is worth opening.
            match self.report.execute(credentials, year_month).await {
                Ok(view) => {
                    let local = settlement_csv(view.report(), view.lines());
                    if local == upstream {
                        tracing::info!(
                            target: "settlement_source_compare",
                            year_month,
                            "settlement exports are byte-identical"
                        );
                    } else {
                        tracing::warn!(
                            target: "settlement_source_compare",
                            year_month,
                            field_bytes = upstream.len(),
                            courseboard_bytes = local.len(),
                            "settlement exports differ; download both for this month"
                        );
                    }
                }
                Err(error) => tracing::warn!(
                    target: "settlement_source_compare",
                    %error,
                    year_month,
                    "settlement export could not be built here; nothing to compare"
                ),
            }
        }
        Ok(upstream)
    }
}
