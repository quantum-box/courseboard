//! Parse, preview, and persist the daily reservation-status workbook.

use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    sync::Arc,
};

use calamine::{open_workbook_from_rs, Data, DataType, Reader, Xlsx};
use chrono::{Datelike, Duration, NaiveDate};
use sha2::{Digest, Sha256};

use crate::course::domain::{
    CourseError, CourseId, ExternalReservationReportEntry, GatewayCredentials, GolfCatalogGateway,
    ReservationReport, ReservationReportAnalyzeGateway, ReservationReportDayPart,
    ReservationReportFacility, ReservationReportGateway, ReservationReportRow,
    ReservationReportUpsertSummary, TabularAnalyzeMapping, TabularAnalyzeMappingField,
    TabularAnalyzeResult,
};

pub const MAX_RESERVATION_REPORT_BYTES: usize = 5 * 1024 * 1024;
const SHEET_NAME: &str = "日別予約状況";
const TARGET_FIELDS: [&str; 5] = [
    "facilityName",
    "date",
    "dayPart",
    "groupCount",
    "caddieAttachedGroupCount",
];

/// A parsed report and, when the provider fallback was used, the mapping
/// evidence that should be shown to the operator.
#[derive(Debug, Clone)]
pub struct ReservationReportPreview {
    report: ReservationReport,
    tabular_analysis: Option<TabularAnalyzeResult>,
}

impl ReservationReportPreview {
    pub fn report(&self) -> &ReservationReport {
        &self.report
    }

    pub fn tabular_analysis(&self) -> Option<&TabularAnalyzeResult> {
        self.tabular_analysis.as_ref()
    }
}

/// Fingerprint the normalized rows and the provider's source-to-target
/// mapping.  The raw file hash is not enough for OCR/AI inputs because a
/// second analysis of the same PDF can produce different normalized values.
/// This canonical digest is sent back with the import confirmation and is
/// compared after the server re-analyzes the original file.
pub fn normalized_reservation_report_fingerprint(
    report: &ReservationReport,
    analysis: Option<&TabularAnalyzeResult>,
) -> String {
    let mut hasher = Sha256::new();
    hash_fingerprint_part(&mut hasher, "reservation-report-fingerprint-v1");
    if let Some(analysis) = analysis {
        hash_fingerprint_part(&mut hasher, "mapping");
        let mut fields = analysis
            .mapping()
            .fields()
            .iter()
            .map(|field| (field.source(), field.target()))
            .collect::<Vec<_>>();
        fields.sort_unstable();
        for (source, target) in fields {
            hash_fingerprint_part(&mut hasher, source);
            hash_fingerprint_part(&mut hasher, target);
        }
    } else {
        hash_fingerprint_part(&mut hasher, "fixed-parser");
    }
    hash_fingerprint_part(&mut hasher, "facilities");
    let mut facilities = report.facilities().iter().collect::<Vec<_>>();
    facilities.sort_by_key(|facility| facility.source_course_key());
    for facility in facilities {
        hash_fingerprint_part(&mut hasher, facility.source_course_key());
        hash_fingerprint_part(&mut hasher, facility.source_course_name());
    }
    hash_fingerprint_part(&mut hasher, "rows");
    let mut rows = report.rows().iter().collect::<Vec<_>>();
    rows.sort_by_key(|row| (row.source_course_key(), row.date(), row.day_part().as_str()));
    for row in rows {
        hash_fingerprint_part(&mut hasher, row.source_course_key());
        hash_fingerprint_part(&mut hasher, &row.date().to_string());
        hash_fingerprint_part(&mut hasher, row.day_part().as_str());
        hash_fingerprint_part(&mut hasher, &row.group_count().to_string());
        hash_fingerprint_part(&mut hasher, &row.caddie_attached_group_count().to_string());
    }
    format!("{:x}", hasher.finalize())
}

fn hash_fingerprint_part(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}

/// A source-course to CourseBoard-course mapping selected by the operator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationReportCourseMapping {
    pub source_course_key: String,
    pub golf_course_id: CourseId,
}

impl ReservationReportCourseMapping {
    pub fn new(source_course_key: impl Into<String>, golf_course_id: impl Into<String>) -> Self {
        Self {
            source_course_key: source_course_key.into(),
            golf_course_id: CourseId::new(golf_course_id),
        }
    }
}

