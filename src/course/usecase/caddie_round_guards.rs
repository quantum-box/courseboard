//! The checks a round placed by hand has to pass.
//!
//! Shared by naming a caddie for a group and by moving one already named
//! (ADR-0005 puts these on this side). Held in one place because the two paths
//! have to refuse the same things: the moment moving a round is looser than
//! naming one, the desk reaches the states the planner refuses to create by
//! naming somebody and then moving them.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use chrono_tz::Tz;

use crate::course::domain::{
    duty_blocks_round, shift_covers_tee_time, tenant_day_bounds, AssignmentId, Caddie,
    CaddieAssignment, CaddieAvailability, CaddieDutyAssignment, CaddieId, CaddieRoster,
    CourseError, ReservationId,
};

/// How long a round holds its caddie when the caller does not say.
pub(crate) const DEFAULT_ROUND_MINUTES: i64 = 270;

/// One group, one caddie, one start — whether it is being created or moved.
pub(crate) struct PlacedRound<'a> {
    pub caddie_id: &'a CaddieId,
    pub reservation_id: &'a ReservationId,
    pub scheduled_at: DateTime<Utc>,
    /// The club's day this round is being placed on, which is the day the
    /// other work is read for.
    pub date: NaiveDate,
    pub duration_minutes: Option<i32>,
    /// The row being moved, which must not be counted as competition for the
    /// group it already holds or the time it already occupies.
    pub moving: Option<&'a AssignmentId>,
}

/// The rounds that still mean somebody is out, inside the club's own day.
///
/// Field filters assignments on the UTC date, so the caller fetches wide; this
/// narrows the answer back to the day the desk is working.
pub(crate) fn live_rounds_on<'a>(
    assignments: &'a [CaddieAssignment],
    date: NaiveDate,
    timezone: &str,
) -> Result<Vec<&'a CaddieAssignment>, CourseError> {
    let (day_start, day_end) = tenant_day_bounds(date, date, timezone)?;
    Ok(assignments
        .iter()
        .filter(|assignment| assignment.holds_the_round())
        .filter(|assignment| {
            let at = assignment.scheduled_at();
            day_start <= at && at < day_end
        })
        .collect())
}

/// Whether this caddie can walk this group at this time, and who they are.
///
/// Returns the roster entry, because every caller needs it next: it carries
/// the rank the round is paid at.
pub(crate) fn check_round_can_be_walked<'a>(
    roster: &'a CaddieRoster,
    live: &[&CaddieAssignment],
    availabilities: &[CaddieAvailability],
    on_duty: &[CaddieDutyAssignment],
    round: &PlacedRound<'_>,
    timezone_id: Tz,
) -> Result<&'a Caddie, CourseError> {
    let caddie = roster
        .caddies()
        .iter()
        .find(|caddie| caddie.id() == round.caddie_id)
        .ok_or(CourseError::NotFound("caddie"))?;
    if !caddie.is_assignable() {
        return Err(CourseError::BadRequest(
            "this caddie is not taking rounds; set them back to active on the roster first",
        ));
    }

    // Other work only stands in the way of the hours it covers: somebody on
    // the range until noon still walks the afternoon groups. Taking them off
    // the job is the decision the desk is actually making, so it is the one
    // they make.
    let occupied = round
        .duration_minutes
        .filter(|value| *value > 0)
        .map(i64::from)
        .unwrap_or(DEFAULT_ROUND_MINUTES);
    if duty_blocks_round(
        on_duty,
        round.caddie_id.as_str(),
        round.date,
        round.scheduled_at,
        occupied,
        timezone_id,
    ) {
        return Err(CourseError::BadRequest(
            "this caddie is on other work over those hours; clear it before putting them on a round",
        ));
    }

    if !shift_covers_tee_time(
        availabilities
            .iter()
            .find(|row| row.caddie_id() == round.caddie_id)
            .map(|row| row.status()),
        Some(round.scheduled_at),
        timezone_id,
    ) {
        return Err(CourseError::BadRequest(
            "this caddie's shift for the day does not cover that tee time",
        ));
    }

    let others = || {
        live.iter()
            .filter(|assignment| Some(assignment.id()) != round.moving)
    };

    if others().any(|assignment| assignment.covers_reservation(round.reservation_id)) {
        return Err(CourseError::BadRequest(
            "this group already has a caddie; release that assignment before putting another on it",
        ));
    }

    let ends_at = round.scheduled_at + Duration::minutes(occupied);
    if others().any(|assignment| {
        assignment.caddie_id() == round.caddie_id
            && overlaps(
                round.scheduled_at,
                ends_at,
                assignment.scheduled_at(),
                assignment.scheduled_at() + Duration::minutes(assignment.occupied_minutes()),
            )
    }) {
        return Err(CourseError::BadRequest(
            "this caddie is already out on a round that overlaps that tee time",
        ));
    }

    Ok(caddie)
}

fn overlaps(
    left_start: DateTime<Utc>,
    left_end: DateTime<Utc>,
    right_start: DateTime<Utc>,
    right_end: DateTime<Utc>,
) -> bool {
    left_start < right_end && right_start < left_end
}
