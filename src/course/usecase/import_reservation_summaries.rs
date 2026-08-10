//! ImportReservationSummariesUseCase: one use case, one public entrypoint (`execute`).
//!
//! Checking a file and applying it are the same work up to the last step, so
//! they are the same case with a mode rather than two that could drift: a
//! preview that counted differently from the import it precedes would be worse
//! than no preview at all.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    match_course_label, parse_reservation_sheet, CourseError, CourseId, CourseMatch,
    GatewayCredentials, GolfCatalogGateway, ImportWarning, ReservationDaySummary,
    ReservationSummaryGateway, ReservationSummaryWindow, SheetGrid,
};

/// Whether to write what the file says, or only report it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    /// Read the file and say what it would do. Nothing is written, so the desk
    /// can look at the numbers and walk away.
    Preview,
    Apply,
}

pub struct ImportReservationSummariesRequest {
    pub grid: SheetGrid,
    /// The year the sheet's `7/1` columns belong to. The sheet has none.
    pub year: i32,
    /// The uploaded file's name, kept against the rows so the desk can tell
    /// which export a surprising number arrived in.
    pub source_file: Option<String>,
    pub mode: ImportMode,
}

/// A course the file names, paired with the course it was matched to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedCourse {
    /// The name as the sheet writes it, so the desk can see what was matched.
    pub sheet_label: String,
    pub course_id: CourseId,
    pub course_name: String,
    /// Half-days this course contributes.
    pub day_count: usize,
    /// Groups across the whole file, for the "is this the right month" glance.
    pub total_groups: i32,
    pub caddie_groups: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationImportOutcome {
    pub summaries: Vec<ReservationDaySummary>,
    pub courses: Vec<ImportedCourse>,
    pub warnings: Vec<ImportWarning>,
    /// Half-days written. Zero on a preview, which writes nothing.
    pub imported: u64,
    /// Half-days the file held but the import left out — an unreadable count,
    /// or a course CourseBoard does not have.
    pub skipped: usize,
    pub dates: Vec<NaiveDate>,
}

pub struct ImportReservationSummariesUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    summaries: Arc<dyn ReservationSummaryGateway>,
}

impl ImportReservationSummariesUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        summaries: Arc<dyn ReservationSummaryGateway>,
    ) -> Self {
        Self { catalog, summaries }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        tenant_id: &str,
        request: ImportReservationSummariesRequest,
    ) -> Result<ReservationImportOutcome, CourseError> {
        if tenant_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }
        let sheet = parse_reservation_sheet(&request.grid, request.year)?;
        let courses = self.catalog.list_courses(credentials).await?;

        let mut warnings = sheet.warnings;
        let mut summaries = Vec::with_capacity(sheet.summaries.len());
        let mut imported_courses: Vec<ImportedCourse> = Vec::new();
        // Half-days the file held that will not reach the board. Starts with
        // the ones the reader could not make a number of, and grows by every
        // course that cannot be matched to one in CourseBoard.
        let mut skipped = sheet.dropped_half_days + sheet.summaries.len();

        for label in &sheet.course_labels {
            let rows: Vec<_> = sheet
                .summaries
                .iter()
                .filter(|summary| summary.course_label == *label)
                .collect();
            match match_course_label(label, &courses) {
                CourseMatch::Unknown => {
                    // Once per course, not once per day: a club that has not
                    // registered 羊ケ丘 does not need to be told sixty-two times.
                    warnings.push(ImportWarning::UnknownCourse {
                        course_label: label.clone(),
                    });
                    continue;
                }
                CourseMatch::Ambiguous(candidates) => {
                    warnings.push(ImportWarning::AmbiguousCourse {
                        course_label: label.clone(),
                        candidates,
                    });
                    continue;
                }
                CourseMatch::Matched(course) => {
                    let mut imported = ImportedCourse {
                        sheet_label: label.clone(),
                        course_id: course.id().clone(),
                        course_name: course.name().to_string(),
                        day_count: rows.len(),
                        total_groups: 0,
                        caddie_groups: 0,
                    };
                    for row in rows {
                        imported.total_groups += row.total_groups;
                        imported.caddie_groups += row.caddie_groups;
                        summaries.push(ReservationDaySummary::try_new(
                            course.id().clone(),
                            row.date,
                            row.time_of_day,
                            row.total_groups,
                            row.caddie_groups,
                        )?);
                    }
                    imported_courses.push(imported);
                }
            }
        }

        skipped -= summaries.len();
        if summaries.is_empty() {
            // Every course in the file is one CourseBoard does not have. This
            // is a setup problem the desk can fix — register the courses, or
            // rename them to match — not an upstream failure, so it is said as
            // one rather than reported as an empty success.
            return Err(CourseError::BadRequest(
                "no course in the file matches a course registered in CourseBoard",
            ));
        }

        // What this file speaks for: every day it has a column for, across the
        // courses it named and CourseBoard could place. Taken from the sheet's
        // own dates rather than from the rows that survived, so a day whose
        // counts were all unreadable is still inside the window the import
        // replaces — otherwise the previous export's numbers would sit there
        // unchallenged.
        let window = ReservationSummaryWindow {
            from: sheet.dates.first().copied().unwrap_or_default(),
            to: sheet.dates.last().copied().unwrap_or_default(),
            course_ids: imported_courses
                .iter()
                .map(|course| course.course_id.clone())
                .collect(),
        };

        let imported = match request.mode {
            ImportMode::Preview => 0,
            ImportMode::Apply => {
                self.summaries
                    .replace_reservation_summaries(
                        tenant_id,
                        &window,
                        &summaries,
                        request.source_file.as_deref(),
                    )
                    .await?
            }
        };

        Ok(ReservationImportOutcome {
            summaries,
            courses: imported_courses,
            warnings,
            imported,
            skipped,
            dates: sheet.dates,
        })
    }
}
