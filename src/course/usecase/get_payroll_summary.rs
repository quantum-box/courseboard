//! GetPayrollSummaryUseCase: one use case, one public entrypoint (`execute`).
//!
//! The month used to be aggregated by Field. Golf operations belong here
//! (ADR-0005), and every input is already something CourseBoard reads: the
//! roster, the month's assignments, the attendance the operator recorded, and
//! the worked minutes the staff records hold.
//!
//! Five calls, whatever the headcount — the roster is not walked one caddie at
//! a time.

use std::sync::Arc;

use crate::course::domain::{
    parse_tenant_timezone, summarize_payroll_in_timezone, tenant_day_bounds,
    widen_for_utc_date_filter, AttendanceDay, CaddieAssignmentQuery, CourseError,
    GatewayCredentials, GolfOpsGateway, PayrollCandidate, PayrollPeriod, PayrollSummary,
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
        timezone: &str,
    ) -> Result<PayrollSummary, CourseError> {
        let period = PayrollPeriod::try_new(year_month)?;
        let timezone_id = parse_tenant_timezone(timezone)?;
        let (from, to) = (period.start_date(), period.end_date());

        // The legacy assignment list filters on the UTC date. Fetch wide, then
        // cut back to the tenant month's exact UTC bounds below.
        let window = widen_for_utc_date_filter(from, to);
        let (roster, assignments, attendance, worked, rank_fees) = tokio::try_join!(
            self.ops.list_caddie_roster(credentials),
            self.ops.list_caddie_assignments(
                credentials,
                CaddieAssignmentQuery {
                    caddie_id: None,
                    from: Some(window.0),
                    to: Some(window.1),
                    reservation_id: None,
                },
            ),
            self.ops
                .list_attendance_period_snapshots(credentials, from, to),
            self.ops.list_worked_minutes(credentials, year_month),
            self.ops.get_caddie_rank_fees(credentials),
        )?;

        let candidates: Vec<PayrollCandidate> = roster
            .caddies()
            .iter()
            .map(|caddie| PayrollCandidate {
                caddie_id: caddie.id().to_string(),
                display_name: caddie.display_name().to_string(),
                staff_id: caddie.staff_id().map(str::to_string),
                rank: caddie.rank(),
                base_fee_amount: caddie.base_fee_amount(),
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

        let (period_start, period_end) = tenant_day_bounds(from, to, timezone)?;
        let assignments: Vec<_> = assignments
            .into_iter()
            .filter(|assignment| {
                let at = assignment.scheduled_at();
                period_start <= at && at < period_end
            })
            .collect();

        Ok(PayrollSummary::new(
            period,
            summarize_payroll_in_timezone(
                &candidates,
                &assignments,
                &days,
                &worked,
                &rank_fees,
                timezone_id,
            ),
        ))
    }
}
