//! The start ledger a course's own booking system prints for a day
//! (「スタート予約台帳(ＡＬＬ)」), read back into one group per tee time.
//!
//! The sheet is a picture of the day, not a list of bookings: each course is a
//! block of tee-time rows, a row holds the group's representative, up to four
//! players with their rate class and number, and a last column carrying the
//! plan and the desk's 【食】/【集計】/【精算】 lines. A row whose detail is
//! the same as the one above prints 「↓」 instead of repeating it.
//!
//! This module knows how that sheet is laid out (what the reader is asked
//! for) and how to turn what it read into groups the desk can check. It does
//! not decide which CourseBoard course or plan a printed name means — that is
//! the desk's call on the review screen.

use super::{
    CourseError, GatewayCredentials, PartyRemarks, ReceptionOcrColumn, ReceptionOcrField,
    ReceptionOcrJobSheets, ReceptionOcrJobStatus, ReceptionOcrJobUpload,
};

/// Field's generic OCR entity the start ledger is read as.
///
/// A key of its own rather than the reservation-report reader's: that reader
/// forces its own table schema, and this sheet needs ours. Field guards it with
/// the same action as writing a booking, which is what a read feeds.
pub const START_LEDGER_OCR_ENTITY_KEY: &str = "courseboardStartLedger";
pub const START_LEDGER_DATE_KEY: &str = "date";
pub const START_LEDGER_PARTIES_KEY: &str = "parties";

/// The paper ledger draws four players per group.
pub const START_LEDGER_PLAYER_COLUMNS: usize = 4;

/// Field's reservation notes are free text; this keeps a sheet's stray memo
/// from becoming an unbounded write.
pub const MAX_START_LEDGER_NOTES_CHARS: usize = 1_000;

pub const COLUMN_COURSE: &str = "course";
pub const COLUMN_TEE_TIME: &str = "teeTime";
pub const COLUMN_PLAY_STYLE: &str = "playStyle";
pub const COLUMN_REPRESENTATIVE: &str = "representative";
pub const COLUMN_GROUP_NAME: &str = "groupName";
pub const COLUMN_PLAN: &str = "plan";
pub const COLUMN_REMARKS: &str = "remarks";

pub fn player_column(index: usize, part: &str) -> String {
    format!("player{}{part}", index + 1)
}

/// What the reader is asked for. The labels are the prompt, so they describe
/// the printed sheet in its own words.
pub fn start_ledger_schema() -> Vec<ReceptionOcrField> {
    let text = |key: &str, label: &str| ReceptionOcrColumn {
        key: key.to_string(),
        label: label.to_string(),
        field_type: "text".to_string(),
        options: Vec::new(),
    };
    let mut columns = vec![
        text(COLUMN_COURSE, "コース名（ブロックの見出し。例: 空沼OUT）"),
        text(COLUMN_TEE_TIME, "スタート時刻（HH:MM）"),
        text(
            COLUMN_PLAY_STYLE,
            "時刻の下の区分（セルフ・キャディ・キャ+カート などを印字どおり）",
        ),
        text(
            COLUMN_REPRESENTATIVE,
            "代表者欄の1行目の名前（「↓」と印字されていれば ↓）",
        ),
        text(
            COLUMN_GROUP_NAME,
            "代表者欄の2行目（会の名前や「〇〇 様」。「↓」なら ↓、無ければ空）",
        ),
    ];
    for index in 0..START_LEDGER_PLAYER_COLUMNS {
        let n = index + 1;
        columns.push(text(
            &player_column(index, "Tag"),
            &format!("{n}人目の区分（名前の上の 共通・ビジタ など）"),
        ));
        columns.push(text(
            &player_column(index, "Number"),
            &format!("{n}人目の番号（名前の右上の 1・1001 など）"),
        ));
        columns.push(text(
            &player_column(index, "Name"),
            &format!("{n}人目の名前"),
        ));
    }
    columns.push(text(
        COLUMN_PLAN,
        "右端の欄の1行目のプラン名（例: 早期予約133）。「↓」なら ↓",
    ));
    columns.push(ReceptionOcrColumn {
        key: COLUMN_REMARKS.to_string(),
        label: "右端の欄のプラン名以外の行（【食】【集計】【精算】やメモ）を1行ずつ改行で"
            .to_string(),
        field_type: "textarea".to_string(),
        options: Vec::new(),
    });
    vec![
        ReceptionOcrField {
            key: START_LEDGER_DATE_KEY.to_string(),
            label: "対象日（左上の 2026年11月07日(土) のような日付）".to_string(),
            field_type: "date".to_string(),
            options: Vec::new(),
            item_fields: Vec::new(),
        },
        ReceptionOcrField {
            key: START_LEDGER_PARTIES_KEY.to_string(),
            label: "予約の組。コースのブロックごと、時刻の行ごとに1件。名前が一つも無い空の時刻は含めない"
                .to_string(),
            field_type: "items".to_string(),
            options: Vec::new(),
            item_fields: columns,
        },
    ]
}

