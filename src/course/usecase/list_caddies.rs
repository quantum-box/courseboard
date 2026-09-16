//! ListCaddiesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{CaddieRoster, CourseError, GatewayCredentials, GolfOpsGateway};

pub struct ListCaddiesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListCaddiesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieRoster, CourseError> {
        credentials.require(actions::LIST_CADDIES).await?;
        self.ops.list_caddie_roster(credentials).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::course::domain::{CaddieDutyAssignment, DutyWindow};
    use crate::course::usecase::caddie_duties::test_double::FakeCaddieDuties;
    use async_trait::async_trait;
    use chrono::{NaiveDate, TimeZone, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AvailabilityQuery,
        AvailabilityStatus, Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
        CaddieCourseMembership, CaddieId, CaddiePlacement, CaddieRank, CaddieRankFees,
        CaddieRating, CaddieRecommendation, CaddieRoster, CaddieShift, CaddieShiftGateway,
        CaddieSkillLevel, CaddieStaff, FieldShiftLink, RecommendationQuery,
        ReplaceCaddieMemberships, ReservationId, UnsyncedShift, UpsertCaddie,
        UpsertCaddieAssignment, UpsertCaddieAvailability,
    };
    use crate::course::domain::{CaddieRankFeeChangeContext, CaddieRankFeeGateway};
    use crate::course::usecase::caddie_rank_fees::UnsetRankFees;
    use crate::course::usecase::{
        CreateCaddieAssignmentUseCase, ListCaddieAssignmentsUseCase,
        ListCaddieRecommendationsUseCase, MoveTheRound, NameCaddieForRound,
        ReassignCaddieAssignmentUseCase, ReplaceCaddieRankFeesUseCase,
    };

    /// The ranking tests predate confirmed shifts and are about who is
    /// offered, not where they stand; an empty month leaves the whole
    /// roster in play, which is what they assert against.
    struct NoShifts;

    #[async_trait::async_trait]
    impl CaddieShiftGateway for NoShifts {
        async fn list_shifts(
            &self,
            _tenant_id: &str,
            _from: chrono::NaiveDate,
            _to: chrono::NaiveDate,
        ) -> Result<Vec<CaddieShift>, CourseError> {
            Ok(Vec::new())
        }

        async fn save_shifts(
            &self,
            _tenant_id: &str,
            _shifts: &[CaddieShift],
        ) -> Result<u64, CourseError> {
            Ok(0)
        }

        async fn get_shift(
            &self,
            _tenant_id: &str,
            _caddie_id: &CaddieId,
            _date: chrono::NaiveDate,
        ) -> Result<Option<CaddieShift>, CourseError> {
            Ok(None)
        }

        async fn field_shift_links(
            &self,
            _tenant_id: &str,
            _from: chrono::NaiveDate,
            _to: chrono::NaiveDate,
        ) -> Result<Vec<FieldShiftLink>, CourseError> {
            Ok(Vec::new())
        }

        async fn set_field_shift_links(
            &self,
            _tenant_id: &str,
            _links: &[FieldShiftLink],
        ) -> Result<(), CourseError> {
            Ok(())
        }

        async fn unsynced_shifts(
            &self,
            _tenant_id: &str,
            _from: chrono::NaiveDate,
            _to: chrono::NaiveDate,
            _limit: u32,
        ) -> Result<Vec<UnsyncedShift>, CourseError> {
            Ok(Vec::new())
        }

        async fn mark_month_unsynced(
            &self,
            _tenant_id: &str,
            _from: chrono::NaiveDate,
            _to: chrono::NaiveDate,
        ) -> Result<(), CourseError> {
            Ok(())
        }

        async fn count_unsynced(
            &self,
            _tenant_id: &str,
            _from: chrono::NaiveDate,
            _to: chrono::NaiveDate,
        ) -> Result<u64, CourseError> {
            Ok(0)
        }
    }

    struct FakeOps {
        caddies: Mutex<Vec<Caddie>>,
        assignments: Mutex<Vec<CaddieAssignment>>,
        availabilities: Mutex<Vec<CaddieAvailability>>,
    }

