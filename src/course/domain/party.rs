//! What is inside one group on the tee ledger: the competition it belongs to,
//! its number in that competition, and the players by name.
//!
//! Field's reservation carries a customer name and a quantity — one name and a
//! headcount. A start desk works the other way round: it calls four people by
//! name, and the group number is how the competition's organizer refers to
//! them. Neither of those can be recovered from `customerName` + `quantity`, so
//! the detail lives here and is stored in the reservation's custom fields.

use derive_getters::Getters;

use super::{CourseError, CustomerId};

/// The key CourseBoard owns inside a reservation's custom fields.
///
/// Namespaced because the object is shared: `golfCourseId` already lives beside
/// it, and a write that replaced the whole object would drop it.
pub const PARTY_CUSTOM_FIELD_KEY: &str = "golfParty";

/// Groups larger than this are a typo, not a booking.
///
/// Four is the normal maximum and what the ledger draws; the ceiling is higher
/// so a course that runs the occasional five- or six-ball is not blocked by a
/// number this module invented.
pub const MAX_PARTY_PLAYERS: usize = 8;

const MAX_TEXT_LENGTH: usize = 120;

/// One named player in a group.
#[derive(Debug, Clone, PartialEq, Eq, Getters)]
pub struct PartyPlayer {
    #[getter(skip)]
    name: String,
    /// The booking channel or rate class the desk writes above the name
    /// (`共通`, `優待`, `WEBS`, …). Free text: every course keeps its own set,
    /// and an enum here would reject the next one they invent.
    #[getter(skip)]
    tag: Option<String>,
    #[getter(skip)]
    member_number: Option<String>,
    /// Who this player is in the customer ledger, once the desk has said so.
    ///
    /// Optional on purpose. A booking taken by phone often has four names and
    /// no identities behind them, and requiring the link would stop the desk
    /// from writing the booking down at all. An unlinked player is a player
    /// whose ledger entry has not been decided yet, not an error.
    #[getter(skip)]
    customer_id: Option<CustomerId>,
}

impl PartyPlayer {
    pub fn try_new(
        name: impl Into<String>,
        tag: Option<String>,
        member_number: Option<String>,
        customer_id: Option<CustomerId>,
    ) -> Result<Self, CourseError> {
        let name = normalize_required(name.into(), "player name")?;
        Ok(Self {
            name,
            tag: normalize_optional(tag)?,
            member_number: normalize_optional(member_number)?,
            customer_id,
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn tag(&self) -> Option<&str> {
        self.tag.as_deref()
    }

    pub fn member_number(&self) -> Option<&str> {
        self.member_number.as_deref()
    }

    pub fn customer_id(&self) -> Option<&CustomerId> {
        self.customer_id.as_ref()
    }

    /// Whether this player has been identified in the ledger.
    pub fn is_linked(&self) -> bool {
        self.customer_id.is_some()
    }
}

/// The ledger-facing detail of one group.
///
/// Every field is optional: a walk-in single has no competition and no group
/// number, and a booking taken by phone may have no names yet. An empty
/// `PartyDetails` is the normal state of a reservation nobody has worked on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Getters)]
pub struct PartyDetails {
    #[getter(skip)]
    competition_name: Option<String>,
    /// Who the competition's desk contact is (`M:辻 俊行` on the paper ledger).
    #[getter(skip)]
    organizer: Option<String>,
    /// The group's number within its competition, as the organizer counts them.
    ///
    /// Not a position on the sheet: two competitions both start at 1, and the
    /// same group keeps its number when the desk moves it to another tee time.
    #[getter(skip)]
    group_number: Option<i32>,
    #[getter(skip)]
    players: Vec<PartyPlayer>,
    #[getter(skip)]
    remarks: PartyRemarks,
}

/// How a group pays at the end of the round (`【精算】` on the paper ledger).
///
/// An enum rather than text because checkout reads it: a desk that has to
/// interpret `個人` / `個別` / `各自` by eye is the mistake this field exists to
/// stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartySettlement {
    /// Every player settles their own bill.
    Individual,
    /// One person (usually the organizer) settles for the whole group.
    Together,
}

impl PartySettlement {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Individual => "individual",
            Self::Together => "together",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "individual" => Some(Self::Individual),
            "together" => Some(Self::Together),
            _ => None,
        }
    }

