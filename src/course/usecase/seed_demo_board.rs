//! Write a demo day into Field, so the start ledger has something real to show.
//!
//! Deliberately a seed rather than a fixture: the data goes into Field and comes
//! back through the ordinary board. A demo served from a special code path would
//! prove nothing about the one operators use, and would drift from it silently.
//!
//! Re-running updates what the last run wrote. Field's reservation create has no
//! key that would prevent duplicates (`idempotencyKey` there covers holds and
//! payments), so every booking carries a seed key and the run matches on that.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDate, Utc};

use crate::course::domain::{
    demo_board, seed_tee_time, BusinessHours, CourseError, CourseId, CourseOrder,
    GatewayCredentials, GolfCatalogGateway, NewReservation, PlayType, ReservationGateway,
    SeedCourse, SeedGroup, SlotOverride, SlotOverrideGateway, UpsertCourse,
    UpsertReservationProduct, UpsertSlotOverrides, SEED_DURATION_MINUTES, SEED_PREFIX,
};

/// What a run created or changed, so the caller can say what happened rather
/// than just "done".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SeedSummary {
    pub courses: usize,
    pub bookings_created: usize,
    pub bookings_updated: usize,
    pub marks: usize,
}

pub struct SeedDemoBoardUseCase {
    reservations: Arc<dyn ReservationGateway>,
    catalog: Arc<dyn GolfCatalogGateway>,
    marks: Arc<dyn SlotOverrideGateway>,
}

impl SeedDemoBoardUseCase {
    pub fn new(
        reservations: Arc<dyn ReservationGateway>,
        catalog: Arc<dyn GolfCatalogGateway>,
        marks: Arc<dyn SlotOverrideGateway>,
    ) -> Self {
        Self {
            reservations,
            catalog,
            marks,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        tenant_id: &str,
        date: NaiveDate,
    ) -> Result<SeedSummary, CourseError> {
        if tenant_id.trim().is_empty() {
            return Err(CourseError::BadRequest("tenant id is required"));
        }
        let board = demo_board();
        let mut summary = SeedSummary::default();

        let course_ids = self.ensure_courses(credentials, board.courses).await?;
        summary.courses = course_ids.len();

        self.store_course_order(credentials, board.courses, &course_ids)
            .await?;

        let service_ids = self
            .ensure_products(credentials, board.groups, &course_ids)
            .await?;

        let (created, updated) = self
            .ensure_bookings(credentials, date, board.groups, &course_ids, &service_ids)
            .await?;
        summary.bookings_created = created;
        summary.bookings_updated = updated;

        summary.marks = self
            .store_marks(tenant_id, date, board.marks, &course_ids)
            .await?;

        Ok(summary)
    }

    /// Create the demo courses, or bring the existing ones back to the seed's
    /// shape.
    ///
    /// Matched by name because Field assigns course ids and its create takes
    /// none, so the seed cannot choose one to recognise later. Name is what a
    /// club would collide on anyway.
    async fn ensure_courses(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: &[SeedCourse],
    ) -> Result<HashMap<&'static str, CourseId>, CourseError> {
        let existing = self.catalog.list_courses(credentials).await?;
        let mut ids = HashMap::new();
        for seed in courses {
            let input = upsert_for(seed)?;
            let course = match existing.iter().find(|course| course.name() == seed.name) {
                Some(found) => {
                    self.catalog
                        .update_course(credentials, found.id(), input)
                        .await?
                }
                None => self.catalog.create_course(credentials, input).await?,
            };
            ids.insert(seed.key, course.id().clone());
        }
        Ok(ids)
    }

    /// Store the columns left to right, which is the whole reason the demo uses
    /// courses whose names do not sort into playing order.
    async fn store_course_order(
        &self,
        credentials: GatewayCredentials<'_>,
        courses: &[SeedCourse],
        course_ids: &HashMap<&'static str, CourseId>,
    ) -> Result<(), CourseError> {
        let order = CourseOrder::new(
            courses
                .iter()
                .filter_map(|seed| course_ids.get(seed.key).cloned()),
        );
        self.catalog
            .replace_course_order(credentials, &order)
            .await?;
        Ok(())
    }

