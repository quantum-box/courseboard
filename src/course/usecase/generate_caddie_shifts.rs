//! GenerateCaddieShiftsUseCase: one use case, one public entrypoint (`execute`).
//!
//! Turns a month of filed shift requests into confirmed, placed shifts. The
//! requests say who would rather not work; they carry no course, and a day
//! nobody filed reads as available. That is enough to staff a morning but not
//! to sell one, because a course's caddie-attached capacity is the caddies
//! standing on *that* course. So the month is confirmed up front, from the
//! requests and the main course each caddie belongs to, and the desk edits
//! what the run could not know.
//!
//! Running the month and confirming it are two steps, because a run rewrites a
//! month of everybody's working days: the desk asks for the plan, reads it, and
//! only then writes it. [`ShiftPlanMode`] is which of the two this call is —
//! the planning is identical either way, so what the desk read is what a
//! confirmation writes.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{NaiveDate, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    plan_month_shifts, tenant_date_at, AvailabilityDeadline, AvailabilityDeadlineGateway,
    AvailabilityQuery, Caddie, CaddieAvailability, CaddieId, CaddieShift, CaddieShiftGateway,
    CourseError, CourseId, DeadlineWarning, GatewayCredentials, GolfCatalogGateway, GolfOpsGateway,
    ShiftRequest, ShiftRulesGateway, ShiftSeed, YearMonth, MAX_CONSECUTIVE_WORK_DAYS,
};

/// Whether a run is being read or being confirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShiftPlanMode {
    /// Plan the month and write nothing. The desk reads the result first.
    Preview,
    /// Plan the month and confirm it.
    Apply,
}

/// What one run over a month produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedMonth {
    year_month: YearMonth,
    days_written: u64,
    pinned_kept: usize,
    unplaced: Vec<String>,
    statutory_rest_days: usize,
    overworked: Vec<String>,
    deadline_warning: Option<DeadlineWarning>,
    shifts: Vec<CaddieShift>,
}

impl GeneratedMonth {
    pub fn year_month(&self) -> YearMonth {
        self.year_month
    }

    /// Days confirmed — or, for a preview, days a confirmation would write.
    pub fn days_written(&self) -> u64 {
        self.days_written
    }

    /// Every day the run decided, in full. A preview is read from these: the
    /// board draws them so the desk sees the month before it exists.
    pub fn shifts(&self) -> &[CaddieShift] {
        &self.shifts
    }

    /// Days left exactly as the desk had pinned them.
    pub fn pinned_kept(&self) -> usize {
        self.pinned_kept
    }

    /// Caddies confirmed to work but placed on no course, by name — they have
    /// no main course yet. The month is still written; this is what the desk
    /// has to fix before those people count towards anywhere's supply.
    pub fn unplaced(&self) -> &[String] {
        &self.unplaced
    }

    /// Days the run turned into rest days to keep nobody working more than six
    /// in a row. Nobody asked for them; the Labour Standards Act requires them.
    pub fn statutory_rest_days(&self) -> usize {
        self.statutory_rest_days
    }

    /// Caddies still working more than six days in a row after the run, by
    /// name. Only a pinned day can cause this, and the run will not overwrite
    /// one, so it is reported for the desk to unpin.
    pub fn overworked(&self) -> &[String] {
        &self.overworked
    }

    pub fn deadline_warning(&self) -> Option<&DeadlineWarning> {
        self.deadline_warning.as_ref()
    }
}

pub struct GenerateCaddieShiftsUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    ops: Arc<dyn GolfOpsGateway>,
    shifts: Arc<dyn CaddieShiftGateway>,
    deadlines: Arc<dyn AvailabilityDeadlineGateway>,
    rules: Arc<dyn ShiftRulesGateway>,
}

impl GenerateCaddieShiftsUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        ops: Arc<dyn GolfOpsGateway>,
        shifts: Arc<dyn CaddieShiftGateway>,
        deadlines: Arc<dyn AvailabilityDeadlineGateway>,
        rules: Arc<dyn ShiftRulesGateway>,
    ) -> Self {
        Self {
            catalog,
            ops,
            shifts,
            deadlines,
            rules,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: YearMonth,
        mode: ShiftPlanMode,
    ) -> Result<GeneratedMonth, CourseError> {
        credentials.require(actions::MANAGE_SHIFTS).await?;
        let timezone = self.catalog.get_tenant_timezone(credentials).await?;
        let today = tenant_date_at(Utc::now(), &timezone)?;
        let (month_start, month_end) = year_month.bounds();
        let (roster, availabilities, existing) = tokio::try_join!(
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
            // Reaching back before the 1st: a run of working days that began
            // in the previous month has to be counted, or every month would
            // start somebody's week over again.
            self.shifts.list_shifts(
                credentials.operator_id,
                month_start - chrono::Duration::days(MAX_CONSECUTIVE_WORK_DAYS),
                month_end,
            ),
        )?;

        // Which weekdays the club would rather keep clear of rest days.
        let rest_policy = self.rules.get_shift_policy(credentials.operator_id).await?;
        let main_courses = self.main_courses(credentials, roster.caddies()).await?;
        let mut requests = requests_by_caddie(&availabilities);
        let seeds: Vec<ShiftSeed> = roster
            .caddies()
            .iter()
            .map(|caddie| ShiftSeed {
                caddie_id: caddie.id().clone(),
                display_name: caddie.display_name().to_string(),
                is_assignable: caddie.is_assignable(),
                can_two_rounds: caddie.can_two_rounds(),
                max_rounds_per_day: caddie.max_rounds_per_day(),
                main_course_id: main_courses.get(caddie.id().as_str()).cloned(),
                requests: requests.remove(caddie.id().as_str()).unwrap_or_default(),
            })
            .collect();

        let plan = plan_month_shifts(
            &month_dates(month_start, month_end),
            &seeds,
            &existing,
            &rest_policy,
        );
        // A preview writes nothing, so it reports the days a confirmation of
        // this same plan would write.
        let days_written = match mode {
            ShiftPlanMode::Apply => {
                self.shifts
                    .save_shifts(credentials.operator_id, plan.shifts())
                    .await?
            }
            ShiftPlanMode::Preview => plan.shifts().len() as u64,
        };

        let deadline = self
            .deadlines
            .get_deadline(credentials.operator_id, year_month)
            .await?;

        Ok(GeneratedMonth {
            year_month,
            days_written,
            pinned_kept: plan.pinned_kept(),
            unplaced: plan.unplaced().to_vec(),
            statutory_rest_days: plan.statutory_rest_days(),
            overworked: plan.overworked().to_vec(),
            deadline_warning: unsubmitted_warning(deadline, today, &seeds, &availabilities),
            shifts: plan.into_shifts(),
        })
    }

    /// Each caddie's main course, which is where the run places them. A caddie
    /// with sub memberships only has no main course and stays unplaced: a sub
    /// membership is permission to be moved there, not a default posting.
    async fn main_courses(
        &self,
        credentials: GatewayCredentials<'_>,
        caddies: &[Caddie],
    ) -> Result<HashMap<String, CourseId>, CourseError> {
        let caddie_ids: Vec<CaddieId> = caddies.iter().map(|caddie| caddie.id().clone()).collect();
        let memberships = self
            .ops
            .list_memberships_for(credentials, &caddie_ids)
            .await?;
        Ok(memberships
            .into_iter()
            .filter_map(|(caddie_id, memberships)| {
                let main = memberships
                    .into_iter()
                    .find(|membership| membership.is_primary())?;
                Some((caddie_id, main.golf_course_id().clone()))
            })
            .collect())
    }
}

fn month_dates(start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    let mut date = start;
    while date <= end {
        dates.push(date);
        let Some(next) = date.succ_opt() else { break };
        date = next;
    }
    dates
}

