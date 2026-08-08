//! GetPayrollSummaryUseCase: one use case, one public entrypoint (`execute`).
//!
//! The month used to be aggregated by Field. Golf operations belong here
//! (ADR-0005), and every input is already something CourseBoard reads: the
//! roster, the month's assignments, the attendance the operator recorded, and
//! the worked minutes the staff records hold.
//!
//! Four calls, whatever the headcount — the roster is not walked one caddie at
//! a time.

use std::sync::Arc;

use crate::course::domain::{
    course_day_bounds, summarize_payroll, widen_for_utc_date_filter, AttendanceDay,
    CaddieAssignmentQuery, CourseError, GatewayCredentials, GolfOpsGateway, PayrollCandidate,
    PayrollPeriod, PayrollSummary,
};

pub struct GetPayrollSummaryUseCase {
    ops: Arc<dyn GolfOpsGateway>,
}

impl GetPayrollSummaryUseCase {
    pub fn new(ops: Arc<dyn GolfOpsGateway>) -> Self {
        Self { ops }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        year_month: &str,
    ) -> Result<PayrollSummary, CourseError> {
        let period = PayrollPeriod::try_new(year_month)?;
        let (from, to) = (period.start_date(), period.end_date());

        // Field filters on the UTC date, and the course clock runs ahead of it:
        // a 07:00 round on the 1st is 22:00 on the last of the month before.
        // Fetched wide, then cut back to the month's own days below.
        let window = widen_for_utc_date_filter(from, to);
        let (roster, assignments, attendance, worked) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
                },
            ),
            self.ops
                .list_attendance_period_snapshots(credentials, from, to),
            self.ops.list_worked_minutes(credentials, year_month),
        )?;

        let candidates: Vec<PayrollCandidate> = roster
            .caddies()
            .iter()
            .map(|caddie| PayrollCandidate {
                caddie_id: caddie.id().to_string(),
                display_name: caddie.display_name().to_string(),
                staff_id: caddie.staff_id().map(str::to_string),
            })
            .collect();

        let days: Vec<AttendanceDay> = attendance
            .iter()
            .map(|row| AttendanceDay {
                caddie_id: row.caddie_id().to_string(),
                date: row.date(),
                status: row.attendance_status().to_string(),
            })
            .collect();

        let (period_start, period_end) = course_day_bounds(from, to);
        let assignments: Vec<_> = assignments
            .into_iter()
            .filter(|assignment| {
                let at = assignment.scheduled_at();
                period_start <= at && at < period_end
            })
            .collect();

        Ok(PayrollSummary::new(
            period,
            summarize_payroll(&candidates, &assignments, &days, &worked),
        ))
    }
}
