//! Reading and writing group detail inside a reservation's custom fields.
//!
//! Field stores `customFieldsJson` as one opaque object shared by everything
//! that wants to hang data off a reservation, and `PATCH /v1/erp/reservations`
//! replaces the whole object. `golfCourseId` already lives there, so a write
//! that sent only the golf group detail would move the booking off its course.
//! Every write here therefore merges into the object as it currently stands.

use serde_json::{json, Map, Value};

use crate::course::domain::{CourseError, PartyDetails, PartyPlayer, PARTY_CUSTOM_FIELD_KEY};

/// Group detail held in `customFieldsJson`, or an empty party when the
/// reservation has none.
///
/// Malformed content reads as empty rather than failing the whole board: the
/// object is shared, anything may have written to it, and one bad row must not
/// black out the operator's day.
pub fn read_party(custom_fields: Option<&Value>) -> PartyDetails {
    let Some(node) = custom_fields
        .and_then(Value::as_object)
        .and_then(|object| object.get(PARTY_CUSTOM_FIELD_KEY))
        .and_then(Value::as_object)
    else {
        return PartyDetails::default();
    };

    let players = node
        .get("players")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter_map(read_player).collect::<Vec<_>>())
        .unwrap_or_default();

    PartyDetails::try_new(
        optional_text(node, "competitionName"),
        optional_text(node, "organizer"),
        node.get("groupNumber")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok())
            .filter(|value| *value > 0),
        players,
    )
    .unwrap_or_default()
}

fn read_player(entry: &Value) -> Option<PartyPlayer> {
    let object = entry.as_object()?;
    let name = object.get("name").and_then(Value::as_str)?;
    PartyPlayer::try_new(
        name,
        optional_text(object, "tag"),
        optional_text(object, "memberNumber"),
    )
    .ok()
}

fn optional_text(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// The custom-fields object with only the golf group detail replaced.
///
/// An empty party removes the key instead of storing an empty object, so a
/// reservation nobody has entered detail for looks the same as one that never
/// had any.
pub fn merge_party(current: Option<&Value>, party: &PartyDetails) -> Value {
    let mut object = current
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    if party.is_empty() {
        object.remove(PARTY_CUSTOM_FIELD_KEY);
    } else {
        object.insert(PARTY_CUSTOM_FIELD_KEY.to_string(), party_to_json(party));
    }
    Value::Object(object)
}

fn party_to_json(party: &PartyDetails) -> Value {
    let mut node = Map::new();
    if let Some(value) = party.competition_name() {
        node.insert("competitionName".into(), json!(value));
    }
    if let Some(value) = party.organizer() {
        node.insert("organizer".into(), json!(value));
    }
    if let Some(value) = party.group_number() {
        node.insert("groupNumber".into(), json!(value));
    }
    if !party.players().is_empty() {
        node.insert(
            "players".into(),
            Value::Array(party.players().iter().map(player_to_json).collect()),
        );
    }
    Value::Object(node)
}

fn player_to_json(player: &PartyPlayer) -> Value {
    let mut node = Map::new();
    node.insert("name".into(), json!(player.name()));
    if let Some(value) = player.tag() {
        node.insert("tag".into(), json!(value));
    }
    if let Some(value) = player.member_number() {
        node.insert("memberNumber".into(), json!(value));
    }
    Value::Object(node)
}

/// Build a party from an untrusted request body.
///
/// Unlike `read_party`, bad input here is the caller's mistake and is refused:
/// silently dropping a player the operator typed would look like the save
/// worked.
pub fn party_from_request(
    competition_name: Option<String>,
    organizer: Option<String>,
    group_number: Option<i32>,
    players: Vec<(String, Option<String>, Option<String>)>,
) -> Result<PartyDetails, CourseError> {
    let players = players
        .into_iter()
        .map(|(name, tag, member_number)| PartyPlayer::try_new(name, tag, member_number))
        .collect::<Result<Vec<_>, _>>()?;
    PartyDetails::try_new(competition_name, organizer, group_number, players)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn party() -> PartyDetails {
        party_from_request(
            Some("本田会".into()),
            Some("辻 俊行".into()),
            Some(1),
            vec![
                ("増田 公陽".into(), Some("共通".into()), None),
                ("木澤 岳志".into(), None, Some("M-0421".into())),
            ],
        )
        .unwrap()
    }

    #[test]
    fn a_reservation_with_no_custom_fields_has_an_empty_party() {
        assert!(read_party(None).is_empty());
        assert!(read_party(Some(&json!({}))).is_empty());
        assert!(read_party(Some(&json!({ "golfCourseId": "course-1" }))).is_empty());
    }

    #[test]
    fn what_was_written_is_what_comes_back() {
        let merged = merge_party(None, &party());
        assert_eq!(read_party(Some(&merged)), party());
    }

    #[test]
    fn writing_group_detail_leaves_the_course_the_booking_sits_on_alone() {
        // customFieldsJson is replaced wholesale by Field's PATCH, and
        // golfCourseId lives in the same object: losing it moves the booking to
        // another course.
        let current = json!({ "golfCourseId": "course-1", "somethingElse": 7 });
        let merged = merge_party(Some(&current), &party());
        assert_eq!(merged["golfCourseId"], json!("course-1"));
        assert_eq!(merged["somethingElse"], json!(7));
    }

    #[test]
    fn clearing_every_field_removes_the_key_rather_than_leaving_an_empty_shell() {
        let current = merge_party(Some(&json!({ "golfCourseId": "course-1" })), &party());
        let cleared = merge_party(Some(&current), &PartyDetails::default());
        assert_eq!(cleared["golfCourseId"], json!("course-1"));
        assert!(cleared.get(PARTY_CUSTOM_FIELD_KEY).is_none());
    }

    #[test]
    fn a_player_entry_with_no_name_is_dropped_instead_of_breaking_the_board() {
        // The object is shared and anything may have written to it. One bad row
        // must not take out the whole day.
        let stored = json!({
            PARTY_CUSTOM_FIELD_KEY: {
                "players": [
                    { "name": "増田 公陽" },
                    { "tag": "共通" },
                    "not an object"
                ]
            }
        });
        let party = read_party(Some(&stored));
        assert_eq!(party.named_player_count(), 1);
        assert_eq!(party.players()[0].name(), "増田 公陽");
    }

    #[test]
    fn a_group_number_that_is_not_a_positive_number_is_ignored() {
        let stored = json!({ PARTY_CUSTOM_FIELD_KEY: { "groupNumber": 0 } });
        assert_eq!(read_party(Some(&stored)).group_number(), None);
        let stored = json!({ PARTY_CUSTOM_FIELD_KEY: { "groupNumber": "first" } });
        assert_eq!(read_party(Some(&stored)).group_number(), None);
    }

    #[test]
    fn a_party_too_large_to_be_real_reads_as_empty_rather_than_half_applied() {
        let players: Vec<Value> = (0..20)
            .map(|index| json!({ "name": format!("p{index}") }))
            .collect();
        let stored = json!({ PARTY_CUSTOM_FIELD_KEY: { "players": players } });
        assert!(read_party(Some(&stored)).is_empty());
    }

    #[test]
    fn an_operator_typing_a_blank_name_is_told_rather_than_silently_ignored() {
        let result = party_from_request(None, None, None, vec![("   ".into(), None, None)]);
        assert!(result.is_err());
    }
}
