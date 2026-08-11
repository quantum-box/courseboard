//! Groups booked on one course for one half of one day.
//!
//! This is the whole of what the club's booking system will export (PLT-3247):
//! a count per course per half-day, with no start times and no per-booking
//! caddie flag. It deliberately does not ride on Field's tee-time inventory —
//! there is no slot-level fact here to consume one with — so it is CourseBoard's
//! own series, kept beside the inventory rather than inside it (ADR-0005).

use chrono::NaiveDate;
use derive_getters::Getters;

use super::{Course, CourseError, CourseId};

/// Which half of the playing day a count covers.
///
/// Two values because the sheet has two columns. A course that wanted an
/// evening bucket would have to get the booking system to report one first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TimeOfDay {
    Morning,
    Afternoon,
}

impl TimeOfDay {
    pub const ALL: [Self; 2] = [Self::Morning, Self::Afternoon];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Morning => "am",
            Self::Afternoon => "pm",
        }
    }

    pub fn parse(raw: &str) -> Result<Self, CourseError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "am" | "morning" => Ok(Self::Morning),
            "pm" | "afternoon" => Ok(Self::Afternoon),
            _ => Err(CourseError::BadRequest("time of day must be 'am' or 'pm'")),
        }
    }
}

/// One course's booked groups for one half of one day.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct ReservationDaySummary {
    #[getter(skip)]
    course_id: CourseId,
    #[getter(copy)]
    date: NaiveDate,
    #[getter(copy)]
    time_of_day: TimeOfDay,
    /// Groups booked, caddie-attached or not.
    #[getter(copy)]
    total_groups: i32,
    /// How many of `total_groups` asked for a caddie. A subset, never a
    /// separate population — this is the number a day's caddie demand is read
    /// from.
    #[getter(copy)]
    caddie_groups: i32,
}

impl ReservationDaySummary {
    pub fn try_new(
        course_id: CourseId,
        date: NaiveDate,
        time_of_day: TimeOfDay,
        total_groups: i32,
        caddie_groups: i32,
    ) -> Result<Self, CourseError> {
        if total_groups < 0 || caddie_groups < 0 {
            return Err(CourseError::BadRequest("group counts cannot be negative"));
        }
        Ok(Self {
            course_id,
            date,
            time_of_day,
            total_groups,
            caddie_groups,
        })
    }

    /// Rebuild from storage, which already holds validated counts.
    pub fn reconstitute(
        course_id: CourseId,
        date: NaiveDate,
        time_of_day: TimeOfDay,
        total_groups: i32,
        caddie_groups: i32,
    ) -> Self {
        Self {
            course_id,
            date,
            time_of_day,
            total_groups,
            caddie_groups,
        }
    }

    pub fn course_id(&self) -> &CourseId {
        &self.course_id
    }

    /// Groups going out without a caddie.
    ///
    /// Saturates at zero rather than going negative: a file that reports more
    /// caddie-attached groups than groups is wrong, and the desk is told so by
    /// a warning on the import — not by a self-play count that reads as minus
    /// three rounds everywhere downstream.
    pub fn self_play_groups(&self) -> i32 {
        (self.total_groups - self.caddie_groups).max(0)
    }
}

/// Which days to read back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationSummaryQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Empty means every course, so a screen showing the whole club does not
    /// have to name its courses.
    pub course_ids: Vec<CourseId>,
}

/// The stretch of the calendar one import speaks for.
///
/// An import is not "add these counts", it is "for these courses, these dates
/// are now exactly this". The difference shows the day a file arrives with a
/// half-day missing — a count that will not read, a course renamed out of the
/// match — where merely writing what is present leaves the previous export's
/// number sitting on that half-day, and the board becomes a mix of two files
/// with nothing on screen saying which is which.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationSummaryWindow {
    pub from: NaiveDate,
    pub to: NaiveDate,
    /// Only the courses the file actually spoke about and that were matched.
    /// A course the import could not resolve keeps whatever it already had:
    /// a rename in the course master should not erase a month of bookings.
    pub course_ids: Vec<CourseId>,
}

/// The desk's standing answer for one name in the export.
///
/// Stored because the question is asked every month and the answer does not
/// change: a club whose courses are named differently from the booking
/// system's would otherwise re-map them on every import, and a club that
/// manages one of its three courses here would be re-told about the other two
/// forever.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationCourseLink {
    /// The name as the sheet writes it.
    pub sheet_label: String,
    /// `None` means "do not import this one". A decision, not a gap — which is
    /// why it is stored rather than inferred from the absence of a row.
    pub course_id: Option<CourseId>,
}

