//! What is inside one group on the tee ledger: the competition it belongs to,
//! its number in that competition, and the players by name.
//!
//! Field's reservation carries a customer name and a quantity — one name and a
//! headcount. A start desk works the other way round: it calls four people by
//! name, and the group number is how the competition's organizer refers to
//! them. Neither of those can be recovered from `customerName` + `quantity`, so
//! the detail lives here and is stored in the reservation's custom fields.

use derive_getters::Getters;

use super::CourseError;

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
}

impl PartyPlayer {
    pub fn try_new(
        name: impl Into<String>,
        tag: Option<String>,
        member_number: Option<String>,
    ) -> Result<Self, CourseError> {
        let name = normalize_required(name.into(), "player name")?;
        Ok(Self {
            name,
            tag: normalize_optional(tag)?,
            member_number: normalize_optional(member_number)?,
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
        })
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
    }

    /// Named players, which is not the same as the booked party size.
    ///
    /// A group booked for four with two names entered is still a four-ball; the
    /// ledger shows the gap rather than silently shrinking the booking.
    pub fn named_player_count(&self) -> i32 {
        self.players.len() as i32
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
        PartyPlayer::try_new(name, None, None).unwrap()
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
        assert!(PartyPlayer::try_new("  ", None, None).is_err());
    }

    #[test]
    fn player_tags_survive_unknown_values_because_every_course_invents_its_own() {
        let player = PartyPlayer::try_new("増田 公陽", Some(" 共通 ".into()), None).unwrap();
        assert_eq!(player.tag(), Some("共通"));
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
    fn naming_fewer_players_than_the_booking_does_not_shrink_the_booking() {
        // Two names on a four-ball: the ledger has to show the two empty seats,
        // so the count of names must stay separate from the party size.
        let details =
            PartyDetails::try_new(None, None, None, vec![player("a"), player("b")]).unwrap();
        assert_eq!(details.named_player_count(), 2);
        assert!(!details.is_empty());
    }
}
