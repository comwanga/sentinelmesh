# C-3 Phase A — Backend Tokenization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the plaintext family social graph at rest: replace stored `owner_pubkey` / `member_pubkey` / `recipient_pubkey_hash` with per-circle keyed tokens, remove server-side circle enumeration (client-driven listing), and keep the app working with a degraded (unlabeled) roster. Metadata encryption (names/labels) is Phase B.

**Architecture:** A gateway `circles::token` module computes `v1:HMAC-SHA256(CIRCLE_TOKEN_SECRET, circle_id ‖ pubkey)`. All circle-scoped endpoints recompute the token from the path `circle_id` + the authenticated pubkey to authorize/match; nothing stores or returns a raw pubkey. Migration 013 adds token columns + the backfill populates legacy rows; migration 014 drops the plaintext pubkey columns. `GET /circles` becomes `?ids=`-driven. The PWA persists its circle ids locally to drive listing and shows a member count + `is_owner` until Phase B adds encrypted labels.

**Tech Stack:** Rust (gateway, `hmac` 0.12 + `sha2` + `hex` — all already deps), PostgreSQL (numbered migrations, verified against compose Postgres), TypeScript/React PWA (vitest + tsc).

**Spec:** `docs/superpowers/specs/2026-06-05-c3-social-graph-privacy-design.md` (Parts A–D; the "Phase A" rows).

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway build/test: `cd services/gateway && cargo test` / `cargo build` (workspace at `services/`). DB behavior verified against compose Postgres (Docker available).
- PWA: `cd apps/pwa && npx vitest run <files>` and `npx tsc --noEmit`.
- App DB role in dev/compose is `sentinel`.

**Scope note (Phase A only):** No name/label encryption, no rich roster, no lazy migration (all Phase B). The location-blob change is the **server-only** H-1 fix (tokenize the stored recipient + list filter); the pre-existing `locationPublisher`/WS payload mismatch is left as-is (out of scope).

---

### Task 1: `circle_token` module

**Files:**
- Create: `services/gateway/src/circles/mod.rs`
- Create: `services/gateway/src/circles/token.rs`
- Modify: `services/gateway/src/main.rs` (add `mod circles;`)

A pure, unit-tested HMAC token. `hmac`, `sha2`, `hex` are already gateway dependencies (see `services/gateway/Cargo.toml` and `routes/location_blobs.rs` which uses `hex`/`sha2`).

- [ ] **Step 1: Write the module with tests**

Create `services/gateway/src/circles/token.rs`:

