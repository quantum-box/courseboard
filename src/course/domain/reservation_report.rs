//! Values and storage port for daily reservation-count snapshots imported from
//! an external reservation system.
//!
//! These rows are deliberately not Field reservations.  The source workbook
//! contains only group counts, not a reservation id, party, or tee time.

use chrono::{DateTime, NaiveDate, Utc};

use super::{Course, CourseError, CourseId, GatewayCredentials};

pub const DAILY_RESERVATION_STATUS_SOURCE: &str = "daily_reservation_status_xlsx";
pub const TABULAR_RESERVATION_REPORT_SOURCE: &str = "tabular_analyze";

/// The normalized result returned by Field's tabular analysis capability.
///
/// Field JSON is decoded in the infrastructure gateway and crosses into the
/// CourseBoard domain as these small value types.  The import use case still
/// validates every mapped value before it becomes a reservation snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct TabularAnalyzeMappingField {
    source: String,
    target: String,
    required: bool,
    confidence: f64,
    explanation: String,
    samples: Vec<String>,
}

impl TabularAnalyzeMappingField {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        source: impl Into<String>,
        target: impl Into<String>,
        required: bool,
        confidence: f64,
        explanation: impl Into<String>,
        samples: Vec<String>,
    ) -> Result<Self, CourseError> {
        let source = source.into();
        let target = target.into();
        if source.trim().is_empty() || target.trim().is_empty() {
            return Err(CourseError::Provider(
                "tabular analyze mapping contains an empty field".into(),
            ));
        }
        if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
            return Err(CourseError::Provider(
                "tabular analyze mapping confidence is invalid".into(),
            ));
        }
        Ok(Self {
            source,
            target,
            required,
            confidence,
            explanation: explanation.into(),
            samples,
        })
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn required(&self) -> bool {
        self.required
    }

    pub fn confidence(&self) -> f64 {
        self.confidence
    }

    pub fn explanation(&self) -> &str {
        &self.explanation
    }

    pub fn samples(&self) -> &[String] {
        &self.samples
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TabularAnalyzeMapping {
    mode: String,
    fields: Vec<TabularAnalyzeMappingField>,
    notes: Option<String>,
}

impl TabularAnalyzeMapping {
    pub fn new(
        mode: impl Into<String>,
        fields: Vec<TabularAnalyzeMappingField>,
        notes: Option<String>,
    ) -> Result<Self, CourseError> {
        let mode = mode.into();
        if !matches!(mode.as_str(), "alias" | "ai" | "user") {
            return Err(CourseError::Provider(
                "tabular analyze mapping mode is invalid".into(),
            ));
        }
        Ok(Self {
            mode,
            fields,
            notes,
        })
    }

    pub fn mode(&self) -> &str {
        &self.mode
    }

    pub fn fields(&self) -> &[TabularAnalyzeMappingField] {
        &self.fields
    }

    pub fn notes(&self) -> Option<&str> {
        self.notes.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabularAnalyzeRow {
    source_row_number: usize,
    values: Vec<String>,
}

impl TabularAnalyzeRow {
    pub fn new(source_row_number: usize, values: Vec<String>) -> Result<Self, CourseError> {
        if source_row_number == 0 {
            return Err(CourseError::Provider(
                "tabular analyze source row number is invalid".into(),
            ));
        }
        Ok(Self {
            source_row_number,
            values,
        })
    }

    pub fn source_row_number(&self) -> usize {
        self.source_row_number
    }

    pub fn values(&self) -> &[String] {
        &self.values
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TabularAnalyzeResult {
    source_type: String,
    sheet_names: Vec<String>,
    selected_sheet: Option<String>,
    header_row: Option<usize>,
    headers: Vec<String>,
    rows: Vec<TabularAnalyzeRow>,
    mapping: TabularAnalyzeMapping,
    warnings: Vec<String>,
}

impl TabularAnalyzeResult {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        source_type: impl Into<String>,
        sheet_names: Vec<String>,
        selected_sheet: Option<String>,
        header_row: Option<usize>,
        headers: Vec<String>,
        rows: Vec<TabularAnalyzeRow>,
        mapping: TabularAnalyzeMapping,
        warnings: Vec<String>,
    ) -> Result<Self, CourseError> {
        let source_type = source_type.into();
        if source_type.trim().is_empty() {
            return Err(CourseError::Provider(
                "tabular analyze source type is missing".into(),
            ));
        }
        if headers.is_empty() {
            return Err(CourseError::Provider(
                "tabular analyze headers are missing".into(),
            ));
        }
        if let Some(sheet) = selected_sheet.as_deref() {
            if sheet.trim().is_empty() {
                return Err(CourseError::Provider(
                    "tabular analyze selected sheet is invalid".into(),
                ));
            }
        }
        Ok(Self {
            source_type,
            sheet_names,
            selected_sheet,
            header_row,
            headers,
            rows,
            mapping,
            warnings,
        })
    }

    pub fn source_type(&self) -> &str {
        &self.source_type
    }

    pub fn sheet_names(&self) -> &[String] {
        &self.sheet_names
    }

    pub fn selected_sheet(&self) -> Option<&str> {
        self.selected_sheet.as_deref()
    }

    pub fn header_row(&self) -> Option<usize> {
        self.header_row
    }

    pub fn headers(&self) -> &[String] {
        &self.headers
    }

    pub fn rows(&self) -> &[TabularAnalyzeRow] {
        &self.rows
    }

    pub fn mapping(&self) -> &TabularAnalyzeMapping {
        &self.mapping
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }
}

/// The two day parts used by the source report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReservationReportDayPart {
    Morning,
    Afternoon,
}

impl ReservationReportDayPart {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Morning => "morning",
            Self::Afternoon => "afternoon",
        }
    }

    pub fn parse(value: &str) -> Result<Self, CourseError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "morning" => Ok(Self::Morning),
            "afternoon" => Ok(Self::Afternoon),
            _ => Err(CourseError::BadRequest(
                "day part must be morning or afternoon",
            )),
        }
    }
}

