use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;
    Ok(pool)
}

pub async fn assert_schema_version(pool: &PgPool) -> Result<()> {
    let installed: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM schema_versions WHERE version = 2)")
            .fetch_one(pool)
            .await?;
    if !installed {
        anyhow::bail!("database is missing the required SentinelMesh V2 schema");
    }
    Ok(())
}

/// A pool whose every connection runs `SET ROLE sentinel_reputation`, so it
/// operates with the restricted role's privileges (the only role granted SELECT
/// on `report_authors`). Built over the SAME DATABASE_URL as the main pool — no
/// second credential. The main pool never SET ROLEs and therefore cannot read
/// report_authors when the app connects as a non-superuser (production posture).
pub async fn create_reputation_pool(database_url: &str) -> Result<PgPool> {
    use sqlx::Executor;
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                conn.execute("SET ROLE sentinel_reputation").await?;
                Ok(())
            })
        })
        .connect(database_url)
        .await?;
    Ok(pool)
}
