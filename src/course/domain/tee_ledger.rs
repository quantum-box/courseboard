//! The start-time ledger: one column per course, one row per tee time.
//!
//! The tee sheet answers "what is booked today". The ledger answers the
//! question a start desk actually asks — "what is still open at 07:14" — and
//! those are not the same board. A row exists here whether or not anything is
//! booked into it, because an empty row *is* the answer.
//!
//! Rows come from Field's generated tee-time inventory when it exists. When it
//! does not, they are derived from the weekly schedule, and failing that from
//! the course's opening hours and start interval. Which of the three was used
//! is reported rather than hidden: a derived row knows no capacity, and calling
//! that "open" would be a guess presented as inventory.

use chrono::{DateTime, NaiveDate, Utc};
use derive_getters::Getters;

use super::{AvailabilityRule, CourseId, ResourceId, SlotOverride, TeeSheetItem};

/// Where a column's rows came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotGridSource {
    /// Field's generated inventory. Capacity and remaining groups are real.
    Inventory,
    /// The course's weekly opening schedule. Capacity is the rule's, but
    /// nothing has been generated, so remaining groups are unknown.
    Schedule,
    /// Opening hours and the start interval. Nothing but the times is known.
    OpeningHours,
    /// Only the booked tee times. Empty rows cannot be drawn at all.
    BookingsOnly,
}

impl SlotGridSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inventory => "inventory",
            Self::Schedule => "schedule",
            Self::OpeningHours => "opening_hours",
            Self::BookingsOnly => "bookings_only",
        }
    }

    /// Whether the remaining-group counts on this column's rows mean anything.
    pub fn has_real_capacity(self) -> bool {
        matches!(self, Self::Inventory)
    }
}

/// One generated tee-time row as Field holds it.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct ResourceTimeSlot {
    #[getter(skip)]
    id: String,
    #[getter(copy)]
    starts_at: DateTime<Utc>,
    #[getter(copy)]
    ends_at: DateTime<Utc>,
    /// Groups, never players — Field states the same contract on its side.
    capacity: i32,
    reserved_quantity: i32,
    held_quantity: i32,
    available_quantity: i32,
    #[getter(rename = "is_active")]
    active: bool,
}