/// Parse one workbook.  The parser is intentionally strict about the sheet
/// and header layout: a changed report is rejected instead of being guessed.
pub fn parse_reservation_report(
    bytes: &[u8],
    year: i32,
    filename: Option<&str>,
) -> Result<ReservationReport, CourseError> {
    if bytes.is_empty() || bytes.len() > MAX_RESERVATION_REPORT_BYTES {
        return Err(CourseError::BadRequest(
            "reservation report file must be at most 5 MiB",
        ));
    }
    if let Some(filename) = filename {
        let is_xlsx = filename
            .rsplit_once('.')
            .map(|(_, ext)| ext.eq_ignore_ascii_case("xlsx"))
            .unwrap_or(false);
        if !is_xlsx {
            return Err(CourseError::BadRequest(
                "reservation report must be an xlsx file",
            ));
        }
    }
    // XLSX is a ZIP package.  Checking the signature prevents calamine's
    // auto-detection from accepting an old XLS/ODS file sent with an xlsx name.
    if bytes.len() < 4 || &bytes[..2] != b"PK" {
        return Err(CourseError::BadRequest(
            "reservation report must be an xlsx file",
        ));
    }
    if !(1..=9999).contains(&year) {
        return Err(CourseError::BadRequest("year must be between 1 and 9999"));
    }

    let mut workbook: Xlsx<Cursor<Vec<u8>>> = open_workbook_from_rs(Cursor::new(bytes.to_vec()))
        .map_err(|_| CourseError::BadRequest("reservation report workbook is invalid"))?;
    if workbook.sheet_names().len() != 1
        || workbook.sheet_names().first().map(String::as_str) != Some(SHEET_NAME)
    {
        return Err(CourseError::BadRequest(
            "reservation report must contain only the 日別予約状況 sheet",
        ));
    }
    let range = workbook
        .worksheet_range(SHEET_NAME)
        .map_err(|_| CourseError::BadRequest("reservation report sheet is invalid"))?;
    let (height, width) = range.get_size();
    if height < 3 || width < 7 || (width - 5) % 2 != 0 {
        return Err(CourseError::BadRequest(
            "reservation report columns are invalid",
        ));
    }

    require_text(&range, 0, 0, "ゴルフ場")?;
    require_text(&range, 0, 1, "項目")?;
    require_text(&range, 0, 2, "時間帯")?;
    require_text(&range, 0, 3, "合計")?;
    require_text(&range, 1, 3, "組数")?;
    require_text_any(&range, 1, 4, &["ｷｬ付", "キャ付"])?;

    let mut dates = Vec::new();
    for col in (5..width).step_by(2) {
        let Some(header) = cell_string(range.get((0, col))) else {
            return Err(CourseError::BadRequest(
                "reservation report date headers are invalid",
            ));
        };
        if !cell_is_empty(range.get((0, col + 1))) {
            return Err(CourseError::BadRequest(
                "reservation report date columns must be paired",
            ));
        }
        require_text(&range, 1, col, "組数")?;
        require_text_any(&range, 1, col + 1, &["ｷｬ付", "キャ付"])?;
        let date = parse_header_date(&header, year)?;
        if dates.contains(&date) {
            return Err(CourseError::BadRequest(
                "reservation report has duplicate dates",
            ));
        }
        dates.push(date);
    }
    if dates.is_empty() || dates.len() > 31 {
        return Err(CourseError::BadRequest(
            "reservation report date columns are invalid",
        ));
    }

    let mut facilities = Vec::new();
    let mut rows = Vec::new();
    let mut source_keys = HashSet::new();
    let facility_starts: Vec<usize> = (2..height)
        .filter(|row| cell_string(range.get((*row, 0))).is_some())
        .collect();
    for (index, start) in facility_starts.iter().copied().enumerate() {
        let name = cell_string(range.get((start, 0))).ok_or(CourseError::BadRequest(
            "reservation report facility name is required",
        ))?;
        let source_key = normalize_course_key(&name);
        if source_key.is_empty() {
            return Err(CourseError::BadRequest(
                "reservation report facility name is required",
            ));
        }
        let block_end = facility_starts.get(index + 1).copied().unwrap_or(height);
        if source_key == "全体" {
            // The overall block duplicates the individual facilities and is
            // intentionally never persisted.
            continue;
        }
        if !source_keys.insert(source_key.clone()) {
            return Err(CourseError::BadRequest(
                "reservation report has duplicate facilities",
            ));
        }
        let Some(current_year_row) = (start..block_end)
            .find(|row| cell_string(range.get((*row, 1))).as_deref() == Some("本年"))
        else {
            return Err(CourseError::BadRequest(
                "reservation report 本年 rows are missing",
            ));
        };
        if current_year_row + 2 >= block_end
            || cell_string(range.get((current_year_row, 2))).as_deref() != Some("午前")
            || cell_string(range.get((current_year_row + 1, 2))).as_deref() != Some("午後")
            || cell_string(range.get((current_year_row + 2, 2))).as_deref() != Some("合計")
        {
            return Err(CourseError::BadRequest(
                "reservation report 本年 rows are invalid",
            ));
        }
        facilities.push(ReservationReportFacility::new(
            source_key.clone(),
            name.clone(),
        ));

        for (date_index, date) in dates.iter().copied().enumerate() {
            let col = 5 + date_index * 2;
            for (row, day_part) in [
                (current_year_row, ReservationReportDayPart::Morning),
                (current_year_row + 1, ReservationReportDayPart::Afternoon),
            ] {
                let group_count = parse_count(range.get((row, col)))?;
                let caddie_count = parse_count(range.get((row, col + 1)))?;
                rows.push(ReservationReportRow::new(
                    source_key.clone(),
                    name.clone(),
                    date,
                    day_part,
                    group_count,
                    caddie_count,
                )?);
            }
        }
    }
    if facilities.is_empty() {
        return Err(CourseError::BadRequest(
            "reservation report contains no facilities",
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let source_file_sha256 = format!("{:x}", hasher.finalize());
    ReservationReport::new(source_file_sha256, facilities, rows)
}

fn require_text(
    range: &calamine::Range<Data>,
    row: usize,
    col: usize,
    expected: &str,
) -> Result<(), CourseError> {
    if cell_string(range.get((row, col))).as_deref() != Some(expected) {
        return Err(CourseError::BadRequest(
            "reservation report headers are invalid",
        ));
    }
    Ok(())
}

fn require_text_any(
    range: &calamine::Range<Data>,
    row: usize,
    col: usize,
    expected: &[&str],
) -> Result<(), CourseError> {
    let actual = cell_string(range.get((row, col)));
    if !actual
        .as_deref()
        .map(|value| expected.iter().any(|candidate| candidate == &value))
        .unwrap_or(false)
    {
        return Err(CourseError::BadRequest(
            "reservation report headers are invalid",
        ));
    }
    Ok(())
}

fn cell_is_empty(cell: Option<&Data>) -> bool {
    cell.map(DataType::is_empty).unwrap_or(true)
}

fn cell_string(cell: Option<&Data>) -> Option<String> {
    let cell = cell?;
    cell.get_string()
        .map(str::to_string)
        .or_else(|| cell.get_int().map(|value| value.to_string()))
        .or_else(|| cell.get_float().map(|value| value.to_string()))
}

fn parse_count(cell: Option<&Data>) -> Result<i64, CourseError> {
    let value = cell.ok_or(CourseError::BadRequest(
        "reservation report count is missing",
    ))?;
    let count = match value {
        Data::Int(value) => *value,
        Data::Float(value)
            if value.is_finite()
                && value.fract() == 0.0
                && *value >= 0.0
                && *value <= i64::MAX as f64 =>
        {
            *value as i64
        }
        Data::String(value) => value
            .trim()
            .parse::<i64>()
            .map_err(|_| CourseError::BadRequest("reservation report count is invalid"))?,
        _ => {
            return Err(CourseError::BadRequest(
                "reservation report count is invalid",
            ))
        }
    };
    if count < 0 {
        return Err(CourseError::BadRequest(
            "reservation report counts must be non-negative",
        ));
    }
    Ok(count)
}

fn parse_header_date(raw: &str, year: i32) -> Result<NaiveDate, CourseError> {
    let first_line = raw.lines().next().unwrap_or(raw).trim();
    let (month_raw, day_with_suffix) = first_line.split_once('/').ok_or(
        CourseError::BadRequest("reservation report date headers are invalid"),
    )?;
    let month: u32 = month_raw
        .parse()
        .map_err(|_| CourseError::BadRequest("reservation report date headers are invalid"))?;
    let day_raw: String = day_with_suffix
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    let day: u32 = day_raw
        .parse()
        .map_err(|_| CourseError::BadRequest("reservation report date headers are invalid"))?;
    NaiveDate::from_ymd_opt(year, month, day).ok_or(CourseError::BadRequest(
        "reservation report date is invalid",
    ))
}

/// Remove report-only whitespace and the trailing hole-count notation (`36H`).
pub fn normalize_course_key(raw: &str) -> String {
    let compact: String = raw.chars().filter(|ch| !ch.is_whitespace()).collect();
    let lower = compact.to_ascii_lowercase();
    let suffix_len = ["h", "ホール", "holes", "hole"]
        .iter()
        .find_map(|suffix| lower.strip_suffix(suffix).map(|value| value.len()));
    if let Some(prefix_len) = suffix_len {
        let prefix = &compact[..prefix_len];
        let digit_start = prefix
            .char_indices()
            .rfind(|(_, ch)| !ch.is_ascii_digit())
            .map(|(index, ch)| index + ch.len_utf8())
            .unwrap_or(0);
        if digit_start < prefix.len() {
            return prefix[..digit_start].to_string();
        }
    }
    compact
}

pub struct PreviewReservationReportUseCase;

impl PreviewReservationReportUseCase {
    pub fn execute(
        bytes: &[u8],
        year: i32,
        filename: Option<&str>,
    ) -> Result<ReservationReport, CourseError> {
        parse_reservation_report(bytes, year, filename)
    }

    /// Keep the strict fixed report parser as the first path.  Any supported
    /// tabular format that is not that report is sent to Field's analyzer, and
    /// its row/mapping result is converted into the same CourseBoard domain
    /// invariants before it can reach the preview or import gateway.
    pub async fn execute_with_fallback(
        credentials: GatewayCredentials<'_>,
        analyzer: &dyn ReservationReportAnalyzeGateway,
        bytes: &[u8],
        year: i32,
        filename: Option<&str>,
        column_mappings: Option<&HashMap<String, String>>,
    ) -> Result<ReservationReportPreview, CourseError> {
        if bytes.is_empty() || bytes.len() > MAX_RESERVATION_REPORT_BYTES {
            return parse_reservation_report(bytes, year, filename).map(|report| {
                ReservationReportPreview {
                    report,
                    tabular_analysis: None,
                }
            });
        }
        if !(1..=9999).contains(&year) {
            return Err(CourseError::BadRequest("year must be between 1 and 9999"));
        }
        match parse_reservation_report(bytes, year, filename) {
            Ok(report) => Ok(ReservationReportPreview {
                report,
                tabular_analysis: None,
            }),
            Err(_) => {
                let analysis = analyzer
                    .analyze_tabular(credentials, bytes, filename, year)
                    .await?;
                let analysis = match column_mappings {
                    Some(mappings) => apply_user_column_mappings(analysis, mappings)?,
                    None => analysis,
                };
                let report = reservation_report_from_tabular(bytes, year, &analysis)?;
                Ok(ReservationReportPreview {
                    report,
                    tabular_analysis: Some(analysis),
                })
            }
        }
    }
}

/// Replace provider suggestions with the exact source-to-CourseBoard mapping
/// explicitly approved by the operator. The raw rows still come from Field and
/// are revalidated below before they become CourseBoard values.
fn apply_user_column_mappings(
    analysis: TabularAnalyzeResult,
    mappings: &HashMap<String, String>,
) -> Result<TabularAnalyzeResult, CourseError> {
    if mappings.len() != TARGET_FIELDS.len() {
        return Err(CourseError::BadRequest(
            "every CourseBoard reservation field must have one column mapping",
        ));
    }
    let mut used_sources = HashSet::new();
    let mut fields = Vec::with_capacity(TARGET_FIELDS.len());
    for target in TARGET_FIELDS {
        let source = mappings
            .get(target)
            .map(String::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or(CourseError::BadRequest(
                "every CourseBoard reservation field must have one column mapping",
            ))?;
        let source_index = resolve_source_index(&analysis, source)?;
        if !used_sources.insert(source_index) {
            return Err(CourseError::BadRequest(
                "column mappings must use distinct source columns",
            ));
        }
        let samples = analysis
            .rows()
            .iter()
            .filter_map(|row| row.values().get(source_index))
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .take(5)
            .map(ToString::to_string)
            .collect();
        fields.push(TabularAnalyzeMappingField::new(
            analysis.headers()[source_index].clone(),
            target,
            true,
            1.0,
            "approved by the CourseBoard operator",
            samples,
        )?);
    }
    let mapping = TabularAnalyzeMapping::new(
        "user",
        fields,
        Some("The operator approved this column mapping in CourseBoard.".into()),
    )?;
    TabularAnalyzeResult::new(
        analysis.source_type().to_string(),
        analysis.sheet_names().to_vec(),
        analysis.selected_sheet().map(str::to_string),
        analysis.header_row(),
        analysis.headers().to_vec(),
        analysis.rows().to_vec(),
        mapping,
        analysis.warnings().to_vec(),
    )
}

fn reservation_report_from_tabular(
    bytes: &[u8],
    year: i32,
    analysis: &TabularAnalyzeResult,
) -> Result<ReservationReport, CourseError> {
    let indexes = mapping_indexes(analysis)?;
    let mut facilities = Vec::new();
    let mut facility_names = HashMap::<String, String>::new();
    let mut rows = Vec::new();
    let mut row_keys = HashSet::new();

    for source_row in analysis.rows() {
        let values = source_row.values();
        let facility_name = mapped_value(values, indexes.facility_name, "facilityName")?;
        if facility_name.trim().is_empty() {
            return Err(CourseError::BadRequest(
                "tabular reservation row has no facility",
            ));
        }
        let source_course_key = normalize_course_key(facility_name);
        if source_course_key == "全体" {
            continue;
        }
        if source_course_key.is_empty() {
            return Err(CourseError::BadRequest(
                "tabular reservation facility is invalid",
            ));
        }
        let date = parse_tabular_date(mapped_value(values, indexes.date, "date")?, year)?;
        let day_part = parse_tabular_day_part(mapped_value(values, indexes.day_part, "dayPart")?)?;
        let group_count = parse_tabular_count(
            mapped_value(values, indexes.group_count, "groupCount")?,
            "groupCount",
        )?;
        let caddie_count = parse_tabular_count(
            mapped_value(
                values,
                indexes.caddie_attached_group_count,
                "caddieAttachedGroupCount",
            )?,
            "caddieAttachedGroupCount",
        )?;
        let key = format!("{source_course_key}:{date}:{}", day_part.as_str());
        if !row_keys.insert(key) {
            return Err(CourseError::BadRequest(
                "tabular reservation report has duplicate facility/date/day-part rows",
            ));
        }
        let source_course_name = facility_names
            .entry(source_course_key.clone())
            .or_insert_with(|| facility_name.trim().to_string())
            .clone();
        rows.push(ReservationReportRow::new(
            source_course_key,
            source_course_name,
            date,
            day_part,
            group_count,
            caddie_count,
        )?);
    }

    facilities.extend(
        facility_names
            .into_iter()
            .map(|(key, name)| ReservationReportFacility::new(key, name)),
    );
    facilities.sort_by(|left, right| left.source_course_key().cmp(right.source_course_key()));
    if rows.is_empty() {
        return Err(CourseError::BadRequest(
            "tabular reservation report contains no facility rows",
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    ReservationReport::new(format!("{:x}", hasher.finalize()), facilities, rows)
        .map(|report| report.with_source_system(analysis.source_type()))
}

struct MappingIndexes {
    facility_name: usize,
    date: usize,
    day_part: usize,
    group_count: usize,
    caddie_attached_group_count: usize,
}

fn mapping_indexes(analysis: &TabularAnalyzeResult) -> Result<MappingIndexes, CourseError> {
    let mut indexes = HashMap::<&str, usize>::new();
    let mut source_indexes = HashSet::new();
    for field in analysis.mapping().fields() {
        let target = field.target();
        if !TARGET_FIELDS.contains(&target) {
            continue;
        }
        let source_index = resolve_source_index(analysis, field.source())?;
        if !source_indexes.insert(source_index) {
            return Err(CourseError::BadRequest(
                "tabular mapping uses the same source column more than once",
            ));
        }
        if indexes.insert(target, source_index).is_some() {
            return Err(CourseError::BadRequest(
                "tabular mapping contains duplicate target",
            ));
        }
    }
    let required = TARGET_FIELDS
        .iter()
        .filter(|target| !indexes.contains_key(**target))
        .copied()
        .collect::<Vec<_>>();
    if !required.is_empty() {
        return Err(CourseError::BadRequest(
            "tabular mapping is missing required fields",
        ));
    }
    Ok(MappingIndexes {
        facility_name: indexes["facilityName"],
        date: indexes["date"],
        day_part: indexes["dayPart"],
        group_count: indexes["groupCount"],
        caddie_attached_group_count: indexes["caddieAttachedGroupCount"],
    })
}

fn resolve_source_index(
    analysis: &TabularAnalyzeResult,
    source: &str,
) -> Result<usize, CourseError> {
    let normalized = source.trim().to_ascii_lowercase();
    let matching_indexes = analysis
        .headers()
        .iter()
        .enumerate()
        .filter_map(|(index, header)| {
            (header.trim().to_ascii_lowercase() == normalized).then_some(index)
        })
        .collect::<Vec<_>>();
    match matching_indexes.as_slice() {
        [index] => return Ok(*index),
        [_, _, ..] => {
            return Err(CourseError::BadRequest(
                "tabular report contains duplicate source headers",
            ))
        }
        [] => {}
    }
    if let Some(index) = normalized
        .strip_prefix("column_")
        .and_then(|value| value.parse::<usize>().ok())
    {
        if index < analysis.headers().len() {
            return Ok(index);
        }
    }
    if let Ok(one_based) = normalized.parse::<usize>() {
        if one_based > 0 && one_based <= analysis.headers().len() {
            return Ok(one_based - 1);
        }
    }
    Err(CourseError::BadRequest(
        "tabular mapping source is not a report header",
    ))
}

fn mapped_value<'a>(
    values: &'a [String],
    index: usize,
    _target: &str,
) -> Result<&'a str, CourseError> {
    values
        .get(index)
        .map(String::as_str)
        .ok_or(CourseError::BadRequest(
            "tabular row is missing a mapped value",
        ))
}

fn parse_tabular_day_part(value: &str) -> Result<ReservationReportDayPart, CourseError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "morning" | "am" | "a.m." | "午前" => Ok(ReservationReportDayPart::Morning),
        "afternoon" | "pm" | "p.m." | "午後" => Ok(ReservationReportDayPart::Afternoon),
        _ => Err(CourseError::BadRequest(
            "tabular reservation day part must be morning or afternoon",
        )),
    }
}

fn parse_tabular_count(value: &str, _target: &str) -> Result<i64, CourseError> {
    let raw = value.trim().replace('，', ",");
    if raw.contains(',') {
        let mut groups = raw.split(',');
        let first = groups.next().unwrap_or_default();
        if first.is_empty()
            || first.len() > 3
            || !first.chars().all(|character| character.is_ascii_digit())
            || groups.any(|group| {
                group.len() != 3 || !group.chars().all(|character| character.is_ascii_digit())
            })
        {
            return Err(CourseError::BadRequest(
                "tabular reservation count has invalid digit separators",
            ));
        }
    }
    let normalized = raw.replace(',', "");
    if normalized.is_empty() {
        return Err(CourseError::BadRequest(
            "tabular reservation count is missing",
        ));
    }
    if let Ok(count) = normalized.parse::<i64>() {
        if count >= 0 {
            return Ok(count);
        }
    }
    if let Ok(value) = normalized.parse::<f64>() {
        if value.is_finite() && value.fract() == 0.0 && (0.0..=i64::MAX as f64).contains(&value) {
            return Ok(value as i64);
        }
    }
    Err(CourseError::BadRequest(
        "tabular reservation count is invalid",
    ))
}

fn parse_tabular_date(value: &str, year: i32) -> Result<NaiveDate, CourseError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CourseError::BadRequest(
            "tabular reservation date is missing",
        ));
    }
    let excel_serial = trimmed.parse::<i64>().ok().or_else(|| {
        trimmed.parse::<f64>().ok().and_then(|value| {
            (value.is_finite()
                && value.fract() == 0.0
                && value >= i64::MIN as f64
                && value <= i64::MAX as f64)
                .then_some(value as i64)
        })
    });
    if let Some(serial) = excel_serial {
        if (20_000..=100_000).contains(&serial) {
            let date = NaiveDate::from_ymd_opt(1899, 12, 30)
                .and_then(|base| base.checked_add_signed(Duration::days(serial)))
                .ok_or(CourseError::BadRequest(
                    "tabular reservation date is invalid",
                ))?;
            if date.year() == year {
                return Ok(date);
            }
        }
    }
    let first_line = trimmed
        .lines()
        .next()
        .unwrap_or(trimmed)
        .split(['(', '（'])
        .next()
        .unwrap_or(trimmed)
        .trim()
        .trim_end_matches([')', '）']);
    for format in ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"] {
        if let Ok(date) = NaiveDate::parse_from_str(first_line, format) {
            if date.year() != year {
                return Err(CourseError::BadRequest(
                    "tabular reservation date year does not match report year",
                ));
            }
            return Ok(date);
        }
    }
    let (month, day) = if let Some((month, day)) = first_line.split_once('/') {
        (month, day)
    } else if let Some((month, day)) = first_line.split_once('月') {
        (month, day.trim_end_matches('日'))
    } else {
        return Err(CourseError::BadRequest(
            "tabular reservation date is invalid",
        ));
    };
    let month = month
        .trim()
        .parse::<u32>()
        .map_err(|_| CourseError::BadRequest("tabular reservation date is invalid"))?;
    let day = day
        .trim()
        .trim_end_matches('日')
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>()
        .parse::<u32>()
        .map_err(|_| CourseError::BadRequest("tabular reservation date is invalid"))?;
    NaiveDate::from_ymd_opt(year, month, day).ok_or(CourseError::BadRequest(
        "tabular reservation date is invalid",
    ))
}

