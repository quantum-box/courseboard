//! Compose the start-time ledger: one column per course, one row per tee time.
//!
//! The tee sheet lists what is booked. The ledger draws the whole grid the desk
//! sells from, so an empty row is as much a part of the answer as a full one.
//! That grid comes from Field's generated inventory when it exists; when it does
//! not, it is derived, and the column says which happened rather than passing a
//! derived row off as counted stock.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;

use crate::course::domain::{
    courseboard_weekday, derive_slot_times_from_hours, derive_slot_times_from_rules,
    parse_tenant_timezone, tenant_day_bounds, Course, CourseError, CourseId, CourseOrder,
    GatewayCredentials, GolfCatalogGateway, LedgerColumn, LedgerSlot, ReservationScheduleGateway,
    Resource, ResourceId, ResourceKind, ResourceTimeSlot, SlotGridSource, SlotOverride,
    SlotOverrideGateway, SlotOverrideQuery, TeeLedger, TeeLedgerQuery, TeeSheetItem,
};

use super::get_tee_sheet::build_tee_sheet;

/// The tee times a course sells on one day, and how much is known about them.
///
/// `capacity_by_time` and `active_by_time` are empty whenever the times were
/// derived rather than generated: an empty map answers "nobody counted", which
/// a zero in it would not.
struct SlotGrid {
    times: Vec<String>,
    /// Wall clock to `(capacity, remaining groups)`.
    capacity_by_time: HashMap<String, (i32, i32)>,
    active_by_time: HashMap<String, bool>,
    source: SlotGridSource,
}

impl SlotGrid {
    /// Times only: what the two fallbacks and the bookings-only column know.
    fn times_only(times: Vec<String>, source: SlotGridSource) -> Self {
        Self {
            times,
            capacity_by_time: HashMap::new(),
            active_by_time: HashMap::new(),
            source,
        }
    }
}

/// Application service that builds the start-time ledger for a calendar day.
pub struct GetTeeLedgerUseCase {
    reservations: Arc<dyn crate::course::domain::ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    marks: Arc<dyn SlotOverrideGateway>,
}

impl GetTeeLedgerUseCase {
    pub fn new(
        reservations: Arc<dyn crate::course::domain::ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        marks: Arc<dyn SlotOverrideGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
            schedules,
            marks,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        tenant_id: &str,
        query: TeeLedgerQuery,
    ) -> Result<TeeLedger, CourseError> {
        // Reservations and courses are the board; everything else decorates it.
        // ADR-0005 put the board on several independent Field endpoints and any
        // of them can be down alone, so one failure must degrade the ledger
        // rather than black out the operator's day.
        //
        // The marks are our own table and depend on nothing fetched here, so
        // they ride along rather than costing the desk a round trip of their
        // own after everything else has landed.
        let mark_query = SlotOverrideQuery {
            date: query.date,
            course_ids: query.golf_course_ids.clone(),
        };
        let (reservations, courses, timezone, resources, products, order, marks) = tokio::join!(
            self.reservations.list_reservations(credentials),
            self.catalog.list_courses(credentials),
            self.catalog.get_tenant_timezone(credentials),
            self.catalog.list_resources(credentials),
            self.catalog.list_reservation_products(credentials),
            self.catalog.get_course_order(credentials),
            self.marks.list_slot_overrides(tenant_id, &mark_query),
        );
        let reservations = reservations?;
        let courses = courses?;
        let timezone = timezone?;

        let mut unavailable = Vec::new();
        let resources = resources.unwrap_or_else(|error| {
            tracing::warn!(%error, "tee ledger built without resources");
            unavailable.push("resources".to_string());
            Vec::new()
        });
        let products = products.unwrap_or_else(|error| {
            tracing::warn!(%error, "tee ledger built without reservation products");
            unavailable.push("reservationProducts".to_string());
            Vec::new()
        });
        // Falling back to name order is a worse board, not a broken one, so the
        // day is still drawn — but the caller is told the arrangement is not the
        // club's.
        let order = order.unwrap_or_else(|error| {
            tracing::warn!(%error, "tee ledger built without the club's column order");
            unavailable.push("courseOrder".to_string());
            CourseOrder::default()
        });

        // Built unfiltered: which courses get a column is decided once, in
        // `build_columns`, so a booking can never be dropped here and then
        // looked for there.
        let sheet = build_tee_sheet(
            query.date,
            None,
            &reservations,
            &courses,
            &resources,
            &products,
            &timezone,
        )?;
        let items = sheet.into_items();

        let marks = marks.unwrap_or_else(|error| {
            tracing::warn!(%error, "tee ledger built without slot marks");
            unavailable.push("slotOverrides".to_string());
            Vec::new()
        });

        let columns = self
            .build_columns(
                credentials,
                &query,
                &courses,
                &resources,
                items,
                marks,
                &order,
                &timezone,
                &mut unavailable,
            )
            .await?;

        Ok(TeeLedger::new(query.date, timezone, columns, unavailable))
    }

