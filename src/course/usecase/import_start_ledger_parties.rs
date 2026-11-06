//! ImportStartLedgerPartiesUseCase: books the groups the desk checked against
//! the start ledger, one booking per group, through the same path as a booking
//! taken at the ledger ([`CreateReservationUseCase`]).
//!
//! A tee time on the same day and course that already has a group is skipped,
//! not booked twice. That makes the whole import safe to send again: a retry
//! after a lost response finds its own earlier bookings and reports them as
//! already there.

use std::{collections::HashSet, sync::Arc};

use chrono::{DateTime, NaiveDate, Utc};

use crate::course::domain::{
    actions, parse_tenant_tee_time, CourseError, CourseId, GatewayCredentials, GolfCatalogGateway,
    PartyDetails, Reservation, ReservationGateway, ReservationId, ReservationProduct, Resource,
    ResourceId, ResourceKind,
};

use super::{CreateReservationInput, CreateReservationUseCase};

/// A request carries a handful of groups so each answer comes back well
/// inside a request timeout; the screen sends the day in pieces.
pub const MAX_START_LEDGER_IMPORT_PARTIES: usize = 10;
/// What the ledger editor uses when a booking names no plan.
const DEFAULT_DURATION_MINUTES: i64 = 270;

/// One group as the desk approved it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartLedgerImportParty {
    pub golf_course_id: CourseId,
    /// `HH:MM` on the course's own clock.
    pub tee_time: String,
    pub reservation_service_id: Option<String>,
    /// The representative; the booking is written under this name.
    pub customer_name: String,
    pub quantity: i32,
    pub party: PartyDetails,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartLedgerImportOutcome {
    Created {
        reservation_id: ReservationId,
        warnings: Vec<&'static str>,
    },
    /// That tee time already had a group: nothing was written.
    AlreadyBooked {
        reservation_id: Option<ReservationId>,
    },
    /// The group could not be booked; the desk can fix and send it again.
    Failed { message: String },
}

pub struct ImportStartLedgerPartiesUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    reservations: Arc<dyn ReservationGateway>,
    create: CreateReservationUseCase,
}

/// What is decided about a group before anything is written.
#[derive(Debug, PartialEq, Eq)]
enum Prepared {
    Book {
        resource_id: ResourceId,
        duration_minutes: i64,
        starts_at: DateTime<Utc>,
    },
    Skip(StartLedgerImportOutcome),
}

impl ImportStartLedgerPartiesUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        reservations: Arc<dyn ReservationGateway>,
        create: CreateReservationUseCase,
    ) -> Self {
        Self {
            catalog,
            reservations,
            create,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        parties: Vec<StartLedgerImportParty>,
    ) -> Result<Vec<StartLedgerImportOutcome>, CourseError> {
        credentials.require(actions::MANAGE_RESERVATIONS).await?;
        if parties.is_empty() || parties.len() > MAX_START_LEDGER_IMPORT_PARTIES {
            return Err(CourseError::BadRequest(
                "send between 1 and 10 groups at a time",
            ));
        }
        let (timezone, resources, products, reservations) = tokio::try_join!(
            self.catalog.get_tenant_timezone(credentials),
            self.catalog.list_resources(credentials),
            self.catalog.list_reservation_products(credentials),
            self.reservations.list_reservations(credentials),
        )?;
        let mut claimed = HashSet::new();
        let mut outcomes = Vec::with_capacity(parties.len());
        for party in parties {
            let prepared = prepare(
                &party,
                date,
                &timezone,
                &resources,
                &products,
                &reservations,
                &claimed,
            );
            let Prepared::Book {
                resource_id,
                duration_minutes,
                starts_at,
            } = prepared
            else {
                if let Prepared::Skip(outcome) = prepared {
                    outcomes.push(outcome);
                }
                continue;
            };
            let key = (party.golf_course_id.clone(), starts_at);
            let result = self
                .create
                .execute(
                    credentials,
                    CreateReservationInput {
                        golf_course_id: party.golf_course_id,
                        reservation_resource_id: resource_id,
                        reservation_service_id: party.reservation_service_id,
                        date,
                        tee_time: party.tee_time,
                        duration_minutes,
                        quantity: party.quantity,
                        customer_name: party.customer_name,
                        customer_id: None,
                        party: party.party,
                        notes: party.notes,
                    },
                )
                .await;
            match result {
                Ok(created) => {
                    claimed.insert(key);
                    outcomes.push(StartLedgerImportOutcome::Created {
                        reservation_id: created.id,
                        warnings: created.warnings,
                    });
                }
                Err(error) => outcomes.push(failed_or_abort(error)?),
            }
        }
        Ok(outcomes)
    }
}

/// A refusal about this one group is reported beside it and the rest go on.
/// Anything else (signed out, Field down) stops the request: the groups
/// already booked are found as "already booked" when it is sent again.
fn failed_or_abort(error: CourseError) -> Result<StartLedgerImportOutcome, CourseError> {
    match error {
        CourseError::BadRequest(message)
        | CourseError::Conflict(message)
        | CourseError::NotFound(message) => Ok(StartLedgerImportOutcome::Failed {
            message: message.to_string(),
        }),
        CourseError::UpstreamClient { status, message } if status != 401 && status != 403 => {
            Ok(StartLedgerImportOutcome::Failed { message })
        }
        other => Err(other),
    }
}

