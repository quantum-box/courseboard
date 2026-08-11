use anyhow::Context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter("courseboard=info")
        .init();

    let database_url =
        std::env::var("DATABASE_URL").context("DATABASE_URL must be set for the migration gate")?;
    courseboard::migrations::run_migration_gate(&database_url)
        .await
        .context("CourseBoard migration gate rejected the target database")?;

    tracing::info!("CourseBoard migration gate completed successfully");
    Ok(())
}
