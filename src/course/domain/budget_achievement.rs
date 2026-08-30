//! How the club is tracking against the day's budget.
//!
//! Both halves are pure: one folds the day's bookings into a day's takings,
//! the other lines those up against the budgets. Field used to work this out
//! and CourseBoard only relayed the answer, but a club's daily target and how
//! it counts a caddie-attached round are golf vocabulary, not something a
//! business-agnostic ERP should be adding up (ADR-0005 Phase 1).
//!
//! The arithmetic deliberately mirrors Field's to the rounding: the two run
//! side by side until the numbers are shown to agree, and a difference of one
//! yen in an average would be indistinguishable from a real change.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use chrono_tz::Tz;

use super::{BudgetAchievement, DailyBudget, Reservation, ReservationProduct};

/// One day's takings, before any budget is put beside them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DailyActual {
    pub date: NaiveDate,
    /// The booked amount, not what has been collected. A round that has been
    /// played counts towards the day it was played on whether or not the money
    /// has arrived yet.
    pub actual_revenue: i64,
    pub reservation_count: i64,
    pub player_count: i64,
    pub caddie_attached_count: i64,
}

/// Bookings that do not count towards a day's takings.
///
/// Read from the booking's status rather than its cancellation timestamp: a
/// booking can be rejected without ever having been cancelled, and both are
/// equally not takings.
fn counts_towards_takings(reservation: &Reservation) -> bool {
    !matches!(reservation.status(), "cancelled" | "rejected")
}

/// Fold bookings into one row per local day.
///
/// The day is the local one at the facility, not UTC: a 07:00 tee time in
/// Tokyo belongs to that morning, and grouping by UTC would file the earliest
/// starts under the day before.
pub fn daily_actuals(
    reservations: &[Reservation],
    products: &[ReservationProduct],
    timezone: Tz,
) -> Vec<DailyActual> {
    let mut by_date: BTreeMap<NaiveDate, DailyActual> = BTreeMap::new();
    for reservation in reservations.iter().filter(|r| counts_towards_takings(r)) {
        let date = reservation
            .starts_at()
            .with_timezone(&timezone)
            .date_naive();
        let day = by_date.entry(date).or_insert(DailyActual {
            date,
            ..DailyActual::default()
        });
        day.actual_revenue += reservation.billing().price_amount;
        day.reservation_count += 1;
        day.player_count += i64::from(reservation.quantity());
        // Whether a round is caddie-attached is a property of the plan sold,
        // not of the booking. A booking whose plan is unknown is counted as
        // self-play, which is what a missing plan meant before.
        let caddie_attached = reservation.service_id().is_some_and(|service_id| {
            products
                .iter()
                .find(|product| product.reservation_service_id() == service_id)
                .is_some_and(ReservationProduct::requires_caddie)
        });
        if caddie_attached {
            day.caddie_attached_count += 1;
        }
    }
    by_date.into_values().collect()
}

