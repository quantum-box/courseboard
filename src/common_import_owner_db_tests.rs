use super::*;
use crate::{auth::StaticBearerVerifier, cancellation_fees::CancellationFeeConfig};
use axum::{
    http::{HeaderMap, StatusCode},
    routing::get,
    Router,
};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct FieldFixture {
    tenant: String,
    current: Arc<Mutex<Value>>,
    catalog: Arc<Mutex<Value>>,
}
async fn field_fixture(
    State(f): State<FieldFixture>,
    headers: HeaderMap,
    uri: axum::http::Uri,
) -> (StatusCode, Json<Value>) {
    if headers.get("authorization").and_then(|h| h.to_str().ok()) != Some("Bearer current-user")
        || headers.get("x-operator-id").and_then(|h| h.to_str().ok()) != Some(f.tenant.as_str())
        || headers.get("x-platform-id").and_then(|h| h.to_str().ok()) != Some("platform-a")
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"message":"outside current scope"})),
        );
    }
    let body = if uri.path().ends_with("/courses") {
        let catalog = f.catalog.lock().unwrap().clone();
        if catalog.is_null() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"message":"catalog unavailable"})),
            );
        }
        catalog
    } else {
        f.current.lock().unwrap().clone()
    };
    (StatusCode::OK, Json(body))
}
fn headers(tenant: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("authorization", "Bearer current-user".parse().unwrap());
    headers.insert("x-platform-id", "platform-a".parse().unwrap());
    headers.insert("x-operator-id", tenant.parse().unwrap());
    headers
}
async fn invoke(
    state: &AppState,
    tenant: &str,
    subject: &str,
    operation: &str,
    request: OwnerRequest,
) -> Result<Value, AppError> {
    handle(
        State(state.clone()),
        Extension(CallerPrincipal {
            subject: Some(subject.into()),
            username: None,
        }),
        headers(tenant),
        Path(operation.into()),
        Json(request),
    )
    .await
    .map(|r| r.0)
}
fn with_input(request: &OwnerRequest, input: Value) -> OwnerRequest {
    serde_json::from_value(json!({"jobId":request.job_id,"actorId":request.actor_id,"sourceSha256":request.source_sha256,"options":request.options,"input":input})).unwrap()
}
#[tokio::test]
async fn report_owner_db_contract_validates_every_page_commits_atomically_and_replays_receipt() {
    use crate::course::domain::{
        CourseId, ExternalReservationReportEntry, ReservationReportDayPart,
    };
    use chrono::{Duration, NaiveDate};
    let pool = crate::test_support::test_pool().await;
    let tenant = crate::test_support::test_tenant("common-owner");
    let repo = MySqlReservationReportRepository::new(pool.clone());
    let entries = [("source-a", Some("course-old")), ("source-b", None)].map(|(key, course)| {
        ExternalReservationReportEntry::new(
            &ReservationReportRow::new(
                key,
                key,
                NaiveDate::from_ymd_opt(2025, 1, 1).unwrap(),
                ReservationReportDayPart::Morning,
                4,
                1,
            )
            .unwrap(),
            course.map(CourseId::new),
            "old-source",
        )
    });
    repo.seed(&tenant, &entries).await.unwrap();
    let current = Arc::new(Mutex::new(Value::Null));
    let catalog = Arc::new(Mutex::new(
        json!({"items":[{"id":"course-old","name":"旧コース","isActive":true},{"id":"course-new","name":"新コース","isActive":true}]}),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new()
        .route("/*path", get(field_fixture))
        .with_state(FieldFixture {
            tenant: tenant.clone(),
            current: current.clone(),
            catalog: catalog.clone(),
        });
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let state = AppState::new_with_cancellation_fee_config(
        pool.clone(),
        Arc::new(StaticBearerVerifier::new("unused".into())),
        CancellationFeeConfig {
            field_api_url: Some(format!("http://{address}")),
            ..Default::default()
        },
    );
    let request = OwnerRequest {
        job_id: "dtj_owner_contract".into(),
        actor_id: "actor-a".into(),
        source_sha256: "a".repeat(64),
        options: json!({"sourceApp":"courseboard","platformId":"platform-a","year":2026,"courseMappings":{"source-a":"course-new"}}),
        input: Value::Null,
    };
    let total = 205;
    let mut rows = Vec::new();
    for page in 0..3 {
        let input = json!({"headers":["施設名","日付","午前・午後","組数","キャディ付き組数"],"rows":(page*100..((page+1)*100).min(total)).map(|i|json!({"source_row_number":i+47,"values":["source-a",(NaiveDate::from_ymd_opt(2026,1,1).unwrap()+Duration::days(i as i64)).to_string(),"午前","12","3"]})).collect::<Vec<_>>()});
        let result = invoke(
            &state,
            &tenant,
            "subject-a",
            "validate",
            with_input(&request, input),
        )
        .await
        .unwrap();
        assert_eq!(result["errors"], json!([]));
        rows.extend(result["rows"].as_array().unwrap().iter().cloned());
    }
    assert_eq!(rows[0]["number"], 47);
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM golf_reservation_report_rows WHERE tenant_id=?")
            .bind(&tenant)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 2, "validation must not change business rows");
    assert!(invoke(
        &state,
        &tenant,
        "subject-b",
        "ready",
        with_input(&request, json!({"total":total}))
    )
    .await
    .is_err());
    assert!(invoke(
        &state,
        "foreign-tenant",
        "subject-a",
        "ready",
        with_input(&request, json!({"total":total}))
    )
    .await
    .is_err());
    assert!(invoke(
        &state,
        &tenant,
        "subject-a",
        "ready",
        with_input(&request, json!({"total":total+1}))
    )
    .await
    .is_err());
    invoke(
        &state,
        &tenant,
        "subject-a",
        "ready",
        with_input(&request, json!({"total":total})),
    )
    .await
    .unwrap();
    *current.lock().unwrap() = json!({"objectKey":"courseboardReservationReports","kind":"import","status":"running","actorId":request.actor_id,"sourceSha256":request.source_sha256,"importOptions":request.options,"processed":total,"total":total});
    assert!(invoke(
        &state,
        &tenant,
        "subject-a",
        "finish",
        with_input(&request, json!({"total":total}))
    )
    .await
    .is_err());
    for row in &rows {
        invoke(
            &state,
            &tenant,
            "subject-a",
            "stage",
            with_input(&request, json!({"row":row})),
        )
        .await
        .unwrap();
    }
    let result = invoke(
        &state,
        &tenant,
        "subject-a",
        "finish",
        with_input(&request, json!({"total":total})),
    )
    .await
    .unwrap();
    assert_eq!(result["createdCount"], total);
    let counts:Vec<(String,i64)>=sqlx::query_as("SELECT bucket,COUNT(*) FROM golf_reservation_report_rows WHERE tenant_id=? GROUP BY bucket ORDER BY bucket").bind(&tenant).fetch_all(&pool).await.unwrap();
    assert_eq!(
        counts,
        vec![
            ("course-new".into(), total as i64),
            ("unlinked:source-b".into(), 1)
        ]
    );
    sqlx::query("UPDATE golf_reservation_report_rows SET group_count=99 WHERE tenant_id=? AND bucket='course-new' AND report_date='2026-01-01'").bind(&tenant).execute(&pool).await.unwrap();
    assert_eq!(
        invoke(
            &state,
            &tenant,
            "subject-a",
            "finish",
            with_input(&request, json!({"total":total}))
        )
        .await
        .unwrap(),
        result
    );
    let count:i64=sqlx::query_scalar("SELECT group_count FROM golf_reservation_report_rows WHERE tenant_id=? AND bucket='course-new' AND report_date='2026-01-01'").bind(&tenant).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 99, "receipt replay must preserve a newer edit");
    let active_catalog = catalog.lock().unwrap().clone();
    for changed_catalog in [
        json!({"items":[{"id":"course-new","name":"新コース","isActive":false}]}),
        Value::Null,
    ] {
        *catalog.lock().unwrap() = changed_catalog;
        assert_eq!(
            invoke(
                &state,
                &tenant,
                "subject-a",
                "finish",
                with_input(&request, json!({"total":total}))
            )
            .await
            .unwrap(),
            result
        );
        assert!(matches!(
            invoke(
                &state,
                &tenant,
                "subject-b",
                "finish",
                with_input(&request, json!({"total":total}))
            )
            .await,
            Err(AppError::Forbidden)
        ));
        let mut wrong_source = with_input(&request, json!({"total":total}));
        wrong_source.source_sha256 = "b".repeat(64);
        assert!(matches!(
            invoke(&state, &tenant, "subject-a", "finish", wrong_source).await,
            Err(AppError::Forbidden)
        ));
    }
    *catalog.lock().unwrap() = active_catalog;
    // A second preview cannot overwrite a facility edited after validation.
    let mut second = with_input(&request, Value::Null);
    second.job_id = "dtj_owner_conflict".into();
    let input = json!({"headers":["施設名","日付","午前・午後","組数","キャディ付き組数"],"rows":[{"source_row_number":47,"values":["source-a","2026-01-01","午前","12","3"]}]});
    let row = invoke(
        &state,
        &tenant,
        "subject-a",
        "validate",
        with_input(&second, input),
    )
    .await
    .unwrap()["rows"][0]
        .clone();
    invoke(
        &state,
        &tenant,
        "subject-a",
        "ready",
        with_input(&second, json!({"total":1})),
    )
    .await
    .unwrap();
    current.lock().unwrap()["processed"] = json!(1);
    current.lock().unwrap()["total"] = json!(1);
    invoke(
        &state,
        &tenant,
        "subject-a",
        "stage",
        with_input(&second, json!({"row":row})),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE golf_reservation_report_rows SET group_count=100 WHERE tenant_id=? AND bucket='course-new' AND report_date='2026-01-01'").bind(&tenant).execute(&pool).await.unwrap();
    assert!(matches!(
        invoke(
            &state,
            &tenant,
            "subject-a",
            "finish",
            with_input(&second, json!({"total":1}))
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM golf_reservation_report_rows WHERE tenant_id=? AND bucket='course-new'").bind(&tenant).fetch_one(&pool).await.unwrap();
    assert_eq!(
        count, total as i64,
        "failed replacement must retain every previous row"
    );
    server.abort();
}
