//! End-to-end persistence for the ledger's writes.
//!
//! The unit tests around these features check one layer each: the codec knows
//! how to merge, the use case knows what to reject. None of them proves the
//! write actually leaves the process and comes back on the next request, which
//! is the only thing an operator cares about.
//!
//! So each test here drives the real router against a stub Field that stores
//! what it is sent, then builds a **fresh router** and reads back. A value that
//! survives that round trip is genuinely persisted; one that lived in a cache or
//! a struct field would not.

#![cfg(test)]

use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::auth::StaticBearerVerifier;
use crate::cancellation_fees::CancellationFeeConfig;
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions},
    MySqlPool,
};

use crate::{build_router, AppState};

const TOKEN: &str = "test-token";

// ─── Stub Field ───────────────────────────────────────────────────────────────

/// The slice of Field the ledger writes to, holding state the way Field does.
///
/// `config` and `reservations` are the two shared bags CourseBoard merges into;
/// the stub keeps them whole so a write that drops a neighbouring key fails a
/// test here rather than in production.
#[derive(Default)]
struct FieldState {
    config: Mutex<Value>,
    reservation_custom_fields: Mutex<Value>,
    /// How many of the next config writes to throw away, standing in for another
    /// writer landing between our read and our write.
    clobber_config_writes: Mutex<usize>,
    /// What that other writer put there instead.
    clobber_with: Mutex<Value>,
    /// Bookings created through the API, kept so a re-run can find them.
    created: Mutex<Vec<Value>>,
    /// Golf courses, so the seed's create/update has somewhere to land.
    courses: Mutex<Vec<Value>>,
    /// The reservation resources those courses map to. A plan sold on a course
    /// is stored against the resource behind it, so a canonical write needs
    /// these to exist the way they do in a real tenant.
    resources: Mutex<Vec<Value>>,
    /// Names the generic reservation resources were created under, so a test
    /// can tell a resource that was already there from one CourseBoard made.
    created_reservation_resources: Mutex<Vec<String>>,
    /// The plan and end time a write moved the booking to, absent until one
    /// does — so a test can tell "never written" from "written back the same".
    reservation_service_id: Mutex<Option<String>>,
    reservation_ends_at: Mutex<Option<String>>,
}

async fn extension_status(State(state): State<Arc<FieldState>>) -> Json<Value> {
    Json(json!({
        "items": [{
            "extensionKey": "golf_course",
            "configJson": state.config.lock().unwrap().clone(),
        }]
    }))
}

async fn patch_config(
    State(state): State<Arc<FieldState>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut clobber = state.clobber_config_writes.lock().unwrap();
    if *clobber > 0 {
        // Another writer won this round: the config ends up as theirs, not ours,
        // and Field still answers 200. This is the failure the write-and-verify
        // exists to catch.
        *clobber -= 1;
        *state.config.lock().unwrap() = state.clobber_with.lock().unwrap().clone();
    } else {
        // Field replaces the extension's config wholesale, exactly as here.
        *state.config.lock().unwrap() = body["configJson"].clone();
    }
    Json(json!({ "ok": true }))
}

async fn list_courses(State(state): State<Arc<FieldState>>) -> Json<Value> {
    Json(json!({ "items": state.courses.lock().unwrap().clone() }))
}

async fn create_course(
    State(state): State<Arc<FieldState>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut courses = state.courses.lock().unwrap();
    let mut stored = body.clone();
    stored["id"] = json!(format!("course-seeded-{}", courses.len() + 1));
    courses.push(stored.clone());
    Json(stored)
}

async fn update_course(
    State(state): State<Arc<FieldState>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut courses = state.courses.lock().unwrap();
    let mut stored = body.clone();
    stored["id"] = json!(id);
    if let Some(slot) = courses
        .iter_mut()
        .find(|course| course["id"] == stored["id"])
    {
        *slot = stored.clone();
    }
    Json(stored)
}

/// A tenant that already has three courses, which is what most tests assume.
///
/// The seed tests start from `FieldState::default()` instead: an empty club is
/// the case a seed exists for.
fn field_with_courses() -> Arc<FieldState> {
    let state = Arc::new(FieldState::default());
    *state.courses.lock().unwrap() = vec![
        course("course-a", "A course"),
        course("course-b", "B course"),
        course("course-c", "C course"),
    ];
    state
}

/// A tenant whose courses each have the one active resource Field books on.
fn field_with_course_resources() -> Arc<FieldState> {
    let state = field_with_courses();
    *state.resources.lock().unwrap() = vec![
        course_resource("course-a", "resource-a"),
        course_resource("course-b", "resource-b"),
        course_resource("course-c", "resource-c"),
    ];
    state
}

fn course_resource(course_id: &str, resource_id: &str) -> Value {
    json!({
        "id": format!("golf-{resource_id}"),
        "name": course_id,
        "reservationResourceId": resource_id,
        "golfCourseId": course_id,
        "resourceKind": "course",
        "active": true,
    })
}

fn course(id: &str, name: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "holeCount": 18,
        "timezone": "Asia/Tokyo",
        "businessHoursJson": { "open": "07:00", "close": "08:00" },
        "startIntervalMinutes": 10,
        "isActive": true,
    })
}

async fn list_resources(State(state): State<Arc<FieldState>>) -> Json<Value> {
    Json(json!({ "items": state.resources.lock().unwrap().clone() }))
}

