//! The product features CourseBoard sells, by stable key.
//!
//! A feature key names a business capability, not a screen or a route: the
//! same capability reached from the desk, an export, or the API is the same
//! thing a plan includes. Field assigns these keys to its product plans; the
//! technical definition behind each key (actions, routes, screens, optional
//! release flag) is CourseBoard's and lives here.
//!
//! `.tachyon/manifests/courseboard-product-features.yml` is rendered from this
//! table so it can be applied with the tachyon CLI. The test
//! `the_product_features_manifest_is_rendered_from_the_catalog` keeps the two
//! equal; regenerate the file with
//! `COURSEBOARD_UPDATE_FEATURE_MANIFEST=1 cargo test feature_delivery`.

use crate::course::domain::actions::{
    ASSIGN_MEMBERSHIP, CALCULATE_FEES, IMPORT_RESERVATION_REPORTS, LIST_BUDGETS, LIST_CADDIES,
    LIST_CADDIE_ASSIGNMENTS, LIST_CADDIE_AVAILABILITY, LIST_CADDIE_INSIGHTS, LIST_CADDIE_RANK_FEES,
    LIST_COURSES, LIST_CUSTOMERS, LIST_EXTENSION_STATUS, LIST_MEMBERSHIP, LIST_PAYROLL,
    LIST_PRODUCTS, LIST_RESERVATION_POLICY, LIST_RESERVATION_REPORTS, LIST_SETTLEMENT, LIST_SHIFTS,
    LIST_SLOT_OVERRIDES, LIST_TEE_SHEET, MANAGE_BUDGETS, MANAGE_CADDIES, MANAGE_CADDIE_ASSIGNMENTS,
    MANAGE_CADDIE_AVAILABILITY, MANAGE_CADDIE_RANK_FEES, MANAGE_COURSES, MANAGE_CUSTOMERS,
    MANAGE_MEMBERSHIP_PLANS, MANAGE_PRODUCTS, MANAGE_RESERVATIONS, MANAGE_RESERVATION_POLICY,
    MANAGE_SHIFTS, MANAGE_SLOT_OVERRIDES,
};

/// The manifest's `metadata.name`. Renaming it moves the managed set.
pub const MANIFEST_NAME: &str = "courseboard-product-features";
/// The tenant that owns CourseBoard's product rights (`tachyon.yaml`).
pub const RIGHTS_OWNER_TENANT_ID: &str = "tn_01ks18jhh1xvggktfzjx5jqsen";
pub const PRODUCT_SCOPE: &str = "courseboard";
pub const SOURCE_PRODUCT_KEY: &str = "courseboard";
/// Bumped whenever a definition below changes meaning.
pub const CATALOG_REVISION: &str = "courseboard-product-features-2026-10-19.1";

const FIELD_LIST_MEMBERSHIP: &str = "field:ListMembership";
const FIELD_LIST_HRM: &str = "field:ListHrm";
const FIELD_MANAGE_HRM: &str = "field:ManageHrm";
const FIELD_LIST_BRIDGE_DEFINITIONS: &str = "field:ListBridgeDefinitions";
const FIELD_PREVIEW_BRIDGE_RUN: &str = "field:PreviewBridgeRun";
const FIELD_EXECUTE_BRIDGE_DRAFTS: &str = "field:ExecuteBridgeDrafts";
const FIELD_LIST_BRIDGE_EXPORT_DEFINITIONS: &str = "field:ListBridgeExportDefinitions";
const FIELD_MANAGE_BRIDGE_EXPORT_DEFINITIONS: &str = "field:ManageBridgeExportDefinitions";
// PLT-5223 fixed the cancellation-fee product on these Field actions.
const FIELD_LIST_CANCELLATION_FEES: &str = "field:ListCancellationFees";
const FIELD_MANAGE_CANCELLATION_FEES: &str = "field:ManageCancellationFees";

/// The release flag that holds the spreadsheet import back per tenant.
pub const RESERVATION_REPORT_IMPORT_FLAG: &str = "feature.courseboard.reservation-report-import";

