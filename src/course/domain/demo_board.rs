//! A demo day for the start ledger: what to create, and how to find it again.
//!
//! This is a seed, not a fixture served from memory: everything below is written
//! into Field once and then read back through the ordinary board. That is the
//! point — a demo that goes through a different code path proves nothing about
//! the one operators use.
//!
//! Re-running must not stack a second day on top of the first, and Field's
//! reservation create has no key that would prevent it (`idempotencyKey` there
//! covers holds and payments, not bookings). So every row the seed writes
//! carries a key of its own, and the seed finds its previous work by that key.

use chrono::NaiveDate;

use super::{CourseError, PartyDetails, PartyPlayer, SlotOverrideKind};

/// Marks a row as the seed's, and says which row it is.
///
/// Stored in the reservation's custom fields beside the group detail. Nothing
/// else writes this key, so the seed can recognise its own work without
/// guessing from names or times — and anyone looking at the data can tell it
/// apart from a real booking.
pub const SEED_KEY_FIELD: &str = "courseBoardDemoSeedKey";

/// Prefix on every id and key the seed creates.
///
/// Deliberately obvious in a database browser: seeded rows are demo data, and
/// whoever finds them later should not have to ask.
pub const SEED_PREFIX: &str = "cb-demo";

/// One course the demo day is played on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedCourse {
    pub key: &'static str,
    pub name: &'static str,
    pub short_name: &'static str,
    pub open_time: &'static str,
    pub close_time: &'static str,
    /// Minutes between starts. Different per course on purpose: a board where
    /// every column ticks the same way hides the fact that they need not.
    pub start_interval_minutes: i32,
}

/// One group on the demo day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedGroup {
    pub course_key: &'static str,
    /// Local wall clock `HH:MM`.
    pub tee_time: &'static str,
    pub party_size: i32,
    pub customer_name: &'static str,
    pub competition: Option<&'static str>,
    pub organizer: Option<&'static str>,
    pub group_number: Option<i32>,
    /// `(name, rate class)`. Fewer names than `party_size` on some groups, on
    /// purpose: a desk's real board is half-filled, and the ledger has to show
    /// the empty seats.
    pub players: &'static [(&'static str, &'static str)],
}

impl SeedGroup {
    /// The key that identifies this group's booking across re-runs.
    pub fn seed_key(&self) -> String {
        format!("{SEED_PREFIX}:{}:{}", self.course_key, self.tee_time)
    }