pub struct ImportReservationReportUseCase {
    gateway: Arc<dyn ReservationReportGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ImportReservationReportUseCase {
    pub fn new(
        gateway: Arc<dyn ReservationReportGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self { gateway, catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        report: &ReservationReport,
        mappings: &[ReservationReportCourseMapping],
    ) -> Result<ReservationReportUpsertSummary, CourseError> {
        if credentials.operator_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }
        // Validate the browser-supplied shape before reaching the provider.
        // The catalog check below is an additional server-side ownership
        // check, not a substitute for mapping completeness/uniqueness.
        let entries = mapped_entries(report, mappings)?;
        let courses = self.catalog.list_courses(credentials).await?;
        let active_course_ids: HashSet<&str> = courses
            .iter()
            .filter(|course| course.is_active())
            .map(|course| course.id().as_str())
            .collect();
        for mapping in mappings {
            if !active_course_ids.contains(mapping.golf_course_id.as_str()) {
                return Err(CourseError::BadRequest(
                    "course mapping must target an active course",
                ));
            }
        }
        self.gateway
            .upsert_entries(credentials, &entries, &courses)
            .await
    }
}

fn mapped_entries(
    report: &ReservationReport,
    mappings: &[ReservationReportCourseMapping],
) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
    if mappings.len() != report.facilities().len() {
        return Err(CourseError::BadRequest(
            "every source facility must have exactly one course mapping",
        ));
    }
    let mut by_key = HashMap::new();
    let mut course_ids = HashSet::new();
    for mapping in mappings {
        let key = mapping.source_course_key.trim();
        let course_id = mapping.golf_course_id.as_str().trim();
        if key.is_empty() || course_id.is_empty() {
            return Err(CourseError::BadRequest("course mappings cannot be empty"));
        }
        if by_key
            .insert(key.to_string(), mapping.golf_course_id.clone())
            .is_some()
            || !course_ids.insert(course_id.to_string())
        {
            return Err(CourseError::BadRequest(
                "source facilities and courses must be mapped uniquely",
            ));
        }
    }
    for facility in report.facilities() {
        if !by_key.contains_key(facility.source_course_key()) {
            return Err(CourseError::BadRequest(
                "every source facility must have exactly one course mapping",
            ));
        }
    }
    report
        .rows()
        .iter()
        .map(|row| {
            let course_id = by_key
                .get(row.source_course_key())
                .ok_or(CourseError::BadRequest("course mapping is unknown"))?;
            Ok(ExternalReservationReportEntry::new(
                row,
                course_id.clone(),
                report.source_file_sha256(),
            )
            .with_source_system(report.source_system()))
        })
        .collect()
}