async fn create_reservation_resource(
    State(state): State<Arc<FieldState>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut created = state.created_reservation_resources.lock().unwrap();
    created.push(body["name"].as_str().unwrap_or_default().to_string());
    Json(json!({ "id": format!("resource-new-{}", created.len()) }))
}

/// Field upserts the mapping on `resourceCode`, so saving the same course twice
/// corrects its row instead of giving the course a second resource.
async fn save_course_resource(
    State(state): State<Arc<FieldState>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let stored = json!({
        "id": format!("golf-{}", body["resourceCode"].as_str().unwrap_or_default()),
        "name": body["name"],
        "reservationResourceId": body["reservationResourceId"],
        "golfCourseId": body["golfCourseId"],
        "resourceKind": "course",
        "active": true,
    });
    let mut resources = state.resources.lock().unwrap();
    match resources
        .iter_mut()
        .find(|resource| resource["id"] == stored["id"])
    {
        Some(slot) => *slot = stored.clone(),
        None => resources.push(stored.clone()),
    }
    Json(stored)
}

async fn list_reservations(State(state): State<Arc<FieldState>>) -> Json<Value> {
    let mut items = vec![reservation(
        &state.reservation_custom_fields.lock().unwrap(),
    )];
    items.extend(state.created.lock().unwrap().iter().cloned());
    Json(json!({ "items": items }))
}

async fn list_reservation_types() -> Json<Value> {
    Json(json!({ "items": [{ "id": "type-1", "name": "Round" }] }))
}

/// Field assigns the id and stores what it is sent, as here.
async fn create_reservation(
    State(state): State<Arc<FieldState>>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mut created = state.created.lock().unwrap();
    let stored = json!({
        "id": format!("res-seeded-{}", created.len() + 1),
        "reservationNumber": format!("R-{}", created.len() + 1),
        "status": "confirmed",
        "startsAt": body["startsAt"],
        "endsAt": body["endsAt"],
        "quantity": body["quantity"],
        "customerName": body["customerName"],
        "customFieldsJson": body["customFields"],
    });
    created.push(stored.clone());
    Json(stored)
}

async fn get_reservation(
    State(state): State<Arc<FieldState>>,
    Path(_id): Path<String>,
) -> Json<Value> {
    Json(current_reservation(&state))
}

async fn patch_reservation(
    State(state): State<Arc<FieldState>>,
    Path(_id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    // Field's PATCH replaces `customFields` wholesale — the behaviour the merge
    // in the gateway exists to survive. A body that does not carry the key is a
    // write about something else and leaves the object alone, which is what
    // lets the plan change keep the group detail.
    if let Some(custom_fields) = body.get("customFields") {
        *state.reservation_custom_fields.lock().unwrap() = custom_fields.clone();
    }
    if let Some(service_id) = body.get("serviceId").and_then(Value::as_str) {
        *state.reservation_service_id.lock().unwrap() = Some(service_id.to_string());
    }
    if let Some(ends_at) = body.get("endsAt").and_then(Value::as_str) {
        *state.reservation_ends_at.lock().unwrap() = Some(ends_at.to_string());
    }
    Json(current_reservation(&state))
}

fn current_reservation(state: &Arc<FieldState>) -> Value {
    let mut value = reservation(&state.reservation_custom_fields.lock().unwrap());
    if let Some(ends_at) = state.reservation_ends_at.lock().unwrap().as_deref() {
        value["endsAt"] = json!(ends_at);
    }
    if let Some(service_id) = state.reservation_service_id.lock().unwrap().as_deref() {
        value["serviceId"] = json!(service_id);
    }
    value
}

fn reservation(custom_fields: &Value) -> Value {
    json!({
        "id": "res-1",
        "reservationNumber": "R-1",
        "status": "confirmed",
        "startsAt": "2026-07-19T22:00:00Z",
        "endsAt": "2026-07-20T02:30:00Z",
        "quantity": 4,
        "customerName": "山田 太郎",
        "customFieldsJson": custom_fields.clone(),
    })
}

/// One stub Field, kept alive for the whole test so several routers can share it.
async fn spawn_field(state: Arc<FieldState>) -> String {
    let app = Router::new()
        .route("/v1/erp/extensions/status", get(extension_status))
        .route(
            "/v1/erp/extensions/golf_course/config",
            patch(patch_config).put(patch_config),
        )
        .route(
            "/v1/erp/extensions/golf-course/courses",
            get(list_courses).post(create_course),
        )
        .route(
            "/v1/erp/extensions/golf-course/courses/:id",
            patch(update_course),
        )
        .route("/v1/erp/reservation-types", get(list_reservation_types))
        .route(
            "/v1/erp/extensions/golf-course/resources",
            get(list_resources).post(save_course_resource),
        )
        .route(
            "/v1/erp/reservation-resources",
            post(create_reservation_resource),
        )
        .route(
            "/v1/erp/reservations",
            get(list_reservations).post(create_reservation),
        )
        .route(
            "/v1/erp/reservations/:id",
            get(get_reservation).patch(patch_reservation),
        )
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub Field");
    let addr = listener.local_addr().expect("stub Field addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve stub Field");
    });
    format!("http://{addr}")
}

// ─── Harness ──────────────────────────────────────────────────────────────────

