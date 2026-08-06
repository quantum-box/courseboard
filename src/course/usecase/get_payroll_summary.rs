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
    summarize_payroll, AttendanceDay, CaddieAssignmentQuery, CourseError, GatewayCredentials,
    GolfOpsGateway, PayrollCandidate, PayrollPeriod, PayrollSummary,
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

        let (roster, assignments, attendance, worked) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(from),
                    to: Some(to),
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

        Ok(PayrollSummary::new(
            period,
            summarize_payroll(&candidates, &assignments, &days, &worked),
        ))
    }
}
