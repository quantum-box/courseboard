//! OpenAPI documentation for `/v1/course/*` HTTP surfaces.
//!
//! Served at `/openapi.json` and browsable via `/swagger-ui`.

use serde::Serialize;
use utoipa::{
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
    Modify, OpenApi, ToSchema,
};

use super::http;
use super::http_commercial;
use super::http_ops;
use super::http_simulator;
use crate::profile_proxy;

/// Standard API error body returned by [`crate::AppError`].
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub error: String,
    pub message: String,
}

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some(
                        "Bearer access token. Tenant-scoped course requests also require the `x-operator-id` header.",
                    ))
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "CourseBoard Course API",
        description = "HTTP surface for CourseBoard identity and golf course operations.",
        version = "0.1.1"
    ),
    paths(
        http::get_tee_sheet,
        http::list_courses,
        http::create_course,
        http::update_course,
        http::delete_course,
        http::list_resources,
        http::list_reservation_products,
        http::upsert_reservation_product,
        http::list_product_slots,
        http::replace_product_slots,
        http::list_caddies,
        http::list_caddie_assignments,
        http_ops::create_caddie,
        http_ops::update_caddie,
        http_ops::update_caddie_assignment,
        http_ops::list_caddie_memberships,
        http_ops::replace_caddie_memberships,
        http_ops::list_caddie_availabilities,
        http_ops::upsert_caddie_availability,
        http_ops::delete_caddie_availability,
        http_ops::list_caddie_recommendations,
        http_ops::get_attendance_snapshot,
        http_ops::get_caddie_supply,
        http_ops::auto_assign_caddies,
        http_ops::get_payroll_summary,
        http_ops::export_payroll_csv,
        http_ops::list_caddie_ratings,
        http_commercial::get_reservation_policy,
        http_commercial::update_reservation_policy,
        http_commercial::list_daily_budgets,
        http_commercial::upsert_daily_budget,
        http_commercial::import_daily_budgets_csv,
        http_commercial::list_budget_achievements,
        http_commercial::get_monthly_settlement,
        http_commercial::export_monthly_settlement_csv,
        http_commercial::get_extension_status,
        http_commercial::update_extension_config,
        http_simulator::calculate_fee,
        http_simulator::simulate_range,
        profile_proxy::get_me,
    ),
    components(
        schemas(
            ErrorBody,
            http::TeeSheetQueryParams,
            http::TeeSheetItemDto,
            http::TeeSheetResponse,
            http::CourseDto,
            http::BusinessHoursDto,
            http::UpsertCourseRequest,
            http::ResourceDto,
            http::ReservationProductDto,
            http::UpsertReservationProductRequest,
            http::ProductSlotDto,
            http::ReplaceProductSlotsRequest,
            http::CaddieDto,
            http::CaddieAssignmentDto,
            http::CaddieAssignmentQueryParams,
            http_ops::UpsertCaddieRequest,
            http_ops::PatchCaddieRequest,
            http_ops::UpsertCaddieAssignmentRequest,
            http_ops::MembershipDto,
            http_ops::ReplaceMembershipsRequest,
            http_ops::AvailabilityDto,
            http_ops::AvailabilityQueryParams,
            http_ops::UpsertAvailabilityRequest,
            http_ops::RecommendationDto,
            http_ops::RecommendationQueryParams,
            http_ops::AttendanceSnapshotDto,
            http_ops::AttendanceReportDto,
            http_ops::AttendanceQueryParams,
            http_ops::CaddieSupplyDto,
            http_ops::SupplyQueryParams,
            http_ops::AutoAssignRequest,
            http_ops::AutoAssignPlanItemDto,
            http_ops::AutoAssignSkippedDto,
            http_ops::AutoAssignResultDto,
            http_ops::PayrollPeriodDto,
            http_ops::PayrollRowDto,
            http_ops::PayrollSummaryDto,
            http_ops::YearMonthQuery,
            http_ops::RatingDto,
            http_ops::RatingsQueryParams,
            http_commercial::ReservationPolicyDto,
            http_commercial::UpdateReservationPolicyRequest,
            http_commercial::DailyBudgetDto,
            http_commercial::DailyBudgetQueryParams,
            http_commercial::UpsertDailyBudgetRequest,
            http_commercial::BudgetAchievementDto,
            http_commercial::AchievementQueryParams,
            http_commercial::MonthlySettlementDto,
            http_commercial::SettlementPeriodDto,
            http_commercial::SettlementReservationsDto,
            http_commercial::SettlementCaddieFeesDto,
            http_commercial::SettlementCancellationsDto,
            http_commercial::SettlementSquareDto,
            http_commercial::UnpaidCancellationDto,
            http_commercial::SettlementDrilldownDto,
            http_commercial::YearMonthQuery,
            http_commercial::ExtensionStatusDto,
            http_commercial::ExtensionValidationDto,
            http_commercial::UpdateExtensionConfigRequest,
            http_simulator::CalculateFeeRequest,
            http_simulator::CalculateFeeResponse,
            http_simulator::PlayerBreakdownDto,
            http_simulator::SimulateRangeRequest,
            http_simulator::SimulateRangeResponse,
            http_simulator::SimulateRangeRowDto,
            profile_proxy::ProfileResponse,
            profile_proxy::ProfileUser,
            profile_proxy::ProfileTenant,
            profile_proxy::ProfileErrorResponse,
        )
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "course", description = "Courses, tee sheet, resources, and reservation products"),
        (name = "course-ops", description = "Caddie operations, payroll, and assignments"),
        (name = "course-commercial", description = "Budgets, settlement, policy, and extension config"),
        (name = "identity", description = "Authenticated CourseBoard profile"),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub struct CourseApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use utoipa::OpenApi;

    #[test]
    fn course_openapi_includes_core_paths() {
        let doc = CourseApiDoc::openapi();
        let json = serde_json::to_value(doc).expect("serialize openapi");
        let paths = json
            .get("paths")
            .and_then(|v| v.as_object())
            .expect("paths object");
        assert!(paths.contains_key("/v1/course/tee-sheet"));
        assert!(paths.contains_key("/v1/course/courses"));
        assert!(paths.contains_key("/v1/course/caddie-profiles"));
        assert!(paths.contains_key("/v1/course/reservation-policy"));
        assert!(paths.contains_key("/v1/course/daily-budgets"));
        assert!(paths.contains_key("/v1/me"));
        let components = json
            .pointer("/components/schemas")
            .and_then(|v| v.as_object())
            .expect("schemas");
        assert!(components.contains_key("TeeSheetResponse"));
        assert!(components.contains_key("CourseDto"));
        assert!(components.contains_key("ErrorBody"));
        assert!(components.contains_key("ProfileResponse"));
        assert!(components.contains_key("ProfileErrorResponse"));
    }
}
