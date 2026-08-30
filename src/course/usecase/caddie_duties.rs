//! The club's list of non-round caddie work, and the days caddies are put on
//! it.
//!
//! Reading and filing both sit under the dispatch permissions rather than the
//! shift ones: putting somebody on the practice range is a decision about
//! today's board, taken on the same screen and by the same people who put
//! caddies on groups. It is also why filing one takes the caddie out of the
//! day's supply — see `AssignCaddieDutyUseCase::execute`.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::actions;
use crate::course::domain::{
    parse_tenant_timezone, round_minutes, tenant_day_bounds, widen_for_utc_date_filter,
    CaddieAssignmentQuery, CaddieDutyAssignment, CaddieDutyGateway, CaddieDutyOptions, CourseError,
    GatewayCredentials, GolfOpsGateway,
};

/// The jobs a caddie can be put on, as the club arranged them.
pub struct GetCaddieDutyOptionsUseCase {
    duties: Arc<dyn CaddieDutyGateway>,
}

impl GetCaddieDutyOptionsUseCase {
    pub fn new(duties: Arc<dyn CaddieDutyGateway>) -> Self {
        Self { duties }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieDutyOptions, CourseError> {
        // The list exists to staff a day with, so the action that opens the
        // dispatch board is the one that reads it.
        credentials
            .require(actions::LIST_CADDIE_ASSIGNMENTS)
            .await?;
        self.duties.get_duty_options(credentials.operator_id).await
    }
}

/// Arranging that list.
pub struct ReplaceCaddieDutyOptionsUseCase {
    duties: Arc<dyn CaddieDutyGateway>,
}

impl ReplaceCaddieDutyOptionsUseCase {
    pub fn new(duties: Arc<dyn CaddieDutyGateway>) -> Self {
        Self { duties }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        options: CaddieDutyOptions,
    ) -> Result<CaddieDutyOptions, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_ASSIGNMENTS)
            .await?;
        self.duties
            .replace_duty_options(credentials.operator_id, &options)
            .await
    }
}

/// Which caddies are on other work, over a window of days.
pub struct ListCaddieDutyAssignmentsUseCase {
    duties: Arc<dyn CaddieDutyGateway>,
}

impl ListCaddieDutyAssignmentsUseCase {
    pub fn new(duties: Arc<dyn CaddieDutyGateway>) -> Self {
        Self { duties }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CaddieDutyAssignment>, CourseError> {
        credentials
            .require(actions::LIST_CADDIE_ASSIGNMENTS)
            .await?;
        if to < from {
            return Err(CourseError::BadRequest("the range ends before it starts"));
        }
        self.duties
            .list_duty_assignments(credentials.operator_id, from, to)
            .await
    }
}

/// Putting one caddie on other work for one stretch of one day.
pub struct AssignCaddieDutyUseCase {
    ops: Arc<dyn GolfOpsGateway>,
    duties: Arc<dyn CaddieDutyGateway>,
}

impl AssignCaddieDutyUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>, duties: Arc<dyn CaddieDutyGateway>) -> Self {
        Self { ops, duties }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        assignment: CaddieDutyAssignment,
        timezone: &str,
    ) -> Result<CaddieDutyAssignment, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_ASSIGNMENTS)
            .await?;
        let timezone_id = parse_tenant_timezone(timezone)?;
        let date = assignment.date();
        let window = assignment.window();
        let window_of = |value: &CaddieDutyAssignment| value.window();
        let caddie_id = assignment.caddie_id().clone();
        let field_window = widen_for_utc_date_filter(date, date);

        let (roster, options, rounds, filed) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.duties.get_duty_options(credentials.operator_id),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: Some(caddie_id.clone()),
                    from: Some(field_window.0),
                    to: Some(field_window.1),
                    reservation_id: None,
                },
            ),
            self.duties
                .list_duty_assignments(credentials.operator_id, date, date),
        )?;

        if !roster
            .caddies()
            .iter()
            .any(|caddie| caddie.id() == &caddie_id)
        {
            return Err(CourseError::NotFound("caddie"));
        }

        // The desk picks from the club's list. A job typed past the picker
        // would be one nothing else can group, count, or find again.
        if !options.offers(assignment.duty_label()) {
            return Err(CourseError::BadRequest(
                "that is not one of this club's duties; add it to the list first",
            ));
        }

        // Two jobs cannot claim the same minutes of one caddie's day. Re-filing
        // the same start corrects that stretch, so it is not a clash with
        // itself.
        if filed
            .iter()
            .filter(|other| other.caddie_id() == &caddie_id)
            .filter(|other| window_of(other).start_minute() != window.start_minute())
            .any(|other| window_of(other).overlaps(&window))
        {
            return Err(CourseError::BadRequest(
                "this caddie is already on other work over those hours",
            ));
        }

        // A round the caddie is out on cannot also be the yard. Only the
        // rounds the window actually reaches are in the way — the point of
        // filing hours rather than the day is that the rest of it still works.
        //
        // Field filters assignments on the UTC date, so the window was widened
        // to fetch and is narrowed back to the club's own day here.
        let (day_start, day_end) = tenant_day_bounds(date, date, timezone)?;
        if rounds
            .iter()
            .filter(|round| round.holds_the_round())
            .filter(|round| round.caddie_id() == &caddie_id)
            .filter(|round| {
                let at = round.scheduled_at();
                day_start <= at && at < day_end
            })
            .any(|round| {
                let (start, end) =
                    round_minutes(round.scheduled_at(), round.occupied_minutes(), timezone_id);
                window.overlaps_minutes(start, end)
            })
        {
            return Err(CourseError::BadRequest(
                "this caddie is out on a round over those hours; release the round first",
            ));
        }

        self.duties
            .save_duty_assignment(credentials.operator_id, &assignment)
            .await
    }
}