fn prepare(
    party: &StartLedgerImportParty,
    date: NaiveDate,
    timezone: &str,
    resources: &[Resource],
    products: &[ReservationProduct],
    reservations: &[Reservation],
    claimed: &HashSet<(CourseId, DateTime<Utc>)>,
) -> Prepared {
    let fail = |message: &str| {
        Prepared::Skip(StartLedgerImportOutcome::Failed {
            message: message.to_string(),
        })
    };
    let starts_at = match parse_tenant_tee_time(date, &party.tee_time, timezone) {
        Ok(starts_at) => starts_at,
        Err(_) => return fail("スタート時刻を HH:MM で入力してください"),
    };
    if claimed.contains(&(party.golf_course_id.clone(), starts_at)) {
        return Prepared::Skip(StartLedgerImportOutcome::AlreadyBooked {
            reservation_id: None,
        });
    }
    if let Some(existing) = reservations
        .iter()
        .filter(|reservation| reservation.is_tee_sheet_candidate())
        .find(|reservation| {
            reservation.starts_at() == starts_at
                && reservation.golf_course_id() == Some(&party.golf_course_id)
        })
    {
        return Prepared::Skip(StartLedgerImportOutcome::AlreadyBooked {
            reservation_id: Some(existing.id().clone()),
        });
    }
    let Some(resource) = resources
        .iter()
        .filter(|resource| resource.is_active() && resource.kind() == ResourceKind::Course)
        .find(|resource| resource.golf_course_id() == Some(&party.golf_course_id))
    else {
        return fail("このコースには予約枠がありません。コース設定を確認してください");
    };
    let duration_minutes = party
        .reservation_service_id
        .as_deref()
        .and_then(|id| {
            products
                .iter()
                .find(|product| product.reservation_service_id().as_str() == id)
        })
        .map(|product| i64::from(product.fallback_duration_minutes()))
        .filter(|minutes| *minutes > 0)
        .unwrap_or(DEFAULT_DURATION_MINUTES);
    Prepared::Book {
        resource_id: resource
            .reservation_resource_id()
            .unwrap_or_else(|| resource.id())
            .clone(),
        duration_minutes,
        starts_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZONE: &str = "Asia/Tokyo";

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 7).unwrap()
    }

    fn party(tee_time: &str) -> StartLedgerImportParty {
        StartLedgerImportParty {
            golf_course_id: CourseId::new("out"),
            tee_time: tee_time.into(),
            reservation_service_id: None,
            customer_name: "菊池 芳彦".into(),
            quantity: 4,
            party: PartyDetails::default(),
            notes: None,
        }
    }

    fn resource() -> Resource {
        Resource::reconstitute(
            "res-out",
            "空沼OUT",
            Some("inv-out".into()),
            Some("out".into()),
            ResourceKind::Course,
            true,
        )
    }

    fn booked_at(tee_time: &str) -> Reservation {
        let starts_at = parse_tenant_tee_time(date(), tee_time, ZONE).unwrap();
        Reservation::reconstitute(
            "r-1",
            "R-1",
            None,
            Some("inv-out".into()),
            Some("既存".into()),
            "confirmed",
            starts_at,
            starts_at + chrono::Duration::hours(4),
            4,
            Some("out".into()),
            None,
        )
    }

    #[test]
    fn a_free_tee_time_is_booked_on_the_courses_inventory_resource() {
        let prepared = prepare(
            &party("08:45"),
            date(),
            ZONE,
            &[resource()],
            &[],
            &[],
            &HashSet::new(),
        );
        let Prepared::Book {
            resource_id,
            duration_minutes,
            ..
        } = prepared
        else {
            panic!("expected a booking, got {prepared:?}");
        };
        assert_eq!(resource_id, ResourceId::new("inv-out"));
        assert_eq!(duration_minutes, DEFAULT_DURATION_MINUTES);
    }

    #[test]
    fn a_tee_time_that_already_has_a_group_is_skipped() {
        let prepared = prepare(
            &party("08:45"),
            date(),
            ZONE,
            &[resource()],
            &[],
            &[booked_at("08:45")],
            &HashSet::new(),
        );
        assert_eq!(
            prepared,
            Prepared::Skip(StartLedgerImportOutcome::AlreadyBooked {
                reservation_id: Some(ReservationId::new("r-1"))
            })
        );
        // Another time on the same course is still free.
        assert!(matches!(
            prepare(
                &party("08:52"),
                date(),
                ZONE,
                &[resource()],
                &[],
                &[booked_at("08:45")],
                &HashSet::new(),
            ),
            Prepared::Book { .. }
        ));
    }

    #[test]
    fn the_same_tee_time_twice_in_one_request_is_booked_once() {
        let starts_at = parse_tenant_tee_time(date(), "08:45", ZONE).unwrap();
        let claimed = HashSet::from([(CourseId::new("out"), starts_at)]);
        assert_eq!(
            prepare(
                &party("08:45"),
                date(),
                ZONE,
                &[resource()],
                &[],
                &[],
                &claimed
            ),
            Prepared::Skip(StartLedgerImportOutcome::AlreadyBooked {
                reservation_id: None
            })
        );
    }

    #[test]
    fn a_course_without_a_resource_or_an_unreadable_time_is_reported() {
        assert!(matches!(
            prepare(
                &party("08:45"),
                date(),
                ZONE,
                &[],
                &[],
                &[],
                &HashSet::new()
            ),
            Prepared::Skip(StartLedgerImportOutcome::Failed { .. })
        ));
        assert!(matches!(
            prepare(
                &party("8時"),
                date(),
                ZONE,
                &[resource()],
                &[],
                &[],
                &HashSet::new()
            ),
            Prepared::Skip(StartLedgerImportOutcome::Failed { .. })
        ));
    }

    #[test]
    fn refusals_are_reported_per_group_but_outages_stop_the_request() {
        assert!(matches!(
            failed_or_abort(CourseError::Conflict("埋まりました")),
            Ok(StartLedgerImportOutcome::Failed { .. })
        ));
        assert!(failed_or_abort(CourseError::Provider("down".into())).is_err());
        assert!(failed_or_abort(CourseError::Unauthorized).is_err());
    }
}
