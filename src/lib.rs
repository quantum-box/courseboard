use std::sync::Arc;

use anyhow::Context;

mod admin_ui;
pub mod auth;
pub mod cancellation_fees;
pub mod config;
pub mod course;
pub mod demo_seed;
pub mod feature_flags;
pub mod field_api;
pub mod field_proxy;
pub mod profile_proxy;
pub mod smart_assign;

use auth::{AuthError, TokenVerifier};
use axum::{
    body::Body,
    extract::{FromRef, State},
    http::{
        header::{AUTHORIZATION, CONTENT_DISPOSITION, CONTENT_TYPE},
        HeaderName, HeaderValue, Method, Request, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use cancellation_fees::{CancellationFeeConfig, MySqlCancellationFeeRepository};
use config::RuntimeConfig;
use course::domain::{party_tax, project_row, RangeRowInput, SimulatedPlayer, TaxRuleSnapshot};
use course::infrastructure::{
    MySqlAvailabilityDeadlineRepository, MySqlCaddieShiftRepository,
    MySqlGeneratedThroughRepository, MySqlShiftRulesRepository, MySqlSlotOverrideRepository,
};
use field_api::{DynFieldApi, FieldApiClient};
use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::{migrate::Migrator, FromRow, MySqlPool};
use thiserror::Error;
use tower_http::{
    catch_panic::CatchPanicLayer,
    cors::{AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
};

use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

const COURSEBOARD_AUTHORIZATION_HEADER: &str = "x-courseboard-authorization";
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct AppState {
    rules: Arc<MySqlTaxRuleRepository>,
    cancellation_fees: Arc<MySqlCancellationFeeRepository>,
    slot_overrides: Arc<MySqlSlotOverrideRepository>,
    generated_through: Arc<MySqlGeneratedThroughRepository>,
    availability_deadlines: Arc<MySqlAvailabilityDeadlineRepository>,
    caddie_shifts: Arc<MySqlCaddieShiftRepository>,
    shift_rules: Arc<MySqlShiftRulesRepository>,
    cancellation_fee_config: CancellationFeeConfig,
    http_client: reqwest::Client,
    token_verifier: Arc<dyn TokenVerifier>,
    field_api: Option<DynFieldApi>,
    field_api_config_error: Option<String>,
    feature_flags: Arc<feature_flags::EvaluateFeatureFlags>,
    profile_client: Option<Arc<profile_proxy::ProfileClient>>,
}

impl AppState {
    pub fn new(pool: MySqlPool, token_verifier: Arc<dyn TokenVerifier>) -> Self {
        Self::new_with_cancellation_fee_config(
            pool,
            token_verifier,
            CancellationFeeConfig::default(),
        )
    }

    pub fn new_with_cancellation_fee_config(
        pool: MySqlPool,
        token_verifier: Arc<dyn TokenVerifier>,
        cancellation_fee_config: CancellationFeeConfig,
    ) -> Self {
        Self {
            rules: Arc::new(MySqlTaxRuleRepository::new(pool.clone())),
            cancellation_fees: Arc::new(MySqlCancellationFeeRepository::new(pool.clone())),
            slot_overrides: Arc::new(MySqlSlotOverrideRepository::new(pool.clone())),
            generated_through: Arc::new(MySqlGeneratedThroughRepository::new(pool.clone())),
            availability_deadlines: Arc::new(MySqlAvailabilityDeadlineRepository::new(
                pool.clone(),
            )),
            caddie_shifts: Arc::new(MySqlCaddieShiftRepository::new(pool.clone())),
            shift_rules: Arc::new(MySqlShiftRulesRepository::new(pool)),
            cancellation_fee_config,
            http_client: reqwest::Client::new(),
            token_verifier,
            field_api: None,
            field_api_config_error: Some(
                "Field API client is not configured for the admin UI".to_string(),
            ),
            feature_flags: Arc::new(feature_flags::EvaluateFeatureFlags::unavailable()),
            profile_client: None,
        }
    }

    pub fn with_field_api(
        pool: MySqlPool,
        token_verifier: Arc<dyn TokenVerifier>,
        field_api: DynFieldApi,
    ) -> Self {
        Self::with_field_api_and_cancellation_fee_config(
            pool,
            token_verifier,
            field_api,
            CancellationFeeConfig::default(),
        )
    }

    pub fn with_field_api_and_cancellation_fee_config(
        pool: MySqlPool,
        token_verifier: Arc<dyn TokenVerifier>,
        field_api: DynFieldApi,
        cancellation_fee_config: CancellationFeeConfig,
    ) -> Self {
        Self {
            rules: Arc::new(MySqlTaxRuleRepository::new(pool.clone())),
            cancellation_fees: Arc::new(MySqlCancellationFeeRepository::new(pool.clone())),
            slot_overrides: Arc::new(MySqlSlotOverrideRepository::new(pool.clone())),
            generated_through: Arc::new(MySqlGeneratedThroughRepository::new(pool.clone())),
            availability_deadlines: Arc::new(MySqlAvailabilityDeadlineRepository::new(
                pool.clone(),
            )),
            caddie_shifts: Arc::new(MySqlCaddieShiftRepository::new(pool.clone())),
            shift_rules: Arc::new(MySqlShiftRulesRepository::new(pool)),
            cancellation_fee_config,
            http_client: reqwest::Client::new(),
            token_verifier,
            field_api: Some(field_api),
            field_api_config_error: None,
            feature_flags: Arc::new(feature_flags::EvaluateFeatureFlags::unavailable()),
            profile_client: None,
        }
    }

    fn with_optional_field_api(
        pool: MySqlPool,
        token_verifier: Arc<dyn TokenVerifier>,
        field_api: Result<FieldApiClient, field_api::FieldApiConfigError>,
        cancellation_fee_config: CancellationFeeConfig,
    ) -> Self {
        match field_api {
            Ok(client) => Self {
                rules: Arc::new(MySqlTaxRuleRepository::new(pool.clone())),
                cancellation_fees: Arc::new(MySqlCancellationFeeRepository::new(pool.clone())),
                slot_overrides: Arc::new(MySqlSlotOverrideRepository::new(pool.clone())),
                generated_through: Arc::new(MySqlGeneratedThroughRepository::new(pool.clone())),
                availability_deadlines: Arc::new(MySqlAvailabilityDeadlineRepository::new(
                    pool.clone(),
                )),
                caddie_shifts: Arc::new(MySqlCaddieShiftRepository::new(pool.clone())),
                shift_rules: Arc::new(MySqlShiftRulesRepository::new(pool)),
                cancellation_fee_config,
                http_client: reqwest::Client::new(),
                token_verifier,
                field_api: Some(Arc::new(client)),
                field_api_config_error: None,
                feature_flags: Arc::new(feature_flags::EvaluateFeatureFlags::unavailable()),
                profile_client: None,
            },
            Err(error) => Self {
                rules: Arc::new(MySqlTaxRuleRepository::new(pool.clone())),
                cancellation_fees: Arc::new(MySqlCancellationFeeRepository::new(pool.clone())),
                slot_overrides: Arc::new(MySqlSlotOverrideRepository::new(pool.clone())),
                generated_through: Arc::new(MySqlGeneratedThroughRepository::new(pool.clone())),
                availability_deadlines: Arc::new(MySqlAvailabilityDeadlineRepository::new(
                    pool.clone(),
                )),
                caddie_shifts: Arc::new(MySqlCaddieShiftRepository::new(pool.clone())),
                shift_rules: Arc::new(MySqlShiftRulesRepository::new(pool)),
                cancellation_fee_config,
                http_client: reqwest::Client::new(),
                token_verifier,
                field_api: None,
                field_api_config_error: Some(error.to_string()),
                feature_flags: Arc::new(feature_flags::EvaluateFeatureFlags::unavailable()),
                profile_client: None,
            },
        }
    }

    /// CourseBoard-owned golf tax rules, for the simulator gateway.
    pub fn tax_rules(&self) -> Arc<MySqlTaxRuleRepository> {
        self.rules.clone()
    }

    /// CourseBoard-owned desk marks on individual tee times.
    pub fn slot_overrides(&self) -> Arc<MySqlSlotOverrideRepository> {
        self.slot_overrides.clone()
    }

    /// CourseBoard-owned record of how far each course has been built.
    pub fn generated_through(&self) -> Arc<MySqlGeneratedThroughRepository> {
        self.generated_through.clone()
    }

    /// CourseBoard-owned shift-request filing deadlines.
    pub fn availability_deadlines(&self) -> Arc<MySqlAvailabilityDeadlineRepository> {
        self.availability_deadlines.clone()
    }

    /// CourseBoard-owned confirmed shifts, including which course each caddie
    /// works. Field holds the request; the placement is ours (ADR-0005).
    pub fn caddie_shifts(&self) -> Arc<MySqlCaddieShiftRepository> {
        self.caddie_shifts.clone()
    }

    /// CourseBoard-owned shift-planning rules: which weekdays the club keeps
    /// clear of rest days.
    pub fn shift_rules(&self) -> Arc<MySqlShiftRulesRepository> {
        self.shift_rules.clone()
    }

    pub(crate) fn feature_flags(&self) -> Arc<feature_flags::EvaluateFeatureFlags> {
        self.feature_flags.clone()
    }

    fn with_feature_flag_evaluator(
        mut self,
        evaluator: Arc<dyn feature_flags::FeatureFlagEvaluator>,
    ) -> Self {
        self.feature_flags = Arc::new(feature_flags::EvaluateFeatureFlags::new(evaluator));
        self
    }

    fn with_profile_client(mut self, profile_client: Option<profile_proxy::ProfileClient>) -> Self {
        self.profile_client = profile_client.map(Arc::new);
        self
    }
}

impl FromRef<AppState> for Arc<MySqlTaxRuleRepository> {
    fn from_ref(state: &AppState) -> Self {
        state.rules.clone()
    }
}

impl FromRef<AppState> for Arc<dyn TokenVerifier> {
    fn from_ref(state: &AppState) -> Self {
        state.token_verifier.clone()
    }
}

impl FromRef<AppState> for Arc<MySqlCancellationFeeRepository> {
    fn from_ref(state: &AppState) -> Self {
        state.cancellation_fees.clone()
    }
}

impl FromRef<AppState> for CancellationFeeConfig {
    fn from_ref(state: &AppState) -> Self {
        state.cancellation_fee_config.clone()
    }
}

impl FromRef<AppState> for reqwest::Client {
    fn from_ref(state: &AppState) -> Self {
        state.http_client.clone()
    }
}

impl FromRef<AppState> for Arc<profile_proxy::ProfileClient> {
    fn from_ref(state: &AppState) -> Self {
        state
            .profile_client
            .clone()
            .expect("profile route must only be registered with a configured profile client")
    }
}

pub fn build_router(state: AppState) -> Router {
    let auth_state = state.clone();
    let admin_auth_state = state.clone();
    let collection_auth_state = state.clone();
    let mut router = Router::new()
        .route("/", get(redirect_ui))
        .nest_service(
            "/ui",
            ServeDir::new("ui").not_found_service(ServeFile::new("ui/index.html")),
        )
        .merge(SwaggerUi::new("/swagger-ui").url(
            "/openapi.json",
            course::interfaces::openapi::CourseApiDoc::openapi(),
        ))
        .route("/healthz", get(healthz))
        .route(
            "/admin",
            get(admin_ui::redirect_admin).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/caddies",
            get(admin_ui::caddies_index)
                .post(admin_ui::create_caddie)
                .route_layer(middleware::from_fn_with_state(
                    admin_auth_state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/admin/caddies/:id",
            post(admin_ui::update_caddie).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/shifts",
            post(admin_ui::create_shift).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/shifts/:id",
            post(admin_ui::update_shift).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/shifts/:id/cancel",
            post(admin_ui::cancel_shift).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/reservations",
            get(admin_ui::reservations_index).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/dispatch",
            get(admin_ui::dispatch_index).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/reservations/:reservation_id/assign",
            post(admin_ui::assign_reservation_caddie).route_layer(middleware::from_fn_with_state(
                admin_auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/admin/reservations/:reservation_id/unassign",
            post(admin_ui::unassign_reservation_caddie).route_layer(
                middleware::from_fn_with_state(admin_auth_state, require_valid_token),
            ),
        )
        .route(
            "/calculate",
            post(calculate).route_layer(middleware::from_fn_with_state(
                auth_state.clone(),
                require_valid_token,
            )),
        )
        .route(
            "/simulate/range",
            post(simulate_range).route_layer(middleware::from_fn_with_state(
                auth_state,
                require_valid_token,
            )),
        )
        .route(
            "/cancellation-fee-collections",
            post(cancellation_fees::create_collection).route_layer(middleware::from_fn_with_state(
                collection_auth_state,
                require_valid_token,
            )),
        )
        .route(
            "/v1/course/tee-sheet",
            get(course::interfaces::http::get_tee_sheet).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/tee-ledger",
            get(course::interfaces::http::get_tee_ledger).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservations",
            post(course::interfaces::http::create_reservation).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/customers",
            get(course::interfaces::http_customers::search_customers)
                .post(course::interfaces::http_customers::create_customer)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/customers/:customer_id",
            get(course::interfaces::http_customers::get_customer).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/customers/:customer_id/membership",
            get(course::interfaces::http_customers::get_customer_membership)
                .post(course::interfaces::http_customers::assign_membership_plan)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/membership-plans",
            get(course::interfaces::http_customers::list_membership_plans)
                .post(course::interfaces::http_customers::create_membership_plan)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/membership-plans/:plan_id",
            patch(course::interfaces::http_customers::update_membership_plan).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservations/:reservation_id/cancel",
            post(course::interfaces::http::cancel_reservation).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservations/:reservation_id/party",
            patch(course::interfaces::http::update_reservation_party).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservations/:reservation_id/plan",
            patch(course::interfaces::http::change_reservation_plan).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/demo-seed",
            post(course::interfaces::http::seed_demo_board).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/course-order",
            get(course::interfaces::http::get_course_order)
                .put(course::interfaces::http::replace_course_order)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/slot-overrides",
            get(course::interfaces::http::list_slot_overrides)
                .put(course::interfaces::http::upsert_slot_overrides)
                .delete(course::interfaces::http::delete_slot_overrides)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/courses",
            get(course::interfaces::http::list_courses)
                .post(course::interfaces::http::create_course)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/courses/:id",
            patch(course::interfaces::http::update_course)
                .delete(course::interfaces::http::delete_course)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/courses/:id/schedule",
            get(course::interfaces::http::get_course_schedule)
                .put(course::interfaces::http::replace_course_schedule)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/courses/:id/resource",
            post(course::interfaces::http::link_course_resource).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/courses/:id/time-slots/generate",
            post(course::interfaces::http::generate_course_time_slots).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/booking-horizon",
            get(course::interfaces::http::get_booking_horizon)
                .put(course::interfaces::http::set_booking_horizon)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/resources",
            get(course::interfaces::http::list_resources).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservation-products",
            get(course::interfaces::http::list_reservation_products).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservation-products/:service_id",
            post(course::interfaces::http::upsert_reservation_product).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservation-products/:service_id/slots",
            get(course::interfaces::http::list_product_slots)
                .put(course::interfaces::http::replace_product_slots)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-profiles",
            get(course::interfaces::http::list_caddies)
                .post(course::interfaces::http_ops::create_caddie)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-profiles/:id",
            patch(course::interfaces::http_ops::update_caddie).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-profiles/:id/courses",
            get(course::interfaces::http_ops::list_caddie_memberships)
                .put(course::interfaces::http_ops::replace_caddie_memberships)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-assignments",
            get(course::interfaces::http::list_caddie_assignments)
                .post(course::interfaces::http_ops::create_caddie_assignment)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-assignments/:id",
            patch(course::interfaces::http_ops::update_caddie_assignment).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-availabilities",
            get(course::interfaces::http_ops::list_caddie_availabilities)
                .post(course::interfaces::http_ops::upsert_caddie_availability)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-availabilities/:caddie_id/:date",
            delete(course::interfaces::http_ops::delete_caddie_availability).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-recommendations",
            get(course::interfaces::http_ops::list_caddie_recommendations).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-attendance-snapshot",
            get(course::interfaces::http_ops::get_attendance_snapshot).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-attendance-snapshots",
            get(course::interfaces::http_ops::list_attendance_period_snapshots).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-supply",
            get(course::interfaces::http_ops::get_caddie_supply).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-auto-assignments",
            post(course::interfaces::http_ops::auto_assign_caddies).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-course-supply",
            get(course::interfaces::http_ops::get_course_caddie_supply).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-reinforcements",
            get(course::interfaces::http_ops::list_caddie_reinforcements).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-shift-rules",
            get(course::interfaces::http_ops::get_shift_rules)
                .put(course::interfaces::http_ops::update_shift_rules)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-shifts",
            get(course::interfaces::http_ops::list_caddie_shifts).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-shifts/:caddie_profile_id/:date",
            put(course::interfaces::http_ops::update_caddie_shift).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-shift-plans/:year_month",
            post(course::interfaces::http_ops::generate_caddie_shifts).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-availability-deadlines/:year_month",
            get(course::interfaces::http_ops::get_availability_deadline)
                .put(course::interfaces::http_ops::upsert_availability_deadline)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-availability-submissions/:year_month",
            get(course::interfaces::http_ops::list_unsubmitted_caddies).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-rank-fees",
            get(course::interfaces::http_ops::get_caddie_rank_fees)
                .put(course::interfaces::http_ops::replace_caddie_rank_fees)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/caddie-payroll-summary",
            get(course::interfaces::http_ops::get_payroll_summary).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-payroll-summary/export.csv",
            get(course::interfaces::http_ops::export_payroll_csv).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/caddie-ratings",
            get(course::interfaces::http_ops::list_caddie_ratings).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/reservation-policy",
            get(course::interfaces::http_commercial::get_reservation_policy)
                .patch(course::interfaces::http_commercial::update_reservation_policy)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/daily-budgets/achievement",
            get(course::interfaces::http_commercial::list_budget_achievements).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/daily-budgets/import",
            post(course::interfaces::http_commercial::import_daily_budgets_csv).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/daily-budgets",
            get(course::interfaces::http_commercial::list_daily_budgets)
                .post(course::interfaces::http_commercial::upsert_daily_budget)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/v1/course/monthly-settlement",
            get(course::interfaces::http_commercial::get_monthly_settlement).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/monthly-settlement/export.csv",
            get(course::interfaces::http_commercial::export_monthly_settlement_csv).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/simulator/calculate",
            post(course::interfaces::http_simulator::calculate_fee).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/simulator/simulate/range",
            post(course::interfaces::http_simulator::simulate_range).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/extension-status",
            get(course::interfaces::http_commercial::get_extension_status).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/config",
            patch(course::interfaces::http_commercial::update_extension_config).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/v1/course/feature-flags/evaluate",
            post(feature_flags::evaluate_feature_flags).route_layer(
                middleware::from_fn_with_state(state.clone(), require_valid_token),
            ),
        )
        .route(
            "/field-api/*path",
            get(field_proxy::proxy_field_api)
                .post(field_proxy::proxy_field_api)
                .patch(field_proxy::proxy_field_api)
                .put(field_proxy::proxy_field_api)
                .delete(field_proxy::proxy_field_api)
                .route_layer(middleware::from_fn_with_state(
                    state.clone(),
                    require_valid_token,
                )),
        )
        .route(
            "/public/cancellation-fees/:token",
            get(cancellation_fees::get_public_collection),
        )
        .route(
            "/public/cancellation-fees/:token/stripe-payment-intent",
            post(cancellation_fees::create_stripe_payment_intent),
        )
        .route(
            "/public/cancellation-fees/:token/confirm",
            post(cancellation_fees::confirm_stripe_payment),
        );
    if state.profile_client.is_some() {
        router = router.route(
            "/v1/me",
            get(profile_proxy::get_me).route_layer(middleware::from_fn_with_state(
                state.clone(),
                require_valid_token,
            )),
        );
    }
    router
        .with_state(state)
        // Inside the CORS layer on purpose: a panic response still needs the
        // CORS headers, otherwise the browser reports an opaque network error
        // ("Failed to fetch") instead of the 500 we just produced.
        .layer(CatchPanicLayer::custom(panic_response))
        .layer(courseboard_cors_layer())
}

/// Without this a panic drops the connection with no status and no CORS
/// headers, which reaches the operator UI as an untranslatable network error.
fn panic_response(panic: Box<dyn std::any::Any + Send + 'static>) -> Response {
    let detail = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&'static str>().copied())
        .unwrap_or("unknown panic");
    tracing::error!(panic = detail, "request handler panicked");

    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "internal_server_error",
            message: "internal server error".to_string(),
        }),
    )
        .into_response()
}

/// The origins that are always allowed, whatever the deployment.
const STATIC_ALLOWED_ORIGINS: [&str; 6] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://courseboard.txcloud.app",
];

/// A pull request's own preview front end, `https://pr123--courseboard.txcloud.app`.
///
/// Without this the preview environment cannot be used at all: the React app is
/// served from the PR's own host, every call to the PR's own API is blocked by
/// CORS, and the login screen answers "Failed to fetch" before anyone reaches a
/// password. Verifying a change before it reaches production was impossible.
///
/// The match is deliberately exact rather than a suffix test. A suffix test
/// would also admit `https://evil-courseboard.txcloud.app`.
fn is_preview_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("https://pr") else {
        return false;
    };
    let Some((number, host)) = rest.split_once("--") else {
        return false;
    };
    host == "courseboard.txcloud.app"
        && !number.is_empty()
        && number.chars().all(|character| character.is_ascii_digit())
}

fn courseboard_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _request| {
            origin.to_str().is_ok_and(|origin| {
                STATIC_ALLOWED_ORIGINS.contains(&origin) || is_preview_origin(origin)
            })
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            AUTHORIZATION,
            CONTENT_TYPE,
            HeaderName::from_static(COURSEBOARD_AUTHORIZATION_HEADER),
            HeaderName::from_static("x-operator-id"),
            HeaderName::from_static("x-platform-id"),
            HeaderName::from_static("idempotency-key"),
        ])
        .expose_headers([
            CONTENT_DISPOSITION,
            CONTENT_TYPE,
            HeaderName::from_static("x-courseboard-auth-error"),
            HeaderName::from_static("x-courseboard-auth-denial"),
        ])
}