    impl FakeOps {
        fn with(caddies: Vec<Caddie>) -> Self {
            Self {
                caddies: Mutex::new(caddies),
                assignments: Mutex::new(vec![]),
                availabilities: Mutex::new(vec![]),
            }
        }
    }

    #[async_trait]
    impl GolfOpsGateway for FakeOps {
        async fn list_caddie_roster(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRoster, CourseError> {
            Ok(CaddieRoster::new(
                self.caddies.lock().expect("lock").clone(),
                vec![CaddieStaff::new("staff_aya", "Sato", true)],
            ))
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
            _caddie_id: &CaddieId,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
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
            Ok(self.assignments.lock().expect("lock").clone())
        }

        async fn create_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            CaddieAssignment::reconstitute(
                "assign_new",
                input.caddie_id.as_str(),
                input.reservation_id.map(|id| id.as_str().to_string()),
                None,
                input.scheduled_at,
                None,
                input.status.unwrap_or_else(|| "assigned".into()),
                input.assignment_role.unwrap_or_else(|| "primary".into()),
                input.fee_amount.unwrap_or_default(),
                input.fee_currency.unwrap_or_else(|| "JPY".into()),
                None,
            )
        }

        async fn update_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            assignment_id: &AssignmentId,
            input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            CaddieAssignment::reconstitute(
                assignment_id.as_str(),
                input.caddie_id.as_str(),
                input.reservation_id.map(|id| id.as_str().to_string()),
                input.round_reference,
                input.scheduled_at,
                None,
                input.status.unwrap_or_else(|| "assigned".into()),
                input.assignment_role.unwrap_or_else(|| "primary".into()),
                input.fee_amount.unwrap_or_default(),
                input.fee_currency.unwrap_or_else(|| "JPY".into()),
                input.notes,
            )
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
        ) -> Result<std::collections::HashMap<String, Vec<CaddieCourseMembership>>, CourseError>
        {
            Ok(std::collections::HashMap::new())
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
            Ok(self.availabilities.lock().expect("lock").clone())
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
            date: Option<NaiveDate>,
            _timezone: &str,
        ) -> Result<AttendanceSnapshotReport, CourseError> {
            Ok(AttendanceSnapshotReport::new(
                date.unwrap_or_else(|| NaiveDate::from_ymd_opt(2026, 7, 18).unwrap()),
                vec![],
            ))
        }

