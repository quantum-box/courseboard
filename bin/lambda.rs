use courseboard::{build_app, config::RuntimeConfig};
use lambda_http::{run, Error};

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter("courseboard=info")
        .init();

    let app = build_app(RuntimeConfig::from_args()).await?;

    run(app).await
}
