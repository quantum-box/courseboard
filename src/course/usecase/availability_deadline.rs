//! Getting/setting the shift-request filing deadline, and listing who has not
//! filed for a given month.
//!
//! Kept in one file for the same reason as `slot_overrides`: the deadline and
//! the list of who has missed it are one decision seen from two sides.

use std::collections::HashSet;
use std::sync::Arc;

use crate::course::domain::{
    AvailabilityDeadline, AvailabilityDeadlineGateway, AvailabilityQuery, Caddie, CourseError,
    GatewayCredentials, GolfOpsGateway, YearMonth,
};

fn require_tenant(tenant_id: &str) -> Result<(), CourseError> {
    if tenant_id.trim().is_empty() {
        return Err(CourseError::BadRequest("tenant id is required"));
    }
    Ok(())
}

pub struct GetAvailabilityDeadlineUseCase {
    deadlines: Arc<dyn AvailabilityDeadlineGateway>,
}

impl GetAvailabilityDeadlineUseCase {
    pub fn new(deadlines: Arc<dyn AvailabilityDeadlineGateway>) -> Self {
        Self { deadlines }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        year_month: YearMonth,
    ) -> Result<Option<AvailabilityDeadline>, CourseError> {
        require_tenant(tenant_id)?;
        self.deadlines.get_deadline(tenant_id, year_month).await
    }
}

pub struct UpsertAvailabilityDeadlineUseCase {
    deadlines: Arc<dyn AvailabilityDeadlineGateway>,
}

impl UpsertAvailabilityDeadlineUseCase {
    pub fn new(deadlines: Arc<dyn AvailabilityDeadlineGateway>) -> Self {
        Self { deadlines }
    }

    pub async fn execute(
        &self,
        tenant_id: &str,
        deadline: AvailabilityDeadline,
    ) -> Result<AvailabilityDeadline, CourseError> {
        require_tenant(tenant_id)?;
        self.deadlines.upsert_deadline(tenant_id, deadline).await
    }
}

