//! Which product feature a request belongs to.
//!
//! The route list itself is `course_authz::ROUTES`: every protected route is
//! already classified there, so this module only maps each of its patterns to
//! a feature key (or to an explicit exemption). A pattern that maps to nothing
//! fails `every_classified_route_has_a_feature_or_an_exemption`, which is how a
//! new route cannot ship without a key.

use axum::http::Method;

use super::catalog::{self, FeatureDefinition};
use crate::course_authz;

/// Why a route carries no feature key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exemption {
    /// Before sign-in: health, the SPA's assets, OpenAPI, and the signed
    /// payment link, which must keep working for invoices already issued.
    Public,
    /// Needed by every feature: the caller's profile, capability and flag
    /// reads, the extension status the shell reads for the timezone.
    Platform,
    /// Called by Field core with no user bearer, so Core's contract check has
    /// no credential to run under.
    MachineToMachine,
    /// Not sold: seeding a demo board.
    Internal,
    /// Tenant administration owned by Field (members and their roles).
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeatureRoute {
    Feature(&'static str),
    Exempt(Exemption),
    /// `/field-api/*`: decided by the path behind the proxy prefix.
    FieldProxy,
}

/// What the guard must check for one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestFeature {
    Required(&'static FeatureDefinition),
    Exempt(Exemption),
    /// A protected route no rule covers. Refused under enforcement.
    Unclassified,
}

use Exemption::*;
use FeatureRoute::{Exempt, Feature, FieldProxy};

/// `(method, pattern prefix, feature)` over `course_authz::ROUTES` patterns,
/// first match wins. A prefix matches whole segments only.
const ROUTE_RULES: &[(&str, &str, FeatureRoute)] = &[
    // Platform and exemptions.
    ("*", "/v1/me", Exempt(Platform)),
    ("*", "/v1/course/feature-flags", Exempt(Platform)),
    ("*", "/v1/course/feature-deliveries", Exempt(Platform)),
    ("*", "/v1/field/client-capabilities", Exempt(Platform)),
    ("*", "/v1/course/extension-status", Exempt(Platform)),
    ("*", "/calculate", Exempt(MachineToMachine)),
    ("*", "/simulate", Exempt(MachineToMachine)),
    // The legacy producer: Field core sends the tenant in the body, and new
    // collections are refused with 410 (PLT-4119) whatever the plan says.
    (
        "*",
        "/cancellation-fee-collections",
        Exempt(MachineToMachine),
    ),
    ("*", "/v1/course/demo-seed", Exempt(Internal)),
    ("*", "/field-api", FieldProxy),
    // Legacy server-rendered admin.
    ("*", "/admin/caddies", Feature("courseboard.caddies")),
    ("*", "/admin/shifts", Feature("courseboard.caddies")),
    (
        "*",
        "/admin/reservations",
        Feature("courseboard.caddies.dispatch"),
    ),
    (
        "*",
        "/admin/dispatch",
        Feature("courseboard.caddies.dispatch"),
    ),
    ("*", "/admin", Exempt(Platform)),
    // Data movement.
    (
        "*",
        "/v1/course/data-exports",
        Feature("courseboard.data_exports"),
    ),
    (
        "*",
        "/v1/course/data-imports",
        Feature("courseboard.data_imports"),
    ),
    (
        "*",
        "/v1/course/common-import-owner",
        Feature("courseboard.reservation_report_import"),
    ),
    (
        "*",
        "/v1/course/reservation-report-imports",
        Feature("courseboard.reservation_report_import"),
    ),
    (
        "*",
        "/v1/course/reservation-report-entries",
        Feature("courseboard.reservation_report_import"),
    ),
    (
        "*",
        "/v1/course/reservation-report-migration",
        Feature("courseboard.reservation_report_import"),
    ),
    // Fees and policy.
    (
        "*",
        "/v1/course/simulator",
        Feature("courseboard.fee_simulator"),
    ),
    (
        "*",
        "/v1/course/pricing-settings",
        Feature("courseboard.fee_simulator"),
    ),
    (
        "PUT",
        "/v1/course/player-tag-options",
        Feature("courseboard.reservation_policy"),
    ),
    (
        "*",
        "/v1/course/player-tag-options",
        Feature("courseboard.tee_sheet"),
    ),
    (
        "*",
        "/v1/course/reservation-policy",
        Feature("courseboard.reservation_policy"),
    ),
    (
        "*",
        "/v1/course/config",
        Feature("courseboard.reservation_policy"),
    ),
    // Tee sheet.
    (
        "*",
        "/v1/course/slot-overrides",
        Feature("courseboard.tee_sheet.slot_overrides"),
    ),
    (
        "*",
        "/v1/course/reservations/:reservation_id/checkins",
        Feature("courseboard.tee_sheet.checkin"),
    ),
    (
        "*",
        "/v1/course/tee-sheet",
        Feature("courseboard.tee_sheet"),
    ),
    (
        "*",
        "/v1/course/tee-ledger",
        Feature("courseboard.tee_sheet"),
    ),
    (
        "*",
        "/v1/course/reservations",
        Feature("courseboard.tee_sheet"),
    ),
    // Courses and products.
    (
        "*",
        "/v1/course/course-order",
        Feature("courseboard.courses"),
    ),
    ("*", "/v1/course/courses", Feature("courseboard.courses")),
    (
        "*",
        "/v1/course/booking-horizon",
        Feature("courseboard.courses"),
    ),
    ("*", "/v1/course/resources", Feature("courseboard.courses")),
    (
        "*",
        "/v1/course/reservation-products",
        Feature("courseboard.products"),
    ),
    // Customers.
    (
        "*",
        "/v1/course/customer-consent-items",
        Feature("courseboard.customers.reception"),
    ),
    (
        "*",
        "/v1/course/customer-reception-fields",
        Feature("courseboard.customers.reception"),
    ),
    (
        "*",
        "/v1/course/customers/reception-draft",
        Feature("courseboard.customers.reception"),
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/reception-values",
        Feature("courseboard.customers.reception"),
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/membership",
        Feature("courseboard.membership"),
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/member-number",
        Feature("courseboard.membership"),
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/membership-activities",
        Feature("courseboard.membership"),
    ),
    (
        "*",
        "/v1/course/customers",
        Feature("courseboard.customers"),
    ),
    (
        "*",
        "/v1/course/customer-summaries",
        Feature("courseboard.customers"),
    ),
    (
        "*",
        "/v1/course/customer-grade-rules",
        Feature("courseboard.customers"),
    ),
    (
        "*",
        "/v1/course/reservation-cancellations/fees",
        Feature("courseboard.cancellation_fee"),
    ),
    (
        "*",
        "/v1/course/reservation-cancellations",
        Feature("courseboard.customers.cancellations"),
    ),
    (
        "*",
        "/v1/course/membership-discounts",
        Feature("courseboard.membership"),
    ),
    (
        "*",
        "/v1/course/membership-play-windows",
        Feature("courseboard.membership"),
    ),
    (
        "*",
        "/v1/course/membership-plans",
        Feature("courseboard.membership"),
    ),
    // Caddies.
    (
        "*",
        "/v1/course/caddie-profiles",
        Feature("courseboard.caddies"),
    ),
    (
        "*",
        "/v1/course/caddie-assignments",
        Feature("courseboard.caddies.dispatch"),
    ),
    (
        "*",
        "/v1/course/caddie-duties",
        Feature("courseboard.caddies.dispatch"),
    ),
    (
        "*",
        "/v1/course/caddie-duty-assignments",
        Feature("courseboard.caddies.dispatch"),
    ),
    (
        "*",
        "/v1/course/caddie-recommendations",
        Feature("courseboard.caddies.dispatch"),
    ),
    (
        "*",
        "/v1/course/caddie-auto-assignments",
        Feature("courseboard.caddies.dispatch"),
    ),
    (
        "*",
        "/v1/course/caddie-availabilities",
        Feature("courseboard.caddies.availability"),
    ),
    (
        "*",
        "/v1/course/caddie-availability-submissions",
        Feature("courseboard.caddies.availability"),
    ),
    (
        "*",
        "/v1/course/caddie-availability-deadlines",
        Feature("courseboard.caddies.availability"),
    ),
    (
        "*",
        "/v1/course/caddie-shift-rules",
        Feature("courseboard.caddies.shifts"),
    ),
    (
        "*",
        "/v1/course/caddie-shifts",
        Feature("courseboard.caddies.shifts"),
    ),
    (
        "*",
        "/v1/course/caddie-shift-plans",
        Feature("courseboard.caddies.shifts"),
    ),
    (
        "*",
        "/v1/course/caddie-attendance-snapshot",
        Feature("courseboard.caddies.insights"),
    ),
    (
        "*",
        "/v1/course/caddie-attendance-snapshots",
        Feature("courseboard.caddies.insights"),
    ),
    (
        "*",
        "/v1/course/caddie-supply",
        Feature("courseboard.caddies.insights"),
    ),
    (
        "*",
        "/v1/course/caddie-course-supply",
        Feature("courseboard.caddies.insights"),
    ),
    (
        "*",
        "/v1/course/caddie-reinforcements",
        Feature("courseboard.caddies.insights"),
    ),
    (
        "*",
        "/v1/course/caddie-ratings",
        Feature("courseboard.caddies.insights"),
    ),
    (
        "*",
        "/v1/course/caddie-rank-fees",
        Feature("courseboard.caddies.rank_fees"),
    ),
    (
        "*",
        "/v1/course/caddie-fee-alignment",
        Feature("courseboard.caddies.rank_fees"),
    ),
    (
        "*",
        "/v1/course/caddie-payroll-summary",
        Feature("courseboard.caddies.payroll"),
    ),
    // Money.
    (
        "*",
        "/v1/course/daily-budgets",
        Feature("courseboard.budgets"),
    ),
    (
        "*",
        "/v1/course/monthly-settlement",
        Feature("courseboard.settlement"),
    ),
];

/// The Field paths the SPA reaches through `/field-api`, as
/// `(method, course_authz-style pattern, feature)`, first match wins. Field
/// guards its own routes as well; this is CourseBoard's product boundary on
/// top.
pub const FIELD_PROXY_RULES: &[(&str, &str, FeatureRoute)] = &[
    (
        "*",
        "/v1/cancellation-fees/*",
        Feature("courseboard.cancellation_fee"),
    ),
    // The cancelled-booking list reads and issues cancellation-fee invoices
    // through the generic invoice API.
    (
        "*",
        "/v1/invoices/*",
        Feature("courseboard.customers.cancellations"),
    ),
    (
        "*",
        "/v1/erp/reservations/:reservation_id/billing-invoice",
        Feature("courseboard.settlement"),
    ),
    // The roster registers a caddie as a Field staff member and clocks them
    // in and out; only those calls ride on the caddie feature. The staff
    // register itself (list, edit, delete) is the separately sold staff
    // feature.
    (
        "POST",
        "/v1/erp/staff/:staff_id/clock-in",
        Feature("courseboard.caddies"),
    ),
    (
        "POST",
        "/v1/erp/staff/:staff_id/clock-out",
        Feature("courseboard.caddies"),
    ),
    ("POST", "/v1/erp/staff", Feature("courseboard.caddies")),
    ("*", "/v1/erp/staff/*", Feature("courseboard.staff")),
    (
        "*",
        "/v1/bridge/exports/*",
        Feature("courseboard.data_exports"),
    ),
    ("*", "/v1/field/iam/users/*", Exempt(Settings)),
];

const FIELD_PROXY_PREFIX: &str = "/field-api";

fn prefix_matches(prefix: &str, pattern: &str) -> bool {
    pattern == prefix
        || pattern
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// The feature behind one `course_authz::ROUTES` entry.
pub fn feature_for_pattern(method: &str, pattern: &str) -> Option<FeatureRoute> {
    ROUTE_RULES
        .iter()
        .find(|(rule_method, prefix, _)| {
            (*rule_method == "*" || *rule_method == method) && prefix_matches(prefix, pattern)
        })
        .map(|(_, _, route)| *route)
}

fn field_proxy_feature(method: &Method, inner_path: &str) -> Option<FeatureRoute> {
    let method = if *method == Method::HEAD {
        "GET"
    } else {
        method.as_str()
    };
    FIELD_PROXY_RULES
        .iter()
        .find(|(rule_method, pattern, _)| {
            (*rule_method == "*" || *rule_method == method)
                && course_authz::pattern_matches(pattern, inner_path)
        })
        .map(|(_, _, route)| *route)
}

fn resolve(route: Option<FeatureRoute>) -> RequestFeature {
    match route {
        Some(Feature(key)) => match catalog::feature(key) {
            Some(feature) => RequestFeature::Required(feature),
            None => RequestFeature::Unclassified,
        },
        Some(Exempt(exemption)) => RequestFeature::Exempt(exemption),
        Some(FieldProxy) | None => RequestFeature::Unclassified,
    }
}

/// The feature a request needs.
pub fn classify_request(method: &Method, path: &str) -> RequestFeature {
    if *method == Method::OPTIONS {
        return RequestFeature::Exempt(Public);
    }
    let Some((route_method, pattern)) = course_authz::matching_route(method, path) else {
        // Not in ROUTES: a public path, or an unregistered one on its way to
        // 404. `course_authz` already refuses unlisted protected paths.
        return RequestFeature::Exempt(Public);
    };
    match feature_for_pattern(route_method, pattern) {
        Some(FieldProxy) => {
            let inner = path.strip_prefix(FIELD_PROXY_PREFIX).unwrap_or(path);
            resolve(field_proxy_feature(method, inner))
        }
        route => resolve(route),
    }
}

/// The `apiRefs` of a feature in the manifest: every route mapped to it.
pub fn api_refs(key: &str) -> Vec<String> {
    let routes = course_authz::route_patterns()
        .filter(|(method, pattern)| {
            matches!(feature_for_pattern(method, pattern), Some(Feature(mapped)) if mapped == key)
        })
        .map(|(method, pattern)| format!("{method} {pattern}"));
    let proxied = FIELD_PROXY_RULES
        .iter()
        .filter(|(_, _, route)| matches!(route, Feature(mapped) if *mapped == key))
        .map(|(method, pattern, _)| format!("{method} {FIELD_PROXY_PREFIX}{pattern}"));
    routes.chain(proxied).collect()
}

const DATA_EXPORT_ROWS_PREFIX: &str = "/v1/course/data-exports/";
const DATA_EXPORT_KEY_PREFIX: &str = "external:courseboard:";

/// Export sources whose feature is narrower than the one their read action
/// names: reception answers are the reception feature, not the whole ledger.
const EXPORT_SOURCE_FEATURES: &[(&str, &str)] = &[
    ("reception", "courseboard.customers.reception"),
    ("receptionFields", "courseboard.customers.reception"),
    ("receptionAnswers", "courseboard.customers.reception"),
    ("cancellations", "courseboard.customers.cancellations"),
    ("visitCheckins", "courseboard.tee_sheet.checkin"),
    ("staff", "courseboard.staff"),
];

/// The feature that owns an action: of the features reading it, the one the
/// others build on (the smallest requirement closure).
pub fn feature_for_action(action: &str) -> Option<&'static FeatureDefinition> {
    catalog::FEATURES
        .iter()
        .filter(|feature| feature.read_actions.contains(&action))
        .min_by_key(|feature| super::required_closure(feature).len())
}

/// The feature an export source belongs to. The export endpoints call the
/// source handlers in-process, so the router never sees the source's own
/// route: this is where its feature is decided instead.
pub fn export_source_feature(source_key: &str) -> Option<&'static FeatureDefinition> {
    let key = source_key
        .strip_prefix(DATA_EXPORT_KEY_PREFIX)
        .unwrap_or(source_key);
    if let Some((_, feature)) = EXPORT_SOURCE_FEATURES
        .iter()
        .find(|(source, _)| *source == key)
    {
        return catalog::feature(feature);
    }
    crate::course::domain::data_exports::data_export_objects()
        .iter()
        .find(|object| object.key == key)
        .and_then(|object| feature_for_action(object.required_action()))
}

/// Features a request needs on top of its route's own, or `None` when the
/// request names a source the guard cannot place (refused under enforcement).
///
/// The source key is percent-decoded the way axum's `Path` decodes it for the
/// handler, so `%70ayroll` is judged as the `payroll` it will read.
pub fn additional_features(method: &Method, path: &str) -> Option<Vec<&'static FeatureDefinition>> {
    if *method != Method::GET && *method != Method::HEAD {
        return Some(Vec::new());
    }
    let Some(raw_key) = path
        .strip_prefix(DATA_EXPORT_ROWS_PREFIX)
        .and_then(|rest| rest.strip_suffix("/rows"))
        .filter(|key| !key.contains('/'))
    else {
        return Some(Vec::new());
    };
    let key = percent_decode(raw_key)?;
    export_source_feature(&key).map(|feature| vec![feature])
}

/// Strict percent-decoding of one path segment; `None` on a malformed escape
/// or bytes that are not UTF-8.
pub fn percent_decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = segment.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}
