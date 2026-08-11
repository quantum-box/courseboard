//! Reading the club's `日別予約状況` sheet.
//!
//! The file is a report meant for a person, not a feed meant for a program, and
//! it shows: the header is two rows deep with merged cells, the row labels are
//! merged down the side, a day carries the weather in the same cell as its
//! date, and seven different series (this year, last year, budget, three
//! variances) are stacked in the same column space. Only one of those series is
//! a fact about bookings; the rest are commentary, and importing them would
//! double-count the month several times over.
//!
//! Nothing here reads a file format. The grid arrives as text and this module
//! decides what it means, so the whole layout — which is the part that is
//! actually hard — is testable without a spreadsheet.

use chrono::NaiveDate;

use super::{CourseError, TimeOfDay};

/// The series holding what is actually booked. Everything else on the sheet is
/// a comparison against it.
const BOOKED_SERIES: &str = "本年";
/// The row that sums the club's courses. Not imported — it is the sum of the
/// rows that are — but it is what the import checks itself against.
const WHOLE_CLUB_COURSE: &str = "全体";

const COURSE_HEADER: &str = "ゴルフ場";
const SERIES_HEADER: &str = "項目";
const TIME_OF_DAY_HEADER: &str = "時間帯";
const MORNING: &str = "午前";
const AFTERNOON: &str = "午後";
const TOTAL_GROUPS_HEADER: &str = "組数";
/// Half-width katakana in the file, and it is the only column spelled this way.
const CADDIE_GROUPS_HEADER: &str = "ｷｬ付";

/// A worksheet as read from the uploaded file.
///
/// Cells are text because that is the only thing every spreadsheet cell can be
/// turned into without losing the ones that are not numbers — and this sheet
/// has those: a budget row writes its caddie count as `－`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SheetGrid {
    rows: Vec<Vec<String>>,
}

impl SheetGrid {
    pub fn new(rows: Vec<Vec<String>>) -> Self {
        Self { rows }
    }

    fn cell(&self, row: usize, column: usize) -> &str {
        self.rows
            .get(row)
            .and_then(|cells| cells.get(column))
            .map(String::as_str)
            .unwrap_or("")
            .trim()
    }

    fn height(&self) -> usize {
        self.rows.len()
    }

    fn width(&self) -> usize {
        self.rows.iter().map(Vec::len).max().unwrap_or(0)
    }
}

/// One count read off the sheet, still labelled with the course name the file
/// used rather than a course id — matching that to the course master needs the
/// master, which this module does not have.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetDaySummary {
    pub course_label: String,
    pub date: NaiveDate,
    pub time_of_day: TimeOfDay,
    pub total_groups: i32,
    pub caddie_groups: i32,
}

/// Something the desk should look at, said in terms of the day and course it
/// happened on.
///
/// Deliberately not a row number: the person who can answer "why is the 3rd
/// unreadable?" is looking at a calendar, not at cell `J38`. Each one carries
/// its parts rather than a sentence so the screen can say it in the reader's
/// language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportWarning {
    /// A count was not a number, so that half-day was left out.
    UnreadableCount {
        course_label: String,
        date: NaiveDate,
        time_of_day: TimeOfDay,
    },
    /// More caddie-attached groups than groups. Imported as sent — the file is
    /// the club's record — but the desk is told, because it means one of the
    /// two numbers is wrong.
    CaddieGroupsExceedTotal {
        course_label: String,
        date: NaiveDate,
        time_of_day: TimeOfDay,
        total_groups: i32,
        caddie_groups: i32,
    },
    /// The courses do not add up to the sheet's own club-wide row.
    ///
    /// The check exists because a layout change upstream — a course added, a
    /// column shifted — otherwise shows up as a month that is quietly short a
    /// course, and nothing else in the system would notice.
    CourseTotalsDisagreeWithSheet {
        date: NaiveDate,
        time_of_day: TimeOfDay,
        sheet_total: i32,
        imported_total: i32,
    },
    /// The file names a course that CourseBoard has no course for, so its days
    /// were left out. Raised once per course rather than once per day.
    UnknownCourse { course_label: String },
    /// The label fits more than one registered course, so it was left out
    /// rather than guessed at.
    AmbiguousCourse {
        course_label: String,
        candidates: Vec<String>,
    },
}

