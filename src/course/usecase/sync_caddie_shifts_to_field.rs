//! Push a confirmed month to Field, one batch at a time.
//!
//! Editing tomorrow moves one day and goes to Field inside the same request
//! (see `update_caddie_shift.rs`). Confirming a month moves the whole roster's
//! — a thousand-odd upstream calls — and that does not belong in the request a
//! person is waiting on. It would also be a poor place to fail: Field being
//! unreachable would stop a club from confirming a month whose plan has
//! nothing to do with Field.
//!
//! So confirming stays fast and CourseBoard-only, and this runs after it.
//! Each call takes the days that are behind, tells Field about a batch of
//! them, and answers with how many are left. The caller keeps going until
//! none are.
//!
//! ## Why batches, and why the count is stored rather than remembered
//!
//! Field did not take the `(staffId, date)` uniqueness this app asked for
//! (PLT-3835), so a day whose shift id we lose is a day Field will happily
//! hold twice. Every batch therefore records what it filed before moving on,
//! and "what is left" is read from storage rather than carried in memory.
//! A run that dies half way costs the batch in flight, not the month.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CaddieShiftGateway, CourseError, FieldShiftLink, GatewayCredentials, GolfOpsGateway,
    ShiftRulesGateway, UnsyncedShift, YearMonth,
};
use crate::course::usecase::MirrorShiftToField;

/// Days per call. Sized so one call stays inside the seconds a screen can
/// wait on while still finishing a full roster's month in a handful of them.
const BATCH: u32 = 200;

/// Days told to Field at once. Matches the roster fan-out next door; the
/// point is to be quick without becoming a burst that Field reads as abuse.
const CONCURRENCY: usize = 8;

/// What one push did, and what is left to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldSyncProgress {
    filed: u64,
    withdrawn: u64,
    unlinkable: u64,
    failed: u64,
    remaining: u64,
}

impl FieldSyncProgress {
    /// Working days Field was told about.
    pub fn filed(&self) -> u64 {
        self.filed
    }

    /// Days withdrawn from Field, because they are no longer worked.
    pub fn withdrawn(&self) -> u64 {
        self.withdrawn
    }

    /// Days that cannot reach Field: the caddie has no HRM staff record, so
    /// there is nobody to file them under.
    ///
    /// Stamped as dealt with rather than left in the queue, or the count would
    /// never reach zero and the caller would loop forever. That means giving
    /// the caddie a staff record later does not put these back by itself —
    /// nothing about the confirmed day changed. Re-sending the month is what
    /// picks them up, which is why this number is reported rather than
    /// swallowed.
    pub fn unlinkable(&self) -> u64 {
        self.unlinkable
    }

    /// Days Field refused or could not answer for. Worth looking at: unlike
    /// `unlinkable`, nothing about the roster explains these.
    pub fn failed(&self) -> u64 {
        self.failed
    }

    /// Days still behind after this call, `unlinkable` ones excluded — they
    /// are stamped as dealt with, so the count does reach zero.
    pub fn remaining(&self) -> u64 {
        self.remaining
    }

    pub fn done(&self) -> bool {
        self.remaining == 0
    }
}

pub struct SyncCaddieShiftsToFieldUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
    rules: Arc<dyn ShiftRulesGateway>,
    mirror: Arc<MirrorShiftToField>,
}

impl SyncCaddieShiftsToFieldUseCase {
    pub fn new(
        ops: Arc<dyn GolfOpsGateway>,
        shifts: Arc<dyn CaddieShiftGateway>,
        rules: Arc<dyn ShiftRulesGateway>,
        mirror: Arc<MirrorShiftToField>,
    ) -> Self {
        Self {
            ops,
            shifts,
            rules,
            mirror,
        }
    }