impl ResourceTimeSlot {
    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<String>,
        starts_at: DateTime<Utc>,
        ends_at: DateTime<Utc>,
        capacity: i32,
        reserved_quantity: i32,
        held_quantity: i32,
        available_quantity: i32,
        active: bool,
    ) -> Self {
        Self {
            id: id.into(),
            starts_at,
            ends_at,
            capacity,
            reserved_quantity,
            held_quantity,
            available_quantity,
            active,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

/// How many groups a row can still take, from the two views of it that exist.
///
/// The upstream counts what it was told about; the board counts the bookings
/// standing on the row. They disagree — observed on production Field, a row
/// carrying a confirmed booking still reported `reservedQuantity: 0` and its
/// full capacity as available (PLT-3233).
///
/// The smaller of the two wins, so the answer is right whichever way the
/// upstream behaves: if it does decrement, its number already accounts for
/// bookings this board cannot see (held, or on another course sharing the
/// resource) and stays the smaller one; if it does not, `capacity - booked`
/// is. Erring small can only ever refuse a sale the desk could have made,
/// which the desk can see and override — the other direction sells one tee
/// time twice.
pub(crate) fn reconcile_remaining(
    capacity: Option<i32>,
    upstream_remaining: Option<i32>,
    booked_groups: i32,
) -> Option<i32> {
    let from_board = capacity.map(|capacity| (capacity - booked_groups).max(0));
    match (upstream_remaining, from_board) {
        (Some(upstream), Some(board)) => Some(upstream.min(board)),
        (Some(upstream), None) => Some(upstream.max(0)),
        (None, board) => board,
    }
}

/// One row of the ledger: a tee time on one course.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct LedgerSlot {
    /// Local wall clock `HH:MM`.
    #[getter(skip)]
    tee_time: String,
    /// Groups the course may send out at this time, or `None` when the row was
    /// derived rather than generated.
    #[getter(copy)]
    capacity: Option<i32>,
    /// Groups still sellable, or `None` when capacity is unknown.
    #[getter(copy)]
    available_groups: Option<i32>,
    /// Whether Field still counts this row as sellable inventory.
    #[getter(rename = "is_active")]
    active: bool,
    #[getter(skip)]
    mark: Option<SlotOverride>,
    #[getter(skip)]
    items: Vec<TeeSheetItem>,
}

impl LedgerSlot {
    pub fn new(
        tee_time: impl Into<String>,
        capacity: Option<i32>,
        available_groups: Option<i32>,
        active: bool,
        mark: Option<SlotOverride>,
        items: Vec<TeeSheetItem>,
    ) -> Self {
        let items_on_row = items.len() as i32;
        Self {
            tee_time: tee_time.into(),
            capacity,
            available_groups: reconcile_remaining(capacity, available_groups, items_on_row),
            active,
            mark,
            items,
        }
    }

    pub fn tee_time(&self) -> &str {
        &self.tee_time
    }

    pub fn mark(&self) -> Option<&SlotOverride> {
        self.mark.as_ref()
    }

    pub fn items(&self) -> &[TeeSheetItem] {
        &self.items
    }

    /// Groups standing on this row.
    ///
    /// Counted from the bookings actually placed here rather than taken from
    /// Field's `reservedQuantity`: the two disagree whenever a booking is held
    /// but not confirmed, and the ledger draws what it can show.
    pub fn booked_groups(&self) -> i32 {
        self.items.len() as i32
    }

    pub fn player_count(&self) -> i32 {
        self.items.iter().map(TeeSheetItem::party_size).sum()
    }

    /// Sellable to a walk-in right now.
    ///
    /// A closed mark wins over remaining capacity: the desk said no, and the
    /// generated inventory has no way to know that.
    pub fn is_sellable(&self) -> bool {
        if !self.active {
            return false;
        }
        if self.mark.as_ref().is_some_and(SlotOverride::is_closed) {
            return false;
        }
        match self.available_groups {
            Some(remaining) => remaining > 0,
            // Derived rows know no capacity. Treating them as full would hide
            // every open tee time on a course that never generated inventory.
            None => self.items.is_empty(),
        }
    }
}

/// One course's column: its rows and the day's totals for it.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct LedgerColumn {
    #[getter(skip)]
    course_id: CourseId,
    #[getter(skip)]
    course_name: String,
    #[getter(skip)]
    resource_id: Option<ResourceId>,
    #[getter(copy)]
    start_interval_minutes: Option<i32>,
    #[getter(copy)]
    grid_source: SlotGridSource,
    #[getter(skip)]
    slots: Vec<LedgerSlot>,
}

impl LedgerColumn {
    pub fn new(
        course_id: CourseId,
        course_name: impl Into<String>,
        resource_id: Option<ResourceId>,
        start_interval_minutes: Option<i32>,
        grid_source: SlotGridSource,
        mut slots: Vec<LedgerSlot>,
    ) -> Self {
        slots.sort_by(|left, right| left.tee_time().cmp(right.tee_time()));
        Self {
            course_id,
            course_name: course_name.into(),
            resource_id,
            start_interval_minutes,
            grid_source,
            slots,
        }
    }

    pub fn course_id(&self) -> &CourseId {
        &self.course_id
    }

    pub fn course_name(&self) -> &str {
        &self.course_name
    }

    pub fn resource_id(&self) -> Option<&ResourceId> {
        self.resource_id.as_ref()
    }

    pub fn slots(&self) -> &[LedgerSlot] {
        &self.slots
    }

    pub fn group_count(&self) -> i32 {
        self.slots.iter().map(LedgerSlot::booked_groups).sum()
    }

    pub fn player_count(&self) -> i32 {
        self.slots.iter().map(LedgerSlot::player_count).sum()
    }

    /// Groups playing without a caddie, which the column header carries next to
    /// the group total the same way the paper ledger does.
    pub fn self_group_count(&self) -> i32 {
        self.slots
            .iter()
            .flat_map(LedgerSlot::items)
            .filter(|item| !item.requires_caddie())
            .count() as i32
    }

    pub fn caddie_group_count(&self) -> i32 {
        self.group_count() - self.self_group_count()
    }

    pub fn open_slot_count(&self) -> i32 {
        self.slots.iter().filter(|slot| slot.is_sellable()).count() as i32
    }
}