    /// The words a paper ledger uses after `【精算】`.
    fn from_ledger_word(value: &str) -> Option<Self> {
        match value.trim() {
            "個人" | "個別" | "各自" => Some(Self::Individual),
            "一括" | "まとめ" | "まとめて" | "代表" | "代表者" | "組" | "幹事" => {
                Some(Self::Together)
            }
            _ => None,
        }
    }
}

/// The desk instructions a booking carries besides who is playing: the
/// `【食】各自注文 / 【集計】有 / 【精算】個人` lines of a start ledger.
///
/// Kept as separate fields rather than one note because each one is read by a
/// different part of the day: the restaurant reads the meal, the competition
/// desk reads whether scores are tallied, checkout reads the settlement.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PartyRemarks {
    /// What the group does about lunch (`各自注文`, `弁当4`, …). Free text:
    /// every course and every restaurant phrases it its own way.
    meal: Option<String>,
    /// Whether the competition's scores are tallied by the course.
    score_tally: Option<bool>,
    settlement: Option<PartySettlement>,
}

impl PartyRemarks {
    pub fn try_new(
        meal: Option<String>,
        score_tally: Option<bool>,
        settlement: Option<PartySettlement>,
    ) -> Result<Self, CourseError> {
        Ok(Self {
            meal: normalize_optional(meal)?,
            score_tally,
            settlement,
        })
    }

    pub fn meal(&self) -> Option<&str> {
        self.meal.as_deref()
    }

    pub fn score_tally(&self) -> Option<bool> {
        self.score_tally
    }

    pub fn settlement(&self) -> Option<PartySettlement> {
        self.settlement
    }

    pub fn is_empty(&self) -> bool {
        self.meal.is_none() && self.score_tally.is_none() && self.settlement.is_none()
    }

    /// Read the `【食】… 【集計】… 【精算】…` lines a start ledger prints under a
    /// group.
    ///
    /// Returns the lines it could not place, so whoever imports a sheet can put
    /// them in the booking's notes instead of losing them: an unknown
    /// `【精算】カード` is still an instruction somebody wrote down.
    pub fn from_ledger_lines<'a>(lines: impl IntoIterator<Item = &'a str>) -> (Self, Vec<String>) {
        let mut remarks = Self::default();
        let mut leftovers = Vec::new();
        for line in lines {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let placed = split_bracketed(line).is_some_and(|(label, value)| match label {
                "食" | "食事" if !value.is_empty() && remarks.meal.is_none() => {
                    match normalize_optional(Some(value.to_string())) {
                        Ok(meal) => {
                            remarks.meal = meal;
                            true
                        }
                        Err(_) => false,
                    }
                }
                "集計" if remarks.score_tally.is_none() => match value {
                    "有" | "あり" | "有り" => {
                        remarks.score_tally = Some(true);
                        true
                    }
                    "無" | "なし" | "無し" => {
                        remarks.score_tally = Some(false);
                        true
                    }
                    _ => false,
                },
                "精算" if remarks.settlement.is_none() => {
                    match PartySettlement::from_ledger_word(value) {
                        Some(settlement) => {
                            remarks.settlement = Some(settlement);
                            true
                        }
                        None => false,
                    }
                }
                _ => false,
            });
            if !placed {
                leftovers.push(line.to_string());
            }
        }
        (remarks, leftovers)
    }
}

/// `【食】各自注文` → `("食", "各自注文")`.
fn split_bracketed(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix('【')?;
    let (label, value) = rest.split_once('】')?;
    Some((label.trim(), value.trim()))
}