/// One player cell as it was read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartLedgerRowPlayer {
    pub tag: Option<String>,
    pub number: Option<String>,
    pub name: Option<String>,
}

/// One tee-time row exactly as the reader answered, ditto marks included.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartLedgerRow {
    pub course: Option<String>,
    pub tee_time: Option<String>,
    pub play_style: Option<String>,
    pub representative: Option<String>,
    pub group_name: Option<String>,
    pub players: Vec<StartLedgerRowPlayer>,
    pub plan: Option<String>,
    pub remarks: Option<String>,
}

/// Whether the sheet says the group plays on its own or with a caddie.
///
/// The booking does not store this — the plan does (see
/// [`super::ReservationProduct::requires_caddie`]). It is kept so the review
/// screen can say when the plan the desk picked disagrees with the sheet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerPlayStyle {
    SelfPlay,
    Caddie,
}

impl LedgerPlayStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SelfPlay => "self",
            Self::Caddie => "caddie",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "self" => Some(Self::SelfPlay),
            "caddie" => Some(Self::Caddie),
            _ => None,
        }
    }

    /// `セルフ`, `キャディ`, `ｷｬﾃﾞｨ`, `キャ+カート` (caddie with a cart), …
    fn from_sheet(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.contains("セルフ") || value.contains("ｾﾙﾌ") {
            Some(Self::SelfPlay)
        } else if value.contains("キャ") || value.contains("ｷｬ") {
            Some(Self::Caddie)
        } else {
            None
        }
    }
}

/// One group as read off the sheet, with 「↓」 already replaced by the value
/// it stands for. Nothing here is checked against the tenant's courses or
/// plans; the names are what was printed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartLedgerParty {
    pub course_name: Option<String>,
    /// `HH:MM`, or what was read when it could not be made into a time.
    pub tee_time: Option<String>,
    pub play_style: Option<LedgerPlayStyle>,
    pub play_style_text: Option<String>,
    pub representative: Option<String>,
    pub group_name: Option<String>,
    pub players: Vec<StartLedgerRowPlayer>,
    pub plan_name: Option<String>,
    pub remarks: PartyRemarks,
    /// Lines from the last column that are not a 【食】/【集計】/【精算】 line.
    pub notes: Option<String>,
    /// Which values came from the row above, so the desk knows to look there.
    pub copied_from_above: Vec<&'static str>,
    /// Things the desk has to decide by looking at the original.
    pub warnings: Vec<&'static str>,
}

pub const WARNING_DITTO_WITHOUT_ROW_ABOVE: &str = "ditto_without_row_above";
pub const WARNING_TEE_TIME_UNREADABLE: &str = "tee_time_unreadable";
pub const WARNING_PLAYER_WITHOUT_NAME: &str = "player_without_name";
pub const WARNING_PLAY_STYLE_UNKNOWN: &str = "play_style_unknown";

