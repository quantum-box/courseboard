use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    field_api::{StaffAssignment, StaffAvailability, StaffProfile},
    smart_assign::{recommend_caddies, RecommendationStatus, SmartAssignRequest},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DemoReservation {
    pub id: String,
    pub tenant_id: String,
    pub course_id: String,
    pub customer_id: String,
    pub date: String,
    pub starts_at: String,
    pub ends_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemoSeed {
    pub tenant_id: String,
    pub profiles: Vec<StaffProfile>,
    pub availability: Vec<StaffAvailability>,
    pub reservations: Vec<DemoReservation>,
    pub assignments: Vec<StaffAssignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DemoTrace {
    pub reservation_id: String,
    pub recommended_profile_id: String,
    pub recommended_reasons: Vec<String>,
    pub assignment_id: String,
    pub double_booking_profile_status: String,
    pub double_booking_blocked: bool,
}

pub fn small_course_seed() -> DemoSeed {
    let tenant_id = "scc-demo".to_string();
    DemoSeed {
        tenant_id: tenant_id.clone(),
        profiles: vec![
            caddie_profile(
                &tenant_id,
                "sp_demo_aiko",
                "sm_demo_aiko",
                "Aiko Sato",
                json!({
                    "caddie_code": "C001",
                    "course_knowledge": ["course-east", "course-north"],
                    "customer_ratings": { "member_001": 4.7 },
                    "senior": true
                }),
            ),
            caddie_profile(
                &tenant_id,
                "sp_demo_mika",
                "sm_demo_mika",
                "Mika Tanaka",
                json!({
                    "caddie_code": "C002",
                    "course_knowledge": ["course-west"],
                    "customer_ratings": { "member_001": 3.9 }
                }),
            ),
            caddie_profile(
                &tenant_id,
                "sp_demo_ren",
                "sm_demo_ren",
                "Ren Ito",
                json!({
                    "caddie_code": "C003",
                    "course_knowledge": ["course-east"],
                    "rookie": true
                }),
            ),
            inactive_caddie_profile(&tenant_id),
        ],
        availability: vec![
            shift(
                &tenant_id,
                "sa_demo_aiko_am",
                "sp_demo_aiko",
                "07:00",
                "13:00",
                "checked_in",
            ),
            shift(
                &tenant_id,
                "sa_demo_mika_am",
                "sp_demo_mika",
                "07:00",
                "13:00",
                "available",
            ),
            shift(
                &tenant_id,
                "sa_demo_ren_am",
                "sp_demo_ren",
                "07:00",
                "13:00",
                "waiting",
            ),
            shift(
                &tenant_id,
                "sa_demo_inactive_am",
                "sp_demo_inactive",
                "07:00",
                "13:00",
                "absent",
            ),
        ],
        reservations: vec![
            DemoReservation {
                id: "res_demo_tee_001".to_string(),
                tenant_id: tenant_id.clone(),
                course_id: "course-east".to_string(),
                customer_id: "member_001".to_string(),
                date: "2026-06-01".to_string(),
                starts_at: "08:00".to_string(),
                ends_at: "12:00".to_string(),
            },
            DemoReservation {
                id: "res_demo_tee_002".to_string(),
                tenant_id: tenant_id.clone(),
                course_id: "course-east".to_string(),
                customer_id: "member_002".to_string(),
                date: "2026-06-01".to_string(),
                starts_at: "08:30".to_string(),
                ends_at: "12:30".to_string(),
            },
        ],
        assignments: vec![assignment(
            &tenant_id,
            "asg_demo_mika_busy",
            "sp_demo_mika",
            "res_demo_existing",
            "08:15",
            "11:45",
            "assigned",
        )],
    }
}

pub fn run_headless_demo(seed: &DemoSeed) -> DemoTrace {
    let reservation = seed
        .reservations
        .first()
        .expect("demo seed must contain a target reservation");
    let request = request_for_reservation(reservation);
    let recommendations = recommend_caddies(
        &seed.profiles,
        &seed.availability,
        &seed.assignments,
        &request,
    );
    let selected = recommendations
        .iter()
        .find(|item| item.status == RecommendationStatus::Recommended)
        .expect("demo seed must produce at least one recommended caddie");
    let assignment_id = format!("asg_{}", reservation.id);
    let mut assignments_after_demo = seed.assignments.clone();
    assignments_after_demo.push(assignment(
        &reservation.tenant_id,
        &assignment_id,
        &selected.profile.id,
        &reservation.id,
        &reservation.starts_at,
        &reservation.ends_at,
        "assigned",
    ));

    let double_booking_recommendations = recommend_caddies(
        &seed.profiles,
        &seed.availability,
        &assignments_after_demo,
        &request_for_reservation(&seed.reservations[1]),
    );
    let selected_after_assignment = double_booking_recommendations
        .iter()
        .find(|item| item.profile.id == selected.profile.id)
        .expect("selected caddie must still be present in demo recommendations");
    let double_booking_blocked = selected_after_assignment.status == RecommendationStatus::Busy;

    DemoTrace {
        reservation_id: reservation.id.clone(),
        recommended_profile_id: selected.profile.id.clone(),
        recommended_reasons: selected
            .reasons
            .iter()
            .map(|reason| reason.label().to_string())
            .collect(),
        assignment_id,
        double_booking_profile_status: format!("{:?}", selected_after_assignment.status),
        double_booking_blocked,
    }
}

fn request_for_reservation(reservation: &DemoReservation) -> SmartAssignRequest {
    SmartAssignRequest {
        date: Some(reservation.date.clone()),
        starts_at: Some(reservation.starts_at.clone()),
        ends_at: Some(reservation.ends_at.clone()),
        course_id: Some(reservation.course_id.clone()),
        customer_id: Some(reservation.customer_id.clone()),
    }
}

fn caddie_profile(
    tenant_id: &str,
    id: &str,
    staff_member_id: &str,
    display_name: &str,
    extra: Value,
) -> StaffProfile {
    StaffProfile {
        id: id.to_string(),
        tenant_id: Some(tenant_id.to_string()),
        staff_member_id: Some(staff_member_id.to_string()),
        display_name: Some(display_name.to_string()),
        status: Some("active".to_string()),
        role: Some("caddie".to_string()),
        phone: None,
        email: None,
        notes: None,
        extra,
    }
}

fn inactive_caddie_profile(tenant_id: &str) -> StaffProfile {
    StaffProfile {
        status: Some("inactive".to_string()),
        ..caddie_profile(
            tenant_id,
            "sp_demo_inactive",
            "sm_demo_inactive",
            "Inactive Demo",
            json!({ "caddie_code": "C999" }),
        )
    }
}

fn shift(
    tenant_id: &str,
    id: &str,
    staff_profile_id: &str,
    starts_at: &str,
    ends_at: &str,
    status: &str,
) -> StaffAvailability {
    StaffAvailability {
        id: id.to_string(),
        tenant_id: Some(tenant_id.to_string()),
        staff_profile_id: Some(staff_profile_id.to_string()),
        staff_member_id: None,
        date: Some("2026-06-01".to_string()),
        starts_at: Some(starts_at.to_string()),
        ends_at: Some(ends_at.to_string()),
        status: Some(status.to_string()),
        note: Some("demo seed".to_string()),
        extra: Value::Null,
    }
}

fn assignment(
    tenant_id: &str,
    id: &str,
    staff_profile_id: &str,
    reservation_id: &str,
    starts_at: &str,
    ends_at: &str,
    status: &str,
) -> StaffAssignment {
    StaffAssignment {
        id: id.to_string(),
        tenant_id: Some(tenant_id.to_string()),
        staff_profile_id: Some(staff_profile_id.to_string()),
        staff_member_id: None,
        reservation_id: Some(reservation_id.to_string()),
        date: Some("2026-06-01".to_string()),
        starts_at: Some(starts_at.to_string()),
        ends_at: Some(ends_at.to_string()),
        status: Some(status.to_string()),
        note: Some("demo seed".to_string()),
        extra: Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_contains_complete_small_course_scenario() {
        let seed = small_course_seed();

        assert_eq!(seed.tenant_id, "scc-demo");
        assert!(seed.profiles.len() >= 4);
        assert!(seed.availability.len() >= 4);
        assert!(seed.reservations.len() >= 2);
        assert!(seed
            .assignments
            .iter()
            .any(|item| item.id == "asg_demo_mika_busy"));
    }

    #[test]
    fn headless_demo_recommends_assigns_and_blocks_double_booking() {
        let seed = small_course_seed();
        let trace = run_headless_demo(&seed);

        assert_eq!(trace.reservation_id, "res_demo_tee_001");
        assert_eq!(trace.recommended_profile_id, "sp_demo_aiko");
        assert!(trace
            .recommended_reasons
            .contains(&"course knowledge match".to_string()));
        assert!(trace
            .recommended_reasons
            .contains(&"customer rating 4+".to_string()));
        assert_eq!(trace.assignment_id, "asg_res_demo_tee_001");
        assert_eq!(trace.double_booking_profile_status, "Busy");
        assert!(trace.double_booking_blocked);
    }
}