/// A router built fresh over the same database and the same stub Field.
///
/// Building a new one between the write and the read is the point: it drops
/// every in-process cache, so anything that comes back came from storage.
///
/// The pool is passed in rather than opened here: a pool per router meant
/// several per test, and that many at once is what tips TiDB into lock
/// contention. The pool is the storage these tests are checking, not the state
/// they are trying to drop.
fn router(pool: &MySqlPool, field_url: &str) -> Router {
    router_with_multi_course_writes(pool, field_url, true)
}

/// This route persists only through Field; a lazy pool makes that boundary
/// test independent of an unrelated CourseBoard test database.
fn unused_pool() -> MySqlPool {
    MySqlPoolOptions::new().connect_lazy_with(
        MySqlConnectOptions::new()
            .host("127.0.0.1")
            .username("root")
            .database("unused_plan_config_test"),
    )
}

fn router_with_multi_course_writes(
    pool: &MySqlPool,
    field_url: &str,
    multi_course_product_writes: bool,
) -> Router {
    // The `/v1/course/*` gateways build their own Field client from the config
    // URL; the admin-UI Field client this state can also hold is not on their
    // path, so it stays unset.
    build_router(AppState::new_with_cancellation_fee_config(
        pool.clone(),
        Arc::new(StaticBearerVerifier::new(TOKEN.to_string())),
        CancellationFeeConfig {
            public_ui_base_url: "http://courseboard.local/ui/index.html".to_string(),
            sms_sender_name: "Course Board".to_string(),
            field_api_url: Some(field_url.to_string()),
            field_upstream_authorization: None,
            twilio_account_sid: None,
            twilio_auth_token: None,
            twilio_messaging_service_sid: None,
            twilio_from_number: None,
            multi_course_product_writes,
            // Matches the production default. No test here drives the Field
            // write-back, and turning it on would point these at a Field that
            // is not part of this harness.
            field_shift_writeback: false,
        },
    ))
}

/// Every test gets its own tenant.
///
/// Desk marks are rows in a database this whole suite shares, and two tests that
/// mark the same tee time under one tenant overwrite each other — a failure that
/// only shows up when they happen to interleave.
fn tenant_for(test: &str) -> String {
    crate::test_support::test_tenant(test)
}

async fn call(
    app: &Router,
    tenant: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-operator-id", tenant);
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    let request = request
        .body(match body {
            Some(value) => Body::from(value.to_string()),
            None => Body::empty(),
        })
        .expect("build request");

    let response = app.clone().oneshot(request).await.expect("router call");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

// ─── Column order ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_column_order_written_through_the_api_is_still_there_for_the_next_request() {
    let tenant = tenant_for("a_column_order_written_through_the_api_i");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": ["course-c", "course-a", "course-b"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // A brand new router: nothing of the write survives in this process.
    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/course-order",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["golfCourseIds"],
        json!(["course-c", "course-a", "course-b"])
    );
}

#[tokio::test]
async fn arranging_the_board_does_not_touch_fields_config_at_all() {
    // The arrangement is CourseBoard's own table now (ADR-0009). It used to be
    // merged into the same wholesale-replaced object the storefront reads, so
    // arranging the board and editing a plan could undo one another.
    let tenant = tenant_for("arranging_the_board_does_not_touch_field");
    let field = field_with_courses();
    let before = json!({
        "reservationProducts": [{ "id": "plan-1", "enabled": true }],
        "defaultHoles": 18,
    });
    *field.config.lock().unwrap() = before.clone();
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": ["course-a"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["golfCourseIds"], json!(["course-a"]));

    // Not "the other keys survived" — the object is not written to at all, so
    // there is no window for a concurrent editor to lose anything.
    assert_eq!(field.config.lock().unwrap().clone(), before);
}

#[tokio::test]
async fn clearing_the_arrangement_persists_as_cleared_rather_than_as_the_old_one() {
    let tenant = tenant_for("clearing_the_arrangement_persists_as_cle");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": ["course-a"] })),
    )
    .await;
    call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": [] })),
    )
    .await;

    let (_, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/course-order",
        None,
    )
    .await;
    assert_eq!(body["golfCourseIds"], json!([]));
}

#[tokio::test]
async fn a_course_that_no_longer_exists_is_dropped_instead_of_failing_the_save() {
    let tenant = tenant_for("a_course_that_no_longer_exists_is_droppe");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": ["course-gone", "course-b"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["golfCourseIds"], json!(["course-b"]));
}

#[tokio::test]
async fn the_ledger_draws_its_columns_in_the_order_that_was_saved() {
    // The whole point of persisting the order: the next board reads that way.
    let tenant = tenant_for("the_ledger_draws_its_columns_in_the_orde");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": ["course-c", "course-a"] })),
    )
    .await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/tee-ledger?date=2026-07-20",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<&str> = body["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .map(|column| column["golfCourseId"].as_str().expect("course id"))
        .collect();
    // Placed first in the saved order, then the unplaced course by name, and
    // last the column for the stub's booking, which names no course at all — a
    // group standing on a tee nobody can identify still has to be visible.
    assert_eq!(names, vec!["course-c", "course-a", "course-b", ""]);
}

// ─── Plan extension config round trips ───────────────────────────────────────────

