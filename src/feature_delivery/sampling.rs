//! Sampling and decision logs for the delivery guard.
//!
//! Every read of Core's delivery decision re-issues a Field runtime lease, so
//! `shadow` must not read Core on every request. It reads a sampled share, at most
//! once per tenant and feature per [`SHADOW_DEDUP_WINDOW`] on each instance.

use super::{DeliveryDenial, DeliveryEnforcement};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const SHADOW_SAMPLE_RATE_ENV: &str = "COURSEBOARD_FEATURE_DELIVERY_SHADOW_SAMPLE_RATE";
pub const DEFAULT_SHADOW_SAMPLE_RATE: f64 = 0.01;
pub const SHADOW_DEDUP_WINDOW: Duration = Duration::from_secs(60);
/// Tracing target of every decision log, for filtering and aggregation.
pub const DECISION_LOG_TARGET: &str = "courseboard::feature_delivery::decision";
const MAX_TRACKED_PAIRS: usize = 4096;

#[derive(Debug)]
pub struct DeliverySampler {
    rate: f64,
    window: Duration,
    last_evaluated: Mutex<HashMap<(String, &'static str), Instant>>,
}

impl DeliverySampler {
    pub fn new(rate: f64, window: Duration) -> Self {
        Self {
            rate: if rate.is_finite() {
                rate.clamp(0.0, 1.0)
            } else {
                DEFAULT_SHADOW_SAMPLE_RATE
            },
            window,
            last_evaluated: Mutex::new(HashMap::new()),
        }
    }

    /// A rate in `0..=1`. Anything else falls back to the default.
    pub fn parse_rate(value: Option<&str>) -> f64 {
        match value.map(str::trim) {
            None | Some("") => DEFAULT_SHADOW_SAMPLE_RATE,
            Some(raw) => match raw.parse::<f64>() {
                Ok(rate) if (0.0..=1.0).contains(&rate) => rate,
                _ => {
                    tracing::warn!(
                        value = raw,
                        "invalid {SHADOW_SAMPLE_RATE_ENV}; using {DEFAULT_SHADOW_SAMPLE_RATE}"
                    );
                    DEFAULT_SHADOW_SAMPLE_RATE
                }
            },
        }
    }

    pub fn from_env() -> Self {
        Self::new(
            Self::parse_rate(std::env::var(SHADOW_SAMPLE_RATE_ENV).ok().as_deref()),
            SHADOW_DEDUP_WINDOW,
        )
    }

    /// Whether this request falls in the sampled share.
    pub fn roll(&self) -> bool {
        self.rate >= 1.0 || (self.rate > 0.0 && rand::random::<f64>() < self.rate)
    }

    /// Whether a shadow request should read Core: sampled, and the pair was
    /// not read within the window.
    pub fn admit_shadow(&self, tenant_id: &str, feature: &'static str) -> bool {
        if !self.roll() {
            return false;
        }
        let now = Instant::now();
        let Ok(mut last_evaluated) = self.last_evaluated.lock() else {
            return false;
        };
        let fresh = |at: &Instant| now.duration_since(*at) < self.window;
        if last_evaluated
            .get(&(tenant_id.to_string(), feature))
            .is_some_and(fresh)
        {
            return false;
        }
        if last_evaluated.len() >= MAX_TRACKED_PAIRS {
            last_evaluated.retain(|_, at| fresh(at));
            if last_evaluated.len() >= MAX_TRACKED_PAIRS {
                return false;
            }
        }
        last_evaluated.insert((tenant_id.to_string(), feature), now);
        true
    }
}

/// What the guard concluded for one request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoggedDecision {
    Allow,
    Deny(DeliveryDenial),
    /// `shadow` stopped waiting for Core.
    TimedOut,
}

pub struct DecisionLog<'a> {
    pub enforcement: DeliveryEnforcement,
    pub tenant_id: Option<&'a str>,
    pub feature: &'static str,
    pub method: &'a str,
    pub path: &'a str,
}

impl DecisionLog<'_> {
    /// One structured event per decision. Never carries the bearer.
    pub fn emit(&self, decision: LoggedDecision) {
        let tenant_id = self.tenant_id.unwrap_or("-");
        let enforcement = self.enforcement.as_str();
        let (outcome, reason) = match decision {
            LoggedDecision::Allow => ("allow", "ALLOWED"),
            LoggedDecision::Deny(denial) => ("deny", denial.code()),
            LoggedDecision::TimedOut => ("unknown", "SHADOW_TIMEOUT"),
        };
        macro_rules! decision_event {
            ($level:ident) => {
                tracing::$level!(
                    target: DECISION_LOG_TARGET,
                    tenant_id,
                    feature = self.feature,
                    decision = outcome,
                    reason,
                    enforcement,
                    method = self.method,
                    path = self.path,
                    "feature delivery decision"
                )
            };
        }
        match decision {
            LoggedDecision::Allow => decision_event!(info),
            _ => decision_event!(warn),
        }
    }
}