    /// Put every group on the day, updating the ones a previous run wrote.
    /// Create the plan each demo group is sold under, and hand back its id.
    ///
    /// The tee sheet reads the play type off the plan behind a booking, so a
    /// seed that wrote no plan produced a board of nothing but self-play — and
    /// caddie assignment, which is most of what the operator screens do, had
    /// nothing to work on.
    async fn ensure_products(
        &self,
        credentials: GatewayCredentials<'_>,
        groups: &[SeedGroup],
        course_ids: &HashMap<&'static str, CourseId>,
    ) -> Result<HashMap<(&'static str, PlayType), String>, CourseError> {
        let mut wanted: Vec<(&'static str, PlayType)> = Vec::new();
        for group in groups {
            let key = (group.course_key, group.play_type);
            if !wanted.contains(&key) {
                wanted.push(key);
            }
        }

        let mut ids = HashMap::new();
        for (course_key, play_type) in wanted {
            let Some(course_id) = course_ids.get(course_key) else {
                continue;
            };
            let service_id = format!("{SEED_PREFIX}:{course_key}:{}", play_type.as_str());
            let product = self
                .catalog
                .upsert_reservation_product(
                    credentials,
                    UpsertReservationProduct::try_new(
                        service_id.clone(),
                        Some(match play_type {
                            PlayType::Caddie => "キャディ付き 18H".to_string(),
                            PlayType::SelfPlay => "セルフプレー 18H".to_string(),
                        }),
                        play_type.as_str(),
                        18,
                        SEED_DURATION_MINUTES as i32,
                        Some(course_id.as_str().to_string()),
                        Some(4),
                    )?,
                )
                .await?;
            ids.insert(
                (course_key, play_type),
                product.reservation_service_id().as_str().to_string(),
            );
        }
        Ok(ids)
    }

    async fn ensure_bookings(
        &self,
        credentials: GatewayCredentials<'_>,
        date: NaiveDate,
        groups: &[SeedGroup],
        course_ids: &HashMap<&'static str, CourseId>,
        service_ids: &HashMap<(&'static str, PlayType), String>,
    ) -> Result<(usize, usize), CourseError> {
        let reservation_type_id = self
            .reservations
            .list_reservation_type_ids(credentials)
            .await?
            .into_iter()
            .next()
            .ok_or(CourseError::BadRequest(
                "this tenant has no reservation type, and Field offers no way to create one; \
                 add one in Field before seeding",
            ))?;

        let seeded: HashMap<String, _> = self
            .reservations
            .list_seeded_reservations(credentials)
            .await?
            .into_iter()
            .map(|entry| (entry.seed_key, entry.id))
            .collect();

        let mut created = 0;
        let mut updated = 0;
        for group in groups {
            let Some(course_id) = course_ids.get(group.course_key) else {
                continue;
            };
            let input = booking_for(
                group,
                date,
                course_id,
                &reservation_type_id,
                service_ids
                    .get(&(group.course_key, group.play_type))
                    .cloned(),
            )?;
            match seeded.get(&group.seed_key(date)) {
                Some(id) => {
                    self.reservations
                        .replace_reservation(credentials, id, &input)
                        .await?;
                    updated += 1;
                }
                None => {
                    self.reservations
                        .create_reservation(credentials, &input)
                        .await?;
                    created += 1;
                }
            }
        }
        Ok((created, updated))
    }

    async fn store_marks(
        &self,
        tenant_id: &str,
        date: NaiveDate,
        marks: &[crate::course::domain::SeedMark],
        course_ids: &HashMap<&'static str, CourseId>,
    ) -> Result<usize, CourseError> {
        let mut overrides: Vec<SlotOverride> = Vec::new();
        for mark in marks {
            let Some(course_id) = course_ids.get(mark.course_key) else {
                continue;
            };
            overrides.extend(
                UpsertSlotOverrides {
                    course_id: course_id.clone(),
                    date,
                    tee_times: vec![mark.tee_time.to_string()],
                    kind: mark.kind,
                    label: Some(mark.label.to_string()),
                    note: None,
                }
                .into_overrides()?,
            );
        }
        if overrides.is_empty() {
            return Ok(0);
        }
        self.marks
            .upsert_slot_overrides(tenant_id, &overrides)
            .await?;
        Ok(overrides.len())
    }
}

fn upsert_for(seed: &SeedCourse) -> Result<UpsertCourse, CourseError> {
    UpsertCourse::try_new(
        seed.name,
        Some(seed.short_name.to_string()),
        18,
        "Asia/Tokyo",
        seed.start_interval_minutes,
        true,
        Some(BusinessHours::try_new(seed.open_time, seed.close_time)?),
    )
}

fn booking_for(
    group: &SeedGroup,
    date: NaiveDate,
    course_id: &CourseId,
    reservation_type_id: &str,
    reservation_service_id: Option<String>,
) -> Result<NewReservation, CourseError> {
    let starts_at = parse_tee_time(&seed_tee_time(date, group.tee_time)?)?;
    Ok(NewReservation {
        reservation_type_id: reservation_type_id.to_string(),
        reservation_service_id,
        reservation_resource_id: None,
        starts_at,
        ends_at: starts_at + Duration::minutes(SEED_DURATION_MINUTES),
        quantity: group.party_size,
        customer_name: group.customer_name.to_string(),
        golf_course_id: course_id.clone(),
        party: group.party()?,
        prepayment_policy: None,
        seed_key: Some(group.seed_key(date)),
    })
}

fn parse_tee_time(value: &str) -> Result<DateTime<Utc>, CourseError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| CourseError::Provider("the seed built an unreadable tee time".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seeded_course_carries_the_hours_the_ledger_draws_its_rows_from() {
        // Without hours the board falls back to bookings only, and the demo
        // would show no open tee times at all — the opposite of the point.
        let seed = &demo_board().courses[0];
        let input = upsert_for(seed).unwrap();
        let hours = input.business_hours.expect("opening hours");
        assert_eq!(hours.open(), seed.open_time);
        assert_eq!(hours.close(), seed.close_time);
        assert_eq!(
            input.start_interval_minutes.get(),
            seed.start_interval_minutes
        );
    }

    #[test]
    fn a_booking_lands_on_the_requested_day_in_the_courses_own_clock() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        let group = &demo_board().groups[0];
        let booking = booking_for(group, date, &CourseId::new("course-1"), "type-1", None).unwrap();
        assert_eq!(booking.starts_at.to_rfc3339(), "2026-07-19T21:53:00+00:00");
        assert_eq!(
            (booking.ends_at - booking.starts_at).num_minutes(),
            SEED_DURATION_MINUTES
        );
    }

    #[test]
    fn a_booking_carries_the_key_a_re_run_will_match_it_by() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        let group = &demo_board().groups[0];
        let booking = booking_for(
            group,
            date,
            &CourseId::new("course-1"),
            "type-1",
            Some("cb-demo:karanuma-in:caddie".into()),
        )
        .unwrap();
        assert_eq!(booking.seed_key, Some(group.seed_key(date)));
        assert!(booking.seed_key.as_deref().unwrap().starts_with("cb-demo:"));
        // Without the plan the tee sheet reads every seeded round as self-play.
        assert_eq!(
            booking.reservation_service_id.as_deref(),
            Some("cb-demo:karanuma-in:caddie")
        );
    }
}