/// What one name in the export resolved to, and how.
///
/// How matters: a course the desk chose is settled, while one the matcher
/// guessed is a suggestion the desk may want to look at. Both import; only the
/// second is worth showing prominently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CourseResolution<'a> {
    /// The desk said so. Beats anything the matcher would have guessed.
    Linked(&'a Course),
    /// Matched by name. Imports, and the preview says it was a guess so a wrong
    /// one can be corrected before it is applied.
    Suggested(&'a Course),
    /// The desk said not to import this one.
    Ignored,
    /// Nothing matched and nobody has said what it is.
    Unresolved,
    /// Several courses fit the name, so choosing one would be a guess. The
    /// names come back so the desk can pick.
    Ambiguous(Vec<String>),
}

impl<'a> CourseResolution<'a> {
    /// The course this name's counts should be written against, if any.
    pub fn course(&self) -> Option<&'a Course> {
        match self {
            Self::Linked(course) | Self::Suggested(course) => Some(course),
            _ => None,
        }
    }

    /// Whether the desk still has to answer something for this name.
    ///
    /// A suggestion does not count: it imports, and the preview shows what it
    /// picked. Only a name with nowhere to go is an open question.
    pub fn needs_an_answer(&self) -> bool {
        matches!(self, Self::Unresolved | Self::Ambiguous(_))
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Linked(_) => "linked",
            Self::Suggested(_) => "suggested",
            Self::Ignored => "ignored",
            Self::Unresolved => "unresolved",
            Self::Ambiguous(_) => "ambiguous",
        }
    }
}

/// Decide what one name in the export refers to.
///
/// The desk's saved answer wins over the matcher, always. Guessing is what the
/// matcher is for, and a stored decision is not a guess — including the
/// decision to leave a course out, which no amount of name similarity should
/// override.
pub fn resolve_course_label<'a>(
    label: &str,
    courses: &'a [Course],
    links: &[ReservationCourseLink],
) -> CourseResolution<'a> {
    // An answer written exactly as the sheet writes it wins over one that only
    // matches after normalizing. They should never both exist — saving removes
    // the collision — but if one ever did, the newer spelling is the one the
    // desk was looking at.
    let wanted = normalize_course_label(label);
    let saved = links
        .iter()
        .find(|link| link.sheet_label == label)
        .or_else(|| {
            links
                .iter()
                .find(|link| normalize_course_label(&link.sheet_label) == wanted)
        });
    if let Some(link) = saved {
        let Some(course_id) = link.course_id.as_ref() else {
            return CourseResolution::Ignored;
        };
        // A link pointing at a course that has since been deleted falls back to
        // the matcher rather than silently dropping the course: the desk's
        // answer is stale, not wrong on purpose.
        if let Some(course) = courses.iter().find(|course| course.id() == course_id) {
            return CourseResolution::Linked(course);
        }
    }

    match match_course_label(label, courses) {
        CourseMatch::Matched(course) => CourseResolution::Suggested(course),
        CourseMatch::Unknown => CourseResolution::Unresolved,
        CourseMatch::Ambiguous(candidates) => CourseResolution::Ambiguous(candidates),
    }
}

/// What matching a sheet's course label against the course master produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CourseMatch<'a> {
    Matched(&'a Course),
    /// No course looks like this label.
    Unknown,
    /// Several courses look like this label, so picking one would be a guess.
    /// The names are carried back so the desk is told what to rename.
    Ambiguous(Vec<String>),
}

/// Find the course a sheet label names.
///
/// The file writes courses the way the club says them out loud — `真駒内\n36H`,
/// `羊ケ丘\n18H` — while the course master holds whatever was typed into
/// CourseBoard, which may be `羊ヶ丘` with the other small ke, or carry a
/// `コース` suffix. Matching on the raw string would fail on those and quietly
/// drop a third of the club, so the comparison is done on a normalized form and
/// an inexact hit is allowed only when exactly one course produces it.
pub fn match_course_label<'a>(label: &str, courses: &'a [Course]) -> CourseMatch<'a> {
    let wanted = normalize_course_label(label);
    if wanted.is_empty() {
        return CourseMatch::Unknown;
    }

    let names = |course: &'a Course| -> Vec<String> {
        let mut names = vec![normalize_course_label(course.name())];
        if let Some(short_name) = course.short_name() {
            names.push(normalize_course_label(short_name));
        }
        names
    };

    let exact: Vec<&Course> = courses
        .iter()
        .filter(|course| names(course).contains(&wanted))
        .collect();
    // An exact hit settles it even if some other course also happens to contain
    // the same characters: `滝の` should not become ambiguous because a
    // `滝の東` exists.
    if let [only] = exact.as_slice() {
        return CourseMatch::Matched(only);
    }
    if exact.len() > 1 {
        return CourseMatch::Ambiguous(exact.iter().map(|c| c.name().to_string()).collect());
    }

    let partial: Vec<&Course> = courses
        .iter()
        .filter(|course| {
            names(course)
                .iter()
                .any(|name| !name.is_empty() && (name.contains(&wanted) || wanted.contains(name)))
        })
        .collect();
    match partial.as_slice() {
        [] => CourseMatch::Unknown,
        [only] => CourseMatch::Matched(only),
        several => CourseMatch::Ambiguous(several.iter().map(|c| c.name().to_string()).collect()),
    }
}

