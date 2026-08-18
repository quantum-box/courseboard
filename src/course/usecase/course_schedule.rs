//! Reading, replacing, and materializing a course's weekly opening schedule.
//!
//! Field addresses schedules by generic resource. A golf course reaches one
//! through `golf_course_resources`, so every case here starts by resolving the
//! course to its resource and fails loudly when that mapping is missing —
//! writing a schedule onto the wrong resource would sell another course's tee
//! times.

use std::sync::Arc;

use chrono::{DateTime, NaiveDate, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    tenant_date_at, AvailabilityRule, BookingHorizon, BuiltInventory, CourseError, CourseId,
    GatewayCredentials, GeneratedThroughGateway, GenerationSummary, GolfCatalogGateway,
    GolfCommercialGateway, InventoryWatermark, ReservationScheduleGateway, ResourceId,
    ResourceKind, SavedSchedule,
};

/// Longest span one generate call may cover.
///
/// A year of 8-minute tee times is six figures of rows; the cap keeps a typo in
/// the date range from turning into a very long write.
const MAX_GENERATION_DAYS: i64 = 400;

/// Today on the course's own clock.
///
/// The window starts here, so reading it an hour off in UTC would open the book
/// on the wrong day at both ends.
fn course_today(now: DateTime<Utc>, timezone: &str) -> Result<NaiveDate, CourseError> {
    tenant_date_at(now, timezone)
}

async fn resolve_resource(
    catalog: &Arc<dyn GolfCatalogGateway>,
    credentials: GatewayCredentials<'_>,
    course_id: &CourseId,
) -> Result<ResourceId, CourseError> {
    let resources = catalog.list_resources(credentials).await?;
    resources
        .into_iter()
        .filter(|resource| resource.is_active())
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .find(|resource| resource.golf_course_id() == Some(course_id))
        .map(|resource| {
            resource
                .reservation_resource_id()
                .cloned()
                .unwrap_or_else(|| resource.id().clone())
        })
        .ok_or(CourseError::BadRequest(
            "this course is not linked to a reservation resource yet",
        ))
}

pub struct GetCourseScheduleUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl GetCourseScheduleUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self { catalog, schedules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
    ) -> Result<Vec<AvailabilityRule>, CourseError> {
        credentials.require(actions::LIST_COURSES).await?;
        let resource_id = resolve_resource(&self.catalog, credentials, course_id).await?;
        self.schedules
            .get_resource_schedule(credentials, &resource_id)
            .await
    }
}

pub struct ReplaceCourseScheduleUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    watermarks: Arc<dyn GeneratedThroughGateway>,
}

impl ReplaceCourseScheduleUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        watermarks: Arc<dyn GeneratedThroughGateway>,
    ) -> Self {
        Self {
            catalog,
            schedules,
            commercial,
            watermarks,
        }
    }

    /// Store the week, then build the tee times it describes.
    ///
    /// The two used to be separate things the operator did, and a week saved
    /// without the second one put nothing on sale — the rules are a statement
    /// of intent, and a date with no slot row is refused outright at booking
    /// time. Nothing was gained by making that an operator's job to remember.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        rules: Vec<AvailabilityRule>,
    ) -> Result<SavedSchedule, CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        reject_overlaps(&rules)?;
        // Four independent reads of upstream state, none of which depends on
        // another. Run serially they were four round trips the operator waited
        // through before the save had even started.
        let (courses, timezone, resource_id, horizon) = tokio::join!(
            self.catalog.list_courses(credentials),
            self.catalog.get_tenant_timezone(credentials),
            resolve_resource(&self.catalog, credentials, course_id),
            // Deliberately not `?`-ed here. A horizon we cannot read must not
            // stop a week from being stored, so its failure is carried into the
            // build below where that is already the rule.
            self.commercial.get_booking_horizon(credentials),
        );
        courses?
            .iter()
            .find(|course| course.id() == course_id)
            .ok_or(CourseError::NotFound("course"))?;
        let timezone = timezone?;
        let resource_id = resource_id?;
        let saved = self
            .schedules
            .replace_resource_schedule(credentials, &resource_id, &timezone, &rules)
            .await?;

        // Past this point the week is stored. A horizon we could not read, or a
        // build that failed, is reported beside a save that really did happen —
        // turning it into an error would tell the operator to redo work that is
        // already done, and hide that nothing is on sale.
        let built = self
            .build_window(credentials, course_id, &resource_id, &timezone, horizon)
            .await
            .unwrap_or_else(|error| {
                tracing::warn!(
                    %error,
                    course_id = %course_id.as_str(),
                    "the week saved but its tee times were not built"
                );
                None
            });
        Ok(SavedSchedule {
            rules: saved,
            built,
        })
    }

    async fn build_window(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        resource_id: &ResourceId,
        timezone: &str,
        horizon: Result<BookingHorizon, CourseError>,
    ) -> Result<Option<BuiltInventory>, CourseError> {
        let horizon = horizon?;
        let today = course_today(Utc::now(), timezone)?;
        let bookable_through = horizon.last_bookable_date(today);
        // The club named a closing date that has passed: the week is worth
        // storing for next season, but there is no day left to build, and asking
        // Field for a range that ends before it starts is an error rather than
        // an empty result.
        if bookable_through < today {
            return Ok(None);
        }
        let summary = self
            .schedules
            .generate_resource_time_slots(credentials, resource_id, today, bookable_through, false)
            .await?;
        // Records where the daily top-up should resume. Failing to write it
        // only costs a redundant rebuild tomorrow, so it does not sink a save.
        if let Err(error) = self
            .watermarks
            .set_watermark(
                credentials.operator_id,
                course_id,
                InventoryWatermark {
                    generated_through: bookable_through,
                    checked_on: today,
                },
            )
            .await
        {
            tracing::warn!(
                %error,
                course_id = %course_id.as_str(),
                "tee times were built but the watermark was not moved"
            );
        }
        Ok(Some(BuiltInventory {
            summary,
            bookable_through,
        }))
    }
}

/// The days still missing between what has been built and what should be on sale.
///
/// `None` means there is nothing to do, which is the answer on almost every
/// call — the window only falls short once a day, when the far edge moves.
fn top_up_range(
    generated_through: Option<NaiveDate>,
    today: NaiveDate,
    bookable_through: NaiveDate,
) -> Option<(NaiveDate, NaiveDate)> {
    if bookable_through < today {
        return None;
    }
    match generated_through {
        Some(mark) if mark >= bookable_through => None,
        // Resume the day after the watermark, but never reach back before
        // today: a course nobody has opened for a month would otherwise
        // rebuild weeks of dates that have already been played.
        Some(mark) => {
            let resume = mark.succ_opt().unwrap_or(today).max(today);
            Some((resume, bookable_through))
        }
        None => Some((today, bookable_through)),
    }
}

/// Two bands on one weekday that overlap would generate the same tee time
/// twice, and the second row would silently win on Field's uniqueness key.
fn reject_overlaps(rules: &[AvailabilityRule]) -> Result<(), CourseError> {
    let mut sorted: Vec<&AvailabilityRule> = rules.iter().collect();
    sorted.sort_by(|left, right| {
        left.weekday()
            .cmp(&right.weekday())
            .then_with(|| left.start_time().cmp(right.start_time()))
    });

    for pair in sorted.windows(2) {
        let (earlier, later) = (pair[0], pair[1]);
        if earlier.weekday() == later.weekday() && later.start_time() < earlier.end_time() {
            return Err(CourseError::BadRequest(
                "two bands on the same weekday overlap",
            ));
        }
    }
    Ok(())
}

pub struct GenerateCourseTimeSlotsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
}

impl GenerateCourseTimeSlotsUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
    ) -> Self {
        Self { catalog, schedules }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        course_id: &CourseId,
        from: NaiveDate,
        to: NaiveDate,
        dry_run: bool,
    ) -> Result<GenerationSummary, CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        if to < from {
            return Err(CourseError::BadRequest(
                "the end of the range must not be before its start",
            ));
        }
        if (to - from).num_days() >= MAX_GENERATION_DAYS {
            return Err(CourseError::BadRequest(
                "generate at most 400 days at a time",
            ));
        }
        let resource_id = resolve_resource(&self.catalog, credentials, course_id).await?;
        self.schedules
            .generate_resource_time_slots(credentials, &resource_id, from, to, dry_run)
            .await
    }
}

/// Keep every course built out to the booking horizon.
///
/// The far edge of the book moves forward one day at a time, and nothing moves
/// it: saving a schedule builds the window once, and a club that does not edit
/// its week again would lose a sellable date every day until it had none. There
/// is no scheduler in this product to move it on a timer, so the desk's own
/// traffic carries the top-up instead.
///
/// That only works if the usual call is nearly free, so the watermark decides
/// before anything upstream is touched: once every course has been checked
/// today, this is one indexed read and nothing else. When there is work, it is
/// a single day of tee times per course.
///
/// Best effort by design — it rides along with a read the operator asked for,
/// and a course that will not build must not take that read down with it.
///
/// Standing in for something Field should own (PLT-3361). Two things this
/// cannot do: it never runs on a day nobody opens CourseBoard, and it would not
/// see a booking arriving through a channel that does not come through here.
/// Field is always on the selling side, so a rolling window declared on the
/// reservation resource would close both gaps — and this whole use case, the
/// `golf_generated_through` table, and the ledger hook would go with it.
pub struct ExtendCourseInventoryUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    watermarks: Arc<dyn GeneratedThroughGateway>,
}

impl ExtendCourseInventoryUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        watermarks: Arc<dyn GeneratedThroughGateway>,
    ) -> Self {
        Self {
            catalog,
            schedules,
            commercial,
            watermarks,
        }
    }

    /// The courses whose window was actually extended.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        tenant_id: &str,
    ) -> Result<Vec<CourseId>, CourseError> {
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let today = course_today(Utc::now(), &timezone)?;
        let stored = self.watermarks.list_watermarks(tenant_id).await?;
        // A course with no row has never been built, and building it first is
        // the job of saving its schedule, not of this. So a tenant whose known
        // courses were all checked today has nothing to do, and pays one query.
        if !stored.is_empty()
            && stored
                .values()
                .all(|watermark| watermark.checked_on >= today)
        {
            return Ok(Vec::new());
        }

        let horizon = self.commercial.get_booking_horizon(credentials).await?;
        let bookable_through = horizon.last_bookable_date(today);
        let resources = self.catalog.list_resources(credentials).await?;

        let mut extended = Vec::new();
        for resource in resources
            .iter()
            .filter(|resource| resource.is_active())
            .filter(|resource| resource.kind() == ResourceKind::Course)
        {
            let Some(course_id) = resource.golf_course_id().cloned() else {
                continue;
            };
            let Some(watermark) = stored.get(&course_id).copied() else {
                continue;
            };
            let Some((from, to)) =
                top_up_range(Some(watermark.generated_through), today, bookable_through)
            else {
                continue;
            };
            let resource_id = resource
                .reservation_resource_id()
                .cloned()
                .unwrap_or_else(|| resource.id().clone());

            match self
                .schedules
                .generate_resource_time_slots(credentials, &resource_id, from, to, false)
                .await
            {
                Ok(_) => {
                    // Written only after Field says it built them: a watermark
                    // ahead of the inventory would skip the days it claims.
                    if let Err(error) = self
                        .watermarks
                        .set_watermark(
                            tenant_id,
                            &course_id,
                            InventoryWatermark {
                                generated_through: to,
                                checked_on: today,
                            },
                        )
                        .await
                    {
                        tracing::warn!(
                            %error,
                            course_id = %course_id.as_str(),
                            "tee times were built but the watermark was not moved"
                        );
                        continue;
                    }
                    extended.push(course_id);
                }
                Err(error) => tracing::warn!(
                    %error,
                    course_id = %course_id.as_str(),
                    "could not extend this course to the booking horizon"
                ),
            }
        }
        Ok(extended)
    }
}

