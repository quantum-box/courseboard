use lambda_http::{run, Error};
use tachyonfield_golf::build_app_from_env;

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter("tachyonfield_golf=info")
        .init();

    let app = build_app_from_env().await?;

    run(app).await
}