/// Active, assignable caddies who have not filed a single shift-request row
/// anywhere in the given month.
///
/// "Filed" is read straight off whether a row exists, not off a separate
/// flag: a day with no request already reads as `Available` for planning (see
/// caddie_ops.rs), so the only way to tell "confirmed available" apart from
/// "never asked" is whether the month holds any row for that caddie at all.
pub struct ListUnsubmittedCaddiesUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl ListUnsubmittedCaddiesUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: YearMonth,
    ) -> Result<Vec<Caddie>, CourseError> {
        let (month_start, month_end) = year_month.bounds();
        let (roster, availabilities) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_availabilities(
                credentials,
                AvailabilityQuery {
                    caddie_id: None,
                    from: Some(month_start),
                    to: Some(month_end),
                    date: None,
                },
            ),
        )?;
        let submitted: HashSet<&str> = availabilities
            .iter()
            .map(|availability| availability.caddie_id().as_str())
            .collect();
        Ok(roster
            .caddies()
            .iter()
            .filter(|caddie| caddie.is_assignable())
            .filter(|caddie| !submitted.contains(caddie.id().as_str()))
            .cloned()
            .collect())
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
        CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability, CaddieCourseMembership,
        CaddieId, CaddieRank, CaddieRating, CaddieRecommendation, CaddieRoster, CaddieSkillLevel,
        CaddieStaff, RecommendationQuery, ReplaceCaddieMemberships, UpsertCaddie,
        UpsertCaddieAssignment, UpsertCaddieAvailability,
    };

    struct FakeDeadlines {
        stored: Mutex<Option<AvailabilityDeadline>>,
    }

    #[async_trait]
    impl AvailabilityDeadlineGateway for FakeDeadlines {
        async fn get_deadline(
            &self,
            _tenant_id: &str,
            _year_month: YearMonth,
        ) -> Result<Option<AvailabilityDeadline>, CourseError> {
            Ok(*self.stored.lock().expect("lock"))
        }

        async fn upsert_deadline(
            &self,
            _tenant_id: &str,
            deadline: AvailabilityDeadline,
        ) -> Result<AvailabilityDeadline, CourseError> {
            *self.stored.lock().expect("lock") = Some(deadline);
            Ok(deadline)
        }
    }

    #[tokio::test]
    async fn setting_a_deadline_with_no_tenant_is_refused() {
        let use_case = UpsertAvailabilityDeadlineUseCase::new(Arc::new(FakeDeadlines {
            stored: Mutex::new(None),
        }));
        let deadline = AvailabilityDeadline::try_new(
            YearMonth::parse("2026-08").unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
        );
        assert!(use_case.execute("  ", deadline).await.is_err());
    }

    #[tokio::test]
    async fn a_set_deadline_reads_back_through_the_same_use_case_pair() {
        let deadlines = Arc::new(FakeDeadlines {
            stored: Mutex::new(None),
        });
        let deadline = AvailabilityDeadline::try_new(
            YearMonth::parse("2026-08").unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
        );
        UpsertAvailabilityDeadlineUseCase::new(deadlines.clone())
            .execute("tenant-1", deadline)
            .await
            .unwrap();

        let read = GetAvailabilityDeadlineUseCase::new(deadlines)
            .execute("tenant-1", YearMonth::parse("2026-08").unwrap())
            .await
            .unwrap();
        assert_eq!(read, Some(deadline));
    }

    struct FakeOps {
        caddies: Vec<Caddie>,
        availabilities: Vec<CaddieAvailability>,
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
            Ok(self.availabilities.clone())
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
                date.unwrap_or_else(|| NaiveDate::from_ymd_opt(2026, 8, 1).unwrap()),
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

        async fn auto_assign_caddies(
            &self,
            _credentials: GatewayCredentials<'_>,
            _date: NaiveDate,
            dry_run: bool,
        ) -> Result<AutoAssignResult, CourseError> {
            Ok(AutoAssignResult::new(dry_run, vec![], vec![]))
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

    fn caddie(id: &str, name: &str, active: bool) -> Caddie {
        Caddie::reconstitute(
            id,
            name,
            None,
            active,
            CaddieSkillLevel::Regular,
            CaddieRank::A,
            if active { "active" } else { "suspended" },
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

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer t",
            operator_id: "scc",
            platform_id: None,
        }
    }

    #[tokio::test]
    async fn a_caddie_with_no_row_anywhere_in_the_month_is_unsubmitted() {
        let ops = Arc::new(FakeOps {
            caddies: vec![caddie("cad_off", "Off", true)],
            availabilities: vec![],
        });
        let unsubmitted = ListUnsubmittedCaddiesUseCase::new(ops)
            .execute(credentials(), YearMonth::parse("2026-08").unwrap())
            .await
            .unwrap();
        assert_eq!(unsubmitted.len(), 1);
        assert_eq!(unsubmitted[0].display_name(), "Off");
    }

    #[tokio::test]
    async fn a_caddie_with_any_row_in_the_month_is_not_listed() {
        let ops = Arc::new(FakeOps {
            caddies: vec![caddie("cad_on", "On", true)],
            availabilities: vec![CaddieAvailability::reconstitute(
                "avail_1",
                "cad_on",
                NaiveDate::from_ymd_opt(2026, 8, 15).unwrap(),
                crate::course::domain::AvailabilityStatus::Available,
                false,
                None,
                None,
            )],
        });
        let unsubmitted = ListUnsubmittedCaddiesUseCase::new(ops)
            .execute(credentials(), YearMonth::parse("2026-08").unwrap())
            .await
            .unwrap();
        assert!(unsubmitted.is_empty());
    }

    #[tokio::test]
    async fn a_suspended_caddie_is_never_listed_as_unsubmitted() {
        let ops = Arc::new(FakeOps {
            caddies: vec![caddie("cad_retired", "Retired", false)],
            availabilities: vec![],
        });
        let unsubmitted = ListUnsubmittedCaddiesUseCase::new(ops)
            .execute(credentials(), YearMonth::parse("2026-08").unwrap())
            .await
            .unwrap();
        assert!(unsubmitted.is_empty());
    }
}