pub struct GetBookingHorizonUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl GetBookingHorizonUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
    ) -> Self {
        Self {
            catalog,
            commercial,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<(BookingHorizon, NaiveDate), CourseError> {
        credentials.require(actions::LIST_COURSES).await?;
        let horizon = self.commercial.get_booking_horizon(credentials).await?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let bookable_through = horizon.last_bookable_date(course_today(Utc::now(), &timezone)?);
        Ok((horizon, bookable_through))
    }
}

/// Move the book's far edge, and put the moved window on sale for every course.
///
/// Shortening it is what makes this more than a config write: the tee times
/// past the new edge are already generated and still sellable, so every course
/// has to be rebuilt for the change to mean anything.
pub struct SetBookingHorizonUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
    watermarks: Arc<dyn GeneratedThroughGateway>,
}

impl SetBookingHorizonUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
        watermarks: Arc<dyn GeneratedThroughGateway>,
    ) -> Self {
        Self {
            catalog,
            schedules,
            commercial,
            watermarks,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        horizon: BookingHorizon,
    ) -> Result<(BookingHorizon, NaiveDate), CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        // A named closing date is only meaningful against the club's own today,
        // which the handler cannot know without the tenant's timezone. Checked
        // before the write, so a date nobody can sell to is refused rather than
        // stored and then quietly clamped.
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let today = course_today(Utc::now(), &timezone)?;
        horizon.validate_on(today)?;

        let stored = self
            .commercial
            .set_booking_horizon(credentials, &horizon)
            .await?;
        let bookable_through = stored.last_bookable_date(today);

        for (course_id, resource_id) in self.course_resources(credentials).await? {
            if let Err(error) = self
                .schedules
                .generate_resource_time_slots(
                    credentials,
                    &resource_id,
                    today,
                    bookable_through,
                    false,
                )
                .await
            {
                // One course that would not rebuild must not undo the others,
                // and the horizon itself is already stored.
                tracing::warn!(
                    %error,
                    resource_id = %resource_id.as_str(),
                    "the booking horizon moved but this course was not rebuilt"
                );
                continue;
            }
            if let Err(error) = self
                .watermarks
                .set_watermark(
                    credentials.operator_id,
                    &course_id,
                    InventoryWatermark {
                        generated_through: bookable_through,
                        checked_on: today,
                    },
                )
                .await
            {
                tracing::warn!(
                    %error,
                    course_id = %course_id.as_str(),
                    "tee times were rebuilt but the watermark was not moved"
                );
            }
        }
        Ok((stored, bookable_through))
    }

    async fn course_resources(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<(CourseId, ResourceId)>, CourseError> {
        Ok(self
            .catalog
            .list_resources(credentials)
            .await?
            .into_iter()
            .filter(|resource| resource.is_active())
            .filter(|resource| resource.kind() == ResourceKind::Course)
            .filter_map(|resource| {
                let course_id = resource.golf_course_id()?.clone();
                let resource_id = resource
                    .reservation_resource_id()
                    .cloned()
                    .unwrap_or_else(|| resource.id().clone());
                Some((course_id, resource_id))
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::{DateTime, Utc};
    use std::sync::Mutex;

    use crate::course::domain::{
        BudgetAchievement, Course, CourseOrder, DailyBudget, DailyBudgetQuery, ExtensionStatus,
        MonthlySettlement, ProductSlot, ReservationPolicy, ReservationProduct,
        ReservationServiceId, Resource, ResourceTimeSlot, SaveCourseResource,
        UpdateExtensionConfig, UpdateReservationPolicy, UpsertCourse, UpsertDailyBudget,
        UpsertReservationProduct,
    };
    use std::collections::HashMap;

    #[test]
    fn booking_horizon_today_follows_the_tenant_clock() {
        let instant: DateTime<Utc> = "2026-07-01T22:30:00Z".parse().unwrap();
        assert_eq!(
            course_today(instant, "Europe/Berlin").unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 2).unwrap(),
        );
    }

    fn rule(weekday: u8, start: &str, end: &str) -> AvailabilityRule {
        AvailabilityRule::try_new(None, weekday, start, end, 4, 8).expect("valid rule")
    }

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid date")
    }

    #[test]
    fn a_window_that_already_reaches_the_horizon_has_nothing_to_build() {
        // The ordinary answer: the desk opens the ledger many times a day and
        // only the first one after midnight finds anything to do.
        assert_eq!(
            top_up_range(
                Some(date("2027-01-14")),
                date("2026-07-18"),
                date("2027-01-14"),
            ),
            None
        );
    }

    #[test]
    fn a_window_one_day_short_builds_only_that_day() {
        assert_eq!(
            top_up_range(
                Some(date("2027-01-13")),
                date("2026-07-18"),
                date("2027-01-14"),
            ),
            Some((date("2027-01-14"), date("2027-01-14")))
        );
    }

    #[test]
    fn a_watermark_left_in_the_past_resumes_from_today_rather_than_replaying_it() {
        // Nobody opened the app for a month. Rebuilding the days in between
        // would rewrite dates that have already been played.
        assert_eq!(
            top_up_range(
                Some(date("2026-06-01")),
                date("2026-07-18"),
                date("2027-01-14"),
            ),
            Some((date("2026-07-18"), date("2027-01-14")))
        );
    }

    #[test]
    fn a_course_that_was_never_built_gets_the_whole_window() {
        assert_eq!(
            top_up_range(None, date("2026-07-18"), date("2027-01-14")),
            Some((date("2026-07-18"), date("2027-01-14")))
        );
    }

    #[test]
    fn a_horizon_behind_today_builds_nothing_rather_than_an_inverted_range() {
        // Not reachable through `BookingHorizon`, which is at least one day,
        // but a range that ends before it starts is refused downstream and
        // there is nothing sensible to build.
        assert_eq!(
            top_up_range(None, date("2026-07-18"), date("2026-07-17")),
            None
        );
    }

    #[test]
    fn bands_that_touch_end_to_start_are_allowed() {
        // 07:00-12:00 followed by 12:00-15:00 is the ordinary morning/afternoon
        // split, not an overlap.
        let rules = vec![rule(1, "07:00", "12:00"), rule(1, "12:00", "15:00")];
        assert!(reject_overlaps(&rules).is_ok());
    }

    #[test]
    fn bands_that_overlap_on_one_weekday_are_refused() {
        let rules = vec![rule(1, "07:00", "12:00"), rule(1, "11:00", "15:00")];
        assert!(reject_overlaps(&rules).is_err());
    }

    #[test]
    fn the_same_band_on_two_weekdays_is_not_an_overlap() {
        let rules = vec![rule(1, "07:00", "12:00"), rule(2, "07:00", "12:00")];
        assert!(reject_overlaps(&rules).is_ok());
    }

    #[test]
    fn overlaps_are_found_regardless_of_the_order_they_arrive_in() {
        let rules = vec![rule(1, "11:00", "15:00"), rule(1, "07:00", "12:00")];
        assert!(reject_overlaps(&rules).is_err());
    }

    #[derive(Default)]
    struct FakeCatalog {
        tenant_timezone: String,
        courses: Vec<Course>,
        resources: Vec<Resource>,
        /// The tenant timezone comes from the extension config, which is one of
        /// the slowest reads Field serves. Asking twice in one save used to be
        /// invisible.
        timezone_reads: Mutex<u32>,
    }

    #[async_trait]
    impl GolfCatalogGateway for FakeCatalog {
        async fn get_tenant_timezone(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<String, CourseError> {
            *self.timezone_reads.lock().expect("lock") += 1;
            Ok(self.tenant_timezone.clone())
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

        async fn list_resources(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Vec<Resource>, CourseError> {
            Ok(self.resources.clone())
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

    #[derive(Default)]
    struct FakeSchedules {
        timezone_used: Mutex<Option<String>>,
        generated: Mutex<Vec<(NaiveDate, NaiveDate)>>,
    }

    #[async_trait]
    impl ReservationScheduleGateway for FakeSchedules {
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
            timezone: &str,
            rules: &[AvailabilityRule],
        ) -> Result<Vec<AvailabilityRule>, CourseError> {
            *self.timezone_used.lock().expect("lock") = Some(timezone.to_string());
            Ok(rules.to_vec())
        }

        async fn generate_resource_time_slots(
            &self,
            _credentials: GatewayCredentials<'_>,
            _resource_id: &ResourceId,
            from: NaiveDate,
            to: NaiveDate,
            _dry_run: bool,
        ) -> Result<GenerationSummary, CourseError> {
            self.generated.lock().expect("lock").push((from, to));
            Ok(GenerationSummary {
                created: 1,
                ..GenerationSummary::default()
            })
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

    /// Only the booking horizon matters here; the rest of the commercial
    /// surface is not reachable from this use case.
    struct FakeCommercial {
        /// `None` stands for a horizon Field would not answer for.
        horizon: Option<BookingHorizon>,
    }

    #[async_trait]
    impl GolfCommercialGateway for FakeCommercial {
        async fn get_booking_horizon(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<BookingHorizon, CourseError> {
            self.horizon
                .ok_or_else(|| CourseError::Provider("booking horizon unavailable".into()))
        }

        async fn set_booking_horizon(
            &self,
            _credentials: GatewayCredentials<'_>,
            _horizon: &BookingHorizon,
        ) -> Result<BookingHorizon, CourseError> {
            unimplemented!("not used")
        }

        async fn get_reservation_policy(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<ReservationPolicy, CourseError> {
            unimplemented!("not used")
        }

        async fn update_reservation_policy(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpdateReservationPolicy,
        ) -> Result<ReservationPolicy, CourseError> {
            unimplemented!("not used")
        }

        async fn list_daily_budgets(
            &self,
            _credentials: GatewayCredentials<'_>,
            _query: DailyBudgetQuery,
        ) -> Result<Vec<DailyBudget>, CourseError> {
            unimplemented!("not used")
        }

        async fn upsert_daily_budget(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpsertDailyBudget,
        ) -> Result<DailyBudget, CourseError> {
            unimplemented!("not used")
        }

        async fn import_daily_budgets_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _csv: &str,
        ) -> Result<Vec<DailyBudget>, CourseError> {
            unimplemented!("not used")
        }

        async fn list_budget_achievements(
            &self,
            _credentials: GatewayCredentials<'_>,
            _from: NaiveDate,
            _to: NaiveDate,
            _timezone: &str,
        ) -> Result<Vec<BudgetAchievement>, CourseError> {
            unimplemented!("not used")
        }

        async fn get_monthly_settlement(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
            _timezone: &str,
        ) -> Result<MonthlySettlement, CourseError> {
            unimplemented!("not used")
        }

        async fn export_monthly_settlement_csv(
            &self,
            _credentials: GatewayCredentials<'_>,
            _year_month: &str,
            _timezone: &str,
        ) -> Result<String, CourseError> {
            unimplemented!("not used")
        }

        async fn get_extension_status(
            &self,
            _credentials: GatewayCredentials<'_>,
        ) -> Result<Option<ExtensionStatus>, CourseError> {
            unimplemented!("not used")
        }

        async fn update_extension_config(
            &self,
            _credentials: GatewayCredentials<'_>,
            _input: UpdateExtensionConfig,
        ) -> Result<(), CourseError> {
            unimplemented!("not used")
        }
    }

    #[derive(Default)]
    struct FakeWatermarks {
        written: Mutex<Vec<(CourseId, InventoryWatermark)>>,
    }

    #[async_trait]
    impl GeneratedThroughGateway for FakeWatermarks {
        async fn list_watermarks(
            &self,
            _tenant_id: &str,
        ) -> Result<HashMap<CourseId, InventoryWatermark>, CourseError> {
            unimplemented!("not used")
        }

        async fn set_watermark(
            &self,
            _tenant_id: &str,
            course_id: &CourseId,
            watermark: InventoryWatermark,
        ) -> Result<(), CourseError> {
            self.written
                .lock()
                .expect("lock")
                .push((course_id.clone(), watermark));
            Ok(())
        }
    }

    #[tokio::test]
    async fn replace_schedule_uses_tenant_timezone_even_when_course_value_differs() {
        let course_id = CourseId::new("course-east");
        let catalog = Arc::new(FakeCatalog {
            tenant_timezone: "Europe/Berlin".into(),
            courses: vec![Course::reconstitute(
                course_id.clone(),
                "East",
                None,
                18,
                "America/New_York",
                8,
                true,
                None,
                None,
                None,
                None,
            )],
            resources: vec![Resource::reconstitute(
                "golf-resource-east",
                "East",
                Some("reservation-resource-east".into()),
                Some(course_id.to_string()),
                ResourceKind::Course,
                true,
            )],
            ..FakeCatalog::default()
        });
        let schedules = Arc::new(FakeSchedules::default());
        let watermarks = Arc::new(FakeWatermarks::default());
        let use_case = ReplaceCourseScheduleUseCase::new(
            catalog,
            schedules.clone(),
            Arc::new(FakeCommercial {
                horizon: Some(BookingHorizon::try_days(30).expect("valid horizon")),
            }),
            watermarks.clone(),
        );

        use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "tenant-test",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                &course_id,
                vec![rule(1, "07:00", "12:00")],
            )
            .await
            .expect("replace schedule");

        assert_eq!(
            schedules.timezone_used.lock().expect("lock").as_deref(),
            Some("Europe/Berlin")
        );
    }

    #[tokio::test]
    async fn saving_a_week_builds_its_tee_times_and_records_how_far_they_reach() {
        // The operator used to have to ask for this separately, and a week
        // saved without it put nothing on sale at all.
        let course_id = CourseId::new("course-east");
        let catalog = Arc::new(FakeCatalog {
            tenant_timezone: "Asia/Tokyo".into(),
            courses: vec![Course::reconstitute(
                course_id.clone(),
                "East",
                None,
                18,
                "Asia/Tokyo",
                8,
                true,
                None,
                None,
                None,
                None,
            )],
            resources: vec![Resource::reconstitute(
                "golf-resource-east",
                "East",
                Some("reservation-resource-east".into()),
                Some(course_id.to_string()),
                ResourceKind::Course,
                true,
            )],
            ..FakeCatalog::default()
        });
        let schedules = Arc::new(FakeSchedules::default());
        let watermarks = Arc::new(FakeWatermarks::default());
        let use_case = ReplaceCourseScheduleUseCase::new(
            catalog.clone(),
            schedules.clone(),
            Arc::new(FakeCommercial {
                horizon: Some(BookingHorizon::try_days(30).expect("valid horizon")),
            }),
            watermarks.clone(),
        );

        let saved = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "tenant-test",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                &course_id,
                vec![rule(1, "07:00", "12:00")],
            )
            .await
            .expect("replace schedule");

        let built = saved.built.expect("the save built its tee times");
        assert_eq!(
            *catalog.timezone_reads.lock().expect("lock"),
            1,
            "the tenant timezone is one extension-config read, not one per user of it"
        );
        let generated = schedules.generated.lock().expect("lock").clone();
        assert_eq!(generated.len(), 1, "one build for the whole window");
        let (from, to) = generated[0];
        assert_eq!(to, built.bookable_through);
        assert_eq!((to - from).num_days(), 30, "today through today + horizon");

        // The watermark is what lets the daily top-up resume from the right day.
        let written = watermarks.written.lock().expect("lock").clone();
        assert_eq!(written.len(), 1);
        assert_eq!(written[0].0, course_id);
        assert_eq!(written[0].1.generated_through, built.bookable_through);
        assert_eq!(written[0].1.checked_on, from);
    }

    #[tokio::test]
    async fn a_week_saved_after_the_season_closed_is_stored_without_building_anything() {
        // The club sells to a date that has passed. The week is still worth
        // keeping — it is next season's — but there is no day left to build, and
        // a range ending before it starts is an error at Field, not an empty
        // result.
        let course_id = CourseId::new("course-east");
        let catalog = Arc::new(FakeCatalog {
            tenant_timezone: "Asia/Tokyo".into(),
            courses: vec![Course::reconstitute(
                course_id.clone(),
                "East",
                None,
                18,
                "Asia/Tokyo",
                8,
                true,
                None,
                None,
                None,
                None,
            )],
            resources: vec![Resource::reconstitute(
                "golf-resource-east",
                "East",
                Some("reservation-resource-east".into()),
                Some(course_id.to_string()),
                ResourceKind::Course,
                true,
            )],
            ..FakeCatalog::default()
        });
        let schedules = Arc::new(FakeSchedules::default());
        let watermarks = Arc::new(FakeWatermarks::default());
        let use_case = ReplaceCourseScheduleUseCase::new(
            catalog,
            schedules.clone(),
            Arc::new(FakeCommercial {
                horizon: Some(BookingHorizon::through(
                    NaiveDate::from_ymd_opt(2020, 11, 30).expect("valid date"),
                )),
            }),
            watermarks.clone(),
        );

        let saved = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "tenant-test",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                &course_id,
                vec![rule(1, "07:00", "12:00")],
            )
            .await
            .expect("replace schedule");

        assert_eq!(saved.rules.len(), 1, "the week is stored either way");
        assert!(
            saved.built.is_none(),
            "nothing on sale past a closed season"
        );
        assert!(schedules.generated.lock().expect("lock").is_empty());
        assert!(watermarks.written.lock().expect("lock").is_empty());
    }

    #[tokio::test]
    async fn a_horizon_that_cannot_be_read_still_stores_the_week() {
        // The horizon is now fetched up front, alongside the reads the save
        // genuinely depends on. That must not promote it into something the
        // save waits on being right — the week is the operator's work, and it
        // is stored whether or not the far edge of the book could be read.
        let course_id = CourseId::new("course-east");
        let catalog = Arc::new(FakeCatalog {
            tenant_timezone: "Asia/Tokyo".into(),
            courses: vec![Course::reconstitute(
                course_id.clone(),
                "East",
                None,
                18,
                "Asia/Tokyo",
                8,
                true,
                None,
                None,
                None,
                None,
            )],
            resources: vec![Resource::reconstitute(
                "golf-resource-east",
                "East",
                Some("reservation-resource-east".into()),
                Some(course_id.to_string()),
                ResourceKind::Course,
                true,
            )],
            ..FakeCatalog::default()
        });
        let schedules = Arc::new(FakeSchedules::default());
        let watermarks = Arc::new(FakeWatermarks::default());
        let use_case = ReplaceCourseScheduleUseCase::new(
            catalog,
            schedules.clone(),
            Arc::new(FakeCommercial { horizon: None }),
            watermarks.clone(),
        );

        let saved = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    operator_id: "tenant-test",
                    platform_id: None,
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                &course_id,
                vec![rule(1, "07:00", "12:00")],
            )
            .await
            .expect("the week stores without a horizon");

        assert_eq!(saved.rules.len(), 1);
        assert!(
            saved.built.is_none(),
            "the operator is told nothing was put on sale"
        );
        assert!(schedules.generated.lock().expect("lock").is_empty());
    }
}