/// The whole day, one column per course.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct TeeLedger {
    #[getter(copy)]
    date: NaiveDate,
    #[getter(skip)]
    timezone: String,
    #[getter(skip)]
    columns: Vec<LedgerColumn>,
    /// Lookups that failed. The board is still drawn; the caller has to say so
    /// rather than present a partial day as the whole day.
    #[getter(skip)]
    unavailable: Vec<String>,
}

impl TeeLedger {
    pub fn new(
        date: NaiveDate,
        timezone: impl Into<String>,
        columns: Vec<LedgerColumn>,
        unavailable: Vec<String>,
    ) -> Self {
        Self {
            date,
            timezone: timezone.into(),
            columns,
            unavailable,
        }
    }

    pub fn timezone(&self) -> &str {
        &self.timezone
    }

    pub fn columns(&self) -> &[LedgerColumn] {
        &self.columns
    }

    pub fn unavailable(&self) -> &[String] {
        &self.unavailable
    }
}

/// Which day of the week `date` is, counted the way CourseBoard counts.
pub fn courseboard_weekday(date: NaiveDate) -> u8 {
    use chrono::Datelike;
    date.weekday().num_days_from_sunday() as u8
}

/// Tee times a weekly schedule would put on this weekday.
///
/// Two bands on the same weekday are already rejected when a schedule is
/// saved, but a schedule written before that check could still overlap, so
/// duplicates are dropped here rather than drawn twice.
pub fn derive_slot_times_from_rules(rules: &[AvailabilityRule], weekday: u8) -> Vec<String> {
    let mut times: Vec<String> = Vec::new();
    for rule in rules.iter().filter(|rule| rule.weekday() == weekday) {
        let Some(start) = clock_minutes(rule.start_time()) else {
            continue;
        };
        let Some(end) = clock_minutes(rule.end_time()) else {
            continue;
        };
        let interval = rule.slot_interval_minutes();
        if interval <= 0 {
            continue;
        }
        let mut cursor = start;
        while cursor < end {
            times.push(minutes_to_clock(cursor));
            cursor += interval;
        }
    }
    times.sort();
    times.dedup();
    times
}

/// Tee times the opening hours and start interval imply.
///
/// The last resort: it says when the course could start groups, not how many.
pub fn derive_slot_times_from_hours(
    open: Option<&str>,
    close: Option<&str>,
    interval_minutes: i32,
) -> Vec<String> {
    let (Some(start), Some(end)) = (open.and_then(clock_minutes), close.and_then(clock_minutes))
    else {
        return Vec::new();
    };
    if interval_minutes <= 0 || start >= end {
        return Vec::new();
    }
    let mut times = Vec::new();
    let mut cursor = start;
    while cursor < end {
        times.push(minutes_to_clock(cursor));
        cursor += interval_minutes;
    }
    times
}

fn clock_minutes(value: &str) -> Option<i32> {
    let head: String = value.trim().chars().take(5).collect();
    if head.len() != 5 || head.as_bytes()[2] != b':' {
        return None;
    }
    let hour: i32 = head[..2].parse().ok()?;
    let minute: i32 = head[3..].parse().ok()?;
    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) {
        return None;
    }
    Some(hour * 60 + minute)
}

