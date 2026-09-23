//! Moving caddies who carry a fee of their own onto their rank's fee.
//!
//! Two use cases, one public entrypoint each: see what a move would do, and
//! make the moves the operator chose. See the domain module for why the choice
//! stays with the club (PLT-3346).

use std::collections::HashMap;
use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    fee_alignment_candidates, plan_fee_alignment, CaddieFeeChangeGateway, CaddiePatch,
    CaddieRankFeeGateway, CaddieRankFees, CourseError, FeeAlignmentCandidate, FeeAlignmentOutcome,
    FeeAlignmentRequest, GatewayCredentials, GolfOpsGateway, RecordedCaddieFeeChange,
};

use super::caddie_rank_fees::read_caddie_rank_fees;

/// How much of the change log the screen shows.
const RECENT_CHANGES: u32 = 50;

/// What moving onto the rank table would do, and what has been moved already.
#[derive(Debug, Clone, PartialEq)]
pub struct FeeAlignmentPreview {
    /// Whether the club has saved its rank fees in CourseBoard. Until it has,
    /// the table is a fallback or the code's placeholder amounts, and nobody
    /// can be moved onto it.
    pub rank_fees_confirmed: bool,
    pub fees: CaddieRankFees,
    pub candidates: Vec<FeeAlignmentCandidate>,
    /// Logged moves with the caddie's current name, when the roster still has
    /// them.
    pub recent_changes: Vec<(RecordedCaddieFeeChange, Option<String>)>,
}

pub struct PreviewCaddieFeeAlignmentUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
    changes: Arc<dyn CaddieFeeChangeGateway>,
}

impl PreviewCaddieFeeAlignmentUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        rank_fees: Arc<dyn CaddieRankFeeGateway>,
        changes: Arc<dyn CaddieFeeChangeGateway>,
    ) -> Self {
        Self {
            ops,
            rank_fees,
            changes,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<FeeAlignmentPreview, CourseError> {
        credentials.require(actions::LIST_CADDIES).await?;
        credentials.require(actions::LIST_CADDIE_RANK_FEES).await?;
        let (stored, roster, recent) = tokio::try_join!(
            self.rank_fees.get_caddie_rank_fees(credentials.operator_id),
            self.ops.list_caddie_roster(credentials),
            self.changes
                .list_fee_changes(credentials.operator_id, RECENT_CHANGES),
        )?;
        let rank_fees_confirmed = stored.is_some();
        // Show the amounts payroll is using today even before they are
        // confirmed, so the operator can see why they have to confirm them.
        let fees = match stored {
            Some(fees) => fees,
            None => {
                read_caddie_rank_fees(self.ops.as_ref(), self.rank_fees.as_ref(), credentials)
                    .await?
            }
        };
        let names: HashMap<&str, &str> = roster
            .caddies()
            .iter()
            .map(|caddie| (caddie.id().as_str(), caddie.display_name()))
            .collect();
        let recent_changes = recent
            .into_iter()
            .map(|recorded| {
                let name = names
                    .get(recorded.change.caddie_id.as_str())
                    .map(|name| name.to_string());
                (recorded, name)
            })
            .collect();
        Ok(FeeAlignmentPreview {
            rank_fees_confirmed,
            candidates: fee_alignment_candidates(roster.caddies(), &fees),
            fees,
            recent_changes,
        })
    }
}

/// What happened to one caddie the operator named.
#[derive(Debug, Clone, PartialEq)]
pub struct FeeAlignmentResult {
    pub caddie_id: String,
    pub outcome: FeeAlignmentOutcome,
}

pub struct AlignCaddieFeesToRankUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    rank_fees: Arc<dyn CaddieRankFeeGateway>,
    changes: Arc<dyn CaddieFeeChangeGateway>,
}

impl AlignCaddieFeesToRankUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        rank_fees: Arc<dyn CaddieRankFeeGateway>,
        changes: Arc<dyn CaddieFeeChangeGateway>,
    ) -> Self {
        Self {
            ops,
            rank_fees,
            changes,
        }
    }

    /// Moves each named caddie that can be moved, one at a time, and says what
    /// happened to every one of them.
    ///
    /// One caddie Field refuses does not stop the rest: the operator reads the
    /// results and deals with that one. Losing the right to act at all does,
    /// because every later write would be refused the same way.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        request: &FeeAlignmentRequest,
        changed_by: Option<&str>,
        changed_by_name: Option<&str>,
    ) -> Result<Vec<FeeAlignmentResult>, CourseError> {
        // Both: this edits caddie profiles, and what it edits is pay.
        credentials.require(actions::MANAGE_CADDIES).await?;
        credentials
            .require(actions::MANAGE_CADDIE_RANK_FEES)
            .await?;

        // Only a table the club saved in CourseBoard. The config fallback and
        // the code's placeholder amounts were never agreed as anybody's pay.
        let fees = self
            .rank_fees
            .get_caddie_rank_fees(credentials.operator_id)
            .await?
            .ok_or(CourseError::Conflict(
                "save the rank fees before moving caddies onto them",
            ))?;
        let roster = self.ops.list_caddie_roster(credentials).await?;

        let mut results = Vec::with_capacity(request.items().len());
        for item in request.items() {
            let caddie = roster
                .caddies()
                .iter()
                .find(|caddie| caddie.id() == &item.caddie_id);
            let outcome = match plan_fee_alignment(
                caddie,
                item,
                &fees,
                request.note(),
                changed_by,
                changed_by_name,
            ) {
                Err(outcome) => outcome,
                Ok(change) => {
                    let caddie = caddie.expect("a planned move has a caddie");
                    self.apply(credentials, caddie, &change).await?
                }
            };
            results.push(FeeAlignmentResult {
                caddie_id: item.caddie_id.as_str().to_string(),
                outcome,
            });
        }
        Ok(results)
    }

    async fn apply(
        &self,
        credentials: GatewayCredentials<'_>,
        caddie: &crate::course::domain::Caddie,
        change: &crate::course::domain::CaddieFeeChange,
    ) -> Result<FeeAlignmentOutcome, CourseError> {
        let tenant = credentials.operator_id;
        // Logged before the profile is written, so the pay change can never
        // happen without a record of it.
        let id = self
            .changes
            .record_pending_fee_change(tenant, change)
            .await?;
        let input = CaddiePatch {
            base_fee_amount: Some(change.new_fee),
            ..CaddiePatch::default()
        }
        .apply_to(caddie)?;
        match self
            .ops
            .update_caddie(credentials, caddie.id(), input)
            .await
        {
            Ok(_) => {
                self.changes.confirm_fee_change(tenant, id).await?;
                Ok(FeeAlignmentOutcome::Aligned)
            }
            Err(
                error @ (CourseError::Unauthorized
                | CourseError::Forbidden(_)
                | CourseError::TenantForbidden),
            ) => {
                let _ = self.changes.discard_fee_change(tenant, id).await;
                Err(error)
            }
            Err(error) => {
                // Best effort: a row left behind is unconfirmed and never listed.
                let _ = self.changes.discard_fee_change(tenant, id).await;
                Ok(FeeAlignmentOutcome::Failed(error.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use async_trait::async_trait;
    use chrono::{NaiveDate, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AvailabilityQuery,
        Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
        CaddieCourseMembership, CaddieFeeChange, CaddieId, CaddieRank, CaddieRankFeeChange,
        CaddieRankFeeChangeContext, CaddieRating, CaddieRoster, CaddieSkillLevel, CaddieStaff,
        FeeAlignmentItem, ReplaceCaddieMemberships, UpsertCaddie, UpsertCaddieAssignment,
        UpsertCaddieAvailability,
    };

    fn caddie(id: &str, rank: CaddieRank, own_fee: i64) -> Caddie {
        Caddie::reconstitute(
            id,
            id,
            Some(format!("staff_{id}")),
            true,
            CaddieSkillLevel::Veteran,
            rank,
            "active",
            own_fee,
            "JPY",
            2,
            true,
            18,
            250_000,
            None,
            0,
        )
    }

    struct FakeOps {
        caddies: Vec<Caddie>,
        refuse: Option<(String, fn() -> CourseError)>,
        written: Mutex<Vec<(String, UpsertCaddie)>>,
    }

    impl FakeOps {
        fn with(caddies: Vec<Caddie>) -> Self {
            Self {
                caddies,
                refuse: None,
                written: Mutex::new(vec![]),
            }
        }
    }

    #[async_trait]
    impl GolfOpsGateway for FakeOps {
        async fn list_caddie_roster(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRoster, CourseError> {
            Ok(CaddieRoster::new(self.caddies.clone(), vec![]))
        }

        async fn create_staff(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<CaddieStaff, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn create_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn update_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            caddie_id: &CaddieId,
            input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            if let Some((refused, error)) = &self.refuse {
                if refused == caddie_id.as_str() {
                    return Err(error());
                }
            }
            self.written
                .lock()
                .expect("lock")
                .push((caddie_id.as_str().to_string(), input));
            Ok(caddie(caddie_id.as_str(), CaddieRank::C, 0))
        }

        async fn delete_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<(), CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn list_caddie_assignments(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: CaddieAssignmentQuery,
        ) -> Result<Vec<CaddieAssignment>, CourseError> {
            Ok(vec![])
        }

        async fn create_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn update_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _assignment_id: &AssignmentId,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn list_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            Ok(vec![])
        }

        async fn list_memberships_for(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_ids: &[CaddieId],
        ) -> Result<HashMap<String, Vec<CaddieCourseMembership>>, CourseError> {
            Ok(HashMap::new())
        }

        async fn replace_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: ReplaceCaddieMemberships,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            Ok(vec![])
        }

        async fn list_caddie_availabilities(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: AvailabilityQuery,
        ) -> Result<Vec<CaddieAvailability>, CourseError> {
            Ok(vec![])
        }

        async fn upsert_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAvailability,
        ) -> Result<CaddieAvailability, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn delete_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _date: NaiveDate,
        ) -> Result<(), CourseError> {
            Ok(())
        }

        async fn get_attendance_snapshot(
            &self,
            _credentials: GatewayCredentials<'_>,
            _date: Option<NaiveDate>,
            _timezone: &str,
        ) -> Result<AttendanceSnapshotReport, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
        }

        async fn list_attendance_period_snapshots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
            Ok(vec![])
        }

        async fn list_worked_minutes(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
        ) -> Result<HashMap<String, crate::course::domain::WorkedMinutes>, CourseError> {
            Ok(HashMap::new())
        }

        async fn get_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRankFees, CourseError> {
            Ok(CaddieRankFees::default())
        }

        async fn replace_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
            fees: &CaddieRankFees,
        ) -> Result<CaddieRankFees, CourseError> {
            Ok(fees.clone())
        }

        async fn list_caddie_ratings(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: Option<&CaddieId>,
        ) -> Result<Vec<CaddieRating>, CourseError> {
            Ok(vec![])
        }
    }

    struct StoredRankFees(Option<CaddieRankFees>);

    #[async_trait]
    impl CaddieRankFeeGateway for StoredRankFees {
        async fn get_caddie_rank_fees(
            &self,
            _tenant_id: &str,
        ) -> Result<Option<CaddieRankFees>, CourseError> {
            Ok(self.0.clone())
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

    #[derive(Default)]
    struct FakeChanges {
        rows: Mutex<Vec<(u64, CaddieFeeChange, bool)>>,
    }

    #[async_trait]
    impl CaddieFeeChangeGateway for FakeChanges {
        async fn record_pending_fee_change(
            &self,
            _tenant_id: &str,
            change: &CaddieFeeChange,
        ) -> Result<u64, CourseError> {
            let mut rows = self.rows.lock().expect("lock");
            let id = rows.len() as u64 + 1;
            rows.push((id, change.clone(), false));
            Ok(id)
        }

        async fn confirm_fee_change(&self, _tenant_id: &str, id: u64) -> Result<(), CourseError> {
            for row in self.rows.lock().expect("lock").iter_mut() {
                if row.0 == id {
                    row.2 = true;
                }
            }
            Ok(())
        }

        async fn discard_fee_change(&self, _tenant_id: &str, id: u64) -> Result<(), CourseError> {
            self.rows
                .lock()
                .expect("lock")
                .retain(|row| row.0 != id || row.2);
            Ok(())
        }

        async fn list_fee_changes(
            &self,
            _tenant_id: &str,
            _limit: u32,
        ) -> Result<Vec<RecordedCaddieFeeChange>, CourseError> {
            Ok(self
                .rows
                .lock()
                .expect("lock")
                .iter()
                .filter(|row| row.2)
                .map(|row| RecordedCaddieFeeChange {
                    id: row.0,
                    change: row.1.clone(),
                    changed_at: Utc::now(),
                })
                .collect())
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer t",
            caller_bearer: "Bearer t",
            operator_id: "scc",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
        }
    }

    fn table() -> CaddieRankFees {
        CaddieRankFees::try_new(12_000, 11_000, 10_000, 9_000, "JPY").expect("fees")
    }

    fn request(items: &[(&str, i64)]) -> FeeAlignmentRequest {
        FeeAlignmentRequest::try_new(
            items
                .iter()
                .map(|(id, fee)| FeeAlignmentItem {
                    caddie_id: CaddieId::new(*id),
                    expected_own_fee: *fee,
                })
                .collect(),
            Some("現場合意"),
        )
        .expect("request")
    }

    #[tokio::test]
    async fn a_move_sets_the_fee_to_zero_and_logs_what_it_was() {
        let ops = Arc::new(FakeOps::with(vec![caddie("aya", CaddieRank::B, 11_000)]));
        let changes = Arc::new(FakeChanges::default());
        let results = AlignCaddieFeesToRankUseCase::new(
            ops.clone(),
            Arc::new(StoredRankFees(Some(table()))),
            changes.clone(),
        )
        .execute(
            credentials(),
            &request(&[("aya", 11_000)]),
            Some("user-1"),
            Some("yamada"),
        )
        .await
        .expect("aligned");

        assert_eq!(results[0].outcome, FeeAlignmentOutcome::Aligned);
        {
            let written = ops.written.lock().expect("lock");
            assert_eq!(written[0].1.base_fee_amount, 0);
            // Everything else on the profile is echoed back untouched.
            assert_eq!(written[0].1.rank, CaddieRank::B);
            assert_eq!(written[0].1.monthly_contract_rounds, Some(18));
        }
        let logged = changes.list_fee_changes("scc", 10).await.unwrap();
        assert_eq!(logged[0].change.previous_fee, 11_000);
        assert_eq!(logged[0].change.rank_fee, 11_000);
        assert_eq!(logged[0].change.changed_by.as_deref(), Some("user-1"));
        assert_eq!(logged[0].change.changed_by_name.as_deref(), Some("yamada"));
    }

    #[tokio::test]
    async fn nobody_is_moved_onto_a_table_the_club_never_saved() {
        // The fallback amounts were never agreed as anybody's pay.
        let ops = Arc::new(FakeOps::with(vec![caddie("aya", CaddieRank::B, 11_000)]));
        let error = AlignCaddieFeesToRankUseCase::new(
            ops.clone(),
            Arc::new(StoredRankFees(None)),
            Arc::new(FakeChanges::default()),
        )
        .execute(credentials(), &request(&[("aya", 11_000)]), None, None)
        .await
        .expect_err("refused");

        assert!(matches!(error, CourseError::Conflict(_)));
        assert!(ops.written.lock().expect("lock").is_empty());
    }

    #[tokio::test]
    async fn a_refused_write_leaves_no_log_and_does_not_stop_the_others() {
        let mut ops = FakeOps::with(vec![
            caddie("aya", CaddieRank::B, 11_000),
            caddie("ken", CaddieRank::C, 10_000),
        ]);
        ops.refuse = Some(("aya".into(), || CourseError::UpstreamClient {
            status: 409,
            message: "profile changed".into(),
        }));
        let ops = Arc::new(ops);
        let changes = Arc::new(FakeChanges::default());
        let results = AlignCaddieFeesToRankUseCase::new(
            ops.clone(),
            Arc::new(StoredRankFees(Some(table()))),
            changes.clone(),
        )
        .execute(
            credentials(),
            &request(&[("aya", 11_000), ("ken", 10_000)]),
            None,
            None,
        )
        .await
        .expect("partial");

        assert!(matches!(results[0].outcome, FeeAlignmentOutcome::Failed(_)));
        assert_eq!(results[1].outcome, FeeAlignmentOutcome::Aligned);
        assert_eq!(changes.rows.lock().expect("lock").len(), 1);
    }

    #[tokio::test]
    async fn losing_the_right_to_write_stops_the_whole_request() {
        let mut ops = FakeOps::with(vec![
            caddie("aya", CaddieRank::B, 11_000),
            caddie("ken", CaddieRank::C, 10_000),
        ]);
        ops.refuse = Some(("aya".into(), || CourseError::Unauthorized));
        let ops = Arc::new(ops);
        let error = AlignCaddieFeesToRankUseCase::new(
            ops.clone(),
            Arc::new(StoredRankFees(Some(table()))),
            Arc::new(FakeChanges::default()),
        )
        .execute(
            credentials(),
            &request(&[("aya", 11_000), ("ken", 10_000)]),
            None,
            None,
        )
        .await
        .expect_err("stopped");

        assert!(matches!(error, CourseError::Unauthorized));
        assert!(ops.written.lock().expect("lock").is_empty());
    }

    #[tokio::test]
    async fn the_preview_says_whether_the_table_is_confirmed_and_names_past_moves() {
        let changes = Arc::new(FakeChanges::default());
        let id = changes
            .record_pending_fee_change(
                "scc",
                &CaddieFeeChange {
                    caddie_id: CaddieId::new("ken"),
                    rank: CaddieRank::C,
                    previous_fee: 10_000,
                    new_fee: 0,
                    rank_fee: 10_000,
                    currency: "JPY".into(),
                    note: None,
                    changed_by: None,
                    changed_by_name: None,
                },
            )
            .await
            .unwrap();
        changes.confirm_fee_change("scc", id).await.unwrap();
        let ops = Arc::new(FakeOps::with(vec![
            caddie("aya", CaddieRank::B, 13_000),
            caddie("ken", CaddieRank::C, 0),
        ]));

        let unconfirmed = PreviewCaddieFeeAlignmentUseCase::new(
            ops.clone(),
            Arc::new(StoredRankFees(None)),
            changes.clone(),
        )
        .execute(credentials())
        .await
        .expect("preview");
        assert!(!unconfirmed.rank_fees_confirmed);
        // Still priced by what payroll uses today.
        assert_eq!(unconfirmed.fees, CaddieRankFees::default());

        let confirmed = PreviewCaddieFeeAlignmentUseCase::new(
            ops,
            Arc::new(StoredRankFees(Some(table()))),
            changes,
        )
        .execute(credentials())
        .await
        .expect("preview");
        assert!(confirmed.rank_fees_confirmed);
        assert_eq!(confirmed.candidates.len(), 1);
        assert_eq!(confirmed.candidates[0].difference(), -2_000);
        assert_eq!(
            confirmed.recent_changes[0].1.as_deref(),
            Some("ken"),
            "a past move reads by the caddie's current name"
        );
    }
}