/// Everything one sheet yielded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedReservationSheet {
    pub summaries: Vec<SheetDaySummary>,
    pub warnings: Vec<ImportWarning>,
    /// Course labels in the order the sheet lists them, club-wide row excluded.
    pub course_labels: Vec<String>,
    /// The days the sheet covers, earliest first.
    pub dates: Vec<NaiveDate>,
    /// Half-days the sheet held but this reader could not use — a count that
    /// was not a number. Kept as a number rather than inferred from the
    /// warnings, so "how much was left out" and "what to look at" stay
    /// independent of each other.
    pub dropped_half_days: usize,
}

/// The month an export covers, taken from its file name.
///
/// The sheet itself never writes a year: its columns are `7/1(水)`, and the
/// only place `2026` appears is the name the booking system gives the file —
/// `日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx`, where `20260718`
/// is the day it was exported and `202607` is the month it is about. Those two
/// disagree whenever a club exports next month early, so the six-digit part is
/// the one to read and the export date is deliberately ignored.
pub fn year_month_from_file_name(file_name: &str) -> Option<(i32, u32)> {
    let stem = file_name
        .rsplit_once('.')
        .map_or(file_name, |(stem, _)| stem);
    stem.split(|character: char| !character.is_ascii_digit())
        .filter(|token| token.len() == 6)
        .find_map(|token| {
            let year = token[..4].parse::<i32>().ok()?;
            let month = token[4..].parse::<u32>().ok()?;
            // A six-digit run that is not a year and month — a phone number, a
            // member id — must not be mistaken for one.
            ((1..=12).contains(&month) && (2000..=2999).contains(&year)).then_some((year, month))
        })
}

/// Read the booked-groups series out of one sheet.
///
/// `year` comes from the caller because the sheet does not carry one: its day
/// headers are `7/1(水)`, and the only place the year is written is the export
/// file's name.
pub fn parse_reservation_sheet(
    grid: &SheetGrid,
    year: i32,
) -> Result<ParsedReservationSheet, CourseError> {
    let layout = SheetLayout::locate(grid)?;
    let days = layout.day_columns(grid, year)?;
    if days.is_empty() {
        return Err(CourseError::BadRequest(
            "the sheet has no dated columns, so it is not a daily reservation export",
        ));
    }

    let mut summaries = Vec::new();
    let mut warnings = Vec::new();
    let mut course_labels: Vec<String> = Vec::new();
    // Kept separately from `summaries` because the club-wide row is the thing
    // the imported courses get checked against, not a thing to import.
    let mut club_totals: Vec<(NaiveDate, TimeOfDay, i32)> = Vec::new();
    let mut dropped_half_days = 0usize;

    let mut course_label = String::new();
    let mut series = String::new();
    for row in layout.first_data_row..grid.height() {
        // The label columns are merged down the side, so only the first row of
        // each block carries text and the rest inherit the last one seen.
        let cell_course = grid.cell(row, layout.course_column);
        if !cell_course.is_empty() {
            course_label = short_label(cell_course);
        }
        let cell_series = grid.cell(row, layout.series_column);
        if !cell_series.is_empty() {
            series = cell_series.to_string();
        }
        if series != BOOKED_SERIES || course_label.is_empty() {
            continue;
        }
        let Some(time_of_day) = half_day(grid.cell(row, layout.time_of_day_column)) else {
            // The series also carries a `合計` row, which is its own two halves
            // added up. Importing it as a third bucket would double the month.
            continue;
        };

        let is_club_wide = course_label.starts_with(WHOLE_CLUB_COURSE);
        if !is_club_wide && !course_labels.contains(&course_label) {
            course_labels.push(course_label.clone());
        }

        for day in &days {
            let total = count(grid.cell(row, day.total_column));
            let caddie = count(grid.cell(row, day.caddie_column));
            let (Some(total), Some(caddie)) = (total, caddie) else {
                if is_club_wide {
                    continue;
                }
                dropped_half_days += 1;
                warnings.push(ImportWarning::UnreadableCount {
                    course_label: course_label.clone(),
                    date: day.date,
                    time_of_day,
                });
                continue;
            };
            if is_club_wide {
                club_totals.push((day.date, time_of_day, total));
                continue;
            }
            if caddie > total {
                warnings.push(ImportWarning::CaddieGroupsExceedTotal {
                    course_label: course_label.clone(),
                    date: day.date,
                    time_of_day,
                    total_groups: total,
                    caddie_groups: caddie,
                });
            }
            summaries.push(SheetDaySummary {
                course_label: course_label.clone(),
                date: day.date,
                time_of_day,
                total_groups: total,
                caddie_groups: caddie,
            });
        }
    }

    if summaries.is_empty() {
        return Err(CourseError::BadRequest(
            "the sheet has no 本年 rows, so there is nothing booked to import",
        ));
    }

    warnings.extend(reconcile_against_club_row(&summaries, &club_totals));
    Ok(ParsedReservationSheet {
        summaries,
        warnings,
        course_labels,
        dates: days.into_iter().map(|day| day.date).collect(),
        dropped_half_days,
    })
}