pub async fn build_app(config: RuntimeConfig) -> anyhow::Result<Router> {
    let database_url = config.database_url.clone();
    let connect_options: MySqlConnectOptions = database_url
        .parse()
        .map_err(|error| anyhow::anyhow!("DATABASE_URL must be a valid MySQL URL: {error}"))?;
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await?;

    run_migrations(&pool).await?;

    let course_gateway_url = config.course_gateway_base_url();
    if course_gateway_url == crate::config::EMPTY_COURSE_STORE_URL
        || course_gateway_url.starts_with("empty://")
    {
        tracing::warn!(
            %course_gateway_url,
            "course gateway using empty store opt-out (list GETs return empty items). \
             Normal local starts should use production Field or an explicit Field URL"
        );
    } else {
        tracing::info!(%course_gateway_url, "course gateway Field URL");
    }

    let token_verifier: Arc<dyn TokenVerifier> = if let Some(token) = config.dev_bearer_token() {
        tracing::warn!("using COURSEBOARD_DEV_BEARER_TOKEN static verifier for local development");
        Arc::new(auth::StaticBearerVerifier::new(token))
    } else {
        let auth_config = config.auth_config().context(
            "auth configuration is incomplete. For local development, set \
             COURSEBOARD_DEV_BEARER_TOKEN to use the static dev bypass; otherwise \
             configure OIDC_ISSUER_URL (or TACHYON_AUTH_ISSUER_URL) and EXPECTED_AUDIENCE",
        )?;
        Arc::new(auth::OidcJwtVerifier::discover(auth_config).await?)
    };
    let cancellation_fee_config = config.cancellation_fee_config();
    let tachyon_api_url = config.tachyon_api_base_url();
    let profile_client = profile_proxy::ProfileClient::from_field_api_url(
        &course_gateway_url,
        Some(&tachyon_api_url),
    )
    .context("courseboard profile proxy configuration is invalid")?;
    let field_api = FieldApiClient::from_config(
        config.field_api_base_url(),
        config.field_api_client_credentials_config(),
        config.field_api_bearer_token(),
    );
    let state =
        AppState::with_optional_field_api(pool, token_verifier, field_api, cancellation_fee_config)
            .with_feature_flag_evaluator(Arc::new(feature_flags::TachyonFeatureFlagEvaluator::new(
                &tachyon_api_url,
            )))
            .with_profile_client(profile_client);

    Ok(build_router(state))
}