    #[allow(clippy::too_many_arguments)]
    async fn build_columns(
        &self,
        credentials: GatewayCredentials<'_>,
        query: &TeeLedgerQuery,
        courses: &[Course],
        resources: &[Resource],
        items: Vec<TeeSheetItem>,
        marks: Vec<SlotOverride>,
        order: &CourseOrder,
        timezone: &str,
        unavailable: &mut Vec<String>,
    ) -> Result<Vec<LedgerColumn>, CourseError> {
        let timezone_id = parse_tenant_timezone(timezone)?;
        let (window_start, window_end) = tenant_day_bounds(query.date, query.date, timezone)?;
        let mut items_by_course = group_items_by_course(items);
        let marks_by_course = group_marks_by_course(marks);

        let drawn: Vec<&Course> = courses
            .iter()
            .filter(|course| course.is_active())
            .filter(|course| query.includes(course.id()))
            .collect();

        // Each course's grid is its own round trip to Field, and none of them
        // reads any other's answer. Run one after another, a four-course club
        // waited four times over before a single row was drawn.
        let grids = futures::future::join_all(drawn.iter().map(|course| {
            let resource_id = resolve_resource(resources, course.id());
            async move {
                let (grid, missing) = self
                    .resolve_grid(
                        credentials,
                        course,
                        resource_id.as_ref(),
                        window_start,
                        window_end,
                        timezone_id,
                    )
                    .await;
                (resource_id, grid, missing)
            }
        }))
        .await;

        let mut columns = Vec::new();
        for (course, (resource_id, grid, missing)) in drawn.into_iter().zip(grids) {
            // Collected after the fan-out rather than inside it: what is
            // reported is one line per degraded source, not one per course.
            for source in missing {
                push_once(unavailable, source);
            }

            let course_items = items_by_course.remove(course.id()).unwrap_or_default();
            let course_marks = marks_by_course.get(course.id());

            columns.push(build_column(
                course.id().clone(),
                course.name(),
                resource_id,
                Some(course.start_interval_minutes().get()),
                grid,
                course_items,
                course_marks,
            ));
        }

        // A booking whose course was deleted, filtered out, or never resolved
        // still has people standing on a tee. Dropping it would make the day
        // look lighter than it is, so it gets a column of its own built from
        // the tee times it occupies.
        for (course_id, course_items) in items_by_course {
            if !query.includes(&course_id) {
                continue;
            }
            let name = course_items
                .first()
                .map(|item| item.course_name().to_string())
                .unwrap_or_else(|| course_id.to_string());
            let times = booked_times(&course_items);
            columns.push(build_column(
                course_id.clone(),
                &name,
                None,
                // No course record, so no interval to report. A default here
                // would draw a tee ruler for a cadence nobody set.
                None,
                SlotGrid::times_only(times, SlotGridSource::BookingsOnly),
                course_items,
                marks_by_course.get(&course_id),
            ));
        }

        // The club's arrangement first; anything nobody placed falls in behind
        // it by name, so a course created today still reaches the board.
        order.arrange(&mut columns, LedgerColumn::course_id, |left, right| {
            left.course_name().cmp(right.course_name())
        });
        Ok(columns)
    }