```rust
//! Per-circle keyed tokenization for the C-3 social-graph privacy work.
//!
//! A circle identifier is stored as `v1:HMAC-SHA256(CIRCLE_TOKEN_SECRET,
//! circle_id_utf8 || pubkey_utf8)` (lowercase hex). Including `circle_id` makes
//! the same pubkey yield a DIFFERENT token in every circle, so a DB dump without
//! the secret can neither reverse a token to a pubkey nor link a person across
//! circles. The `v1:` prefix lives inside the value so a future scheme (BLAKE3,
//! HKDF, rotated secret) can coexist row-by-row.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Current token scheme prefix. Bump when the algorithm or secret derivation changes.
pub const TOKEN_VERSION_PREFIX: &str = "v1:";

/// Compute the per-circle token for `(circle_id, pubkey)`.
/// `circle_id` is fed as its canonical lowercase hyphenated UUID string; `pubkey`
/// as received (lowercase hex Nostr pubkey). Both are byte-fed identically by the
/// live path and the backfill so tokens always agree.
pub fn circle_token(secret: &str, circle_id: Uuid, pubkey: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(circle_id.to_string().as_bytes());
    mac.update(pubkey.as_bytes());
    let digest = mac.finalize().into_bytes();
    format!("{}{}", TOKEN_VERSION_PREFIX, hex::encode(digest))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cid() -> Uuid {
        Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap()
    }

    #[test]
    fn token_is_deterministic() {
        let a = circle_token("secret", cid(), "pubkeyhex");
        let b = circle_token("secret", cid(), "pubkeyhex");
        assert_eq!(a, b);
    }

    #[test]
    fn token_has_version_prefix() {
        assert!(circle_token("secret", cid(), "pk").starts_with("v1:"));
    }

    #[test]
    fn same_pubkey_differs_per_circle() {
        let c1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let c2 = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        assert_ne!(circle_token("secret", c1, "pk"), circle_token("secret", c2, "pk"));
    }

    #[test]
    fn distinct_pubkeys_differ() {
        assert_ne!(
            circle_token("secret", cid(), "alice"),
            circle_token("secret", cid(), "bob")
        );
    }

    #[test]
    fn distinct_secrets_differ() {
        assert_ne!(
            circle_token("secret-a", cid(), "pk"),
            circle_token("secret-b", cid(), "pk")
        );
    }
}
```

Create `services/gateway/src/circles/mod.rs`:

```rust
//! Family-circle privacy helpers (C-3). `token` is the per-circle keyed
//! tokenization used by the circle and location-blob routes.
pub mod token;
```

In `services/gateway/src/main.rs`, add `mod circles;` alongside the other module declarations (keep the existing alphabetical-ish ordering, e.g. after `mod config;`):

```rust
mod circles;
mod config;
```

- [ ] **Step 2: Run the tests**

Run:
```bash
cd services/gateway && cargo test circles::token 2>&1 | tail -15
```
Expected: PASS — `token_is_deterministic`, `token_has_version_prefix`, `same_pubkey_differs_per_circle`, `distinct_pubkeys_differ`, `distinct_secrets_differ`.

- [ ] **Step 3: Commit**

```bash
git add services/gateway/src/circles/mod.rs services/gateway/src/circles/token.rs services/gateway/src/main.rs
git commit -m "C-3: add per-circle keyed token module"
```

---

### Task 2: `CIRCLE_TOKEN_SECRET` config

**Files:**
- Modify: `services/gateway/src/config.rs` (field + resolver + tests)
- Modify: `services/gateway/src/middleware/internal_auth.rs`, `services/gateway/src/middleware/nostr_auth.rs` (test `Config` literals gain the field)

Mirrors the existing `INTERNAL_SERVICE_SECRET` fail-closed pattern. A dedicated, stable secret (rotating it invalidates all tokens — documented).

- [ ] **Step 1: Add the field + resolver (write the failing test)**

In `services/gateway/src/config.rs`, add the field to `Config` (after `internal_service_secret`):

```rust
    pub internal_service_secret: String,
    /// HMAC key for per-circle social-graph tokens (C-3). Dedicated and STABLE:
    /// rotating it invalidates every stored circle/member/recipient token and
    /// requires a re-tokenization migration. Do not reuse INTERNAL_SERVICE_SECRET.
    pub circle_token_secret: String,
```

In `Config::from_env`, resolve it next to `internal_service_secret`:

```rust
        let internal_service_secret = resolve_internal_secret(production)?;
        let circle_token_secret = resolve_circle_token_secret(production)?;
```
and set it in the returned struct (next to `internal_service_secret,`):

```rust
            internal_service_secret,
            circle_token_secret,
```

Add the resolver next to `resolve_internal_secret`:

```rust
const INSECURE_CIRCLE_TOKEN_DEFAULT: &str = "dev-only-insecure-circle-token-secret";

/// Resolve CIRCLE_TOKEN_SECRET. Production requires a strong, non-default value
/// (fail closed); non-production falls back to a labelled insecure default.
fn resolve_circle_token_secret(production: bool) -> Result<String> {
    match std::env::var("CIRCLE_TOKEN_SECRET") {
        Ok(s) if !s.is_empty() && s != INSECURE_CIRCLE_TOKEN_DEFAULT => {
            if production {
                reject_weak_secret("CIRCLE_TOKEN_SECRET", &s)?;
            }
            Ok(s)
        }
        _ if production => anyhow::bail!(
            "CIRCLE_TOKEN_SECRET must be set to a strong, non-default value when NODE_ENV=production"
        ),
        _ => {
            tracing::warn!(
                "CIRCLE_TOKEN_SECRET not set — using insecure dev default (NON-PRODUCTION ONLY)"
            );
            Ok(INSECURE_CIRCLE_TOKEN_DEFAULT.to_string())
        }
    }
}
```

Add a test in the `#[cfg(test)] mod tests` block in `config.rs`:

```rust
    #[test]
    fn circle_token_secret_unset_in_production_is_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("CIRCLE_TOKEN_SECRET");
        assert!(resolve_circle_token_secret(true).is_err());
    }

    #[test]
    fn circle_token_secret_falls_back_in_dev() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("CIRCLE_TOKEN_SECRET");
        assert_eq!(
            resolve_circle_token_secret(false).unwrap(),
            INSECURE_CIRCLE_TOKEN_DEFAULT
        );
    }

    #[test]
    fn circle_token_secret_strong_value_accepted_in_production() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("CIRCLE_TOKEN_SECRET", "a-strong-32-byte-circle-secret-x");
        let r = resolve_circle_token_secret(true).unwrap();
        std::env::remove_var("CIRCLE_TOKEN_SECRET");
        assert_eq!(r, "a-strong-32-byte-circle-secret-x");
    }
```

- [ ] **Step 2: Fix the test `Config` literals**

`grep -rn "internal_service_secret:" services/gateway/src` finds the test constructors that build a `Config` literal (in `middleware/internal_auth.rs` and `middleware/nostr_auth.rs`). Add `circle_token_secret: "test-circle-secret".into(),` next to `internal_service_secret:` in each (there are several in `nostr_auth.rs`).

- [ ] **Step 3: Build + run config tests**

Run:
```bash
cd services/gateway && cargo test config:: 2>&1 | tail -20
```
Expected: PASS including the three new `circle_token_secret_*` tests and all pre-existing config tests; the crate (incl. the middleware test modules) compiles.

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/config.rs services/gateway/src/middleware/internal_auth.rs services/gateway/src/middleware/nostr_auth.rs
git commit -m "C-3: add dedicated CIRCLE_TOKEN_SECRET config (fail-closed prod, dev fallback)"
```

---

### Task 3: Migration 013 — add token columns

**Files:**
- Create: `infra/postgres/migrations/013_circle_tokenization.sql`

Additive only (Phase A). Drops the vestigial `display_name` immediately. Idempotent.

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/013_circle_tokenization.sql`:

```sql
-- infra/postgres/migrations/013_circle_tokenization.sql
-- C-3 Phase A: add per-circle keyed token columns (owner/member/recipient).
-- Additive: plaintext pubkey columns stay until the gateway backfills tokens;
-- migration 014 drops them. display_name is dropped now (vestigial: never
-- written, never read).

ALTER TABLE circles        ADD COLUMN IF NOT EXISTS owner_token     TEXT;
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS member_token    TEXT;
ALTER TABLE location_blobs ADD COLUMN IF NOT EXISTS recipient_token TEXT;

ALTER TABLE circle_members DROP COLUMN IF EXISTS display_name;

-- New uniqueness/lookup by token. member_token is nullable until backfill; NULLs
-- are distinct in a unique index, so legacy un-backfilled rows do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS circle_members_circle_token_uniq
    ON circle_members (circle_id, member_token);
CREATE INDEX IF NOT EXISTS location_blobs_recipient_token_idx
    ON location_blobs (circle_id, recipient_token, expires_at);
```

- [ ] **Step 2: Apply to compose Postgres and verify**

Run (repo root, Docker available):
```bash
docker compose up -d postgres
cat infra/postgres/migrations/013_circle_tokenization.sql | docker compose exec -T postgres psql -U sentinel -d sentinelmesh
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d circles" | grep -E "owner_token|owner_pubkey"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d circle_members" | grep -E "member_token|member_pubkey|display_name"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d location_blobs" | grep -E "recipient_token|recipient_pubkey_hash"
```
Expected: `circles` has both `owner_token` and `owner_pubkey`; `circle_members` has `member_token` and `member_pubkey` and NO `display_name`; `location_blobs` has both `recipient_token` and `recipient_pubkey_hash`. No errors.

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/013_circle_tokenization.sql
git commit -m "C-3: migration 013 — add circle/member/recipient token columns, drop display_name"
```

---

### Task 4: Gateway token backfill at startup

**Files:**
- Modify: `services/gateway/src/main.rs` (backfill fn + call)

Mirrors the C-2 `backfill_report_cells` pattern. Backfills `owner_token` and `member_token` from the still-present plaintext pubkeys. **Does not** backfill `recipient_token` — `location_blobs.recipient_pubkey_hash` is a one-way SHA-256 (no pubkey to recompute from) and blobs are 10-minute ephemeral, so legacy blobs simply expire; new blobs get a token at insert.

- [ ] **Step 1: Add the backfill function**

In `services/gateway/src/main.rs`, add below the existing `backfill_report_cells` function:

```rust
/// One-shot: compute owner/member tokens for legacy circle rows whose token is
/// still NULL, from the plaintext pubkey + CIRCLE_TOKEN_SECRET. Idempotent, no-op
/// on a fresh DB. recipient_token is intentionally NOT backfilled (the legacy
/// column is a one-way hash; blobs are ephemeral and expire).
async fn backfill_circle_tokens(pool: &sqlx::PgPool, secret: &str) -> anyhow::Result<()> {
    let owners: Vec<(uuid::Uuid, String)> =
        sqlx::query_as("SELECT id, owner_pubkey FROM circles WHERE owner_token IS NULL")
            .fetch_all(pool)
            .await?;
    for (id, pk) in owners {
        let token = crate::circles::token::circle_token(secret, id, &pk);
        sqlx::query("UPDATE circles SET owner_token = $2 WHERE id = $1")
            .bind(id)
            .bind(&token)
            .execute(pool)
            .await?;
    }

    let members: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT circle_id, member_pubkey FROM circle_members WHERE member_token IS NULL",
    )
    .fetch_all(pool)
    .await?;
    for (circle_id, pk) in members {
        let token = crate::circles::token::circle_token(secret, circle_id, &pk);
        sqlx::query(
            "UPDATE circle_members SET member_token = $2 WHERE circle_id = $1 AND member_pubkey = $3",
        )
        .bind(circle_id)
        .bind(&token)
        .bind(&pk)
        .execute(pool)
        .await?;
    }
    Ok(())
}
```

Add the call next to the existing `backfill_report_cells` call (after the pools/config exist, before `axum::serve`):

```rust
    if let Err(e) = backfill_report_cells(&db).await {
        tracing::warn!("report cell backfill failed: {e:#}");
    }
    if let Err(e) = backfill_circle_tokens(&db, &config.circle_token_secret).await {
        tracing::warn!("circle token backfill failed: {e:#}");
    }
