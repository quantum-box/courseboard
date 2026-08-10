//! Axum handlers for the club's daily reservation counts under `/v1/course/*`.
//!
//! Upload, preview, and read back the counts imported from the booking
//! system's `日別予約状況` export (PLT-3247 / PLT-3248).

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::http::{catalog_gateway, credentials, operator_id, ItemsResponse};
use super::openapi::ErrorBody;
use crate::course::domain::{
    year_month_from_file_name, CourseId, ImportWarning, ReservationDaySummary,
    ReservationSummaryQuery,
};
use crate::course::infrastructure::read_reservation_sheet;
use crate::course::usecase::{
    ImportMode, ImportReservationSummariesRequest, ImportReservationSummariesUseCase,
    ImportedCourse, ListReservationSummariesUseCase, ReservationImportOutcome,
};
use crate::{AppError, AppState};

/// The biggest upload the import will accept.
///
/// The real export is 26 KB; a club with more courses and a longer month stays
/// well inside this. Applied as a body limit on the route rather than checked
/// in the handler, so a mis-picked file — a video, a database dump — is refused
/// while it arrives instead of after it has been read into memory.
pub const MAX_WORKBOOK_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationSummaryDto {
    pub golf_course_id: String,
    pub date: NaiveDate,
    /// `am` or `pm`. The export reports nothing narrower.
    pub time_of_day: String,
    pub total_groups: i32,
    pub caddie_groups: i32,
    /// Groups going out without a caddie, derived so every screen agrees on it.
    pub self_play_groups: i32,
}

impl From<&ReservationDaySummary> for ReservationSummaryDto {
    fn from(value: &ReservationDaySummary) -> Self {
        Self {
            golf_course_id: value.course_id().to_string(),
            date: value.date(),
            time_of_day: value.time_of_day().as_str().to_string(),
            total_groups: value.total_groups(),
            caddie_groups: value.caddie_groups(),
            self_play_groups: value.self_play_groups(),
        }
    }
}

/// Something the desk should look at before or after applying a file.
///
/// Carries its parts rather than a finished sentence: the screen writes it in
/// the reader's language, and a warning about a specific day has to name that
/// day rather than a spreadsheet cell nobody can act on.
#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportWarningDto {
    /// `unreadableCount` | `caddieGroupsExceedTotal` | `courseTotalsDisagreeWithSheet`
    /// | `unknownCourse` | `ambiguousCourse`
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub course_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_groups: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caddie_groups: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_total: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_total: Option<i32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(default)]
    pub candidates: Vec<String>,
}

