//! Parse, preview, and persist the daily reservation-status workbook.

use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    sync::Arc,
};

use calamine::{open_workbook_from_rs, Data, DataType, Reader, Xlsx};
use chrono::{Datelike, Duration, NaiveDate};
use sha2::{Digest, Sha256};

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, CourseId, ExternalReservationReportEntry, GatewayCredentials, GolfCatalogGateway,
    PdfRotation, ReservationReport, ReservationReportAnalyzeGateway, ReservationReportDayPart,
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
    pub golf_course_id: Option<CourseId>,
}

impl ReservationReportCourseMapping {
    pub fn new(source_course_key: impl Into<String>, golf_course_id: impl Into<String>) -> Self {
        let golf_course_id = golf_course_id.into();
        Self {
            source_course_key: source_course_key.into(),
            golf_course_id: (!golf_course_id.trim().is_empty())
                .then(|| CourseId::new(golf_course_id)),
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
        rotation: PdfRotation,
    ) -> Result<ReservationReportPreview, CourseError> {
        credentials
            .require(actions::IMPORT_RESERVATION_REPORTS)
            .await?;
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
                    .analyze_tabular(credentials, bytes, filename, year, rotation)
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
    let normalized = value
        .trim()
        .chars()
        .map(|character| match character {
            '０'..='９' => char::from_u32(character as u32 - '０' as u32 + '0' as u32)
                .expect("full-width digit maps to ASCII"),
            '／' => '/',
            '－' | '−' | 'ー' => '-',
            '．' => '.',
            other => other,
        })
        .collect::<String>();
    let trimmed = normalized.trim();
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
    let date_part = first_line.split('T').next().unwrap_or(first_line).trim();
    for format in ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y年%m月%d日"] {
        if let Ok(date) = NaiveDate::parse_from_str(date_part, format) {
            if date.year() != year {
                return Err(CourseError::BadRequest(
                    "tabular reservation date year does not match report year",
                ));
            }
            return Ok(date);
        }
    }
    let (month, day) = if let Some((month, day)) = date_part.split_once('/') {
        (month, day)
    } else if let Some((month, day)) = date_part.split_once('月') {
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
        credentials
            .require(actions::IMPORT_RESERVATION_REPORTS)
            .await?;
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
            if mapping
                .golf_course_id
                .as_ref()
                .is_some_and(|course_id| !active_course_ids.contains(course_id.as_str()))
            {
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
    let mut by_key = HashMap::new();
    let mut course_ids = HashSet::new();
    for mapping in mappings {
        let key = mapping.source_course_key.trim();
        if key.is_empty() {
            return Err(CourseError::BadRequest(
                "course mapping source facility cannot be empty",
            ));
        }
        if !report
            .facilities()
            .iter()
            .any(|facility| facility.source_course_key() == key)
        {
            return Err(CourseError::BadRequest("course mapping is unknown"));
        }
        if by_key
            .insert(key.to_string(), mapping.golf_course_id.clone())
            .is_some()
        {
            return Err(CourseError::BadRequest(
                "source facilities and courses must be mapped uniquely",
            ));
        }
        if let Some(course_id) = mapping.golf_course_id.as_ref() {
            if !course_ids.insert(course_id.to_string()) {
                return Err(CourseError::BadRequest(
                    "source facilities and courses must be mapped uniquely",
                ));
            }
        }
    }
    report
        .rows()
        .iter()
        .map(|row| {
            let course_id = by_key.get(row.source_course_key()).cloned().flatten();
            Ok(
                ExternalReservationReportEntry::new(row, course_id, report.source_file_sha256())
                    .with_source_system(report.source_system()),
            )
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
        credentials
            .require(actions::LIST_RESERVATION_REPORTS)
            .await?;
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
    use std::sync::Mutex;

    use axum::{routing::get, Json, Router};

    use super::*;
    use crate::course::domain::{
        Course, ReservationReportEntryQuery, ReservationReportGateway, TabularAnalyzeMapping,
        TabularAnalyzeMappingField, TabularAnalyzeRow,
    };
    use crate::course::infrastructure::FieldGolfCatalogGateway;

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
        /// The turn the analyzer was asked for, so the operator's choice can
        /// be followed all the way out of the use case.
        rotation: Mutex<Option<PdfRotation>>,
    }

    impl FakeAnalyzeGateway {
        fn new(result: TabularAnalyzeResult) -> Self {
            Self {
                result,
                rotation: Mutex::new(None),
            }
        }
    }

    #[async_trait::async_trait]
    impl ReservationReportAnalyzeGateway for FakeAnalyzeGateway {
        async fn analyze_tabular(
            &self,
            _credentials: GatewayCredentials<'_>,
            _bytes: &[u8],
            _filename: Option<&str>,
            _year: i32,
            rotation: PdfRotation,
        ) -> Result<TabularAnalyzeResult, CourseError> {
            *self.rotation.lock().unwrap() = Some(rotation);
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
    fn course_mapping_is_optional_but_unknown_and_duplicate_mappings_are_rejected() {
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
        let unlinked = mapped_entries(&report, &[]).expect("unlinked facility is valid");
        assert!(unlinked[0].golf_course_id().is_none());

        let explicit_unlinked = mapped_entries(
            &report,
            &[ReservationReportCourseMapping::new("真駒内", "")],
        )
        .expect("an empty selection is an unlinked facility");
        assert!(explicit_unlinked[0].golf_course_id().is_none());

        let unknown = vec![
            ReservationReportCourseMapping::new("真駒内", "course-1"),
            ReservationReportCourseMapping::new("extra", "course-1"),
        ];
        assert!(mapped_entries(&report, &unknown).is_err());
        let duplicate = vec![
            ReservationReportCourseMapping::new("真駒内", "course-1"),
            ReservationReportCourseMapping::new("真駒内", "course-2"),
        ];
        assert!(mapped_entries(&report, &duplicate).is_err());
        let entries = mapped_entries(
            &report,
            &[ReservationReportCourseMapping::new("真駒内", "course-1")],
        )
        .unwrap();
        assert_eq!(
            entries[0].golf_course_id().map(|id| id.as_str()),
            Some("course-1")
        );
    }

    #[derive(Default)]
    struct CapturingReservationReportGateway {
        entries: Mutex<Vec<ExternalReservationReportEntry>>,
    }

    #[async_trait::async_trait]
    impl ReservationReportGateway for CapturingReservationReportGateway {
        async fn upsert_entries(
            &self,
            _credentials: GatewayCredentials<'_>,
            entries: &[ExternalReservationReportEntry],
            _courses: &[Course],
        ) -> Result<ReservationReportUpsertSummary, CourseError> {
            *self.entries.lock().expect("entries lock") = entries.to_vec();
            Ok(ReservationReportUpsertSummary {
                created_count: entries.len() as i64,
                ..Default::default()
            })
        }

        async fn list_entries(
            &self,
            _credentials: GatewayCredentials<'_>,
            _courses: &[Course],
            _query: ReservationReportEntryQuery,
        ) -> Result<Vec<ExternalReservationReportEntry>, CourseError> {
            Ok(self.entries.lock().expect("entries lock").clone())
        }
    }

    #[tokio::test]
    async fn importing_an_unlinked_facility_does_not_create_a_course_from_its_name() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind catalog stub");
        let address = listener.local_addr().expect("catalog stub address");
        // Deliberately expose only the list operation. Any attempt to create a
        // course as an upload side effect makes this use case fail the test.
        let app = Router::new().route(
            "/v1/erp/extensions/golf-course/courses",
            get(|| async { Json(serde_json::json!({ "items": [] })) }),
        );
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve catalog stub");
        });

        let gateway = Arc::new(CapturingReservationReportGateway::default());
        let catalog = Arc::new(FieldGolfCatalogGateway::new(
            reqwest::Client::new(),
            Some(&format!("http://{address}")),
        ));
        let use_case = ImportReservationReportUseCase::new(gateway.clone(), catalog);
        let row = ReservationReportRow::new(
            "facility-without-course",
            "Facility without a CourseBoard course",
            NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
            ReservationReportDayPart::Morning,
            7,
            2,
        )
        .unwrap();
        let report = ReservationReport::new(
            "synthetic-hash",
            vec![ReservationReportFacility::new(
                "facility-without-course",
                "Facility without a CourseBoard course",
            )],
            vec![row],
        )
        .unwrap();

        let summary = use_case
            .execute(
                GatewayCredentials {
                    authorization: "Bearer test",
                    caller_bearer: "Bearer test",
                    operator_id: "tenant-test",
                    platform_id: Some("platform-test"),
                    authorizer: &crate::course::infrastructure::ALLOW_ALL,
                },
                &report,
                &[],
            )
            .await
            .expect("unlinked import succeeds without catalog mutation");
        assert_eq!(summary.created_count, 1);
        let stored = gateway.entries.lock().expect("entries lock");
        assert_eq!(stored.len(), 1);
        assert!(stored[0].golf_course_id().is_none());
        assert_eq!(stored[0].source_course_key(), "facility-without-course");
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
        let gateway = FakeAnalyzeGateway::new(tabular_analysis(rows));
        let preview = PreviewReservationReportUseCase::execute_with_fallback(
            GatewayCredentials {
                authorization: "Bearer test",
                operator_id: "tenant",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            &gateway,
            b"%PDF-1.7\nreservation report",
            2026,
            Some("report.pdf"),
            None,
            PdfRotation::None,
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
    async fn tabular_fallback_flags_caddie_count_above_groups_without_refusing_the_file() {
        let gateway = FakeAnalyzeGateway::new(tabular_analysis(vec![TabularAnalyzeRow::new(
            2,
            vec![
                "東".into(),
                "2026-07-18".into(),
                "morning".into(),
                "1".into(),
                "2".into(),
            ],
        )
        .unwrap()]));
        // One of the two numbers is wrong and the report does not say which.
        // Refusing the file would leave the club unable to import the month at
        // all over a single half-day, so the row imports and gets flagged.
        let preview = PreviewReservationReportUseCase::execute_with_fallback(
            GatewayCredentials {
                authorization: "Bearer test",
                operator_id: "tenant",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            &gateway,
            b"not-an-xlsx",
            2026,
            Some("report.xls"),
            None,
            PdfRotation::None,
        )
        .await
        .unwrap();
        let flagged = preview.report().rows_needing_review();
        assert_eq!(flagged.len(), 1);
        assert_eq!(flagged[0].group_count(), 1);
        assert_eq!(flagged[0].caddie_attached_group_count(), 2);
        // Flagged, not corrected: the counts are stored as the report wrote them.
        assert_eq!(preview.report().rows().len(), 1);
    }

    #[tokio::test]
    async fn the_operator_page_orientation_reaches_the_analyzer() {
        let gateway = FakeAnalyzeGateway::new(tabular_analysis(vec![TabularAnalyzeRow::new(
            2,
            vec![
                "東".into(),
                "2026-07-18".into(),
                "morning".into(),
                "3".into(),
                "1".into(),
            ],
        )
        .unwrap()]));
        PreviewReservationReportUseCase::execute_with_fallback(
            GatewayCredentials {
                authorization: "Bearer test",
                operator_id: "tenant",
                platform_id: None,
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            &gateway,
            b"%PDF-1.7\nsideways scan",
            2026,
            Some("report.pdf"),
            None,
            PdfRotation::Clockwise270,
        )
        .await
        .unwrap();
        assert_eq!(
            *gateway.rotation.lock().unwrap(),
            Some(PdfRotation::Clockwise270)
        );
    }

    #[test]
    fn page_orientation_only_accepts_quarter_turns() {
        assert_eq!(PdfRotation::parse("0").unwrap(), PdfRotation::None);
        assert_eq!(
            PdfRotation::parse(" 90 ").unwrap(),
            PdfRotation::Clockwise90
        );
        assert_eq!(
            PdfRotation::parse("180").unwrap(),
            PdfRotation::Clockwise180
        );
        assert_eq!(
            PdfRotation::parse("270").unwrap(),
            PdfRotation::Clockwise270
        );
        for value in ["", "45", "360", "-90", "90.0"] {
            assert!(
                PdfRotation::parse(value).is_err(),
                "{value:?} should not parse"
            );
        }
        assert!(!PdfRotation::None.turns_the_page());
        assert!(PdfRotation::Clockwise180.turns_the_page());
    }

    #[tokio::test]
    async fn operator_column_mapping_overrides_the_ai_candidate() {
        let gateway = FakeAnalyzeGateway::new(tabular_analysis(vec![TabularAnalyzeRow::new(
            2,
            vec![
                "東".into(),
                "2026-07-18".into(),
                "morning".into(),
                "3".into(),
                "8".into(),
            ],
        )
        .unwrap()]));
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
                authorizer: &crate::course::infrastructure::ALLOW_ALL,
                caller_bearer: "Bearer test",
            },
            &gateway,
            b"not-an-xlsx",
            2026,
            Some("report.csv"),
            Some(&mappings),
            PdfRotation::None,
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
        for value in [
            "2026年8月20日",
            "２０２６／８／２０",
            "2026-08-20T00:00:00",
            "8月20日(木)",
        ] {
            assert_eq!(
                parse_tabular_date(value, 2026).unwrap(),
                NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
                "{value}"
            );
        }
        assert!(parse_tabular_date("20/8/2026", 2026).is_err());
        assert!(parse_tabular_date("2025-08-20", 2026).is_err());
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

    /// The club's own July 2026 export, as received on 2026-07-18.  The parser
    /// is deliberately strict about the layout and refuses a workbook it does
    /// not recognize, so only the real file proves that the weather suffix on a
    /// date cell, the merged facility headers, the budget row's full-width
    /// hyphen, and the hole-count suffix are all still handled.
    const SAMPLE: &[u8] = include_bytes!(
        "../../../tests/fixtures/日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx"
    );

    const SAMPLE_FILENAME: &str = "日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx";

    fn sample_report() -> ReservationReport {
        parse_reservation_report(SAMPLE, 2026, Some(SAMPLE_FILENAME)).expect("sample parses")
    }

    fn sample_row<'a>(
        report: &'a ReservationReport,
        course_key: &str,
        day: u32,
        day_part: ReservationReportDayPart,
    ) -> &'a ReservationReportRow {
        let date = NaiveDate::from_ymd_opt(2026, 7, day).unwrap();
        report
            .rows()
            .iter()
            .find(|row| {
                row.source_course_key() == course_key
                    && row.date() == date
                    && row.day_part() == day_part
            })
            .unwrap_or_else(|| panic!("{course_key} {date} {} is missing", day_part.as_str()))
    }

    #[test]
    fn the_clubs_own_export_yields_one_row_per_facility_day_and_day_part() {
        let report = sample_report();

        let facilities = report
            .facilities()
            .iter()
            .map(|facility| facility.source_course_key())
            .collect::<Vec<_>>();
        assert_eq!(facilities, ["真駒内", "滝の", "羊ケ丘"]);
        // The header cells carry the hole count on a second line.
        assert_eq!(report.facilities()[0].source_course_name(), "真駒内\n36H");

        // 3 facilities * 31 days * morning and afternoon.
        assert_eq!(report.rows().len(), 186);
        for facility in report.facilities() {
            let rows = report
                .rows()
                .iter()
                .filter(|row| row.source_course_key() == facility.source_course_key())
                .count();
            assert_eq!(rows, 62, "{} row count", facility.source_course_key());
        }
    }

    #[test]
    fn the_clubs_own_export_keeps_the_sheets_totals() {
        let report = sample_report();

        let per_facility = |key: &str| -> (i64, i64) {
            report
                .rows()
                .iter()
                .filter(|row| row.source_course_key() == key)
                .fold((0, 0), |(groups, caddie), row| {
                    (
                        groups + row.group_count(),
                        caddie + row.caddie_attached_group_count(),
                    )
                })
        };
        assert_eq!(per_facility("真駒内"), (2249, 926));
        assert_eq!(per_facility("滝の"), (2399, 1006));
        assert_eq!(per_facility("羊ケ丘"), (1666, 544));

        let groups: i64 = report.rows().iter().map(|row| row.group_count()).sum();
        let caddie: i64 = report
            .rows()
            .iter()
            .map(|row| row.caddie_attached_group_count())
            .sum();
        assert_eq!((groups, caddie), (6314, 2476));

        // Row 20 column F of the sheet.  The 56 that the grand-total row shows
        // for the same slot is a caddie count for every facility at once, not
        // this facility's group count.
        let morning = sample_row(&report, "真駒内", 1, ReservationReportDayPart::Morning);
        assert_eq!(morning.group_count(), 70);
        assert_eq!(morning.caddie_attached_group_count(), 21);
    }

    #[test]
    fn a_day_the_facility_is_closed_arrives_as_zero_rather_than_as_a_gap() {
        let report = sample_report();

        // 真駒内 is closed on these July days while the other two trade as
        // usual, so the zeros have to survive as rows of their own.
        for day in [6, 7, 9, 10, 11, 12] {
            for day_part in [
                ReservationReportDayPart::Morning,
                ReservationReportDayPart::Afternoon,
            ] {
                let row = sample_row(&report, "真駒内", day, day_part);
                assert_eq!(row.group_count(), 0, "真駒内 7/{day} {}", day_part.as_str());
                assert_eq!(
                    row.caddie_attached_group_count(),
                    0,
                    "真駒内 7/{day} {}",
                    day_part.as_str()
                );
            }
        }
        assert_eq!(
            sample_row(&report, "滝の", 6, ReservationReportDayPart::Morning).group_count(),
            51
        );
    }

    #[test]
    fn the_sheets_grand_total_column_is_not_imported_as_a_facility() {
        let report = sample_report();

        assert!(report
            .facilities()
            .iter()
            .all(|facility| !facility.source_course_key().contains("全体")));
        assert!(report
            .rows()
            .iter()
            .all(|row| !row.source_course_key().contains("全体")));
    }

    #[test]
    fn the_same_export_always_fingerprints_the_same_way() {
        assert_eq!(
            sample_report().source_file_sha256(),
            "6c86ff72b634797724a747742a85cc2c5a2766cd9e188f226739d7dfb5563cd8"
        );
    }
}
