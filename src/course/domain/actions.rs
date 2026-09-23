//! The permissions CourseBoard's own operations require.
//!
//! One action per business capability, not per route: the same capability
//! reached from the desk screen, an export, or a future batch is the same
//! permission. Use cases require theirs at the top of `execute`, so the check
//! travels with the operation rather than with the URL that happened to reach
//! it.
//!
//! These names are declared in `.tachyon/manifests/tachyonfield-golf-auth.yml`
//! under the `field_extension_golf` context, and the golf roles there are built
//! out of them. A name that is not in the manifest can never be granted, so
//! adding one here means adding it there in the same change.
//!
//! Finer than Field's own vocabulary on purpose. Field sees most of this as
//! `field:ManageReservations` — one grant covering the tee sheet, the caddie
//! grade fees, the daily budgets, and the extension config alike (PLT-3639).
//! Splitting them here is what lets a club give the front desk the tee sheet
//! without also handing over the pricing.

/// Reading the tee sheet and the ledger behind it.
pub const LIST_TEE_SHEET: &str = "field_extension_golf:ListTeeSheet";
/// Taking, moving, and cancelling bookings.
pub const MANAGE_RESERVATIONS: &str = "field_extension_golf:ManageReservations";

/// Reading the desk's manual open/close overrides on tee times.
pub const LIST_SLOT_OVERRIDES: &str = "field_extension_golf:ListSlotOverrides";
/// Opening and closing tee times by hand.
pub const MANAGE_SLOT_OVERRIDES: &str = "field_extension_golf:ManageSlotOverrides";

/// Reading courses, their order, resources, and schedules.
pub const LIST_COURSES: &str = "field_extension_golf:ListCourses";
/// Creating and editing courses, their order, resources, schedules, and how
/// far ahead booking is open.
pub const MANAGE_COURSES: &str = "field_extension_golf:ManageCourses";

/// Reading the plans sold on the tee sheet and their slots.
pub const LIST_PRODUCTS: &str = "field_extension_golf:ListProducts";
/// Editing the plans sold on the tee sheet and their slots.
pub const MANAGE_PRODUCTS: &str = "field_extension_golf:ManageProducts";

/// Reading the booking rules the desk works under.
pub const LIST_RESERVATION_POLICY: &str = "field_extension_golf:ListReservationPolicy";
/// Changing the booking rules, including the golf extension's own config.
pub const MANAGE_RESERVATION_POLICY: &str = "field_extension_golf:ManageReservationPolicy";

/// Reading the customer ledger.
pub const LIST_CUSTOMERS: &str = "field_extension_golf:ListCustomers";
/// Registering customers and drafting a reception sheet.
pub const MANAGE_CUSTOMERS: &str = "field_extension_golf:ManageCustomers";

/// Reading membership plans and who holds one.
pub const LIST_MEMBERSHIP: &str = "field_extension_golf:ListMembership";
/// Defining the membership plans a club sells.
pub const MANAGE_MEMBERSHIP_PLANS: &str = "field_extension_golf:ManageMembershipPlans";
/// Putting a customer on a membership plan.
pub const ASSIGN_MEMBERSHIP: &str = "field_extension_golf:AssignMembership";

/// Reading the caddie roster and which courses each caddie works.
pub const LIST_CADDIES: &str = "field_extension_golf:ListCaddies";
/// Editing the caddie roster and course assignments.
pub const MANAGE_CADDIES: &str = "field_extension_golf:ManageCaddies";

/// Reading who is on which round.
pub const LIST_CADDIE_ASSIGNMENTS: &str = "field_extension_golf:ListCaddieAssignments";
/// Putting caddies on rounds, by hand or by the auto-placement.
pub const MANAGE_CADDIE_ASSIGNMENTS: &str = "field_extension_golf:ManageCaddieAssignments";

/// Reading who said they can work, and by when they had to say.
pub const LIST_CADDIE_AVAILABILITY: &str = "field_extension_golf:ListCaddieAvailability";
/// Recording availability and setting the deadline for it.
pub const MANAGE_CADDIE_AVAILABILITY: &str = "field_extension_golf:ManageCaddieAvailability";