/// Taking one filed job back off.
pub struct ClearCaddieDutyUseCase {
    duties: Arc<dyn CaddieDutyGateway>,
}

impl ClearCaddieDutyUseCase {
    pub fn new(duties: Arc<dyn CaddieDutyGateway>) -> Self {
        Self { duties }
    }

    /// `false` when nothing was there. Not an error: the desk asked for a
    /// caddie with that job off them, and that is what they now have.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        duty_id: i64,
    ) -> Result<bool, CourseError> {
        credentials
            .require(actions::MANAGE_CADDIE_ASSIGNMENTS)
            .await?;
        self.duties
            .delete_duty_assignment(credentials.operator_id, duty_id)
            .await
    }
}

/// A duty gateway for tests in other modules: the days it is given, and
/// nothing written anywhere.
///
/// Every use case that counts a caddie's day now asks who is on other work, so
/// their tests need an answer. Most of them have nothing to say about duties
/// and pass `FakeCaddieDuties::none()`.
#[cfg(test)]
pub(crate) mod test_double {
    use std::sync::Arc;

    use async_trait::async_trait;
    use chrono::NaiveDate;

    use crate::course::domain::{
        CaddieDutyAssignment, CaddieDutyGateway, CaddieDutyOptions, CourseError,
    };

    #[derive(Default)]
    pub(crate) struct FakeCaddieDuties {
        pub(crate) options: Vec<String>,
        pub(crate) assignments: Vec<CaddieDutyAssignment>,
    }

    impl FakeCaddieDuties {
        /// Nobody on other work, and no jobs arranged.
        pub(crate) fn none() -> Arc<Self> {
            Arc::new(Self::default())
        }

        pub(crate) fn with_assignments(assignments: Vec<CaddieDutyAssignment>) -> Arc<Self> {
            Arc::new(Self {
                options: Vec::new(),
                assignments,
            })
        }
    }

    #[async_trait]
    impl CaddieDutyGateway for FakeCaddieDuties {
        async fn get_duty_options(
            &self,
            _tenant_id: &str,
        ) -> Result<CaddieDutyOptions, CourseError> {
            Ok(CaddieDutyOptions::reconstitute(self.options.clone()))
        }

        async fn replace_duty_options(
            &self,
            _tenant_id: &str,
            options: &CaddieDutyOptions,
        ) -> Result<CaddieDutyOptions, CourseError> {
            Ok(options.clone())
        }

        async fn list_duty_assignments(
            &self,
            _tenant_id: &str,
            from: NaiveDate,
            to: NaiveDate,
        ) -> Result<Vec<CaddieDutyAssignment>, CourseError> {
            Ok(self
                .assignments
                .iter()
                .filter(|assignment| from <= assignment.date() && assignment.date() <= to)
                .cloned()
                .collect())
        }

        async fn save_duty_assignment(
            &self,
            _tenant_id: &str,
            assignment: &CaddieDutyAssignment,
        ) -> Result<CaddieDutyAssignment, CourseError> {
            Ok(assignment.clone())
        }

        async fn delete_duty_assignment(
            &self,
            _tenant_id: &str,
            _duty_id: i64,
        ) -> Result<bool, CourseError> {
            Ok(true)
        }
    }
}