/// Compare what was read per course against the sheet's own club-wide row.
fn reconcile_against_club_row(
    summaries: &[SheetDaySummary],
    club_totals: &[(NaiveDate, TimeOfDay, i32)],
) -> Vec<ImportWarning> {
    club_totals
        .iter()
        .filter_map(|(date, time_of_day, sheet_total)| {
            let imported_total: i32 = summaries
                .iter()
                .filter(|summary| summary.date == *date && summary.time_of_day == *time_of_day)
                .map(|summary| summary.total_groups)
                .sum();
            (imported_total != *sheet_total).then_some(
                ImportWarning::CourseTotalsDisagreeWithSheet {
                    date: *date,
                    time_of_day: *time_of_day,
                    sheet_total: *sheet_total,
                    imported_total,
                },
            )
        })
        .collect()
}

/// Where the sheet keeps its labels.
///
/// Found by reading the header rather than assumed, so a column inserted
/// upstream moves the reader with it instead of silently shifting every count
/// one course sideways.
struct SheetLayout {
    header_row: usize,
    course_column: usize,
    series_column: usize,
    time_of_day_column: usize,
    first_data_row: usize,
}

impl SheetLayout {
    fn locate(grid: &SheetGrid) -> Result<Self, CourseError> {
        let width = grid.width();
        for row in 0..grid.height().min(20) {
            let column_of =
                |header: &str| (0..width).find(|column| grid.cell(row, *column) == header);
            let (Some(course_column), Some(series_column), Some(time_of_day_column)) = (
                column_of(COURSE_HEADER),
                column_of(SERIES_HEADER),
                column_of(TIME_OF_DAY_HEADER),
            ) else {
                continue;
            };
            return Ok(Self {
                header_row: row,
                course_column,
                series_column,
                time_of_day_column,
                // The row under the header holds `組数` / `ｷｬ付`, not data.
                first_data_row: row + 2,
            });
        }
        Err(CourseError::BadRequest(
            "the sheet has no ゴルフ場 / 項目 / 時間帯 header, so it is not a daily reservation export",
        ))
    }