```

- [ ] **Step 2: Build**

Run:
```bash
cd services/gateway && cargo build 2>&1 | tail -10
```
Expected: compiles (the backfill is wired but the handlers still use pubkeys — that changes in Tasks 5–7).

- [ ] **Step 3: Commit**

```bash
git add services/gateway/src/main.rs
git commit -m "C-3: backfill owner/member tokens for legacy circle rows at startup"
```

---

### Task 5: Tokenize circle membership endpoints + domain types

**Files:**
- Modify: `services/gateway/src/routes/circles.rs` (`Circle`/`CircleMember` structs, all handlers except listing, tests)
- Modify: `services/sentinel-core/src/domain/circle.rs` (`Circle`/`CircleMember` drop pubkeys; tests)

`get_circle`, `add_member`, `remove_member`, `create_circle` recompute the token from `circle_id` + a pubkey and match/insert by it. No raw pubkey is stored or returned. The response gains `is_owner` so the degraded client can do owner-only UI without a pubkey. (`list_circles` is rewritten in Task 6.)

- [ ] **Step 1: Update the domain types**

In `services/sentinel-core/src/domain/circle.rs`, change the structs to drop raw pubkeys (and update the round-trip tests' field names):

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Circle {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_token: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}
```
Update the three tests in that file: replace `owner_pubkey: "abc123".into(),` (drop the line) and `member_pubkey: "def456".into(),` → `member_token: "v1:def456".into(),`, and the matching asserts (drop the `owner_pubkey` assert; `back.member_pubkey` → `back.member_token`).

- [ ] **Step 2: Rewrite `routes/circles.rs` structs + handlers**

In `services/gateway/src/routes/circles.rs`:

Replace the `Circle` and `CircleMember` sqlx structs:

```rust
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_token: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_token: String,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}
```

Add `use crate::circles::token::circle_token;` to the imports.

Replace `create_circle` (generate the UUID app-side so we can compute the owner token before insert):

```rust
async fn create_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<CreateCircleBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let id = Uuid::new_v4();
    let owner_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let circle = sqlx::query_as::<_, Circle>(
        "INSERT INTO circles (id, owner_token, name) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(id)
    .bind(&owner_token)
    .bind(&body.name)
    .fetch_one(&state.db)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": circle.id,
            "name": circle.name,
            "created_at": circle.created_at,
            "is_owner": true,
        })),
    ))
}
```

Replace `get_circle` (authorize by token; return `is_owner` + tokenized members):

```rust
async fn get_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let circle = sqlx::query_as::<_, Circle>("SELECT * FROM circles WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;

    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let is_owner = circle.owner_token == my_token;
    if !is_owner {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM circle_members WHERE circle_id = $1 AND member_token = $2",
        )
        .bind(id)
        .bind(&my_token)
        .fetch_one(&state.db)
        .await?;
        if count == 0 {
            return Err(AppError::Forbidden);
        }
    }

    let members =
        sqlx::query_as::<_, CircleMember>("SELECT * FROM circle_members WHERE circle_id = $1")
            .bind(id)
            .fetch_all(&state.db)
            .await?;

    Ok(Json(serde_json::json!({
        "id": circle.id,
        "name": circle.name,
        "created_at": circle.created_at,
        "is_owner": is_owner,
        "members": members,
    })))
}
```