/// Reading shift plans and the rules they are generated under.
pub const LIST_SHIFTS: &str = "field_extension_golf:ListShifts";
/// Generating and editing shift plans, and the rules behind them.
pub const MANAGE_SHIFTS: &str = "field_extension_golf:ManageShifts";

/// Reading attendance, supply, reinforcement, and rating figures.
pub const LIST_CADDIE_INSIGHTS: &str = "field_extension_golf:ListCaddieInsights";

/// Reading what each caddie grade is paid.
pub const LIST_CADDIE_RANK_FEES: &str = "field_extension_golf:ListCaddieRankFees";
/// Setting what each caddie grade is paid.
pub const MANAGE_CADDIE_RANK_FEES: &str = "field_extension_golf:ManageCaddieRankFees";

/// Reading what the caddies are owed. Names against pay, so it is its own
/// permission rather than part of the roster.
pub const LIST_PAYROLL: &str = "field_extension_golf:ListPayroll";
/// Reading the month's takings.
pub const LIST_SETTLEMENT: &str = "field_extension_golf:ListSettlement";

/// Reading the daily budgets and how the club is tracking against them.
pub const LIST_BUDGETS: &str = "field_extension_golf:ListBudgets";
/// Setting the daily budgets, by hand or by import.
pub const MANAGE_BUDGETS: &str = "field_extension_golf:ManageBudgets";

/// Running fee and golf-course-tax simulations.
pub const CALCULATE_FEES: &str = "field_extension_golf:CalculateFees";
/// Collecting a cancellation fee and issuing its invoice.
pub const MANAGE_CANCELLATION_FEES: &str = "field_extension_golf:ManageCancellationFees";

/// Reading the reservation reports taken off a spreadsheet.
pub const LIST_RESERVATION_REPORTS: &str = "field_extension_golf:ListReservationReports";
/// Taking a reservation report off a spreadsheet and onto the board.
pub const IMPORT_RESERVATION_REPORTS: &str = "field_extension_golf:ImportReservationReports";

/// Reading which parts of the golf extension this tenant has switched on.
pub const LIST_EXTENSION_STATUS: &str = "field_extension_golf:ListExtensionStatus";

/// The machine-to-machine tax callback Field core makes into this app.
///
/// Held by `field-extension:golf:calculator` alone; no member role grants it,
/// and no screen requires it.
pub const CALCULATE_TAX: &str = "field_extension_golf:CalculateTax";

/// Filling a tenant's board with demo rounds and rosters.
pub const SEED_DEMO_BOARD: &str = "field_extension_golf:SeedDemoBoard";

/// The actions that only read.
///
/// Listed rather than derived from the `List` prefix: whether an operation
/// writes is a fact about the operation, and a name is a poor place to keep a
/// safety property. `CalculateFees` is here because a simulation computes and
/// stores nothing, despite the verb.
///
/// This is what the degraded mode is allowed to serve from a stale allowance
/// when Tachyon Auth cannot be reached — see `CachingPolicyChecker`. Adding an
/// action here widens what an outage leaves open, so it is worth being sure.
pub const READ_ONLY: &[&str] = &[
    LIST_TEE_SHEET,
    LIST_SLOT_OVERRIDES,
    LIST_COURSES,
    LIST_PRODUCTS,
    LIST_RESERVATION_POLICY,
    LIST_CUSTOMERS,
    LIST_MEMBERSHIP,
    LIST_CADDIES,
    LIST_CADDIE_ASSIGNMENTS,
    LIST_CADDIE_AVAILABILITY,
    LIST_SHIFTS,
    LIST_CADDIE_INSIGHTS,
    LIST_CADDIE_RANK_FEES,
    LIST_PAYROLL,
    LIST_SETTLEMENT,
    LIST_BUDGETS,
    LIST_RESERVATION_REPORTS,
    LIST_EXTENSION_STATUS,
    CALCULATE_FEES,
];

