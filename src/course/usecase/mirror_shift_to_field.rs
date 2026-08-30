//! Mirror one confirmed day into Field, so the generic fact that somebody is
//! at work lives where Field's HRM already models it (ADR-0013).
//!
//! CourseBoard keeps what is golf's: which course the caddie stands at, how
//! many rounds they can take, whether the desk pinned the day. Field is told
//! only that a staff member works, and between which times.
//!
//! ## Where the times come from
//!
//! Nowhere in this file. A span becomes clock times in
//! [`hours_for_span`](crate::course::domain::hours_for_span), off the course's
//! own reception schedule, so a club's opening hours are stated once. All this
//! does is fetch the bands for the right weekday and hand them over.
//!
//! ## Order
//!
//! Field first, CourseBoard second (ADR-0013 rule 4). Failing between the two
//! leaves Field holding a shift that CourseBoard has no golf attributes for,
//! which reads as "confirmed but unplaced" — a state the screens already have
//! a shape for. The reverse leaves CourseBoard holding a shift Field has never
//! heard of, which is the drift this whole change exists to end.
//!
//! So a Field failure fails the edit. The desk sees an error and tries again,
//! rather than quietly building more of the drift.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    courseboard_weekday, hours_for_span, AvailabilityRule, CaddieId, CaddieShift, CourseError,
    CourseId, DefaultWorkingHours, FieldShiftLink, GatewayCredentials, GolfCatalogGateway,
    OpeningBand, ReservationScheduleGateway, ResourceId, ResourceKind, ShiftHours,
    StaffShiftGateway, StaffShiftInput,
};

/// What Field should be told about one confirmed day.
#[derive(Debug, Clone, PartialEq, Eq)]
enum FieldShiftIntent {
    /// The caddie is at work; file the hours.
    File(ShiftHours),
    /// Field should hold nothing for this day.
    Withdraw,
}

/// Writes the generic half of confirmed shifts through to Field.
pub struct MirrorShiftToField {
    staff_shifts: Arc<dyn StaffShiftGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl MirrorShiftToField {
    pub fn new(
        staff_shifts: Arc<dyn StaffShiftGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self {
            staff_shifts,
            catalog,
            schedules,
        }
    }

    /// Tell Field what this day now is, and answer with the link to store.
    ///
    /// `staff_id` is the caddie's HRM staff member, when they have one.
    /// `existing` is what a previous write filed for the same caddie and day.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        staff_id: Option<&str>,
        shift: &CaddieShift,
        existing: Option<&str>,
        defaults: DefaultWorkingHours,
        hours: &CourseOpeningHours,
    ) -> Result<FieldShiftLink, CourseError> {
        let link = |field_shift_id| {
            FieldShiftLink::new(shift.caddie_id().clone(), shift.date(), field_shift_id)
        };
        let Some(staff_id) = staff_id.map(str::trim).filter(|id| !id.is_empty()) else {
            // A caddie with no staff link cannot be filed under anybody. The
            // roster already warns about these, and refusing the edit would
            // punish the desk for a gap it cannot close from this screen.
            //
            // Any shift a previous write left in Field is kept named rather
            // than forgotten: reaching it needs the staff member in the path,
            // so it cannot be withdrawn now, and dropping the id would lose
            // the only handle on it. If the staff link comes back, the next
            // write reuses the id; if it comes back pointing at a different
            // staff member, Field answers 404 and the day is filed afresh.
            if let Some(existing) = existing {
                tracing::warn!(
                    caddie_id = shift.caddie_id().as_str(),
                    date = %shift.date(),
                    field_shift_id = existing,
                    "the caddie has no staff record, so their Field shift cannot be reached"
                );
            }
            return Ok(link(existing.map(str::to_string)));
        };

        match Self::intent_for(shift, defaults, hours)? {
            FieldShiftIntent::File(hours) => {
                let filed = self
                    .staff_shifts
                    .upsert_shift(
                        credentials,
                        staff_id,
                        existing,
                        StaffShiftInput {
                            date: shift.date(),
                            start_time: hours.start(),
                            end_time: hours.end(),
                            // Left to Field: the vocabulary for a kind of day
                            // is HRM's, and "morning" here means a golf
                            // half-day, which is not the same statement.
                            shift_type: None,
                            notes: shift.note().map(str::to_string),
                        },
                    )
                    .await?;
                Ok(link(Some(filed)))
            }
            FieldShiftIntent::Withdraw => {
                if let Some(existing) = existing {
                    self.staff_shifts
                        .delete_shift(credentials, staff_id, existing)
                        .await?;
                }
                Ok(link(None))
            }
        }
    }