Replace `add_member` (owner-authorized by token; store member token, never the pubkey):

```rust
async fn add_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    Json(body): Json<AddMemberBody>,
) -> Result<(StatusCode, Json<CircleMember>), AppError> {
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    if owner_token.as_deref() != Some(my_token.as_str()) {
        return Err(AppError::Forbidden);
    }

    let member_token = circle_token(&state.config.circle_token_secret, id, &body.member_pubkey);
    let member = sqlx::query_as::<_, CircleMember>(
        "INSERT INTO circle_members (circle_id, member_token, alert_radius_km, alert_severity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (circle_id, member_token) DO UPDATE
           SET alert_radius_km = EXCLUDED.alert_radius_km,
               alert_severity  = EXCLUDED.alert_severity
         RETURNING *",
    )
    .bind(id)
    .bind(&member_token)
    .bind(body.alert_radius_km)
    .bind(&body.alert_severity)
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(member)))
}
```

Replace `remove_member` (authorize owner-by-token OR self; delete by token; WS emits the token):

```rust
async fn remove_member(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path((circle_id, member_pubkey)): Path<(Uuid, String)>,
) -> Result<StatusCode, AppError> {
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(circle_id)
            .fetch_optional(&state.db)
            .await?;
    let secret = &state.config.circle_token_secret;
    let caller_token = circle_token(secret, circle_id, &auth.pubkey);
    let target_token = circle_token(secret, circle_id, &member_pubkey);
    // Allowed if the caller is the owner, or is removing their own membership.
    if owner_token.as_deref() != Some(caller_token.as_str()) && caller_token != target_token {
        return Err(AppError::Forbidden);
    }

    sqlx::query("DELETE FROM circle_members WHERE circle_id = $1 AND member_token = $2")
        .bind(circle_id)
        .bind(&target_token)
        .execute(&state.db)
        .await?;

    // The token is opaque to clients (no secret); they refresh the circle on receipt.
    let msg = serde_json::json!({ "type": "MEMBER_REMOVED", "token": target_token }).to_string();
    state.circle_hub.broadcast(circle_id, msg.into());

    Ok(StatusCode::NO_CONTENT)
}
```

`delete_circle` keys on the owner: change its `WHERE id = $1 AND owner_pubkey = $2` to use the owner token:

```rust
async fn delete_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let owner_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let result = sqlx::query("DELETE FROM circles WHERE id = $1 AND owner_token = $2")
        .bind(id)
        .bind(&owner_token)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    Ok(StatusCode::NO_CONTENT)
}
```

Update the two `From` impls to the new fields:

```rust
impl From<Circle> for sentinel_core::Circle {
    fn from(row: Circle) -> Self {
        Self { id: row.id, name: row.name, created_at: row.created_at }
    }
}

impl From<CircleMember> for sentinel_core::CircleMember {
    fn from(row: CircleMember) -> Self {
        Self {
            circle_id: row.circle_id,
            member_token: row.member_token,
            alert_radius_km: row.alert_radius_km,
            alert_severity: row.alert_severity,
            joined_at: row.joined_at,
        }
    }
}
```

Update the `#[cfg(test)] mod tests` in `circles.rs` to the new fields: in each test literal drop `owner_pubkey`/replace `member_pubkey: "...".into()` with `member_token: "v1:...".into()`, build `Circle { id, owner_token: "v1:x".into(), name, created_at }` and `CircleMember { circle_id, member_token: "v1:m".into(), .. }`, and update asserts (`d.member_pubkey` → `d.member_token`; drop `d.owner_pubkey`).

- [ ] **Step 3: Build + run circle tests**

Run:
```bash
cd services/gateway && cargo test -p sentinel-core circle 2>&1 | tail -12
cd services/gateway && cargo test routes::circles 2>&1 | tail -12
```
Expected: both compile and pass (the domain round-trips and the `From` conversion tests with the new token fields). `list_circles` still references old behavior — it is rewritten in Task 6; if the crate does not fully build until Task 6, that is expected (Task 6 follows immediately).

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/routes/circles.rs services/sentinel-core/src/domain/circle.rs
git commit -m "C-3: authorize circle membership by per-circle token; drop pubkeys from circle types"
```

---

### Task 6: Client-driven circle listing

**Files:**
- Modify: `services/gateway/src/routes/circles.rs` (`list_circles` + a query type)

`GET /circles?ids=c1,c2,c3`: for each supplied id, the server checks owner/member token membership for `auth.pubkey` and returns metadata only for circles the caller belongs to. No server-side `user → circles` enumeration. Unknown/non-member ids are silently omitted.

- [ ] **Step 1: Rewrite `list_circles`**

In `services/gateway/src/routes/circles.rs`, add `Query` to the axum imports if not present (`use axum::extract::{Path, Query, State};`) and a query type near the other body types:

```rust
#[derive(Deserialize)]
struct ListCirclesQuery {
    /// Comma-separated circle UUIDs the client knows it belongs to.
    ids: Option<String>,
}
```

Replace `list_circles`:

```rust
async fn list_circles(
    State(state): State<AppState>,
    auth: NostrAuth,
    Query(q): Query<ListCirclesQuery>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    // Client-driven: the server holds no user->circles index. The client supplies
    // the ids it knows; we return metadata only for the ones it belongs to.
    let ids: Vec<Uuid> = q
        .ids
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| Uuid::parse_str(s.trim()).ok())
        .collect();
    if ids.is_empty() {
        return Ok(Json(vec![]));
    }

    let secret = &state.config.circle_token_secret;
    let mut out = Vec::new();
    for id in ids {
        let circle = sqlx::query_as::<_, Circle>("SELECT * FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
        let Some(circle) = circle else { continue };
        let my_token = circle_token(secret, id, &auth.pubkey);
        let is_owner = circle.owner_token == my_token;
        let is_member = if is_owner {
            true
        } else {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM circle_members WHERE circle_id = $1 AND member_token = $2",
            )
            .bind(id)
            .bind(&my_token)
            .fetch_one(&state.db)
            .await?;
            count > 0
        };
        if !is_member {
            continue;
        }
        out.push(serde_json::json!({
            "id": circle.id,
            "name": circle.name,
            "created_at": circle.created_at,
            "is_owner": is_owner,
        }));
    }
    Ok(Json(out))
}
```

- [ ] **Step 2: Build + run circle tests**

Run:
```bash
cd services/gateway && cargo test routes::circles 2>&1 | tail -12
```
Expected: the crate compiles and the `routes::circles` tests pass.

- [ ] **Step 3: Integration smoke (compose) — tokenized circle round-trip**

Verifies the DB-level behavior (rebuild the gateway image). Run:
```bash
docker compose up -d --build gateway-rs postgres redis
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) AS plaintext_owner_cols FROM information_schema.columns WHERE table_name='circles' AND column_name='owner_token';"
```
Expected: `owner_token` column present (count 1). (Full request-level verification — create circle, add member, GET ?ids= — runs in CI / manual; record if the image cannot be rebuilt here and rely on the unit tests.)

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/routes/circles.rs
git commit -m "C-3: client-driven circle listing (GET /circles?ids=), no server-side enumeration"
```