    /// How much of the month Field has not been told about.
    ///
    /// What the board shows on load: a push that died half way leaves days
    /// behind, and the only way anybody would know is by being told.
    pub async fn behind(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: YearMonth,
    ) -> Result<u64, CourseError> {
        credentials.require(actions::MANAGE_SHIFTS).await?;
        let (month_start, month_end) = year_month.bounds();
        self.shifts
            .count_unsynced(credentials.operator_id, month_start, month_end)
            .await
    }

    /// One batch. `resend` starts the month over: every day is treated as
    /// behind, whatever was pushed before.
    ///
    /// Re-sending is how a month gets un-stuck after the roster gap that made
    /// days unlinkable is closed, and how a club recovers a month somebody
    /// deleted on Field's side. It costs a full pass, so it is asked for
    /// rather than assumed.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: YearMonth,
        resend: bool,
    ) -> Result<FieldSyncProgress, CourseError> {
        credentials.require(actions::MANAGE_SHIFTS).await?;
        let (month_start, month_end) = year_month.bounds();
        if resend {
            self.shifts
                .mark_month_unsynced(credentials.operator_id, month_start, month_end)
                .await?;
        }

        let batch = self
            .shifts
            .unsynced_shifts(credentials.operator_id, month_start, month_end, BATCH)
            .await?;
        if batch.is_empty() {
            return Ok(FieldSyncProgress {
                filed: 0,
                withdrawn: 0,
                unlinkable: 0,
                failed: 0,
                remaining: 0,
            });
        }

        // Read once for the whole batch: the staff links, the club's fallback
        // hours, and each course's week. Asking per day would turn one
        // upstream call per shift into four.
        let (roster, defaults) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.rules
                .get_default_working_hours(credentials.operator_id),
        )?;
        let hours = self
            .mirror
            .opening_hours(
                credentials,
                batch
                    .iter()
                    .filter_map(|entry| entry.shift.course_id().cloned()),
            )
            .await?;
        // A staff id the profile still names but Field no longer has is not a
        // link. Field soft-deletes staff, and a deleted one stops resolving —
        // every write filed under it comes back "staff member not found"
        // (PLT-3588). The caddie profile keeps the id either way: deleting the
        // staff on Field's own screens does not reach back to clear it.
        //
        // Checked here rather than discovered from a 404, so one caddie whose
        // staff record was deleted does not spend an upstream call per day of
        // the month to say the same thing.
        let known_staff: HashSet<&str> = roster.staff().iter().map(|member| member.id()).collect();
        let staff_by_caddie: HashMap<&str, &str> = roster
            .caddies()
            .iter()
            .filter_map(|caddie| {
                let staff_id = caddie.staff_id()?;
                known_staff
                    .contains(staff_id)
                    .then_some((caddie.id().as_str(), staff_id))
            })
            .collect();

        let mut links = Vec::with_capacity(batch.len());
        let mut filed = 0;
        let mut withdrawn = 0;
        let mut unlinkable = 0;
        let mut failed = 0;
        for group in batch.chunks(CONCURRENCY) {
            let hours = &hours;
            let staff_by_caddie = &staff_by_caddie;
            let pushes = group.iter().map(move |entry| {
                let staff_id = staff_by_caddie
                    .get(entry.shift.caddie_id().as_str())
                    .copied();
                async move {
                    let pushed = self
                        .mirror
                        .execute(
                            credentials,
                            staff_id,
                            &entry.shift,
                            entry.field_shift_id.as_deref(),
                            defaults,
                            hours,
                        )
                        .await;
                    (entry, staff_id, pushed)
                }
            });
            // Not `try_join_all`: one day Field refuses must not throw away
            // the days beside it that went through. Their ids have to reach
            // storage, or the next pass files a second shift on each of them —
            // Field enforces no uniqueness of its own (PLT-3835).
            for (entry, staff_id, pushed) in futures::future::join_all(pushes).await {
                match pushed {
                    Ok(link) => {
                        match outcome(entry, staff_id) {
                            Outcome::Filed => filed += 1,
                            Outcome::Withdrawn => withdrawn += 1,
                            Outcome::Unlinkable => unlinkable += 1,
                        }
                        links.push(link);
                    }
                    Err(error) => {
                        failed += 1;
                        tracing::warn!(
                            caddie_id = entry.shift.caddie_id().as_str(),
                            date = %entry.shift.date(),
                            %error,
                            "a confirmed day could not be told to Field"
                        );
                        // A day Field argued with is stamped as dealt with;
                        // the same request would be refused the same way every
                        // pass, and leaving it queued stops the month
                        // finishing. A day Field could not answer at all stays
                        // queued, because the next pass may well succeed.
                        if is_permanent(&error) {
                            links.push(FieldShiftLink::new(
                                entry.shift.caddie_id().clone(),
                                entry.shift.date(),
                                entry.field_shift_id.clone(),
                            ));
                        }
                    }
                }
            }
        }

        // Recorded before the next batch is asked for, and before this call
        // answers. A run that stops here has still banked what it filed, so
        // the next one moves those shifts instead of filing them again.
        self.shifts
            .set_field_shift_links(credentials.operator_id, &links)
            .await?;

        let remaining = self
            .shifts
            .count_unsynced(credentials.operator_id, month_start, month_end)
            .await?;
        Ok(FieldSyncProgress {
            filed,
            withdrawn,
            unlinkable,
            failed,
            remaining,
        })
    }
}