/// One parsed row before a CourseBoard course has been selected.
///
/// Caddie-attached groups are part of the total rather than extra to it, so a
/// row reporting more of them than groups is saying something impossible. It is
/// kept anyway, exactly as the report wrote it: the club's booking system does
/// occasionally export one, and refusing the file would leave the club unable
/// to import the month at all over a single half-day. The row is flagged
/// instead — see [`Self::caddie_count_exceeds_groups`] — and the desk compares
/// it against the original report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationReportRow {
    source_course_key: String,
    source_course_name: String,
    date: NaiveDate,
    day_part: ReservationReportDayPart,
    group_count: i64,
    caddie_attached_group_count: i64,
}

impl ReservationReportRow {
    pub fn new(
        source_course_key: impl Into<String>,
        source_course_name: impl Into<String>,
        date: NaiveDate,
        day_part: ReservationReportDayPart,
        group_count: i64,
        caddie_attached_group_count: i64,
    ) -> Result<Self, CourseError> {
        if group_count < 0 || caddie_attached_group_count < 0 {
            return Err(CourseError::BadRequest(
                "reservation report counts must be non-negative",
            ));
        }
        let source_course_key = source_course_key.into();
        let source_course_name = source_course_name.into();
        if source_course_key.trim().is_empty() || source_course_name.trim().is_empty() {
            return Err(CourseError::BadRequest("source course is required"));
        }
        Ok(Self {
            source_course_key,
            source_course_name,
            date,
            day_part,
            group_count,
            caddie_attached_group_count,
        })
    }

    pub fn source_course_key(&self) -> &str {
        &self.source_course_key
    }

    pub fn source_course_name(&self) -> &str {
        &self.source_course_name
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    pub fn day_part(&self) -> ReservationReportDayPart {
        self.day_part
    }

    pub fn group_count(&self) -> i64 {
        self.group_count
    }

    pub fn caddie_attached_group_count(&self) -> i64 {
        self.caddie_attached_group_count
    }

    /// Whether this row reports more caddie-attached groups than groups.
    ///
    /// One of the two numbers is wrong, and the report does not say which, so
    /// this is a question for the desk rather than something to correct here.
    pub fn caddie_count_exceeds_groups(&self) -> bool {
        self.caddie_attached_group_count > self.group_count
    }
}

/// A parsed source facility, used by the UI to request an explicit mapping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationReportFacility {
    source_course_key: String,
    source_course_name: String,
}