/// Reduce a course name to the part two people would agree on.
///
/// Drops the hole count the sheet appends (`真駒内\n36H`), every kind of space,
/// and the small-ke spelling difference that makes `羊ケ丘` and `羊ヶ丘` look
/// like different courses to a computer and like the same one to everybody else.
///
/// Public because the store has to agree with the matcher on when two names are
/// the same one: an answer saved for `東 コース` and another for `東コース` are
/// answers to the same question, and keeping both lets the older one shadow the
/// newer one forever.
pub fn normalize_course_label(value: &str) -> String {
    let head = value.split(['\n', '\r']).next().unwrap_or(value);
    let head = strip_hole_count(head.trim());
    head.chars()
        .filter(|character| !character.is_whitespace())
        .map(|character| match character {
            'ヶ' | 'ヵ' | 'ｹ' => 'ケ',
            other => other.to_ascii_lowercase(),
        })
        .collect()
}

/// Remove a trailing hole count such as `36H`, which describes the course's
/// size rather than naming it.
fn strip_hole_count(value: &str) -> &str {
    let trimmed = value.trim_end();
    let Some(without_h) = trimmed
        .strip_suffix('H')
        .or_else(|| trimmed.strip_suffix('h'))
        .or_else(|| trimmed.strip_suffix('Ｈ'))
    else {
        return trimmed;
    };
    let digits = without_h.trim_end_matches(|c: char| c.is_ascii_digit());
    // Only a real `<digits>H` counts; a course actually called `H` keeps its name.
    if digits.len() == without_h.len() {
        return trimmed;
    }
    digits.trim_end()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn course(name: &str, short_name: Option<&str>) -> Course {
        Course::reconstitute(
            CourseId::new(format!("course-{name}")),
            name,
            short_name.map(str::to_string),
            18,
            "Asia/Tokyo",
            7,
            true,
            None,
            None,
            None,
            None,
        )
    }

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 3).unwrap()
    }

    #[test]
    fn the_sheet_writes_a_course_with_its_hole_count_and_the_master_does_not() {
        let courses = vec![course("真駒内", None)];
        assert!(matches!(
            match_course_label("真駒内\n36H", &courses),
            CourseMatch::Matched(_)
        ));
    }

    #[test]
    fn the_two_spellings_of_the_small_ke_are_the_same_course() {
        // The export says 羊ケ丘; whoever set the course up typed 羊ヶ丘.
        let courses = vec![course("羊ヶ丘", None)];
        assert!(matches!(
            match_course_label("羊ケ丘\n18H", &courses),
            CourseMatch::Matched(_)
        ));
    }

    #[test]
    fn a_course_is_found_by_its_short_name_too() {
        let courses = vec![course("滝の27ホール", Some("滝の"))];
        assert!(matches!(
            match_course_label("滝の\n27H", &courses),
            CourseMatch::Matched(_)
        ));
    }

    #[test]
    fn a_master_name_that_only_adds_a_suffix_still_matches() {
        let courses = vec![course("真駒内コース", None)];
        assert!(matches!(
            match_course_label("真駒内\n36H", &courses),
            CourseMatch::Matched(_)
        ));
    }

    #[test]
    fn an_exact_name_wins_over_a_longer_course_that_merely_contains_it() {
        let courses = vec![course("滝の", None), course("滝の東", None)];
        let CourseMatch::Matched(matched) = match_course_label("滝の\n27H", &courses) else {
            panic!("an exactly-named course should settle the match");
        };
        assert_eq!(matched.name(), "滝の");
    }

    #[test]
    fn two_courses_that_both_look_right_are_reported_rather_than_guessed_between() {
        // Picking one would put a month of another course's bookings on it, and
        // nothing downstream would ever say so.
        let courses = vec![course("東コース", None), course("東コース 旧", None)];
        let CourseMatch::Ambiguous(candidates) = match_course_label("東\n18H", &courses) else {
            panic!("a label matching two courses must not resolve to one");
        };
        assert_eq!(candidates.len(), 2);
    }

    #[test]
    fn a_course_nobody_registered_is_unknown_rather_than_matched_to_the_nearest() {
        let courses = vec![course("真駒内", None)];
        assert_eq!(
            match_course_label("羊ケ丘\n18H", &courses),
            CourseMatch::Unknown
        );
    }

    #[test]
    fn a_course_actually_called_h_keeps_its_name() {
        let courses = vec![course("H", None)];
        assert!(matches!(
            match_course_label("H", &courses),
            CourseMatch::Matched(_)
        ));
    }

    fn link(label: &str, course_id: Option<&str>) -> ReservationCourseLink {
        ReservationCourseLink {
            sheet_label: label.to_string(),
            course_id: course_id.map(CourseId::new),
        }
    }

    #[test]
    fn a_name_nobody_has_answered_for_is_matched_as_a_suggestion() {
        // The club this was built from has courses named the way its export
        // writes them, so the common case still needs no setup at all.
        let courses = vec![course("真駒内", None)];
        assert!(matches!(
            resolve_course_label("真駒内\n36H", &courses, &[]),
            CourseResolution::Suggested(_)
        ));
    }

    #[test]
    fn a_club_whose_courses_are_named_differently_can_say_so_once() {
        // Nothing about `第一コース` looks like `真駒内`, and no amount of
        // normalizing will make it. Without somewhere to say what it is, this
        // club could never import anything.
        let courses = vec![course("第一コース", None)];
        assert_eq!(
            resolve_course_label("真駒内\n36H", &courses, &[]),
            CourseResolution::Unresolved
        );
        let CourseResolution::Linked(linked) = resolve_course_label(
            "真駒内\n36H",
            &courses,
            &[link("真駒内", Some("course-第一コース"))],
        ) else {
            panic!("the desk's answer should settle it");
        };
        assert_eq!(linked.name(), "第一コース");
    }

    #[test]
    fn a_course_the_club_does_not_manage_here_can_be_left_out_on_purpose() {
        // Three courses in the export, one registered: the other two are not a
        // problem to be reported every month, they are a decision.
        let courses = vec![course("真駒内", None)];
        assert_eq!(
            resolve_course_label("滝の\n27H", &courses, &[link("滝の", None)]),
            CourseResolution::Ignored
        );
    }

    #[test]
    fn the_desks_answer_beats_the_matcher_even_when_the_matcher_is_confident() {
        // Otherwise "leave this one out" could never stick on a course whose
        // name happens to match, which is exactly the course somebody would
        // want to leave out — a test course named after a real one.
        let courses = vec![course("真駒内", None)];
        assert_eq!(
            resolve_course_label("真駒内\n36H", &courses, &[link("真駒内", None)]),
            CourseResolution::Ignored
        );
    }

    #[test]
    fn an_answer_pointing_at_a_deleted_course_falls_back_to_matching() {
        // Stale, not deliberate. Dropping the course silently would be the one
        // outcome nobody asked for.
        let courses = vec![course("真駒内", None)];
        assert!(matches!(
            resolve_course_label(
                "真駒内\n36H",
                &courses,
                &[link("真駒内", Some("course-gone"))]
            ),
            CourseResolution::Suggested(_)
        ));
    }

    #[test]
    fn only_a_name_with_nowhere_to_go_is_an_open_question() {
        let courses = vec![course("真駒内", None)];
        assert!(!resolve_course_label("真駒内", &courses, &[]).needs_an_answer());
        assert!(!resolve_course_label("滝の", &courses, &[link("滝の", None)]).needs_an_answer());
        assert!(resolve_course_label("滝の", &courses, &[]).needs_an_answer());
    }

    #[test]
    fn caddie_attached_groups_are_part_of_the_total_not_extra_to_it() {
        let summary = ReservationDaySummary::try_new(
            CourseId::new("course-1"),
            date(),
            TimeOfDay::Morning,
            51,
            24,
        )
        .unwrap();
        assert_eq!(summary.self_play_groups(), 27);
    }

    #[test]
    fn a_file_claiming_more_caddie_groups_than_groups_does_not_produce_negative_self_play() {
        let summary = ReservationDaySummary::try_new(
            CourseId::new("course-1"),
            date(),
            TimeOfDay::Morning,
            10,
            14,
        )
        .unwrap();
        assert_eq!(summary.self_play_groups(), 0);
    }

    #[test]
    fn a_negative_count_is_refused_because_it_can_only_mean_a_misread_file() {
        assert!(ReservationDaySummary::try_new(
            CourseId::new("course-1"),
            date(),
            TimeOfDay::Morning,
            -1,
            0,
        )
        .is_err());
    }

    #[test]
    fn half_days_round_trip_through_their_stored_spelling() {
        for time_of_day in TimeOfDay::ALL {
            assert_eq!(TimeOfDay::parse(time_of_day.as_str()).unwrap(), time_of_day);
        }
        assert!(TimeOfDay::parse("evening").is_err());
    }
}