    /// The tee times this course sells today, and how much is known about them.
    ///
    /// Generated inventory first: it is the only source that knows how many
    /// groups are left. The two fallbacks say when a group *could* start, which
    /// is still a usable board and is far better than an empty one.
    ///
    /// Returns the sources that were unreachable alongside the grid rather than
    /// writing them anywhere: the courses resolve concurrently, and a shared
    /// list would have to be locked to be written from all of them.
    async fn resolve_grid(
        &self,
        credentials: GatewayCredentials<'_>,
        course: &Course,
        resource_id: Option<&ResourceId>,
        window_start: DateTime<Utc>,
        window_end: DateTime<Utc>,
        timezone: Tz,
    ) -> (SlotGrid, Vec<&'static str>) {
        let mut missing = Vec::new();
        if let Some(resource_id) = resource_id {
            match self
                .schedules
                .list_resource_time_slots(credentials, resource_id, window_start, window_end)
                .await
            {
                Ok(slots) if !slots.is_empty() => {
                    return (summarize_inventory(&slots, timezone), missing);
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(%error, course = %course.id(), "tee ledger fell back from inventory");
                    missing.push("timeSlots");
                }
            }

            match self
                .schedules
                .get_resource_schedule(credentials, resource_id)
                .await
            {
                Ok(rules) => {
                    let weekday = courseboard_weekday_of(window_start, timezone);
                    let times = derive_slot_times_from_rules(&rules, weekday);
                    if !times.is_empty() {
                        return (
                            SlotGrid::times_only(times, SlotGridSource::Schedule),
                            missing,
                        );
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, course = %course.id(), "tee ledger fell back from schedule");
                    missing.push("courseSchedule");
                }
            }
        }

        let times = derive_slot_times_from_hours(
            course.business_hours_open(),
            course.business_hours_close(),
            course.start_interval_minutes().get(),
        );
        let source = if times.is_empty() {
            SlotGridSource::BookingsOnly
        } else {
            SlotGridSource::OpeningHours
        };
        (SlotGrid::times_only(times, source), missing)
    }
}