pub struct ListReservationReportEntriesUseCase {
    gateway: Arc<dyn ReservationReportGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl ListReservationReportEntriesUseCase {
    pub fn new(
        gateway: Arc<dyn ReservationReportGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self { gateway, catalog }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        from: Option<NaiveDate>,
        to: Option<NaiveDate>,
    ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
        if credentials.operator_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }
        let courses = self.catalog.list_courses(credentials).await?;
        let active_courses = courses
            .into_iter()
            .filter(|course| course.is_active())
            .collect::<Vec<_>>();
        self.gateway
            .list_entries(
                credentials,
                &active_courses,
                crate::course::domain::ReservationReportEntryQuery { from, to }.validate()?,
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{
        TabularAnalyzeMapping, TabularAnalyzeMappingField, TabularAnalyzeRow,
    };

    fn tabular_analysis(rows: Vec<TabularAnalyzeRow>) -> TabularAnalyzeResult {
        let fields = TARGET_FIELDS
            .iter()
            .map(|target| {
                TabularAnalyzeMappingField::new(
                    match *target {
                        "facilityName" => "Facility",
                        "date" => "Date",
                        "dayPart" => "Part",
                        "groupCount" => "Groups",
                        _ => "Caddie groups",
                    },
                    *target,
                    true,
                    0.92,
                    "matched by the provider",
                    Vec::new(),
                )
                .unwrap()
            })
            .collect();
        TabularAnalyzeResult::new(
            "xlsx",
            vec!["Sheet1".into()],
            Some("Sheet1".into()),
            Some(1),
            vec![
                "Facility".into(),
                "Date".into(),
                "Part".into(),
                "Groups".into(),
                "Caddie groups".into(),
            ],
            rows,
            TabularAnalyzeMapping::new("ai", fields, None).unwrap(),
            vec!["A fallback parser was used".into()],
        )
        .unwrap()
    }

    struct FakeAnalyzeGateway {
        result: TabularAnalyzeResult,
    }

    #[async_trait::async_trait]
    impl ReservationReportAnalyzeGateway for FakeAnalyzeGateway {
        async fn analyze_tabular(
            &self,
            _credentials: GatewayCredentials<'_>,
            _bytes: &[u8],
            _filename: Option<&str>,
            _year: i32,
        ) -> Result<TabularAnalyzeResult, CourseError> {
            Ok(self.result.clone())
        }
    }

    #[test]
    fn source_course_key_removes_hole_count_and_whitespace() {
        assert_eq!(normalize_course_key("真駒内\n36H"), "真駒内");
        assert_eq!(normalize_course_key("羊ケ丘 18H"), "羊ケ丘");
        assert_eq!(normalize_course_key("滝の"), "滝の");
    }

    #[test]
    fn invalid_dates_are_rejected() {
        assert!(parse_header_date("2/29(日)", 2025).is_err());
        assert_eq!(
            parse_header_date("7/18(土)", 2026).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 18).unwrap()
        );
    }

    #[test]
    fn mappings_must_cover_each_facility_and_use_distinct_courses() {
        let row = ReservationReportRow::new(
            "真駒内",
            "真駒内\n36H",
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            ReservationReportDayPart::Morning,
            1,
            0,
        )
        .unwrap();
        let report = ReservationReport::new(
            "hash",
            vec![ReservationReportFacility::new("真駒内", "真駒内\n36H")],
            vec![row],
        )
        .unwrap();
        assert!(mapped_entries(&report, &[]).is_err());
        let duplicate = vec![
            ReservationReportCourseMapping::new("真駒内", "course-1"),
            ReservationReportCourseMapping::new("extra", "course-1"),
        ];
        assert!(mapped_entries(&report, &duplicate).is_err());
        let entries = mapped_entries(
            &report,
            &[ReservationReportCourseMapping::new("真駒内", "course-1")],
        )
        .unwrap();
        assert_eq!(entries[0].golf_course_id().as_str(), "course-1");
    }

    #[test]
    fn normalized_fingerprint_changes_when_a_row_changes() {
        let facility = ReservationReportFacility::new("東", "東コース");
        let first_row = ReservationReportRow::new(
            "東",
            "東コース",
            NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
            ReservationReportDayPart::Morning,
            8,
            3,
        )
        .unwrap();
        let changed_row = ReservationReportRow::new(
            "東",
            "東コース",
            NaiveDate::from_ymd_opt(2026, 7, 18).unwrap(),
            ReservationReportDayPart::Morning,
            9,
            3,
        )
        .unwrap();
        let first =
            ReservationReport::new("raw-a", vec![facility.clone()], vec![first_row]).unwrap();
        let changed = ReservationReport::new("raw-b", vec![facility], vec![changed_row]).unwrap();
        let first_fingerprint = normalized_reservation_report_fingerprint(&first, None);
        assert_eq!(
            first_fingerprint,
            normalized_reservation_report_fingerprint(&first, None)
        );
        assert_ne!(
            first_fingerprint,
            normalized_reservation_report_fingerprint(&changed, None)
        );
    }

    #[test]
    fn workbook_limits_and_extension_are_checked_before_parsing() {
        let bytes = vec![b'P', b'K', 0, 0];
        assert!(parse_reservation_report(&bytes, 2026, Some("report.xls")).is_err());
        assert!(parse_reservation_report(
            &vec![0; MAX_RESERVATION_REPORT_BYTES + 1],
            2026,
            Some("report.xlsx"),
        )
        .is_err());
        assert!(parse_reservation_report(
            &vec![0; MAX_RESERVATION_REPORT_BYTES + 1],
            2026,
            Some("report.pdf"),
        )
        .is_err());
    }

    #[tokio::test]
    async fn pdf_fallback_rechecks_mapping_and_domain_values() {
        let rows = vec![
            TabularAnalyzeRow::new(
                2,
                vec![
                    "東コース".into(),
                    "7/18(土)".into(),
                    "午前".into(),
                    "8".into(),
                    "3".into(),
                ],
            )
            .unwrap(),
            TabularAnalyzeRow::new(
                3,
                vec![
                    "東コース".into(),
                    "7/18(土)".into(),
                    "午後".into(),
                    "5".into(),
                    "2".into(),
                ],
            )
            .unwrap(),
        ];
        let gateway = FakeAnalyzeGateway {
            result: tabular_analysis(rows),
        };
        let preview = PreviewReservationReportUseCase::execute_with_fallback(
            GatewayCredentials {
                authorization: "Bearer test",
                operator_id: "tenant",
                platform_id: None,
            },
            &gateway,
            b"%PDF-1.7\nreservation report",
            2026,
            Some("report.pdf"),
            None,
        )
        .await
        .unwrap();
        assert_eq!(preview.report().rows().len(), 2);
        assert_eq!(
            preview.report().rows()[0].date(),
            NaiveDate::from_ymd_opt(2026, 7, 18).unwrap()
        );
        assert_eq!(preview.tabular_analysis().unwrap().mapping().mode(), "ai");
    }

    #[tokio::test]
    async fn tabular_fallback_rejects_caddie_count_above_groups() {
        let gateway = FakeAnalyzeGateway {
            result: tabular_analysis(vec![TabularAnalyzeRow::new(
                2,
                vec![
                    "東".into(),
                    "2026-07-18".into(),
                    "morning".into(),
                    "1".into(),
                    "2".into(),
                ],
            )
            .unwrap()]),
        };
        let error = PreviewReservationReportUseCase::execute_with_fallback(
            GatewayCredentials {
                authorization: "Bearer test",
                operator_id: "tenant",
                platform_id: None,
            },
            &gateway,
            b"not-an-xlsx",
            2026,
            Some("report.xls"),
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            CourseError::BadRequest("caddie-attached groups cannot exceed groups")
        ));
    }