    /// Read each course's weekly schedule once, for reuse across a batch.
    ///
    /// Confirming a month pushes the whole roster, and every one of those days
    /// asks the same handful of courses the same question. Asking Field once
    /// per day would turn one upstream call per shift into three.
    pub async fn opening_hours(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: impl IntoIterator<Item = CourseId>,
    ) -> Result<CourseOpeningHours, CourseError> {
        let wanted: HashSet<CourseId> = courses.into_iter().collect();
        if wanted.is_empty() {
            return Ok(CourseOpeningHours::default());
        }
        let resources = self.catalog.list_resources(credentials).await?;
        let by_course: HashMap<CourseId, ResourceId> = resources
            .iter()
            .filter(|resource| resource.is_active())
            .filter(|resource| resource.kind() == ResourceKind::Course)
            .filter_map(|resource| {
                let course_id = resource.golf_course_id()?;
                wanted.get(course_id).map(|course_id| {
                    (
                        course_id.clone(),
                        resource
                            .reservation_resource_id()
                            .cloned()
                            .unwrap_or_else(|| resource.id().clone()),
                    )
                })
            })
            .collect();

        // A course with no reservation resource is simply absent, and a day
        // placed there falls back to the club's own hours. The schedule
        // screens refuse that course because they have nothing to draw; a
        // caddie standing on it is at work either way.
        let pairs: Vec<(CourseId, ResourceId)> = by_course.into_iter().collect();
        let mut rules_by_course = HashMap::new();
        for group in pairs.chunks(SCHEDULE_READS) {
            let read = group.iter().map(|(course_id, resource_id)| async move {
                let rules = self
                    .schedules
                    .get_resource_schedule(credentials, resource_id)
                    .await?;
                Ok::<_, CourseError>((course_id.clone(), rules))
            });
            for (course_id, rules) in futures::future::try_join_all(read).await? {
                rules_by_course.insert(course_id, rules);
            }
        }
        Ok(CourseOpeningHours {
            by_course: rules_by_course,
        })
    }

    fn intent_for(
        shift: &CaddieShift,
        defaults: DefaultWorkingHours,
        hours: &CourseOpeningHours,
    ) -> Result<FieldShiftIntent, CourseError> {
        if !shift.is_working() {
            return Ok(FieldShiftIntent::Withdraw);
        }
        let bands = match shift.course_id() {
            Some(course_id) => hours.bands_for(course_id, shift.date()),
            // Confirmed but placed nowhere. Somebody is working; where is not
            // settled yet, so the club's own hours are the only honest answer.
            None => Vec::new(),
        };
        Ok(FieldShiftIntent::File(hours_for_span(
            shift.span(),
            &bands,
            defaults,
        )?))
    }
}

/// How many courses' schedules are read from Field at once.
const SCHEDULE_READS: usize = 8;

/// Each course's weekly reception schedule, read once and asked many times.
#[derive(Debug, Default, Clone)]
pub struct CourseOpeningHours {
    by_course: HashMap<CourseId, Vec<AvailabilityRule>>,
}

impl CourseOpeningHours {
    /// The bands that course opens on the weekday this date falls on.
    ///
    /// Empty for a course with no reservation resource behind it, and for a
    /// weekday it does not open. Both send the caller to the club default,
    /// which is why neither is an error.
    fn bands_for(&self, course_id: &CourseId, date: NaiveDate) -> Vec<OpeningBand> {
        self.by_course
            .get(course_id)
            .map(|rules| bands_on(rules, courseboard_weekday(date)))
            .unwrap_or_default()
    }
}

