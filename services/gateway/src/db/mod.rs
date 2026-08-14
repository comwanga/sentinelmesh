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
    const REQUIRED_SCHEMA_VERSION: i32 = 9;
    let compatible: bool = sqlx::query_scalar(
        "SELECT
           (SELECT array_agg(version ORDER BY version) FROM schema_versions) = ARRAY[2, 3, 4, 5, 6, 7, 8, 9]
           AND (SELECT array_agg(version ORDER BY version) FROM schema_migrations) = ARRAY[3, 4, 5, 6, 7, 8, 9]
           AND (SELECT array_agg(name ORDER BY version) FROM schema_migrations) =
                 ARRAY[
                   '003_protect_migration_history.sql',
                   '004_simplify_runtime_schema.sql',
                   '005_add_nip05_identity.sql',
                    '006_add_nip44_circle_key_wrap.sql',
                     '007_add_targeted_push_outbox.sql',
                     '008_grant_push_outbox_runtime.sql',
                     '009_safe_circle_location_envelopes.sql'
                 ]
           AND (SELECT array_agg(checksum ORDER BY version) FROM schema_migrations) =
                 ARRAY[
                   'd7c41d110fdbb68f38586a2f57804c4567444946be29c988eba1c467cacfdce9',
                   'e7e3b94079424215c60b88675e045eeebaf3bd1b4d21256b926858945270c1a0',
                   '77fe3e26e02b444dc5c673af5453f67affe7bd2106d7235778a50f7c1fca1c91',
                    '98085254ae48e12db57e13459ec2a6a425f29f919568475f0597a8a2186b93cb',
                     'a660ca8d78efa63631b2167e02c72d8123f19684c095c56ec45f2cedcf69adc9',
                      '44bfdd61fafcb1a979853dfed2d2253fa31674b25bac851b2e0def35353bb7ab',
                      '6eec445a8da9828c3367263140cf296191733428d17c493fdb8c2e34bf2ac6ea'
                 ]",
    )
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
