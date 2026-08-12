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
    const REQUIRED_SCHEMA_VERSION: i32 = 3;
    const REQUIRED_MIGRATION_NAME: &str = "003_protect_migration_history.sql";
    const REQUIRED_MIGRATION_CHECKSUM: &str =
        "d7c41d110fdbb68f38586a2f57804c4567444946be29c988eba1c467cacfdce9";
    let compatible: bool = sqlx::query_scalar(
        "SELECT
           (SELECT array_agg(version ORDER BY version) FROM schema_versions) = ARRAY[2, 3]
           AND (SELECT count(*) FROM schema_migrations) = 1
           AND EXISTS (
             SELECT 1 FROM schema_migrations
             WHERE version = $1 AND name = $2 AND checksum = $3
           )",
    )
    .bind(REQUIRED_SCHEMA_VERSION)
    .bind(REQUIRED_MIGRATION_NAME)
    .bind(REQUIRED_MIGRATION_CHECKSUM)
    .fetch_one(pool)
    .await?;
    if !compatible {
        anyhow::bail!(
            "database schema version mismatch: expected migration {REQUIRED_SCHEMA_VERSION} with complete history"
        );
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