impl ReservationReportFacility {
    pub fn new(
        source_course_key: impl Into<String>,
        source_course_name: impl Into<String>,
    ) -> Self {
        Self {
            source_course_key: source_course_key.into(),
            source_course_name: source_course_name.into(),
        }
    }

    pub fn source_course_key(&self) -> &str {
        &self.source_course_key
    }

    pub fn source_course_name(&self) -> &str {
        &self.source_course_name
    }
}

/// Aggregate returned by the parser and used for preview/import totals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationReport {
    source_system: String,
    source_file_sha256: String,
    facilities: Vec<ReservationReportFacility>,
    rows: Vec<ReservationReportRow>,
}

impl ReservationReport {
    pub fn new(
        source_file_sha256: impl Into<String>,
        facilities: Vec<ReservationReportFacility>,
        rows: Vec<ReservationReportRow>,
    ) -> Result<Self, CourseError> {
        if facilities.is_empty() || rows.is_empty() {
            return Err(CourseError::BadRequest(
                "reservation report contains no facility rows",
            ));
        }
        let group_count = rows.iter().try_fold(0_i64, |total, row| {
            total
                .checked_add(row.group_count())
                .ok_or(CourseError::BadRequest(
                    "reservation report group totals are too large",
                ))
        })?;
        let caddie_attached_group_count = rows.iter().try_fold(0_i64, |total, row| {
            total
                .checked_add(row.caddie_attached_group_count())
                .ok_or(CourseError::BadRequest(
                    "reservation report caddie totals are too large",
                ))
        })?;
        let _ = (group_count, caddie_attached_group_count);
        Ok(Self {
            source_system: DAILY_RESERVATION_STATUS_SOURCE.to_string(),
            source_file_sha256: source_file_sha256.into(),
            facilities,
            rows,
        })
    }

    pub fn with_source_system(mut self, source_system: impl Into<String>) -> Self {
        self.source_system = source_system.into();
        self
    }

    pub fn source_system(&self) -> &str {
        &self.source_system
    }

    pub fn source_file_sha256(&self) -> &str {
        &self.source_file_sha256
    }

    pub fn facilities(&self) -> &[ReservationReportFacility] {
        &self.facilities
    }

    pub fn rows(&self) -> &[ReservationReportRow] {
        &self.rows
    }

    /// The rows the desk should compare against the original report.
    ///
    /// Everything here still imports. The point is to name the few half-days
    /// worth a second look, not to hold up a month over them.
    pub fn rows_needing_review(&self) -> Vec<&ReservationReportRow> {
        self.rows
            .iter()
            .filter(|row| row.caddie_count_exceeds_groups())
            .collect()
    }