/// The bands a weekly schedule opens on one weekday.
///
/// A band that does not describe a window is left out rather than failing the
/// day. `AvailabilityRule` refuses those when a schedule is saved, so one can
/// only arrive from a schedule stored before that check — and a single bad row
/// should not stop a month from reaching Field.
fn bands_on(rules: &[AvailabilityRule], weekday: u8) -> Vec<OpeningBand> {
    rules
        .iter()
        .filter(|rule| rule.weekday() == weekday)
        .filter_map(
            |rule| match OpeningBand::try_new(rule.start_time(), rule.end_time()) {
                Ok(band) => Some(band),
                Err(error) => {
                    tracing::warn!(
                        weekday,
                        start = rule.start_time(),
                        end = rule.end_time(),
                        %error,
                        "a reception band describes no window; leaving it out of the shift hours"
                    );
                    None
                }
            },
        )
        .collect()
}

/// The Field shift standing behind each day, keyed the way callers ask.
pub fn links_by_day(links: Vec<FieldShiftLink>) -> HashMap<(CaddieId, NaiveDate), String> {
    links
        .into_iter()
        .filter_map(|link| {
            link.field_shift_id
                .map(|id| ((link.caddie_id, link.date), id))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;

    use super::*;
    use crate::course::domain::{
        Course, CourseOrder, GenerationSummary, ProductSlot, ReservationProduct,
        ReservationServiceId, Resource, ResourceTimeSlot, SaveCourseResource, ShiftOrigin,
        ShiftSpan, UpsertCourse, UpsertReservationProduct,
    };
    use crate::course::infrastructure::ALLOW_ALL;
    use chrono::{DateTime, Utc};

    fn rule(weekday: u8, start: &str, end: &str) -> AvailabilityRule {
        AvailabilityRule::try_new(None, weekday, start, end, 4, 8).expect("a valid band")
    }

    fn defaults() -> DefaultWorkingHours {
        DefaultWorkingHours::club_default()
    }

    #[test]
    fn only_the_weekday_being_worked_decides_the_hours() {
        let rules = vec![
            rule(1, "07:00", "12:00"),
            rule(1, "13:00", "16:00"),
            rule(2, "06:00", "18:00"),
        ];

        let bands = bands_on(&rules, 1);

        let full = hours_for_span(ShiftSpan::FullDay, &bands, defaults()).unwrap();
        assert_eq!((full.start(), full.end()), ("07:00".into(), "16:00".into()));
        // The break the club already runs, not the midpoint of 07:00-16:00.
        let morning = hours_for_span(ShiftSpan::Morning, &bands, defaults()).unwrap();
        assert_eq!(morning.end(), "12:00");
    }

    #[test]
    fn a_weekday_the_course_stays_shut_falls_back_to_the_clubs_own_day() {
        let rules = vec![rule(1, "07:00", "16:00")];

        let bands = bands_on(&rules, 0);

        assert!(bands.is_empty());
        let hours = hours_for_span(ShiftSpan::FullDay, &bands, defaults()).unwrap();
        assert_eq!(
            (hours.start(), hours.end()),
            ("07:00".into(), "17:00".into())
        );
    }

    #[test]
    fn a_day_field_holds_nothing_for_is_absent_from_the_index_rather_than_null() {
        let day = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
        let index = links_by_day(vec![
            FieldShiftLink::new(CaddieId::new("caddie-1"), day, Some("shift_a".to_string())),
            FieldShiftLink::new(CaddieId::new("caddie-2"), day, None),
        ]);

        assert_eq!(index.len(), 1);
        assert_eq!(
            index
                .get(&(CaddieId::new("caddie-1"), day))
                .map(String::as_str),
            Some("shift_a")
        );
    }
    /// What the mirror asked Field to do, in order.
    #[derive(Debug, Clone, PartialEq, Eq)]
    enum FieldCall {
        Upsert {
            staff_id: String,
            existing: Option<String>,
            start: String,
            end: String,
            notes: Option<String>,
        },
        Delete {
            staff_id: String,
            field_shift_id: String,
        },
    }

    #[derive(Default)]
    struct FakeStaffShifts {
        calls: Mutex<Vec<FieldCall>>,
    }

    #[async_trait]
    impl StaffShiftGateway for FakeStaffShifts {
        async fn upsert_shift(
            &self,
            _credentials: GatewayCredentials<'_>,
            staff_id: &str,
            field_shift_id: Option<&str>,
            shift: StaffShiftInput,
        ) -> Result<String, CourseError> {
            self.calls.lock().expect("lock").push(FieldCall::Upsert {
                staff_id: staff_id.to_string(),
                existing: field_shift_id.map(str::to_string),
                start: shift.start_time.clone(),
                end: shift.end_time.clone(),
                notes: shift.notes.clone(),
            });
            Ok(field_shift_id.unwrap_or("shift_new").to_string())
        }

        async fn delete_shift(
            &self,
            _credentials: GatewayCredentials<'_>,
            staff_id: &str,
            field_shift_id: &str,
        ) -> Result<(), CourseError> {
            self.calls.lock().expect("lock").push(FieldCall::Delete {
                staff_id: staff_id.to_string(),
                field_shift_id: field_shift_id.to_string(),
            });
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeCourseSchedule {
        resources: Vec<Resource>,
        rules: Vec<AvailabilityRule>,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCourseSchedule {
        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(self.resources.clone())
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
    impl ReservationScheduleGateway for FakeCourseSchedule {
        async fn get_resource_schedule(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            Ok(self.rules.clone())
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
            _from: DateTime<Utc>,
            _to: DateTime<Utc>,
        ) -> Result<Vec<ResourceTimeSlot>, CourseError> {
            unimplemented!("not used")
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

    /// 2026-09-01 is a Tuesday, weekday 2 the way CourseBoard counts.
    fn tuesday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 1).expect("a real date")
    }

    fn confirmed(course: Option<&str>, span: ShiftSpan, is_working: bool) -> CaddieShift {
        CaddieShift::reconstitute(
            CaddieId::new("caddie-1"),
            tuesday(),
            course.map(CourseId::new),
            is_working,
            span,
            if is_working { 2 } else { 0 },
            ShiftOrigin::Edited,
            None,
            Some("desk".to_string()),
            None,
        )
    }

    async fn mirror(
        rules: Vec<AvailabilityRule>,
    ) -> (Arc<FakeStaffShifts>, MirrorShiftToField, CourseOpeningHours) {
        let staff_shifts = Arc::new(FakeStaffShifts::default());
        let catalog = Arc::new(FakeCourseSchedule {
            resources: vec![Resource::reconstitute(
                "res_1",
                "OUT",
                Some("resv_1".to_string()),
                Some("out".to_string()),
                ResourceKind::Course,
                true,
            )],
            rules,
        });
        let mirror =
            MirrorShiftToField::new(staff_shifts.clone(), catalog.clone(), catalog.clone());
        let hours = mirror
            .opening_hours(credentials(), [CourseId::new("out")])
            .await
            .expect("the course schedule is readable");
        (staff_shifts, mirror, hours)
    }

    fn calls(staff_shifts: &FakeStaffShifts) -> Vec<FieldCall> {
        staff_shifts.calls.lock().expect("lock").clone()
    }

    #[tokio::test]
    async fn a_working_day_reaches_field_with_the_courses_own_hours() {
        let (staff_shifts, mirror, hours) =
            mirror(vec![rule(2, "07:00", "12:00"), rule(2, "13:00", "16:00")]).await;

        let link = mirror
            .execute(
                credentials(),
                Some("stf_1"),
                &confirmed(Some("out"), ShiftSpan::Morning, true),
                None,
                defaults(),
                &hours,
            )
            .await
            .unwrap();

        assert_eq!(
            calls(&staff_shifts),
            vec![FieldCall::Upsert {
                staff_id: "stf_1".into(),
                existing: None,
                start: "07:00".into(),
                end: "12:00".into(),
                notes: None,
            }]
        );
        assert_eq!(link.field_shift_id.as_deref(), Some("shift_new"));
    }

    #[tokio::test]
    async fn editing_a_day_moves_the_shift_field_already_holds_rather_than_adding_one() {
        let (staff_shifts, mirror, hours) = mirror(vec![rule(2, "07:00", "16:00")]).await;

        let link = mirror
            .execute(
                credentials(),
                Some("stf_1"),
                &confirmed(Some("out"), ShiftSpan::FullDay, true),
                Some("shift_a"),
                defaults(),
                &hours,
            )
            .await
            .unwrap();

        assert_eq!(
            calls(&staff_shifts),
            vec![FieldCall::Upsert {
                staff_id: "stf_1".into(),
                existing: Some("shift_a".into()),
                start: "07:00".into(),
                end: "16:00".into(),
                notes: None,
            }]
        );
        assert_eq!(link.field_shift_id.as_deref(), Some("shift_a"));
    }

    #[tokio::test]
    async fn turning_a_day_off_withdraws_it_from_field_and_forgets_the_shift() {
        let (staff_shifts, mirror, hours) = mirror(vec![rule(2, "07:00", "16:00")]).await;

        let link = mirror
            .execute(
                credentials(),
                Some("stf_1"),
                &confirmed(None, ShiftSpan::FullDay, false),
                Some("shift_a"),
                defaults(),
                &hours,
            )
            .await
            .unwrap();

        assert_eq!(
            calls(&staff_shifts),
            vec![FieldCall::Delete {
                staff_id: "stf_1".into(),
                field_shift_id: "shift_a".into(),
            }]
        );
        assert_eq!(link.field_shift_id, None);
    }

    #[tokio::test]
    async fn a_day_off_field_never_held_asks_field_for_nothing() {
        let (staff_shifts, mirror, hours) = mirror(vec![rule(2, "07:00", "16:00")]).await;

        mirror
            .execute(
                credentials(),
                Some("stf_1"),
                &confirmed(None, ShiftSpan::FullDay, false),
                None,
                defaults(),
                &hours,
            )
            .await
            .unwrap();

        assert!(calls(&staff_shifts).is_empty());
    }

    #[tokio::test]
    async fn a_shift_placed_on_no_course_is_filed_with_the_clubs_own_day() {
        let (staff_shifts, mirror, hours) = mirror(vec![rule(2, "05:00", "20:00")]).await;

        mirror
            .execute(
                credentials(),
                Some("stf_1"),
                &confirmed(None, ShiftSpan::FullDay, true),
                None,
                defaults(),
                &hours,
            )
            .await
            .unwrap();

        // The course's own 05:00-20:00 is not reached: nobody said this caddie
        // stands there.
        assert_eq!(
            calls(&staff_shifts),
            vec![FieldCall::Upsert {
                staff_id: "stf_1".into(),
                existing: None,
                start: "07:00".into(),
                end: "17:00".into(),
                notes: None,
            }]
        );
    }

    #[tokio::test]
    async fn a_caddie_with_no_staff_record_files_nothing_and_keeps_the_shift_named() {
        let (staff_shifts, mirror, hours) = mirror(vec![rule(2, "07:00", "16:00")]).await;

        let link = mirror
            .execute(
                credentials(),
                None,
                &confirmed(Some("out"), ShiftSpan::FullDay, true),
                Some("shift_a"),
                defaults(),
                &hours,
            )
            .await
            .unwrap();

        assert!(calls(&staff_shifts).is_empty());
        // Kept, not cleared: it is the only handle on a shift Field still has.
        assert_eq!(link.field_shift_id.as_deref(), Some("shift_a"));
    }
}