/// Line the takings up against the budgets, one row per day either side knows
/// about.
///
/// A day with a budget and no play still reports, so an empty day is visible
/// as a miss rather than absent; a day with play and no budget reports too,
/// so takings are never hidden by a budget nobody entered.
pub fn build_budget_achievements(
    budgets: &[DailyBudget],
    actuals: &[DailyActual],
) -> Vec<BudgetAchievement> {
    /// Several courses can each carry their own budget for the same day. The
    /// revenue targets add up; the per-visitor spend and the caddie ratio are
    /// averaged, because summing them would make two courses look like twice
    /// the target spend per person.
    #[derive(Default)]
    struct Target {
        revenue: i64,
        spend_sum: i64,
        ratio_sum: f64,
        rows: i64,
    }

    let mut targets: BTreeMap<NaiveDate, Target> = BTreeMap::new();
    for budget in budgets {
        let target = targets.entry(budget.date()).or_default();
        target.revenue += budget.target_revenue();
        target.spend_sum += budget.target_average_spend();
        target.ratio_sum += budget.target_caddy_attached_ratio();
        target.rows += 1;
    }
    let actual_by_date: BTreeMap<NaiveDate, &DailyActual> =
        actuals.iter().map(|actual| (actual.date, actual)).collect();

    let mut dates: Vec<NaiveDate> = targets.keys().copied().collect();
    dates.extend(
        actual_by_date
            .keys()
            .filter(|date| !targets.contains_key(*date)),
    );
    dates.sort_unstable();

    dates
        .into_iter()
        .map(|date| {
            let target = targets.get(&date);
            let actual = actual_by_date.get(&date);
            let target_revenue = target.map(|target| target.revenue).unwrap_or(0);
            let actual_revenue = actual.map(|actual| actual.actual_revenue).unwrap_or(0);
            let reservation_count = actual.map(|actual| actual.reservation_count).unwrap_or(0);
            let player_count = actual.map(|actual| actual.player_count).unwrap_or(0);
            let caddie_attached = actual
                .map(|actual| actual.caddie_attached_count)
                .unwrap_or(0);
            let rows = target.filter(|target| target.rows > 0);
            BudgetAchievement::reconstitute(
                date,
                target_revenue,
                actual_revenue,
                // A day with no target has no rate: reporting 0% would read as
                // a total miss rather than "nothing was asked for".
                (target_revenue > 0).then(|| actual_revenue as f64 / target_revenue as f64),
                rows.map(|target| target.spend_sum / target.rows)
                    .unwrap_or(0),
                (player_count > 0).then(|| actual_revenue / player_count),
                rows.map(|target| target.ratio_sum / target.rows as f64)
                    .unwrap_or(0.0),
                (reservation_count > 0).then(|| caddie_attached as f64 / reservation_count as f64),
                reservation_count,
                player_count,
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;
    use crate::course::domain::{CourseId, PlayType, ReservationBilling};

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, day).unwrap()
    }

    fn budget(day: u32, revenue: i64, spend: i64, ratio: f64) -> DailyBudget {
        DailyBudget::reconstitute(
            format!("bdg_{day}_{revenue}"),
            CourseId::new("course-a"),
            date(day),
            revenue,
            spend,
            ratio,
            None,
        )
        .expect("a fixture budget is valid")
    }

    /// `hour` is UTC; the fixtures below read it back in Tokyo.
    fn booking(
        day: u32,
        hour: u32,
        status: &str,
        price: i64,
        quantity: i32,
        service_id: Option<&str>,
    ) -> Reservation {
        let starts_at = Utc.with_ymd_and_hms(2026, 7, day, hour, 0, 0).unwrap();
        Reservation::reconstitute(
            format!("res_{day}_{hour}"),
            format!("R-{day}-{hour}"),
            service_id.map(str::to_string),
            None,
            None,
            status,
            starts_at,
            starts_at + chrono::Duration::hours(4),
            quantity,
            None,
            None,
        )
        .with_billing(ReservationBilling {
            price_amount: price,
            ..ReservationBilling::default()
        })
    }

    fn product(service_id: &str, play_type: PlayType) -> ReservationProduct {
        ReservationProduct::reconstitute(
            service_id, None, service_id, None, play_type, 18, 240, None, None,
        )
    }

    #[test]
    fn a_days_takings_are_the_booked_amounts_players_and_caddie_rounds() {
        let products = [
            product("plan-caddie", PlayType::Caddie),
            product("plan-self", PlayType::SelfPlay),
        ];
        let bookings = [
            booking(18, 0, "confirmed", 48_000, 4, Some("plan-caddie")),
            booking(18, 1, "confirmed", 32_000, 2, Some("plan-self")),
        ];

        let actuals = daily_actuals(&bookings, &products, chrono_tz::Asia::Tokyo);

        assert_eq!(actuals.len(), 1);
        assert_eq!(actuals[0].actual_revenue, 80_000);
        assert_eq!(actuals[0].reservation_count, 2);
        assert_eq!(actuals[0].player_count, 6);
        assert_eq!(actuals[0].caddie_attached_count, 1);
    }

    #[test]
    fn cancelled_and_rejected_bookings_are_not_takings() {
        let bookings = [
            booking(18, 0, "confirmed", 48_000, 4, None),
            booking(18, 1, "cancelled", 48_000, 4, None),
            booking(18, 2, "rejected", 48_000, 4, None),
        ];

        let actuals = daily_actuals(&bookings, &[], chrono_tz::Asia::Tokyo);

        assert_eq!(actuals[0].actual_revenue, 48_000);
        assert_eq!(actuals[0].reservation_count, 1);
    }

    #[test]
    fn the_day_is_the_one_at_the_facility_not_in_utc() {
        // 22:00 UTC on the 17th is 07:00 on the 18th in Tokyo — the first tee
        // time of that morning, not the evening before.
        let bookings = [booking(17, 22, "confirmed", 48_000, 4, None)];

        let actuals = daily_actuals(&bookings, &[], chrono_tz::Asia::Tokyo);

        assert_eq!(actuals[0].date, date(18));
    }

    #[test]
    fn budgets_for_several_courses_sum_the_revenue_and_average_the_rest() {
        let budgets = [
            budget(18, 600_000, 20_000, 0.4),
            budget(18, 400_000, 30_000, 0.6),
        ];

        let items = build_budget_achievements(&budgets, &[]);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].target_revenue(), 1_000_000);
        assert_eq!(items[0].target_average_spend(), 25_000);
        assert!((items[0].target_caddy_attached_ratio() - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn a_day_with_only_a_budget_and_a_day_with_only_play_both_report() {
        let budgets = [budget(18, 500_000, 20_000, 0.5)];
        let actuals = [DailyActual {
            date: date(19),
            actual_revenue: 250_000,
            reservation_count: 5,
            player_count: 20,
            caddie_attached_count: 2,
        }];

        let items = build_budget_achievements(&budgets, &actuals);

        assert_eq!(
            items.iter().map(|item| item.date()).collect::<Vec<_>>(),
            vec![date(18), date(19)]
        );
        // Budget but no play: a miss, reported as 0 takings against the target.
        assert_eq!(items[0].actual_revenue(), 0);
        assert_eq!(items[0].revenue_achievement_rate(), Some(0.0));
        assert_eq!(items[0].actual_average_spend(), None);
        // Play but no budget: takings shown, and no rate to report against.
        assert_eq!(items[1].target_revenue(), 0);
        assert_eq!(items[1].revenue_achievement_rate(), None);
        assert_eq!(items[1].actual_average_spend(), Some(12_500));
        assert_eq!(items[1].actual_caddy_attached_ratio(), Some(0.4));
    }

    #[test]
    fn rates_are_absent_rather_than_zero_when_there_is_nothing_to_divide_by() {
        let actuals = [DailyActual {
            date: date(18),
            ..DailyActual::default()
        }];

        let items = build_budget_achievements(&[], &actuals);

        assert_eq!(items[0].revenue_achievement_rate(), None);
        assert_eq!(items[0].actual_average_spend(), None);
        assert_eq!(items[0].actual_caddy_attached_ratio(), None);
    }
}