    pub fn totals(&self) -> ReservationReportTotals {
        ReservationReportTotals {
            facility_count: self.facilities.len() as i64,
            row_count: self.rows.len() as i64,
            group_count: self
                .rows
                .iter()
                .map(ReservationReportRow::group_count)
                .sum(),
            caddie_attached_group_count: self
                .rows
                .iter()
                .map(ReservationReportRow::caddie_attached_group_count)
                .sum(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReservationReportTotals {
    pub facility_count: i64,
    pub row_count: i64,
    pub group_count: i64,
    pub caddie_attached_group_count: i64,
}

/// A row after the user has mapped its source facility to a CourseBoard course.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalReservationReportEntry {
    id: Option<String>,
    source_course_key: String,
    source_course_name: String,
    golf_course_id: CourseId,
    date: NaiveDate,
    day_part: ReservationReportDayPart,
    group_count: i64,
    caddie_attached_group_count: i64,
    source_file_sha256: String,
    source_system: String,
    updated_at: Option<DateTime<Utc>>,
}

impl ExternalReservationReportEntry {
    pub fn new(
        row: &ReservationReportRow,
        golf_course_id: CourseId,
        source_file_sha256: impl Into<String>,
    ) -> Self {
        Self {
            id: None,
            source_course_key: row.source_course_key().to_string(),
            source_course_name: row.source_course_name().to_string(),
            golf_course_id,
            date: row.date(),
            day_part: row.day_part(),
            group_count: row.group_count(),
            caddie_attached_group_count: row.caddie_attached_group_count(),
            source_file_sha256: source_file_sha256.into(),
            source_system: DAILY_RESERVATION_STATUS_SOURCE.to_string(),
            updated_at: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reconstitute(
        id: impl Into<String>,
        source_course_key: impl Into<String>,
        source_course_name: impl Into<String>,
        golf_course_id: CourseId,
        date: NaiveDate,
        day_part: ReservationReportDayPart,
        group_count: i64,
        caddie_attached_group_count: i64,
        source_file_sha256: impl Into<String>,
        updated_at: Option<DateTime<Utc>>,
    ) -> Result<Self, CourseError> {
        let row = ReservationReportRow::new(
            source_course_key,
            source_course_name,
            date,
            day_part,
            group_count,
            caddie_attached_group_count,
        )?;
        Ok(Self {
            id: Some(id.into()),
            source_course_key: row.source_course_key().to_string(),
            source_course_name: row.source_course_name().to_string(),
            golf_course_id,
            date,
            day_part,
            group_count,
            caddie_attached_group_count,
            source_file_sha256: source_file_sha256.into(),
            source_system: DAILY_RESERVATION_STATUS_SOURCE.to_string(),
            updated_at,
        })
    }

    pub fn id(&self) -> Option<&str> {
        self.id.as_deref()
    }
    pub fn source_course_key(&self) -> &str {
        &self.source_course_key
    }
    pub fn source_course_name(&self) -> &str {
        &self.source_course_name
    }
    pub fn golf_course_id(&self) -> &CourseId {
        &self.golf_course_id
    }
    pub fn date(&self) -> NaiveDate {
        self.date
    }
    pub fn day_part(&self) -> ReservationReportDayPart {
        self.day_part
    }
    pub fn group_count(&self) -> i64 {
        self.group_count
    }
    pub fn caddie_attached_group_count(&self) -> i64 {
        self.caddie_attached_group_count
    }
    pub fn source_file_sha256(&self) -> &str {
        &self.source_file_sha256
    }
    pub fn source_system(&self) -> &str {
        &self.source_system
    }
    pub fn updated_at(&self) -> Option<DateTime<Utc>> {
        self.updated_at
    }

    pub fn with_persistence_metadata(
        mut self,
        id: impl Into<String>,
        updated_at: Option<DateTime<Utc>>,
    ) -> Self {
        self.id = Some(id.into());
        self.updated_at = updated_at;
        self
    }

    pub fn with_source_system(mut self, source_system: impl Into<String>) -> Self {
        self.source_system = source_system.into();
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReservationReportUpsertSummary {
    pub created_count: i64,
    pub updated_count: i64,
    pub unchanged_count: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReservationReportEntryQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

impl ReservationReportEntryQuery {
    pub fn validate(self) -> Result<Self, CourseError> {
        if let (Some(from), Some(to)) = (self.from, self.to) {
            if from > to {
                return Err(CourseError::BadRequest("from must not be after to"));
            }
        }
        Ok(self)
    }
}

#[async_trait::async_trait]
pub trait ReservationReportGateway: Send + Sync {
    async fn upsert_entries(
        &self,
        credentials: GatewayCredentials<'_>,
        entries: &[ExternalReservationReportEntry],
        courses: &[Course],
    ) -> Result<ReservationReportUpsertSummary, CourseError>;

    async fn list_entries(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: &[Course],
        query: ReservationReportEntryQuery,
    ) -> Result<Vec<ExternalReservationReportEntry>, CourseError>;
}

/// Port for the optional provider-backed tabular analysis fallback.
#[async_trait::async_trait]
pub trait ReservationReportAnalyzeGateway: Send + Sync {
    async fn analyze_tabular(
        &self,
        credentials: GatewayCredentials<'_>,
        bytes: &[u8],
        filename: Option<&str>,
        year: i32,
    ) -> Result<TabularAnalyzeResult, CourseError>;
}
