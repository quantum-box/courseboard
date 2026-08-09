//! CreateDeskReservationUseCase: enter one phone booking from the start ledger.

use std::sync::Arc;

use chrono::{NaiveDate, NaiveTime, TimeZone};

use crate::course::domain::{
    jst_offset, CourseError, CourseId, GatewayCredentials, GolfCatalogGateway, NewDeskReservation,
    PartyDetails, PlayType, ReservationGateway, ReservationId, ReservationProduct, Resource,
    ResourceId, ResourceKind,
};

/// Golf terms the start desk supplies. Field ids are resolved by the use case,
/// except the reservation resource shown on the ledger: carrying that exact id
/// is what makes the booking consume the row the operator selected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateDeskReservation {
    pub course_id: CourseId,
    pub resource_id: ResourceId,
    pub date: NaiveDate,
    pub tee_time: String,
    pub play_type: PlayType,
    pub party: PartyDetails,
}

pub struct CreateDeskReservationUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
}

impl CreateDeskReservationUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        command: CreateDeskReservation,
    ) -> Result<ReservationId, CourseError> {
        let (resources, products, reservation_type_ids) = tokio::join!(
            self.catalog.list_resources(credentials),
            self.catalog.list_reservation_products(credentials),
            self.reservations.list_reservation_type_ids(credentials),
        );
        let input = build_input(&command, &resources?, &products?, &reservation_type_ids?)?;
        self.reservations
            .create_desk_reservation(credentials, &input)
            .await
    }
}

fn build_input(
    command: &CreateDeskReservation,
    resources: &[Resource],
    products: &[ReservationProduct],
    reservation_type_ids: &[String],
) -> Result<NewDeskReservation, CourseError> {
    let player_count = command.party.named_player_count();
    if player_count == 0 {
        return Err(CourseError::BadRequest(
            "at least one player name is required",
        ));
    }

    let resource = resources
        .iter()
        .filter(|resource| resource.is_active())
        .filter(|resource| resource.kind() == ResourceKind::Course)
        .find(|resource| {
            resource.golf_course_id() == Some(&command.course_id)
                && resource.matches_reservation_resource(&command.resource_id)
        })
        .ok_or(CourseError::BadRequest(
            "the selected course is not linked to that reservation resource",
        ))?;
    let resource_id = resource
        .reservation_resource_id()
        .cloned()
        .unwrap_or_else(|| resource.id().clone());
    if resource_id != command.resource_id {
        return Err(CourseError::BadRequest(
            "the selected resource is not the course inventory resource",
        ));
    }

    let product = select_product(products, &command.course_id, command.play_type).ok_or(
        CourseError::BadRequest("this course has no reservation product for that play type"),
    )?;
    if product
        .max_players_per_group()
        .is_some_and(|maximum| player_count > maximum)
    {
        return Err(CourseError::BadRequest(
            "the player count exceeds the reservation product limit",
        ));
    }

    let reservation_type_id = reservation_type_ids
        .iter()
        .find(|id| !id.trim().is_empty())
        .cloned()
        .ok_or(CourseError::BadRequest(
            "this tenant has no reservation type",
        ))?;
    let tee_time = NaiveTime::parse_from_str(&command.tee_time, "%H:%M")
        .map_err(|_| CourseError::BadRequest("tee time must be HH:MM"))?;
    let jst = jst_offset()?;
    let starts_at = jst
        .from_local_datetime(&command.date.and_time(tee_time))
        .single()
        .ok_or(CourseError::BadRequest(
            "tee time is not a valid local time",
        ))?
        .to_utc();
    let ends_at =
        starts_at + chrono::Duration::minutes(i64::from(product.expected_duration_minutes().get()));
    let customer_name = command.party.players()[0].name().to_string();

    Ok(NewDeskReservation {
        reservation_type_id,
        reservation_service_id: product.reservation_service_id().clone(),
        reservation_resource_id: resource_id,
        starts_at,
        ends_at,
        customer_name,
        golf_course_id: command.course_id.clone(),
        party: command.party.clone(),
    })
}