/// One sellable capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeatureDefinition {
    pub key: &'static str,
    pub description: &'static str,
    /// What reading the feature needs.
    pub read_actions: &'static [&'static str],
    /// What changing anything in it needs, on top of `read_actions`.
    pub manage_actions: &'static [&'static str],
    /// Features that must also be provided for this one to work.
    pub required_feature_keys: &'static [&'static str],
    /// Release flags that must be on as well. Empty for a stable feature:
    /// the contract and IAM decide it alone.
    pub release_gates: &'static [&'static str],
    /// Free-form notes for people reading the catalog, as `(key, value)`.
    /// Carried into the manifest when present; never part of a decision,
    /// the feature's identity, or its digest. Limits match Core's
    /// `ProductFeatures`: see [`ANNOTATION_LIMITS`].
    pub annotations: &'static [(&'static str, &'static str)],
}

/// Core's limits on `annotations`: at most this many keys, each matching
/// `[a-z0-9][a-z0-9._/-]{0,62}`, each value at most this many bytes.
pub const ANNOTATION_LIMITS: (usize, usize) = (32, 1024);

/// Whether an annotation key has the shape Core accepts.
pub fn is_annotation_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    key.len() <= 63
        && (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '/' | '-')
        })
}

impl FeatureDefinition {
    /// The key Tachyon Core's `featureDeliveryValues` answers for.
    pub fn delivery_key(&self) -> String {
        delivery_key_for(self.key)
    }
}

pub fn delivery_key_for(key: &str) -> String {
    format!("feature.{key}")
}

pub fn feature(key: &str) -> Option<&'static FeatureDefinition> {
    FEATURES.iter().find(|feature| feature.key == key)
}

macro_rules! feature {
    ($key:literal, $description:literal,
     read: [$($read:expr),*], manage: [$($manage:expr),*],
     requires: [$($requires:literal),*], gates: [$($gate:expr),*]
     $(, annotations: [$(($note_key:literal, $note_value:literal)),*])?) => {
        FeatureDefinition {
            key: $key,
            description: $description,
            read_actions: &[$($read),*],
            manage_actions: &[$($manage),*],
            required_feature_keys: &[$($requires),*],
            release_gates: &[$($gate),*],
            annotations: &[$($(($note_key, $note_value)),*)?],
        }
    };
}