pub async fn run_migrations(pool: &MySqlPool) -> Result<(), AppError> {
    MIGRATOR.run(pool).await?;
    Ok(())
}

async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn redirect_ui() -> Redirect {
    Redirect::temporary("/ui/")
}

async fn require_valid_token(
    State(verifier): State<Arc<dyn TokenVerifier>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let Some(value) = req.headers().get(AUTHORIZATION).or_else(|| {
        req.headers()
            .get(HeaderName::from_static(COURSEBOARD_AUTHORIZATION_HEADER))
    }) else {
        return Err(AppError::Unauthorized);
    };
    let Ok(value) = value.to_str() else {
        return Err(AppError::Unauthorized);
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return Err(AppError::Unauthorized);
    };
    if token.trim().is_empty() {
        return Err(AppError::Unauthorized);
    }
    if let Err(error) = verifier.verify(token) {
        tracing::warn!(error = %error, "bearer token verification failed");
        let category = HeaderValue::from_static(error.category());
        let mut response = AppError::from(error).into_response();
        response.headers_mut().insert(
            HeaderName::from_static("x-courseboard-auth-error"),
            category,
        );
        return Ok(response);
    }

    Ok(next.run(req).await)
}

async fn calculate(
    State(rules): State<Arc<MySqlTaxRuleRepository>>,
    Json(request): Json<CalculateRequest>,
) -> Result<Json<CalculateResponse>, AppError> {
    if request.players.is_empty() {
        return Err(AppError::BadRequest(
            "players must contain at least one player",
        ));
    }

    let rule = match request.course_grade.as_deref().map(str::trim) {
        Some(grade) if !grade.is_empty() => {
            rules
                .find_rule_by_grade(&request.tenant_id, &request.prefecture, grade)
                .await?
        }
        _ => {
            rules
                .find_rule_by_green_fee(&request.tenant_id, &request.prefecture, request.green_fee)
                .await?
        }
    }
    .ok_or(AppError::RuleNotFound)?;

    let players: Vec<SimulatedPlayer> = request
        .players
        .iter()
        .map(|player| SimulatedPlayer {
            age: player.age,
            has_disability_cert: player.has_disability_cert,
        })
        .collect();
    let tax = party_tax(&rule, &players);

    Ok(Json(CalculateResponse {
        course_grade: tax.course_grade().to_string(),
        tax_amount: tax.tax_amount(),
        breakdown: tax
            .lines()
            .iter()
            .map(|line| PlayerBreakdown {
                player_index: line.player_index(),
                fee: line.fee(),
                exempt: line.exempt(),
                reason: line.reason().map(str::to_string),
            })
            .collect(),
    }))
}