    #[tokio::test]
    async fn operator_column_mapping_overrides_the_ai_candidate() {
        let gateway = FakeAnalyzeGateway {
            result: tabular_analysis(vec![TabularAnalyzeRow::new(
                2,
                vec![
                    "東".into(),
                    "2026-07-18".into(),
                    "morning".into(),
                    "3".into(),
                    "8".into(),
                ],
            )
            .unwrap()]),
        };
        let mappings = HashMap::from([
            ("facilityName".into(), "Facility".into()),
            ("date".into(), "Date".into()),
            ("dayPart".into(), "Part".into()),
            ("groupCount".into(), "Caddie groups".into()),
            ("caddieAttachedGroupCount".into(), "Groups".into()),
        ]);
        let preview = PreviewReservationReportUseCase::execute_with_fallback(
            GatewayCredentials {
                authorization: "Bearer test",
                operator_id: "tenant",
                platform_id: None,
            },
            &gateway,
            b"not-an-xlsx",
            2026,
            Some("report.csv"),
            Some(&mappings),
        )
        .await
        .unwrap();

        assert_eq!(preview.report().rows()[0].group_count(), 8);
        assert_eq!(preview.report().rows()[0].caddie_attached_group_count(), 3);
        assert_eq!(preview.tabular_analysis().unwrap().mapping().mode(), "user");
    }