#[tokio::test]
async fn editing_a_plan_preserves_its_unknown_extension_config_keys() {
    // CourseBoard projects a plan into its known golf fields for the editor,
    // but Field stores the raw product object. A future Field release or
    // another surface may add keys that this version cannot project yet.
    let tenant = tenant_for("editing_a_plan_preserves_its_unknown_exten");
    let field = field_with_courses();
    let unknown_plan_settings = json!({
        "pricingVersion": 2,
        "channels": ["channel-dummy"],
        "rules": { "futureFlag": true },
    });
    *field.config.lock().unwrap() = json!({
        "reservationProducts": [
            {
                "id": "future-ready-plan",
                "name": "Before edit",
                "playType": "self",
                "holeCount": 18,
                "durationMinutes": 240,
                "golfCourseId": "course-a",
                "futurePlanSettings": unknown_plan_settings.clone(),
            },
            {
                "id": "neighbour-plan",
                "futureNeighbourKey": { "keep": true },
            },
        ],
        "futureTenantKey": { "keep": true },
    });
    let url = spawn_field(field.clone()).await;
    // The golf keys of a plan now also persist in CourseBoard's own table, so
    // this boundary test needs the real test database (the plan editor writes
    // both stores on every save).
    let pool = crate::test_support::test_pool().await;

    // The typed read intentionally exposes only CourseBoard's known fields.
    let (status, before) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/reservation-products",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(before["items"][0]["displayName"], json!("Before edit"));
    assert_eq!(before["items"][0]["futurePlanSettings"], Value::Null);

    let (status, saved) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/future-ready-plan",
        Some(json!({
            "displayName": "After edit",
            "playType": "caddie",
            "holeCount": 18,
            "expectedDurationMinutes": 270,
            "golfCourseIds": ["course-a"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["displayName"], json!("After edit"));

    // Field replaces configJson wholesale. These assertions therefore prove
    // that the real HTTP write-back carried the unprojected plan data through,
    // rather than rebuilding the product from the typed domain object.
    let stored = field.config.lock().unwrap().clone();
    let stored_products = stored["reservationProducts"]
        .as_array()
        .expect("stored products");
    let edited = stored_products
        .iter()
        .find(|product| product["id"] == json!("future-ready-plan"))
        .expect("edited plan");
    let neighbour = stored_products
        .iter()
        .find(|product| product["id"] == json!("neighbour-plan"))
        .expect("neighbour plan");
    assert_eq!(edited["futurePlanSettings"], unknown_plan_settings);
    assert_eq!(neighbour["futureNeighbourKey"], json!({ "keep": true }));
    assert_eq!(stored["futureTenantKey"], json!({ "keep": true }));

    // A fresh router reads the edited known field back from Field, so the test
    // covers read -> write-back -> persisted read rather than an in-memory value.
    let (status, after) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/reservation-products",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after["items"][0]["displayName"], json!("After edit"));
}

// ─── Plans sold on several courses ───────────────────────────────────────────

#[tokio::test]
async fn a_plan_sold_on_two_courses_is_stored_against_both_of_their_resources() {
    // The point of SCC-3: one plan, the same conditions, sold on more than one
    // course. Field only knows resources, so the write has to leave both the
    // course membership CourseBoard reads and the resource allow-list the
    // storefront filters on.
    let tenant = tenant_for("a_plan_sold_on_two_courses_is_stored_aga");
    let field = field_with_course_resources();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/season-pass",
        Some(json!({
            "displayName": "シーズンパス",
            "playType": "caddie",
            "holeCount": 18,
            "expectedDurationMinutes": 240,
            "golfCourseIds": ["course-a", "course-b"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["golfCourseIds"], json!(["course-a", "course-b"]));
    // A plan on two courses has no single course to name, so the compatibility
    // alias stays empty rather than picking one.
    assert_eq!(body["golfCourseId"], Value::Null);

    let stored = field.config.lock().unwrap().clone();
    let product = &stored["reservationProducts"][0];
    assert_eq!(product["golfCourseIds"], json!(["course-a", "course-b"]));
    assert_eq!(
        product["eligibleResourceIds"],
        json!(["resource-a", "resource-b"])
    );
    // The scalar is what an old storefront would filter on, and it can only
    // name one course; leaving it behind would hide the plan on the other.
    assert_eq!(product["golfCourseId"], Value::Null);

    // A fresh router: the membership came back from Field, not from a cache.
    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/reservation-products",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["items"][0]["golfCourseIds"],
        json!(["course-a", "course-b"])
    );
}

#[tokio::test]
async fn a_plan_on_one_course_still_answers_the_compatibility_alias() {
    let tenant = tenant_for("a_plan_on_one_course_still_answers_the_c");
    let field = field_with_course_resources();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/weekday-standard",
        Some(json!({
            "displayName": "平日スタンダード",
            "playType": "self",
            "golfCourseIds": ["course-a"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["golfCourseIds"], json!(["course-a"]));
    assert_eq!(body["golfCourseId"], json!("course-a"));
}

#[tokio::test]
async fn a_course_without_a_resource_is_given_one_rather_than_losing_the_plan() {
    // Where a course keeps its tee times is Field's model. Selling the plan on
    // the course is the whole of what the desk meant, so the resource behind it
    // is made here instead of the save failing until somebody goes and presses
    // a button on another screen.
    let tenant = tenant_for("a_course_without_a_resource_is_given_one");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    *field.resources.lock().unwrap() = vec![course_resource("course-a", "resource-a")];
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/season-pass",
        Some(json!({
            "displayName": "シーズンパス",
            "playType": "caddie",
            "golfCourseIds": ["course-a", "course-b"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["golfCourseIds"], json!(["course-a", "course-b"]));

    // Only the course that was missing one, and named after itself so the
    // resource is recognisable in Field.
    assert_eq!(
        *field.created_reservation_resources.lock().unwrap(),
        vec!["B course".to_string()]
    );

    // Half a membership is worse than none: both courses must be placeable, so
    // the stored eligibility names a resource for each.
    let stored = field.config.lock().unwrap().clone();
    let product = &stored["reservationProducts"][0];
    assert_eq!(product["golfCourseIds"], json!(["course-a", "course-b"]));
    assert_eq!(
        product["eligibleResourceIds"],
        json!(["resource-a", "resource-new-1"])
    );
}

#[tokio::test]
async fn a_course_this_tenant_does_not_have_stops_the_whole_plan_from_being_saved() {
    // A course id nothing answers to is a mistake to report, not a resource to
    // invent: writing the plan anyway would sell it on one course and leave it
    // silently missing from the other.
    let tenant = tenant_for("a_course_this_tenant_does_not_have_stops");
    let field = field_with_course_resources();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/season-pass",
        Some(json!({
            "displayName": "シーズンパス",
            "playType": "caddie",
            "golfCourseIds": ["course-a", "course-ghost"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(field
        .created_reservation_resources
        .lock()
        .unwrap()
        .is_empty());
    assert_eq!(
        field.config.lock().unwrap()["reservationProducts"],
        Value::Null
    );
}

#[tokio::test]
async fn the_kill_switch_refuses_a_multi_course_plan_instead_of_shrinking_it() {
    // Turned off, the writer must be visibly closed. Saving one of the two
    // courses, or answering 200 without writing, would look like it worked.
    let tenant = tenant_for("the_kill_switch_refuses_a_multi_course_p");
    let field = field_with_course_resources();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router_with_multi_course_writes(&pool, &url, false),
        &tenant,
        "POST",
        "/v1/course/reservation-products/season-pass",
        Some(json!({
            "displayName": "シーズンパス",
            "playType": "caddie",
            "golfCourseIds": ["course-a", "course-b"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        field.config.lock().unwrap()["reservationProducts"],
        Value::Null
    );
}

#[tokio::test]
async fn a_booking_that_names_no_course_still_reaches_the_board() {
    // `resolve_course` falls back to an unnamed course rather than dropping the
    // booking. Dropping it would make the day look lighter than it is, and the
    // people are on the tee either way.
    let tenant = tenant_for("a_booking_that_names_no_course_still_rea");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    *field.reservation_custom_fields.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (_, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/tee-ledger?date=2026-07-20",
        None,
    )
    .await;
    let orphan = body["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .find(|column| column["golfCourseId"] == json!(""))
        .expect("the column for a booking with no course");
    assert_eq!(orphan["groupCount"], json!(1));
    assert_eq!(orphan["playerCount"], json!(4));
    // It has no schedule of its own, so its rows are only the booked tee times.
    assert_eq!(orphan["gridSource"], json!("bookings_only"));
}

// ─── Group detail ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn group_detail_written_through_the_api_is_still_there_for_the_next_request() {
    let tenant = tenant_for("group_detail_written_through_the_api_is_");
    let field = field_with_courses();
    *field.reservation_custom_fields.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/party",
        Some(json!({
            "competitionName": "本田会",
            "groupNumber": 1,
            "players": [{ "name": "増田 公陽", "tag": "共通" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/tee-ledger?date=2026-07-20",
        None,
    )
    .await;
    let party = body["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .flat_map(|column| column["slots"].as_array().expect("slots"))
        .flat_map(|slot| slot["items"].as_array().expect("items"))
        .map(|item| item["party"].clone())
        .next()
        .expect("a booking on the board");
    assert_eq!(party["competitionName"], json!("本田会"));
    assert_eq!(party["groupNumber"], json!(1));
    assert_eq!(party["players"][0]["name"], json!("増田 公陽"));
    assert_eq!(party["players"][0]["tag"], json!("共通"));
}

#[tokio::test]
async fn writing_group_detail_leaves_the_course_the_booking_sits_on_alone() {
    // `golfCourseId` shares the object Field replaces wholesale; losing it moves
    // the booking to another course.
    let tenant = tenant_for("writing_group_detail_leaves_the_course_t");
    let field = field_with_courses();
    *field.reservation_custom_fields.lock().unwrap() =
        json!({ "golfCourseId": "course-b", "someOtherExtension": { "keep": true } });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/party",
        Some(json!({ "players": [{ "name": "増田 公陽" }] })),
    )
    .await;

    let stored = field.reservation_custom_fields.lock().unwrap().clone();
    assert_eq!(stored["golfCourseId"], json!("course-b"));
    assert_eq!(stored["someOtherExtension"]["keep"], json!(true));
    assert_eq!(
        stored["golfParty"]["players"][0]["name"],
        json!("増田 公陽")
    );
}

#[tokio::test]
async fn clearing_group_detail_persists_as_cleared() {
    let tenant = tenant_for("clearing_group_detail_persists_as_cleare");
    let field = field_with_courses();
    *field.reservation_custom_fields.lock().unwrap() = json!({ "golfCourseId": "course-b" });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/party",
        Some(json!({ "competitionName": "本田会", "players": [{ "name": "a" }] })),
    )
    .await;
    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/party",
        Some(json!({ "players": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["players"], json!([]));

    let stored = field.reservation_custom_fields.lock().unwrap().clone();
    assert_eq!(stored["golfCourseId"], json!("course-b"));
    assert!(stored.get("golfParty").is_none());
}

#[tokio::test]
async fn a_player_with_no_name_is_refused_rather_than_saved_half_way() {
    let tenant = tenant_for("a_player_with_no_name_is_refused_rather_");
    let field = field_with_courses();
    *field.reservation_custom_fields.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/party",
        Some(json!({ "players": [{ "name": "  " }] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Nothing reached Field: a refused save must not half-apply.
    assert!(field
        .reservation_custom_fields
        .lock()
        .unwrap()
        .get("golfParty")
        .is_none());
}

// ─── Changing the plan ────────────────────────────────────────────────────────

/// A club selling both a caddie round and a self round on every course, plus
/// one scoped to another course and one that only seats a pair.
fn field_with_plans() -> Arc<FieldState> {
    let state = field_with_courses();
    *state.config.lock().unwrap() = json!({
        "reservationProducts": [
            {
                "id": "svc-self",
                "name": "セルフ18ホール",
                "playType": "self",
                "holeCount": 18,
                "durationMinutes": 240,
            },
            {
                "id": "svc-caddie",
                "name": "キャディ付き18ホール",
                "playType": "caddie",
                "holeCount": 18,
                "durationMinutes": 270,
            },
            {
                "id": "svc-course-b-only",
                "name": "B コース限定",
                "playType": "caddie",
                "holeCount": 18,
                "durationMinutes": 270,
                "golfCourseIds": ["course-b"],
            },
            {
                "id": "svc-two-ball",
                "name": "薄暮 2 サム",
                "playType": "self",
                "holeCount": 9,
                "durationMinutes": 120,
                "maxPlayersPerGroup": 2,
            },
        ]
    });
    state
}

#[tokio::test]
async fn changing_the_plan_moves_the_booking_and_its_end_time() {
    let tenant = tenant_for("changing_the_plan_moves_the_booking_and_");
    let field = field_with_plans();
    *field.reservation_custom_fields.lock().unwrap() = json!({ "golfCourseId": "course-a" });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/plan",
        Some(json!({ "reservationServiceId": "svc-caddie" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(
        field.reservation_service_id.lock().unwrap().as_deref(),
        Some("svc-caddie")
    );
    // The 22:00Z start plus the caddie plan's 270 minutes. The end time has to
    // follow the plan, or a 4h30 round keeps the 4h slot the old one implied.
    assert_eq!(
        field.reservation_ends_at.lock().unwrap().as_deref(),
        Some("2026-07-20T02:30:00Z")
    );
}

#[tokio::test]
async fn changing_the_plan_leaves_the_group_detail_alone() {
    // The plan lives outside `customFields`, so this write must not send that
    // object at all — sending it back is how the typed-in names get lost.
    let tenant = tenant_for("changing_the_plan_leaves_the_group_detai");
    let field = field_with_plans();
    *field.reservation_custom_fields.lock().unwrap() = json!({
        "golfCourseId": "course-a",
        "golfParty": { "players": [{ "name": "増田 公陽" }] },
    });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/plan",
        Some(json!({ "reservationServiceId": "svc-caddie" })),
    )
    .await;

    let stored = field.reservation_custom_fields.lock().unwrap().clone();
    assert_eq!(stored["golfCourseId"], json!("course-a"));
    assert_eq!(
        stored["golfParty"]["players"][0]["name"],
        json!("増田 公陽")
    );
}

#[tokio::test]
async fn a_plan_sold_on_another_course_is_refused() {
    let tenant = tenant_for("a_plan_sold_on_another_course_is_refused");
    let field = field_with_plans();
    *field.reservation_custom_fields.lock().unwrap() = json!({ "golfCourseId": "course-a" });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/plan",
        Some(json!({ "reservationServiceId": "svc-course-b-only" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(field.reservation_service_id.lock().unwrap().is_none());
}

#[tokio::test]
async fn a_plan_that_seats_fewer_than_the_group_is_refused() {
    // The booking is for four; which two to turn away is not the API's call.
    let tenant = tenant_for("a_plan_that_seats_fewer_than_the_group_i");
    let field = field_with_plans();
    *field.reservation_custom_fields.lock().unwrap() = json!({ "golfCourseId": "course-a" });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/plan",
        Some(json!({ "reservationServiceId": "svc-two-ball" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(field.reservation_service_id.lock().unwrap().is_none());
}

#[tokio::test]
async fn a_plan_the_club_does_not_sell_is_not_found() {
    let tenant = tenant_for("a_plan_the_club_does_not_sell_is_not_fou");
    let field = field_with_plans();
    *field.reservation_custom_fields.lock().unwrap() = json!({ "golfCourseId": "course-a" });
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/plan",
        Some(json!({ "reservationServiceId": "svc-nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ─── Desk marks ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn desk_marks_written_through_the_api_are_still_there_for_the_next_request() {
    let tenant = tenant_for("desk_marks_written_through_the_api_are_s");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/slot-overrides",
        Some(json!({
            "golfCourseId": "course-a",
            "date": "2026-07-20",
            "teeTimes": ["07:10", "07:20"],
            "kind": "closed",
            "label": "メンテナンス",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/slot-overrides?date=2026-07-20&golfCourseId=course-a",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let times: Vec<&str> = body["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|mark| mark["teeTime"].as_str().expect("tee time"))
        .collect();
    assert_eq!(times, vec!["07:10", "07:20"]);
    assert_eq!(body["items"][0]["label"], json!("メンテナンス"));
}

#[tokio::test]
async fn a_saved_mark_reaches_the_board_and_closes_the_row() {
    let tenant = tenant_for("a_saved_mark_reaches_the_board_and_close");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/slot-overrides",
        Some(json!({
            "golfCourseId": "course-a",
            "date": "2026-07-20",
            "teeTimes": ["07:10"],
            "kind": "closed",
        })),
    )
    .await;

    let (_, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/tee-ledger?date=2026-07-20&golfCourseIds=course-a",
        None,
    )
    .await;
    let slot = body["columns"][0]["slots"]
        .as_array()
        .expect("slots")
        .iter()
        .find(|slot| slot["teeTime"] == json!("07:10"))
        .expect("the marked row");
    assert_eq!(slot["mark"]["kind"], json!("closed"));
    assert_eq!(slot["isSellable"], json!(false));
}

#[tokio::test]
async fn clearing_a_mark_persists_as_cleared() {
    let tenant = tenant_for("clearing_a_mark_persists_as_cleared");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/slot-overrides",
        Some(json!({
            "golfCourseId": "course-b",
            "date": "2026-07-21",
            "teeTimes": ["07:30"],
            "kind": "special_rate",
        })),
    )
    .await;
    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "DELETE",
        "/v1/course/slot-overrides",
        Some(json!({
            "golfCourseId": "course-b",
            "date": "2026-07-21",
            "teeTimes": ["07:30"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], json!(1));

    let (_, body) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/slot-overrides?date=2026-07-21&golfCourseId=course-b",
        None,
    )
    .await;
    assert_eq!(body["items"], json!([]));
}

// ─── Losing a write to another writer ─────────────────────────────────────────

#[tokio::test]
async fn a_write_that_another_writer_overwrote_is_applied_again_rather_than_lost() {
    // Everything still left in the extension config shares one object that
    // Field replaces wholesale, with no version to compare against. Without the
    // retry the operator is told the plan was saved when it was not.
    let tenant = tenant_for("a_write_that_another_writer_overwrote_is");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    *field.clobber_with.lock().unwrap() = json!({ "somebodyElsesKey": { "kept": true } });
    *field.clobber_config_writes.lock().unwrap() = 1;
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/season-pass",
        Some(json!({
            "displayName": "シーズンパス",
            "playType": "caddie",
            "golfCourseIds": ["course-a"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["displayName"], json!("シーズンパス"));

    // Both survive: ours because it was applied again, theirs because the retry
    // merged onto what they wrote rather than onto the value we first read.
    let stored = field.config.lock().unwrap().clone();
    assert_eq!(stored["reservationProducts"][0]["id"], json!("season-pass"));
    assert_eq!(stored["somebodyElsesKey"], json!({ "kept": true }));
}

#[tokio::test]
async fn a_week_of_slots_overwritten_by_another_writer_is_applied_again_rather_than_lost() {
    // Slots are stored inside the plan they belong to, in the same shared
    // object, and Field's own slot import rewrites that array too. This path
    // used to write without reading back, so the desk was told the week was
    // saved while the other writer had already replaced it.
    let tenant = tenant_for("a_week_of_slots_overwritten_by_another_");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({
        "reservationProducts": [{ "id": "weekday-standard", "name": "平日スタンダード" }],
    });
    // What the other writer leaves behind: the plan is still there, so our
    // retry has something to attach slots to, plus a key only they wrote.
    *field.clobber_with.lock().unwrap() = json!({
        "reservationProducts": [{ "id": "weekday-standard", "name": "平日スタンダード" }],
        "golfCourseOrder": ["course-b"],
    });
    *field.clobber_config_writes.lock().unwrap() = 1;
    let url = spawn_field(field.clone()).await;
    let pool = unused_pool();

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "PUT",
        "/v1/course/reservation-products/weekday-standard/slots",
        Some(json!({
            "slots": [{
                "weekday": 1,
                "startTime": "07:00",
                "endTime": "12:00",
                "maxGroups": 6,
                "maxPlayers": 24,
            }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Read back from what Field stored, not from the value we sent: after a
    // retry those are different objects.
    assert_eq!(body["items"][0]["startTime"], json!("07:00"));

    let stored = field.config.lock().unwrap().clone();
    let slot = &stored["reservationProducts"][0]["slots"][0];
    assert_eq!(slot["startTime"], json!("07:00"));
    assert_eq!(slot["maxGroups"], json!(6));
    assert_eq!(stored["golfCourseOrder"], json!(["course-b"]));
}

#[tokio::test]
async fn a_write_that_can_never_land_is_reported_instead_of_claimed() {
    // A save that cannot be made to stick has to fail loudly. Reporting success
    // here would leave the operator believing in a plan nobody can book.
    let tenant = tenant_for("a_write_that_can_never_land_is_reported_");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    *field.clobber_with.lock().unwrap() = json!({ "reservationProducts": [] });
    *field.clobber_config_writes.lock().unwrap() = 99;
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/reservation-products/season-pass",
        Some(json!({
            "displayName": "シーズンパス",
            "playType": "caddie",
            "golfCourseIds": ["course-a"],
        })),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    let stored = field.config.lock().unwrap().clone();
    assert_eq!(stored["reservationProducts"], json!([]));
}

#[tokio::test]
async fn group_detail_field_did_not_store_is_reported_instead_of_claimed() {
    // Field answers with what it stored; a green response carrying none of the
    // names means the save did not happen.
    let tenant = tenant_for("group_detail_field_did_not_store_is_repo");
    async fn swallow_patch(Path(_id): Path<String>, Json(_body): Json<Value>) -> Json<Value> {
        Json(reservation(&json!({})))
    }

    let app = Router::new()
        .route(
            "/v1/erp/reservations/:id",
            get(swallow_patch).patch(swallow_patch),
        )
        .route(
            "/v1/erp/extensions/status",
            get(|| async { Json(json!({ "items": [] })) }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub Field");
    let addr = listener.local_addr().expect("stub Field addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve stub Field");
    });
    let url = format!("http://{addr}");
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "PATCH",
        "/v1/course/reservations/res-1/party",
        Some(json!({ "players": [{ "name": "増田 公陽" }] })),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
}

// ─── Demo seed ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn seeding_an_empty_club_produces_a_board_that_reads_back_through_the_ordinary_api() {
    // The whole point of a seed over a fixture: what it writes comes back on the
    // normal board, through the same code operators use.
    let tenant = tenant_for("seed_reads_back");
    let field = Arc::new(FieldState::default());
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (status, body) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/demo-seed?date=2026-07-20",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["courses"], json!(3));
    assert!(body["bookingsCreated"].as_u64().unwrap() > 0);
    assert!(body["marks"].as_u64().unwrap() > 0);

    let (status, ledger) = call(
        &router(&pool, &url),
        &tenant,
        "GET",
        "/v1/course/tee-ledger?date=2026-07-20",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Columns in the order groups go out, which no alphabet produces — that is
    // why the seed stores an order at all.
    let names: Vec<&str> = ledger["columns"]
        .as_array()
        .expect("columns")
        .iter()
        .map(|column| column["courseName"].as_str().expect("name"))
        .collect();
    assert_eq!(&names[..3], &["空沼IN", "藻岩OUT", "藻岩IN"]);

    let karanuma = &ledger["columns"][0];
    // Rows come from the opening hours the seed set, so open tee times exist.
    assert!(karanuma["openSlotCount"].as_u64().unwrap() > 0);
    assert!(karanuma["groupCount"].as_u64().unwrap() > 0);

    let first = karanuma["slots"]
        .as_array()
        .expect("slots")
        .iter()
        .find(|slot| slot["teeTime"] == json!("06:53"))
        .expect("the first start");
    let party = &first["items"][0]["party"];
    assert_eq!(party["competitionName"], json!("本田会"));
    assert_eq!(party["groupNumber"], json!(1));
    assert_eq!(party["players"][0]["name"], json!("増田 公陽"));

    // The desk marks landed on the same board.
    let marked = karanuma["slots"]
        .as_array()
        .expect("slots")
        .iter()
        .find(|slot| slot["teeTime"] == json!("07:35"))
        .expect("the closed row");
    assert_eq!(marked["mark"]["kind"], json!("closed"));
    assert_eq!(marked["isSellable"], json!(false));
}

#[tokio::test]
async fn seeding_twice_updates_the_same_day_rather_than_stacking_a_second_one() {
    // Field's reservation create has no key that would prevent duplicates, so
    // this is the seed's own doing and has to be held to.
    let tenant = tenant_for("seed_twice");
    let field = Arc::new(FieldState::default());
    *field.config.lock().unwrap() = json!({});
    let url = spawn_field(field.clone()).await;
    let pool = crate::test_support::test_pool().await;

    let (_, first) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/demo-seed?date=2026-07-20",
        None,
    )
    .await;
    let created = first["bookingsCreated"].as_u64().unwrap();
    assert!(created > 0);

    let (status, second) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/demo-seed?date=2026-07-20",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second["bookingsCreated"], json!(0));
    assert_eq!(second["bookingsUpdated"], json!(created));
    // And no second set of courses beside the first.
    assert_eq!(second["courses"], json!(3));
    assert_eq!(field.courses.lock().unwrap().len(), 3);
    assert_eq!(field.created.lock().unwrap().len(), created as usize);
}

#[tokio::test]
async fn a_tenant_with_no_reservation_type_is_told_what_to_do_rather_than_half_seeded() {
    // Field requires a reservation type on every booking and offers no way to
    // create one, so the seed cannot fix this for the operator.
    async fn no_types() -> Json<Value> {
        Json(json!({ "items": [] }))
    }

    let tenant = tenant_for("seed_no_type");
    let state = Arc::new(FieldState::default());
    let app = Router::new()
        .route("/v1/erp/extensions/status", get(extension_status))
        .route(
            "/v1/erp/extensions/golf_course/config",
            patch(patch_config).put(patch_config),
        )
        .route(
            "/v1/erp/extensions/golf-course/courses",
            get(list_courses).post(create_course),
        )
        .route("/v1/erp/reservation-types", get(no_types))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub Field");
    let addr = listener.local_addr().expect("stub Field addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve stub Field");
    });
    let url = format!("http://{addr}");
    let pool = crate::test_support::test_pool().await;

    let (status, _) = call(
        &router(&pool, &url),
        &tenant,
        "POST",
        "/v1/course/demo-seed?date=2026-07-20",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