async fn simulate_range(
    State(rules): State<Arc<MySqlTaxRuleRepository>>,
    Json(request): Json<SimulateRangeRequest>,
) -> Result<Json<SimulateRangeResponse>, AppError> {
    request.validate()?;

    let mut rows = Vec::new();
    let mut green_fee = request.green_fee_range.min;
    while green_fee <= request.green_fee_range.max {
        let rule = rules
            .find_rule_by_green_fee(&request.tenant_id, &request.prefecture, green_fee)
            .await?
            .ok_or(AppError::RuleNotFound)?;
        let row = project_row(
            &RangeRowInput {
                green_fee,
                base_visitors: request.base_visitors,
                base_green_fee: request.base_green_fee,
                price_elasticity: request.price_elasticity,
                taxable_ratio: request.taxable_ratio,
                fixed_cost: request.fixed_cost,
                variable_cost_per_visitor: request.variable_cost_per_visitor,
            },
            &rule,
        );

        rows.push(SimulateRangeRow {
            green_fee: row.green_fee(),
            course_grade: row.course_grade().to_string(),
            visitors: row.visitors(),
            taxable_visitors: row.taxable_visitors(),
            revenue: row.revenue(),
            tax_total: row.tax_total(),
            variable_cost: row.variable_cost(),
            fixed_cost: row.fixed_cost(),
            profit: row.profit(),
            profit_margin_pct: row.profit_margin_pct(),
        });

        green_fee += request.green_fee_range.step;
    }

    Ok(Json(SimulateRangeResponse { rows }))
}

#[derive(Clone)]
pub struct MySqlTaxRuleRepository {
    pool: MySqlPool,
}

/// Tenant id the shared, prefecture-wide rate schedule is stored under.
///
/// A sentinel rather than NULL: MySQL treats NULLs in a UNIQUE key as distinct,
/// so a nullable column would let duplicate shared rows in.
pub const SHARED_TAX_SCOPE: &str = "*";

impl MySqlTaxRuleRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    /// Resolve the tax rule whose green-fee bracket contains `green_fee`.
    ///
    /// Returns the domain snapshot: golf pricing rules are interpreted by
    /// `course::domain::simulator`, not by this repository.
    pub async fn find_rule_by_green_fee(
        &self,
        tenant_id: &str,
        prefecture: &str,
        green_fee: i64,
    ) -> Result<Option<TaxRuleSnapshot>, AppError> {
        // The rate schedule is prefectural law, held once under the shared
        // scope; a tenant row is an override for a course that genuinely
        // differs. Both halves of the join resolve within the same scope, so a
        // tenant's own thresholds never pick a grade out of the shared
        // schedule, or the other way round.
        let rule = sqlx::query_as::<_, TaxRule>(
            r#"
            SELECT
                r.course_grade,
                r.fee,
                r.minor_exempt_under_age,
                r.senior_exempt_min_age,
                r.disability_cert_exempt,
                r.senior_reduced_min_age,
                r.senior_reduced_percent
            FROM golf_grade_thresholds t
            JOIN golf_tax_rules r
              ON r.tenant_id = t.tenant_id
             AND r.prefecture = t.prefecture
             AND r.course_grade = t.course_grade
            WHERE t.tenant_id IN (?, ?)
              AND t.prefecture = ?
              AND t.min_green_fee <= ?
              AND (t.max_green_fee IS NULL OR ? < t.max_green_fee)
            ORDER BY t.tenant_id = ? DESC, t.min_green_fee DESC
            LIMIT 1
            "#,
        )
        .bind(tenant_id)
        .bind(SHARED_TAX_SCOPE)
        .bind(prefecture)
        .bind(green_fee)
        .bind(green_fee)
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(rule.map(TaxRuleSnapshot::from))
    }

    /// Resolve the rule for a grade the prefecture assigned.
    ///
    /// A tenant row wins over the shared schedule, same as the green-fee
    /// lookup. No grade thresholds are involved: the caller already knows which
    /// grade the course is in.
    pub async fn find_rule_by_grade(
        &self,
        tenant_id: &str,
        prefecture: &str,
        course_grade: &str,
    ) -> Result<Option<TaxRuleSnapshot>, AppError> {
        let rule = sqlx::query_as::<_, TaxRule>(
            r#"
            SELECT
                course_grade,
                fee,
                minor_exempt_under_age,
                senior_exempt_min_age,
                disability_cert_exempt,
                senior_reduced_min_age,
                senior_reduced_percent
            FROM golf_tax_rules
            WHERE tenant_id IN (?, ?)
              AND prefecture = ?
              AND course_grade = ?
            ORDER BY tenant_id = ? DESC, effective_from DESC
            LIMIT 1
            "#,
        )
        .bind(tenant_id)
        .bind(SHARED_TAX_SCOPE)
        .bind(prefecture)
        .bind(course_grade)
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(rule.map(TaxRuleSnapshot::from))
    }
}

#[derive(Debug, FromRow)]
struct TaxRule {
    course_grade: String,
    fee: i64,
    minor_exempt_under_age: i64,
    senior_exempt_min_age: i64,
    disability_cert_exempt: bool,
    senior_reduced_min_age: Option<i64>,
    senior_reduced_percent: Option<i64>,
}

