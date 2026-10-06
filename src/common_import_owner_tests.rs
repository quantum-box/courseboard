use super::*;

fn request() -> OwnerRequest {
    OwnerRequest {
        job_id: "dtj_test".into(),
        actor_id: "actor".into(),
        source_sha256: "a".repeat(64),
        options: json!({"sourceApp":"courseboard","year":2026,"columnMappings":{},"courseMappings":{}}),
        input: Value::Null,
    }
}
fn table() -> Table {
    Table {
        headers: vec!["施設名", "日付", "午前・午後", "組数", "キャディ付き組数"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        rows: vec![TableRow {
            source_row_number: 47,
            values: vec!["真駒内", "2026-07-18", "午前", "12", "3"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        }],
    }
}
#[test]
fn common_import_preserves_year_aliases_unlinked_facilities_and_source_identity() {
    let mut request = request();
    let table = table();
    let object = normalized(&request, &table, &table.rows[0]).unwrap();
    assert_eq!(object["dayPart"], "morning");
    assert_eq!(object["groupCount"], 12);
    assert!(object["golfCourseId"].is_null());
    assert!(object["bucket"].as_str().unwrap().starts_with("unlinked:"));
    request.options["courseMappings"] = json!({"真駒内":"course-1"});
    let linked = normalized(&request, &table, &table.rows[0]).unwrap();
    assert_eq!(linked["bucket"], "course-1");
    assert_eq!(identity(&linked).unwrap(), identity(&object).unwrap());
    request.options["year"] = json!(2025);
    assert!(normalized(&request, &table, &table.rows[0]).is_err());
}
#[test]
fn common_import_manual_columns_are_exact_and_empty_overrides_use_aliases() {
    let mut request = request();
    let mut table = table();
    request.options["columnMappings"] = json!({"date":""});
    assert!(normalized(&request, &table, &table.rows[0]).is_ok());
    table.headers[1] = "対象日".into();
    assert!(normalized(&request, &table, &table.rows[0]).is_err());
    request.options["columnMappings"]["date"] = json!("対象日");
    assert!(normalized(&request, &table, &table.rows[0]).is_ok());
    request.options["columnMappings"]["dayPart"] = json!("対象日");
    assert!(normalized(&request, &table, &table.rows[0]).is_err());
}
#[test]
fn common_import_owning_rules_reject_bad_counts_dates_and_duplicate_courses() {
    let mut request = request();
    let mut table = table();
    table.rows[0].values[3] = "-1".into();
    assert!(normalized(&request, &table, &table.rows[0]).is_err());
    table.rows[0].values[3] = "1.5".into();
    assert!(normalized(&request, &table, &table.rows[0]).is_err());
    request.options["courseMappings"] = json!({"真駒内":"course-1","滝の":"course-1"});
    assert!(mappings(&request.options).is_err());
    request.options["courseMappings"] = json!({" 真駒内 ":"course-1","真駒内":""});
    assert!(mappings(&request.options).is_err());
}
#[test]
fn common_import_legacy_excel_keeps_physical_rows_and_refuses_changed_source() {
    let bytes = include_bytes!(
        "../tests/fixtures/日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx"
    );
    let mut request = request();
    request.source_sha256 = digest(bytes);
    request.input = json!({"filename":"report.xlsx","contentBase64":base64::engine::general_purpose::STANDARD.encode(bytes)});
    let csv = source(&request).unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(csv["contentBase64"].as_str().unwrap())
        .unwrap();
    let csv = String::from_utf8(bytes).unwrap();
    assert!(csv.starts_with(
        "facilityName,date,dayPart,groupCount,caddieAttachedGroupCount,__bridgeSourceRowNumber\n"
    ));
    let mut records = csv::Reader::from_reader(csv.as_bytes());
    let records = records.records().collect::<Result<Vec<_>, _>>().unwrap();
    assert!(!records.is_empty());
    assert!(records
        .iter()
        .all(|row| row.get(5).unwrap().parse::<usize>().unwrap() >= 2));
    assert!(csv.contains(",morning,"));
    assert!(csv.contains(",afternoon,"));
    request.source_sha256 = "b".repeat(64);
    assert!(source(&request).is_err());
}
#[test]
fn common_import_wire_contract_rejects_callback_and_bearer_injection() {
    assert!(serde_json::from_value::<OwnerRequest>(json!({"jobId":"dtj_test","actorId":"actor","sourceSha256":"a".repeat(64),"options":{},"input":{},"callbackUrl":"https://untrusted.example"})).is_err());
    let table: Table = serde_json::from_value(
        json!({"headers":["施設名"],"rows":[{"source_row_number":47,"values":["真駒内"]}]}),
    )
    .unwrap();
    assert_eq!(table.rows[0].source_row_number, 47);
}
