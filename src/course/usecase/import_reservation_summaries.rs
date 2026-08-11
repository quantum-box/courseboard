//! ImportReservationSummariesUseCase: one use case, one public entrypoint (`execute`).
//!
//! Checking a file and applying it are the same work up to the last step, so
//! they are the same case with a mode rather than two that could drift: a
//! preview that counted differently from the import it precedes would be worse
//! than no preview at all.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::course::domain::{
    courses_a_label_may_have_matched, parse_reservation_sheet, resolve_course_label, Course,
    CourseError, CourseId, CourseResolution, GatewayCredentials, GolfCatalogGateway, ImportWarning,
    ReservationCourseLinkGateway, ReservationDaySummary, ReservationSummaryGateway,
    ReservationSummaryWindow, SheetGrid,
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

        // Counted before names sharing a course are folded together: those
        // half-days all reach the board, they just reach it on one row.
        skipped -= summaries.len();

        // Names sharing a course have to share a row before storage sees them.
        //
        // A row is keyed by course, date and half-day — the name is not in the
        // key — so two names on one course arrive as two rows competing for the
        // same slot, and the second silently overwrites the first. The board
        // would then show one name's bookings where it should show both, with
        // the preview still totalling both and nothing anywhere saying which
        // half went missing.
        for (course_id, labels) in combine_names_sharing_a_course(&mut summaries)? {
            warnings.push(ImportWarning::CoursesCombined {
                course_name: imported_courses
                    .iter()
                    .find(|course| course.course_id.as_ref() == Some(&course_id))
                    .and_then(|course| course.course_name.clone())
                    .unwrap_or_else(|| course_id.as_str().to_string()),
                sheet_labels: labels,
            });
        }

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
            course_ids: courses_a_file_speaks_for(&imported_courses, &courses),
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

/// Every course this file's replacement has to be able to reach.
///
/// Two groups. The obvious one is where the counts are going. The other is
/// where they may already be: a row written before names were recorded carries
/// none, so the only handle on it is the course it was written under — and back
/// then that was whatever plain name-matching chose, the desk having had no way
/// to say otherwise. Once the desk points such a name somewhere else, or
/// excludes it, those rows sit under a course this import would not otherwise
/// touch, and nothing else can reach them.
///
/// Only for a name that has an answer. A name still being asked about has
/// decided nothing, and must not take a month away on its way past.
///
/// Every course the name could be pointing at counts, not only the one it
/// resolves to today. A name that now ties between two courses may have matched
/// exactly one of them when its rows were written, and there is nothing left in
/// the row to say which — so both have to be reachable. The delete this feeds
/// only ever touches rows with no name of their own, which is what keeps that
/// safe.
fn courses_a_file_speaks_for(imported: &[ImportedCourse], courses: &[Course]) -> Vec<CourseId> {
    let mut ids: Vec<CourseId> = Vec::new();
    let mut add = |id: CourseId| {
        if !ids.contains(&id) {
            ids.push(id);
        }
    };
    for course in imported {
        if let Some(id) = course.course_id.clone() {
            add(id);
        }
        if course.is_answered() {
            for matched in courses_a_label_may_have_matched(&course.sheet_label, courses) {
                add(matched.id().clone());
            }
        }
    }
    ids
}

