//! ListCaddiesUseCase: one use case, one public entrypoint (`execute`).

use std::sync::Arc;

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
        self.ops.list_caddie_roster(credentials).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::{NaiveDate, TimeZone, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AvailabilityQuery,
        Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
        CaddieCourseMembership, CaddieId, CaddieRank, CaddieRating, CaddieRecommendation,
        CaddieRoster, CaddieSkillLevel, CaddieStaff, RecommendationQuery, ReplaceCaddieMemberships,
        ReservationId, UpsertCaddie, UpsertCaddieAssignment, UpsertCaddieAvailability,
    };
    use crate::course::usecase::ListCaddieAssignmentsUseCase;

    struct FakeOps {
        caddies: Mutex<Vec<Caddie>>,
        assignments: Mutex<Vec<CaddieAssignment>>,
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
            date: Option<NaiveDate>,
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

        async fn export_payroll_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
        ) -> Result<String, CourseError> {
            Ok(String::new())
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
        });
        let listed = ListCaddiesUseCase::new(ops.clone())
            .execute(GatewayCredentials {
                authorization: "Bearer t",
                operator_id: "scc",
                platform_id: None,
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
                },
                CaddieAssignmentQuery::default(),
            )
            .await
            .expect("list assignments");
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].caddie_id(), "caddie_aya");
    }
}