/// Turn the rows the reader answered with into groups, in sheet order.
///
/// Rows with nobody on them are empty tee times and are dropped. 「↓」 is
/// resolved against the previous kept row of the same course block — the
/// sheet prints two blocks side by side, so "the row above" is never the
/// other course's.
pub fn parse_start_ledger_rows(rows: &[StartLedgerRow]) -> Vec<StartLedgerParty> {
    let mut parties: Vec<StartLedgerParty> = Vec::new();
    let mut last_course: Option<String> = None;
    for row in rows {
        let course_name = clean(&row.course)
            .filter(|value| !is_ditto(value))
            .or_else(|| last_course.clone());
        let previous = parties
            .iter()
            .rev()
            .find(|party| party.course_name == course_name);
        let mut copied = Vec::new();
        let mut warnings = Vec::new();
        let mut resolve =
            |value: &Option<String>, label: &'static str, above: Option<&Option<String>>| {
                let value = clean(value)?;
                if !is_ditto(&value) {
                    return Some(value);
                }
                match above {
                    Some(previous) => {
                        copied.push(label);
                        previous.clone()
                    }
                    None => {
                        warnings.push(WARNING_DITTO_WITHOUT_ROW_ABOVE);
                        None
                    }
                }
            };
        let representative = resolve(
            &row.representative,
            COLUMN_REPRESENTATIVE,
            previous.map(|p| &p.representative),
        );
        let group_name = resolve(
            &row.group_name,
            COLUMN_GROUP_NAME,
            previous.map(|p| &p.group_name),
        );
        let play_style_text = resolve(
            &row.play_style,
            COLUMN_PLAY_STYLE,
            previous.map(|p| &p.play_style_text),
        );
        let plan_name = resolve(&row.plan, COLUMN_PLAN, previous.map(|p| &p.plan_name));
        let remarks_text = clean(&row.remarks);
        let remarks_ditto = remarks_text.as_deref().is_some_and(is_ditto);

        let mut players = Vec::new();
        for player in &row.players {
            let tag = clean(&player.tag).filter(|value| !is_ditto(value));
            let number = clean(&player.number).filter(|value| !is_ditto(value));
            let name = clean(&player.name).filter(|value| !is_ditto(value));
            if name.is_none() {
                if tag.is_some() || number.is_some() {
                    warnings.push(WARNING_PLAYER_WITHOUT_NAME);
                }
                continue;
            }
            players.push(StartLedgerRowPlayer { tag, number, name });
        }
        if representative.is_none() && players.is_empty() {
            continue;
        }

        let (remarks, notes) = if remarks_ditto {
            match previous {
                Some(previous) => {
                    copied.push(COLUMN_REMARKS);
                    (previous.remarks.clone(), previous.notes.clone())
                }
                None => {
                    warnings.push(WARNING_DITTO_WITHOUT_ROW_ABOVE);
                    (PartyRemarks::default(), None)
                }
            }
        } else {
            split_remarks(remarks_text.as_deref().unwrap_or_default())
        };

        let tee_time = clean(&row.tee_time).map(|raw| match normalize_tee_time(&raw) {
            Some(time) => time,
            None => {
                warnings.push(WARNING_TEE_TIME_UNREADABLE);
                raw
            }
        });
        if tee_time.is_none() {
            warnings.push(WARNING_TEE_TIME_UNREADABLE);
        }
        let play_style = play_style_text
            .as_deref()
            .and_then(LedgerPlayStyle::from_sheet);
        if play_style.is_none() {
            warnings.push(WARNING_PLAY_STYLE_UNKNOWN);
        }
        warnings.dedup();
        last_course = course_name.clone();
        parties.push(StartLedgerParty {
            course_name,
            tee_time,
            play_style,
            play_style_text,
            representative,
            group_name,
            players,
            plan_name,
            remarks,
            notes,
            copied_from_above: copied,
            warnings,
        });
    }
    parties
}