---

### Task 7: Server-only H-1 fix — tokenize blob recipient

**Files:**
- Modify: `services/gateway/src/routes/location_blobs.rs` (`LocationBlob`/`PushBlobBody`, `push_blob`, `list_blobs`, `is_circle_member`, `From` impl, test)
- Modify: `services/sentinel-core/src/domain/location.rs` (`LocationBlob.recipient_pubkey_hash` → `recipient_token`)

Replaces the reversible `SHA256(pubkey)` recipient hash with the salted per-circle token. The pre-existing publisher/WS mismatch is left untouched.

- [ ] **Step 1: Update the domain type**

In `services/sentinel-core/src/domain/location.rs`, rename the field `recipient_pubkey_hash` → `recipient_token` on `LocationBlob` and update its round-trip test field/assert accordingly (`recipient_pubkey_hash: "hash".into()` → `recipient_token: "v1:hash".into()`, and the matching assert).

- [ ] **Step 2: Rewrite `location_blobs.rs`**

In `services/gateway/src/routes/location_blobs.rs`:

Drop the now-unused `use sha2::{Digest, Sha256};` import and add `use crate::circles::token::circle_token;`.

Change the `LocationBlob` struct field `recipient_pubkey_hash` → `recipient_token`, and `is_circle_member` to authorize by token. Replace `is_circle_member`:

```rust
async fn is_circle_member(
    db: &sqlx::PgPool,
    secret: &str,
    circle_id: Uuid,
    pubkey: &str,
) -> anyhow::Result<bool> {
    let token = circle_token(secret, circle_id, pubkey);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (
           SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_token = $2
           UNION
           SELECT 1 FROM circles WHERE id = $1 AND owner_token = $2
         ) sub",
    )
    .bind(circle_id)
    .bind(&token)
    .fetch_one(db)
    .await?;
    Ok(count > 0)
}
```

Change `PushBlobBody` to take the raw recipient pubkey (server tokenizes):

```rust
#[derive(Deserialize)]
struct PushBlobBody {
    encrypted_payload: String,
    sender_ephemeral_pubkey: String,
    recipient_pubkey: String,
}
```

Replace `push_blob` (authorize sender by token; tokenize the recipient; store the token):

```rust
async fn push_blob(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(circle_id): Path<Uuid>,
    Json(body): Json<PushBlobBody>,
) -> Result<(StatusCode, Json<LocationBlob>), AppError> {
    let secret = &state.config.circle_token_secret;
    if !is_circle_member(&state.db, secret, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }
    let recipient_token = circle_token(secret, circle_id, &body.recipient_pubkey);

    let blob = sqlx::query_as::<_, LocationBlob>(
        "INSERT INTO location_blobs (id, circle_id, recipient_token, sender_ephemeral_pubkey, encrypted_payload, expires_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW() + INTERVAL '10 minutes')
         RETURNING *",
    )
    .bind(circle_id)
    .bind(&recipient_token)
    .bind(&body.sender_ephemeral_pubkey)
    .bind(&body.encrypted_payload)
    .fetch_one(&state.db)
    .await?;

    let msg = serde_json::json!({ "type": "CIRCLE_LOCATION_BLOB", "payload": blob }).to_string();
    state.circle_hub.broadcast(circle_id, msg.into());

    Ok((StatusCode::CREATED, Json(blob)))
}
```