    pub fn party(&self) -> Result<PartyDetails, CourseError> {
        let players = self
            .players
            .iter()
            .map(|(name, tag)| {
                PartyPlayer::try_new(
                    *name,
                    Some((*tag).to_string()).filter(|value| !value.is_empty()),
                    None,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        PartyDetails::try_new(
            self.competition.map(str::to_string),
            self.organizer.map(str::to_string),
            self.group_number,
            players,
        )
    }
}

/// One desk mark on the demo day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedMark {
    pub course_key: &'static str,
    pub tee_time: &'static str,
    pub kind: SlotOverrideKind,
    pub label: &'static str,
}

/// The whole demo day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DemoBoard {
    pub courses: &'static [SeedCourse],
    pub groups: &'static [SeedGroup],
    pub marks: &'static [SeedMark],
}

/// Courses named the way a real club's board reads, and ordered the way groups
/// go out — which is the order the seed also stores, so the demo shows why the
/// arrangement is not alphabetical.
const COURSES: &[SeedCourse] = &[
    SeedCourse {
        key: "karanuma-in",
        name: "空沼IN",
        short_name: "空沼IN",
        open_time: "06:53",
        close_time: "14:30",
        start_interval_minutes: 7,
    },
    SeedCourse {
        key: "moiwa-out",
        name: "藻岩OUT",
        short_name: "藻岩OUT",
        open_time: "06:53",
        close_time: "14:30",
        start_interval_minutes: 7,
    },
    SeedCourse {
        key: "moiwa-in",
        name: "藻岩IN",
        short_name: "藻岩IN",
        open_time: "07:21",
        close_time: "14:30",
        start_interval_minutes: 7,
    },
];

const GROUPS: &[SeedGroup] = &[
    SeedGroup {
        course_key: "karanuma-in",
        tee_time: "06:53",
        party_size: 4,
        customer_name: "本田 康彦",
        competition: Some("本田会"),
        organizer: Some("辻 俊行"),
        group_number: Some(1),
        players: &[
            ("増田 公陽", "共通"),
            ("木澤 岳志", "共通"),
            ("谷川 南海", "共通"),
            ("辻 俊行", "優待"),
        ],
    },
    SeedGroup {
        course_key: "karanuma-in",
        tee_time: "07:00",
        party_size: 4,
        customer_name: "中川 伸一",
        competition: Some("本田会"),
        organizer: None,
        group_number: Some(2),
        players: &[
            ("中川 伸一", "共通"),
            ("泉 和利", "共通"),
            ("青山 利夫", "優待"),
            ("西本 厚", "優待"),
        ],
    },
    SeedGroup {
        course_key: "karanuma-in",
        tee_time: "07:07",
        party_size: 4,
        customer_name: "菊地 豊",
        competition: Some("本田会"),
        organizer: None,
        group_number: Some(3),
        // Two names on a four-ball: the desk has work left to do here, and the
        // ledger has to make that visible rather than draw a full group.
        players: &[("菊地 豊", "共通"), ("新村 仁", "共通")],
    },
    SeedGroup {
        course_key: "karanuma-in",
        tee_time: "07:28",
        party_size: 4,
        customer_name: "中野 誠",
        competition: None,
        organizer: None,
        group_number: None,
        players: &[
            ("田中 真樹", "基幹"),
            ("上田 盛弘", "基幹"),
            ("平芋 守昭", "基幹"),
            ("神田 亮一", "基幹"),
        ],
    },
    SeedGroup {
        course_key: "karanuma-in",
        tee_time: "08:03",
        party_size: 4,
        customer_name: "藤原 秀光",
        competition: None,
        organizer: None,
        group_number: None,
        players: &[
            ("藤原 秀光", "共通"),
            ("赤井 滋", "共通"),
            ("宮田 力", "優待"),
            ("斎藤 賢", "優待"),
        ],
    },
    SeedGroup {
        course_key: "moiwa-out",
        tee_time: "07:21",
        party_size: 4,
        customer_name: "大野 修",
        competition: Some("藻岩会"),
        organizer: Some("清水 誠"),
        group_number: Some(1),
        players: &[("大野 修", "共S"), ("白川 誠", "共S"), ("相澤 猛", "共S")],
    },
    SeedGroup {
        course_key: "moiwa-out",
        tee_time: "07:28",
        party_size: 4,
        customer_name: "高橋 純一",
        competition: Some("藻岩会"),
        organizer: None,
        group_number: Some(2),
        players: &[
            ("高橋 純一", "共S"),
            ("片平 順一", "共S"),
            ("菊原 茂", "共S"),
        ],
    },
    SeedGroup {
        course_key: "moiwa-out",
        tee_time: "07:35",
        party_size: 4,
        customer_name: "石井 輝雄",
        competition: Some("藻岩会"),
        organizer: None,
        group_number: Some(3),
        players: &[
            ("石井 輝雄", "共S"),
            ("佐野 浩一", "共S"),
            ("藤澤 常一", "共S"),
            ("高橋 一郎", "共S"),
        ],
    },
    SeedGroup {
        course_key: "moiwa-out",
        tee_time: "08:24",
        party_size: 4,
        customer_name: "塚田 正意",
        competition: None,
        organizer: None,
        group_number: None,
        players: &[("塚田 正意", "同S"), ("栗川 初美", "同S")],
    },
    SeedGroup {
        course_key: "moiwa-in",
        tee_time: "07:21",
        party_size: 4,
        customer_name: "藤原 和彦",
        competition: Some("藻岩会"),
        organizer: Some("清水 誠"),
        group_number: Some(6),
        players: &[
            ("藤原 和彦", "共S"),
            ("川村 昭彦", "共S"),
            ("清水 由美", "共S"),
        ],
    },
    SeedGroup {
        course_key: "moiwa-in",
        tee_time: "07:28",
        party_size: 4,
        customer_name: "奈良 良",
        competition: Some("藻岩会"),
        organizer: None,
        group_number: Some(7),
        players: &[
            ("奈良 良", "共S"),
            ("阪田 章太", "共S"),
            ("加藤 哲朗", "共S"),
            ("中里 勝則", "共S"),
        ],
    },
    SeedGroup {
        course_key: "moiwa-in",
        tee_time: "08:10",
        party_size: 4,
        customer_name: "原田 明昌",
        competition: None,
        organizer: None,
        group_number: None,
        // Nobody named yet: a booking that arrived through the web and has not
        // been worked on. The ledger shows four empty seats.
        players: &[],
    },
];

const MARKS: &[SeedMark] = &[
    SeedMark {
        course_key: "karanuma-in",
        tee_time: "07:14",
        kind: SlotOverrideKind::SpecialRate,
        label: "特別料金",
    },
    SeedMark {
        course_key: "karanuma-in",
        tee_time: "07:21",
        kind: SlotOverrideKind::SpecialRate,
        label: "特別料金",
    },
    SeedMark {
        course_key: "karanuma-in",
        tee_time: "07:35",
        kind: SlotOverrideKind::Closed,
        label: "売り止め",
    },
    SeedMark {
        course_key: "moiwa-out",
        tee_time: "07:56",
        kind: SlotOverrideKind::Closed,
        label: "コース整備",
    },
];

pub fn demo_board() -> DemoBoard {
    DemoBoard {
        courses: COURSES,
        groups: GROUPS,
        marks: MARKS,
    }
}

/// How long a demo round takes. Long enough that the timeline beside the ledger
/// shows overlapping groups, which is what makes that board worth looking at.
pub const SEED_DURATION_MINUTES: i64 = 270;

/// `HH:MM` on `date`, as the wall clock the ledger draws.
pub fn seed_tee_time(date: NaiveDate, tee_time: &str) -> Result<String, CourseError> {
    if tee_time.len() != 5 || tee_time.as_bytes()[2] != b':' {
        return Err(CourseError::BadRequest(
            "seed tee times must look like HH:MM",
        ));
    }
    Ok(format!("{date}T{tee_time}:00+09:00"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_group_names_a_course_the_seed_creates() {
        // A group pointing at a course that is never created would land in the
        // ledger's "no course" column, which is not what a demo should show.
        let board = demo_board();
        for group in board.groups {
            assert!(
                board
                    .courses
                    .iter()
                    .any(|course| course.key == group.course_key),
                "{} names an unknown course",
                group.tee_time
            );
        }
    }

    #[test]
    fn every_mark_names_a_course_the_seed_creates() {
        let board = demo_board();
        for mark in board.marks {
            assert!(
                board
                    .courses
                    .iter()
                    .any(|course| course.key == mark.course_key),
                "{} names an unknown course",
                mark.tee_time
            );
        }
    }

    #[test]
    fn no_two_groups_share_a_key_so_a_re_run_updates_rather_than_duplicates() {
        let board = demo_board();
        let mut keys: Vec<String> = board.groups.iter().map(SeedGroup::seed_key).collect();
        keys.sort();
        let count = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), count, "two groups would collide on one booking");
    }

    #[test]
    fn a_marked_tee_time_is_never_also_a_booked_one() {
        // Closing a tee time the seed also books would draw a board that
        // contradicts itself.
        let board = demo_board();
        for mark in board.marks {
            assert!(
                !board
                    .groups
                    .iter()
                    .any(|group| group.course_key == mark.course_key
                        && group.tee_time == mark.tee_time),
                "{} is both marked and booked",
                mark.tee_time
            );
        }
    }

    #[test]
    fn every_tee_time_falls_inside_its_courses_opening_hours() {
        // Outside them the ledger has no row to put the group on, and it would
        // appear as an off-grid row the demo never meant to show.
        let board = demo_board();
        for group in board.groups {
            let course = board
                .courses
                .iter()
                .find(|course| course.key == group.course_key)
                .expect("known course");
            assert!(
                group.tee_time >= course.open_time && group.tee_time < course.close_time,
                "{} is outside {}'s hours",
                group.tee_time,
                course.name
            );
        }
    }

    #[test]
    fn every_tee_time_lands_on_its_courses_interval() {
        // A start between two ticks would show up as an extra row, which reads
        // as a booking the desk moved by hand rather than as the tidy demo day
        // this is meant to be.
        fn minutes(clock: &str) -> i32 {
            clock[..2].parse::<i32>().unwrap() * 60 + clock[3..].parse::<i32>().unwrap()
        }
        let board = demo_board();
        for group in board.groups {
            let course = board
                .courses
                .iter()
                .find(|course| course.key == group.course_key)
                .expect("known course");
            let offset = minutes(group.tee_time) - minutes(course.open_time);
            assert_eq!(
                offset % course.start_interval_minutes,
                0,
                "{} is off {}'s {}-minute grid",
                group.tee_time,
                course.name,
                course.start_interval_minutes
            );
        }
    }

    #[test]
    fn a_group_with_no_names_still_builds_an_empty_party() {
        let group = demo_board()
            .groups
            .iter()
            .find(|group| group.players.is_empty())
            .expect("a booking nobody has worked on");
        assert!(group.party().unwrap().is_empty());
    }

    #[test]
    fn group_detail_survives_being_turned_into_a_party() {
        let group = demo_board()
            .groups
            .iter()
            .find(|group| group.competition == Some("本田会") && group.group_number == Some(1))
            .expect("the first competition group");
        let party = group.party().unwrap();
        assert_eq!(party.competition_name(), Some("本田会"));
        assert_eq!(party.organizer(), Some("辻 俊行"));
        assert_eq!(party.group_number(), Some(1));
        assert_eq!(party.players()[0].name(), "増田 公陽");
        assert_eq!(party.players()[0].tag(), Some("共通"));
    }

    #[test]
    fn a_tee_time_is_stamped_onto_the_day_in_the_courses_own_clock() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        assert_eq!(
            seed_tee_time(date, "06:53").unwrap(),
            "2026-07-20T06:53:00+09:00"
        );
        assert!(seed_tee_time(date, "6:53").is_err());
    }
}
