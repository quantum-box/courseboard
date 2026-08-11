//! ImportReservationSummariesUseCase: one use case, one public entrypoint (`execute`).
//!
//! Checking a file and applying it are the same work up to the last step, so
//! they are the same case with a mode rather than two that could drift: a
//! preview that counted differently from the import it precedes would be worse
//! than no preview at all.

use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    parse_reservation_sheet, resolve_course_label, CourseError, CourseId, CourseResolution,
    GatewayCredentials, GolfCatalogGateway, ImportWarning, ReservationCourseLinkGateway,
    ReservationDaySummary, ReservationSummaryGateway, ReservationSummaryWindow, SheetGrid,
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

/// One course name in the file, and what became of it.
///
/// Every name the sheet holds gets one of these, whether it imports or not.
/// The screen is where the desk answers the ones that have no course yet, so it
/// has to be shown the whole list rather than only the part that worked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedCourse {
    /// The name as the sheet writes it. Also the key the desk's answer is
    /// stored against.
    pub sheet_label: String,
    /// `linked` | `suggested` | `ignored` | `unresolved` | `ambiguous`.
    pub resolution: &'static str,
    /// Absent for a name with no course behind it.
    pub course_id: Option<CourseId>,
    pub course_name: Option<String>,
    /// Course names a name could have meant, when several fit.
    pub candidates: Vec<String>,
    /// Half-days this name contributes. Counted whether it imports or not, so
    /// the desk can see the size of what it is being asked about.
    pub day_count: usize,
    /// Groups across the whole file, for the "is this the right month" glance.
    pub total_groups: i32,
    pub caddie_groups: i32,
}

impl ImportedCourse {
    pub fn is_imported(&self) -> bool {
        matches!(self.resolution, "linked" | "suggested")
    }

    /// Whether the import knows what this name means — either a course to write
    /// to, or a decision to leave it out. Both are answers; only a name still
    /// being asked about is not.
    pub fn is_answered(&self) -> bool {
        !matches!(self.resolution, "unresolved" | "ambiguous")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationImportOutcome {
    pub summaries: Vec<ReservationDaySummary>,
    pub courses: Vec<ImportedCourse>,
    pub warnings: Vec<ImportWarning>,
    /// Half-days written. Zero on a preview, which writes nothing.
    pub imported: u64,
    /// Half-days the file held but the import left out — an unreadable count,
    /// or a course with no answer yet.
    pub skipped: usize,
    /// Names the desk still has to answer for. Not an error: a club that
    /// manages one of its three courses here is in this state on purpose until
    /// it says so, and a club whose courses are named differently starts here
    /// every time until it says so once.
    pub unanswered_courses: usize,
    pub dates: Vec<NaiveDate>,
}

pub struct ImportReservationSummariesUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    summaries: Arc<dyn ReservationSummaryGateway>,
    links: Arc<dyn ReservationCourseLinkGateway>,
}

impl ImportReservationSummariesUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        summaries: Arc<dyn ReservationSummaryGateway>,
        links: Arc<dyn ReservationCourseLinkGateway>,
    ) -> Self {
        Self {
            catalog,
            summaries,
            links,
        }
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
        let links = self.links.list_course_links(tenant_id).await?;

        let mut warnings = sheet.warnings;
        let mut summaries = Vec::with_capacity(sheet.summaries.len());
        let mut imported_courses: Vec<ImportedCourse> = Vec::new();
        // Half-days the file held that will not reach the board. Starts with
        // the ones the reader could not make a number of, and grows by every
        // name with no course behind it.
        let mut skipped = sheet.dropped_half_days + sheet.summaries.len();

        for label in &sheet.course_labels {
            let rows: Vec<_> = sheet
                .summaries
                .iter()
                .filter(|summary| summary.course_label == *label)
                .collect();
            let resolution = resolve_course_label(label, &courses, &links);

            // Every name in the file gets a row, imported or not. The screen
            // asks the desk about the ones with nowhere to go, and it cannot
            // ask about what it was never told.
            let mut entry = ImportedCourse {
                sheet_label: label.clone(),
                resolution: resolution.kind(),
                course_id: resolution.course().map(|course| course.id().clone()),
                course_name: resolution.course().map(|course| course.name().to_string()),
                candidates: match &resolution {
                    CourseResolution::Ambiguous(candidates) => candidates.clone(),
                    _ => Vec::new(),
                },
                day_count: rows.len(),
                total_groups: rows.iter().map(|row| row.total_groups).sum(),
                caddie_groups: rows.iter().map(|row| row.caddie_groups).sum(),
            };

            if let Some(course) = resolution.course() {
                for row in rows {
                    summaries.push(ReservationDaySummary::try_new(
                        course.id().clone(),
                        row.date,
                        row.time_of_day,
                        row.total_groups,
                        row.caddie_groups,
                        Some(label.clone()),
                    )?);
                }
            } else {
                // Reported once per name, not once per day: a club being asked
                // about 羊ケ丘 does not need telling sixty-two times. A name the
                // desk has already left out is not reported at all — that
                // question is answered.
                match &resolution {
                    CourseResolution::Unresolved => {
                        warnings.push(ImportWarning::UnknownCourse {
                            course_label: label.clone(),
                        });
                    }
                    CourseResolution::Ambiguous(candidates) => {
                        warnings.push(ImportWarning::AmbiguousCourse {
                            course_label: label.clone(),
                            candidates: candidates.clone(),
                        });
                    }
                    _ => {}
                }
                entry.day_count = rows.len();
            }
            imported_courses.push(entry);
        }

        skipped -= summaries.len();
        let unanswered_courses = imported_courses
            .iter()
            .filter(|course| !course.is_answered())
            .count();

        // Deliberately not an error when nothing resolved. A club whose courses
        // are named differently from the export's starts here every time, and a
        // file that refused to open could never be the place they fix it. The
        // caller decides what to do with an outcome that would write nothing.

        // What this file speaks for: every day it has a column for, across the
        // names it has an answer for. Taken from the sheet's own dates rather
        // than from the rows that survived, so a day whose counts were all
        // unreadable is still inside the window the import replaces — otherwise
        // the previous export's numbers would sit there unchallenged.
        let window = ReservationSummaryWindow {
            from: sheet.dates.first().copied().unwrap_or_default(),
            to: sheet.dates.last().copied().unwrap_or_default(),
            // Names the import has an answer for, which is more than the names
            // it writes. A name the desk has just excluded, or re-pointed at
            // another course, has to take its old rows with it — and those sit
            // under a course this import is no longer writing to, so the name is
            // the only handle that still reaches them. A name still being asked
            // about is left out: it keeps what it has until someone decides.
            sheet_labels: imported_courses
                .iter()
                .filter(|course| course.is_answered())
                .map(|course| course.sheet_label.clone())
                .collect(),
            course_ids: imported_courses
                .iter()
                .filter_map(|course| course.course_id.clone())
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
            unanswered_courses,
            dates: sheet.dates,
        })
    }
}