/// Prefer a course-specific plan, then an older tenant-wide plan. Stable
/// service-id ordering makes the same choice on every run when legacy config
/// contains duplicates but the desk was only asked for a play type.
fn select_product<'a>(
    products: &'a [ReservationProduct],
    course_id: &CourseId,
    play_type: PlayType,
) -> Option<&'a ReservationProduct> {
    let matching = |product: &&ReservationProduct| product.play_type() == play_type;
    products
        .iter()
        .filter(matching)
        .filter(|product| product.golf_course_id() == Some(course_id))
        .min_by_key(|product| product.reservation_service_id().as_str())
        .or_else(|| {
            products
                .iter()
                .filter(matching)
                .filter(|product| product.golf_course_id().is_none())
                .min_by_key(|product| product.reservation_service_id().as_str())
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::domain::{PartyPlayer, ReservationProduct};

    fn party(names: &[&str]) -> PartyDetails {
        PartyDetails::try_new(
            None,
            None,
            None,
            names
                .iter()
                .map(|name| PartyPlayer::try_new(*name, None, None).unwrap())
                .collect(),
        )
        .unwrap()
    }

    fn resource(course_id: &str, reservation_resource_id: &str) -> Resource {
        Resource::reconstitute(
            format!("link-{course_id}"),
            "course",
            Some(reservation_resource_id.to_string()),
            Some(course_id.to_string()),
            ResourceKind::Course,
            true,
        )
    }

    fn product(
        course_id: Option<&str>,
        play_type: PlayType,
        maximum: Option<i32>,
    ) -> ReservationProduct {
        ReservationProduct::reconstitute(
            "product-1",
            None,
            match play_type {
                PlayType::Caddie => "service-caddie",
                PlayType::SelfPlay => "service-self",
            },
            None,
            play_type,
            18,
            270,
            course_id.map(str::to_string),
            maximum,
        )
    }

    fn command() -> CreateDeskReservation {
        CreateDeskReservation {
            course_id: CourseId::new("course-1"),
            resource_id: ResourceId::new("reservation-resource-1"),
            date: NaiveDate::from_ymd_opt(2026, 8, 12).unwrap(),
            tee_time: "07:30".into(),
            play_type: PlayType::Caddie,
            party: party(&["山田 太郎", "山田 花子"]),
        }
    }

    #[test]
    fn selected_ledger_resource_becomes_the_field_inventory_target() {
        let input = build_input(
            &command(),
            &[resource("course-1", "reservation-resource-1")],
            &[product(Some("course-1"), PlayType::Caddie, Some(4))],
            &["type-1".into()],
        )
        .unwrap();

        assert_eq!(
            input.reservation_resource_id.as_str(),
            "reservation-resource-1"
        );
        assert_eq!(input.reservation_service_id.as_str(), "service-caddie");
        assert_eq!(input.customer_name, "山田 太郎");
        assert_eq!(input.starts_at.to_rfc3339(), "2026-08-11T22:30:00+00:00");
        assert_eq!((input.ends_at - input.starts_at).num_minutes(), 270);
    }

    #[test]
    fn a_resource_from_another_course_is_refused_before_field_is_called() {
        let result = build_input(
            &command(),
            &[resource("course-2", "reservation-resource-1")],
            &[product(Some("course-1"), PlayType::Caddie, Some(4))],
            &["type-1".into()],
        );
        assert!(matches!(result, Err(CourseError::BadRequest(_))));
    }

    #[test]
    fn the_product_player_limit_is_enforced() {
        let mut command = command();
        command.party = party(&["一", "二", "三"]);
        let result = build_input(
            &command,
            &[resource("course-1", "reservation-resource-1")],
            &[product(Some("course-1"), PlayType::Caddie, Some(2))],
            &["type-1".into()],
        );
        assert!(matches!(result, Err(CourseError::BadRequest(_))));
    }

    #[test]
    fn an_unscoped_legacy_product_is_used_only_as_a_fallback() {
        let exact = product(Some("course-1"), PlayType::Caddie, None);
        let fallback = product(None, PlayType::SelfPlay, None);
        assert_eq!(
            select_product(
                &[fallback.clone(), exact],
                &CourseId::new("course-1"),
                PlayType::Caddie
            )
            .unwrap()
            .reservation_service_id()
            .as_str(),
            "service-caddie"
        );
        assert_eq!(
            select_product(&[fallback], &CourseId::new("course-1"), PlayType::SelfPlay)
                .unwrap()
                .reservation_service_id()
                .as_str(),
            "service-self"
        );
    }
}
