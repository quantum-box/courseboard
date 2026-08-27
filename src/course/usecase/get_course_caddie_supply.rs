//! GetCourseCaddieSupplyUseCase: one use case, one public entrypoint (`execute`).
//!
//! One day, counted course by course: how many rounds the caddies confirmed
//! onto each course can walk, and how many caddie-attached groups that course
//! already holds. The difference is what the desk balances by moving somebody
//! from a course with room to one that is short.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, NaiveDate, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    apply_assignment_coverage, compute_course_supply, widen_for_utc_date_filter, AssignedCoverage,
    CaddieShift, CaddieShiftGateway, CourseError, CourseId, DayCaddieSupply, GatewayCredentials,
    GolfCatalogGateway, GolfOpsGateway, ReservationGateway, TeeSheetQuery, TeeSheetStatus,
};
use crate::course::usecase::GetTeeSheetUseCase;

pub struct GetCourseCaddieSupplyUseCase {
    shifts: Arc<dyn CaddieShiftGateway>,
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetCourseCaddieSupplyUseCase {
    /// Constructs the supply reader for the screen, including unplaced caddies.
    /// The roster is required to exclude shifts whose caddie no longer exists.
    pub fn with_roster(
        shifts: Arc<dyn CaddieShiftGateway>,
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        ops: Arc<dyn GolfOpsGateway>,
    ) -> Self {
        Self {
            shifts,
            reservations,
            catalog,
            ops,
        }
    }

    /// The supply screen: reading how the day is staffed is an insight.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
    ) -> Result<DayCaddieSupply, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        // A confirmed shift outlives the caddie it names. Deleting a caddie
        // removes their profile upstream but leaves `golf_caddie_shifts`
        // untouched — this side keeps golf's own columns keyed by an id the
        // other side may drop (ADR-0013). The per-course numbers survive that,
        // because a stray shift carries no course and lands in nobody's
        // column; the "placed nowhere" count does not, and read 9 on a roster
        // of 8. So the screen counts against the roster.
        let known = self
            .ops
            .list_caddie_roster(credentials)
            .await?
            .caddies()
            .iter()
            .map(|caddie| caddie.id().to_string())
            .collect::<HashSet<String>>();
        self.supply(credentials, date, &known).await
    }

    /// `known_caddies` drops shifts whose caddie is no longer on the roster.
    async fn supply(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        known_caddies: &HashSet<String>,
    ) -> Result<DayCaddieSupply, CourseError> {
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let sheet = GetTeeSheetUseCase::new(self.reservations.clone(), self.catalog.clone());
        let window = widen_for_utc_date_filter(date, date);
        let (sheet, shifts, courses, assignments) = tokio::try_join!(
            sheet.execute(
                credentials,
                TeeSheetQuery {
                    date,
                    to: None,
                    golf_course_id: None,
                },
            ),
            self.shifts.list_shifts(credentials.operator_id, date, date),
            self.catalog.list_courses(credentials),
            self.ops.list_caddie_assignments(
                credentials,
                crate::course::domain::CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
                    reservation_id: None,
                },
            ),
        )?;

        let shifts: Vec<CaddieShift> = shifts
            .into_iter()
            .filter(|shift| known_caddies.contains(shift.caddie_id().as_str()))
            .collect();

        let attached_reservations = caddie_attached_reservations(&sheet)?;
        let demand = caddie_attached_by_course(&sheet);
        let (day_start, day_end) = crate::course::domain::tenant_day_bounds(date, date, &timezone)?;
        let coverage: Vec<AssignedCoverage> = assignments
            .iter()
            .filter(|assignment| assignment.holds_the_round())
            .filter(|assignment| {
                let scheduled_at = assignment.scheduled_at();
                day_start <= scheduled_at && scheduled_at < day_end
            })
            .filter_map(|assignment| {
                let reservation_id = assignment.reservation_id()?.clone();
                let reservation = attached_reservations.get(&reservation_id)?;
                Some(
                    AssignedCoverage::new(
                        reservation_id,
                        reservation.course_id.clone(),
                        assignment.caddie_id().clone(),
                        assignment.id().clone(),
                    )
                    .with_tee_time(reservation.tee_time),
                )
            })
            .collect();

        let mut supply = compute_course_supply(
            date,
            courses
                .iter()
                .filter(|course| course.is_active())
                .map(|course| (course.id().clone(), course.name().to_string())),
            &shifts,
            &demand,
        );
        apply_assignment_coverage(&mut supply, &shifts, &coverage);
        Ok(supply)
    }
}