Replace `list_blobs` (filter by the requester's token, not a SHA-256):

```rust
async fn list_blobs(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(circle_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let secret = &state.config.circle_token_secret;
    if !is_circle_member(&state.db, secret, circle_id, &auth.pubkey).await? {
        return Err(AppError::Forbidden);
    }
    let recipient_token = circle_token(secret, circle_id, &auth.pubkey);

    let blobs = sqlx::query_as::<_, LocationBlob>(
        "SELECT * FROM location_blobs
         WHERE circle_id = $1 AND recipient_token = $2 AND expires_at > NOW()",
    )
    .bind(circle_id)
    .bind(&recipient_token)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "blobs": blobs })))
}
```

Update the `From<LocationBlob>` impl field `recipient_pubkey_hash` → `recipient_token`, and the `location_blob_converts_to_domain` test (`recipient_pubkey_hash: "hash".into()` → `recipient_token: "v1:hash".into()`, and the assert).

- [ ] **Step 3: Build + run**

Run:
```bash
cd services/gateway && cargo test -p sentinel-core location 2>&1 | tail -10
cd services/gateway && cargo test routes::location_blobs 2>&1 | tail -10
```
Expected: both compile and pass.

- [ ] **Step 4: Commit**

```bash
git add services/gateway/src/routes/location_blobs.rs services/sentinel-core/src/domain/location.rs
git commit -m "C-3: tokenize location-blob recipient (H-1 fix); filter by requester token"
```

---

### Task 8: Migration 014 — drop plaintext pubkeys

**Files:**
- Create: `infra/postgres/migrations/014_circle_drop_plaintext.sql`

Applied after the gateway backfill (Task 4) has populated tokens. Drops the plaintext pubkey columns (the graph leak). Keeps `circles.name` (Phase B). Idempotent.

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/014_circle_drop_plaintext.sql`:

```sql
-- infra/postgres/migrations/014_circle_drop_plaintext.sql
-- C-3 Phase A: drop the plaintext social-graph columns once tokens are backfilled.
-- Run AFTER the gateway token backfill (owner_token/member_token populated).
-- circles.name is intentionally KEPT (encrypted in Phase B, dropped in 016).

DROP INDEX IF EXISTS idx_reports_pubkey;  -- no-op guard (unrelated); harmless
DROP INDEX IF EXISTS idx_blobs_recipient; -- old recipient_pubkey_hash index

ALTER TABLE circles        DROP COLUMN IF EXISTS owner_pubkey;
ALTER TABLE circle_members DROP COLUMN IF EXISTS member_pubkey;       -- drops UNIQUE(circle_id, member_pubkey)
ALTER TABLE location_blobs DROP COLUMN IF EXISTS recipient_pubkey_hash;
```

- [ ] **Step 2: Apply to compose Postgres and verify the graph is gone**

Run:
```bash
cat infra/postgres/migrations/014_circle_drop_plaintext.sql | docker compose exec -T postgres psql -U sentinel -d sentinelmesh
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) AS leftover FROM information_schema.columns WHERE (table_name='circles' AND column_name='owner_pubkey') OR (table_name='circle_members' AND column_name='member_pubkey') OR (table_name='location_blobs' AND column_name='recipient_pubkey_hash');"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) AS name_kept FROM information_schema.columns WHERE table_name='circles' AND column_name='name';"
```
Expected: `leftover = 0` (all plaintext pubkey columns gone); `name_kept = 1` (circle name retained for Phase B).

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/014_circle_drop_plaintext.sql
git commit -m "C-3: migration 014 — drop plaintext owner/member/recipient pubkeys"
```

---

### Task 9: Shared TS types

**Files:**
- Modify: `shared/types/index.d.ts` (`Circle`, `CircleMember`, `LocationBlob`)

Mirror the Rust domain changes so the PWA typechecks against the new shapes.

- [ ] **Step 1: Update the types**

In `shared/types/index.d.ts`:
- `Circle`: remove `owner_pubkey`; add `is_owner?: boolean` (returned by the API per-viewer). Keep `circle_id`, `name`, `created_at`.
- `CircleMember`: replace `member_pubkey: string` with `member_token: string`.
- `LocationBlob` (if present): rename `recipient_pubkey_hash` → `recipient_token`.

(Read the file first to match exact field placement; change only these fields.)

- [ ] **Step 2: Typecheck**

Run:
```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | head -40
```
Expected: `tsc` now reports errors in the PWA files that still read `owner_pubkey`/`member_pubkey` (e.g. `useCircles.ts`, `circlesSlice.ts`, `FamilyCircleDashboard.tsx`). That is expected — Tasks 10–11 fix them. Record the list of erroring files to drive Tasks 10–11.

- [ ] **Step 3: Commit**

```bash
git add shared/types/index.d.ts
git commit -m "C-3: shared types drop circle/member pubkeys, add tokens + is_owner"
```

---

### Task 10: PWA — persist circle ids + client-driven listing

**Files:**
- Create: `apps/pwa/src/services/circleIdStore.ts` (+ test)
- Modify: `apps/pwa/src/hooks/useCircles.ts`
- Modify: `apps/pwa/src/components/FamilyCircleDashboard.tsx` (persist id on create/join)

The PWA no longer gets its circles from server enumeration. It persists the ids it knows (created or joined) and supplies them to `?ids=`.

- [ ] **Step 1: Write the id store + test**

Create `apps/pwa/src/services/circleIdStore.ts`:

```ts
// Local record of the circle ids this device belongs to. The server no longer
// enumerates a user's circles (C-3 privacy), so the client tracks its own ids
// (learned on create, and from the invite string on join) and supplies them to
// GET /api/circles?ids=. Fresh-device discovery is a separate (H-3) concern.
const KEY = 'sentinelmesh:circle_ids'

export function getCircleIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function addCircleId(id: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = new Set(getCircleIds())
  ids.add(id)
  localStorage.setItem(KEY, JSON.stringify([...ids]))
}

export function removeCircleId(id: string): void {
  if (typeof localStorage === 'undefined') return
  const ids = getCircleIds().filter(x => x !== id)
  localStorage.setItem(KEY, JSON.stringify(ids))
}
```

Create `apps/pwa/src/services/__tests__/circleIdStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getCircleIds, addCircleId, removeCircleId } from '../circleIdStore'

describe('circleIdStore', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty', () => {
    expect(getCircleIds()).toEqual([])
  })

  it('adds and dedupes ids', () => {
    addCircleId('a'); addCircleId('b'); addCircleId('a')
    expect(getCircleIds().sort()).toEqual(['a', 'b'])
  })

  it('removes an id', () => {
    addCircleId('a'); addCircleId('b'); removeCircleId('a')
    expect(getCircleIds()).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Drive listing from stored ids in `useCircles.ts`**

In `apps/pwa/src/hooks/useCircles.ts`: import `getCircleIds` and change the listing fetch to supply `?ids=`, and adapt `RawCircle`/`toCircle`/`toMember`/`RawMember` to the tokenized shapes. Replace the file body's types + load logic:

```ts
import { getCircleIds } from '../services/circleIdStore'
// ...
interface RawCircle { id: string; name: string; created_at: string; is_owner?: boolean }
interface RawMember { circle_id: string; member_token: string; alert_radius_km: number | null; alert_severity: string | null; joined_at: string }
interface RawCircleDetail extends RawCircle { members: RawMember[] }