/// Capacity and remaining groups per wall-clock time, from generated inventory.
///
/// Field can generate more than one row for the same minute when a course runs
/// parallel tees off one resource; those are one ledger row, so their capacities
/// add up rather than the last one winning.
fn summarize_inventory(slots: &[ResourceTimeSlot], timezone: Tz) -> SlotGrid {
    let mut capacity: HashMap<String, (i32, i32)> = HashMap::new();
    let mut active: HashMap<String, bool> = HashMap::new();
    let mut times = Vec::new();
    for slot in slots {
        let clock = slot
            .starts_at()
            .with_timezone(&timezone)
            .format("%H:%M")
            .to_string();
        let entry = capacity.entry(clock.clone()).or_insert((0, 0));
        entry.0 += slot.capacity();
        entry.1 += slot.available_quantity();
        // A minute counts as live when any row on it is live: one retired row
        // beside a live one does not stop the course selling that time.
        let live = active.entry(clock.clone()).or_insert(false);
        *live = *live || slot.is_active();
        times.push(clock);
    }
    times.sort();
    times.dedup();
    SlotGrid {
        times,
        capacity_by_time: capacity,
        active_by_time: active,
        source: SlotGridSource::Inventory,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_column(
    course_id: CourseId,
    course_name: &str,
    resource_id: Option<ResourceId>,
    start_interval_minutes: Option<i32>,
    grid: SlotGrid,
    items: Vec<TeeSheetItem>,
    marks: Option<&HashMap<String, SlotOverride>>,
) -> LedgerColumn {
    let SlotGrid {
        times,
        capacity_by_time,
        active_by_time,
        source,
    } = grid;
    let mut items_by_time = group_items_by_time(items);

    // A booking can sit on a minute the grid does not have — the schedule
    // changed after it was taken, or the desk moved it by hand. Its row is added
    // rather than the booking dropped: a group nobody can see is a group nobody
    // starts.
    let mut all_times = times;
    for time in items_by_time.keys() {
        if !all_times.contains(time) {
            all_times.push(time.clone());
        }
    }
    all_times.sort();
    all_times.dedup();

    let slots = all_times
        .into_iter()
        .map(|time| {
            let (capacity, available) = capacity_by_time
                .get(&time)
                .map(|(capacity, available)| (Some(*capacity), Some(*available)))
                .unwrap_or((None, None));
            let slot_items = items_by_time.remove(&time).unwrap_or_default();
            LedgerSlot::new(
                time.clone(),
                capacity,
                available,
                active_by_time.get(&time).copied().unwrap_or(true),
                marks.and_then(|marks| marks.get(&time)).cloned(),
                slot_items,
            )
        })
        .collect();

    LedgerColumn::new(
        course_id,
        course_name,
        resource_id,
        start_interval_minutes.filter(|value| *value > 0),
        source,
        slots,
    )
}

/// The reservation resource a course's inventory is generated onto.
fn resolve_resource(resources: &[Resource], course_id: &CourseId) -> Option<ResourceId> {
    resources
        .iter()
        .filter(|resource| resource.is_active())
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .find(|resource| resource.golf_course_id() == Some(course_id))
        .map(|resource| {
            resource
                .reservation_resource_id()
                .cloned()
                .unwrap_or_else(|| resource.id().clone())
        })
}

fn group_items_by_course(items: Vec<TeeSheetItem>) -> HashMap<CourseId, Vec<TeeSheetItem>> {
    let mut grouped: HashMap<CourseId, Vec<TeeSheetItem>> = HashMap::new();
    for item in items {
        grouped
            .entry(item.golf_course_id().clone())
            .or_default()
            .push(item);
    }
    grouped
}

fn group_marks_by_course(
    marks: Vec<SlotOverride>,
) -> HashMap<CourseId, HashMap<String, SlotOverride>> {
    let mut grouped: HashMap<CourseId, HashMap<String, SlotOverride>> = HashMap::new();
    for mark in marks {
        grouped
            .entry(mark.course_id().clone())
            .or_default()
            .insert(mark.tee_time().to_string(), mark);
    }
    grouped
}

fn group_items_by_time(items: Vec<TeeSheetItem>) -> HashMap<String, Vec<TeeSheetItem>> {
    let mut grouped: HashMap<String, Vec<TeeSheetItem>> = HashMap::new();
    for item in items {
        grouped
            .entry(wall_clock(item.tee_time()))
            .or_default()
            .push(item);
    }
    grouped
}

fn booked_times(items: &[TeeSheetItem]) -> Vec<String> {
    let mut times: Vec<String> = items
        .iter()
        .map(|item| wall_clock(item.tee_time()))
        .collect();
    times.sort();
    times.dedup();
    times
}

/// `HH:MM` out of the tee sheet's `YYYY-MM-DDTHH:MM:SS+09:00`.
///
/// The offset is already the course's, so the digits can be read directly
/// rather than parsed and converted back into the same zone.
fn wall_clock(tee_time: &str) -> String {
    tee_time
        .split('T')
        .nth(1)
        .map(|time| time.chars().take(5).collect())
        .unwrap_or_else(|| tee_time.chars().take(5).collect())
}

fn courseboard_weekday_of(window_start: DateTime<Utc>, timezone: Tz) -> u8 {
    courseboard_weekday(window_start.with_timezone(&timezone).date_naive())
}

fn push_once(unavailable: &mut Vec<String>, value: &str) {
    if !unavailable.iter().any(|entry| entry == value) {
        unavailable.push(value.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{PlayType, TeeSheetStatus};
    use chrono::{Duration, NaiveDate};

    fn item(course: &str, tee_time: &str, party_size: i32) -> TeeSheetItem {
        TeeSheetItem::new(
            format!("res-{course}-{tee_time}"),
            "R-1",
            None,
            None,
            course,
            "空沼IN",
            Vec::new(),
            format!("2026-07-20T{tee_time}:00+09:00"),
            270,
            PlayType::Caddie,
            party_size,
            "本田会",
            TeeSheetStatus::Confirmed,
            18,
            None,
        )
    }

    fn slot(starts_at: &str, capacity: i32, available: i32, active: bool) -> ResourceTimeSlot {
        let starts_at: DateTime<Utc> = starts_at.parse().unwrap();
        ResourceTimeSlot::reconstitute(
            format!("slot-{starts_at}"),
            starts_at,
            starts_at + Duration::minutes(7),
            capacity,
            capacity - available,
            0,
            available,
            active,
        )
    }

    #[test]
    fn a_tenant_day_runs_from_local_midnight_to_the_next_one() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        let (start, end) = tenant_day_bounds(date, date, "Asia/Tokyo").unwrap();
        assert_eq!(start.to_rfc3339(), "2026-07-19T15:00:00+00:00");
        assert_eq!(end.to_rfc3339(), "2026-07-20T15:00:00+00:00");
    }

    #[test]
    fn inventory_is_read_in_the_courses_own_clock_not_in_utc() {
        let grid = summarize_inventory(
            &[slot("2026-07-19T21:53:00Z", 3, 2, true)],
            chrono_tz::Asia::Tokyo,
        );
        assert_eq!(grid.times, vec!["06:53"]);
        assert_eq!(grid.capacity_by_time.get("06:53"), Some(&(3, 2)));
        assert_eq!(grid.active_by_time.get("06:53"), Some(&true));
        assert_eq!(grid.source, SlotGridSource::Inventory);
    }

    #[test]
    fn parallel_rows_on_one_minute_add_up_instead_of_the_last_one_winning() {
        // A course running two tees off one resource generates two rows for the
        // same start. Keeping only one would halve the capacity the desk sees.
        let grid = summarize_inventory(
            &[
                slot("2026-07-19T22:00:00Z", 2, 1, true),
                slot("2026-07-19T22:00:00Z", 2, 2, true),
            ],
            chrono_tz::Asia::Tokyo,
        );
        assert_eq!(grid.times, vec!["07:00"]);
        assert_eq!(grid.capacity_by_time.get("07:00"), Some(&(4, 3)));
    }

    #[test]
    fn a_minute_stays_live_when_any_row_on_it_is_live() {
        let grid = summarize_inventory(
            &[
                slot("2026-07-19T22:00:00Z", 2, 1, false),
                slot("2026-07-19T22:00:00Z", 2, 2, true),
            ],
            chrono_tz::Asia::Tokyo,
        );
        assert_eq!(grid.active_by_time.get("07:00"), Some(&true));
    }

    #[test]
    fn a_minute_with_only_retired_rows_is_not_live() {
        let grid = summarize_inventory(
            &[slot("2026-07-19T22:00:00Z", 2, 2, false)],
            chrono_tz::Asia::Tokyo,
        );
        assert_eq!(grid.active_by_time.get("07:00"), Some(&false));
    }

    #[test]
    fn the_tee_sheets_offset_timestamp_reads_straight_off_as_wall_clock() {
        assert_eq!(wall_clock("2026-07-20T06:53:00+09:00"), "06:53");
    }

    #[test]
    fn a_booking_on_a_minute_the_grid_lacks_gets_its_own_row() {
        // The schedule changed after the booking was taken, or the desk moved it
        // by hand. A group that is not drawn is a group nobody starts.
        let column = build_column(
            CourseId::new("course-1"),
            "空沼IN",
            None,
            Some(7),
            SlotGrid::times_only(
                vec!["07:00".to_string(), "07:07".to_string()],
                SlotGridSource::Inventory,
            ),
            vec![item("course-1", "07:03", 4)],
            None,
        );
        let times: Vec<&str> = column.slots().iter().map(LedgerSlot::tee_time).collect();
        assert_eq!(times, vec!["07:00", "07:03", "07:07"]);
        assert_eq!(column.group_count(), 1);
        assert_eq!(column.player_count(), 4);
    }

    #[test]
    fn every_grid_row_is_drawn_even_when_nothing_is_booked_into_it() {
        // This is the whole point of the ledger: an empty row is the answer to
        // "what is still open at 07:07".
        let column = build_column(
            CourseId::new("course-1"),
            "空沼IN",
            None,
            Some(7),
            SlotGrid {
                times: vec!["07:00".into(), "07:07".into(), "07:14".into()],
                capacity_by_time: HashMap::from([("07:00".to_string(), (3, 2))]),
                active_by_time: HashMap::new(),
                source: SlotGridSource::Inventory,
            },
            vec![item("course-1", "07:00", 4)],
            None,
        );
        assert_eq!(column.slots().len(), 3);
        assert_eq!(column.slots()[0].capacity(), Some(3));
        assert_eq!(column.slots()[0].available_groups(), Some(2));
        // Rows the inventory did not describe carry no capacity rather than a
        // zero that would read as "full".
        assert_eq!(column.slots()[1].capacity(), None);
        assert!(column.slots()[1].is_sellable());
    }
}