/// Caddie-attached groups each course holds for the day.
///
/// A cancelled row asks nothing of anybody; a completed one was walked, and
/// counting it is what keeps a finished morning from reading as spare
/// capacity somebody could be moved away from.
fn caddie_attached_reservations(
    sheet: &crate::course::domain::TeeSheet,
) -> Result<HashMap<crate::course::domain::ReservationId, AttachedReservation>, CourseError> {
    sheet
        .items()
        .iter()
        .filter(|item| item.requires_caddie())
        .filter(|item| item.status() != TeeSheetStatus::Cancelled)
        .map(|item| {
            let tee_time = DateTime::parse_from_rfc3339(item.tee_time())
                .map(|value| value.with_timezone(&Utc))
                .map_err(|_| {
                    CourseError::Provider("the tee sheet built an unreadable tee time".into())
                })?;
            Ok((
                item.id().clone(),
                AttachedReservation {
                    course_id: item.golf_course_id().clone(),
                    tee_time,
                },
            ))
        })
        .collect()
}

fn caddie_attached_by_course(sheet: &crate::course::domain::TeeSheet) -> HashMap<CourseId, i64> {
    let mut demand: HashMap<CourseId, i64> = HashMap::new();
    for item in sheet
        .items()
        .iter()
        .filter(|item| item.requires_caddie())
        .filter(|item| item.status() != TeeSheetStatus::Cancelled)
    {
        *demand.entry(item.golf_course_id().clone()).or_insert(0) += 1;
    }
    demand
}

#[derive(Debug, Clone)]
struct AttachedReservation {
    course_id: CourseId,
    tee_time: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::{Duration, TimeZone, Utc};
    use std::sync::{Arc, Mutex};

    use crate::course::domain::*;
    use crate::course::infrastructure::ALLOW_ALL;

    struct FakeShifts {
        shifts: Vec<CaddieShift>,
    }

