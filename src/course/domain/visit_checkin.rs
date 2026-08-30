//! A round somebody was actually seen to play.
//!
//! `customer_visits` reads Field's bookings and works visits out: a tee time
//! that has passed on a booking nobody cancelled is taken as a round played.
//! That inference is the best a booking alone supports, and it is wrong twice
//! over — a group that simply never arrived still counts, and the three people
//! who came in a colleague's booking do not count at all, because Field records
//! one customer per reservation.
//!
//! A check-in is the desk saying what happened rather than the clock implying
//! it. It is golf's own record: the group and its seats are CourseBoard's
//! `golfParty`, and there is nothing in Field's reservation model to write it
//! back to (ADR-0005, ADR-0009).

use chrono::{DateTime, NaiveDate, Utc};

use super::{CourseError, CustomerId, ReservationId, MAX_PARTY_PLAYERS};

const MAX_NAME_LENGTH: usize = 120;

/// One person checked in for one round.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisitCheckin {
    pub reservation_id: ReservationId,
    pub player_index: u32,
    /// Who this is in the ledger, when the desk has decided.
    ///
    /// Optional for the same reason `PartyPlayer.customer_id` is: a group
    /// arrives with four names on it and two of them are not yet anybody in
    /// particular. Refusing the check-in until they are would mean the busiest
    /// hour of the morning is the one nobody records. The headcount stays true
    /// either way; only the customer's own page needs the link.
    pub customer_id: Option<CustomerId>,
    pub player_name: String,
    pub played_on: NaiveDate,
    pub checked_in_at: DateTime<Utc>,
    pub checked_in_by: Option<String>,
}

/// A seat the desk is checking in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewVisitCheckin {
    pub player_index: u32,
    pub customer_id: Option<CustomerId>,
    pub player_name: String,
}

impl NewVisitCheckin {
    pub fn try_new(
        player_index: u32,
        customer_id: Option<CustomerId>,
        player_name: impl Into<String>,
    ) -> Result<Self, CourseError> {
        // Seats are bounded by the group, so an index past the largest group
        // the ledger will draw is a caller sending nonsense rather than a
        // course that runs enormous flights.
        if player_index as usize >= MAX_PARTY_PLAYERS {
            return Err(CourseError::BadRequest("player index is outside the group"));
        }
        let player_name = player_name.into().trim().to_string();
        if player_name.is_empty() {
            return Err(CourseError::BadRequest(
                "a checked-in player needs the name the group was written under",
            ));
        }
        if player_name.chars().count() > MAX_NAME_LENGTH {
            return Err(CourseError::BadRequest("player name is too long"));
        }
        Ok(Self {
            player_index,
            customer_id,
            player_name,
        })
    }
}

/// The whole group as the desk checked it in.
///
/// Taken as a set rather than a seat at a time: a group walks up together, and
/// four separate writes is four chances to record half a group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisitCheckinRequest {
    pub reservation_id: ReservationId,
    pub played_on: NaiveDate,
    pub players: Vec<NewVisitCheckin>,
}

impl VisitCheckinRequest {
    pub fn try_new(
        reservation_id: ReservationId,
        played_on: NaiveDate,
        players: Vec<NewVisitCheckin>,
    ) -> Result<Self, CourseError> {
        if players.is_empty() {
            return Err(CourseError::BadRequest(
                "a check-in needs at least one player",
            ));
        }
        if players.len() > MAX_PARTY_PLAYERS {
            return Err(CourseError::BadRequest(
                "a group may not hold more than 8 players",
            ));
        }
        let mut seats: Vec<u32> = players.iter().map(|player| player.player_index).collect();
        seats.sort_unstable();
        seats.dedup();
        // Two rows for one seat is the desk sending the same person twice, and
        // the storage key would silently keep only the last of them.
        if seats.len() != players.len() {
            return Err(CourseError::BadRequest(
                "the same seat was checked in twice",
            ));
        }
        Ok(Self {
            reservation_id,
            played_on,
            players,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seat(index: u32) -> NewVisitCheckin {
        NewVisitCheckin::try_new(index, None, "山田 太郎").unwrap()
    }

    #[test]
    fn a_player_without_a_ledger_entry_can_still_be_checked_in() {
        let player = NewVisitCheckin::try_new(0, None, "同伴者").unwrap();
        assert_eq!(player.customer_id, None);
    }

    #[test]
    fn a_seat_checked_in_twice_is_refused() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        let result =
            VisitCheckinRequest::try_new(ReservationId::new("res_1"), date, vec![seat(0), seat(0)]);
        assert!(result.is_err());
    }

    #[test]
    fn an_empty_group_is_not_a_check_in() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
        assert!(
            VisitCheckinRequest::try_new(ReservationId::new("res_1"), date, Vec::new()).is_err()
        );
    }

    #[test]
    fn a_nameless_seat_is_refused() {
        assert!(NewVisitCheckin::try_new(0, None, "   ").is_err());
    }
}
