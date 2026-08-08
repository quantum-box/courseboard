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
    routing::{get, patch},
    Json, Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::auth::StaticBearerVerifier;
use crate::cancellation_fees::CancellationFeeConfig;
use sqlx::MySqlPool;

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

async fn list_resources() -> Json<Value> {
    Json(json!({ "items": [] }))
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
    Json(reservation(
        &state.reservation_custom_fields.lock().unwrap(),
    ))
}

async fn patch_reservation(
    State(state): State<Arc<FieldState>>,
    Path(_id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    // Field's PATCH replaces `customFields` wholesale — the behaviour the merge
    // in the gateway exists to survive.
    *state.reservation_custom_fields.lock().unwrap() = body["customFields"].clone();
    Json(reservation(
        &state.reservation_custom_fields.lock().unwrap(),
    ))
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
            get(list_resources),
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
async fn arranging_the_board_does_not_take_the_plans_stored_beside_it() {
    // Field replaces the extension config wholesale. Everything the storefront
    // reads lives in the same object.
    let tenant = tenant_for("arranging_the_board_does_not_take_the_pl");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({
        "reservationProducts": [{ "id": "plan-1", "enabled": true }],
        "defaultHoles": 18,
    });
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

    let stored = field.config.lock().unwrap().clone();
    assert_eq!(stored["reservationProducts"][0]["id"], json!("plan-1"));
    assert_eq!(stored["defaultHoles"], json!(18));
    assert_eq!(stored["golfCourseOrder"], json!(["course-a"]));
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
    // Plans and the column order live in the same object, are edited from
    // different screens, and Field offers no version to compare against. Without
    // the retry the operator is told the board was arranged when it was not.
    let tenant = tenant_for("a_write_that_another_writer_overwrote_is");
    let field = field_with_courses();
    *field.config.lock().unwrap() = json!({});
    *field.clobber_with.lock().unwrap() = json!({ "reservationProducts": [{ "id": "plan-1" }] });
    *field.clobber_config_writes.lock().unwrap() = 1;
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

    // Both survive: ours because it was applied again, theirs because the retry
    // merged onto what they wrote rather than onto the value we first read.
    let stored = field.config.lock().unwrap().clone();
    assert_eq!(stored["golfCourseOrder"], json!(["course-a"]));
    assert_eq!(stored["reservationProducts"][0]["id"], json!("plan-1"));
}

#[tokio::test]
async fn a_write_that_can_never_land_is_reported_instead_of_claimed() {
    // A save that cannot be made to stick has to fail loudly. Reporting success
    // here would leave the operator believing a board they cannot see.
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
        "PUT",
        "/v1/course/course-order",
        Some(json!({ "golfCourseIds": ["course-a"] })),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    assert!(field
        .config
        .lock()
        .unwrap()
        .get("golfCourseOrder")
        .is_none());
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