function toCircle(raw: RawCircle): Circle {
  return { circle_id: raw.id, name: raw.name, created_at: raw.created_at, is_owner: raw.is_owner ?? false }
}

function toMember(raw: RawMember): CircleMember {
  return {
    circle_id: raw.circle_id,
    member_token: raw.member_token,
    alert_radius_km: raw.alert_radius_km ?? 5,
    alert_severity: (raw.alert_severity ?? 'MEDIUM') as CircleMember['alert_severity'],
    joined_at: raw.joined_at,
  }
}
```
and in `load()` replace the list fetch:

```ts
      const ids = getCircleIds()
      if (ids.length === 0) return
      let circles: RawCircle[]
      try {
        const res = await fetch(`${API_BASE}/api/circles?ids=${ids.join(',')}`, { headers, signal: AbortSignal.timeout(15_000) })
        if (!res.ok) return
        circles = await res.json() as RawCircle[]
      } catch {
        return
      }
```
(The per-circle detail fetch loop below it is unchanged except it now receives the tokenized `RawCircleDetail`.)

- [ ] **Step 3: Persist the id on create/join in `FamilyCircleDashboard.tsx`**

In `apps/pwa/src/components/FamilyCircleDashboard.tsx`, import `addCircleId` from `'../services/circleIdStore'`. After a successful `create_circle` response (the `fetch('/api/circles', { method: POST ... })` that returns the new circle), call `addCircleId(created.id)` with the response id. In the join/invite-accept path (where the app parses the invite string `sm:circle:{id}:...` and the user joins), call `addCircleId(id)` with the parsed circle id. (Read the file to place these at the exact success sites; add only these two calls.)

- [ ] **Step 4: Typecheck + run the new test**

Run:
```bash
cd apps/pwa && npx vitest run src/services/__tests__/circleIdStore.test.ts 2>&1 | tail -10
```
Expected: PASS. (`tsc` still has errors from the roster in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/circleIdStore.ts apps/pwa/src/services/__tests__/circleIdStore.test.ts apps/pwa/src/hooks/useCircles.ts apps/pwa/src/components/FamilyCircleDashboard.tsx
git commit -m "C-3: PWA persists circle ids locally and drives listing by ids"
```

---

### Task 11: PWA — degraded roster

**Files:**
- Modify: `apps/pwa/src/store/circlesSlice.ts` (member seeding by token)
- Modify: `apps/pwa/src/components/FamilyCircleDashboard.tsx` / `apps/pwa/src/components/CircleSidebar.tsx` (render by token; owner UI via `is_owner`)
- Modify: affected tests (`circlesSlice.test.ts`, `FamilyCircleDashboard.test.tsx`, `CircleSidebar.test.tsx`)

Members now arrive as opaque `member_token`s with no pubkey. The roster shows a count + token-keyed rows; live presence/locations still work because the circle WS delivers `sender_pubkey` (unchanged). Owner-only UI uses the new `is_owner` flag instead of comparing pubkeys.

- [ ] **Step 1: Update `circlesSlice.ts` member seeding**

In `apps/pwa/src/store/circlesSlice.ts`, the `circleLoaded` reducer seeds `memberStatuses` by `m.member_pubkey`, which no longer exists. Since live presence is keyed by `sender_pubkey` from the WS (not the roster), drop the seeding loop:

```ts
    circleLoaded(state, action: PayloadAction<{ circle: Circle; members: CircleMember[] }>) {
      const { circle, members } = action.payload
      const existing = state.circles.findIndex(c => c.circle_id === circle.circle_id)
      if (existing >= 0) {
        state.circles[existing] = circle
      } else {
        state.circles.push(circle)
      }
      state.members[circle.circle_id] = members
      state.activeCircleId = circle.circle_id
      // No pubkey-keyed seeding: the roster carries opaque member_tokens now;
      // presence is keyed by sender_pubkey from the circle WS as locations arrive.
    },
```

- [ ] **Step 2: Render the degraded roster + owner UI**

In `FamilyCircleDashboard.tsx` / `CircleSidebar.tsx`: the member list `key` and any per-member rendering must use `member.member_token` instead of `member.member_pubkey` (the count `Members · ${members.length}` is unchanged). Replace the owner check (which compared `activeCircle.owner_pubkey` / a pubkey to the user) with the circle's `is_owner` flag (now on `Circle`). For each member row, since there is no name/pubkey yet, render a short token-derived label (e.g. `Member ${member.member_token.slice(3, 9)}`) — Phase B replaces this with the decrypted label. Read both files and make only these substitutions (member key/label, owner gate). Remove any remaining reads of `owner_pubkey`/`member_pubkey`.

- [ ] **Step 3: Update affected tests + typecheck**

Run:
```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | head -40
```
Fix any remaining `owner_pubkey`/`member_pubkey` reads the compiler flags (apply the same substitutions). Update test fixtures in `circlesSlice.test.ts`, `FamilyCircleDashboard.test.tsx`, `CircleSidebar.test.tsx` that build `Circle`/`CircleMember` objects: drop `owner_pubkey`, replace `member_pubkey: '...'` with `member_token: 'v1:...'`, add `is_owner` where a test asserts owner UI. Re-run until `tsc` exits 0. Then:
```bash
cd apps/pwa && npx vitest run src/store/__tests__/circlesSlice.test.ts src/components/__tests__/FamilyCircleDashboard.test.tsx src/components/__tests__/CircleSidebar.test.tsx 2>&1 | tail -15
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pwa/src/store/circlesSlice.ts apps/pwa/src/components/FamilyCircleDashboard.tsx apps/pwa/src/components/CircleSidebar.tsx apps/pwa/src/store/__tests__/circlesSlice.test.ts apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx apps/pwa/src/components/__tests__/CircleSidebar.test.tsx
git commit -m "C-3: PWA degraded roster (token-keyed members, is_owner UI)"
```