/// Split the last column into the structured remarks and whatever else the
/// desk wrote there. A reader that ran the lines together still splits: every
/// 【 starts a new line.
pub fn split_remarks(text: &str) -> (PartyRemarks, Option<String>) {
    let mut lines = Vec::new();
    for line in text.lines() {
        let mut current = String::new();
        for ch in line.chars() {
            if ch == '【' && !current.trim().is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            current.push(ch);
        }
        if !current.trim().is_empty() {
            lines.push(current);
        }
    }
    let (remarks, leftovers) = PartyRemarks::from_ledger_lines(lines.iter().map(String::as_str));
    let notes = leftovers.join("\n");
    let notes = notes.trim();
    (
        remarks,
        (!notes.is_empty()).then(|| notes.chars().take(MAX_START_LEDGER_NOTES_CHARS).collect()),
    )
}

/// `08:45`, `8:45`, `０８：４５`, `08.45` → `08:45`.
pub fn normalize_tee_time(value: &str) -> Option<String> {
    let half: String = value.trim().chars().map(to_half_width).collect();
    let (hour, minute) = half.split_once([':', '.', '時'])?;
    let minute = minute.trim_end_matches('分');
    let hour: u32 = hour.trim().parse().ok()?;
    let minute: u32 = minute.trim().parse().ok()?;
    (hour < 24 && minute < 60).then(|| format!("{hour:02}:{minute:02}"))
}

/// Notes for a booking, refused when longer than Field should be asked to keep.
pub fn normalize_ledger_notes(value: Option<String>) -> Result<Option<String>, CourseError> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_START_LEDGER_NOTES_CHARS {
        return Err(CourseError::BadRequest(
            "notes must be at most 1000 characters",
        ));
    }
    Ok(Some(trimmed.to_string()))
}

fn to_half_width(ch: char) -> char {
    match ch {
        '０'..='９' => char::from_u32(ch as u32 - '０' as u32 + '0' as u32).unwrap_or(ch),
        '：' => ':',
        '．' => '.',
        _ => ch,
    }
}

fn clean(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// 「↓」 (often printed once per line of the cell, so read as `↓↓↓`), and the
/// other ways a sheet says "same as above".
pub fn is_ditto(value: &str) -> bool {
    let value = value.trim();
    if value == "同上" {
        return true;
    }
    !value.is_empty()
        && value
            .chars()
            .all(|ch| matches!(ch, '↓' | '⇓' | '〃' | '″') || ch.is_whitespace())
}

/// What the reader has made of the sheet so far.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartLedgerDraft {
    /// The day printed at the top, when the reader could make it out.
    pub date: Option<chrono::NaiveDate>,
    pub rows: Vec<StartLedgerRow>,
    pub warnings: Vec<String>,
}

/// A persistent read of start-ledger PDFs through Field's generic OCR jobs.
#[derive(Debug, Clone, PartialEq)]
pub struct StartLedgerOcrJob {
    pub id: String,
    pub status: ReceptionOcrJobStatus,
    pub completed_units: u32,
    pub total_units: Option<u32>,
    pub draft: StartLedgerDraft,
    pub failure_code: Option<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StartLedgerOcrJobCreated {
    pub job: StartLedgerOcrJob,
    pub uploads: Vec<ReceptionOcrJobUpload>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartLedgerOcrStep {
    /// The browser finished its Storage PUTs.
    Confirm,
    /// Read the next bounded piece.
    Advance,
}

impl StartLedgerOcrStep {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Confirm => "confirm",
            Self::Advance => "advance",
        }
    }
}

/// Port to Field's generic OCR jobs, read with [`start_ledger_schema`].
#[async_trait::async_trait]
pub trait StartLedgerOcrGateway: Send + Sync {
    async fn create_job(
        &self,
        credentials: GatewayCredentials<'_>,
        idempotency_key: &str,
        sheets: &ReceptionOcrJobSheets,
    ) -> Result<StartLedgerOcrJobCreated, CourseError>;

    async fn step_job(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
        step: StartLedgerOcrStep,
    ) -> Result<StartLedgerOcrJob, CourseError>;