pub const FEATURES: &[FeatureDefinition] = &[
    feature!("courseboard.tee_sheet", "Tee sheet and booking ledger: taking, moving, and cancelling bookings.",
        read: [LIST_TEE_SHEET], manage: [MANAGE_RESERVATIONS],
        requires: ["courseboard.courses"], gates: []),
    feature!("courseboard.tee_sheet.slot_overrides", "Opening and closing tee times by hand.",
        read: [LIST_SLOT_OVERRIDES], manage: [MANAGE_SLOT_OVERRIDES],
        requires: ["courseboard.tee_sheet"], gates: []),
    feature!("courseboard.tee_sheet.checkin", "Checking a booked party in on arrival.",
        read: [LIST_TEE_SHEET], manage: [MANAGE_RESERVATIONS],
        requires: ["courseboard.tee_sheet"], gates: []),
    feature!("courseboard.courses", "Courses, their order, resources, schedules, and booking horizon.",
        read: [LIST_COURSES], manage: [MANAGE_COURSES],
        requires: [], gates: []),
    feature!("courseboard.products", "The plans sold on the tee sheet and their slots.",
        read: [LIST_PRODUCTS], manage: [MANAGE_PRODUCTS],
        requires: ["courseboard.courses"], gates: []),
    feature!("courseboard.reservation_policy", "Booking rules, player tags, and the golf extension config.",
        read: [LIST_RESERVATION_POLICY, LIST_EXTENSION_STATUS], manage: [MANAGE_RESERVATION_POLICY],
        requires: [], gates: []),
    feature!("courseboard.customers", "The customer ledger, visits, call list, and grade rules.",
        read: [LIST_CUSTOMERS], manage: [MANAGE_CUSTOMERS],
        requires: [], gates: []),
    feature!("courseboard.customers.reception", "Reception sheets: OCR drafts, reception fields, and consent items.",
        read: [LIST_CUSTOMERS], manage: [MANAGE_CUSTOMERS],
        requires: ["courseboard.customers"], gates: []),
    feature!("courseboard.customers.cancellations", "The cancelled-booking list and its billing sheet.",
        read: [LIST_CUSTOMERS], manage: [],
        requires: ["courseboard.customers"], gates: []),
    feature!("courseboard.membership", "Membership plans, discounts, play windows, and who holds one.",
        read: [LIST_MEMBERSHIP, FIELD_LIST_MEMBERSHIP], manage: [MANAGE_MEMBERSHIP_PLANS, ASSIGN_MEMBERSHIP],
        requires: ["courseboard.customers"], gates: []),
    feature!("courseboard.caddies", "The caddie roster and which courses each caddie works.",
        read: [LIST_CADDIES], manage: [MANAGE_CADDIES],
        requires: ["courseboard.courses", "courseboard.staff"], gates: []),
    feature!("courseboard.caddies.dispatch", "Putting caddies on rounds, by hand or by the auto-placement, and duty rotas.",
        read: [LIST_CADDIE_ASSIGNMENTS], manage: [MANAGE_CADDIE_ASSIGNMENTS],
        requires: ["courseboard.caddies", "courseboard.tee_sheet"], gates: []),
    feature!("courseboard.caddies.availability", "Who said they can work, and by when they had to say.",
        read: [LIST_CADDIE_AVAILABILITY], manage: [MANAGE_CADDIE_AVAILABILITY],
        requires: ["courseboard.caddies"], gates: []),
    feature!("courseboard.caddies.shifts", "Shift plans, the rules they are generated under, and the sync to Field.",
        read: [LIST_SHIFTS], manage: [MANAGE_SHIFTS],
        requires: [
            "courseboard.caddies",
            "courseboard.caddies.availability",
            "courseboard.caddies.dispatch"
        ], gates: []),
    feature!("courseboard.caddies.insights", "Attendance, supply, reinforcement, and rating figures.",
        read: [LIST_CADDIE_INSIGHTS], manage: [],
        requires: ["courseboard.caddies"], gates: []),
    feature!("courseboard.caddies.rank_fees", "What each caddie grade is paid, and aligning fees to it.",
        read: [LIST_CADDIE_RANK_FEES], manage: [MANAGE_CADDIE_RANK_FEES],
        requires: ["courseboard.caddies"], gates: []),
    feature!("courseboard.caddies.payroll", "What the caddies are owed, and its CSV.",
        read: [LIST_PAYROLL], manage: [],
        requires: ["courseboard.caddies.rank_fees"], gates: []),
    feature!("courseboard.staff", "The company's staff register held in Field HRM.",
        read: [FIELD_LIST_HRM], manage: [FIELD_MANAGE_HRM],
        requires: [], gates: []),
    feature!("courseboard.budgets", "Daily budgets, their import, and how the club tracks against them.",
        read: [LIST_BUDGETS], manage: [MANAGE_BUDGETS],
        requires: ["courseboard.courses"], gates: []),
    feature!("courseboard.settlement", "The month's takings, their CSV, and the per-booking billing invoice.",
        read: [LIST_SETTLEMENT], manage: [],
        requires: [], gates: []),
    feature!("courseboard.fee_simulator", "Fee and golf-course-tax simulations and their pricing settings.",
        read: [CALCULATE_FEES], manage: [MANAGE_RESERVATION_POLICY],
        requires: ["courseboard.membership"], gates: []),
    feature!("courseboard.reservation_report_import", "Taking a reservation report off a spreadsheet or document and onto the board.",
        read: [LIST_RESERVATION_REPORTS], manage: [IMPORT_RESERVATION_REPORTS],
        requires: ["courseboard.courses"], gates: [RESERVATION_REPORT_IMPORT_FLAG]),
    feature!("courseboard.data_imports", "Common CSV imports through Field Bridge.",
        read: [FIELD_LIST_BRIDGE_DEFINITIONS], manage: [FIELD_PREVIEW_BRIDGE_RUN, FIELD_EXECUTE_BRIDGE_DRAFTS],
        requires: [], gates: []),
    feature!("courseboard.data_exports", "Exports of CourseBoard and Field data through Field Bridge.",
        read: [FIELD_LIST_BRIDGE_EXPORT_DEFINITIONS], manage: [FIELD_MANAGE_BRIDGE_EXPORT_DEFINITIONS],
        requires: [], gates: []),
    feature!("courseboard.cancellation_fee", "Billing a cancellation fee and collecting it through a payment link.",
        read: [FIELD_LIST_CANCELLATION_FEES], manage: [FIELD_MANAGE_CANCELLATION_FEES],
        requires: [], gates: []),
    feature!("courseboard.course_map", "The live cart map, fed by the desktop app.",
        read: [LIST_COURSES], manage: [],
        requires: ["courseboard.courses"], gates: []),
];