impl PartyDetails {
    pub fn try_new(
        competition_name: Option<String>,
        organizer: Option<String>,
        group_number: Option<i32>,
        players: Vec<PartyPlayer>,
    ) -> Result<Self, CourseError> {
        if players.len() > MAX_PARTY_PLAYERS {
            return Err(CourseError::BadRequest(
                "a group may not hold more than 8 players",
            ));
        }
        if group_number.is_some_and(|value| value <= 0) {
            return Err(CourseError::BadRequest("group number must be positive"));
        }
        Ok(Self {
            competition_name: normalize_optional(competition_name)?,
            organizer: normalize_optional(organizer)?,
            group_number,
            players,
            remarks: PartyRemarks::default(),
        })
    }

    pub fn with_remarks(mut self, remarks: PartyRemarks) -> Self {
        self.remarks = remarks;
        self
    }

    pub fn remarks(&self) -> &PartyRemarks {
        &self.remarks
    }

    pub fn competition_name(&self) -> Option<&str> {
        self.competition_name.as_deref()
    }

    pub fn organizer(&self) -> Option<&str> {
        self.organizer.as_deref()
    }

    pub fn group_number(&self) -> Option<i32> {
        self.group_number
    }

    pub fn players(&self) -> &[PartyPlayer] {
        &self.players
    }

    /// Nothing has been entered, so the ledger should fall back to the
    /// reservation's own customer name rather than draw an empty cell.
    pub fn is_empty(&self) -> bool {
        self.competition_name.is_none()
            && self.organizer.is_none()
            && self.group_number.is_none()
            && self.players.is_empty()
            && self.remarks.is_empty()
    }

    /// Named players, which is not the same as the booked party size.
    ///
    /// A group booked for four with two names entered is still a four-ball; the
    /// ledger shows the gap rather than silently shrinking the booking.
    pub fn named_player_count(&self) -> i32 {
        self.players.len() as i32
    }

    /// Players already identified in the customer ledger.
    ///
    /// Reported separately from the headcount so the desk can see how much of
    /// the group is still anonymous rather than assuming a named group is a
    /// recorded one.
    pub fn linked_player_count(&self) -> i32 {
        self.players
            .iter()
            .filter(|player| player.is_linked())
            .count() as i32
    }
}

fn normalize_required(value: String, label: &'static str) -> Result<String, CourseError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(match label {
            "player name" => CourseError::BadRequest("player name must not be empty"),
            _ => CourseError::BadRequest("value must not be empty"),
        });
    }
    if trimmed.chars().count() > MAX_TEXT_LENGTH {
        return Err(CourseError::BadRequest(
            "text must be at most 120 characters",
        ));
    }
    Ok(trimmed.to_string())
}