    async fn get_job(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<StartLedgerOcrJob, CourseError>;

    async fn cancel_job(
        &self,
        credentials: GatewayCredentials<'_>,
        job_id: &str,
    ) -> Result<StartLedgerOcrJob, CourseError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::PartySettlement;

    fn player(tag: &str, number: &str, name: &str) -> StartLedgerRowPlayer {
        let some = |v: &str| (!v.is_empty()).then(|| v.to_string());
        StartLedgerRowPlayer {
            tag: some(tag),
            number: some(number),
            name: some(name),
        }
    }

    fn row(course: &str, time: &str, style: &str, rep: &str, group: &str) -> StartLedgerRow {
        let some = |v: &str| (!v.is_empty()).then(|| v.to_string());
        StartLedgerRow {
            course: some(course),
            tee_time: some(time),
            play_style: some(style),
            representative: some(rep),
            group_name: some(group),
            ..Default::default()
        }
    }

    /// The first rows of the 2026-11-07 sample, as the reader would answer.
    fn sample() -> Vec<StartLedgerRow> {
        vec![
            StartLedgerRow {
                players: vec![
                    player("共通", "1", "丹治 敦"),
                    player("共通", "1", "髙橋 康彦"),
                    player("共通", "1", "佐藤 千津絵"),
                    player("共通", "1", "菊池 芳彦"),
                ],
                plan: Some("早期予約133".into()),
                ..row("空沼OUT", "08:45", "キャディ", "菊池 芳彦", "菊池 芳彦 様")
            },
            StartLedgerRow {
                players: vec![
                    player("共通", "1001", "坂東 勝"),
                    player("共通", "1001", "坪田 憲三"),
                    player("共通", "1001", "加藤 美之"),
                ],
                plan: Some("早期予約19（全20回）".into()),
                remarks: Some("【食】各自注文\n【集計】有\n【精算】個人".into()),
                ..row("空沼IN", "08:45", "セルフ", "加藤 美之", "１・３会")
            },
            StartLedgerRow {
                players: vec![
                    player("共通", "1", "山形 洋一"),
                    player("共通", "1", "川島 敏也"),
                    player("共通", "1", "石川 雄洋"),
                    player("共通", "1", "竹ヶ原 祐子"),
                ],
                plan: Some("早期予約133".into()),
                ..row("空沼OUT", "08:52", "キャディ", "↓", "↓")
            },
            StartLedgerRow {
                players: vec![
                    player("共通", "1001", "及川 文則"),
                    player("共通", "1001", "小林 一清"),
                ],
                plan: Some("↓".into()),
                remarks: Some("↓".into()),
                ..row("空沼IN", "08:52", "セルフ", "↓↓↓", "↓")
            },
            row("空沼OUT", "09:06", "", "", ""),
            StartLedgerRow {
                players: vec![
                    player("", "1141", "小北 健史"),
                    player("", "1141", "荒尾 正久"),
                ],
                remarks: Some("2B@2750 3B1650 ﾛｯｶｰ@440 ｷｬﾝｾﾙ料説明済み".into()),
                ..row("空沼IN", "9:20", "セルフ", "大石 佳範", "")
            },
            StartLedgerRow {
                players: vec![player("共通", "2001", "神田 雅之"), player("", "2131", "")],
                ..row("空沼OUT", "08:59", "キャ+カート", "神田 雅之", "")
            },
        ]
    }

    #[test]
    fn empty_tee_times_are_not_groups() {
        let parties = parse_start_ledger_rows(&sample());
        assert_eq!(parties.len(), 6);
        assert!(parties
            .iter()
            .all(|party| party.tee_time.as_deref() != Some("09:06")));
    }

    #[test]
    fn a_ditto_copies_from_the_row_above_in_the_same_course_block() {
        let parties = parse_start_ledger_rows(&sample());
        let out_0852 = &parties[2];
        assert_eq!(out_0852.course_name.as_deref(), Some("空沼OUT"));
        assert_eq!(out_0852.representative.as_deref(), Some("菊池 芳彦"));
        assert_eq!(out_0852.group_name.as_deref(), Some("菊池 芳彦 様"));
        assert_eq!(
            out_0852.copied_from_above,
            vec![COLUMN_REPRESENTATIVE, COLUMN_GROUP_NAME]
        );

        // Not the OUT row that sits just before it in reading order.
        let in_0852 = &parties[3];
        assert_eq!(in_0852.representative.as_deref(), Some("加藤 美之"));
        assert_eq!(in_0852.group_name.as_deref(), Some("１・３会"));
        assert_eq!(in_0852.plan_name.as_deref(), Some("早期予約19（全20回）"));
        assert_eq!(in_0852.remarks, parties[1].remarks);
        assert!(in_0852.copied_from_above.contains(&COLUMN_REMARKS));
    }

    #[test]
    fn remarks_lines_are_split_and_the_rest_becomes_notes() {
        let parties = parse_start_ledger_rows(&sample());
        let remarks = &parties[1].remarks;
        assert_eq!(remarks.meal(), Some("各自注文"));
        assert_eq!(remarks.score_tally(), Some(true));
        assert_eq!(remarks.settlement(), Some(PartySettlement::Individual));
        assert_eq!(parties[1].notes, None);

        let memo = &parties[4];
        assert!(memo.remarks.is_empty());
        assert_eq!(
            memo.notes.as_deref(),
            Some("2B@2750 3B1650 ﾛｯｶｰ@440 ｷｬﾝｾﾙ料説明済み")
        );
        assert_eq!(memo.tee_time.as_deref(), Some("09:20"));
    }

    #[test]
    fn remarks_run_together_on_one_line_still_split() {
        let (remarks, notes) = split_remarks("【食】各自注文 【集計】有【精算】個人 カード");
        assert_eq!(remarks.meal(), Some("各自注文"));
        assert_eq!(remarks.score_tally(), Some(true));
        assert_eq!(notes, Some("【精算】個人 カード".into()));
    }

    #[test]
    fn play_style_reads_caddie_with_cart_as_caddie() {
        let parties = parse_start_ledger_rows(&sample());
        assert_eq!(parties[0].play_style, Some(LedgerPlayStyle::Caddie));
        assert_eq!(parties[1].play_style, Some(LedgerPlayStyle::SelfPlay));
        assert_eq!(parties[5].play_style, Some(LedgerPlayStyle::Caddie));
    }

    #[test]
    fn a_player_cell_without_a_name_is_flagged_not_invented() {
        let parties = parse_start_ledger_rows(&sample());
        assert_eq!(parties[5].players.len(), 1);
        assert!(parties[5].warnings.contains(&WARNING_PLAYER_WITHOUT_NAME));
    }

    #[test]
    fn a_ditto_on_the_first_row_of_a_block_is_left_for_the_desk() {
        let parties = parse_start_ledger_rows(&[StartLedgerRow {
            players: vec![player("共通", "1", "森 道夫")],
            ..row("空沼IN", "08:59", "セルフ", "↓", "")
        }]);
        assert_eq!(parties[0].representative, None);
        assert!(parties[0]
            .warnings
            .contains(&WARNING_DITTO_WITHOUT_ROW_ABOVE));
    }

    #[test]
    fn tee_times_are_normalized() {
        assert_eq!(normalize_tee_time("8:45").as_deref(), Some("08:45"));
        assert_eq!(normalize_tee_time("０８：５２").as_deref(), Some("08:52"));
        assert_eq!(normalize_tee_time("9時06分").as_deref(), Some("09:06"));
        assert_eq!(normalize_tee_time("25:00"), None);
        assert_eq!(normalize_tee_time("早朝"), None);
    }

    #[test]
    fn the_schema_fits_fields_item_column_limit() {
        let schema = start_ledger_schema();
        assert_eq!(schema[1].key, START_LEDGER_PARTIES_KEY);
        assert!(schema[1].item_fields.len() <= super::super::MAX_RECEPTION_OCR_COLUMNS);
        assert!(schema
            .iter()
            .flat_map(|field| std::iter::once(&field.label)
                .chain(field.item_fields.iter().map(|c| &c.label)))
            .all(|label| label.chars().count() <= 120));
    }
}