    /// Pair up each day's two columns.
    ///
    /// A day owns a `組数` column and the `ｷｬ付` beside it, under one merged
    /// date cell — so the date is read by carrying the last one seen forward,
    /// the same way a person reads it.
    fn day_columns(&self, grid: &SheetGrid, year: i32) -> Result<Vec<DayColumns>, CourseError> {
        let width = grid.width();
        let subheader_row = self.header_row + 1;
        let mut days: Vec<DayColumns> = Vec::new();
        let mut current: Option<(u32, u32)> = None;
        let mut previous_month: Option<u32> = None;
        // Carried across columns, not recomputed from `year` each time: once an
        // export has crossed into January every later column is in the new year
        // too, and re-deriving would send the 2nd back eleven months behind the
        // 1st.
        let mut current_year = year;

        for column in 0..width {
            let heading = grid.cell(self.header_row, column);
            if !heading.is_empty() {
                // A `合計` column heads the sheet and is not a day; leaving
                // `current` unset skips it and its caddie column together.
                current = parse_day_heading(heading);
            }
            if grid.cell(subheader_row, column) != TOTAL_GROUPS_HEADER {
                continue;
            }
            let Some((month, day)) = current else {
                continue;
            };
            if grid.cell(subheader_row, column + 1) != CADDIE_GROUPS_HEADER {
                continue;
            }
            // A month that goes backwards means the export crossed a new year:
            // a December file carrying a `1/4` column is January's 4th, not the
            // one eleven months behind it.
            if previous_month.is_some_and(|previous| month < previous) {
                current_year += 1;
            }
            previous_month = Some(month);
            let Some(date) = NaiveDate::from_ymd_opt(current_year, month, day) else {
                return Err(CourseError::BadRequest(
                    "the sheet has a column headed with a date that does not exist",
                ));
            };
            days.push(DayColumns {
                date,
                total_column: column,
                caddie_column: column + 1,
            });
            current = None;
        }
        Ok(days)
    }
}

struct DayColumns {
    date: NaiveDate,
    total_column: usize,
    caddie_column: usize,
}

/// `7/1(水)\n晴→晴` → July 1st.
///
/// The weather shares the cell with the date and is not a fact about bookings —
/// this file says a July Saturday was `曇→曇り後雪` — so only the part before
/// the line break is read.
fn parse_day_heading(heading: &str) -> Option<(u32, u32)> {
    let head = heading.split(['\n', '\r']).next()?.trim();
    let head = head.split(['(', '（']).next()?.trim();
    let (month, day) = head.split_once('/')?;
    let month = month.trim().parse::<u32>().ok()?;
    let day = day.trim().parse::<u32>().ok()?;
    (1..=12).contains(&month).then_some((month, day))?;
    (1..=31).contains(&day).then_some((month, day))
}