    #[async_trait]
    impl CaddieShiftGateway for FakeShifts {
        async fn list_shifts(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<CaddieShift>, CourseError> {
            Ok(self.shifts.clone())
        }

        async fn save_shifts(
            &self,
            _tenant_id: &str,
            _shifts: &[CaddieShift],
        ) -> Result<u64, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn get_shift(
            &self,
            _tenant_id: &str,
            _caddie_id: &CaddieId,
            _date: NaiveDate,
        ) -> Result<Option<CaddieShift>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn field_shift_links(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<FieldShiftLink>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn unsynced_shifts(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
            _limit: u32,
        ) -> Result<Vec<UnsyncedShift>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn mark_month_unsynced(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn count_unsynced(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<u64, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn set_field_shift_links(
            &self,
            _tenant_id: &str,
            _links: &[FieldShiftLink],
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }
    }

    struct FakeReservations {
        reservations: Vec<Reservation>,
    }

    #[async_trait]
    impl ReservationGateway for FakeReservations {
        async fn list_customer_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
            _customer_id: &crate::course::domain::CustomerId,
            _limit: u32,
            _offset: u32,
        ) -> Result<Vec<Reservation>, CourseError> {
            unreachable!("not used in supply test")
        }

        async fn list_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Reservation>, CourseError> {
            Ok(self.reservations.clone())
        }

        async fn get_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            reservation_id: &ReservationId,
        ) -> Result<Reservation, CourseError> {
            self.reservations
                .iter()
                .find(|reservation| reservation.id() == reservation_id)
                .cloned()
                .ok_or(CourseError::NotFound("reservation not found"))
        }

        async fn update_reservation_plan(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _service_id: &ReservationServiceId,
            _ends_at: DateTime<Utc>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn update_reservation_booking(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _update: &ReservationBookingUpdate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn update_reservation_party(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            party: &PartyDetails,
        ) -> Result<PartyDetails, CourseError> {
            Ok(party.clone())
        }

        async fn list_reservation_type_ids(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<String>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_seeded_reservations(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<SeededReservation>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn create_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: &NewReservation,
        ) -> Result<ReservationId, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn cancel_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _reason: Option<&str>,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn replace_reservation(
            &self,
            _credentials: GatewayCredentials<'_>,
            _reservation_id: &ReservationId,
            _input: &NewReservation,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }
    }

    struct FakeCatalog {
        timezone: String,
        courses: Vec<Course>,
        products: Vec<ReservationProduct>,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            Ok(self.timezone.clone())
        }

        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            Ok(self.courses.clone())
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(Vec::new())
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<ResourceId, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            _order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            Ok(self.products.clone())
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used in supply test")
        }
    }

    struct FakeOps {
        roster: CaddieRoster,
        assignments: Vec<CaddieAssignment>,
        fail_assignments: bool,
        queries: Mutex<Vec<CaddieAssignmentQuery>>,
    }

    #[async_trait]
    impl GolfOpsGateway for FakeOps {
        async fn list_caddie_roster(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRoster, CourseError> {
            Ok(self.roster.clone())
        }

        async fn create_staff(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<CaddieStaff, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn create_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn update_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn delete_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_caddie_assignments(
            &self,
            _credentials: GatewayCredentials<'_>,
            query: CaddieAssignmentQuery,
        ) -> Result<Vec<CaddieAssignment>, CourseError> {
            self.queries.lock().expect("query lock").push(query);
            if self.fail_assignments {
                Err(CourseError::Provider("assignment read failed".into()))
            } else {
                Ok(self.assignments.clone())
            }
        }

        async fn create_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn update_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _assignment_id: &AssignmentId,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_memberships_for(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_ids: &[CaddieId],
        ) -> Result<HashMap<String, Vec<CaddieCourseMembership>>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn replace_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: ReplaceCaddieMemberships,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_caddie_availabilities(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: AvailabilityQuery,
        ) -> Result<Vec<CaddieAvailability>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn upsert_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAvailability,
        ) -> Result<CaddieAvailability, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn delete_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _date: NaiveDate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn get_attendance_snapshot(
            &self,
            _credentials: GatewayCredentials<'_>,
            _date: Option<NaiveDate>,
            _timezone: &str,
        ) -> Result<AttendanceSnapshotReport, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_attendance_period_snapshots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_worked_minutes(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
        ) -> Result<HashMap<String, WorkedMinutes>, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn get_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRankFees, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn replace_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
            _fees: &CaddieRankFees,
        ) -> Result<CaddieRankFees, CourseError> {
            unimplemented!("not used in supply test")
        }

        async fn list_caddie_ratings(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: Option<&CaddieId>,
        ) -> Result<Vec<CaddieRating>, CourseError> {
            unimplemented!("not used in supply test")
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer test-token",
            caller_bearer: "Bearer test-token",
            operator_id: "tenant-1",
            platform_id: Some("prod"),
            authorizer: &ALLOW_ALL,
        }
    }

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 12).expect("test date")
    }

    fn caddie(id: &str) -> Caddie {
        Caddie::reconstitute(
            id,
            format!("Caddie {id}"),
            None,
            true,
            CaddieSkillLevel::Regular,
            CaddieRank::C,
            "active",
            0,
            "JPY",
            2,
            true,
            0,
            0,
            None,
            0,
        )
    }