/// Whether an outage may serve `action` from a stale allowance.
pub fn is_read_only(action: &str) -> bool {
    READ_ONLY.contains(&action)
}

/// Every action above, for the manifest-coverage test.
pub const ALL: &[&str] = &[
    LIST_TEE_SHEET,
    MANAGE_RESERVATIONS,
    LIST_SLOT_OVERRIDES,
    MANAGE_SLOT_OVERRIDES,
    LIST_COURSES,
    MANAGE_COURSES,
    LIST_PRODUCTS,
    MANAGE_PRODUCTS,
    LIST_RESERVATION_POLICY,
    MANAGE_RESERVATION_POLICY,
    LIST_CUSTOMERS,
    MANAGE_CUSTOMERS,
    LIST_MEMBERSHIP,
    MANAGE_MEMBERSHIP_PLANS,
    ASSIGN_MEMBERSHIP,
    LIST_CADDIES,
    MANAGE_CADDIES,
    LIST_CADDIE_ASSIGNMENTS,
    MANAGE_CADDIE_ASSIGNMENTS,
    LIST_CADDIE_AVAILABILITY,
    MANAGE_CADDIE_AVAILABILITY,
    LIST_SHIFTS,
    MANAGE_SHIFTS,
    LIST_CADDIE_INSIGHTS,
    LIST_CADDIE_RANK_FEES,
    MANAGE_CADDIE_RANK_FEES,
    LIST_PAYROLL,
    LIST_SETTLEMENT,
    LIST_BUDGETS,
    MANAGE_BUDGETS,
    CALCULATE_FEES,
    MANAGE_CANCELLATION_FEES,
    LIST_RESERVATION_REPORTS,
    IMPORT_RESERVATION_REPORTS,
    LIST_EXTENSION_STATUS,
    SEED_DEMO_BOARD,
];

#[cfg(test)]
mod tests {
    use super::ALL;

    const MANIFEST: &str = include_str!("../../../.tachyon/manifests/tachyonfield-golf-auth.yml");

    /// An action this code requires but the manifest never declares can never
    /// be granted to anyone, so the operation behind it is refused for every
    /// member including the ones who should have it. The two lists are edited
    /// by hand in the same change; this is what says they still agree.
    #[test]
    fn every_action_this_code_requires_is_declared_in_the_manifest() {
        let undeclared: Vec<&str> = ALL
            .iter()
            .copied()
            .filter(|action| {
                let name = action.split_once(':').expect("context:Name").1;
                !MANIFEST.contains(&format!("\n  name: {name}\n"))
            })
            .collect();
        assert!(
            undeclared.is_empty(),
            "declare these in .tachyon/manifests/tachyonfield-golf-auth.yml: {undeclared:?}"
        );
    }

    /// A declared action that no golf role grants is one nobody but a tenant
    /// owner can use — the same trap tachyonfield guards against.
    #[test]
    fn every_action_this_code_requires_is_granted_by_some_role() {
        let ungranted: Vec<&str> = ALL
            .iter()
            .copied()
            .filter(|action| !MANIFEST.contains(&format!("- action: {action}\n")))
            .collect();
        assert!(
            ungranted.is_empty(),
            "no golf role grants these: {ungranted:?}"
        );
    }

    #[test]
    fn the_manifest_declares_nothing_this_code_never_asks_for() {
        // `CalculateTax` is Field core calling in, not a use case of ours.
        let known: Vec<String> = ALL
            .iter()
            .map(|action| action.split_once(':').expect("context:Name").1.to_string())
            .chain(std::iter::once("CalculateTax".to_string()))
            .collect();
        let declared: Vec<&str> = MANIFEST
            .lines()
            .filter_map(|line| line.strip_prefix("  name: "))
            .collect();
        let stray: Vec<&&str> = declared
            .iter()
            .filter(|name| !known.iter().any(|k| k == *name))
            .collect();
        assert!(stray.is_empty(), "declared but never required: {stray:?}");
    }
}