        async fn list_attendance_period_snapshots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
            Ok(vec![])
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
        async fn list_worked_minutes(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
        ) -> Result<
            std::collections::HashMap<String, crate::course::domain::WorkedMinutes>,
            CourseError,
        > {
            Ok(std::collections::HashMap::new())
        }
    }

    #[tokio::test]
    async fn lists_only_assignable_semantics_on_domain() {
        let caddie = Caddie::reconstitute(
            "caddie_aya",
            "Sato",
            Some("staff_aya".into()),
            true,
            CaddieSkillLevel::Veteran,
            CaddieRank::A,
            "active",
            12_000,
            "JPY",
            2,
            true,
            20,
            280_000,
            Some(4.8),
            42,
        );
        assert!(caddie.is_assignable());
        assert_eq!(caddie.remaining_round_capacity(1), 1);

        let assignment = CaddieAssignment::reconstitute(
            "assign_1",
            "caddie_aya",
            Some("res_1".into()),
            Some("R-1".into()),
            Utc.with_ymd_and_hms(2026, 7, 18, 0, 0, 0).unwrap(),
            Some(270),
            "assigned",
            "primary",
            12_000,
            "JPY",
            None,
        )
        .expect("assignment");
        assert!(assignment.covers_reservation(&ReservationId::new("res_1")));
        assert!(assignment.is_linked_to_reservation());
        assert!(assignment.role().is_primary());
        assert_eq!(assignment.status_label(), "assigned");

        let ops = Arc::new(FakeOps {
            caddies: Mutex::new(vec![caddie]),
            assignments: Mutex::new(vec![assignment]),
            availabilities: Mutex::new(vec![]),
        });
        let listed = ListCaddiesUseCase::new(ops.clone())
            .execute(GatewayCredentials {
                authorization: "Bearer t",
                caller_bearer: "Bearer t",
                operator_id: "scc",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
            })
            .await
            .expect("list");
        assert_eq!(listed.caddies().len(), 1);
        assert_eq!(listed.caddies()[0].display_name(), "Sato");
        assert_eq!(listed.staff().len(), 1);
        assert_eq!(listed.staff()[0].id(), "staff_aya");

        let assignments = ListCaddieAssignmentsUseCase::new(ops)
            .execute(
                GatewayCredentials {
                    authorization: "Bearer t",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                CaddieAssignmentQuery::default(),
            )
            .await
            .expect("list assignments");
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].caddie_id(), "caddie_aya");
    }

    #[tokio::test]
    async fn a_caddie_on_other_work_is_never_offered_as_a_candidate() {
        // Filing other work is what takes somebody out of the day's supply, so
        // the ranking must not go on offering them: the desk would name a
        // caddie the board has already said is unavailable.
        let sent_to_the_range = caddie(
            "caddie_duty",
            "Ito",
            true,
            "active",
            CaddieSkillLevel::Veteran,
        );
        let free = caddie(
            "caddie_free",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        );
        let ops = Arc::new(FakeOps::with(vec![sent_to_the_range, free]));
        let today =
            crate::course::domain::tenant_date_at(chrono::Utc::now(), "Asia/Tokyo").expect("today");
        let duties = FakeCaddieDuties::with_assignments(vec![CaddieDutyAssignment::reconstitute(
            Some(1),
            CaddieId::new("caddie_duty"),
            today,
            DutyWindow::all_day(),
            "コース整備".to_string(),
            None,
            None,
        )]);

        let ranked = ListCaddieRecommendationsUseCase::new(ops, Arc::new(NoShifts), duties)
            .execute(
                GatewayCredentials {
                    authorization: "Bearer t",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                RecommendationQuery {
                    player_count: Some(4),
                    include_rookie_pairing: true,
                    ..RecommendationQuery::default()
                },
                "Asia/Tokyo",
            )
            .await
            .expect("recommendations");

        let names: Vec<&str> = ranked.iter().map(|item| item.display_name()).collect();
        assert_eq!(names, vec!["Sato"]);
    }

    #[tokio::test]
    async fn a_suspended_caddie_is_never_offered_as_a_candidate() {
        // Ranking orders the people who could work today. A retired or
        // suspended profile cannot take the round at all, so putting one in the
        // list is not a weak suggestion but a wrong one — and a veteran who
        // left outscores the juniors still on the roster.
        let working = caddie(
            "caddie_working",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        );
        let retired = caddie(
            "caddie_retired",
            "Retired",
            false,
            "suspended",
            CaddieSkillLevel::Veteran,
        );
        let ops = Arc::new(FakeOps::with(vec![working, retired]));

        let ranked = ListCaddieRecommendationsUseCase::new(
            ops,
            Arc::new(NoShifts),
            FakeCaddieDuties::none(),
        )
        .execute(
            GatewayCredentials {
                authorization: "Bearer t",
                operator_id: "scc",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            RecommendationQuery {
                player_count: Some(4),
                include_rookie_pairing: true,
                ..RecommendationQuery::default()
            },
            "Asia/Tokyo",
        )
        .await
        .expect("recommendations");

        let names: Vec<&str> = ranked.iter().map(|item| item.display_name()).collect();
        assert_eq!(names, vec!["Sato"]);
    }

    #[tokio::test]
    async fn recommendation_exposes_the_capacity_and_attendance_used_for_its_order() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_other"));

        let ranked = ListCaddieRecommendationsUseCase::new(
            ops,
            Arc::new(NoShifts),
            FakeCaddieDuties::none(),
        )
        .execute(
            GatewayCredentials {
                authorization: "Bearer t",
                operator_id: "scc",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            RecommendationQuery {
                scheduled_at: Some(morning_tee_time()),
                ..RecommendationQuery::default()
            },
            "Asia/Tokyo",
        )
        .await
        .expect("recommendations");

        assert_eq!(ranked[0].remaining_rounds(), Some(1));
        assert_eq!(ranked[0].attendance_status(), Some("not_clocked"));
        assert_eq!(ranked[0].placement(), &CaddiePlacement::Unconfirmed);
    }

    #[tokio::test]
    async fn a_caddie_who_asked_for_the_day_off_is_not_offered() {
        // The shift board is where the day off was filed; offering that caddie
        // anyway makes the two screens contradict each other.
        let date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let ops = Arc::new(FakeOps::with(vec![
            caddie("cad_on", "On", true, "active", CaddieSkillLevel::Regular),
            caddie("cad_off", "Off", true, "active", CaddieSkillLevel::Regular),
        ]));
        ops.availabilities
            .lock()
            .expect("lock")
            .push(CaddieAvailability::reconstitute(
                "avail_1",
                "cad_off",
                date,
                AvailabilityStatus::Unavailable,
                false,
                None,
                None,
            ));

        let ranked = ListCaddieRecommendationsUseCase::new(
            ops,
            Arc::new(NoShifts),
            FakeCaddieDuties::none(),
        )
        .execute(
            GatewayCredentials {
                authorization: "Bearer t",
                operator_id: "scc",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            RecommendationQuery {
                scheduled_at: Some(Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap()),
                ..RecommendationQuery::default()
            },
            "Asia/Tokyo",
        )
        .await
        .expect("recommendations");

        let names: Vec<&str> = ranked.iter().map(|item| item.display_name()).collect();
        assert_eq!(names, vec!["On"]);
    }

    #[tokio::test]
    async fn a_morning_only_request_still_answers_an_afternoon_round() {
        // Half days are only judgeable against a tee time; 14:00 JST is outside
        // a morning-only shift, so that caddie drops out for this round only.
        let date = NaiveDate::from_ymd_opt(2026, 8, 8).unwrap();
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_am",
            "Morning",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.availabilities
            .lock()
            .expect("lock")
            .push(CaddieAvailability::reconstitute(
                "avail_am",
                "cad_am",
                date,
                AvailabilityStatus::MorningOnly,
                false,
                None,
                None,
            ));

        async fn ask(ops: Arc<FakeOps>, at: chrono::DateTime<Utc>) -> Vec<CaddieRecommendation> {
            ListCaddieRecommendationsUseCase::new(ops, Arc::new(NoShifts), FakeCaddieDuties::none())
                .execute(
                    GatewayCredentials {
                        authorization: "Bearer t",
                        operator_id: "scc",
                        platform_id: None,
                        authorizer: &crate::course::infrastructure::ALLOW_ALL,
                        caller_bearer: "Bearer test",
                    },
                    RecommendationQuery {
                        scheduled_at: Some(at),
                        ..RecommendationQuery::default()
                    },
                    "Asia/Tokyo",
                )
                .await
                .expect("recommendations")
        }

        // 07:00 JST
        let morning = ask(
            ops.clone(),
            Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap(),
        )
        .await;
        assert_eq!(morning.len(), 1);

        // 14:00 JST
        let afternoon = ask(ops, Utc.with_ymd_and_hms(2026, 8, 8, 5, 0, 0).unwrap()).await;
        assert!(afternoon.is_empty());
    }

    /// 07:00 JST on 2026-08-08.
    fn morning_tee_time() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 7, 22, 0, 0).unwrap()
    }

    fn name_caddie(caddie_id: &str, reservation_id: &str) -> NameCaddieForRound {
        NameCaddieForRound {
            caddie_id: CaddieId::new(caddie_id),
            reservation_id: ReservationId::new(reservation_id),
            scheduled_at: morning_tee_time(),
            duration_minutes: Some(270),
            assignment_role: None,
            notes: None,
        }
    }

    fn standing_assignment(caddie_id: &str, reservation_id: &str) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            "assign_existing",
            caddie_id,
            Some(reservation_id.into()),
            None,
            morning_tee_time(),
            Some(270),
            "assigned",
            "primary",
            8_000,
            "JPY",
            None,
        )
        .expect("assignment")
    }

    async fn name(
        ops: Arc<FakeOps>,
        input: NameCaddieForRound,
    ) -> Result<CaddieAssignment, CourseError> {
        // Unset, so these tests keep reading the fee table from the same place
        // they always did: the migration fallback in `read_caddie_rank_fees`.
        CreateCaddieAssignmentUseCase::new(ops, Arc::new(UnsetRankFees), FakeCaddieDuties::none())
            .execute(
                GatewayCredentials {
                    authorization: "Bearer t",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                input,
                "Asia/Tokyo",
            )
            .await
    }

    /// The day the hand-placed tests work: 2026-08-08 in Asia/Tokyo.
    fn board_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 8).expect("date")
    }

    async fn move_round(
        ops: Arc<FakeOps>,
        duties: Arc<FakeCaddieDuties>,
        input: MoveTheRound,
    ) -> Result<CaddieAssignment, CourseError> {
        ReassignCaddieAssignmentUseCase::new(ops, Arc::new(UnsetRankFees), duties)
            .execute(
                GatewayCredentials {
                    authorization: "Bearer t",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                input,
                "Asia/Tokyo",
            )
            .await
    }

    fn move_of(assignment_id: &str) -> MoveTheRound {
        MoveTheRound {
            assignment_id: AssignmentId::new(assignment_id),
            date: board_date(),
            caddie_id: None,
            reservation_id: None,
            scheduled_at: None,
            duration_minutes: None,
        }
    }

    #[tokio::test]
    async fn a_group_can_be_handed_to_another_caddie_without_losing_the_round() {
        let ops = Arc::new(FakeOps::with(vec![
            caddie("cad_1", "Sato", true, "active", CaddieSkillLevel::Regular),
            caddie("cad_2", "Tanaka", true, "active", CaddieSkillLevel::Regular),
        ]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_1"));

        let moved = move_round(
            ops,
            FakeCaddieDuties::none(),
            MoveTheRound {
                caddie_id: Some(CaddieId::new("cad_2")),
                ..move_of("assign_existing")
            },
        )
        .await
        .expect("moved");
        assert_eq!(moved.id().as_str(), "assign_existing");
        assert_eq!(moved.caddie_id().as_str(), "cad_2");
        assert_eq!(moved.reservation_id().map(|id| id.as_str()), Some("rsv_1"));
    }

    #[tokio::test]
    async fn a_caddie_can_be_moved_to_another_group_they_are_not_already_holding() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_1"));

        let moved = move_round(
            ops,
            FakeCaddieDuties::none(),
            MoveTheRound {
                reservation_id: Some(ReservationId::new("rsv_2")),
                ..move_of("assign_existing")
            },
        )
        .await
        .expect("moved");
        assert_eq!(moved.reservation_id().map(|id| id.as_str()), Some("rsv_2"));
    }

    #[tokio::test]
    async fn the_round_label_stays_with_the_group_it_belonged_to() {
        // `standing_assignment` carries none, so this one is built with a
        // label: the day board prints it in place of the booking, and a label
        // that followed the caddie to another group would name the wrong one.
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.assignments.lock().expect("lock").push(
            CaddieAssignment::reconstitute(
                "assign_existing",
                "cad_1",
                Some("rsv_1".into()),
                Some("R-2026-0100".into()),
                morning_tee_time(),
                Some(270),
                "assigned",
                "primary",
                8_000,
                "JPY",
                None,
            )
            .expect("assignment"),
        );

        let handed_over = move_round(
            Arc::clone(&ops),
            FakeCaddieDuties::none(),
            move_of("assign_existing"),
        )
        .await
        .expect("kept");
        assert_eq!(handed_over.round_reference(), Some("R-2026-0100"));

        let moved = move_round(
            ops,
            FakeCaddieDuties::none(),
            MoveTheRound {
                reservation_id: Some(ReservationId::new("rsv_2")),
                ..move_of("assign_existing")
            },
        )
        .await
        .expect("moved");
        assert_eq!(moved.round_reference(), None);
    }

    #[tokio::test]
    async fn moving_onto_a_group_that_already_has_a_caddie_is_refused() {
        // The same state the planner refuses to create. Reached by moving
        // rather than by naming, it is no less wrong.
        let ops = Arc::new(FakeOps::with(vec![
            caddie("cad_1", "Sato", true, "active", CaddieSkillLevel::Regular),
            caddie("cad_2", "Tanaka", true, "active", CaddieSkillLevel::Regular),
        ]));
        {
            let mut assignments = ops.assignments.lock().expect("lock");
            assignments.push(standing_assignment("cad_1", "rsv_1"));
            assignments.push(
                CaddieAssignment::reconstitute(
                    "assign_other",
                    "cad_2",
                    Some("rsv_2".into()),
                    None,
                    morning_tee_time(),
                    Some(270),
                    "assigned",
                    "primary",
                    8_000,
                    "JPY",
                    None,
                )
                .expect("assignment"),
            );
        }

        let refused = move_round(
            ops,
            FakeCaddieDuties::none(),
            MoveTheRound {
                reservation_id: Some(ReservationId::new("rsv_2")),
                ..move_of("assign_existing")
            },
        )
        .await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("already has a caddie")));
    }

    #[tokio::test]
    async fn a_caddie_on_other_work_cannot_be_handed_a_group_by_moving_one() {
        let ops = Arc::new(FakeOps::with(vec![
            caddie("cad_1", "Sato", true, "active", CaddieSkillLevel::Regular),
            caddie("cad_2", "Tanaka", true, "active", CaddieSkillLevel::Regular),
        ]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_1"));
        let duties = FakeCaddieDuties::with_assignments(vec![CaddieDutyAssignment::reconstitute(
            Some(1),
            CaddieId::new("cad_2"),
            board_date(),
            DutyWindow::all_day(),
            "コース整備".to_string(),
            None,
            None,
        )]);

        let refused = move_round(
            ops,
            duties,
            MoveTheRound {
                caddie_id: Some(CaddieId::new("cad_2")),
                ..move_of("assign_existing")
            },
        )
        .await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("on other work")));
    }

    #[tokio::test]
    async fn a_move_that_would_leave_the_day_is_refused() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_1"));

        let refused = move_round(
            ops,
            FakeCaddieDuties::none(),
            MoveTheRound {
                reservation_id: Some(ReservationId::new("rsv_2")),
                // 07:00 JST the next morning.
                scheduled_at: Some(Utc.with_ymd_and_hms(2026, 8, 8, 22, 0, 0).unwrap()),
                ..move_of("assign_existing")
            },
        )
        .await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("same day")));
    }

    #[tokio::test]
    async fn a_round_that_is_not_on_the_day_being_worked_is_not_found() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_1"));

        let refused = move_round(
            ops,
            FakeCaddieDuties::none(),
            MoveTheRound {
                date: NaiveDate::from_ymd_opt(2026, 8, 9).expect("date"),
                ..move_of("assign_existing")
            },
        )
        .await;
        assert!(matches!(refused, Err(CourseError::NotFound("assignment"))));
    }

    #[tokio::test]
    async fn naming_a_caddie_by_hand_writes_the_round() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));

        let written = name(ops, name_caddie("cad_1", "rsv_1"))
            .await
            .expect("named");
        assert_eq!(written.caddie_id().as_str(), "cad_1");
        assert_eq!(
            written.reservation_id().map(|id| id.as_str()),
            Some("rsv_1")
        );
    }

    #[tokio::test]
    async fn a_caddie_on_other_work_cannot_be_named_for_a_round() {
        // The day's supply has already stopped counting them, so naming them
        // here would put somebody on a group the board says cannot be walked.
        // Taking them off the other work is the decision the desk has to make.
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        let duties = FakeCaddieDuties::with_assignments(vec![CaddieDutyAssignment::reconstitute(
            Some(1),
            CaddieId::new("cad_1"),
            NaiveDate::from_ymd_opt(2026, 8, 8).expect("date"),
            DutyWindow::all_day(),
            "コース整備".to_string(),
            None,
            None,
        )]);

        let refused = CreateCaddieAssignmentUseCase::new(ops, Arc::new(UnsetRankFees), duties)
            .execute(
                GatewayCredentials {
                    authorization: "Bearer t",
                    operator_id: "scc",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                    caller_bearer: "Bearer test",
                },
                name_caddie("cad_1", "rsv_1"),
                "Asia/Tokyo",
            )
            .await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("on other work")));
    }

    #[tokio::test]
    async fn other_work_only_refuses_the_rounds_it_actually_covers() {
        // 07:00 JST is inside a job that runs to noon; the same caddie is
        // still the right answer for the afternoon group.
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        let morning_job = CaddieDutyAssignment::reconstitute(
            Some(1),
            CaddieId::new("cad_1"),
            board_date(),
            DutyWindow::try_new(8 * 60, 12 * 60).expect("window"),
            "コース整備".to_string(),
            None,
            None,
        );

        let refused = CreateCaddieAssignmentUseCase::new(
            ops.clone(),
            Arc::new(UnsetRankFees),
            FakeCaddieDuties::with_assignments(vec![morning_job.clone()]),
        )
        .execute(
            GatewayCredentials {
                authorization: "Bearer t",
                operator_id: "scc",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            name_caddie("cad_1", "rsv_1"),
            "Asia/Tokyo",
        )
        .await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("on other work over those hours")));

        // 13:00 JST, clear of the job.
        let afternoon = NameCaddieForRound {
            scheduled_at: Utc.with_ymd_and_hms(2026, 8, 8, 4, 0, 0).unwrap(),
            ..name_caddie("cad_1", "rsv_2")
        };
        let written = CreateCaddieAssignmentUseCase::new(
            ops,
            Arc::new(UnsetRankFees),
            FakeCaddieDuties::with_assignments(vec![morning_job]),
        )
        .execute(
            GatewayCredentials {
                authorization: "Bearer t",
                operator_id: "scc",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            afternoon,
            "Asia/Tokyo",
        )
        .await
        .expect("named");
        assert_eq!(written.caddie_id().as_str(), "cad_1");
    }

    #[tokio::test]
    async fn a_group_that_already_has_a_caddie_is_refused() {
        // Two caddies on one group is the state the planner refuses to create;
        // the desk must not be able to reach it by hand either.
        let ops = Arc::new(FakeOps::with(vec![
            caddie("cad_1", "Sato", true, "active", CaddieSkillLevel::Regular),
            caddie("cad_2", "Tanaka", true, "active", CaddieSkillLevel::Regular),
        ]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_1"));

        let refused = name(ops, name_caddie("cad_2", "rsv_1")).await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("already has a caddie")));
    }

    #[tokio::test]
    async fn a_caddie_already_out_on_an_overlapping_round_is_refused() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_1",
            "Sato",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.assignments
            .lock()
            .expect("lock")
            .push(standing_assignment("cad_1", "rsv_other"));

        let refused = name(ops, name_caddie("cad_1", "rsv_1")).await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("overlaps")));
    }

    #[tokio::test]
    async fn a_caddie_who_asked_for_the_day_off_is_refused_by_hand_too() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_off",
            "Off",
            true,
            "active",
            CaddieSkillLevel::Regular,
        )]));
        ops.availabilities
            .lock()
            .expect("lock")
            .push(CaddieAvailability::reconstitute(
                "avail_1",
                "cad_off",
                NaiveDate::from_ymd_opt(2026, 8, 8).unwrap(),
                AvailabilityStatus::Unavailable,
                false,
                None,
                None,
            ));

        let refused = name(ops, name_caddie("cad_off", "rsv_1")).await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("shift")));
    }

    #[tokio::test]
    async fn a_suspended_caddie_cannot_be_named() {
        let ops = Arc::new(FakeOps::with(vec![caddie(
            "cad_off",
            "Retired",
            false,
            "suspended",
            CaddieSkillLevel::Regular,
        )]));

        let refused = name(ops, name_caddie("cad_off", "rsv_1")).await;
        assert!(matches!(refused, Err(CourseError::BadRequest(message))
            if message.contains("not taking rounds")));
    }

    fn caddie(
        id: &str,
        name: &str,
        active: bool,
        employment_status: &str,
        skill_level: CaddieSkillLevel,
    ) -> Caddie {
        Caddie::reconstitute(
            id,
            name,
            None,
            active,
            skill_level,
            CaddieRank::A,
            employment_status,
            12_000,
            "JPY",
            2,
            true,
            20,
            280_000,
            None,
            0,
        )
    }

    /// Rank fee storage that remembers every save, for the history tests.
    #[derive(Default)]
    struct RecordingRankFees {
        stored: Mutex<Option<CaddieRankFees>>,
        saves: Mutex<Vec<(CaddieRankFees, CaddieRankFees, CaddieRankFeeChangeContext)>>,
    }

    #[async_trait]
    impl CaddieRankFeeGateway for RecordingRankFees {
        async fn get_caddie_rank_fees(
            &self,
            _tenant_id: &str,
        ) -> Result<Option<CaddieRankFees>, CourseError> {
            Ok(self.stored.lock().expect("lock").clone())
        }

        async fn replace_caddie_rank_fees(
            &self,
            _tenant_id: &str,
            previous: &CaddieRankFees,
            fees: &CaddieRankFees,
            context: &CaddieRankFeeChangeContext,
        ) -> Result<CaddieRankFees, CourseError> {
            *self.stored.lock().expect("lock") = Some(fees.clone());
            self.saves.lock().expect("lock").push((
                previous.clone(),
                fees.clone(),
                context.clone(),
            ));
            Ok(fees.clone())
        }

        async fn list_caddie_rank_fee_changes(
            &self,
            _tenant_id: &str,
            _limit: u32,
        ) -> Result<Vec<crate::course::domain::CaddieRankFeeChange>, CourseError> {
            Ok(Vec::new())
        }
    }

    fn allow_all() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer t",
            operator_id: "scc",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    fn rank_fees(a: i64, d: i64) -> CaddieRankFees {
        CaddieRankFees::try_new(a, 11_000, 10_000, d, "JPY").expect("fees")
    }

    #[tokio::test]
    async fn a_first_save_records_what_payroll_was_reading_before_it() {
        // Nothing stored yet, so payroll was paying by the fallback — the
        // defaults here. The history has to say the save moved away from those,
        // not from nothing.
        let storage = Arc::new(RecordingRankFees::default());
        let context = CaddieRankFeeChangeContext::try_new(
            Some("sub-1".into()),
            Some("yamada".into()),
            Some("春の改定"),
        )
        .expect("context");
        ReplaceCaddieRankFeesUseCase::new(Arc::new(FakeOps::with(vec![])), storage.clone())
            .execute(allow_all(), rank_fees(13_000, 8_000), context.clone())
            .await
            .expect("saved");

        let saves = storage.saves.lock().expect("lock");
        assert_eq!(saves.len(), 1);
        assert_eq!(saves[0].0, CaddieRankFees::default());
        assert_eq!(saves[0].1, rank_fees(13_000, 8_000));
        assert_eq!(saves[0].2, context);
    }

    #[tokio::test]
    async fn a_later_save_records_the_stored_table_as_what_it_replaced() {
        let storage = Arc::new(RecordingRankFees::default());
        *storage.stored.lock().expect("lock") = Some(rank_fees(14_000, 9_000));
        ReplaceCaddieRankFeesUseCase::new(Arc::new(FakeOps::with(vec![])), storage.clone())
            .execute(
                allow_all(),
                rank_fees(15_000, 9_000),
                CaddieRankFeeChangeContext::default(),
            )
            .await
            .expect("saved");

        let saves = storage.saves.lock().expect("lock");
        assert_eq!(saves[0].0, rank_fees(14_000, 9_000));
    }

    #[tokio::test]
    async fn saving_the_amounts_already_stored_leaves_no_entry() {
        // A history padded with saves that changed nobody's pay buries the ones
        // that did.
        let storage = Arc::new(RecordingRankFees::default());
        *storage.stored.lock().expect("lock") = Some(rank_fees(14_000, 9_000));
        let stored =
            ReplaceCaddieRankFeesUseCase::new(Arc::new(FakeOps::with(vec![])), storage.clone())
                .execute(
                    allow_all(),
                    rank_fees(14_000, 9_000),
                    CaddieRankFeeChangeContext::default(),
                )
                .await
                .expect("saved");

        assert_eq!(stored, rank_fees(14_000, 9_000));
        assert!(storage.saves.lock().expect("lock").is_empty());
    }
}
