use std::cmp::Ordering;

use serde_json::Value;

use crate::field_api::{StaffAssignment, StaffAvailability, StaffProfile};

#[derive(Debug, Clone, Default)]
pub struct SmartAssignRequest {
    pub date: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub course_id: Option<String>,
    pub customer_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmartAssignRecommendation {
    pub profile: StaffProfile,
    pub score: i64,
    pub status: RecommendationStatus,
    pub reasons: Vec<RecommendationReason>,
    pub tie_break: SmartAssignTieBreak,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmartAssignTieBreak {
    pub shift_start: String,
    pub caddie_code: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecommendationStatus {
    Recommended,
    Available,
    Busy,
    Inactive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecommendationReason {
    ActiveCaddie,
    InactiveCaddie,
    ShiftCoversTeeTime,
    NoMatchingShift,
    NoOverlappingAssignment,
    OverlappingAssignment,
    CourseKnowledgeMatch,
    CourseKnowledgeMissing,
    CustomerRatingPriority,
    CustomerRatingMissing,
    RookiePriorityDown,
    SeniorCaddie,
}

impl RecommendationReason {
    pub fn label(&self) -> &'static str {
        match self {
            RecommendationReason::ActiveCaddie => "active caddie",
            RecommendationReason::InactiveCaddie => "inactive profile",
            RecommendationReason::ShiftCoversTeeTime => "shift covers requested tee time",
            RecommendationReason::NoMatchingShift => "no matching shift",
            RecommendationReason::NoOverlappingAssignment => "no overlapping assignment",
            RecommendationReason::OverlappingAssignment => "overlapping assignment",
            RecommendationReason::CourseKnowledgeMatch => "course knowledge match",
            RecommendationReason::CourseKnowledgeMissing => "course knowledge not provided",
            RecommendationReason::CustomerRatingPriority => "customer rating 4+",
            RecommendationReason::CustomerRatingMissing => "customer rating not provided",
            RecommendationReason::RookiePriorityDown => "rookie priority down",
            RecommendationReason::SeniorCaddie => "senior caddie",
        }
    }
}

pub fn recommend_caddies(
    profiles: &[StaffProfile],
    availability: &[StaffAvailability],
    assignments: &[StaffAssignment],
    request: &SmartAssignRequest,
) -> Vec<SmartAssignRecommendation> {
    let mut recommendations = profiles
        .iter()
        .cloned()
        .map(|profile| score_profile(profile, availability, assignments, request))
        .collect::<Vec<_>>();

    recommendations.sort_by(compare_recommendations);
    recommendations
}

fn score_profile(
    profile: StaffProfile,
    availability: &[StaffAvailability],
    assignments: &[StaffAssignment],
    request: &SmartAssignRequest,
) -> SmartAssignRecommendation {
    let mut score = 0;
    let mut reasons = Vec::new();
    let shift = matching_shift(&profile.id, availability, request);
    let busy = has_overlapping_assignment(&profile.id, assignments, request);
    let active = profile.status.as_deref() != Some("inactive");

    if active {
        score += 100;
        reasons.push(RecommendationReason::ActiveCaddie);
    } else {
        reasons.push(RecommendationReason::InactiveCaddie);
    }

    if shift.is_some() {
        score += 80;
        reasons.push(RecommendationReason::ShiftCoversTeeTime);
    } else {
        reasons.push(RecommendationReason::NoMatchingShift);
    }

    if busy {
        score -= 200;
        reasons.push(RecommendationReason::OverlappingAssignment);
    } else {
        score += 60;
        reasons.push(RecommendationReason::NoOverlappingAssignment);
    }

    if let Some(course_id) = request
        .course_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        if profile_has_course_knowledge(&profile, course_id) {
            score += 25;
            reasons.push(RecommendationReason::CourseKnowledgeMatch);
        } else {
            reasons.push(RecommendationReason::CourseKnowledgeMissing);
        }
    }

    if let Some(customer_id) = request
        .customer_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        if customer_rating(&profile, customer_id).is_some_and(|rating| rating >= 4.0) {
            score += 20;
            reasons.push(RecommendationReason::CustomerRatingPriority);
        } else {
            reasons.push(RecommendationReason::CustomerRatingMissing);
        }
    }

    if profile_flag(&profile, "rookie") {
        score -= 15;
        reasons.push(RecommendationReason::RookiePriorityDown);
    }
    if profile_flag(&profile, "senior") {
        score += 10;
        reasons.push(RecommendationReason::SeniorCaddie);
    }

    let status = if !active {
        RecommendationStatus::Inactive
    } else if busy {
        RecommendationStatus::Busy
    } else if shift.is_some() {
        RecommendationStatus::Recommended
    } else {
        RecommendationStatus::Available
    };

    SmartAssignRecommendation {
        tie_break: SmartAssignTieBreak {
            shift_start: shift
                .and_then(|item| item.starts_at.clone())
                .unwrap_or_else(|| "99:99".to_string()),
            caddie_code: caddie_code(&profile),
            profile_id: profile.id.clone(),
        },
        profile,
        score,
        status,
        reasons,
    }
}

fn compare_recommendations(
    left: &SmartAssignRecommendation,
    right: &SmartAssignRecommendation,
) -> Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| left.tie_break.shift_start.cmp(&right.tie_break.shift_start))
        .then_with(|| left.tie_break.caddie_code.cmp(&right.tie_break.caddie_code))
        .then_with(|| left.tie_break.profile_id.cmp(&right.tie_break.profile_id))
}