/// Render the IaC manifest for the tachyon CLI.
///
/// Hand-written rather than serialized so the file stays stable to review:
/// the field order and quoting never move under a dependency upgrade.
///
/// Defaults are left out: an empty list or a null is not written, and the
/// importer reads an absent field as empty / none (`optionalIntegration`,
/// `internalDependencies`, and any empty `releaseGates` or
/// `requiredFeatureKeys`).
///
/// Which routes and screens belong to a feature is not written either: it is
/// `course_authz::ROUTES` with `routes.rs`, and `App.tsx` with
/// `routeFeatures.ts`, and the tests that catch a keyless route or screen read
/// those directly. Nothing at run time reads such a list from the manifest.
pub fn render_manifest() -> String {
    let mut out = String::new();
    let line = |out: &mut String, indent: usize, text: &str| {
        out.push_str(&" ".repeat(indent));
        out.push_str(text);
        out.push('\n');
    };
    line(
        &mut out,
        0,
        "# Generated from src/feature_delivery/catalog.rs. Do not edit by hand.",
    );
    line(
        &mut out,
        0,
        "# Regenerate: COURSEBOARD_UPDATE_FEATURE_MANIFEST=1 cargo test feature_delivery",
    );
    line(&mut out, 0, "apiVersion: apps.tachy.one/v1alpha");
    line(&mut out, 0, "kind: ProductFeatures");
    line(&mut out, 0, "metadata:");
    line(&mut out, 2, &format!("name: {MANIFEST_NAME}"));
    line(&mut out, 2, &format!("tenantId: {RIGHTS_OWNER_TENANT_ID}"));
    line(&mut out, 0, "spec:");
    line(
        &mut out,
        2,
        &format!("revision: {}", quote(CATALOG_REVISION)),
    );
    line(&mut out, 2, &format!("productScope: {PRODUCT_SCOPE}"));
    line(
        &mut out,
        2,
        &format!("sourceProductKey: {SOURCE_PRODUCT_KEY}"),
    );
    line(&mut out, 2, "features:");
    for feature in FEATURES {
        line(&mut out, 2, &format!("- key: {}", feature.key));
        line(&mut out, 4, "revision: \"1\"");
        line(&mut out, 4, "featureDefinitionRevision: \"1\"");
        line(
            &mut out,
            4,
            &format!("description: {}", quote(feature.description)),
        );
        line(
            &mut out,
            4,
            &format!("deliveryKey: {}", feature.delivery_key()),
        );
        let all_actions: Vec<&str> = feature
            .read_actions
            .iter()
            .chain(feature.manage_actions)
            .copied()
            .collect();
        list(&mut out, 4, "requiredActions", &all_actions);
        list(&mut out, 4, "releaseGates", feature.release_gates);
        list(
            &mut out,
            4,
            "requiredFeatureKeys",
            feature.required_feature_keys,
        );
        annotations(&mut out, feature.annotations);
        line(&mut out, 4, "operationBindings:");
        line(&mut out, 4, "- operation: read");
        list(&mut out, 6, "requiredActions", feature.read_actions);
        if !feature.manage_actions.is_empty() {
            line(&mut out, 4, "- operation: manage");
            list(&mut out, 6, "requiredActions", &all_actions);
        }
    }
    out
}

/// An empty list is omitted, not written as `[]`.
fn list(out: &mut String, indent: usize, name: &str, items: &[&str]) {
    let pad = " ".repeat(indent);
    if items.is_empty() {
        return;
    }
    out.push_str(&format!("{pad}{name}:\n"));
    for item in items {
        out.push_str(&format!("{pad}- {}\n", quote(item)));
    }
}

/// Double-quote a scalar. Every value here is plain ASCII text, so escaping
/// the quote and the backslash is enough for YAML.
/// The `annotations` map, in declaration order; omitted when empty.
pub(crate) fn annotations(out: &mut String, notes: &[(&str, &str)]) {
    if notes.is_empty() {
        return;
    }
    out.push_str("    annotations:\n");
    for (key, value) in notes {
        out.push_str(&format!("      {}: {}\n", quote(key), quote(value)));
    }
}

/// A YAML double-quoted scalar. Backslash, quote, and every control
/// character are escaped, so a free-form annotation value cannot break out
/// of its line.
fn quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for c in value.chars() {
        match c {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            c if c.is_control() => quoted.push_str(&format!("\\u{:04x}", c as u32)),
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}