impl From<&ImportWarning> for ImportWarningDto {
    fn from(value: &ImportWarning) -> Self {
        let empty = Self {
            kind: String::new(),
            course_label: None,
            date: None,
            time_of_day: None,
            total_groups: None,
            caddie_groups: None,
            sheet_total: None,
            imported_total: None,
            candidates: Vec::new(),
        };
        match value {
            ImportWarning::UnreadableCount {
                course_label,
                date,
                time_of_day,
            } => Self {
                kind: "unreadableCount".into(),
                course_label: Some(course_label.clone()),
                date: Some(*date),
                time_of_day: Some(time_of_day.as_str().into()),
                ..empty
            },
            ImportWarning::CaddieGroupsExceedTotal {
                course_label,
                date,
                time_of_day,
                total_groups,
                caddie_groups,
            } => Self {
                kind: "caddieGroupsExceedTotal".into(),
                course_label: Some(course_label.clone()),
                date: Some(*date),
                time_of_day: Some(time_of_day.as_str().into()),
                total_groups: Some(*total_groups),
                caddie_groups: Some(*caddie_groups),
                ..empty
            },
            ImportWarning::CourseTotalsDisagreeWithSheet {
                date,
                time_of_day,
                sheet_total,
                imported_total,
            } => Self {
                kind: "courseTotalsDisagreeWithSheet".into(),
                date: Some(*date),
                time_of_day: Some(time_of_day.as_str().into()),
                sheet_total: Some(*sheet_total),
                imported_total: Some(*imported_total),
                ..empty
            },
            ImportWarning::UnknownCourse { course_label } => Self {
                kind: "unknownCourse".into(),
                course_label: Some(course_label.clone()),
                ..empty
            },
            ImportWarning::AmbiguousCourse {
                course_label,
                candidates,
            } => Self {
                kind: "ambiguousCourse".into(),
                course_label: Some(course_label.clone()),
                candidates: candidates.clone(),
                ..empty
            },
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCourseDto {
    /// The course name as the file writes it, so the desk can see what the
    /// import matched its courses to.
    pub sheet_label: String,
    pub golf_course_id: String,
    pub course_name: String,
    pub day_count: usize,
    pub total_groups: i32,
    pub caddie_groups: i32,
}

impl From<&ImportedCourse> for ImportedCourseDto {
    fn from(value: &ImportedCourse) -> Self {
        Self {
            sheet_label: value.sheet_label.clone(),
            golf_course_id: value.course_id.to_string(),
            course_name: value.course_name.clone(),
            day_count: value.day_count,
            total_groups: value.total_groups,
            caddie_groups: value.caddie_groups,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReservationImportResultDto {
    /// `YYYY-MM`, the month the file covers.
    pub year_month: String,
    /// Half-days written. Zero on a preview, which writes nothing.
    pub imported: u64,
    /// Half-days the file held that the import left out.
    pub skipped: usize,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub courses: Vec<ImportedCourseDto>,
    pub warnings: Vec<ImportWarningDto>,
    pub summaries: Vec<ReservationSummaryDto>,
}

impl ReservationImportResultDto {
    fn new(outcome: &ReservationImportOutcome, year: i32, month: u32) -> Self {
        Self {
            year_month: format!("{year:04}-{month:02}"),
            imported: outcome.imported,
            skipped: outcome.skipped,
            from: outcome.dates.first().copied().unwrap_or_default(),
            to: outcome.dates.last().copied().unwrap_or_default(),
            courses: outcome
                .courses
                .iter()
                .map(ImportedCourseDto::from)
                .collect(),
            warnings: outcome
                .warnings
                .iter()
                .map(ImportWarningDto::from)
                .collect(),
            summaries: outcome
                .summaries
                .iter()
                .map(ReservationSummaryDto::from)
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ReservationImportParams {
    /// The uploaded file's name. The month the export covers is written here
    /// and nowhere inside the sheet.
    #[serde(default)]
    pub file_name: Option<String>,
    /// `YYYY-MM`, for a file whose name does not say which month it is. Wins
    /// over the file name when both are given, because it is the answer to
    /// having been asked.
    #[serde(default)]
    pub year_month: Option<String>,
}

impl ReservationImportParams {
    /// Which month this file is about.
    ///
    /// Refused rather than guessed when neither source says: putting a month
    /// of bookings on the wrong dates is silent, and undoing it means knowing
    /// it happened.
    fn year_month(&self) -> Result<(i32, u32), AppError> {
        if let Some(raw) = self
            .year_month
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let (year, month) = raw.split_once('-').ok_or(AppError::BadRequest(
                "year and month must look like YYYY-MM",
            ))?;
            let year = year
                .parse::<i32>()
                .map_err(|_| AppError::BadRequest("year and month must look like YYYY-MM"))?;
            let month = month
                .parse::<u32>()
                .map_err(|_| AppError::BadRequest("year and month must look like YYYY-MM"))?;
            if !(1..=12).contains(&month) || !(2000..=2999).contains(&year) {
                return Err(AppError::BadRequest(
                    "year and month must look like YYYY-MM",
                ));
            }
            return Ok((year, month));
        }
        self.file_name
            .as_deref()
            .and_then(year_month_from_file_name)
            .ok_or(AppError::MonthRequired(
                "the file name does not say which month it covers, so the month has to be chosen",
            ))
    }
}

async fn run_import(
    state: AppState,
    headers: HeaderMap,
    params: ReservationImportParams,
    body: Bytes,
    mode: ImportMode,
) -> Result<Json<ReservationImportResultDto>, AppError> {
    let credentials = credentials(&state, &headers)?;
    if body.is_empty() {
        return Err(AppError::BadRequest("no file was uploaded"));
    }
    let (year, month) = params.year_month()?;
    let grid = read_reservation_sheet(&body).map_err(AppError::from)?;

    let use_case = ImportReservationSummariesUseCase::new(
        catalog_gateway(&state),
        state.reservation_summaries(),
    );
    let outcome = use_case
        .execute(
            credentials,
            credentials.operator_id,
            ImportReservationSummariesRequest {
                grid,
                year,
                source_file: params.file_name.clone(),
                mode,
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ReservationImportResultDto::new(&outcome, year, month)))
}

/// POST /v1/course/reservation-summaries/preview
#[utoipa::path(
    post,
    path = "/v1/course/reservation-summaries/preview",
    tag = "course-reservation-summary",
    params(ReservationImportParams),
    request_body(
        content = String,
        description = "The booking system's 日別予約状況 .xlsx export",
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    responses(
        (status = 200, description = "What the file would import", body = ReservationImportResultDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn preview_reservation_summaries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ReservationImportParams>,
    body: Bytes,
) -> Result<Json<ReservationImportResultDto>, AppError> {
    run_import(state, headers, params, body, ImportMode::Preview).await
}

/// POST /v1/course/reservation-summaries/import
#[utoipa::path(
    post,
    path = "/v1/course/reservation-summaries/import",
    tag = "course-reservation-summary",
    params(ReservationImportParams),
    request_body(
        content = String,
        description = "The booking system's 日別予約状況 .xlsx export",
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    responses(
        (status = 200, description = "What the file imported", body = ReservationImportResultDto),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn import_reservation_summaries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ReservationImportParams>,
    body: Bytes,
) -> Result<Json<ReservationImportResultDto>, AppError> {
    run_import(state, headers, params, body, ImportMode::Apply).await
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ReservationSummaryQueryParams {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Comma-separated course ids. Absent means every course.
    #[serde(default)]
    pub golf_course_ids: Option<String>,
}

/// GET /v1/course/reservation-summaries
#[utoipa::path(
    get,
    path = "/v1/course/reservation-summaries",
    tag = "course-reservation-summary",
    params(ReservationSummaryQueryParams),
    responses(
        (status = 200, description = "Imported daily counts", body = inline(ItemsResponse<ReservationSummaryDto>)),
        (status = 400, description = "Bad request", body = ErrorBody),
        (status = 401, description = "Unauthorized", body = ErrorBody),
        (status = 424, description = "Upstream provider error", body = ErrorBody),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_reservation_summaries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReservationSummaryQueryParams>,
) -> Result<Json<ItemsResponse<ReservationSummaryDto>>, AppError> {
    let tenant_id = operator_id(&headers)?.to_string();
    let use_case = ListReservationSummariesUseCase::new(state.reservation_summaries());
    let items = use_case
        .execute(
            &tenant_id,
            ReservationSummaryQuery {
                from: query.from,
                to: query.to,
                course_ids: query
                    .golf_course_ids
                    .as_deref()
                    .map(|raw| {
                        raw.split(',')
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(CourseId::new)
                            .collect()
                    })
                    .unwrap_or_default(),
            },
        )
        .await
        .map_err(AppError::from)?;
    Ok(Json(ItemsResponse {
        items: items.iter().map(ReservationSummaryDto::from).collect(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::TimeOfDay;

    fn params(file_name: Option<&str>, year_month: Option<&str>) -> ReservationImportParams {
        ReservationImportParams {
            file_name: file_name.map(str::to_string),
            year_month: year_month.map(str::to_string),
        }
    }

    #[test]
    fn the_month_is_read_off_the_uploaded_files_name() {
        assert_eq!(
            params(
                Some("日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx"),
                None
            )
            .year_month()
            .unwrap(),
            (2026, 7),
        );
    }

    #[test]
    fn a_month_the_desk_chose_wins_over_the_one_in_the_name() {
        // The desk is only asked when the name did not say, so an answer given
        // is the answer to use.
        assert_eq!(
            params(Some("日別予約状況_202607.xlsx"), Some("2026-08"))
                .year_month()
                .unwrap(),
            (2026, 8),
        );
    }

    #[test]
    fn a_file_whose_name_says_nothing_asks_rather_than_guessing() {
        // Answerable, and marked as such: the screen shows a month picker on
        // this one and an error on every other refusal. Guessing here would
        // date a whole month of bookings to the wrong days, silently.
        for params in [params(Some("予約.xlsx"), None), params(None, None)] {
            assert!(matches!(
                params.year_month(),
                Err(AppError::MonthRequired(_))
            ));
        }
    }

    #[test]
    fn a_month_that_is_not_a_month_is_refused() {
        // Not `MonthRequired`: the desk answered, and the answer was not a
        // month. Re-asking with the same picker would loop.
        for raw in ["2026-13", "2026", "26-07", "abcd-ef", "2026-00"] {
            assert!(
                matches!(
                    params(None, Some(raw)).year_month(),
                    Err(AppError::BadRequest(_))
                ),
                "{raw} should be refused"
            );
        }
    }

    #[test]
    fn a_warning_reaches_the_screen_with_the_day_it_is_about() {
        // The screen has to be able to say "7月3日の滝の"; a row number would
        // leave the reader with nothing to go and check.
        let warning = ImportWarningDto::from(&ImportWarning::UnreadableCount {
            course_label: "滝の".into(),
            date: NaiveDate::from_ymd_opt(2026, 7, 3).unwrap(),
            time_of_day: TimeOfDay::Morning,
        });
        assert_eq!(warning.kind, "unreadableCount");
        assert_eq!(warning.course_label.as_deref(), Some("滝の"));
        assert_eq!(warning.date, NaiveDate::from_ymd_opt(2026, 7, 3));
        assert_eq!(warning.time_of_day.as_deref(), Some("am"));
    }

    #[test]
    fn an_unknown_course_carries_the_name_the_file_used() {
        let warning = ImportWarningDto::from(&ImportWarning::UnknownCourse {
            course_label: "羊ケ丘".into(),
        });
        assert_eq!(warning.kind, "unknownCourse");
        assert_eq!(warning.course_label.as_deref(), Some("羊ケ丘"));
        assert_eq!(warning.date, None);
    }
}