/// Whether asking again would be refused the same way.
///
/// Field arguing with the request — a staff member it will not resolve, a body
/// it rejects — answers the same every time, so the day is stamped and
/// reported rather than queued forever. Field being unreachable, or failing
/// inside, says nothing about the day: that one stays queued.
fn is_permanent(error: &CourseError) -> bool {
    matches!(
        error,
        CourseError::UpstreamClient { .. } | CourseError::BadRequest(_) | CourseError::NotFound(_)
    )
}

enum Outcome {
    Filed,
    Withdrawn,
    Unlinkable,
}

/// What this day amounted to, for the count the screen shows.
///
/// Read from the day itself rather than from what the mirror returned: a
/// withdrawal and a day Field never held both answer with no shift id, and
/// they are not the same thing to report.
fn outcome(entry: &UnsyncedShift, staff_id: Option<&str>) -> Outcome {
    if staff_id.is_none() {
        return Outcome::Unlinkable;
    }
    if entry.shift.is_working() {
        Outcome::Filed
    } else {
        Outcome::Withdrawn
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use chrono::NaiveDate;

    use super::*;
    use crate::course::domain::{
        AssignmentId, AttendancePeriodSnapshot, AttendanceSnapshotReport, AvailabilityQuery,
        AvailabilityRule, Caddie, CaddieAssignment, CaddieAssignmentQuery, CaddieAvailability,
        CaddieCourseMembership, CaddieId, CaddieRank, CaddieRankFees, CaddieRating, CaddieRoster,
        CaddieShift, CaddieSkillLevel, CaddieStaff, Course, CourseId, CourseOrder,
        DefaultWorkingHours, FieldShiftLink, GenerationSummary, GolfCatalogGateway, ProductSlot,
        ReplaceCaddieMemberships, ReservationProduct, ReservationScheduleGateway,
        ReservationServiceId, Resource, ResourceId, ResourceTimeSlot, SaveCourseResource,
        ShiftOrigin, ShiftPolicy, ShiftSpan, StaffShiftGateway, StaffShiftInput, UpsertCaddie,
        UpsertCaddieAssignment, UpsertCaddieAvailability, UpsertCourse, UpsertReservationProduct,
        WorkedMinutes,
    };
    use crate::course::infrastructure::ALLOW_ALL;
    use std::collections::HashMap;

    struct FakeOps {
        roster: CaddieRoster,
    }

    #[derive(Default)]
    struct FakeShifts {
        queue: Mutex<Vec<UnsyncedShift>>,
        remaining: Mutex<u64>,
        saved_links: Mutex<Vec<FieldShiftLink>>,
        resends: Mutex<u32>,
    }

    #[derive(Default)]
    struct FakeRules;

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
            unimplemented!("not used")
        }

        async fn create_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            unimplemented!("not used")
        }

        async fn update_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: UpsertCaddie,
        ) -> Result<Caddie, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_caddie(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn list_caddie_assignments(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: CaddieAssignmentQuery,
        ) -> Result<Vec<CaddieAssignment>, CourseError> {
            unimplemented!("not used")
        }

        async fn create_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            unimplemented!("not used")
        }

        async fn update_caddie_assignment(
            &self,
            _credentials: GatewayCredentials<'_>,
            _assignment_id: &AssignmentId,
            _input: UpsertCaddieAssignment,
        ) -> Result<CaddieAssignment, CourseError> {
            unimplemented!("not used")
        }

        async fn list_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            unimplemented!("not used")
        }

        async fn list_memberships_for(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_ids: &[CaddieId],
        ) -> Result<HashMap<String, Vec<CaddieCourseMembership>>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_caddie_memberships(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _input: ReplaceCaddieMemberships,
        ) -> Result<Vec<CaddieCourseMembership>, CourseError> {
            unimplemented!("not used")
        }

        async fn list_caddie_availabilities(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: AvailabilityQuery,
        ) -> Result<Vec<CaddieAvailability>, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCaddieAvailability,
        ) -> Result<CaddieAvailability, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_caddie_availability(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: &CaddieId,
            _date: NaiveDate,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn get_attendance_snapshot(
            &self,
            _credentials: GatewayCredentials<'_>,
            _date: Option<NaiveDate>,
            _timezone: &str,
        ) -> Result<AttendanceSnapshotReport, CourseError> {
            unimplemented!("not used")
        }

        async fn list_attendance_period_snapshots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<AttendancePeriodSnapshot>, CourseError> {
            unimplemented!("not used")
        }

        async fn list_worked_minutes(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
        ) -> Result<std::collections::HashMap<String, WorkedMinutes>, CourseError> {
            unimplemented!("not used")
        }

        async fn get_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CaddieRankFees, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_caddie_rank_fees(
            &self,
            _credentials: GatewayCredentials<'_>,
            _fees: &CaddieRankFees,
        ) -> Result<CaddieRankFees, CourseError> {
            unimplemented!("not used")
        }

        async fn list_caddie_ratings(
            &self,
            _credentials: GatewayCredentials<'_>,
            _caddie_id: Option<&CaddieId>,
        ) -> Result<Vec<CaddieRating>, CourseError> {
            unimplemented!("not used")
        }
    }

    #[async_trait]
    impl CaddieShiftGateway for FakeShifts {
        async fn list_shifts(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<CaddieShift>, CourseError> {
            unimplemented!("not used")
        }

        async fn save_shifts(
            &self,
            _tenant_id: &str,
            _shifts: &[CaddieShift],
        ) -> Result<u64, CourseError> {
            unimplemented!("not used")
        }

        async fn get_shift(
            &self,
            _tenant_id: &str,
            _caddie_id: &CaddieId,
            _date: NaiveDate,
        ) -> Result<Option<CaddieShift>, CourseError> {
            unimplemented!("not used")
        }

        async fn field_shift_links(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<Vec<FieldShiftLink>, CourseError> {
            unimplemented!("not used")
        }

        async fn unsynced_shifts(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
            _limit: u32,
        ) -> Result<Vec<UnsyncedShift>, CourseError> {
            Ok(self.queue.lock().expect("lock").clone())
        }

        async fn mark_month_unsynced(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<(), CourseError> {
            *self.resends.lock().expect("lock") += 1;
            Ok(())
        }

        async fn count_unsynced(
            &self,
            _tenant_id: &str,
            _from: NaiveDate,
            _to: NaiveDate,
        ) -> Result<u64, CourseError> {
            Ok(self.remaining.lock().expect("lock").to_owned())
        }

        async fn set_field_shift_links(
            &self,
            _tenant_id: &str,
            links: &[FieldShiftLink],
        ) -> Result<(), CourseError> {
            self.saved_links
                .lock()
                .expect("lock")
                .extend_from_slice(links);
            *self.remaining.lock().expect("lock") = 0;
            Ok(())
        }
    }

    #[async_trait]
    impl ShiftRulesGateway for FakeRules {
        async fn get_shift_policy(&self, _tenant_id: &str) -> Result<ShiftPolicy, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_shift_policy(
            &self,
            _tenant_id: &str,
            _policy: &ShiftPolicy,
        ) -> Result<ShiftPolicy, CourseError> {
            unimplemented!("not used")
        }

        async fn get_default_working_hours(
            &self,
            _tenant_id: &str,
        ) -> Result<DefaultWorkingHours, CourseError> {
            Ok(DefaultWorkingHours::club_default())
        }
    }

    /// Only the shift writes matter here; the course schedule is answered by
    /// the mirror's own fake next door, so this one is deliberately bare.
    #[derive(Default)]
    struct RecordingStaffShifts {
        filed: Mutex<Vec<(String, Option<String>)>>,
        deleted: Mutex<Vec<String>>,
        /// A staff member Field argues about, however often it is asked.
        refuses: Option<String>,
        /// A staff member Field cannot answer for right now.
        unreachable: Option<String>,
    }

    impl RecordingStaffShifts {
        fn refusing(staff_id: &str) -> Self {
            Self {
                refuses: Some(staff_id.to_string()),
                ..Self::default()
            }
        }

        fn unreachable(staff_id: &str) -> Self {
            Self {
                unreachable: Some(staff_id.to_string()),
                ..Self::default()
            }
        }
    }

    #[async_trait]
    impl StaffShiftGateway for RecordingStaffShifts {
        async fn upsert_shift(
            &self,
            _credentials: GatewayCredentials<'_>,
            staff_id: &str,
            field_shift_id: Option<&str>,
            _shift: StaffShiftInput,
        ) -> Result<String, CourseError> {
            if self.refuses.as_deref() == Some(staff_id) {
                return Err(CourseError::UpstreamClient {
                    status: 400,
                    message: "that shift overlaps another".into(),
                });
            }
            if self.unreachable.as_deref() == Some(staff_id) {
                return Err(CourseError::Provider("Field API request timed out".into()));
            }
            let mut filed = self.filed.lock().expect("lock");
            filed.push((staff_id.to_string(), field_shift_id.map(str::to_string)));
            Ok(field_shift_id
                .map(str::to_string)
                .unwrap_or_else(|| format!("shift_{}", filed.len())))
        }

        async fn delete_shift(
            &self,
            _credentials: GatewayCredentials<'_>,
            _staff_id: &str,
            field_shift_id: &str,
        ) -> Result<(), CourseError> {
            self.deleted
                .lock()
                .expect("lock")
                .push(field_shift_id.to_string());
            Ok(())
        }
    }

    fn credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer test",
            caller_bearer: "Bearer test",
            operator_id: "tenant-test",
            platform_id: None,
            authorizer: &ALLOW_ALL,
        }
    }

    fn day(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, day).expect("a real date")
    }

    fn entry(
        caddie: &str,
        day_of_month: u32,
        is_working: bool,
        linked: Option<&str>,
    ) -> UnsyncedShift {
        UnsyncedShift {
            shift: CaddieShift::reconstitute(
                CaddieId::new(caddie),
                day(day_of_month),
                None,
                is_working,
                ShiftSpan::FullDay,
                if is_working { 2 } else { 0 },
                ShiftOrigin::Generated,
                None,
                None,
                None,
            ),
            field_shift_id: linked.map(str::to_string),
        }
    }

    fn caddie(id: &str, staff_id: Option<&str>) -> Caddie {
        Caddie::reconstitute(
            id,
            id,
            staff_id.map(str::to_string),
            true,
            CaddieSkillLevel::Regular,
            CaddieRank::B,
            "part_time",
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

    /// No course is placed on these days, so the schedule is never consulted
    /// and the club default answers for every one of them.
    #[derive(Default)]
    struct NoCourses;

    #[async_trait]
    impl GolfCatalogGateway for NoCourses {
        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(Vec::new())
        }

        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            unimplemented!("not used")
        }

        async fn list_courses(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Course>, CourseError> {
            unimplemented!("not used")
        }

        async fn create_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used")
        }

        async fn update_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
            _input: UpsertCourse,
        ) -> Result<Course, CourseError> {
            unimplemented!("not used")
        }

        async fn delete_course(
            &self,
            _credentials: GatewayCredentials<'_>,
            _course_id: &CourseId,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }

        async fn create_reservation_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _name: &str,
        ) -> Result<ResourceId, CourseError> {
            unimplemented!("not used")
        }

        async fn save_course_resource(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: SaveCourseResource,
        ) -> Result<Resource, CourseError> {
            unimplemented!("not used")
        }

        async fn get_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_course_order(
            &self,
            _credentials: GatewayCredentials<'_>,
            _order: &CourseOrder,
        ) -> Result<CourseOrder, CourseError> {
            unimplemented!("not used")
        }

        async fn list_reservation_products(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<ReservationProduct>, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_reservation_product(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertReservationProduct,
        ) -> Result<ReservationProduct, CourseError> {
            unimplemented!("not used")
        }

        async fn list_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_product_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _service_id: &ReservationServiceId,
            _slots: Vec<ProductSlot>,
        ) -> Result<Vec<ProductSlot>, CourseError> {
            unimplemented!("not used")
        }
    }

    #[async_trait]
    impl ReservationScheduleGateway for NoCourses {
        async fn get_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            unimplemented!("not used")
        }

        async fn replace_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _timezone: &str,
            _rules: &[AvailabilityRule],
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            unimplemented!("not used")
        }

        async fn generate_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _from: NaiveDate,
            _to: NaiveDate,
            _dry_run: bool,
        ) -> Result<GenerationSummary, CourseError> {
            unimplemented!("not used")
        }

        async fn list_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            _from: chrono::DateTime<chrono::Utc>,
            _to: chrono::DateTime<chrono::Utc>,
        ) -> Result<Vec<ResourceTimeSlot>, CourseError> {
            unimplemented!("not used")
        }
    }

    fn staff(id: &str) -> CaddieStaff {
        CaddieStaff::new(id, id, true)
    }

    fn staff_for(caddies: &[Caddie]) -> Vec<CaddieStaff> {
        caddies
            .iter()
            .filter_map(|caddie| caddie.staff_id())
            .map(staff)
            .collect()
    }

    fn use_case(
        queue: Vec<UnsyncedShift>,
        roster: Vec<Caddie>,
    ) -> (
        Arc<RecordingStaffShifts>,
        Arc<FakeShifts>,
        SyncCaddieShiftsToFieldUseCase,
    ) {
        let staff_shifts = Arc::new(RecordingStaffShifts::default());
        let catalog = Arc::new(NoCourses);
        let shifts = Arc::new(FakeShifts {
            remaining: Mutex::new(queue.len() as u64),
            queue: Mutex::new(queue),
            ..FakeShifts::default()
        });
        let use_case = SyncCaddieShiftsToFieldUseCase::new(
            Arc::new(FakeOps {
                // Every staff member a caddie names exists, unless a test
                // deliberately takes one away.
                roster: CaddieRoster::new(roster.clone(), staff_for(&roster)),
            }),
            shifts.clone(),
            Arc::new(FakeRules),
            Arc::new(MirrorShiftToField::new(
                staff_shifts.clone(),
                catalog.clone(),
                catalog,
            )),
        );
        (staff_shifts, shifts, use_case)
    }

    #[tokio::test]
    async fn a_confirmed_month_reaches_field_and_the_ids_come_back_to_storage() {
        let (staff_shifts, shifts, use_case) = use_case(
            vec![
                entry("caddie-1", 1, true, None),
                entry("caddie-2", 1, true, None),
            ],
            vec![
                caddie("caddie-1", Some("stf_1")),
                caddie("caddie-2", Some("stf_2")),
            ],
        );

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(progress.filed(), 2);
        assert!(progress.done());
        assert_eq!(staff_shifts.filed.lock().expect("lock").len(), 2);
        // Recorded, so the next pass moves these shifts rather than filing a
        // second one on the same day — Field enforces no uniqueness.
        let links = shifts.saved_links.lock().expect("lock");
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|link| link.field_shift_id.is_some()));
    }

    #[tokio::test]
    async fn a_day_no_longer_worked_is_withdrawn_and_stops_naming_a_shift() {
        let (staff_shifts, shifts, use_case) = use_case(
            vec![entry("caddie-1", 2, false, Some("shift_a"))],
            vec![caddie("caddie-1", Some("stf_1"))],
        );

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(progress.withdrawn(), 1);
        assert_eq!(progress.filed(), 0);
        assert_eq!(*staff_shifts.deleted.lock().expect("lock"), vec!["shift_a"]);
        assert_eq!(
            shifts.saved_links.lock().expect("lock")[0].field_shift_id,
            None
        );
    }

    #[tokio::test]
    async fn a_caddie_with_no_staff_record_is_counted_rather_than_left_in_the_queue() {
        // Left in, the count would never reach zero and the caller would loop
        // forever. Counted, the desk is told what the roster is costing.
        let (staff_shifts, shifts, use_case) = use_case(
            vec![entry("caddie-1", 3, true, None)],
            vec![caddie("caddie-1", None)],
        );

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(progress.unlinkable(), 1);
        assert_eq!(progress.filed(), 0);
        assert!(progress.done());
        assert!(staff_shifts.filed.lock().expect("lock").is_empty());
        // Stamped all the same, which is what takes it out of the queue.
        assert_eq!(shifts.saved_links.lock().expect("lock").len(), 1);
    }

    #[tokio::test]
    async fn a_month_already_caught_up_asks_field_for_nothing() {
        let (staff_shifts, _shifts, use_case) = use_case(Vec::new(), Vec::new());

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert!(progress.done());
        assert_eq!(progress.filed(), 0);
        assert!(staff_shifts.filed.lock().expect("lock").is_empty());
    }

    #[tokio::test]
    async fn re_sending_queues_the_month_again_before_reading_it() {
        let (_staff_shifts, shifts, use_case) = use_case(
            vec![entry("caddie-1", 4, true, Some("shift_a"))],
            vec![caddie("caddie-1", Some("stf_1"))],
        );

        use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), true)
            .await
            .unwrap();

        assert_eq!(*shifts.resends.lock().expect("lock"), 1);
    }

    #[tokio::test]
    async fn a_day_field_already_holds_is_moved_rather_than_filed_again() {
        let (staff_shifts, _shifts, use_case) = use_case(
            vec![entry("caddie-1", 5, true, Some("shift_a"))],
            vec![caddie("caddie-1", Some("stf_1"))],
        );

        use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(
            *staff_shifts.filed.lock().expect("lock"),
            vec![("stf_1".to_string(), Some("shift_a".to_string()))]
        );
    }
    #[tokio::test]
    async fn a_caddie_whose_staff_record_field_deleted_is_not_filed_under_it() {
        // Field soft-deletes staff and stops resolving the id, but the caddie
        // profile keeps it. Sending the day anyway spends an upstream call per
        // day of the month to be told the same thing.
        let staff_shifts = Arc::new(RecordingStaffShifts::default());
        let catalog = Arc::new(NoCourses);
        let shifts = Arc::new(FakeShifts {
            remaining: Mutex::new(1),
            queue: Mutex::new(vec![entry("caddie-1", 6, true, None)]),
            ..FakeShifts::default()
        });
        let use_case = SyncCaddieShiftsToFieldUseCase::new(
            Arc::new(FakeOps {
                // The caddie still names stf_gone; the staff list no longer has it.
                roster: CaddieRoster::new(vec![caddie("caddie-1", Some("stf_gone"))], Vec::new()),
            }),
            shifts.clone(),
            Arc::new(FakeRules),
            Arc::new(MirrorShiftToField::new(
                staff_shifts.clone(),
                catalog.clone(),
                catalog,
            )),
        );

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(progress.unlinkable(), 1);
        assert_eq!(progress.failed(), 0);
        assert!(staff_shifts.filed.lock().expect("lock").is_empty());
        assert!(progress.done());
    }

    #[tokio::test]
    async fn one_day_field_refuses_does_not_throw_away_the_days_beside_it() {
        // The ids of the days that went through have to reach storage, or the
        // next pass files a second shift on each of them.
        let staff_shifts = Arc::new(RecordingStaffShifts::refusing("stf_2"));
        let catalog = Arc::new(NoCourses);
        let roster = vec![
            caddie("caddie-1", Some("stf_1")),
            caddie("caddie-2", Some("stf_2")),
            caddie("caddie-3", Some("stf_3")),
        ];
        let shifts = Arc::new(FakeShifts {
            remaining: Mutex::new(3),
            queue: Mutex::new(vec![
                entry("caddie-1", 7, true, None),
                entry("caddie-2", 7, true, None),
                entry("caddie-3", 7, true, None),
            ]),
            ..FakeShifts::default()
        });
        let use_case = SyncCaddieShiftsToFieldUseCase::new(
            Arc::new(FakeOps {
                roster: CaddieRoster::new(roster.clone(), staff_for(&roster)),
            }),
            shifts.clone(),
            Arc::new(FakeRules),
            Arc::new(MirrorShiftToField::new(
                staff_shifts.clone(),
                catalog.clone(),
                catalog,
            )),
        );

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(progress.filed(), 2);
        assert_eq!(progress.failed(), 1);
        // Two ids banked, plus the refused day stamped so the month can finish.
        assert_eq!(shifts.saved_links.lock().expect("lock").len(), 3);
    }

    #[tokio::test]
    async fn a_day_field_could_not_answer_for_stays_in_the_queue() {
        // Unreachable says nothing about the day, so the next pass retries it
        // rather than stamping it as dealt with.
        let staff_shifts = Arc::new(RecordingStaffShifts::unreachable("stf_1"));
        let catalog = Arc::new(NoCourses);
        let roster = vec![caddie("caddie-1", Some("stf_1"))];
        let shifts = Arc::new(FakeShifts {
            remaining: Mutex::new(1),
            queue: Mutex::new(vec![entry("caddie-1", 8, true, None)]),
            ..FakeShifts::default()
        });
        let use_case = SyncCaddieShiftsToFieldUseCase::new(
            Arc::new(FakeOps {
                roster: CaddieRoster::new(roster.clone(), staff_for(&roster)),
            }),
            shifts.clone(),
            Arc::new(FakeRules),
            Arc::new(MirrorShiftToField::new(
                staff_shifts.clone(),
                catalog.clone(),
                catalog,
            )),
        );

        let progress = use_case
            .execute(credentials(), YearMonth::parse("2026-09").unwrap(), false)
            .await
            .unwrap();

        assert_eq!(progress.failed(), 1);
        assert_eq!(progress.filed(), 0);
        assert!(shifts.saved_links.lock().expect("lock").is_empty());
    }
}
