use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use courseboard::{build_app, config::RuntimeConfig};
use lambda_http::{lambda_runtime, request::LambdaRequest, Adapter, Error, LambdaEvent, Service};

const MIGRATION_GATE_ROUTE_KEY: &str = "COURSEBOARD_MIGRATION_GATE";
const MIGRATION_GATE_PATH: &str = "/healthz";
const MIGRATION_GATE_DOMAIN: &str = "courseboard-migration-gate.internal";

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter("courseboard=info")
        .init();

    let config = RuntimeConfig::from_args();
    let database_url: Arc<str> = Arc::from(config.database_url.clone());
    let app = build_app(config).await?;

    // Tachyon invokes the candidate alias with a synthetic API Gateway event
    // before promoting it to stable traffic. Run migration validation/apply
    // only for that direct deploy-hook event; ordinary HTTP cold starts only
    // construct serving dependencies.
    lambda_runtime::run(DeployMigrationGate::new(Adapter::from(app), database_url)).await
}

struct DeployMigrationGate<S> {
    inner: S,
    database_url: Arc<str>,
}

impl<S> DeployMigrationGate<S> {
    fn new(inner: S, database_url: Arc<str>) -> Self {
        Self {
            inner,
            database_url,
        }
    }
}

impl<S> Service<LambdaEvent<LambdaRequest>> for DeployMigrationGate<S>
where
    S: Service<LambdaEvent<LambdaRequest>>,
    S::Future: Send + 'static,
    S::Response: 'static,
    S::Error: Into<Error>,
{
    type Response = S::Response;
    type Error = Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(context).map_err(Into::into)
    }

    fn call(&mut self, event: LambdaEvent<LambdaRequest>) -> Self::Future {
        let is_migration_gate = is_migration_gate_event(&event.payload);
        let database_url = Arc::clone(&self.database_url);
        let response = self.inner.call(event);

        Box::pin(async move {
            if is_migration_gate {
                courseboard::migrations::run_migration_gate(&database_url).await?;
            }
            response.await.map_err(Into::into)
        })
    }
}

fn is_migration_gate_event(event: &LambdaRequest) -> bool {
    matches!(
        event,
        LambdaRequest::ApiGatewayV2(request)
            if request.route_key.as_deref() == Some(MIGRATION_GATE_ROUTE_KEY)
                && request.raw_path.as_deref() == Some(MIGRATION_GATE_PATH)
                && request.request_context.domain_name.as_deref()
                    == Some(MIGRATION_GATE_DOMAIN)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(payload: serde_json::Value) -> LambdaRequest {
        serde_json::from_value(payload).expect("deserialize Lambda HTTP event")
    }

    #[test]
    fn only_the_internal_candidate_hook_selects_the_migration_gate() {
        let manifest = include_str!("../tachyon.yaml");
        assert!(manifest
            .lines()
            .any(|line| { line.trim() == format!("routeKey: {MIGRATION_GATE_ROUTE_KEY}") }));
        assert!(manifest
            .lines()
            .any(|line| line.trim() == format!("rawPath: {MIGRATION_GATE_PATH}")));
        assert!(manifest
            .lines()
            .any(|line| line.trim() == format!("domainName: {MIGRATION_GATE_DOMAIN}")));

        let gate = request(serde_json::json!({
            "version": "2.0",
            "routeKey": MIGRATION_GATE_ROUTE_KEY,
            "rawPath": MIGRATION_GATE_PATH,
            "rawQueryString": "",
            "headers": { "host": MIGRATION_GATE_DOMAIN },
            "requestContext": {
                "domainName": MIGRATION_GATE_DOMAIN,
                "http": { "method": "GET", "path": MIGRATION_GATE_PATH }
            },
            "isBase64Encoded": false
        }));
        assert!(is_migration_gate_event(&gate));

        let public_request = request(serde_json::json!({
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": MIGRATION_GATE_PATH,
            "rawQueryString": "",
            "headers": { "host": "courseboard-api.txcloud.app" },
            "requestContext": {
                "domainName": "courseboard-api.txcloud.app",
                "http": { "method": "GET", "path": MIGRATION_GATE_PATH }
            },
            "isBase64Encoded": false
        }));
        assert!(!is_migration_gate_event(&public_request));
    }
}