fn requests_by_caddie(
    availabilities: &[CaddieAvailability],
) -> HashMap<&str, HashMap<NaiveDate, ShiftRequest>> {
    let mut requests: HashMap<&str, HashMap<NaiveDate, ShiftRequest>> = HashMap::new();
    for availability in availabilities {
        requests
            .entry(availability.caddie_id().as_str())
            .or_default()
            .insert(
                availability.date(),
                ShiftRequest {
                    status: availability.status(),
                    two_round_request: availability.two_round_request(),
                },
            );
    }
    requests
}

/// Pure decision: whether the run should warn that it confirmed days nobody
/// filed for. Only worth saying once the deadline has passed — before that,
/// a missing request is simply one that has not been filed yet.
fn unsubmitted_warning(
    deadline: Option<AvailabilityDeadline>,
    today: NaiveDate,
    seeds: &[ShiftSeed],
    availabilities: &[CaddieAvailability],
) -> Option<DeadlineWarning> {
    let deadline = deadline?;
    if !deadline.has_passed(today) {
        return None;
    }
    let submitted: HashSet<&str> = availabilities
        .iter()
        .map(|availability| availability.caddie_id().as_str())
        .collect();
    let names: Vec<String> = seeds
        .iter()
        .filter(|seed| seed.is_assignable)
        .filter(|seed| !submitted.contains(seed.caddie_id.as_str()))
        .map(|seed| seed.display_name.clone())
        .collect();
    if names.is_empty() {
        return None;
    }
    Some(DeadlineWarning::new(deadline.deadline_date(), names))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::AvailabilityStatus;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn seed(id: &str, name: &str, is_assignable: bool) -> ShiftSeed {
        ShiftSeed {
            caddie_id: CaddieId::new(id),
            display_name: name.to_string(),
            is_assignable,
            can_two_rounds: true,
            max_rounds_per_day: 2,
            main_course_id: None,
            requests: HashMap::new(),
        }
    }

    fn filed(id: &str) -> CaddieAvailability {
        CaddieAvailability::reconstitute(
            "availability-1",
            CaddieId::new(id),
            date(2026, 9, 1),
            AvailabilityStatus::Unavailable,
            false,
            None,
            None,
        )
    }

    fn deadline(passed: bool) -> Option<AvailabilityDeadline> {
        Some(AvailabilityDeadline::try_new(
            YearMonth::parse("2026-09").unwrap(),
            if passed {
                date(2026, 8, 20)
            } else {
                date(2026, 8, 31)
            },
        ))
    }

    #[test]
    fn a_month_covers_every_day_between_its_bounds() {
        let dates = month_dates(date(2026, 2, 1), date(2026, 2, 28));

        assert_eq!(dates.len(), 28);
        assert_eq!(dates[0], date(2026, 2, 1));
        assert_eq!(dates[27], date(2026, 2, 28));
    }

    #[test]
    fn nobody_is_warned_about_before_the_deadline_has_passed() {
        let warning = unsubmitted_warning(
            deadline(false),
            date(2026, 8, 25),
            &[seed("caddie-1", "山田", true)],
            &[],
        );

        assert!(warning.is_none());
    }

    #[test]
    fn a_passed_deadline_names_whoever_never_filed() {
        let warning = unsubmitted_warning(
            deadline(true),
            date(2026, 8, 25),
            &[
                seed("caddie-1", "山田", true),
                seed("caddie-2", "佐藤", true),
            ],
            &[filed("caddie-2")],
        )
        .unwrap();

        assert_eq!(warning.unsubmitted_caddie_names(), ["山田"]);
    }

    #[test]
    fn somebody_off_the_roster_is_not_chased_for_a_request() {
        let warning = unsubmitted_warning(
            deadline(true),
            date(2026, 8, 25),
            &[seed("caddie-1", "山田", false)],
            &[],
        );

        assert!(warning.is_none());
    }

    #[test]
    fn a_filed_request_is_read_against_the_day_it_was_filed_for() {
        let availabilities = [filed("caddie-1")];
        let requests = requests_by_caddie(&availabilities);

        let day = requests["caddie-1"][&date(2026, 9, 1)];
        assert_eq!(day.status, AvailabilityStatus::Unavailable);
        assert!(!day.two_round_request);
    }
}