    fn shift(caddie_id: &str, course_id: &str, rounds: i32) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new(caddie_id),
            date(),
            Some(CourseId::new(course_id)),
            true,
            ShiftSpan::FullDay,
            rounds,
            ShiftOrigin::Generated,
            None,
            None,
            None,
        )
    }

    fn course(id: &str) -> Course {
        Course::reconstitute(
            id,
            id.to_ascii_uppercase(),
            None,
            18,
            DEFAULT_TIMEZONE,
            8,
            true,
            None,
            None,
            None,
            None,
        )
    }

    fn caddie_product() -> ReservationProduct {
        ReservationProduct::reconstitute(
            "product-caddie",
            None,
            "service-caddie",
            Some("Caddie round".into()),
            PlayType::Caddie,
            18,
            270,
            None,
            None,
        )
    }

    fn reservation(
        id: &str,
        starts_at: DateTime<Utc>,
        course_id: &str,
        status: &str,
    ) -> Reservation {
        Reservation::reconstitute(
            id,
            id,
            Some("service-caddie".into()),
            None,
            Some("Guest".into()),
            status,
            starts_at,
            starts_at + Duration::hours(4),
            4,
            Some(course_id.into()),
            None,
        )
    }

    fn assignment(
        id: &str,
        caddie_id: &str,
        reservation_id: Option<&str>,
        scheduled_at: DateTime<Utc>,
        status: &str,
    ) -> CaddieAssignment {
        CaddieAssignment::reconstitute(
            id,
            caddie_id,
            reservation_id.map(str::to_string),
            None,
            scheduled_at,
            None,
            status,
            "primary",
            0,
            "JPY",
            None,
        )
        .expect("valid assignment")
    }

    fn use_case(
        shifts: Vec<CaddieShift>,
        reservations: Vec<Reservation>,
        ops: Arc<FakeOps>,
    ) -> GetCourseCaddieSupplyUseCase {
        GetCourseCaddieSupplyUseCase::with_roster(
            Arc::new(FakeShifts { shifts }),
            Arc::new(FakeReservations { reservations }),
            Arc::new(FakeCatalog {
                timezone: DEFAULT_TIMEZONE.to_string(),
                courses: vec![course("out"), course("in")],
                products: vec![caddie_product()],
            }),
            ops,
        )
    }

    fn ops(caddies: Vec<Caddie>, assignments: Vec<CaddieAssignment>) -> Arc<FakeOps> {
        Arc::new(FakeOps {
            roster: CaddieRoster::new(caddies, Vec::new()),
            assignments,
            fail_assignments: false,
            queries: Mutex::new(Vec::new()),
        })
    }

    #[tokio::test]
    async fn joins_assignment_to_tee_sheet_once_and_uses_the_widened_utc_window() {
        let start = Utc.with_ymd_and_hms(2026, 9, 11, 15, 0, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 9, 12, 15, 0, 0).unwrap();
        let reservation = reservation("reservation-1", start, "out", "confirmed");
        let ops = ops(
            vec![caddie("a")],
            vec![
                assignment(
                    "assignment-1",
                    "a",
                    Some("reservation-1"),
                    start,
                    "assigned",
                ),
                assignment(
                    "assignment-duplicate",
                    "a",
                    Some("reservation-1"),
                    start,
                    "in_progress",
                ),
                assignment(
                    "assignment-at-end",
                    "a",
                    Some("reservation-1"),
                    end,
                    "assigned",
                ),
                assignment(
                    "assignment-before-start",
                    "a",
                    Some("reservation-1"),
                    start - Duration::seconds(1),
                    "assigned",
                ),
            ],
        );
        let use_case = use_case(
            vec![shift("a", "out", 2)],
            vec![reservation],
            Arc::clone(&ops),
        );

        let supply = use_case
            .execute(credentials(), date())
            .await
            .expect("supply succeeds");
        let out = &supply.courses()[0];
        assert_eq!(out.caddie_attached_groups(), 1);
        assert_eq!(out.assigned_groups(), 1);
        assert_eq!(out.backed_assigned_groups(), 1);
        assert_eq!(out.effective_rounds_capacity(), 1);
        assert_eq!(out.effective_caddie_attached_groups(), 0);

        let queries = ops.queries.lock().expect("query lock");
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0].from, Some(date() - Duration::days(1)));
        assert_eq!(queries[0].to, Some(date() + Duration::days(1)));
    }

    #[tokio::test]
    async fn cancelled_aliases_case_and_whitespace_are_excluded_but_unknown_is_coverage() {
        let start = Utc.with_ymd_and_hms(2026, 9, 12, 1, 0, 0).unwrap();
        let reservations = [
            ("cancelled", "cancelled"),
            ("canceled", " canceled "),
            ("uppercase", "CANCELLED"),
            ("unknown", "awaiting_manual_review"),
        ]
        .into_iter()
        .map(|(id, _status)| reservation(id, start, "out", "confirmed"))
        .collect::<Vec<_>>();
        let assignments = [
            ("assignment-cancelled", "cancelled", "cancelled"),
            ("assignment-canceled", "canceled", "canceled"),
            ("assignment-uppercase", "uppercase", "CANCELLED"),
            ("assignment-unknown", "unknown", "awaiting_manual_review"),
        ]
        .into_iter()
        .map(|(id, reservation_id, status)| {
            assignment(id, "unconfirmed", Some(reservation_id), start, status)
        })
        .collect::<Vec<_>>();
        let use_case = use_case(Vec::new(), reservations, ops(Vec::new(), assignments));

        let supply = use_case
            .execute(credentials(), date())
            .await
            .expect("supply succeeds");
        let out = &supply.courses()[0];
        assert_eq!(out.caddie_attached_groups(), 4);
        assert_eq!(out.assigned_groups(), 1);
        assert_eq!(out.unbacked_assigned_groups(), 1);
    }

    #[tokio::test]
    async fn assignment_without_reservation_id_or_sheet_match_is_ignored() {
        let start = Utc.with_ymd_and_hms(2026, 9, 12, 1, 0, 0).unwrap();
        let reservation = reservation("reservation-on-sheet", start, "out", "confirmed");
        let assignments = vec![
            assignment("assignment-no-reservation", "a", None, start, "assigned"),
            assignment(
                "assignment-external",
                "a",
                Some("reservation-not-on-sheet"),
                start,
                "assigned",
            ),
        ];
        let use_case = use_case(Vec::new(), vec![reservation], ops(Vec::new(), assignments));

        let supply = use_case
            .execute(credentials(), date())
            .await
            .expect("supply succeeds");
        assert_eq!(supply.courses()[0].caddie_attached_groups(), 1);
        assert_eq!(supply.courses()[0].assigned_groups(), 0);
    }

    #[tokio::test]
    async fn assignment_gateway_failure_is_returned_as_provider_error() {
        let ops = Arc::new(FakeOps {
            roster: CaddieRoster::new(Vec::new(), Vec::new()),
            assignments: Vec::new(),
            fail_assignments: true,
            queries: Mutex::new(Vec::new()),
        });
        let use_case = use_case(Vec::new(), Vec::new(), ops);

        let result = use_case.execute(credentials(), date()).await;

        assert!(matches!(
            result,
            Err(CourseError::Provider(message)) if message == "assignment read failed"
        ));
    }

    #[test]
    fn cancelled_tee_sheet_rows_are_not_caddie_demand() {
        let date = date();
        let items = vec![
            TeeSheetItem::new(
                "cancelled",
                "cancelled",
                Some("service-caddie".into()),
                None,
                CourseId::new("out"),
                "OUT",
                Vec::new(),
                "2026-09-12T01:00:00+00:00",
                270,
                PlayType::Caddie,
                4,
                "Guest",
                TeeSheetStatus::Cancelled,
                18,
                None,
            ),
            TeeSheetItem::new(
                "active",
                "active",
                Some("service-caddie".into()),
                None,
                CourseId::new("out"),
                "OUT",
                Vec::new(),
                "2026-09-12T02:00:00+00:00",
                270,
                PlayType::Caddie,
                4,
                "Guest",
                TeeSheetStatus::Confirmed,
                18,
                None,
            ),
        ];
        let sheet = TeeSheet::new(
            date,
            DEFAULT_TIMEZONE,
            "2026-09-11T21:00:00+00:00",
            "2026-09-12T09:00:00+00:00",
            items,
        );

        let reservations = caddie_attached_reservations(&sheet).expect("valid tee times");

        assert_eq!(reservations.len(), 1);
        assert!(reservations.contains_key(&ReservationId::new("active")));
    }
}
