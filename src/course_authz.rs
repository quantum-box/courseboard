//! Action-based authorization for CourseBoard's own surface.
//!
//! Routes that proxy Field carry Field's own authorization: the user's bearer
//! goes upstream and Field answers 403 by ERP action. Routes that live on
//! CourseBoard's database (shift rules, slot overrides, tax simulation,
//! cancellation-fee collections, demo seeding) had no gate at all beyond token
//! validity — any signed-in user of any tenant could write another tenant's
//! shift rules by picking the `x-operator-id` header.
//!
//! The model mirrors tachyonfield's route classifier: every protected route is
//! classified here, an unlisted one refuses rather than passes, and the
//! actions come from this repository's auth manifest
//! (`.tachyon/manifests/tachyonfield-golf-auth.yml`, context
//! `field_extension_golf`). The decision itself is Tachyon Auth's — CourseBoard
//! sends the caller's own bearer to `POST /v1/auth/policies/check` under the
//! request's tenant scope, so tenant membership and owner privileges
//! (`AdministratorAccess`) are evaluated where the policies live, not guessed
//! here.

use crate::course::domain::actions;
use crate::AppError;
use axum::{
    body::Body,
    extract::State,
    http::{header::AUTHORIZATION, HeaderName, HeaderValue, Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::course::domain::actions::{
    CALCULATE_FEES, LIST_CADDIE_ASSIGNMENTS, LIST_CADDIE_AVAILABILITY, LIST_CADDIE_RANK_FEES,
    LIST_COURSES, LIST_CUSTOMERS, LIST_MEMBERSHIP, LIST_SHIFTS, LIST_SLOT_OVERRIDES,
    LIST_TEE_SHEET, MANAGE_CADDIE_ASSIGNMENTS, MANAGE_CADDIE_AVAILABILITY, MANAGE_CADDIE_RANK_FEES,
    MANAGE_COURSES, MANAGE_CUSTOMERS, MANAGE_MEMBERSHIP_PLANS, MANAGE_RESERVATION_POLICY,
    MANAGE_SHIFTS, MANAGE_SLOT_OVERRIDES, SEED_DEMO_BOARD,
};

/// What standing a route needs before its handler runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteAuthorization {
    /// No bearer at all: health, static UI, the public cancellation-fee flow.
    Public,
    /// A valid bearer is enough. The route talks to a platform service that
    /// authorizes the caller itself (`/v1/me`, feature flags), or discloses
    /// nothing tenant-scoped (`/admin` redirect).
    AuthenticatedOnly,
    /// The handler forwards the caller's bearer to Field, whose route
    /// classifier enforces the ERP action. Gating here again would only add a
    /// second round-trip to the same policy store.
    UpstreamEnforced,
    /// The handler reads or writes CourseBoard's own database; Tachyon Auth is
    /// asked for this action before it runs.
    Action(&'static str),
    /// The handler asks for itself, because the tenant it acts on is in the
    /// request body rather than `x-operator-id`.
    ///
    /// The legacy operator API (`docs/m2m-auth.md`) is called by Field core
    /// with a bearer alone and `tenant_id` in the JSON. Gating those here would
    /// refuse every one of them for a missing header, and would authorize the
    /// wrong tenant when a caller's header and body disagree.
    HandlerEnforced,
}

/// Method + path pattern + the standing it needs.
///
/// Method `*` matches every method registered on the path — used for
/// upstream-enforced groups where Field distinguishes read from write itself.
/// Pattern segments starting with `:` match one segment; a trailing `*`
/// matches the rest of the path.
const ROUTES: &[(&str, &str, RouteAuthorization)] = &[
    // ─── CourseBoard-local: golf actions ─────────────────────────────────
    ("POST", "/calculate", RouteAuthorization::HandlerEnforced),
    (
        "POST",
        "/simulate/range",
        RouteAuthorization::HandlerEnforced,
    ),
    (
        "POST",
        "/v1/course/simulator/calculate",
        RouteAuthorization::Action(CALCULATE_FEES),
    ),
    (
        "POST",
        "/v1/course/simulator/simulate/range",
        RouteAuthorization::Action(CALCULATE_FEES),
    ),
    // The simulator's inputs are CourseBoard's own row (ADR-0009). Reading them
    // rides the same action as reading a quote; changing them is changing the
    // club's pricing rules, whichever store they sit in.
    (
        "GET",
        "/v1/course/pricing-settings",
        RouteAuthorization::Action(CALCULATE_FEES),
    ),
    (
        "PUT",
        "/v1/course/pricing-settings",
        RouteAuthorization::Action(MANAGE_RESERVATION_POLICY),
    ),
    // The booking form's visitor categories, CourseBoard's own rows
    // (ADR-0009). Read wherever the tee board is read; arranged where the
    // club's booking rules are arranged.
    (
        "GET",
        "/v1/course/player-tag-options",
        RouteAuthorization::Action(LIST_TEE_SHEET),
    ),
    (
        "PUT",
        "/v1/course/player-tag-options",
        RouteAuthorization::Action(MANAGE_RESERVATION_POLICY),
    ),
    (
        "POST",
        "/cancellation-fee-collections",
        RouteAuthorization::HandlerEnforced,
    ),
    (
        "GET",
        "/v1/course/slot-overrides",
        RouteAuthorization::Action(LIST_SLOT_OVERRIDES),
    ),
    (
        "PUT",
        "/v1/course/slot-overrides",
        RouteAuthorization::Action(MANAGE_SLOT_OVERRIDES),
    ),
    (
        "DELETE",
        "/v1/course/slot-overrides",
        RouteAuthorization::Action(MANAGE_SLOT_OVERRIDES),
    ),
    // Moving a round already placed: the same permission as putting one there.
    (
        "PUT",
        "/v1/course/caddie-assignments/:assignment_id/reassignment",
        RouteAuthorization::Action(MANAGE_CADDIE_ASSIGNMENTS),
    ),
    // Non-round work is a decision about today's board, taken on the dispatch
    // screen by the people who put caddies on groups — so it is guarded by the
    // dispatch permissions rather than the shift ones. The club's list of jobs
    // travels with the days filed against it.
    (
        "GET",
        "/v1/course/caddie-duties",
        RouteAuthorization::Action(LIST_CADDIE_ASSIGNMENTS),
    ),
    (
        "PUT",
        "/v1/course/caddie-duties",
        RouteAuthorization::Action(MANAGE_CADDIE_ASSIGNMENTS),
    ),
    (
        "GET",
        "/v1/course/caddie-duty-assignments",
        RouteAuthorization::Action(LIST_CADDIE_ASSIGNMENTS),
    ),
    (
        "POST",
        "/v1/course/caddie-duty-assignments",
        RouteAuthorization::Action(MANAGE_CADDIE_ASSIGNMENTS),
    ),
    (
        "DELETE",
        "/v1/course/caddie-duty-assignments/:duty_id",
        RouteAuthorization::Action(MANAGE_CADDIE_ASSIGNMENTS),
    ),
    (
        "GET",
        "/v1/course/caddie-shift-rules",
        RouteAuthorization::Action(LIST_SHIFTS),
    ),
    (
        "PUT",
        "/v1/course/caddie-shift-rules",
        RouteAuthorization::Action(MANAGE_SHIFTS),
    ),
    (
        "GET",
        "/v1/course/caddie-shifts",
        RouteAuthorization::Action(LIST_SHIFTS),
    ),
    (
        "PUT",
        "/v1/course/caddie-shifts/:caddie_profile_id/:date",
        RouteAuthorization::Action(MANAGE_SHIFTS),
    ),
    (
        "POST",
        "/v1/course/caddie-shift-plans/:year_month",
        RouteAuthorization::Action(MANAGE_SHIFTS),
    ),
    (
        "POST",
        "/v1/course/caddie-shift-plans/:year_month/preview",
        RouteAuthorization::Action(MANAGE_SHIFTS),
    ),
    // Reading how far a month has reached Field is reading the shift board;
    // pushing it is changing what Field holds.
    (
        "GET",
        "/v1/course/caddie-shift-plans/:year_month/field-sync",
        RouteAuthorization::Action(LIST_SHIFTS),
    ),
    (
        "POST",
        "/v1/course/caddie-shift-plans/:year_month/field-sync",
        RouteAuthorization::Action(MANAGE_SHIFTS),
    ),
    (
        "GET",
        "/v1/course/caddie-availability-deadlines/:year_month",
        RouteAuthorization::Action(LIST_CADDIE_AVAILABILITY),
    ),
    (
        "PUT",
        "/v1/course/caddie-availability-deadlines/:year_month",
        RouteAuthorization::Action(MANAGE_CADDIE_AVAILABILITY),
    ),
    (
        "POST",
        "/v1/course/demo-seed",
        RouteAuthorization::Action(SEED_DEMO_BOARD),
    ),
    // ─── Bearer-only ─────────────────────────────────────────────────────
    ("GET", "/admin", RouteAuthorization::AuthenticatedOnly),
    ("GET", "/v1/me", RouteAuthorization::AuthenticatedOnly),
    (
        "POST",
        "/v1/course/feature-flags/evaluate",
        RouteAuthorization::AuthenticatedOnly,
    ),
    // ─── Field-enforced ──────────────────────────────────────────────────
    ("*", "/admin/caddies", RouteAuthorization::UpstreamEnforced),
    (
        "*",
        "/admin/caddies/:id",
        RouteAuthorization::UpstreamEnforced,
    ),
    ("*", "/admin/shifts", RouteAuthorization::UpstreamEnforced),
    (
        "*",
        "/admin/shifts/:id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/admin/shifts/:id/cancel",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/admin/reservations",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/admin/reservations/:reservation_id/assign",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/admin/reservations/:reservation_id/unassign",
        RouteAuthorization::UpstreamEnforced,
    ),
    ("*", "/admin/dispatch", RouteAuthorization::UpstreamEnforced),
    ("*", "/field-api/*", RouteAuthorization::UpstreamEnforced),
    (
        "*",
        "/v1/field/client-capabilities",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/tee-sheet",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/tee-ledger",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservations",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservations/:reservation_id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservations/:reservation_id/cancel",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservations/:reservation_id/party",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservations/:reservation_id/plan",
        RouteAuthorization::UpstreamEnforced,
    ),
    // The arrangement is CourseBoard's own table now (ADR-0009), so Field no
    // longer answers for these. Both still read the course list from Field to
    // resolve ids, but that call cannot stand in for authorizing this one.
    (
        "GET",
        "/v1/course/course-order",
        RouteAuthorization::Action(LIST_COURSES),
    ),
    (
        "PUT",
        "/v1/course/course-order",
        RouteAuthorization::Action(MANAGE_COURSES),
    ),
    (
        "*",
        "/v1/course/courses",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/courses/:id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/courses/:id/resource",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/courses/:id/schedule",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/courses/:id/time-slots/generate",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/booking-horizon",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/resources",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-products",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-products/:service_id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-products/:service_id/slots",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/customers",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/customers/reception-draft",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/customers/:customer_id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/visits",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/member-number",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/customers/:customer_id/membership",
        RouteAuthorization::UpstreamEnforced,
    ),
    // CourseBoard's own rows (ADR-0009), so the gate is here rather than at
    // Field: read wherever a customer is read, arranged where customers are
    // managed. Deciding what makes somebody a good customer is a decision
    // about customers, not about bookings.
    (
        "GET",
        "/v1/course/customer-grade-rules",
        RouteAuthorization::Action(LIST_CUSTOMERS),
    ),
    (
        "PUT",
        "/v1/course/customer-grade-rules",
        RouteAuthorization::Action(MANAGE_CUSTOMERS),
    ),
    // What a membership takes off the green fee: CourseBoard's own rows, so
    // the gate is here rather than at Field.
    (
        "GET",
        "/v1/course/membership-discounts",
        RouteAuthorization::Action(LIST_MEMBERSHIP),
    ),
    (
        "PUT",
        "/v1/course/membership-discounts",
        RouteAuthorization::Action(MANAGE_MEMBERSHIP_PLANS),
    ),
    (
        "GET",
        "/v1/course/membership-play-windows",
        RouteAuthorization::Action(LIST_MEMBERSHIP),
    ),
    (
        "PUT",
        "/v1/course/membership-play-windows",
        RouteAuthorization::Action(MANAGE_MEMBERSHIP_PLANS),
    ),
    (
        "*",
        "/v1/course/membership-plans",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/membership-plans/:plan_id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-report-imports",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-report-imports/preview",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-report-entries",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-profiles",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-profiles/:id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-profiles/:id/courses",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-assignments",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-assignments/:id",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-availabilities",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-availabilities/:caddie_id/:date",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-availability-submissions/:year_month",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-recommendations",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-attendance-snapshot",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-attendance-snapshots",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-supply",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-auto-assignments",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-course-supply",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-reinforcements",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-ratings",
        RouteAuthorization::UpstreamEnforced,
    ),
    // The fee table is CourseBoard's own row now (ADR-0009). Field no longer
    // answers for it, and it decides what people are paid, so the check has to
    // happen here.
    (
        "GET",
        "/v1/course/caddie-rank-fees",
        RouteAuthorization::Action(LIST_CADDIE_RANK_FEES),
    ),
    (
        "PUT",
        "/v1/course/caddie-rank-fees",
        RouteAuthorization::Action(MANAGE_CADDIE_RANK_FEES),
    ),
    (
        "*",
        "/v1/course/caddie-payroll-summary",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/caddie-payroll-summary/export.csv",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/reservation-policy",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/daily-budgets",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/daily-budgets/achievement",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/daily-budgets/import",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/monthly-settlement",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/monthly-settlement/export.csv",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/extension-status",
        RouteAuthorization::UpstreamEnforced,
    ),
    (
        "*",
        "/v1/course/config",
        RouteAuthorization::UpstreamEnforced,
    ),
];

/// Prefixes that are public by construction: the SPA's own assets and flows
/// that authenticate some other way (the signed cancellation-fee link).
const PUBLIC_PREFIXES: &[&str] = &["/ui", "/swagger-ui", "/public/"];
const PUBLIC_EXACT: &[&str] = &["/", "/healthz", "/openapi.json"];

/// Namespaces where an unlisted route refuses instead of passing. Everything
/// CourseBoard registers behind a bearer lives under one of these.
const PROTECTED_PREFIXES: &[&str] = &[
    "/v1/",
    "/admin",
    "/calculate",
    "/simulate",
    "/cancellation-fee-collections",
    "/field-api",
];

fn pattern_matches(pattern: &str, path: &str) -> bool {
    let mut pattern_segments = pattern.split('/').filter(|s| !s.is_empty());
    let mut path_segments = path.split('/').filter(|s| !s.is_empty()).peekable();
    loop {
        match (pattern_segments.next(), path_segments.next()) {
            (None, None) => return true,
            (Some("*"), _) => return true,
            (Some(pattern_segment), Some(path_segment)) => {
                if !pattern_segment.starts_with(':') && pattern_segment != path_segment {
                    return false;
                }
            }
            _ => return false,
        }
    }
}

/// `None` when the route is not classified: the caller must refuse.
pub fn classify(method: &Method, path: &str) -> Option<RouteAuthorization> {
    // Axum answers HEAD from the GET handler, so it needs the GET standing.
    // Left out, every HEAD on a gated route reads as unclassified and refuses.
    let method = if method == Method::HEAD {
        &Method::GET
    } else {
        method
    };
    for (route_method, pattern, authorization) in ROUTES {
        if (*route_method == "*" || *route_method == method.as_str())
            && pattern_matches(pattern, path)
        {
            return Some(*authorization);
        }
    }
    if PUBLIC_EXACT.contains(&path)
        || PUBLIC_PREFIXES
            .iter()
            .any(|prefix| path.starts_with(prefix))
    {
        return Some(RouteAuthorization::Public);
    }
    if PROTECTED_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
    {
        // Fail closed: a protected route someone registers without
        // classifying must not ship open the way the local routes once did.
        return None;
    }
    // Anything else is an unregistered path on its way to a plain 404.
    Some(RouteAuthorization::Public)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allowed,
    Denied,
}

#[derive(Debug)]
pub enum CheckError {
    /// Tachyon Auth did not accept the bearer.
    Unauthorized,
    /// Tachyon Auth refused the tenant scope for this caller.
    TenantRejected,
    /// The provider could not answer; authorization stays closed.
    Provider(String),
}

/// The question CourseBoard asks Tachyon Auth, kept as a trait so tests can
/// script the answer without a network.
#[async_trait::async_trait]
pub trait PolicyChecker: Send + Sync {
    async fn check(
        &self,
        bearer: &str,
        operator_id: &str,
        platform_id: Option<&str>,
        action: &str,
    ) -> Result<Decision, CheckError>;
}

#[derive(Serialize)]
struct CheckRequest<'a> {
    actions: [&'a str; 1],
}

#[derive(Deserialize)]
struct CheckResponse {
    results: Vec<CheckOutcome>,
}

#[derive(Deserialize)]
struct CheckOutcome {
    action: String,
    allowed: bool,
}

/// `POST {tachyon-api}/v1/auth/policies/check` with the caller's own bearer,
/// the same call and headers the feature-flag evaluator already makes.
pub struct TachyonPolicyChecker {
    client: reqwest::Client,
    check_url: Option<reqwest::Url>,
}

impl TachyonPolicyChecker {
    pub fn new(client: reqwest::Client, tachyon_api_base_url: &str) -> Self {
        let check_url = reqwest::Url::parse(tachyon_api_base_url.trim())
            .ok()
            .and_then(|base| base.join("/v1/auth/policies/check").ok());
        if check_url.is_none() {
            tracing::error!(
                base_url = %tachyon_api_base_url,
                "tachyon api base URL is invalid; course action authorization will refuse"
            );
        }
        Self { client, check_url }
    }
}

#[async_trait::async_trait]
impl PolicyChecker for TachyonPolicyChecker {
    async fn check(
        &self,
        bearer: &str,
        operator_id: &str,
        platform_id: Option<&str>,
        action: &str,
    ) -> Result<Decision, CheckError> {
        let Some(check_url) = &self.check_url else {
            return Err(CheckError::Provider(
                "tachyon api base URL is invalid".to_string(),
            ));
        };
        let mut request = self
            .client
            .post(check_url.clone())
            .header(AUTHORIZATION, format!("Bearer {bearer}"))
            .header("x-operator-id", operator_id)
            .json(&CheckRequest { actions: [action] });
        if let Some(platform_id) = platform_id {
            request = request.header("x-platform-id", platform_id);
        }
        let response = request.send().await.map_err(|error| {
            CheckError::Provider(format!("policy check request failed: {error}"))
        })?;
        match response.status() {
            StatusCode::UNAUTHORIZED => return Err(CheckError::Unauthorized),
            StatusCode::FORBIDDEN => return Err(CheckError::TenantRejected),
            status if !status.is_success() => {
                return Err(CheckError::Provider(format!(
                    "policy check answered {status}"
                )))
            }
            _ => {}
        }
        let payload: CheckResponse = response.json().await.map_err(|error| {
            CheckError::Provider(format!("policy check decode failed: {error}"))
        })?;
        let allowed = payload
            .results
            .iter()
            .any(|outcome| outcome.action == action && outcome.allowed);
        Ok(if allowed {
            Decision::Allowed
        } else {
            Decision::Denied
        })
    }
}

/// One tenant-scoped allowance, remembered briefly.
///
/// The key holds the whole bearer rather than a hash: a colliding hash would
/// hand one caller another caller's allowance. Entries are few (per instance,
/// per minute) and Lambda instances are short-lived.
///
/// The platform scope is part of the key, not an afterthought: the same tenant
/// id exists under both the production and sandbox platforms, and an allowance
/// obtained under one must not answer for the other. Local action routes make
/// no Field call afterwards that would catch the mismatch.
type CacheKey = (String, String, Option<String>, String);

/// How long an allowance is used without asking again.
const CACHE_TTL: Duration = Duration::from_secs(60);

/// How long a lapsed allowance is still worth something.
///
/// Only when Tachyon Auth cannot be reached at all, and only for actions that
/// read (see [`actions::is_read_only`]). A revocation therefore takes effect
/// within `CACHE_TTL` normally, and within this window in the worst case: an
/// outage that starts before the revocation reaches anyone.
const CACHE_GRACE: Duration = Duration::from_secs(30 * 60);

const CACHE_CAP: usize = 4096;

/// A [`PolicyChecker`] that remembers allowances, and leans on them when the
/// real one cannot be reached.
///
/// One instance is shared by the route gate and by the use cases, so a request
/// gated on an action its use case also requires is one round trip, not two.
///
/// Denials are never cached. A member who has just been granted something
/// should not have to wait out a TTL, and a denial is cheap to re-ask.
pub struct CachingPolicyChecker {
    inner: Arc<dyn PolicyChecker>,
    entries: Mutex<HashMap<CacheKey, Instant>>,
}

impl CachingPolicyChecker {
    pub fn new(inner: Arc<dyn PolicyChecker>) -> Self {
        Self {
            inner,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// Forget every allowance held for one tenant.
    ///
    /// Called when this app changes who may do what — the members screen
    /// replacing a member's policies, inviting, or removing them. Without it a
    /// revoked permission would keep working for up to `CACHE_TTL`, which is
    /// exactly the moment an operator is watching to see the change take
    /// effect. The whole tenant goes rather than one member's entries: the key
    /// is the bearer, and this app never learns which bearer belongs to the
    /// member whose policies just changed.
    pub fn invalidate_tenant(&self, operator_id: &str) {
        let mut entries = self.entries.lock().expect("authz cache poisoned");
        entries.retain(|(_, tenant, _, _), _| tenant != operator_id);
    }

    fn allowance(&self, key: &CacheKey, window: Duration) -> bool {
        let mut entries = self.entries.lock().expect("authz cache poisoned");
        match entries.get(key) {
            Some(granted_at) if granted_at.elapsed() < window => true,
            Some(granted_at) => {
                // Past even the grace window, so it can never be used again.
                if granted_at.elapsed() >= CACHE_GRACE {
                    entries.remove(key);
                }
                false
            }
            None => false,
        }
    }

    fn remember(&self, key: CacheKey) {
        let mut entries = self.entries.lock().expect("authz cache poisoned");
        if entries.len() >= CACHE_CAP {
            entries.clear();
        }
        entries.insert(key, Instant::now());
    }
}

#[async_trait::async_trait]
impl PolicyChecker for CachingPolicyChecker {
    async fn check(
        &self,
        bearer: &str,
        operator_id: &str,
        platform_id: Option<&str>,
        action: &str,
    ) -> Result<Decision, CheckError> {
        let key: CacheKey = (
            bearer.to_string(),
            operator_id.to_string(),
            platform_id.map(str::to_owned),
            action.to_string(),
        );
        if self.allowance(&key, CACHE_TTL) {
            return Ok(Decision::Allowed);
        }
        match self
            .inner
            .check(bearer, operator_id, platform_id, action)
            .await
        {
            Ok(Decision::Allowed) => {
                self.remember(key);
                Ok(Decision::Allowed)
            }
            Ok(Decision::Denied) => Ok(Decision::Denied),
            // The policy store is unreachable. Someone who was allowed this
            // read minutes ago keeps it, so a desk mid-shift can still look
            // things up; everything else, and every write, still refuses.
            //
            // Only `Provider`: `Unauthorized` and `TenantRejected` are answers
            // about this caller, not a failure to get one.
            Err(CheckError::Provider(message))
                if actions::is_read_only(action) && self.allowance(&key, CACHE_GRACE) =>
            {
                tracing::warn!(
                    action,
                    error = %message,
                    "policy check unavailable; serving a recent allowance for a read"
                );
                Ok(Decision::Allowed)
            }
            Err(error) => Err(error),
        }
    }
}

pub struct CourseAuthorization {
    checker: Option<Arc<dyn PolicyChecker>>,
}

impl CourseAuthorization {
    pub fn new(checker: Arc<dyn PolicyChecker>) -> Self {
        Self {
            checker: Some(checker),
        }
    }

    /// No checker at all. The explicit opt-out for local development
    /// (`COURSEBOARD_DISABLE_ACTION_AUTHZ`) and the default of the plain
    /// `AppState` test constructors; `build_app` always configures the real
    /// checker.
    pub fn disabled() -> Self {
        Self { checker: None }
    }
}

const DENIAL_HEADER: &str = "x-courseboard-auth-denial";

fn forbidden_response(denial: &'static str, message: String) -> Response {
    let mut response = (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({ "error": "forbidden", "message": message })),
    )
        .into_response();
    response.headers_mut().insert(
        HeaderName::from_static(DENIAL_HEADER),
        HeaderValue::from_static(denial),
    );
    response
}

fn bearer_from(req: &Request<Body>) -> Option<&str> {
    let value = req.headers().get(AUTHORIZATION).or_else(|| {
        req.headers().get(HeaderName::from_static(
            crate::COURSEBOARD_AUTHORIZATION_HEADER,
        ))
    })?;
    let token = value.to_str().ok()?.strip_prefix("Bearer ")?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

pub async fn require_course_authorization(
    State(state): State<crate::AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let action = match classify(req.method(), req.uri().path()) {
        Some(RouteAuthorization::Action(action)) => action,
        Some(_) => return Ok(next.run(req).await),
        None => {
            // A registered-but-unclassified route. Refusing beats shipping it
            // open; the error names the fix.
            tracing::error!(
                method = %req.method(),
                path = %req.uri().path(),
                "route is not classified in course_authz::ROUTES; refusing"
            );
            return Err(AppError::Forbidden);
        }
    };

    let authorization = state.course_authorization();
    let Some(checker) = authorization.checker.clone() else {
        tracing::debug!(action, "course action authorization is disabled");
        return Ok(next.run(req).await);
    };

    let Some(bearer) = bearer_from(&req) else {
        return Err(AppError::Unauthorized);
    };
    // Verify locally before spending an outbound request. This layer wraps the
    // per-route token layers, so without this any nonempty bearer would reach
    // Tachyon — an unauthenticated caller could aim traffic at the policy
    // endpoint through us, and wait out the checker timeout doing it.
    if state.token_verifier_for_authz().verify(bearer).is_err() {
        return Err(AppError::Unauthorized);
    }
    let Some(operator_id) = req
        .headers()
        .get("x-operator-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        // Tenant scope is what the decision is about; a request without one
        // has no tenant to be authorized in.
        return Ok(forbidden_response(
            "tenant",
            "x-operator-id is required for this operation".to_string(),
        ));
    };
    let platform_id = req
        .headers()
        .get("x-platform-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match checker
        .check(bearer, operator_id, platform_id, action)
        .await
    {
        Ok(Decision::Allowed) => Ok(next.run(req).await),
        Ok(Decision::Denied) => Ok(forbidden_response(
            "action",
            format!("this operation requires {action}"),
        )),
        Err(CheckError::Unauthorized) => Err(AppError::Unauthorized),
        Err(CheckError::TenantRejected) => Ok(forbidden_response(
            "tenant",
            "the tenant scope was refused for this caller".to_string(),
        )),
        Err(CheckError::Provider(message)) => {
            tracing::warn!(action, error = %message, "policy check unavailable; refusing");
            Err(AppError::Provider(message))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(path: &str) -> Option<RouteAuthorization> {
        classify(&Method::GET, path)
    }

    #[test]
    fn local_routes_carry_golf_actions() {
        assert_eq!(
            classify(&Method::PUT, "/v1/course/caddie-shift-rules"),
            Some(RouteAuthorization::Action(MANAGE_SHIFTS))
        );
        assert_eq!(
            get("/v1/course/caddie-shift-rules"),
            Some(RouteAuthorization::Action(LIST_SHIFTS))
        );
        assert_eq!(
            classify(&Method::DELETE, "/v1/course/slot-overrides"),
            Some(RouteAuthorization::Action(MANAGE_SLOT_OVERRIDES))
        );
        assert_eq!(
            classify(&Method::PUT, "/v1/course/caddie-shifts/cp_1/2026-08-18"),
            Some(RouteAuthorization::Action(MANAGE_SHIFTS))
        );
        assert_eq!(
            classify(
                &Method::POST,
                "/v1/course/caddie-shift-plans/2026-09/preview"
            ),
            Some(RouteAuthorization::Action(MANAGE_SHIFTS))
        );
        // Its tenant is in the body, so the handler asks rather than the gate.
        assert_eq!(
            classify(&Method::POST, "/cancellation-fee-collections"),
            Some(RouteAuthorization::HandlerEnforced)
        );
        assert_eq!(
            classify(&Method::POST, "/calculate"),
            Some(RouteAuthorization::HandlerEnforced)
        );
        assert_eq!(
            classify(&Method::POST, "/v1/course/demo-seed"),
            Some(RouteAuthorization::Action(SEED_DEMO_BOARD))
        );
    }

    #[test]
    fn field_backed_routes_defer_to_upstream() {
        assert_eq!(
            get("/v1/course/tee-sheet"),
            Some(RouteAuthorization::UpstreamEnforced)
        );
        assert_eq!(
            classify(&Method::POST, "/v1/course/reservations"),
            Some(RouteAuthorization::UpstreamEnforced)
        );
        assert_eq!(
            classify(&Method::PATCH, "/v1/course/reservations/res_1/party"),
            Some(RouteAuthorization::UpstreamEnforced)
        );
        assert_eq!(
            classify(&Method::PUT, "/field-api/v1/field/iam/users/us_1/policies"),
            Some(RouteAuthorization::UpstreamEnforced)
        );
        assert_eq!(
            get("/admin/dispatch"),
            Some(RouteAuthorization::UpstreamEnforced)
        );
        assert_eq!(
            get("/v1/course/caddie-payroll-summary/export.csv"),
            Some(RouteAuthorization::UpstreamEnforced)
        );
    }

    #[test]
    fn public_and_bearer_only_routes_stay_reachable() {
        assert_eq!(get("/healthz"), Some(RouteAuthorization::Public));
        assert_eq!(get("/"), Some(RouteAuthorization::Public));
        assert_eq!(get("/ui/index.html"), Some(RouteAuthorization::Public));
        assert_eq!(
            get("/public/cancellation-fees/token123"),
            Some(RouteAuthorization::Public)
        );
        assert_eq!(get("/v1/me"), Some(RouteAuthorization::AuthenticatedOnly));
        assert_eq!(get("/admin"), Some(RouteAuthorization::AuthenticatedOnly));
        assert_eq!(
            classify(&Method::POST, "/v1/course/feature-flags/evaluate"),
            Some(RouteAuthorization::AuthenticatedOnly)
        );
    }

    #[test]
    fn head_is_classified_like_the_get_it_is_served_from() {
        // Axum answers HEAD from the GET handler; classifying it separately
        // would refuse every one of them.
        assert_eq!(
            classify(&Method::HEAD, "/v1/course/caddie-shift-rules"),
            Some(RouteAuthorization::Action(LIST_SHIFTS))
        );
        assert_eq!(
            classify(&Method::HEAD, "/v1/course/slot-overrides"),
            Some(RouteAuthorization::Action(LIST_SLOT_OVERRIDES))
        );
        assert_eq!(
            classify(&Method::HEAD, "/healthz"),
            Some(RouteAuthorization::Public)
        );
    }

    #[test]
    fn unclassified_protected_paths_fail_closed() {
        assert_eq!(get("/v1/course/some-new-surface"), None);
        assert_eq!(classify(&Method::POST, "/v1/anything"), None);
        assert_eq!(get("/admin/new-page"), None);
        // Paths outside the protected namespaces are ordinary 404s.
        assert_eq!(get("/robots.txt"), Some(RouteAuthorization::Public));
    }

    /// Every path string registered in `build_router` must classify. The list
    /// is maintained by hand the same way the router is; a route added there
    /// without a line here fails closed at runtime *and* fails this test.
    /// Every path the router actually declares is in `ROUTES`.
    ///
    /// The list-based test below cannot catch a route that is in neither list,
    /// which is exactly how `field-sync` reached production returning 403 to
    /// its own UI. This one reads `lib.rs` instead of a copy of it, so a new
    /// `.route(...)` that nobody classified fails here rather than in front of
    /// a customer.
    ///
    /// Source introspection rather than asking axum, which does not expose its
    /// route table. The same shape as the migration-hook test next door.
    #[test]
    fn every_route_the_router_declares_is_in_the_table() {
        const ROUTER: &str = include_str!("lib.rs");

        // `.route(` puts the path on the following line, so scrape the string
        // literals rather than the call. `/v1/course/` prefixed literals in
        // this file are route paths and nothing else.
        let declared: Vec<String> = ROUTER
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_prefix('"'))
            .filter_map(|rest| rest.split('"').next())
            .filter(|path| path.starts_with("/v1/course/"))
            .map(str::to_string)
            .collect();
        assert!(
            declared.len() > 40,
            "the scrape found {} course routes, so the shape of lib.rs changed and this test \
             stopped checking anything",
            declared.len()
        );

        let classified: Vec<&str> = ROUTES.iter().map(|(_, path, _)| *path).collect();
        let missing: Vec<&String> = declared
            .iter()
            .filter(|path| !classified.contains(&path.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "these routes are declared in lib.rs but not classified in ROUTES, so they fall \
             through to a 403 for every caller: {missing:?}"
        );
    }

    #[test]
    fn every_registered_route_is_classified() {
        const REGISTERED: &[(&str, &str)] = &[
            ("GET", "/"),
            ("GET", "/healthz"),
            ("GET", "/admin"),
            ("GET", "/admin/caddies"),
            ("POST", "/admin/caddies"),
            ("POST", "/admin/caddies/cd_1"),
            ("POST", "/admin/shifts"),
            ("POST", "/admin/shifts/sh_1"),
            ("POST", "/admin/shifts/sh_1/cancel"),
            ("GET", "/admin/reservations"),
            ("POST", "/admin/reservations/res_1/assign"),
            ("POST", "/admin/reservations/res_1/unassign"),
            ("GET", "/admin/dispatch"),
            ("POST", "/calculate"),
            ("POST", "/simulate/range"),
            ("POST", "/cancellation-fee-collections"),
            ("GET", "/public/cancellation-fees/token"),
            ("POST", "/public/cancellation-fees/token/confirm"),
            (
                "POST",
                "/public/cancellation-fees/token/stripe-payment-intent",
            ),
            ("GET", "/field-api/v1/field/iam/users"),
            ("GET", "/v1/me"),
            ("GET", "/v1/field/client-capabilities"),
            ("POST", "/v1/course/feature-flags/evaluate"),
            ("GET", "/v1/course/tee-sheet"),
            ("GET", "/v1/course/tee-ledger"),
            ("POST", "/v1/course/reservations"),
            ("PATCH", "/v1/course/reservations/res_1"),
            ("POST", "/v1/course/reservations/res_1/cancel"),
            ("PATCH", "/v1/course/reservations/res_1/party"),
            ("PATCH", "/v1/course/reservations/res_1/plan"),
            ("GET", "/v1/course/slot-overrides"),
            ("PUT", "/v1/course/slot-overrides"),
            ("DELETE", "/v1/course/slot-overrides"),
            ("GET", "/v1/course/course-order"),
            ("PUT", "/v1/course/course-order"),
            ("GET", "/v1/course/courses"),
            ("POST", "/v1/course/courses"),
            ("PATCH", "/v1/course/courses/c_1"),
            ("DELETE", "/v1/course/courses/c_1"),
            ("POST", "/v1/course/courses/c_1/resource"),
            ("GET", "/v1/course/courses/c_1/schedule"),
            ("PUT", "/v1/course/courses/c_1/schedule"),
            ("POST", "/v1/course/courses/c_1/time-slots/generate"),
            ("GET", "/v1/course/booking-horizon"),
            ("PUT", "/v1/course/booking-horizon"),
            ("GET", "/v1/course/resources"),
            ("GET", "/v1/course/reservation-products"),
            ("POST", "/v1/course/reservation-products/svc_1"),
            ("GET", "/v1/course/reservation-products/svc_1/slots"),
            ("PUT", "/v1/course/reservation-products/svc_1/slots"),
            ("GET", "/v1/course/customers"),
            ("POST", "/v1/course/customers"),
            ("POST", "/v1/course/customers/reception-draft"),
            ("GET", "/v1/course/customers/cus_1"),
            ("GET", "/v1/course/customers/cus_1/visits"),
            ("PUT", "/v1/course/customers/cus_1/member-number"),
            ("GET", "/v1/course/customers/cus_1/membership"),
            ("POST", "/v1/course/customers/cus_1/membership"),
            ("GET", "/v1/course/customer-grade-rules"),
            ("PUT", "/v1/course/customer-grade-rules"),
            ("GET", "/v1/course/membership-discounts"),
            ("PUT", "/v1/course/membership-discounts"),
            ("GET", "/v1/course/membership-play-windows"),
            ("PUT", "/v1/course/membership-play-windows"),
            ("GET", "/v1/course/membership-plans"),
            ("POST", "/v1/course/membership-plans"),
            ("PATCH", "/v1/course/membership-plans/pl_1"),
            ("POST", "/v1/course/reservation-report-imports"),
            ("POST", "/v1/course/reservation-report-imports/preview"),
            ("GET", "/v1/course/reservation-report-entries"),
            ("GET", "/v1/course/caddie-profiles"),
            ("POST", "/v1/course/caddie-profiles"),
            ("PATCH", "/v1/course/caddie-profiles/cp_1"),
            ("DELETE", "/v1/course/caddie-profiles/cp_1"),
            ("GET", "/v1/course/caddie-profiles/cp_1/courses"),
            ("PUT", "/v1/course/caddie-profiles/cp_1/courses"),
            ("GET", "/v1/course/caddie-assignments"),
            ("POST", "/v1/course/caddie-assignments"),
            ("PATCH", "/v1/course/caddie-assignments/ca_1"),
            ("GET", "/v1/course/caddie-availabilities"),
            ("POST", "/v1/course/caddie-availabilities"),
            ("DELETE", "/v1/course/caddie-availabilities/cp_1/2026-08-18"),
            ("GET", "/v1/course/caddie-availability-deadlines/2026-09"),
            ("PUT", "/v1/course/caddie-availability-deadlines/2026-09"),
            ("GET", "/v1/course/caddie-availability-submissions/2026-09"),
            ("GET", "/v1/course/caddie-recommendations"),
            ("GET", "/v1/course/caddie-attendance-snapshot"),
            ("GET", "/v1/course/caddie-attendance-snapshots"),
            ("GET", "/v1/course/caddie-supply"),
            ("POST", "/v1/course/caddie-auto-assignments"),
            ("GET", "/v1/course/caddie-course-supply"),
            ("GET", "/v1/course/caddie-reinforcements"),
            ("GET", "/v1/course/caddie-ratings"),
            ("GET", "/v1/course/caddie-rank-fees"),
            ("PUT", "/v1/course/caddie-rank-fees"),
            ("GET", "/v1/course/caddie-payroll-summary"),
            ("GET", "/v1/course/caddie-payroll-summary/export.csv"),
            ("GET", "/v1/course/caddie-shift-rules"),
            ("PUT", "/v1/course/caddie-shift-rules"),
            ("PUT", "/v1/course/caddie-assignments/a_1/reassignment"),
            ("GET", "/v1/course/caddie-duties"),
            ("PUT", "/v1/course/caddie-duties"),
            ("GET", "/v1/course/caddie-duty-assignments"),
            ("PUT", "/v1/course/caddie-duty-assignments/cp_1/2026-08-29"),
            (
                "DELETE",
                "/v1/course/caddie-duty-assignments/cp_1/2026-08-29",
            ),
            ("GET", "/v1/course/caddie-shifts"),
            ("PUT", "/v1/course/caddie-shifts/cp_1/2026-08-18"),
            ("POST", "/v1/course/caddie-shift-plans/2026-09"),
            ("POST", "/v1/course/caddie-shift-plans/2026-09/preview"),
            ("GET", "/v1/course/caddie-shift-plans/2026-09/field-sync"),
            ("POST", "/v1/course/caddie-shift-plans/2026-09/field-sync"),
            ("GET", "/v1/course/reservation-policy"),
            ("PATCH", "/v1/course/reservation-policy"),
            ("GET", "/v1/course/daily-budgets"),
            ("POST", "/v1/course/daily-budgets"),
            ("GET", "/v1/course/daily-budgets/achievement"),
            ("POST", "/v1/course/daily-budgets/import"),
            ("GET", "/v1/course/monthly-settlement"),
            ("GET", "/v1/course/monthly-settlement/export.csv"),
            ("GET", "/v1/course/extension-status"),
            ("PATCH", "/v1/course/config"),
            ("POST", "/v1/course/demo-seed"),
            ("POST", "/v1/course/simulator/calculate"),
            ("POST", "/v1/course/simulator/simulate/range"),
            ("GET", "/v1/course/pricing-settings"),
            ("PUT", "/v1/course/pricing-settings"),
            ("GET", "/v1/course/player-tag-options"),
            ("PUT", "/v1/course/player-tag-options"),
        ];
        for (method, path) in REGISTERED {
            let method: Method = method.parse().expect("valid method");
            assert!(
                classify(&method, path).is_some(),
                "{method} {path} is registered but not classified",
            );
        }
    }
}

/// The cache in front of Tachyon Auth: what it remembers, what it refuses to
/// lean on, and what makes it forget.
#[cfg(test)]
mod cache_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Scripted {
        answers: Mutex<Vec<Result<Decision, CheckError>>>,
        calls: AtomicUsize,
    }

    impl Scripted {
        fn new(answers: Vec<Result<Decision, CheckError>>) -> Arc<Self> {
            Arc::new(Self {
                answers: Mutex::new(answers),
                calls: AtomicUsize::new(0),
            })
        }
    }

    #[async_trait::async_trait]
    impl PolicyChecker for Scripted {
        async fn check(
            &self,
            _bearer: &str,
            _operator_id: &str,
            _platform_id: Option<&str>,
            _action: &str,
        ) -> Result<Decision, CheckError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let mut answers = self.answers.lock().expect("answers");
            if answers.is_empty() {
                return Err(CheckError::Provider("no answer scripted".to_string()));
            }
            answers.remove(0)
        }
    }

    async fn check(cache: &CachingPolicyChecker, action: &str) -> Result<Decision, CheckError> {
        cache.check("bearer-1", "tn_1", None, action).await
    }

    #[tokio::test]
    async fn an_allowance_answers_the_next_asker_without_a_second_round_trip() {
        let inner = Scripted::new(vec![Ok(Decision::Allowed)]);
        let cache = CachingPolicyChecker::new(inner.clone());
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Ok(Decision::Allowed)
        ));
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Ok(Decision::Allowed)
        ));
        assert_eq!(inner.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn an_allowance_does_not_answer_for_another_platform() {
        // The same tenant id exists under production and sandbox. A local
        // action route makes no Field call afterwards that would catch the
        // mismatch, so the allowance must not carry across.
        let inner = Scripted::new(vec![Ok(Decision::Allowed), Ok(Decision::Denied)]);
        let cache = CachingPolicyChecker::new(inner.clone());
        assert!(matches!(
            cache
                .check("bearer-1", "tn_1", Some("platform-a"), actions::LIST_SHIFTS)
                .await,
            Ok(Decision::Allowed)
        ));
        assert!(matches!(
            cache
                .check("bearer-1", "tn_1", Some("platform-b"), actions::LIST_SHIFTS)
                .await,
            Ok(Decision::Denied)
        ));
        assert_eq!(inner.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_denial_is_asked_again_rather_than_remembered() {
        // Someone granted a permission a moment ago should not wait out a TTL.
        let inner = Scripted::new(vec![Ok(Decision::Denied), Ok(Decision::Allowed)]);
        let cache = CachingPolicyChecker::new(inner.clone());
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Ok(Decision::Denied)
        ));
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Ok(Decision::Allowed)
        ));
        assert_eq!(inner.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn an_outage_keeps_a_recent_read_working() {
        let inner = Scripted::new(vec![
            Ok(Decision::Allowed),
            Err(CheckError::Provider("unreachable".to_string())),
        ]);
        let cache = CachingPolicyChecker::new(inner.clone());
        check(&cache, actions::LIST_SHIFTS).await.expect("granted");
        // Past the fresh window, so the next ask reaches the outage.
        cache
            .entries
            .lock()
            .unwrap()
            .values_mut()
            .for_each(|granted_at| *granted_at -= CACHE_TTL + Duration::from_secs(1));
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Ok(Decision::Allowed)
        ));
    }

    #[tokio::test]
    async fn an_outage_never_lets_a_write_through() {
        let inner = Scripted::new(vec![
            Ok(Decision::Allowed),
            Err(CheckError::Provider("unreachable".to_string())),
        ]);
        let cache = CachingPolicyChecker::new(inner.clone());
        check(&cache, actions::MANAGE_SHIFTS)
            .await
            .expect("granted");
        cache
            .entries
            .lock()
            .unwrap()
            .values_mut()
            .for_each(|granted_at| *granted_at -= CACHE_TTL + Duration::from_secs(1));
        assert!(matches!(
            check(&cache, actions::MANAGE_SHIFTS).await,
            Err(CheckError::Provider(_))
        ));
    }

    #[tokio::test]
    async fn an_outage_refuses_a_read_nobody_was_granted() {
        let inner = Scripted::new(vec![Err(CheckError::Provider("unreachable".to_string()))]);
        let cache = CachingPolicyChecker::new(inner);
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Err(CheckError::Provider(_))
        ));
    }

    #[tokio::test]
    async fn a_rejected_identity_is_not_covered_by_an_old_allowance() {
        // Unauthorized is an answer about the caller, not a failure to get one.
        let inner = Scripted::new(vec![Ok(Decision::Allowed), Err(CheckError::Unauthorized)]);
        let cache = CachingPolicyChecker::new(inner);
        check(&cache, actions::LIST_SHIFTS).await.expect("granted");
        cache
            .entries
            .lock()
            .unwrap()
            .values_mut()
            .for_each(|granted_at| *granted_at -= CACHE_TTL + Duration::from_secs(1));
        assert!(matches!(
            check(&cache, actions::LIST_SHIFTS).await,
            Err(CheckError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn changing_a_tenants_permissions_forgets_that_tenant_only() {
        let inner = Scripted::new(vec![
            Ok(Decision::Allowed),
            Ok(Decision::Allowed),
            Ok(Decision::Denied),
        ]);
        let cache = CachingPolicyChecker::new(inner.clone());
        cache
            .check("bearer-1", "tn_1", None, actions::LIST_SHIFTS)
            .await
            .expect("granted");
        cache
            .check("bearer-2", "tn_2", None, actions::LIST_SHIFTS)
            .await
            .expect("granted");

        cache.invalidate_tenant("tn_1");

        // tn_1 is asked again, and gets the new answer.
        assert!(matches!(
            cache
                .check("bearer-1", "tn_1", None, actions::LIST_SHIFTS)
                .await,
            Ok(Decision::Denied)
        ));
        // tn_2 was not touched.
        assert!(matches!(
            cache
                .check("bearer-2", "tn_2", None, actions::LIST_SHIFTS)
                .await,
            Ok(Decision::Allowed)
        ));
        assert_eq!(inner.calls.load(Ordering::SeqCst), 3);
    }
}

/// The gate on a real router: a database-backed route behind a scripted
/// Tachyon answer.
#[cfg(test)]
mod middleware_tests {
    use super::*;
    use crate::auth::StaticBearerVerifier;
    use crate::{build_router, AppState};
    use axum::Router;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    const TOKEN: &str = "gate-test-token";
    const TENANT: &str = "tn_gate_test";

    #[derive(Clone, Copy)]
    enum Script {
        Allow,
        Deny,
        Unauthorized,
        TenantRejected,
        ProviderDown,
    }

    struct ScriptedChecker {
        script: Script,
        calls: AtomicUsize,
    }

    #[async_trait::async_trait]
    impl PolicyChecker for ScriptedChecker {
        async fn check(
            &self,
            _bearer: &str,
            _operator_id: &str,
            _platform_id: Option<&str>,
            _action: &str,
        ) -> Result<Decision, CheckError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            match self.script {
                Script::Allow => Ok(Decision::Allowed),
                Script::Deny => Ok(Decision::Denied),
                Script::Unauthorized => Err(CheckError::Unauthorized),
                Script::TenantRejected => Err(CheckError::TenantRejected),
                Script::ProviderDown => Err(CheckError::Provider("scripted outage".to_string())),
            }
        }
    }

    async fn gated_app(script: Script) -> (Router, Arc<ScriptedChecker>) {
        let pool = crate::test_support::test_pool().await;
        let checker = Arc::new(ScriptedChecker {
            script,
            calls: AtomicUsize::new(0),
        });
        // Wired the way `build_app` wires it: the cache in front of the
        // checker, so these tests see the round trips production would make.
        let cached = Arc::new(CachingPolicyChecker::new(checker.clone()));
        let state = AppState::new(pool, Arc::new(StaticBearerVerifier::new(TOKEN.to_string())))
            .with_course_authorization(Arc::new(CourseAuthorization::new(cached)));
        (build_router(state), checker)
    }

    fn shift_rules_request(operator: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder()
            .method(Method::GET)
            .uri("/v1/course/caddie-shift-rules")
            .header(AUTHORIZATION, format!("Bearer {TOKEN}"));
        if let Some(operator) = operator {
            builder = builder.header("x-operator-id", operator);
        }
        builder.body(Body::empty()).expect("request builds")
    }

    #[tokio::test]
    async fn a_denied_action_answers_403_with_the_action_denial_marker() {
        let (app, checker) = gated_app(Script::Deny).await;
        let response = app
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response.headers().get(DENIAL_HEADER),
            Some(&HeaderValue::from_static("action"))
        );
        assert_eq!(checker.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn an_allowed_action_passes_and_the_allowance_is_remembered() {
        let (app, checker) = gated_app(Script::Allow).await;
        let first = app
            .clone()
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let second = app
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::OK);
        // The second request rides the cached allowance instead of asking again.
        assert_eq!(checker.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_request_without_a_tenant_scope_is_refused_before_any_check() {
        let (app, checker) = gated_app(Script::Allow).await;
        let response = app.oneshot(shift_rules_request(None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response.headers().get(DENIAL_HEADER),
            Some(&HeaderValue::from_static("tenant"))
        );
        assert_eq!(checker.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_rejected_tenant_scope_carries_the_tenant_denial_marker() {
        let (app, _) = gated_app(Script::TenantRejected).await;
        let response = app
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            response.headers().get(DENIAL_HEADER),
            Some(&HeaderValue::from_static("tenant"))
        );
    }

    #[tokio::test]
    async fn a_bearer_tachyon_rejects_is_a_401() {
        let (app, _) = gated_app(Script::Unauthorized).await;
        let response = app
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn an_unreachable_policy_store_refuses_with_424_not_a_pass() {
        let (app, _) = gated_app(Script::ProviderDown).await;
        let response = app
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        // Fail closed, as 424 so the browser sees a JSON error rather than a
        // Cloudflare-mangled 5xx.
        assert_eq!(response.status(), StatusCode::FAILED_DEPENDENCY);
    }

    #[tokio::test]
    async fn the_disabled_gate_lets_a_valid_bearer_through() {
        // The plain constructors default to the disabled gate; this is what the
        // rest of the test suite (and the CLI-JWT local mode) relies on.
        let pool = crate::test_support::test_pool().await;
        let state = AppState::new(pool, Arc::new(StaticBearerVerifier::new(TOKEN.to_string())));
        let app = build_router(state);
        let response = app
            .oneshot(shift_rules_request(Some(TENANT)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn public_routes_stay_open_with_the_gate_enforcing() {
        let (app, checker) = gated_app(Script::Deny).await;
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(checker.calls.load(Ordering::SeqCst), 0);
    }
}