/// The course name without the hole count the sheet appends under it.
fn short_label(value: &str) -> String {
    value
        .split(['\n', '\r'])
        .next()
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn half_day(value: &str) -> Option<TimeOfDay> {
    match value {
        MORNING => Some(TimeOfDay::Morning),
        AFTERNOON => Some(TimeOfDay::Afternoon),
        _ => None,
    }
}

/// A count, or nothing if the cell does not hold one.
///
/// The budget rows write an absent caddie count as `－` — a full-width hyphen,
/// not a zero — and a spreadsheet reader may hand an integer back as `147.0`.
/// Both have to survive being read as text.
fn count(value: &str) -> Option<i32> {
    let cleaned: String = value
        .chars()
        .filter(|character| !character.is_whitespace() && *character != ',' && *character != '，')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    if let Ok(parsed) = cleaned.parse::<i32>() {
        return Some(parsed);
    }
    // `147.0` is the same count as `147`; `147.5` is not a number of groups.
    let parsed = cleaned.parse::<f64>().ok()?;
    (parsed.fract() == 0.0 && parsed.abs() < i32::MAX as f64).then_some(parsed as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sheet shaped like the club's: two header rows with the merged cells
    /// blank, label columns merged down the side, and the series stacked.
    fn grid(rows: Vec<Vec<&str>>) -> SheetGrid {
        SheetGrid::new(
            rows.into_iter()
                .map(|row| row.into_iter().map(str::to_string).collect())
                .collect(),
        )
    }

    fn two_day_sheet() -> SheetGrid {
        grid(vec![
            vec![
                "ゴルフ場",
                "項目",
                "時間帯",
                "合計",
                "",
                "7/1(水)\n晴→晴",
                "",
                "7/2(木)",
                "",
            ],
            vec!["", "", "", "組数", "ｷｬ付", "組数", "ｷｬ付", "組数", "ｷｬ付"],
            vec!["全体\n81H", "本年", "午前", "20", "8", "12", "5", "8", "3"],
            vec!["", "", "午後", "10", "4", "6", "2", "4", "2"],
            vec!["", "", "合計", "30", "12", "18", "7", "12", "5"],
            vec!["", "前年実績", "午前", "99", "99", "99", "99", "99", "99"],
            vec!["真駒内\n36H", "本年", "午前", "12", "5", "7", "3", "5", "2"],
            vec!["", "", "午後", "6", "2", "4", "1", "2", "1"],
            vec!["", "", "合計", "18", "7", "11", "4", "7", "3"],
            vec!["", "予算", "合計", "40", "－", "20", "－", "20", "－"],
            vec!["滝の\n27H", "本年", "午前", "8", "3", "5", "2", "3", "1"],
            vec!["", "", "午後", "4", "2", "2", "1", "2", "1"],
        ])
    }

    #[test]
    fn only_what_is_booked_is_read_and_the_comparisons_beside_it_are_not() {
        // Last year, the budget and the variances share the column space with
        // this year's numbers; importing them would count the month twice over.
        let sheet = parse_reservation_sheet(&two_day_sheet(), 2026).unwrap();
        assert!(sheet
            .summaries
            .iter()
            .all(|summary| summary.total_groups < 99));
        assert_eq!(sheet.course_labels, vec!["真駒内", "滝の"]);
    }

    #[test]
    fn the_club_wide_row_is_the_check_not_a_course_to_import() {
        // `全体` is the three courses added up. Storing it would double the club.
        let sheet = parse_reservation_sheet(&two_day_sheet(), 2026).unwrap();
        assert!(!sheet
            .summaries
            .iter()
            .any(|summary| summary.course_label.starts_with("全体")));
        assert!(!sheet.course_labels.iter().any(|label| label == "全体"));
    }

    #[test]
    fn the_half_days_are_kept_and_the_row_that_adds_them_up_is_not() {
        let sheet = parse_reservation_sheet(&two_day_sheet(), 2026).unwrap();
        let makomanai: Vec<&SheetDaySummary> = sheet
            .summaries
            .iter()
            .filter(|summary| summary.course_label == "真駒内")
            .collect();
        // Two days, two halves each. A `合計` row would make it six.
        assert_eq!(makomanai.len(), 4);
        assert!(makomanai
            .iter()
            .all(|summary| summary.total_groups <= 7 || summary.time_of_day == TimeOfDay::Morning));
    }

    #[test]
    fn the_running_total_column_is_not_mistaken_for_a_day() {
        // `合計` heads the first pair of columns and would otherwise import as
        // a 31-times-oversized day.
        let sheet = parse_reservation_sheet(&two_day_sheet(), 2026).unwrap();
        assert_eq!(
            sheet.dates,
            vec![
                NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
                NaiveDate::from_ymd_opt(2026, 7, 2).unwrap(),
            ]
        );
    }

    #[test]
    fn the_year_comes_from_the_caller_because_the_sheet_never_writes_one() {
        let sheet = parse_reservation_sheet(&two_day_sheet(), 2027).unwrap();
        assert_eq!(sheet.dates[0], NaiveDate::from_ymd_opt(2027, 7, 1).unwrap());
    }

    #[test]
    fn a_december_export_that_runs_into_january_does_not_land_eleven_months_early() {
        // Every column after the turn is in the new year, not just the first:
        // deriving each one from the file's own year would send the 2nd back
        // to the January eleven months behind the 1st, out of order with it.
        let sheet = grid(vec![
            vec![
                "ゴルフ場",
                "項目",
                "時間帯",
                "12/31(木)",
                "",
                "1/1(金)",
                "",
                "1/2(土)",
                "",
            ],
            vec!["", "", "", "組数", "ｷｬ付", "組数", "ｷｬ付", "組数", "ｷｬ付"],
            vec!["真駒内", "本年", "午前", "3", "1", "4", "2", "5", "3"],
        ]);
        let sheet = parse_reservation_sheet(&sheet, 2026).unwrap();
        assert_eq!(
            sheet.dates,
            vec![
                NaiveDate::from_ymd_opt(2026, 12, 31).unwrap(),
                NaiveDate::from_ymd_opt(2027, 1, 1).unwrap(),
                NaiveDate::from_ymd_opt(2027, 1, 2).unwrap(),
            ]
        );
        // The window an import replaces runs from the first date to the last,
        // so a date out of order would make it run backwards.
        assert!(sheet.dates.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn the_weather_sharing_the_date_cell_is_ignored() {
        // This very file reports snow on a July Saturday.
        assert_eq!(parse_day_heading("7/18(土)\n曇→曇り後雪"), Some((7, 18)));
        assert_eq!(parse_day_heading("7/19(日)"), Some((7, 19)));
        assert_eq!(parse_day_heading("合計"), None);
    }

    #[test]
    fn a_day_a_course_is_closed_is_imported_as_zero_rather_than_left_out() {
        // A missing row would leave last week's count standing after the next
        // export; a zero says the course sent nobody out.
        let sheet = grid(vec![
            vec!["ゴルフ場", "項目", "時間帯", "7/6(月)", ""],
            vec!["", "", "", "組数", "ｷｬ付"],
            vec!["真駒内", "本年", "午前", "0", "0"],
        ]);
        let sheet = parse_reservation_sheet(&sheet, 2026).unwrap();
        assert_eq!(sheet.summaries.len(), 1);
        assert_eq!(sheet.summaries[0].total_groups, 0);
    }

    #[test]
    fn a_count_that_is_not_a_number_is_reported_by_its_day_not_its_cell() {
        let sheet = grid(vec![
            vec!["ゴルフ場", "項目", "時間帯", "7/3(金)", ""],
            vec!["", "", "", "組数", "ｷｬ付"],
            vec!["滝の", "本年", "午前", "未定", "2"],
            vec!["", "", "午後", "4", "1"],
        ]);
        let sheet = parse_reservation_sheet(&sheet, 2026).unwrap();
        assert_eq!(sheet.summaries.len(), 1);
        assert_eq!(
            sheet.warnings,
            vec![ImportWarning::UnreadableCount {
                course_label: "滝の".into(),
                date: NaiveDate::from_ymd_opt(2026, 7, 3).unwrap(),
                time_of_day: TimeOfDay::Morning,
            }]
        );
        // Counted as left out, not merely warned about: the screen tells the
        // desk how many half-days did not make it, and a warning with a zero
        // beside it reads as "nothing was lost".
        assert_eq!(sheet.dropped_half_days, 1);
    }

    #[test]
    fn more_caddie_groups_than_groups_is_imported_and_flagged() {
        // The file is the club's record, so it is taken as sent — but one of
        // the two numbers is wrong and somebody has to be told.
        let sheet = grid(vec![
            vec!["ゴルフ場", "項目", "時間帯", "7/3(金)", ""],
            vec!["", "", "", "組数", "ｷｬ付"],
            vec!["滝の", "本年", "午前", "3", "9"],
        ]);
        let sheet = parse_reservation_sheet(&sheet, 2026).unwrap();
        assert_eq!(sheet.summaries.len(), 1);
        assert!(matches!(
            sheet.warnings.as_slice(),
            [ImportWarning::CaddieGroupsExceedTotal { .. }]
        ));
    }

    #[test]
    fn courses_that_do_not_add_up_to_the_clubs_own_total_are_reported() {
        // A course dropped by an upstream layout change looks exactly like this
        // and like nothing else.
        let sheet = grid(vec![
            vec!["ゴルフ場", "項目", "時間帯", "7/3(金)", ""],
            vec!["", "", "", "組数", "ｷｬ付"],
            vec!["全体", "本年", "午前", "20", "8"],
            vec!["滝の", "本年", "午前", "12", "5"],
        ]);
        let sheet = parse_reservation_sheet(&sheet, 2026).unwrap();
        assert_eq!(
            sheet.warnings,
            vec![ImportWarning::CourseTotalsDisagreeWithSheet {
                date: NaiveDate::from_ymd_opt(2026, 7, 3).unwrap(),
                time_of_day: TimeOfDay::Morning,
                sheet_total: 20,
                imported_total: 12,
            }]
        );
    }

    #[test]
    fn a_month_whose_courses_add_up_reports_nothing() {
        let sheet = parse_reservation_sheet(&two_day_sheet(), 2026).unwrap();
        assert_eq!(sheet.warnings, Vec::new());
    }

    #[test]
    fn the_label_columns_are_found_by_their_headings_rather_than_by_position() {
        // An upstream column insert would otherwise shift every count sideways
        // onto the wrong course.
        let sheet = grid(vec![
            vec!["出力日", "ゴルフ場", "項目", "時間帯", "7/3(金)", ""],
            vec!["", "", "", "", "組数", "ｷｬ付"],
            vec!["", "滝の", "本年", "午前", "12", "5"],
        ]);
        let sheet = parse_reservation_sheet(&sheet, 2026).unwrap();
        assert_eq!(sheet.summaries[0].course_label, "滝の");
        assert_eq!(sheet.summaries[0].total_groups, 12);
    }

    #[test]
    fn a_file_that_is_not_this_report_is_refused_rather_than_imported_empty() {
        let sheet = grid(vec![vec!["氏名", "電話番号"], vec!["山田", "090"]]);
        assert!(parse_reservation_sheet(&sheet, 2026).is_err());
    }

    #[test]
    fn a_report_with_no_booked_series_is_refused_rather_than_wiping_the_month() {
        let sheet = grid(vec![
            vec!["ゴルフ場", "項目", "時間帯", "7/3(金)", ""],
            vec!["", "", "", "組数", "ｷｬ付"],
            vec!["滝の", "前年実績", "午前", "12", "5"],
        ]);
        assert!(parse_reservation_sheet(&sheet, 2026).is_err());
    }

    #[test]
    fn the_month_comes_from_the_file_name_because_the_sheet_has_no_year() {
        assert_eq!(
            year_month_from_file_name("日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx"),
            Some((2026, 7)),
        );
    }

    #[test]
    fn the_export_date_is_not_mistaken_for_the_month_it_covers() {
        // A club that pulls August's sheet in July would otherwise import the
        // whole month a month early, on days that already have counts.
        assert_eq!(
            year_month_from_file_name("日別予約状況_組数_20260718_202608_真駒内.xlsx"),
            Some((2026, 8)),
        );
    }

    #[test]
    fn a_name_with_no_month_in_it_is_not_guessed_at() {
        // Better to ask the desk which month this is than to put a month of
        // bookings on the wrong dates.
        assert_eq!(year_month_from_file_name("予約状況.xlsx"), None);
        assert_eq!(year_month_from_file_name("日別予約状況_202699.xlsx"), None);
        assert_eq!(year_month_from_file_name(""), None);
    }

    #[test]
    fn counts_survive_the_shapes_a_spreadsheet_hands_them_back_in() {
        assert_eq!(count("147"), Some(147));
        assert_eq!(count("147.0"), Some(147));
        assert_eq!(count("1,147"), Some(1147));
        assert_eq!(count("0"), Some(0));
        // The budget row's absent caddie count, and an empty cell.
        assert_eq!(count("－"), None);
        assert_eq!(count(""), None);
        assert_eq!(count("147.5"), None);
    }
}