/// Blank and absent mean the same thing here, so both become `None`.
///
/// The editor sends empty strings for fields the operator cleared; keeping them
/// would write `""` into the reservation and make `is_empty` answer false for a
/// group nobody has touched.
fn normalize_optional(value: Option<String>) -> Result<Option<String>, CourseError> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > MAX_TEXT_LENGTH {
        return Err(CourseError::BadRequest(
            "text must be at most 120 characters",
        ));
    }
    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(name: &str) -> PartyPlayer {
        PartyPlayer::try_new(name, None, None, None).unwrap()
    }

    #[test]
    fn a_group_nobody_has_worked_on_reads_as_empty() {
        let details = PartyDetails::default();
        assert!(details.is_empty());
        assert_eq!(details.named_player_count(), 0);
    }

    #[test]
    fn blank_text_is_stored_as_absent_so_a_cleared_field_does_not_look_filled_in() {
        let details =
            PartyDetails::try_new(Some("   ".into()), Some(String::new()), None, Vec::new())
                .unwrap();
        assert_eq!(details.competition_name(), None);
        assert_eq!(details.organizer(), None);
        assert!(details.is_empty());
    }

    #[test]
    fn a_player_must_actually_be_named() {
        assert!(PartyPlayer::try_new("  ", None, None, None).is_err());
    }

    #[test]
    fn player_tags_survive_unknown_values_because_every_course_invents_its_own() {
        let player = PartyPlayer::try_new("増田 公陽", Some(" 共通 ".into()), None, None).unwrap();
        assert_eq!(player.tag(), Some("共通"));
    }

    #[test]
    fn a_player_taken_by_phone_is_recorded_without_a_ledger_identity() {
        // The desk has a name and nothing else. That still has to save.
        let player = PartyPlayer::try_new("増田 公陽", None, None, None).unwrap();
        assert!(!player.is_linked());
        assert_eq!(player.customer_id(), None);
    }

    #[test]
    fn the_desk_can_see_how_much_of_a_group_is_still_anonymous() {
        let linked =
            PartyPlayer::try_new("本田 康彦", None, None, Some(CustomerId::new("cus_1"))).unwrap();
        let details =
            PartyDetails::try_new(None, None, None, vec![linked, player("同伴者")]).unwrap();
        assert_eq!(details.named_player_count(), 2);
        assert_eq!(details.linked_player_count(), 1);
    }

    #[test]
    fn a_group_number_counts_from_one_because_zero_is_never_a_group() {
        assert!(PartyDetails::try_new(None, None, Some(0), Vec::new()).is_err());
        assert!(PartyDetails::try_new(None, None, Some(-1), Vec::new()).is_err());
        assert!(PartyDetails::try_new(None, None, Some(1), Vec::new()).is_ok());
    }

    #[test]
    fn a_group_larger_than_the_ceiling_is_a_typo_rather_than_a_booking() {
        let players: Vec<PartyPlayer> = (0..MAX_PARTY_PLAYERS + 1)
            .map(|index| player(&format!("player {index}")))
            .collect();
        assert!(PartyDetails::try_new(None, None, None, players).is_err());
    }

    #[test]
    fn a_start_ledger_footer_splits_into_the_fields_each_desk_reads() {
        let (remarks, leftovers) =
            PartyRemarks::from_ledger_lines(["【食】各自注文", "【集計】有", "【精算】個人"]);
        assert_eq!(remarks.meal(), Some("各自注文"));
        assert_eq!(remarks.score_tally(), Some(true));
        assert_eq!(remarks.settlement(), Some(PartySettlement::Individual));
        assert!(leftovers.is_empty());
    }

    #[test]
    fn a_remark_the_ledger_does_not_know_is_handed_back_instead_of_dropped() {
        let (remarks, leftovers) =
            PartyRemarks::from_ledger_lines(["【精算】カード", "早めに到着", "【集計】無"]);
        assert_eq!(remarks.settlement(), None);
        assert_eq!(remarks.score_tally(), Some(false));
        assert_eq!(leftovers, vec!["【精算】カード", "早めに到着"]);
    }

    #[test]
    fn a_group_with_only_remarks_is_not_an_empty_group() {
        let remarks = PartyRemarks::try_new(None, None, Some(PartySettlement::Together)).unwrap();
        let details = PartyDetails::default().with_remarks(remarks);
        assert!(!details.is_empty());
    }

    #[test]
    fn settlement_round_trips_through_its_wire_name() {
        for value in [PartySettlement::Individual, PartySettlement::Together] {
            assert_eq!(PartySettlement::parse(value.as_str()), Some(value));
        }
        assert_eq!(PartySettlement::parse("個人"), None);
    }

    #[test]
    fn naming_fewer_players_than_the_booking_does_not_shrink_the_booking() {
        // Two names on a four-ball: the ledger has to show the two empty seats,
        // so the count of names must stay separate from the party size.
        let details =
            PartyDetails::try_new(None, None, None, vec![player("a"), player("b")]).unwrap();
        assert_eq!(details.named_player_count(), 2);
        assert!(!details.is_empty());
    }
}
