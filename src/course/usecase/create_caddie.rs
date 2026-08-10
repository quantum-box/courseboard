//! CreateCaddieUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

use crate::course::domain::{
    Caddie, CourseError, GatewayCredentials, GolfOpsGateway, UpsertCaddie,
};

pub struct CreateCaddieUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl CreateCaddieUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    /// Being a caddie is a role a staff member holds, so the link is an
    /// invariant rather than an operator decision: a body that names no staff
    /// member registers one under the same name and links that.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        mut input: UpsertCaddie,
    ) -> Result<Caddie, CourseError> {
        if !input.has_staff_link() {
            let staff = self
                .ops
                .create_staff(credentials, &input.display_name)
                .await?;
            input.link_staff(staff.id());
        }
        self.ops.create_caddie(credentials, input).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::NaiveDate;
    use std::sync::Mutex;

    use crate::course::domain::{
        AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AutoAssignResult,
        AvailabilityQuery, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
        CaddieCourseMembership, CaddieId, CaddieRank, CaddieRankFees, CaddieRating,
        CaddieRecommendation, CaddieRoster, CaddieSkillLevel, CaddieStaff, RecommendationQuery,
        ReplaceCaddieMemberships, UpsertCaddieAssignment, UpsertCaddieAvailability,
    };

    #[derive(Default)]
    struct FakeOps {
        created_staff_names: Mutex<Vec<String>>,
        created_caddies: Mutex<Vec<UpsertCaddie>>,
    }

    #[async_trait]
    impl GolfOpsGateway for FakeOps {
        async fn list_caddie_roster(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRoster, CourseError> {
            Ok(CaddieRoster::new(vec![], vec![]))
        }

        async fn create_staff(
            &self,
            _credentials: GatewayCredentials<'_>,
            name: &str,
        ) -> Result<CaddieStaff, CourseError> {
            self.created_staff_names
                .lock()
                .expect("lock")
                .push(name.to_string());
            Ok(CaddieStaff::new("staff_new", name, true))
        }

        async fn create_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            let caddie = Caddie::reconstitute(
                "caddie_1",
                input.display_name.clone(),
                input.staff_id.clone(),
                input.active,
                input.skill_level,
                input.rank,
                input.employment_status.clone(),
                input.base_fee_amount,
                input.currency.clone(),
                input.max_rounds_per_day,
                input.can_two_rounds.unwrap_or(false),
                input.monthly_contract_rounds.unwrap_or(0),
                input.desired_income.unwrap_or(0),
                None,
                0,
            );
            self.created_caddies.lock().expect("lock").push(input);
            Ok(caddie)
        }

        async fn update_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
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

        async fn list_caddie_recommendations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: RecommendationQuery,
        ) -> Result<Vec<CaddieRecommendation>, CourseError> {
            Ok(vec![])
        }

        async fn get_attendance_snapshot(
            &self,
            _credentials: GatewayCredentials<'_>,
            _date: Option<NaiveDate>,
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

        async fn auto_assign_caddies(
            &self,
            _credentials: GatewayCredentials<'_>,
            _date: NaiveDate,
            _dry_run: bool,
        ) -> Result<AutoAssignResult, CourseError> {
            Err(CourseError::BadRequest("not used in test"))
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

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer test-token",
            operator_id: "operator-test",
            platform_id: Some("platform-test"),
        }
    }

    fn input(staff_id: Option<&str>) -> UpsertCaddie {
        UpsertCaddie::try_new(
            "山田 花子",
            "regular",
            "C",
            12_000,
            None,
            staff_id.map(String::from),
            staff_id.map(|_| "staff_member".to_string()),
            staff_id.map(String::from),
            true,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("valid upsert input")
    }

    #[tokio::test]
    async fn an_unlinked_body_registers_the_staff_member_it_names() {
        let ops = Arc::new(FakeOps::default());
        let use_case = CreateCaddieUseCase::new(ops.clone());

        let caddie = use_case
            .execute(credentials(), input(None))
            .await
            .expect("create caddie");

        assert_eq!(
            ops.created_staff_names.lock().expect("lock").as_slice(),
            ["山田 花子"]
        );
        let sent = ops.created_caddies.lock().expect("lock");
        let sent = sent.first().expect("caddie was created");
        assert_eq!(sent.staff_id.as_deref(), Some("staff_new"));
        assert_eq!(sent.staff_reference_id.as_deref(), Some("staff_new"));
        assert_eq!(sent.staff_reference_type.as_deref(), Some("staff_member"));
        assert_eq!(caddie.staff_id(), Some("staff_new"));
    }

    #[tokio::test]
    async fn a_named_staff_member_is_reused_instead_of_duplicated() {
        let ops = Arc::new(FakeOps::default());
        let use_case = CreateCaddieUseCase::new(ops.clone());

        use_case
            .execute(credentials(), input(Some("staff_001")))
            .await
            .expect("create caddie");

        assert!(ops.created_staff_names.lock().expect("lock").is_empty());
        let sent = ops.created_caddies.lock().expect("lock");
        assert_eq!(
            sent.first()
                .expect("caddie was created")
                .staff_id
                .as_deref(),
            Some("staff_001")
        );
    }

    #[test]
    fn skill_and_rank_defaults_stay_untouched_by_the_staff_link() {
        // Guards the `input(None)` fixture the tests above rely on.
        let parsed = input(None);
        assert_eq!(parsed.skill_level, CaddieSkillLevel::Regular);
        assert_eq!(parsed.rank, CaddieRank::C);
    }
}
