//! Turning an uploaded `.xlsx` into a grid of text.
//!
//! This is the whole of the file-format work. What the grid *means* — which
//! rows are bookings and which are last year's comparison, which columns are a
//! day — lives in the domain, so that part can be tested without a spreadsheet
//! and does not change when the club's export tool does.

use std::io::Cursor;

use calamine::{Data, Reader, Xlsx};

use crate::course::domain::{CourseError, SheetGrid};

/// The sheet the club's export writes. Named so the right one is read even if a
/// future export grows a second tab.
const RESERVATION_SHEET: &str = "日別予約状況";

/// Read the daily reservation sheet out of an uploaded workbook.
///
/// Merged cells are left as the file has them — the anchor holds the value and
/// the cells it spans are empty — because that is what the domain reader
/// expects: it carries the last label forward the way a person reading the
/// page does, which also works on an export that stops merging.
pub fn read_reservation_sheet(bytes: &[u8]) -> Result<SheetGrid, CourseError> {
    let mut workbook: Xlsx<_> = calamine::open_workbook_from_rs(Cursor::new(bytes))
        .map_err(|_| CourseError::BadRequest("the file is not a readable .xlsx workbook"))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let wanted = sheet_names
        .iter()
        .find(|name| name.trim() == RESERVATION_SHEET)
        .or_else(|| sheet_names.first())
        .ok_or(CourseError::BadRequest("the workbook has no sheets"))?
        .clone();

    let range = workbook
        .worksheet_range(&wanted)
        .map_err(|_| CourseError::BadRequest("the workbook's sheet could not be read"))?;

    Ok(SheetGrid::new(
        range
            .rows()
            .map(|row| row.iter().map(cell_text).collect())
            .collect(),
    ))
}

/// One cell as text.
///
/// Whole numbers are written without the decimal point a spreadsheet stores
/// them with, so a count of 147 does not arrive as `147.0` and have to be
/// re-parsed as a float later. Cells that hold no number at all keep their text
/// — this sheet writes an absent budget figure as `－`, and an error cell has
/// to stay visibly not-a-number rather than become a zero.
fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::Float(value) if value.fract() == 0.0 => format!("{}", *value as i64),
        Data::Float(value) => value.to_string(),
        Data::Int(value) => value.to_string(),
        Data::String(value) => value.clone(),
        Data::Bool(value) => value.to_string(),
        Data::Error(_) => "#ERROR".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{parse_reservation_sheet, ImportWarning, TimeOfDay};
    use chrono::NaiveDate;

    /// The club's own July 2026 export, as received on 2026-07-18.
    const SAMPLE: &[u8] = include_bytes!(
        "../../../tests/fixtures/日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx"
    );

    #[test]
    fn a_spreadsheet_integer_does_not_arrive_with_a_decimal_point_stuck_to_it() {
        assert_eq!(cell_text(&Data::Float(147.0)), "147");
        assert_eq!(cell_text(&Data::Int(66)), "66");
        assert_eq!(cell_text(&Data::Empty), "");
        // The budget row's absent caddie count keeps its full-width hyphen so
        // the reader can tell it apart from a zero.
        assert_eq!(cell_text(&Data::String("－".into())), "－");
    }

    #[test]
    fn a_file_that_is_not_a_workbook_is_refused_with_something_the_desk_can_act_on() {
        assert!(read_reservation_sheet(b"not a spreadsheet").is_err());
    }

    #[test]
    fn the_clubs_own_export_reads_end_to_end() {
        let grid = read_reservation_sheet(SAMPLE).unwrap();
        let sheet = parse_reservation_sheet(&grid, 2026).unwrap();

        assert_eq!(sheet.course_labels, vec!["真駒内", "滝の", "羊ケ丘"]);
        // July, both halves of every day, three courses.
        assert_eq!(sheet.dates.len(), 31);
        assert_eq!(sheet.dates[0], NaiveDate::from_ymd_opt(2026, 7, 1).unwrap());
        assert_eq!(
            sheet.dates[30],
            NaiveDate::from_ymd_opt(2026, 7, 31).unwrap()
        );
        assert_eq!(sheet.summaries.len(), 31 * 2 * 3);
    }

    #[test]
    fn the_clubs_own_export_adds_up_to_its_own_club_wide_row() {
        // The sheet carries a `全体` row that is the three courses summed. If
        // this check fires on the real file, the reader is picking up the wrong
        // rows or columns — which is the failure mode a count-only import
        // cannot otherwise detect.
        let grid = read_reservation_sheet(SAMPLE).unwrap();
        let sheet = parse_reservation_sheet(&grid, 2026).unwrap();
        assert_eq!(sheet.warnings, Vec::new());
    }

    #[test]
    fn a_known_day_from_the_clubs_export_reads_the_way_the_page_does() {
        // 7/1: 真駒内 70 groups in the morning, 21 of them with a caddie.
        let grid = read_reservation_sheet(SAMPLE).unwrap();
        let sheet = parse_reservation_sheet(&grid, 2026).unwrap();
        let first = sheet
            .summaries
            .iter()
            .find(|summary| {
                summary.course_label == "真駒内"
                    && summary.date == NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()
                    && summary.time_of_day == TimeOfDay::Morning
            })
            .expect("真駒内 opens the sheet");
        assert_eq!(first.total_groups, 70);
        assert_eq!(first.caddie_groups, 21);
    }

    #[test]
    fn the_days_makomanai_sends_nobody_out_are_read_as_zero_not_dropped() {
        // 真駒内 books nothing on 7/6, 7/7 and 7/9–7/12 while the other two
        // courses run normally, so these are closures rather than a hole in the
        // file. They have to land as zeros: a missing row would leave the
        // previous export's count standing on a day the course is shut.
        let grid = read_reservation_sheet(SAMPLE).unwrap();
        let sheet = parse_reservation_sheet(&grid, 2026).unwrap();
        let closed: Vec<u32> = (1..=31)
            .filter(|day| {
                let date = NaiveDate::from_ymd_opt(2026, 7, *day).unwrap();
                let mut halves = sheet
                    .summaries
                    .iter()
                    .filter(|summary| summary.course_label == "真駒内" && summary.date == date);
                halves.all(|summary| summary.total_groups == 0)
            })
            .collect();
        assert_eq!(closed, vec![6, 7, 9, 10, 11, 12]);
    }

    #[test]
    fn the_budget_rows_full_width_hyphen_never_becomes_a_warning() {
        // `－` only ever appears in rows this import does not read, so it must
        // not surface as an unreadable count on the real file.
        let grid = read_reservation_sheet(SAMPLE).unwrap();
        let sheet = parse_reservation_sheet(&grid, 2026).unwrap();
        assert!(!sheet
            .warnings
            .iter()
            .any(|warning| matches!(warning, ImportWarning::UnreadableCount { .. })));
    }
}