fn matching_shift<'a>(
    staff_profile_id: &str,
    availability: &'a [StaffAvailability],
    request: &SmartAssignRequest,
) -> Option<&'a StaffAvailability> {
    let date = request.date.as_deref().filter(|value| !value.is_empty())?;
    availability
        .iter()
        .filter(|item| {
            item.staff_profile_id.as_deref() == Some(staff_profile_id)
                && item.date.as_deref() == Some(date)
                && item.status.as_deref().unwrap_or("available") != "unavailable"
                && covers_requested_time(
                    item.starts_at.as_deref(),
                    item.ends_at.as_deref(),
                    request,
                )
        })
        .min_by(|left, right| {
            left.starts_at
                .as_deref()
                .unwrap_or("99:99")
                .cmp(right.starts_at.as_deref().unwrap_or("99:99"))
                .then_with(|| left.id.cmp(&right.id))
        })
}

fn has_overlapping_assignment(
    staff_profile_id: &str,
    assignments: &[StaffAssignment],
    request: &SmartAssignRequest,
) -> bool {
    let Some(date) = request.date.as_deref().filter(|value| !value.is_empty()) else {
        return false;
    };
    assignments.iter().any(|assignment| {
        assignment.staff_profile_id.as_deref() == Some(staff_profile_id)
            && assignment.date.as_deref() == Some(date)
            && assignment.status.as_deref() != Some("cancelled")
            && overlaps_requested_time(
                assignment.starts_at.as_deref(),
                assignment.ends_at.as_deref(),
                request,
            )
    })
}

fn covers_requested_time(
    starts_at: Option<&str>,
    ends_at: Option<&str>,
    request: &SmartAssignRequest,
) -> bool {
    let Some(request_start) = request
        .starts_at
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    let Some(request_end) = request.ends_at.as_deref().filter(|value| !value.is_empty()) else {
        return true;
    };
    starts_at.unwrap_or("") <= request_start && ends_at.unwrap_or("99:99") >= request_end
}

fn overlaps_requested_time(
    starts_at: Option<&str>,
    ends_at: Option<&str>,
    request: &SmartAssignRequest,
) -> bool {
    let Some(request_start) = request
        .starts_at
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    let Some(request_end) = request.ends_at.as_deref().filter(|value| !value.is_empty()) else {
        return true;
    };
    starts_at.unwrap_or("") < request_end && ends_at.unwrap_or("99:99") > request_start
}

fn profile_has_course_knowledge(profile: &StaffProfile, course_id: &str) -> bool {
    match profile.extra.get("course_knowledge") {
        Some(Value::Array(values)) => values.iter().any(|value| value.as_str() == Some(course_id)),
        Some(Value::String(value)) => value == course_id,
        _ => false,
    }
}

fn customer_rating(profile: &StaffProfile, customer_id: &str) -> Option<f64> {
    profile
        .extra
        .get("customer_ratings")
        .and_then(|value| value.get(customer_id))
        .and_then(Value::as_f64)
}