fn minutes_to_clock(total: i32) -> String {
    format!("{:02}:{:02}", total / 60, total % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{PlayType, TeeSheetStatus};

    fn rule(weekday: u8, start: &str, end: &str, capacity: i32, interval: i32) -> AvailabilityRule {
        AvailabilityRule::try_new(None, weekday, start, end, capacity, interval).unwrap()
    }

    fn item(tee_time: &str, party_size: i32, play_type: PlayType) -> TeeSheetItem {
        TeeSheetItem::new(
            format!("res-{tee_time}-{party_size}"),
            "R-1",
            None,
            None,
            "course-1",
            "空沼",
            Vec::new(),
            format!("2026-07-20T{tee_time}:00+09:00"),
            270,
            play_type,
            party_size,
            "本田会",
            TeeSheetStatus::Confirmed,
            18,
            None,
        )
    }

    fn slot(tee_time: &str, capacity: Option<i32>, available: Option<i32>) -> LedgerSlot {
        LedgerSlot::new(tee_time, capacity, available, true, None, Vec::new())
    }

    #[test]
    fn a_seven_minute_band_lays_out_the_same_rows_the_paper_ledger_has() {
        let times = derive_slot_times_from_rules(&[rule(1, "06:53", "07:15", 3, 7)], 1);
        assert_eq!(times, vec!["06:53", "07:00", "07:07", "07:14"]);
    }

    #[test]
    fn the_closing_time_is_not_itself_a_start() {
        // A band that ends at 07:14 sells 07:07 last; starting a group at the
        // moment the band closes would put it outside the band.
        let times = derive_slot_times_from_rules(&[rule(1, "07:00", "07:14", 3, 7)], 1);
        assert_eq!(times, vec!["07:00", "07:07"]);
    }

    #[test]
    fn only_the_requested_weekday_contributes_rows() {
        let rules = [
            rule(1, "07:00", "07:15", 3, 7),
            rule(2, "08:00", "08:15", 3, 7),
        ];
        assert_eq!(
            derive_slot_times_from_rules(&rules, 2),
            vec!["08:00", "08:07", "08:14"]
        );
    }

    #[test]
    fn two_bands_that_overlap_do_not_draw_the_same_row_twice() {
        // Overlaps are rejected on save, but a schedule written before that
        // check exists would otherwise put 07:07 on the board twice.
        let rules = [
            rule(1, "07:00", "07:15", 3, 7),
            rule(1, "07:07", "07:21", 3, 7),
        ];
        assert_eq!(
            derive_slot_times_from_rules(&rules, 1),
            vec!["07:00", "07:07", "07:14"]
        );
    }

    #[test]
    fn opening_hours_are_the_last_resort_and_stop_at_the_close() {
        assert_eq!(
            derive_slot_times_from_hours(Some("06:00"), Some("06:30"), 10),
            vec!["06:00", "06:10", "06:20"]
        );
    }

    #[test]
    fn a_course_with_no_usable_hours_draws_no_rows_rather_than_a_default_day() {
        assert!(derive_slot_times_from_hours(None, Some("18:00"), 8).is_empty());
        assert!(derive_slot_times_from_hours(Some("18:00"), Some("06:00"), 8).is_empty());
        assert!(derive_slot_times_from_hours(Some("06:00"), Some("18:00"), 0).is_empty());
    }

    #[test]
    fn weekdays_are_counted_from_sunday_the_way_the_schedule_editor_counts() {
        // 2026-07-20 is a Monday.
        assert_eq!(
            courseboard_weekday(NaiveDate::from_ymd_opt(2026, 7, 20).unwrap()),
            1
        );
        assert_eq!(
            courseboard_weekday(NaiveDate::from_ymd_opt(2026, 7, 19).unwrap()),
            0
        );
    }

    #[test]
    fn a_row_with_capacity_left_is_sellable_and_a_full_one_is_not() {
        assert!(slot("07:00", Some(3), Some(1)).is_sellable());
        assert!(!slot("07:00", Some(3), Some(0)).is_sellable());
    }

    #[test]
    fn a_derived_row_is_sellable_while_nothing_stands_on_it() {
        // Derived rows carry no capacity. Calling them full would hide every
        // open tee time on a course that has never generated inventory.
        assert!(slot("07:00", None, None).is_sellable());
        let taken = LedgerSlot::new(
            "07:00",
            None,
            None,
            true,
            None,
            vec![item("07:00", 4, PlayType::Caddie)],
        );
        assert!(!taken.is_sellable());
    }

    #[test]
    fn a_closed_mark_beats_remaining_capacity() {
        let mark = SlotOverride::try_new(
            CourseId::new("course-1"),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
            "07:00",
            crate::course::domain::SlotOverrideKind::Closed,
            None,
            None,
        )
        .unwrap();
        let closed = LedgerSlot::new("07:00", Some(3), Some(3), true, Some(mark), Vec::new());
        assert!(!closed.is_sellable());
    }

    #[test]
    fn a_special_rate_mark_still_sells() {
        let mark = SlotOverride::try_new(
            CourseId::new("course-1"),
            NaiveDate::from_ymd_opt(2026, 7, 20).unwrap(),
            "07:00",
            crate::course::domain::SlotOverrideKind::SpecialRate,
            Some("特別料金".into()),
            None,
        )
        .unwrap();
        let marked = LedgerSlot::new("07:00", Some(3), Some(3), true, Some(mark), Vec::new());
        assert!(marked.is_sellable());
    }

    #[test]
    fn inventory_field_retired_is_not_sellable_however_empty_it_looks() {
        let retired = LedgerSlot::new("07:00", Some(3), Some(3), false, None, Vec::new());
        assert!(!retired.is_sellable());
    }

    #[test]
    fn a_column_totals_groups_and_players_the_way_the_header_reads() {
        let column = LedgerColumn::new(
            CourseId::new("course-1"),
            "空沼IN",
            None,
            Some(7),
            SlotGridSource::Inventory,
            vec![
                LedgerSlot::new(
                    "07:00",
                    Some(3),
                    Some(1),
                    true,
                    None,
                    vec![
                        item("07:00", 4, PlayType::Caddie),
                        item("07:00", 3, PlayType::SelfPlay),
                    ],
                ),
                LedgerSlot::new(
                    "07:07",
                    Some(3),
                    Some(2),
                    true,
                    None,
                    vec![item("07:07", 2, PlayType::SelfPlay)],
                ),
                slot("07:14", Some(3), Some(3)),
            ],
        );
        assert_eq!(column.group_count(), 3);
        assert_eq!(column.player_count(), 9);
        assert_eq!(column.self_group_count(), 2);
        assert_eq!(column.caddie_group_count(), 1);
        assert_eq!(column.open_slot_count(), 3);
    }

    #[test]
    fn rows_are_ordered_by_the_clock_whatever_order_they_arrive_in() {
        let column = LedgerColumn::new(
            CourseId::new("course-1"),
            "空沼IN",
            None,
            Some(7),
            SlotGridSource::Inventory,
            vec![slot("07:14", None, None), slot("06:53", None, None)],
        );
        let times: Vec<&str> = column.slots().iter().map(LedgerSlot::tee_time).collect();
        assert_eq!(times, vec!["06:53", "07:14"]);
    }

    #[test]
    fn only_generated_inventory_claims_to_know_how_many_groups_are_left() {
        assert!(SlotGridSource::Inventory.has_real_capacity());
        assert!(!SlotGridSource::Schedule.has_real_capacity());
        assert!(!SlotGridSource::OpeningHours.has_real_capacity());
        assert!(!SlotGridSource::BookingsOnly.has_real_capacity());
    }

    #[test]
    fn a_row_carrying_a_booking_is_not_sold_twice() {
        // Production Field reports `reservedQuantity: 0` and the full capacity
        // as available on a row that already holds a confirmed booking
        // (PLT-3233). Believing it offers the same tee time to a second group.
        let full = LedgerSlot::new(
            "07:00",
            Some(1),
            Some(1),
            true,
            None,
            vec![item("07:00", 4, PlayType::Caddie)],
        );

        assert_eq!(full.available_groups(), Some(0));
        assert!(!full.is_sellable());
    }

    #[test]
    fn the_upstream_still_wins_when_it_knows_about_more_than_the_board_does() {
        // Holds, and bookings on another course sharing the resource, are
        // invisible to this board. A capacity of 3 with one group on it would
        // read as 2 left, but the upstream says 0 — it can see them.
        let contended = LedgerSlot::new(
            "07:00",
            Some(3),
            Some(0),
            true,
            None,
            vec![item("07:00", 4, PlayType::SelfPlay)],
        );

        assert_eq!(contended.available_groups(), Some(0));
        assert!(!contended.is_sellable());
    }

    #[test]
    fn an_empty_row_keeps_the_capacity_it_was_generated_with() {
        let open = LedgerSlot::new("07:00", Some(2), Some(2), true, None, vec![]);

        assert_eq!(open.available_groups(), Some(2));
        assert!(open.is_sellable());
    }

    #[test]
    fn a_derived_row_still_admits_it_cannot_count() {
        // No capacity was ever generated, so there is no number to reconcile.
        // Inventing one here would dress a guess up as stock.
        let derived = LedgerSlot::new(
            "07:00",
            None,
            None,
            true,
            None,
            vec![item("07:00", 4, PlayType::SelfPlay)],
        );

        assert_eq!(derived.available_groups(), None);
        assert!(!derived.is_sellable());
    }
}