impl From<TaxRule> for TaxRuleSnapshot {
    fn from(row: TaxRule) -> Self {
        Self {
            course_grade: row.course_grade,
            fee: row.fee,
            minor_exempt_under_age: row.minor_exempt_under_age,
            senior_exempt_min_age: row.senior_exempt_min_age,
            disability_cert_exempt: row.disability_cert_exempt,
            senior_reduced_min_age: row.senior_reduced_min_age,
            senior_reduced_percent: row.senior_reduced_percent,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CalculateRequest {
    pub tenant_id: String,
    pub prefecture: String,
    pub green_fee: i64,
    /// The grade the prefecture assigned this course. Given, it decides the
    /// rate; omitted, the green fee's bracket stands in for it.
    ///
    /// Only the shared, prefecture-wide schedule is seeded, and it has no
    /// brackets — which grade a course sits in is the prefecture's decision,
    /// not something the fee implies. So without this the lookup finds nothing
    /// and every age-aware quote answers 404, including the reduced band for
    /// players between 65 and the exemption at 70.
    #[serde(default)]
    pub course_grade: Option<String>,
    pub players: Vec<Player>,
}

#[derive(Debug, Deserialize)]
pub struct Player {
    pub age: i64,
    pub has_disability_cert: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CalculateResponse {
    pub course_grade: String,
    pub tax_amount: i64,
    pub breakdown: Vec<PlayerBreakdown>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlayerBreakdown {
    pub player_index: usize,
    pub fee: i64,
    pub exempt: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SimulateRangeRequest {
    pub tenant_id: String,
    pub prefecture: String,
    pub green_fee_range: GreenFeeRange,
    pub base_visitors: i64,
    pub base_green_fee: i64,
    pub price_elasticity: f64,
    pub taxable_ratio: f64,
    pub fixed_cost: i64,
    pub variable_cost_per_visitor: i64,
}

impl SimulateRangeRequest {
    fn validate(&self) -> Result<(), AppError> {
        if self.green_fee_range.min < 0 {
            return Err(AppError::BadRequest(
                "green_fee_range.min must be non-negative",
            ));
        }
        if self.green_fee_range.max < self.green_fee_range.min {
            return Err(AppError::BadRequest(
                "green_fee_range.max must be greater than or equal to min",
            ));
        }
        if self.green_fee_range.step <= 0 {
            return Err(AppError::BadRequest(
                "green_fee_range.step must be positive",
            ));
        }
        if self.base_visitors < 0 {
            return Err(AppError::BadRequest("base_visitors must be non-negative"));
        }
        if self.base_green_fee <= 0 {
            return Err(AppError::BadRequest("base_green_fee must be positive"));
        }
        if !(0.0..=1.0).contains(&self.taxable_ratio) {
            return Err(AppError::BadRequest(
                "taxable_ratio must be between 0 and 1",
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct GreenFeeRange {
    pub min: i64,
    pub max: i64,
    pub step: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SimulateRangeResponse {
    pub rows: Vec<SimulateRangeRow>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SimulateRangeRow {
    pub green_fee: i64,
    pub course_grade: String,
    pub visitors: i64,
    pub taxable_visitors: i64,
    pub revenue: i64,
    pub tax_total: i64,
    pub variable_cost: i64,
    pub fixed_cost: i64,
    pub profit: i64,
    pub profit_margin_pct: f64,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: &'static str,
    message: String,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("authorization failed")]
    Unauthorized,
    #[error("authenticated client is not authorized")]
    Forbidden,
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("{0}")]
    Conflict(&'static str),
    #[error("{message}")]
    UpstreamClient { status: StatusCode, message: String },
    #[error("tax rule was not found for tenant, prefecture, and green fee")]
    RuleNotFound,
    #[error("{0}")]
    NotFound(&'static str),
    #[error("external provider error: {0}")]
    Provider(String),
    #[error("database error")]
    Database(#[from] sqlx::Error),
    #[error("migration error")]
    Migration(#[from] sqlx::migrate::MigrateError),
}

impl From<AuthError> for AppError {
    fn from(value: AuthError) -> Self {
        match value {
            AuthError::UnauthorizedClient => AppError::Forbidden,
            AuthError::MissingToken
            | AuthError::MalformedToken
            | AuthError::MissingKeyId
            | AuthError::UnknownKeyId
            | AuthError::InvalidToken
            | AuthError::InvalidIssuedAt => AppError::Unauthorized,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            AppError::UpstreamClient { status, .. } => (status, "upstream_client_error"),
            AppError::RuleNotFound => (StatusCode::NOT_FOUND, "rule_not_found"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            // Cloudflare swaps origin 5xx bodies for its own CORS-less error
            // page, so use 424 and keep the browser from seeing only an opaque
            // "Failed to fetch".
            AppError::Provider(_) => (StatusCode::FAILED_DEPENDENCY, "provider_error"),
            AppError::Database(_) | AppError::Migration(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_server_error")
            }
        };

        let body = Json(ErrorResponse {
            error,
            message: self.to_string(),
        });
        (status, body).into_response()
    }
}

/// Shared test database setup.
///
/// Both the router tests and the repository tests need the same migrated
/// database; duplicating the connect-and-migrate dance would let the two drift
/// onto different schemas.
#[cfg(test)]
pub(crate) mod test_support {
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
    use sqlx::MySqlPool;
    use std::time::Duration;
    use tokio::sync::Mutex;

    /// Whether this process has already brought the schema up to date.
    ///
    /// The migrator is idempotent but not contention-free: several dozen tests
    /// running it at once against TiDB ends in "pessimistic lock retry limit
    /// reached", and the test that happens to lose looks broken. A mutex is safe
    /// to hold across tests in a way a connection pool is not — it owns no
    /// runtime-bound resource, so a test runtime shutting down simply releases
    /// it.
    static MIGRATED: Mutex<bool> = Mutex::const_new(false);

    /// A pool for one test.
    ///
    /// Deliberately per-test rather than shared: `#[tokio::test]` builds a
    /// runtime per test and drops it at the end, so a pool cached across tests
    /// ends up holding connections owned by a runtime that has shut down, and
    /// every later test fails with "a Tokio 1.x context ... is being shutdown".
    ///
    /// Kept small for the same reason the tests are cheap to run: several dozen
    /// of these exist at once, and a large pool each exhausts the database's
    /// connection budget before the suite finishes.
    pub(crate) async fn test_pool() -> MySqlPool {
        let host =
            std::env::var("COURSEBOARD_TEST_DB_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = std::env::var("COURSEBOARD_TEST_DB_PORT")
            .map(|value| {
                value
                    .parse()
                    .expect("COURSEBOARD_TEST_DB_PORT must be a u16")
            })
            .unwrap_or(4000);
        let username =
            std::env::var("COURSEBOARD_TEST_DB_USER").unwrap_or_else(|_| "root".to_string());
        let database = std::env::var("COURSEBOARD_TEST_DB_NAME")
            .unwrap_or_else(|_| "courseboard_test".to_string());
        assert!(
            database
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_'),
            "COURSEBOARD_TEST_DB_NAME must contain only ASCII letters, digits, and underscores"
        );

        let mut connect_options = MySqlConnectOptions::new()
            .host(&host)
            .port(port)
            .username(&username);
        if let Ok(password) = std::env::var("COURSEBOARD_TEST_DB_PASSWORD") {
            connect_options = connect_options.password(&password);
        }

        let admin_pool = MySqlPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(60))
            .connect_with(connect_options.clone())
            .await
            .expect("connect test TiDB admin pool");
        sqlx::query(&format!(
            "CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        ))
        .execute(&admin_pool)
        .await
        .expect("create test TiDB database");
        admin_pool.close().await;

        let pool = MySqlPoolOptions::new()
            .max_connections(2)
            .acquire_timeout(Duration::from_secs(60))
            .connect_with(connect_options.database(&database))
            .await
            .expect("connect test TiDB database");
        let mut migrated = MIGRATED.lock().await;
        if !*migrated {
            super::run_migrations(&pool).await.expect("run migrations");
            *migrated = true;
        }
        pool
    }

    /// A tenant id unique to this test process.
    ///
    /// The test database outlives any one run: CI reuses a service container, a
    /// developer keeps one up for days, and a killed run can leave a binary
    /// still writing to it. Rows keyed by a fixed tenant let two runs delete
    /// each other's data, which surfaces as a test that fails only sometimes —
    /// the worst kind to chase.
    pub(crate) fn test_tenant(name: &str) -> String {
        format!("t{}-{name}", std::process::id())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{AuthConfig, Jwk, Jwks, OidcJwtVerifier};
    use axum::{
        http::{header::CONTENT_TYPE, HeaderMap, Method},
        routing::{get, post},
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use http_body_util::BodyExt;
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    use rand::rngs::OsRng;
    use rsa::{pkcs1::EncodeRsaPrivateKey, traits::PublicKeyParts, RsaPrivateKey};
    use std::collections::HashSet;
    use tower::ServiceExt;

    #[tokio::test]
    async fn cors_allows_the_production_react_app() {
        let app = Router::new()
            .route("/health", get(|| async { StatusCode::OK }))
            .layer(courseboard_cors_layer());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/health")
                    .header("origin", "https://courseboard.txcloud.app")
                    .header("access-control-request-method", "GET")
                    .header(
                        "access-control-request-headers",
                        "authorization,x-operator-id,x-platform-id",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("access-control-allow-origin"),
            Some(&HeaderValue::from_static("https://courseboard.txcloud.app"))
        );
    }

    #[tokio::test]
    async fn cors_allows_a_pull_requests_own_preview_front_end() {
        let app = Router::new()
            .route("/health", get(|| async { StatusCode::OK }))
            .layer(courseboard_cors_layer());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/health")
                    .header("origin", "https://pr151--courseboard.txcloud.app")
                    .header("access-control-request-method", "GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("access-control-allow-origin"),
            Some(&HeaderValue::from_static(
                "https://pr151--courseboard.txcloud.app"
            ))
        );
    }

    #[test]
    fn only_a_numbered_preview_of_this_app_counts_as_a_preview_origin() {
        assert!(is_preview_origin("https://pr1--courseboard.txcloud.app"));
        assert!(is_preview_origin("https://pr151--courseboard.txcloud.app"));

        // A look-alike host must not be admitted by a loose suffix match.
        assert!(!is_preview_origin("https://evil-courseboard.txcloud.app"));
        assert!(!is_preview_origin(
            "https://pr151--courseboard.txcloud.app.evil.example"
        ));
        assert!(!is_preview_origin("https://pr151--fieldadmin.txcloud.app"));
        // Another app's preview, and a preview of ours over plain http.
        assert!(!is_preview_origin("https://prod--courseboard.txcloud.app"));
        assert!(!is_preview_origin("http://pr151--courseboard.txcloud.app"));
        assert!(!is_preview_origin("https://pr--courseboard.txcloud.app"));
    }

    #[tokio::test]
    async fn provider_errors_keep_json_and_cors_headers() {
        async fn provider_failure() -> Result<StatusCode, AppError> {
            Err(AppError::Provider("upstream unavailable".to_string()))
        }

        let app = Router::new()
            .route("/provider-failure", get(provider_failure))
            .layer(courseboard_cors_layer());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/provider-failure")
                    .header("origin", "https://courseboard.txcloud.app")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // 4xx, not 5xx: Cloudflare replaces origin 5xx bodies with a CORS-less
        // error page, so a 502 here reaches the browser as "Failed to fetch".
        assert_eq!(response.status(), StatusCode::FAILED_DEPENDENCY);
        assert_eq!(
            response.headers().get("access-control-allow-origin"),
            Some(&HeaderValue::from_static("https://courseboard.txcloud.app"))
        );
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("application/json"))
        );
        let body = response
            .into_body()
            .collect()
            .await
            .expect("collect provider error body")
            .to_bytes();
        let body: serde_json::Value =
            serde_json::from_slice(&body).expect("decode provider error body");
        assert_eq!(body["error"], "provider_error");
        assert_eq!(
            body["message"],
            "external provider error: upstream unavailable"
        );
    }

    #[tokio::test]
    async fn upstream_conflicts_keep_the_status_and_operator_message() {
        let response = AppError::UpstreamClient {
            status: StatusCode::CONFLICT,
            message: "このスタッフは田中さんに既に紐付いています".to_string(),
        }
        .into_response();

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = response
            .into_body()
            .collect()
            .await
            .expect("collect conflict body")
            .to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).expect("decode conflict body");
        assert_eq!(body["error"], "upstream_client_error");
        assert_eq!(
            body["message"],
            "このスタッフは田中さんに既に紐付いています"
        );
        assert!(!body["message"]
            .as_str()
            .expect("message string")
            .contains("external provider error"));
    }

    #[tokio::test]
    async fn course_conflicts_are_returned_as_409_json() {
        let response = AppError::Conflict("この枠はちょうど埋まりました").into_response();

        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = response
            .into_body()
            .collect()
            .await
            .expect("collect conflict body")
            .to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).expect("decode conflict body");
        assert_eq!(body["error"], "conflict");
        assert_eq!(body["message"], "この枠はちょうど埋まりました");
    }

    #[tokio::test]
    async fn normalized_field_auth_denials_stay_below_500_at_the_http_boundary() {
        let response = AppError::UpstreamClient {
            status: StatusCode::FORBIDDEN,
            message: "Field bearer was rejected".to_string(),
        }
        .into_response();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(!response.status().is_server_error());
        let body = response
            .into_body()
            .collect()
            .await
            .expect("collect denial body")
            .to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).expect("decode denial body");
        assert_eq!(body["error"], "upstream_client_error");
        assert_eq!(body["message"], "Field bearer was rejected");
    }

    #[tokio::test]
    async fn panicking_handler_answers_with_json_and_cors_headers() {
        async fn boom() -> StatusCode {
            panic!("handler exploded")
        }

        let app = Router::new()
            .route("/boom", get(boom))
            .layer(CatchPanicLayer::custom(panic_response))
            .layer(courseboard_cors_layer());
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/boom")
                    .header("origin", "https://courseboard.txcloud.app")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Without the layer the connection is dropped instead, which the
        // operator UI can only report as an untranslatable network error.
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response.headers().get("access-control-allow-origin"),
            Some(&HeaderValue::from_static("https://courseboard.txcloud.app"))
        );
        let body = response
            .into_body()
            .collect()
            .await
            .expect("collect panic body")
            .to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&body).expect("decode panic body");
        assert_eq!(body["error"], "internal_server_error");
    }

    async fn test_app(auth: &TestAuth) -> Router {
        test_app_with_verifier(auth.verifier()).await
    }

    async fn test_app_with_verifier(verifier: OidcJwtVerifier) -> Router {
        test_app_with_verifier_and_cancellation_fee_config(
            verifier,
            CancellationFeeConfig::default(),
        )
        .await
    }

    async fn test_app_with_verifier_and_cancellation_fee_config(
        verifier: OidcJwtVerifier,
        config: CancellationFeeConfig,
    ) -> Router {
        let pool = crate::test_support::test_pool().await;
        build_router(AppState::new_with_cancellation_fee_config(
            pool,
            Arc::new(verifier),
            config,
        ))
    }

    fn cancellation_fee_config(field_api_url: Option<String>) -> CancellationFeeConfig {
        CancellationFeeConfig {
            public_ui_base_url: "http://courseboard.local/ui/index.html".to_string(),
            sms_sender_name: "Course Board".to_string(),
            field_api_url,
            field_upstream_authorization: None,
            twilio_account_sid: None,
            twilio_auth_token: None,
            twilio_messaging_service_sid: None,
            twilio_from_number: None,
        }
    }

    async fn spawn_test_field_api() -> String {
        async fn create_invoice(
            headers: HeaderMap,
            Json(body): Json<serde_json::Value>,
        ) -> (StatusCode, Json<serde_json::Value>) {
            let authorization = headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .expect("authorization header");
            assert!(authorization.starts_with("Bearer "));
            assert_eq!(
                headers
                    .get("x-operator-id")
                    .and_then(|value| value.to_str().ok()),
                Some("scc")
            );
            assert_eq!(
                body["billTo"],
                serde_json::json!({
                    "kind": "client",
                    "clientId": "cl_company_x",
                    "affiliationId": "ccaf_person_a_company_x"
                })
            );
            assert!(body.get("clientId").is_none());
            assert!(!body.to_string().contains("courseboard:"));
            assert_eq!(body["clientName"], "山田 太郎");
            assert_eq!(body["lineItems"][0]["unitPrice"], 5000);
            (
                StatusCode::CREATED,
                Json(serde_json::json!({
                    "id": "inv_test_courseboard",
                    "paymentLinkUrl": "https://field.example/pay/inv_test_courseboard"
                })),
            )
        }

        async fn public_invoice() -> Json<serde_json::Value> {
            Json(serde_json::json!({
                "id": "inv_test_courseboard",
                "tenantId": "scc",
                "status": "Sent"
            }))
        }

        let app = Router::new()
            .route("/v1/invoices", post(create_invoice))
            .route(
                "/v1/public/invoices/:tenant_id/:invoice_id",
                get(public_invoice),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test Field API");
        let addr = listener.local_addr().expect("test Field API addr");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test Field API");
        });
        format!("http://{addr}")
    }

    async fn calculate_with_green_fee(green_fee: i64) -> CalculateResponse {
        calculate_with_players(
            green_fee,
            serde_json::json!([{ "age": 42, "has_disability_cert": false }]),
        )
        .await
    }

    async fn calculate_with_players(
        green_fee: i64,
        players: serde_json::Value,
    ) -> CalculateResponse {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let body = serde_json::json!({
            "tenant_id": "scc",
            "prefecture": "hokkaido",
            "green_fee": green_fee,
            "players": players
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/calculate")
                    .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn taxable_adult_pays_hokkaido_fee() {
        let response = calculate_with_players(
            8000,
            serde_json::json!([{ "age": 42, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(
            response,
            CalculateResponse {
                course_grade: "A".to_string(),
                tax_amount: 400,
                breakdown: vec![PlayerBreakdown {
                    player_index: 0,
                    fee: 400,
                    exempt: false,
                    reason: None,
                }],
            }
        );
    }

    #[tokio::test]
    async fn minor_is_exempt_in_hokkaido() {
        let response = calculate_with_players(
            8000,
            serde_json::json!([{ "age": 17, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(response.tax_amount, 0);
        assert_eq!(response.breakdown[0].reason.as_deref(), Some("minor"));
    }

    /// The shared, prefecture-wide schedule as a real tenant reaches it: by the
    /// grade the prefecture assigned, since no brackets are seeded for it.
    async fn calculate_by_grade(grade: &str, players: serde_json::Value) -> Response {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let body = serde_json::json!({
            "tenant_id": "tn_not_a_seeded_tenant",
            "prefecture": "hokkaido",
            "green_fee": 12_000,
            "course_grade": grade,
            "players": players
        });
        app.oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/calculate")
                .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn a_real_tenant_prices_off_the_shared_schedule_by_its_grade() {
        // Without the grade this answers 404: the shared schedule carries the
        // rates but no brackets, so the green fee has nothing to match against.
        let response = calculate_by_grade(
            "6",
            serde_json::json!([{ "age": 42, "has_disability_cert": false }]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: CalculateResponse = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body.course_grade, "6");
        assert_eq!(body.tax_amount, 800);
    }

    #[tokio::test]
    async fn the_reduced_band_is_reachable_through_the_grade_lookup() {
        // The whole point of the reduced band. Before the grade lookup existed
        // no production request could reach it: the age-aware endpoint only
        // knew the bracket path, and the shared schedule has no brackets.
        let response = calculate_by_grade(
            "6",
            serde_json::json!([
                { "age": 64, "has_disability_cert": false },
                { "age": 65, "has_disability_cert": false },
                { "age": 70, "has_disability_cert": false }
            ]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: CalculateResponse = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(body.breakdown[0].fee, 800, "64 pays the whole rate");
        assert_eq!(body.breakdown[1].fee, 400, "65 pays half");
        assert_eq!(body.breakdown[1].reason.as_deref(), Some("senior_reduced"));
        assert_eq!(body.breakdown[2].fee, 0, "70 is exempt outright");
        assert_eq!(body.tax_amount, 1_200);
    }

    #[tokio::test]
    async fn age_65_is_reduced_rather_than_exempt_or_full_price() {
        // Hokkaido halves the tax from 65 until the exemption at 70. Before the
        // reduced band existed these players were billed the full rate.
        let full = calculate_with_players(
            8000,
            serde_json::json!([{ "age": 64, "has_disability_cert": false }]),
        )
        .await;
        let reduced = calculate_with_players(
            8000,
            serde_json::json!([{ "age": 65, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(reduced.tax_amount, full.tax_amount / 2);
        assert_eq!(
            reduced.breakdown[0].reason.as_deref(),
            Some("senior_reduced")
        );
        assert!(!reduced.breakdown[0].exempt);
    }

    #[tokio::test]
    async fn age_70_is_exempt_in_hokkaido() {
        let response = calculate_with_players(
            8000,
            serde_json::json!([{ "age": 70, "has_disability_cert": false }]),
        )
        .await;

        assert_eq!(response.tax_amount, 0);
        assert_eq!(response.breakdown[0].reason.as_deref(), Some("senior"));
    }

    #[tokio::test]
    async fn disability_certificate_is_exempt_in_hokkaido() {
        let response = calculate_with_players(
            8000,
            serde_json::json!([{ "age": 42, "has_disability_cert": true }]),
        )
        .await;

        assert_eq!(response.tax_amount, 0);
        assert_eq!(
            response.breakdown[0].reason.as_deref(),
            Some("disability_cert")
        );
    }

    #[tokio::test]
    async fn mixed_players_total_only_counts_taxable_players() {
        let response = calculate_with_players(
            8000,
            serde_json::json!([
                { "age": 42, "has_disability_cert": false },
                { "age": 17, "has_disability_cert": false },
                { "age": 70, "has_disability_cert": false },
                { "age": 55, "has_disability_cert": true },
                { "age": 69, "has_disability_cert": false }
            ]),
        )
        .await;

        // The 69-year-old used to be billed the full 400 here, which is what
        // this test locked in. Hokkaido halves the tax from 65 until the
        // exemption at 70, so they owe 200 and the party owes 600.
        assert_eq!(response.tax_amount, 600);
        assert_eq!(response.breakdown.len(), 5);
        assert_eq!(response.breakdown[0].fee, 400);
        assert_eq!(response.breakdown[4].fee, 200);
        assert_eq!(
            response.breakdown[4].reason.as_deref(),
            Some("senior_reduced")
        );
    }

    #[tokio::test]
    async fn green_fee_resolves_course_grade_boundaries() {
        let grade_a = calculate_with_green_fee(8000).await;
        assert_eq!(grade_a.course_grade, "A");
        assert_eq!(grade_a.tax_amount, 400);

        let grade_b = calculate_with_green_fee(6999).await;
        assert_eq!(grade_b.course_grade, "B");
        assert_eq!(grade_b.tax_amount, 350);

        let grade_a_boundary = calculate_with_green_fee(7000).await;
        assert_eq!(grade_a_boundary.course_grade, "A");
        assert_eq!(grade_a_boundary.tax_amount, 400);
    }

    #[tokio::test]
    async fn simulate_range_returns_profit_and_tax_totals() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let body = serde_json::json!({
            "tenant_id": "scc",
            "prefecture": "hokkaido",
            "green_fee_range": { "min": 3500, "max": 12000, "step": 500 },
            "base_visitors": 60,
            "base_green_fee": 8000,
            "price_elasticity": -1.2,
            "taxable_ratio": 0.85,
            "fixed_cost": 300000,
            "variable_cost_per_visitor": 1500
        });
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/simulate/range")
                    .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let simulation: SimulateRangeResponse = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(simulation.rows.len(), 18);
        let first = &simulation.rows[0];
        assert_eq!(first.green_fee, 3500);
        assert_eq!(first.course_grade, "C");
        assert_eq!(first.visitors, 162);
        assert_eq!(first.taxable_visitors, 138);
        assert_eq!(first.revenue, 567000);
        assert_eq!(first.tax_total, 41400);
        assert_eq!(first.variable_cost, 243000);
        assert_eq!(first.fixed_cost, 300000);
        assert_eq!(first.profit, -17400);
        assert!(first.profit_margin_pct < 0.0);
        assert!(simulation
            .rows
            .iter()
            .any(|row| row.green_fee == 12000 && row.profit > 0 && row.tax_total > 0));
    }

    #[tokio::test]
    async fn bearer_token_is_required() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/calculate")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "tenant_id": "scc",
                            "prefecture": "hokkaido",
                            "green_fee": 8000,
                            "players": [{ "age": 42, "has_disability_cert": false }]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn malformed_token_is_rejected() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request("Bearer not-a-jwt", "scc"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().get("x-courseboard-auth-error"),
            Some(&HeaderValue::from_static("malformed_token"))
        );
    }

    #[tokio::test]
    async fn valid_jwks_signed_token_is_accepted() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!("Bearer {}", auth.valid_token()),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn creates_cancellation_fee_collection_and_public_payment_link() {
        let auth = TestAuth::new();
        let field_api_url = spawn_test_field_api().await;
        let app = test_app_with_verifier_and_cancellation_fee_config(
            auth.verifier(),
            cancellation_fee_config(Some(field_api_url)),
        )
        .await;
        let body = serde_json::json!({
            "tenant_id": "scc",
            "reference": "RSV-1001",
            "bill_to": {
                "kind": "client",
                "clientId": "cl_company_x",
                "affiliationId": "ccaf_person_a_company_x"
            },
            "customer_name": "山田 太郎",
            "customer_phone": "+819012345678",
            "amount": 5000,
            "currency": "JPY",
            "due_date": "2026-07-04",
            "reason": "当日キャンセル",
            "send_sms": false
        });
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/cancellation-fee-collections")
                    .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let created: cancellation_fees::CreateCancellationFeeCollectionResponse =
            serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created.collection.amount, 5000);
        assert_eq!(created.collection.currency, "JPY");
        assert_eq!(created.collection.sms_status, "not_requested");
        assert_eq!(
            created.collection.field_invoice_id.as_deref(),
            Some("inv_test_courseboard")
        );
        assert!(created.collection.payment_url.contains("index.html#/pay/"));
        assert!(created.sms_message.contains("キャンセル料5000円"));

        let mut second_body = body.clone();
        second_body["reference"] = serde_json::json!("RSV-1002");
        let second_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/cancellation-fee-collections")
                    .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(second_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(second_response.status(), StatusCode::OK);

        let token = created
            .collection
            .payment_url
            .rsplit('/')
            .next()
            .expect("payment token");
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/public/cancellation-fees/{token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let public: cancellation_fees::CancellationFeeCollectionResponse =
            serde_json::from_slice(&bytes).unwrap();
        assert_eq!(public.reference.as_deref(), Some("RSV-1001"));
        assert_eq!(public.customer_name, "山田 太郎");
    }

    #[tokio::test]
    async fn cancellation_fee_collection_requires_field_api_url() {
        let auth = TestAuth::new();
        let app = test_app_with_verifier_and_cancellation_fee_config(
            auth.verifier(),
            cancellation_fee_config(None),
        )
        .await;
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/cancellation-fee-collections")
                    .header(AUTHORIZATION, format!("Bearer {}", auth.valid_token()))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "tenant_id": "scc",
                            "bill_to": {
                                "kind": "customer",
                                "customerId": "cus_person_a"
                            },
                            "customer_name": "山田 太郎",
                            "customer_phone": "+819012345678",
                            "amount": 5000,
                            "due_date": "2026-07-04"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Provider failures deliberately use 424 rather than a 5xx response:
        // Cloudflare can replace origin 5xx bodies with a CORS-less error page,
        // hiding the actionable configuration error from the operator UI.
        assert_eq!(response.status(), StatusCode::FAILED_DEPENDENCY);
        let body = response
            .into_body()
            .collect()
            .await
            .expect("collect missing Field API URL response")
            .to_bytes();
        let body: serde_json::Value =
            serde_json::from_slice(&body).expect("decode missing Field API URL response");
        assert_eq!(body["error"], "provider_error");
        assert_eq!(
            body["message"],
            "external provider error: TACHYON_FIELD_API_URL is required to create cancellation fee payment links"
        );
    }

    #[tokio::test]
    async fn access_token_without_audience_uses_client_id() {
        let auth = TestAuth::new();
        let app = test_app_with_verifier(
            auth.verifier_with("field-core", HashSet::from(["field-core".to_string()])),
        )
        .await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with_claims(serde_json::json!({
                        "iss": "test-issuer",
                        "sub": "87f4fa48-b0d1-70ab-ae9f-cfa01ec164c3",
                        "client_id": "field-core"
                    }))
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn id_token_without_client_id_uses_audience_for_client_authorization() {
        let auth = TestAuth::new();
        let app = test_app_with_verifier(
            auth.verifier_with("field-core", HashSet::from(["field-core".to_string()])),
        )
        .await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with_claims(serde_json::json!({
                        "iss": "test-issuer",
                        "sub": "87f4fa48-b0d1-70ab-ae9f-cfa01ec164c3",
                        "aud": "field-core"
                    }))
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cognito_access_token_is_accepted() {
        let auth = TestAuth::new();
        let issuer = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test";
        let app = test_app_with_verifier(auth.verifier_with_issuer(
            issuer,
            "field-core",
            HashSet::from(["field-core".to_string()]),
        ))
        .await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with_claims(serde_json::json!({
                        "iss": issuer,
                        "sub": "87f4fa48-b0d1-70ab-ae9f-cfa01ec164c3",
                        "client_id": "field-core",
                        "token_use": "access"
                    }))
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cognito_id_token_is_rejected() {
        let auth = TestAuth::new();
        let issuer = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test";
        let app = test_app_with_verifier(auth.verifier_with_issuer(
            issuer,
            "field-core",
            HashSet::from(["field-core".to_string()]),
        ))
        .await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with_claims(serde_json::json!({
                        "iss": issuer,
                        "sub": "87f4fa48-b0d1-70ab-ae9f-cfa01ec164c3",
                        "aud": "field-core",
                        "token_use": "id"
                    }))
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_audience_is_rejected() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with("test-issuer", "wrong-audience", "field-core")
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn allowlisted_client_id_is_accepted_without_primary_audience() {
        let auth = TestAuth::new();
        let app = test_app_with_verifier(auth.verifier_with(
            "courseboard-web",
            HashSet::from(["courseboard-web".to_string(), "local-prod-pkce".to_string()]),
        ))
        .await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with_claims(serde_json::json!({
                        "iss": "test-issuer",
                        "sub": "87f4fa48-b0d1-70ab-ae9f-cfa01ec164c3",
                        "client_id": "local-prod-pkce"
                    }))
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn wrong_issuer_is_rejected() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with(
                        "https://wrong-issuer.example",
                        "tachyonfield-golf",
                        "field-core"
                    )
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn wrong_client_id_is_forbidden() {
        let auth = TestAuth::new();
        let app = test_app(&auth).await;
        let response = app
            .oneshot(calculate_request(
                &format!(
                    "Bearer {}",
                    auth.token_with("test-issuer", "tachyonfield-golf", "other-client")
                ),
                "scc",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    fn calculate_request(authorization: &str, tenant_id: &str) -> Request<Body> {
        Request::builder()
            .method(Method::POST)
            .uri("/calculate")
            .header(AUTHORIZATION, authorization)
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "tenant_id": tenant_id,
                    "prefecture": "hokkaido",
                    "green_fee": 8000,
                    "players": [{ "age": 42, "has_disability_cert": false }]
                })
                .to_string(),
            ))
            .unwrap()
    }

    struct TestAuth {
        private_key: RsaPrivateKey,
    }

    impl TestAuth {
        fn new() -> Self {
            Self {
                private_key: RsaPrivateKey::new(&mut OsRng, 2048).unwrap(),
            }
        }

        fn verifier(&self) -> OidcJwtVerifier {
            self.verifier_with(
                "tachyonfield-golf",
                HashSet::from(["field-core".to_string()]),
            )
        }

        fn verifier_with(
            &self,
            expected_audience: &str,
            expected_client_ids: HashSet<String>,
        ) -> OidcJwtVerifier {
            self.verifier_with_issuer("test-issuer", expected_audience, expected_client_ids)
        }

        fn verifier_with_issuer(
            &self,
            issuer: &str,
            expected_audience: &str,
            expected_client_ids: HashSet<String>,
        ) -> OidcJwtVerifier {
            let public_key = self.private_key.to_public_key();
            OidcJwtVerifier::from_jwks(
                AuthConfig {
                    issuer_url: issuer.to_string(),
                    expected_audience: expected_audience.to_string(),
                    expected_client_ids,
                },
                Jwks {
                    keys: vec![Jwk {
                        kty: "RSA".to_string(),
                        kid: Some("test-key".to_string()),
                        n: b64url(&public_key.n().to_bytes_be()),
                        e: b64url(&public_key.e().to_bytes_be()),
                        alg: Some("RS256".to_string()),
                        key_use: Some("sig".to_string()),
                    }],
                },
            )
        }

        fn valid_token(&self) -> String {
            self.token_with("test-issuer", "tachyonfield-golf", "field-core")
        }

        fn token_with(&self, issuer: &str, audience: &str, client_id: &str) -> String {
            self.token_with_claims(serde_json::json!({
                "iss": issuer,
                "sub": client_id,
                "aud": audience,
                "client_id": client_id,
                "azp": client_id
            }))
        }

        fn token_with_claims(&self, mut claims: serde_json::Value) -> String {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let claims = claims.as_object_mut().expect("claims must be an object");
            claims.insert("iat".to_string(), serde_json::json!(now));
            claims.insert("nbf".to_string(), serde_json::json!(now.saturating_sub(10)));
            claims.insert("exp".to_string(), serde_json::json!(now + 300));
            let mut header = Header::new(Algorithm::RS256);
            header.kid = Some("test-key".to_string());
            let private_key_der = self.private_key.to_pkcs1_der().unwrap();

            encode(
                &header,
                &claims,
                &EncodingKey::from_rsa_der(private_key_der.as_bytes()),
            )
            .unwrap()
        }
    }

    fn b64url(bytes: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(bytes)
    }
}