fn profile_flag(profile: &StaffProfile, key: &str) -> bool {
    profile
        .extra
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn caddie_code(profile: &StaffProfile) -> String {
    profile
        .extra
        .get("caddie_code")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| profile.staff_member_id.clone())
        .unwrap_or_else(|| profile.id.clone())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn profile(id: &str, name: &str, extra: Value) -> StaffProfile {
        StaffProfile {
            id: id.to_string(),
            tenant_id: Some("scc".to_string()),
            staff_member_id: Some(format!("sm_{id}")),
            display_name: Some(name.to_string()),
            status: Some("active".to_string()),
            role: Some("caddie".to_string()),
            phone: None,
            email: None,
            notes: None,
            extra,
        }
    }

    fn inactive_profile(id: &str, name: &str) -> StaffProfile {
        StaffProfile {
            status: Some("inactive".to_string()),
            ..profile(id, name, json!({ "caddie_code": id }))
        }
    }

    fn shift(
        id: &str,
        staff_profile_id: &str,
        starts_at: &str,
        ends_at: &str,
    ) -> StaffAvailability {
        StaffAvailability {
            id: id.to_string(),
            tenant_id: Some("scc".to_string()),
            staff_profile_id: Some(staff_profile_id.to_string()),
            staff_member_id: None,
            date: Some("2026-06-01".to_string()),
            starts_at: Some(starts_at.to_string()),
            ends_at: Some(ends_at.to_string()),
            status: Some("available".to_string()),
            note: None,
            extra: Value::Null,
        }
    }

    fn assignment(staff_profile_id: &str, starts_at: &str, ends_at: &str) -> StaffAssignment {
        StaffAssignment {
            id: format!("asg_{staff_profile_id}"),
            tenant_id: Some("scc".to_string()),
            staff_profile_id: Some(staff_profile_id.to_string()),
            staff_member_id: None,
            reservation_id: Some("res_other".to_string()),
            date: Some("2026-06-01".to_string()),
            starts_at: Some(starts_at.to_string()),
            ends_at: Some(ends_at.to_string()),
            status: Some("assigned".to_string()),
            note: None,
            extra: Value::Null,
        }
    }

    fn request() -> SmartAssignRequest {
        SmartAssignRequest {
            date: Some("2026-06-01".to_string()),
            starts_at: Some("08:00".to_string()),
            ends_at: Some("12:00".to_string()),
            course_id: Some("course-east".to_string()),
            customer_id: Some("member_1".to_string()),
        }
    }

    #[test]
    fn scores_active_shift_no_overlap_course_and_rating() {
        let profiles = vec![profile(
            "sp_1",
            "Aiko",
            json!({
                "caddie_code": "C001",
                "course_knowledge": ["course-east"],
                "customer_ratings": { "member_1": 4.6 },
                "senior": true
            }),
        )];
        let recommendations = recommend_caddies(
            &profiles,
            &[shift("sa_1", "sp_1", "07:30", "12:30")],
            &[],
            &request(),
        );

        assert_eq!(recommendations[0].status, RecommendationStatus::Recommended);
        assert!(recommendations[0]
            .reasons
            .contains(&RecommendationReason::CourseKnowledgeMatch));
        assert!(recommendations[0]
            .reasons
            .contains(&RecommendationReason::CustomerRatingPriority));
        assert!(recommendations[0].score > 250);
    }

    #[test]
    fn overlapping_assignment_marks_candidate_busy() {
        let profiles = vec![profile("sp_busy", "Busy", json!({ "caddie_code": "C010" }))];
        let recommendations = recommend_caddies(
            &profiles,
            &[shift("sa_1", "sp_busy", "07:30", "12:30")],
            &[assignment("sp_busy", "08:30", "11:00")],
            &request(),
        );

        assert_eq!(recommendations[0].status, RecommendationStatus::Busy);
        assert!(recommendations[0]
            .reasons
            .contains(&RecommendationReason::OverlappingAssignment));
    }

    #[test]
    fn inactive_profile_is_not_recommended_even_with_shift() {
        let profiles = vec![inactive_profile("sp_inactive", "Inactive")];
        let recommendations = recommend_caddies(
            &profiles,
            &[shift("sa_1", "sp_inactive", "07:30", "12:30")],
            &[],
            &request(),
        );

        assert_eq!(recommendations[0].status, RecommendationStatus::Inactive);
        assert!(recommendations[0]
            .reasons
            .contains(&RecommendationReason::InactiveCaddie));
    }

    #[test]
    fn rookie_is_deterministically_lower_than_senior() {
        let profiles = vec![
            profile(
                "sp_rookie",
                "Rookie",
                json!({ "caddie_code": "C001", "rookie": true }),
            ),
            profile(
                "sp_senior",
                "Senior",
                json!({ "caddie_code": "C002", "senior": true }),
            ),
        ];
        let shifts = vec![
            shift("sa_1", "sp_rookie", "07:30", "12:30"),
            shift("sa_2", "sp_senior", "07:30", "12:30"),
        ];
        let recommendations = recommend_caddies(&profiles, &shifts, &[], &request());

        assert_eq!(recommendations[0].profile.id, "sp_senior");
        assert_eq!(recommendations[1].profile.id, "sp_rookie");
    }

    #[test]
    fn tie_break_is_shift_start_then_caddie_code_then_id() {
        let profiles = vec![
            profile("sp_b", "Beta", json!({ "caddie_code": "C002" })),
            profile("sp_a", "Alpha", json!({ "caddie_code": "C001" })),
            profile("sp_c", "Gamma", json!({ "caddie_code": "C001" })),
        ];
        let shifts = vec![
            shift("sa_1", "sp_b", "07:30", "12:30"),
            shift("sa_2", "sp_a", "07:30", "12:30"),
            shift("sa_3", "sp_c", "07:15", "12:30"),
        ];
        let recommendations = recommend_caddies(
            &profiles,
            &shifts,
            &[],
            &SmartAssignRequest {
                course_id: None,
                customer_id: None,
                ..request()
            },
        );

        let ordered_ids = recommendations
            .iter()
            .map(|item| item.profile.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ordered_ids, vec!["sp_c", "sp_a", "sp_b"]);
    }
}