---

### Task 12: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Gateway fmt/clippy/tests as CI does**

Run:
```bash
cd services/gateway && cargo fmt --all && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^error|^warning"; echo "clippy done"
cd services/gateway && cargo test 2>&1 | tail -8
```
Expected: `fmt --check` clean (commit any reformat); clippy prints no error/warning lines; all gateway tests pass.

- [ ] **Step 2: PWA full suite + typecheck**

Run:
```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?" && npx vitest run 2>&1 | tail -8
```
Expected: `tsc:0`; all PWA tests pass.

- [ ] **Step 3: Fresh-DB migration check (CI parity)**

Confirm 013 + 014 apply cleanly on a fresh database as a non-`sentinel` role (the CI parity check that bit C-2). Run:
```bash
docker compose exec -T postgres psql -U sentinel -d postgres -q -c "DROP DATABASE IF EXISTS c3_ci;" -c "DROP ROLE IF EXISTS c3_user;" -c "CREATE ROLE c3_user SUPERUSER LOGIN;" -c "CREATE DATABASE c3_ci OWNER c3_user;"
cat infra/postgres/init.sql | docker compose exec -T postgres psql -U c3_user -d c3_ci -v ON_ERROR_STOP=1 -q 2>&1 | grep -iE "error" || echo "init OK"
for m in 013_circle_tokenization 014_circle_drop_plaintext; do echo "== $m =="; cat infra/postgres/migrations/${m}.sql | docker compose exec -T postgres psql -U c3_user -d c3_ci -v ON_ERROR_STOP=1 -q >/tmp/$m.out 2>&1; echo "exit:$?"; grep -iE "error" /tmp/$m.out || echo "(no errors)"; done
docker compose exec -T postgres psql -U sentinel -d postgres -q -c "DROP DATABASE IF EXISTS c3_ci;" -c "DROP ROLE IF EXISTS c3_user;"
```
Expected: `init OK`; both migrations `exit:0` with `(no errors)`. (013/014 reference no hardcoded role names, so this passes; if 005 PostGIS fails on the local alpine image, that is a local-image limitation unrelated to C-3 — note it and rely on the compose checks in Tasks 3/8.)

- [ ] **Step 4: Commit any fixups, push, open PR**

```bash
git add -A && git commit -m "C-3: fmt/lint fixups" || echo "nothing to commit"
git push -u origin feat/c3-phase-a-tokenization
gh pr create --base main --head feat/c3-phase-a-tokenization \
  --title "C-3 Phase A: backend tokenization (eliminate plaintext social graph)" \
  --body "Implements Phase A of docs/superpowers/specs/2026-06-05-c3-social-graph-privacy-design.md. Replaces stored owner/member/recipient pubkeys with per-circle keyed tokens (v1:HMAC-SHA256(CIRCLE_TOKEN_SECRET, circle_id||pubkey)), removes server-side circle enumeration (client-driven GET /circles?ids=), and tokenizes the location-blob recipient (H-1). Migration 013 adds token columns + startup backfill; 014 drops the plaintext pubkeys. PWA persists circle ids locally and shows a degraded (unlabeled) roster + is_owner; encrypted names/labels and the rich roster are Phase B. Pre-existing location-publisher/WS payload mismatch is out of scope."
```

---

## Self-Review

- **Spec coverage (Phase A rows):** token primitive `v1:HMAC` (Task 1); dedicated stable `CIRCLE_TOKEN_SECRET` (Task 2); migration 013 add tokens + drop `display_name` (Task 3); gateway backfill, recipient not backfilled (Task 4); tokenized owner/member auth + `is_owner`, domain types drop pubkeys (Task 5); client-driven listing (Task 6); server-only H-1 recipient token (Task 7); migration 014 drop plaintext pubkeys, keep `circles.name` (Task 8); shared TS types (Task 9); PWA id persistence + ids-listing (Task 10); degraded roster + `is_owner` UI (Task 11); fmt/clippy/tests + fresh-DB CI-parity check + PR (Task 12). Phase B (name/label ciphertext, rich roster, lazy migration, migrations 015/016) is correctly absent.
- **Placeholder scan:** none — every code step has full Rust/SQL/TS and exact commands with expected output. Tasks 3 Step 1, 5 Step 2, 7 Step 2, 8 Step 1 give complete migration/handler code. The two `FamilyCircleDashboard`/`CircleSidebar` substitution steps (10 Step 3, 11 Step 2) name the exact edits (id persistence calls; member key/label and `is_owner` gate) rather than dumping the large unrelated component bodies — acceptable because the change is a localized substitution the engineer applies by reading the file.
- **Type consistency:** `circle_token(secret: &str, circle_id: Uuid, pubkey: &str) -> String` (Task 1) is called identically in the backfill (Task 4), every handler (Tasks 5–7). `owner_token`/`member_token`/`recipient_token` column names match across migration 013 (Task 3), backfill (Task 4), the sqlx structs + queries (Tasks 5–7), and the drop in 014 (Task 8). `is_owner` is produced by the API (Tasks 5–6) and consumed by the PWA `Circle` type (Tasks 9–11). `member_token`/`recipient_token` replace the pubkey fields consistently in the Rust domain types (Tasks 5, 7), the TS types (Task 9), and the PWA mappers (Tasks 10–11).
- **Known follow-ups (Phase B):** encrypted `name_ciphertext`/`name_version` + `member_label_ciphertext` (migration 015), client-side name/label encryption, the rich decrypted roster (recovering pubkeys for presence), lazy migration via `PUT /circles/:id/encryption`, and migration 016 dropping `circles.name`.