    #[test]
    fn tabular_numbers_require_valid_separators_and_accept_integral_excel_dates() {
        assert_eq!(parse_tabular_count("1,234", "groupCount").unwrap(), 1234);
        assert!(parse_tabular_count("12,34", "groupCount").is_err());
        assert!(parse_tabular_count("1,,234", "groupCount").is_err());
        assert_eq!(
            parse_tabular_date("46221.0", 2026).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 18).unwrap()
        );
    }

    #[test]
    fn duplicate_source_headers_are_rejected() {
        let base = tabular_analysis(vec![TabularAnalyzeRow::new(
            2,
            vec![
                "東".into(),
                "2026-07-18".into(),
                "2026-07-18".into(),
                "morning".into(),
                "8".into(),
                "3".into(),
            ],
        )
        .unwrap()]);
        let duplicate = TabularAnalyzeResult::new(
            base.source_type().to_string(),
            base.sheet_names().to_vec(),
            base.selected_sheet().map(str::to_string),
            base.header_row(),
            vec![
                "Facility".into(),
                "Date".into(),
                "Date".into(),
                "Part".into(),
                "Groups".into(),
                "Caddie groups".into(),
            ],
            base.rows().to_vec(),
            base.mapping().clone(),
            Vec::new(),
        )
        .unwrap();
        assert!(matches!(
            reservation_report_from_tabular(b"csv", 2026, &duplicate),
            Err(CourseError::BadRequest(
                "tabular report contains duplicate source headers"
            ))
        ));
    }

    #[test]
    fn report_rejects_overflowing_totals() {
        let facility = ReservationReportFacility::new("east", "東");
        let date = NaiveDate::from_ymd_opt(2026, 7, 18).unwrap();
        let rows = vec![
            ReservationReportRow::new(
                "east",
                "東",
                date,
                ReservationReportDayPart::Morning,
                i64::MAX,
                0,
            )
            .unwrap(),
            ReservationReportRow::new(
                "east",
                "東",
                date,
                ReservationReportDayPart::Afternoon,
                1,
                0,
            )
            .unwrap(),
        ];
        assert!(matches!(
            ReservationReport::new("hash", vec![facility], rows),
            Err(CourseError::BadRequest(
                "reservation report group totals are too large"
            ))
        ));
    }
}