/// Fold rows that would land on the same stored slot into one, and say which
/// names each course took.
///
/// Adding the counts is the only reading that keeps every group the file
/// reported: a club whose booking system lists one course on two lines means
/// the sum, and a desk that pointed a name at the wrong course sees a number
/// that is visibly too big rather than one quietly too small. Returned rather
/// than warned about here so the caller can name the course the way the desk
/// knows it.
fn combine_names_sharing_a_course(
    summaries: &mut Vec<ReservationDaySummary>,
) -> Result<Vec<(CourseId, Vec<String>)>, CourseError> {
    let mut folded: Vec<ReservationDaySummary> = Vec::with_capacity(summaries.len());
    // Where each (course, date, half-day) already sits in `folded`.
    let mut slots: HashMap<(String, NaiveDate, &'static str), usize> = HashMap::new();
    // Course, and the names that landed on it — in the order the sheet lists
    // them, so the warning reads the way the file does.
    let mut shared: Vec<(CourseId, Vec<String>)> = Vec::new();

    for summary in summaries.iter() {
        let key = (
            summary.course_id().as_str().to_string(),
            summary.date(),
            summary.time_of_day().as_str(),
        );
        let Some(&at) = slots.get(&key) else {
            slots.insert(key, folded.len());
            folded.push(summary.clone());
            continue;
        };
        let kept = &folded[at];
        let (course_id, date, time_of_day, kept_label) = (
            kept.course_id().clone(),
            kept.date(),
            kept.time_of_day(),
            kept.sheet_label().map(str::to_string),
        );
        let total_groups = kept.total_groups() + summary.total_groups();
        let caddie_groups = kept.caddie_groups() + summary.caddie_groups();

        let names = match shared.iter_mut().find(|(id, _)| *id == course_id) {
            Some((_, names)) => names,
            None => {
                // The row already in place brought the first name.
                shared.push((course_id.clone(), kept_label.iter().cloned().collect()));
                &mut shared.last_mut().expect("just pushed").1
            }
        };
        if let Some(label) = summary.sheet_label() {
            if !names.iter().any(|seen| seen == label) {
                names.push(label.to_string());
            }
        }

        // The kept row's name is the one stored. Either reaches the row again
        // through the course, and both are in the replacement window.
        folded[at] = ReservationDaySummary::try_new(
            course_id,
            date,
            time_of_day,
            total_groups,
            caddie_groups,
            kept_label,
        )?;
    }

    *summaries = folded;
    Ok(shared)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{TimeOfDay, DEFAULT_TIMEZONE};

    fn course(id: &str, name: &str) -> Course {
        Course::reconstitute(
            CourseId::new(id),
            name.to_string(),
            None,
            18,
            DEFAULT_TIMEZONE.to_string(),
            8,
            true,
            None,
            None,
            None,
            None,
        )
    }

    fn answered(label: &str, resolution: &'static str, course_id: Option<&str>) -> ImportedCourse {
        ImportedCourse {
            sheet_label: label.to_string(),
            resolution,
            course_id: course_id.map(CourseId::new),
            course_name: None,
            candidates: Vec::new(),
            day_count: 62,
            total_groups: 0,
            caddie_groups: 0,
        }
    }

    #[test]
    fn a_re_pointed_name_still_reaches_the_course_it_used_to_be_matched_to() {
        // The month was imported before names were recorded, so its rows carry
        // none and sit under whatever the matcher chose — 真駒内. The desk has
        // since said 真駒内 means a different course. Without the old course in
        // the window those rows have nothing left able to reach them, and the
        // board shows the month twice.
        let courses = vec![
            course("course-makomanai", "真駒内"),
            course("course-new", "新"),
        ];
        let ids = courses_a_file_speaks_for(
            &[answered("真駒内", "linked", Some("course-new"))],
            &courses,
        );
        assert_eq!(
            ids,
            vec![
                CourseId::new("course-new"),
                CourseId::new("course-makomanai")
            ]
        );
    }

    #[test]
    fn an_excluded_name_still_reaches_the_course_it_used_to_be_matched_to() {
        // The window names no course at all through the resolution — this is
        // the only thing keeping the excluded month reachable.
        let courses = vec![course("course-makomanai", "真駒内")];
        let ids = courses_a_file_speaks_for(&[answered("真駒内", "ignored", None)], &courses);
        assert_eq!(ids, vec![CourseId::new("course-makomanai")]);
    }

    #[test]
    fn a_name_still_being_asked_about_takes_no_month_away_on_its_way_past() {
        // A course master rename drops a name out of the answer set. That is a
        // setup problem the desk is warned about, not a reason to erase what it
        // already imported.
        let courses = vec![course("course-makomanai", "真駒内")];
        let ids = courses_a_file_speaks_for(&[answered("真駒内", "unresolved", None)], &courses);
        assert!(ids.is_empty());
    }

    #[test]
    fn a_course_named_once_is_named_once_in_the_window() {
        let courses = vec![course("course-makomanai", "真駒内")];
        let ids = courses_a_file_speaks_for(
            &[answered("真駒内", "suggested", Some("course-makomanai"))],
            &courses,
        );
        assert_eq!(ids, vec![CourseId::new("course-makomanai")]);
    }

    fn row(course: &str, day: u32, label: &str, total: i32, caddie: i32) -> ReservationDaySummary {
        ReservationDaySummary::try_new(
            CourseId::new(course),
            NaiveDate::from_ymd_opt(2026, 7, day).unwrap(),
            TimeOfDay::Morning,
            total,
            caddie,
            Some(label.to_string()),
        )
        .unwrap()
    }

    #[test]
    fn two_names_on_one_course_add_up_instead_of_one_replacing_the_other() {
        // Storage keys a row by course, date and half-day, so these two would
        // compete for one slot and the second would win. Whichever name lost
        // would take its bookings off the board with nothing to show for it.
        let mut summaries = vec![
            row("course-east", 3, "東 OUT", 12, 5),
            row("course-east", 3, "東 IN", 9, 2),
        ];
        let shared = combine_names_sharing_a_course(&mut summaries).unwrap();

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].total_groups(), 21);
        assert_eq!(summaries[0].caddie_groups(), 7);
        assert_eq!(
            shared,
            vec![(
                CourseId::new("course-east"),
                vec!["東 OUT".to_string(), "東 IN".to_string()]
            )]
        );
    }

    #[test]
    fn the_folded_row_keeps_a_name_so_a_later_import_can_still_find_it() {
        let mut summaries = vec![
            row("course-east", 3, "東 OUT", 12, 5),
            row("course-east", 3, "東 IN", 9, 2),
        ];
        combine_names_sharing_a_course(&mut summaries).unwrap();
        assert_eq!(summaries[0].sheet_label(), Some("東 OUT"));
    }

    #[test]
    fn names_on_different_courses_are_left_alone() {
        let mut summaries = vec![
            row("course-a", 3, "真駒内", 12, 5),
            row("course-b", 3, "滝の", 9, 2),
        ];
        let shared = combine_names_sharing_a_course(&mut summaries).unwrap();

        assert_eq!(summaries.len(), 2);
        assert!(shared.is_empty());
    }

    #[test]
    fn one_name_across_a_month_is_not_mistaken_for_two_names_on_a_day() {
        // Same course and name, different dates. Folding those would collapse
        // the month into a day.
        let mut summaries = vec![
            row("course-a", 3, "真駒内", 12, 5),
            row("course-a", 4, "真駒内", 9, 2),
        ];
        let shared = combine_names_sharing_a_course(&mut summaries).unwrap();

        assert_eq!(summaries.len(), 2);
        assert!(shared.is_empty());
    }

    #[test]
    fn a_name_repeated_in_the_file_is_reported_once_not_once_per_day() {
        let mut summaries = vec![
            row("course-east", 3, "東 OUT", 12, 5),
            row("course-east", 3, "東 IN", 9, 2),
            row("course-east", 4, "東 OUT", 11, 4),
            row("course-east", 4, "東 IN", 8, 1),
        ];
        let shared = combine_names_sharing_a_course(&mut summaries).unwrap();

        assert_eq!(summaries.len(), 2);
        assert_eq!(shared.len(), 1);
        assert_eq!(shared[0].1, vec!["東 OUT".to_string(), "東 IN".to_string()]);
    }
}
