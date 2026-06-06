# C-3 Phase B — Client Encryption (names + member labels) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the remaining circle metadata from a DB breach and restore the rich roster: encrypt the circle **name** and each **member label** (`{pubkey, name}`) under the circle key (server stores only ciphertext), decrypt them client-side to render real names/people and recover member pubkeys (restoring presence + per-member proximity), and lazily migrate legacy plaintext circles.

**Architecture:** Phase A tokenized identifiers and left `circles.name` plaintext + the roster unlabeled. Phase B adds `name_ciphertext`/`name_version` (circles) and `member_label_ciphertext` (circle_members), all AES-GCM under the circle key the server never sees. The gateway just stores/returns opaque ciphertext; the PWA encrypts on create/add, decrypts to render, and recovers each member's pubkey from the decrypted label so presence/status and per-member proximity work again. A `PUT /circles/:id/encryption` endpoint performs the lazy migration of pre-Phase-B circles (`name_version=0`); migration 016 (deferred) drops the legacy `circles.name` once migration converges.

**Tech Stack:** Rust (gateway, sqlx), PostgreSQL (numbered migrations), TypeScript/React PWA (WebCrypto AES-GCM via the existing `e2eeService`, vitest + tsc).

**Spec:** `docs/superpowers/specs/2026-06-05-c3-social-graph-privacy-design.md` (Parts B Phase-B migrations, E, F; the Phase-B rows).

**Depends on:** C-3 Phase A (merged): per-circle tokens, `circle_token`, tokenized circle/blob endpoints, `circles.owner_token`/`circle_members.member_token`, client-side circle keys in `e2eeService` (`encryptLocation`/`decryptLocation`, `loadCircleKey`), the PWA degraded roster, and `circleIdStore`.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- Gateway: `cd services/gateway && cargo test` / `cargo build`; DB verified against compose Postgres (Docker available).
- PWA: `cd apps/pwa && npx vitest run <files>` and `npx tsc --noEmit`.
- App DB role in dev/compose is `sentinel`.

**Scope note (Phase B only):** No changes to the token primitive, tokenized authorization, or client-driven listing (all Phase A, done). The `circles.name` column stays until migration 016 (deferred drop). The pre-existing location-publisher/circle-WS payload mismatch remains out of scope.

**Key design facts (carry through every task):**
- `name_version`: `0` = legacy plaintext still in `circles.name`; `1` = AES-GCM in `circles.name_ciphertext`. New circles are born `name_version=1` (name_ciphertext set, `name` left NULL — the column is nullable). Clients render: if `name_version==1` decrypt `name_ciphertext`, else show legacy `name`.
- `member_label_ciphertext` = AES-GCM(circle key) of JSON `{pubkey, name}` supplied by the owner. Decrypting it both labels the member AND recovers the pubkey (so `memberStatuses`/proximity, keyed on pubkey from the WS, work again). New members get a label at add-time; legacy members the owner can still identify locally get one via the lazy migration; others remain unlabeled (shown as "unknown") until re-added.
- The owner cannot reverse a `member_token` to a pubkey (no secret), so labels are only ever produced by a party that already knows the member's pubkey (the owner at add-time, or the owner's local records during lazy migration).

---

### Task 1: Migration 015 — name + label ciphertext columns

**Files:**
- Create: `infra/postgres/migrations/015_circle_name_label_ciphertext.sql`

Additive, idempotent. (Migration 016, the deferred `circles.name` drop, is Task 9.)

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/015_circle_name_label_ciphertext.sql`:

```sql
-- infra/postgres/migrations/015_circle_name_label_ciphertext.sql
-- C-3 Phase B: encrypted circle name + per-member label.
--   * circles.name_ciphertext / name_version (0=legacy plaintext in `name`,
--     1=AES-GCM(circle key) in name_ciphertext). Legacy rows default to 0.
--   * circle_members.member_label_ciphertext (AES-GCM(circle key) of {pubkey,name}).
-- Additive only. circles.name is kept until the lazy migration converges
-- (dropped in migration 016).

ALTER TABLE circles
    ADD COLUMN IF NOT EXISTS name_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS name_version    SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE circle_members
    ADD COLUMN IF NOT EXISTS member_label_ciphertext TEXT;
```

- [ ] **Step 2: Apply to compose Postgres and verify**

Run (repo root, Docker available):
```bash
docker compose up -d postgres
cat infra/postgres/migrations/015_circle_name_label_ciphertext.sql | docker compose exec -T postgres psql -U sentinel -d sentinelmesh
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d circles" | grep -E "name_ciphertext|name_version|^ name"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c "\d circle_members" | grep -E "member_label_ciphertext"
```
Expected: `circles` has `name_ciphertext`, `name_version` (default 0), and still has `name`; `circle_members` has `member_label_ciphertext`. No errors.

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/015_circle_name_label_ciphertext.sql
git commit -m "C-3 Phase B: migration 015 — name_ciphertext/name_version + member_label_ciphertext"
```

---

### Task 2: PWA — generic string encrypt/decrypt under the circle key

**Files:**
- Modify: `apps/pwa/src/services/e2eeService.ts` (add `encryptString`/`decryptString`)
- Modify: `apps/pwa/src/services/__tests__/e2eeService.test.ts` (round-trip test)

`encryptLocation`/`decryptLocation` already AES-GCM a JSON payload under the circle key. Factor the same primitive for arbitrary strings (used for the circle name and the member-label JSON).

- [ ] **Step 1: Write the failing test**

In `apps/pwa/src/services/__tests__/e2eeService.test.ts`, add (the test file already imports from `../e2eeService` and uses `generateCircleKey`):

```ts
import { encryptString, decryptString } from '../e2eeService'

describe('encryptString/decryptString', () => {
  it('round-trips a UTF-8 string under the circle key', async () => {
    const key = await generateCircleKey()
    const ct = await encryptString(key, 'Family Emergency Circle 🌍')
    expect(ct).not.toContain('Family')
    expect(await decryptString(key, ct)).toBe('Family Emergency Circle 🌍')
  })

  it('returns null when decrypting with the wrong key', async () => {
    const a = await generateCircleKey()
    const b = await generateCircleKey()
    const ct = await encryptString(a, 'secret')
    expect(await decryptString(b, ct)).toBeNull()
  })

  it('returns null on malformed ciphertext', async () => {
    const key = await generateCircleKey()
    expect(await decryptString(key, 'not-base64-$$')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/e2eeService.test.ts 2>&1 | tail -15
```
Expected: FAIL — `encryptString`/`decryptString` are not exported.

- [ ] **Step 3: Implement the helpers**

In `apps/pwa/src/services/e2eeService.ts`, add (reusing the existing `encodeB64`/`decodeB64` helpers in that file):

```ts
/** AES-GCM encrypt a UTF-8 string under the circle key (random 12-byte IV). */
export async function encryptString(circleKey: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, circleKey, new TextEncoder().encode(text),
  )
  return encodeB64(iv, ciphertext)
}

/** Decrypt a string produced by encryptString. Returns null on any failure. */
export async function decryptString(circleKey: CryptoKey, ciphertextB64: string): Promise<string | null> {
  try {
    const decoded = decodeB64(ciphertextB64)
    if (!decoded) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decoded.iv as unknown as BufferSource },
      circleKey,
      decoded.data as unknown as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/e2eeService.test.ts 2>&1 | tail -15
```
Expected: PASS — the three `encryptString/decryptString` cases plus the pre-existing e2ee tests.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/e2eeService.ts apps/pwa/src/services/__tests__/e2eeService.test.ts
git commit -m "C-3 Phase B: add AES-GCM string encrypt/decrypt under the circle key"
```

---

### Task 3: Gateway — store/return name + label ciphertext

**Files:**
- Modify: `services/gateway/src/routes/circles.rs` (`Circle`/`CircleMember` structs, `CreateCircleBody`/`AddMemberBody`, `create_circle`/`add_member`/`get_circle`/`list_circles`, tests)

The server stores/returns ciphertext opaquely. `create_circle` now takes `name_ciphertext` (born `name_version=1`, `name` left NULL); `add_member` takes `member_label_ciphertext`; reads return the ciphertext + `name_version`.

- [ ] **Step 1: Update the structs + request bodies**

In `services/gateway/src/routes/circles.rs`, change the sqlx structs and request bodies:

```rust
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Circle {
    pub id: Uuid,
    pub owner_token: String,
    pub name: Option<String>,
    pub name_ciphertext: Option<String>,
    pub name_version: i16,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CircleMember {
    pub circle_id: Uuid,
    pub member_token: String,
    pub member_label_ciphertext: Option<String>,
    pub alert_radius_km: Option<f64>,
    pub alert_severity: Option<String>,
    pub joined_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateCircleBody {
    name_ciphertext: String,
}

#[derive(Deserialize)]
struct AddMemberBody {
    member_pubkey: String,
    member_label_ciphertext: String,
    alert_radius_km: Option<f64>,
    alert_severity: Option<String>,
}
```
(`circles.name` is now nullable in the struct because new circles leave it NULL. `name_version` is `i16` to match Postgres `SMALLINT`.)

- [ ] **Step 2: Rewrite `create_circle`**

Replace the `create_circle` body so it stores `name_ciphertext` + `name_version=1` (leaving `name` NULL) and returns the ciphertext:

```rust
async fn create_circle(
    State(state): State<AppState>,
    auth: NostrAuth,
    Json(body): Json<CreateCircleBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let id = Uuid::new_v4();
    let owner_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    let circle = sqlx::query_as::<_, Circle>(
        "INSERT INTO circles (id, owner_token, name_ciphertext, name_version)
         VALUES ($1, $2, $3, 1) RETURNING *",
    )
    .bind(id)
    .bind(&owner_token)
    .bind(&body.name_ciphertext)
    .fetch_one(&state.db)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": circle.id,
            "name_ciphertext": circle.name_ciphertext,
            "name_version": circle.name_version,
            "created_at": circle.created_at,
            "is_owner": true,
        })),
    ))
}
```

- [ ] **Step 3: Rewrite `add_member` to store the label**

In `add_member`, add `member_label_ciphertext` to the INSERT (and the `DO UPDATE`):

```rust
    let member_token = circle_token(&state.config.circle_token_secret, id, &body.member_pubkey);
    let member = sqlx::query_as::<_, CircleMember>(
        "INSERT INTO circle_members
           (circle_id, member_token, member_label_ciphertext, alert_radius_km, alert_severity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (circle_id, member_token) DO UPDATE
           SET member_label_ciphertext = EXCLUDED.member_label_ciphertext,
               alert_radius_km         = EXCLUDED.alert_radius_km,
               alert_severity          = EXCLUDED.alert_severity
         RETURNING *",
    )
    .bind(id)
    .bind(&member_token)
    .bind(&body.member_label_ciphertext)
    .bind(body.alert_radius_km)
    .bind(&body.alert_severity)
    .fetch_one(&state.db)
    .await?;
```

- [ ] **Step 4: Return ciphertext + version from `get_circle` and `list_circles`**

In `get_circle`, change the returned JSON to expose name ciphertext/version (members already serialize via the updated `CircleMember` struct, which now includes `member_label_ciphertext`):

```rust
    Ok(Json(serde_json::json!({
        "id": circle.id,
        "name": circle.name,
        "name_ciphertext": circle.name_ciphertext,
        "name_version": circle.name_version,
        "created_at": circle.created_at,
        "is_owner": is_owner,
        "members": members,
    })))
```
In `list_circles`, change the `out.push(...)` JSON likewise:

```rust
        out.push(serde_json::json!({
            "id": circle.id,
            "name": circle.name,
            "name_ciphertext": circle.name_ciphertext,
            "name_version": circle.name_version,
            "created_at": circle.created_at,
            "is_owner": is_owner,
        }));
```
(`name` is still returned so a version-0 legacy circle renders until lazily migrated.)

- [ ] **Step 5: Build + run circle tests**

```bash
cd services/gateway && cargo test routes::circles 2>&1 | tail -12
```
Expected: compiles and `routes::circles` tests pass. (If the `From<Circle>`/`From<CircleMember>` impls or their tests reference the old field set, update them: `sentinel_core::Circle` has no name fields so its `From` is unaffected; `sentinel_core::CircleMember` gains nothing — the `member_label_ciphertext` lives only on the route struct, so the `From<CircleMember>` impl ignores it. Confirm the `From` impls still compile and the conversion tests still pass; adjust the test literals to include the new struct fields `name: None, name_ciphertext: None, name_version: 0` / `member_label_ciphertext: None`.)

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/circles.rs
git commit -m "C-3 Phase B: store/return encrypted circle name + member label ciphertext"
```

---

### Task 4: Gateway — lazy-migration endpoint `PUT /circles/:id/encryption`

**Files:**
- Modify: `services/gateway/src/routes/circles.rs` (new handler + route + test)

Owner-only. Sets `circles.name_ciphertext`, `name_version=1`, clears legacy `name`, and updates `member_label_ciphertext` for the members the owner can still identify (it supplies `{member_token, label_ciphertext}` pairs it reconstructed from its local records). Members not covered keep a NULL label (shown "unknown") until re-added.

- [ ] **Step 1: Add the body type + handler**

In `services/gateway/src/routes/circles.rs`, add near the other body types:

```rust
#[derive(Deserialize)]
struct MemberLabel {
    member_token: String,
    label_ciphertext: String,
}

#[derive(Deserialize)]
struct SetEncryptionBody {
    name_ciphertext: String,
    #[serde(default)]
    member_labels: Vec<MemberLabel>,
}
```

Add the handler:

```rust
async fn set_encryption(
    State(state): State<AppState>,
    auth: NostrAuth,
    Path(id): Path<Uuid>,
    Json(body): Json<SetEncryptionBody>,
) -> Result<StatusCode, AppError> {
    let owner_token: Option<String> =
        sqlx::query_scalar("SELECT owner_token FROM circles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let my_token = circle_token(&state.config.circle_token_secret, id, &auth.pubkey);
    if owner_token.as_deref() != Some(my_token.as_str()) {
        return Err(AppError::Forbidden);
    }

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE circles SET name_ciphertext = $2, name_version = 1, name = NULL WHERE id = $1",
    )
    .bind(id)
    .bind(&body.name_ciphertext)
    .execute(&mut *tx)
    .await?;

    for label in &body.member_labels {
        sqlx::query(
            "UPDATE circle_members SET member_label_ciphertext = $3
              WHERE circle_id = $1 AND member_token = $2",
        )
        .bind(id)
        .bind(&label.member_token)
        .bind(&label.label_ciphertext)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Register the route**

In the `router()` function, add the `PUT` route on `/:id/encryption`. Find the existing router builder and add the route + the `put` import:
- Change the routing import line `use axum::{... routing::{delete, get, post}, ...}` to also import `put`: `routing::{delete, get, post, put}`.
- Add `.route("/:id/encryption", put(set_encryption))` to the `Router::new()...` chain.

- [ ] **Step 3: Add a unit test for the body shape**

Add to the `#[cfg(test)] mod tests` in `circles.rs` (these are DB-free deserialization guards consistent with the existing tests):

```rust
    #[test]
    fn set_encryption_body_parses_with_labels() {
        let json = r#"{"name_ciphertext":"ct","member_labels":[{"member_token":"v1:a","label_ciphertext":"l"}]}"#;
        let b: SetEncryptionBody = serde_json::from_str(json).unwrap();
        assert_eq!(b.name_ciphertext, "ct");
        assert_eq!(b.member_labels.len(), 1);
        assert_eq!(b.member_labels[0].member_token, "v1:a");
    }

    #[test]
    fn set_encryption_body_defaults_empty_labels() {
        let b: SetEncryptionBody = serde_json::from_str(r#"{"name_ciphertext":"ct"}"#).unwrap();
        assert!(b.member_labels.is_empty());
    }
```

- [ ] **Step 4: Build + test**

```bash
cd services/gateway && cargo test routes::circles 2>&1 | tail -12
```
Expected: compiles; the two new body tests + existing circle tests pass.

- [ ] **Step 5: Integration smoke (compose) — encryption round-trip at the DB**

Rebuild the gateway image and verify name encryption is stored. Run:
```bash
docker compose up -d --build gateway-rs postgres redis
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) FROM information_schema.columns WHERE table_name='circles' AND column_name='name_ciphertext';"
```
Expected: column present (count 1). (Request-level round-trip — create with name_ciphertext, GET returns it — runs in CI/manual; record if the image cannot be rebuilt here and rely on the unit tests.)

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/circles.rs
git commit -m "C-3 Phase B: PUT /circles/:id/encryption lazy-migration endpoint"
```

---

### Task 5: Shared TS types

**Files:**
- Modify: `shared/types/index.d.ts` (`Circle`, `CircleMember`)

- [ ] **Step 1: Update the types**

In `shared/types/index.d.ts`:
- `Circle`: add `name_ciphertext?: string | null`, `name_version?: number`, and make `name` optional/nullable (`name?: string | null`) since version-1 circles carry no plaintext name. Keep `circle_id`, `created_at`, `is_owner?`.
- `CircleMember`: add `member_label_ciphertext?: string | null`. Keep `member_token`, `circle_id`, `alert_radius_km`, `alert_severity`, `joined_at`.

(Read the file first; change only these two interfaces.)

- [ ] **Step 2: Typecheck**

```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | head -30
```
Expected: `tsc` flags the PWA sites that construct/consume `Circle`/`CircleMember` and now need the ciphertext fields (`useCircles.ts`, `FamilyCircleDashboard.tsx`, `CircleSidebar.tsx`, test fixtures). Expected — fixed in Tasks 6–7. Record the list.

- [ ] **Step 3: Commit**

```bash
git add shared/types/index.d.ts
git commit -m "C-3 Phase B: shared types add name/label ciphertext + name_version"
```

---

### Task 6: PWA — encrypt on create/add-member

**Files:**
- Modify: `apps/pwa/src/components/FamilyCircleDashboard.tsx` (create + add-member encrypt)

The owner has the circle key (generated on create via `generateCircleKey`/`saveCircleKey`, loaded via `loadCircleKey`). Encrypt the name on create and the `{pubkey, name}` label on add-member, sending ciphertext.

- [ ] **Step 1: Encrypt the name on create**

In `apps/pwa/src/components/FamilyCircleDashboard.tsx`, find the create flow (it currently `fetch`es `POST /api/circles` with `body: JSON.stringify({ name: effectiveCircleName })` and, before/after, generates+saves the circle key). Change it to encrypt the name with the freshly-generated circle key and send `name_ciphertext`:
- Ensure the circle key is generated (`generateCircleKey`) BEFORE the POST. Compute `const nameCiphertext = await encryptString(circleKey, effectiveCircleName)` (import `encryptString` from `'../services/e2eeService'`).
- Change the POST body to `JSON.stringify({ name_ciphertext: nameCiphertext })`.
- After a successful create, persist the circle key for the new id (`saveCircleKey(created.id, circleKey)`) and `addCircleId(created.id)` (already present).
Read the exact current create code and make these substitutions; if the key is generated after the POST today, move the generation before it so the name can be encrypted.

- [ ] **Step 2: Encrypt the member label on add-member**

In the add-member flow (currently `POST /api/circles/:id/members` with `body: JSON.stringify({ member_pubkey: hex })`), load the circle key and attach the encrypted label:
- `const key = await loadCircleKey(activeCircleId)` (it must exist for an owner). If `!key`, surface an error ("circle key unavailable") and abort — do not send an unencrypted label.
- `const labelCiphertext = await encryptString(key, JSON.stringify({ pubkey: hex, name: hex.slice(0, 8) }))` (the label carries the member's pubkey and a default display name = short pubkey; a nicer name can be added later via the same endpoint). 
- Change the POST body to `JSON.stringify({ member_pubkey: hex, member_label_ciphertext: labelCiphertext })`.

- [ ] **Step 3: Typecheck**

```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | grep -E "FamilyCircleDashboard" ; echo "done"
```
Expected: no `FamilyCircleDashboard` errors remain (other files still error until Task 7).

- [ ] **Step 4: Commit**

```bash
git add apps/pwa/src/components/FamilyCircleDashboard.tsx
git commit -m "C-3 Phase B: PWA encrypts circle name + member label on create/add"
```

---

### Task 7: PWA — rich roster: decrypt names/labels, recover pubkeys, restore presence + proximity

**Files:**
- Modify: `apps/pwa/src/hooks/useCircles.ts` (decrypt name + labels; carry recovered pubkey)
- Modify: `apps/pwa/src/store/circlesSlice.ts` (seed presence from recovered pubkeys)
- Modify: `apps/pwa/src/components/CircleSidebar.tsx` (render decrypted name/labels)
- Modify: `apps/pwa/src/hooks/useProximityAlerts.ts` (restore per-member settings via recovered pubkey)
- Modify: affected tests

This restores the full roster from Phase A's degraded state. The decrypted label yields `{pubkey, name}`, so the client can key presence/proximity on the real pubkey again.

- [ ] **Step 1: Decrypt in `useCircles.ts`**

In `apps/pwa/src/hooks/useCircles.ts`, after fetching a circle's detail, decrypt the circle name and each member's label using the circle key, and enrich the `CircleMember` objects with the recovered `pubkey` + display `name`. Concretely:
- Import `loadCircleKey`, `decryptString` from `'../services/e2eeService'`.
- Define an enriched member shape used in the store: extend the mapping so each member carries `member_token` (always), and `pubkey?: string` + `label?: string` (decrypted, when available).
- For the circle name: `const key = await loadCircleKey(circle.circle_id)`; `const displayName = circle.name_version === 1 && circle.name_ciphertext && key ? (await decryptString(key, circle.name_ciphertext)) ?? '(locked)' : (circle.name ?? '(unnamed)')`. Dispatch the circle with `name: displayName`.
- For each member: if `key` and `m.member_label_ciphertext`, `const decoded = await decryptString(key, m.member_label_ciphertext)`; parse JSON `{pubkey, name}`; set `member.pubkey` + `member.label`. On failure leave them undefined (renders as "unknown member").
Update the `RawMember`/`toMember` types to include `member_label_ciphertext` and the enriched `pubkey`/`label`. (The shared `CircleMember` type gains optional `pubkey?: string`/`label?: string` client-display fields — add them in `shared/types/index.d.ts` `CircleMember` as optional, since they are client-derived, OR keep an extended local type in the slice; prefer adding optional `pubkey?: string`/`label?: string` to the shared `CircleMember` so the slice/components share one type.)

- [ ] **Step 2: Seed presence from recovered pubkeys in `circlesSlice.ts`**

In `apps/pwa/src/store/circlesSlice.ts`, restore presence seeding using the recovered pubkey (Phase A removed it because the roster had no pubkey). In `circleLoaded`, seed `memberStatuses` to `OFFLINE` for each member that has a recovered `pubkey`:

```ts
      state.members[circle.circle_id] = members
      state.activeCircleId = circle.circle_id
      members.forEach(m => {
        if (m.pubkey && !state.memberStatuses[m.pubkey]) {
          state.memberStatuses[m.pubkey] = 'OFFLINE'
        }
      })
```
(Live `ONLINE`/`GHOST` updates still arrive via the circle WS keyed on `sender_pubkey`, which now matches the recovered roster pubkeys.)

- [ ] **Step 3: Render decrypted name/labels in `CircleSidebar.tsx`**

In `apps/pwa/src/components/CircleSidebar.tsx`, render each member by its decrypted `label`/`pubkey` when present, falling back to the token otherwise; key by `member_token` (stable). For status, look up `memberStatuses[m.pubkey ?? '']` (pubkey-keyed) instead of the token. The circle header already shows `circle.name`, which `useCircles` now sets to the decrypted name. Concretely replace the member-render block:
- `key={m.member_token}` (unchanged — stable).
- display: `{m.label ?? m.pubkey ?? 'unknown member'}`.
- status: `const status = memberStatuses[m.pubkey ?? ''] ?? 'OFFLINE'`.
- avatar initial: `(m.label ?? m.pubkey ?? '?').slice(0, 1).toUpperCase()`.
- `<MemberChip ... pubkey={m.pubkey ?? m.member_token} status={memberStatuses[m.pubkey ?? ''] ?? 'OFFLINE'} />`.

- [ ] **Step 4: Restore per-member proximity in `useProximityAlerts.ts`**

In `apps/pwa/src/hooks/useProximityAlerts.ts`, revert to per-member settings now that the roster carries real pubkeys. Change `computeProximityAlerts` back to taking `(members, locations, events)` and joining on the member's recovered `pubkey`:

```ts
export function computeProximityAlerts(
  members: CircleMember[],
  locations: Record<string, { lat: number; lng: number }>,
  events: SafetyEvent[],
): Omit<ProximityAlert, 'id'>[] {
  const alerts: Omit<ProximityAlert, 'id'>[] = []
  for (const member of members) {
    if (!member.pubkey) continue // unlabeled (legacy/unknown) member: no live join
    const loc = locations[member.pubkey]
    if (!loc) continue
    for (const event of events) {
      if (!event.is_active) continue
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[member.alert_severity ?? 'MEDIUM']) continue
      const distKm = haversineKm(loc, { lat: event.lat, lng: event.lng })
      if (distKm <= (member.alert_radius_km ?? 5)) {
        alerts.push({
          member_pubkey: member.pubkey,
          zone_name: event.title,
          event_id: event.id,
          severity: event.severity,
          triggered_at: new Date().toISOString(),
        })
      }
    }
  }
  return alerts
}
```
Update the `useProximityAlerts` hook to pass the `members` selector back in (re-add the `members` selector removed in Phase A) and call `computeProximityAlerts(members, locations, events)`.

- [ ] **Step 5: Update affected tests + typecheck (must be green)**

Update the fixtures/signatures:
- `apps/pwa/src/store/__tests__/circlesSlice.test.ts`: members now carry `pubkey`; assert presence is seeded from `m.pubkey` (a labeled member seeds OFFLINE; an unlabeled one does not).
- `apps/pwa/src/components/__tests__/CircleSidebar.test.tsx`: fixtures include `pubkey`/`label`; assert the decrypted label renders (and a label-less member shows "unknown member").
- `apps/pwa/src/hooks/__tests__/useProximityAlerts.test.ts`: `computeProximityAlerts(members, locations, events)` again — build members with `pubkey` + per-member `alert_radius_km`/`alert_severity`; assert per-member thresholds apply and an unlabeled member (no pubkey) produces nothing.
Run:
```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?"
npx vitest run src/hooks/__tests__/useProximityAlerts.test.ts src/store/__tests__/circlesSlice.test.ts src/components/__tests__/CircleSidebar.test.tsx 2>&1 | tail -15
```
Expected: `tsc:0` and those test files pass. Fix any remaining consumer the compiler flags.

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/hooks/useCircles.ts apps/pwa/src/store/circlesSlice.ts apps/pwa/src/components/CircleSidebar.tsx apps/pwa/src/hooks/useProximityAlerts.ts apps/pwa/src/store/__tests__/circlesSlice.test.ts apps/pwa/src/components/__tests__/CircleSidebar.test.tsx apps/pwa/src/hooks/__tests__/useProximityAlerts.test.ts shared/types/index.d.ts
git commit -m "C-3 Phase B: PWA rich roster — decrypt names/labels, restore presence + per-member proximity"
```

---

### Task 8: PWA — lazy migration of legacy circles

**Files:**
- Modify: `apps/pwa/src/hooks/useCircles.ts` (detect `name_version === 0`, re-encrypt, PUT)

When an owner loads a circle still at `name_version === 0`, re-encrypt its legacy plaintext `name` (and labels for members it can identify locally) and `PUT /circles/:id/encryption`, converging it to version 1.

- [ ] **Step 1: Trigger the migration in `useCircles.ts`**

In `apps/pwa/src/hooks/useCircles.ts`, after a circle detail is loaded, if `detail.is_owner && detail.name_version === 0 && detail.name` and the circle key is available, perform the migration:
```ts
      if (detail.is_owner && detail.name_version === 0 && detail.name) {
        const key = await loadCircleKey(detail.id)
        if (key) {
          const nameCiphertext = await encryptString(key, detail.name)
          // Re-label only members the owner can still identify locally is out of
          // scope of the automatic pass (the owner cannot reverse a member_token);
          // names are migrated now, member labels are filled as members are
          // (re-)added. Send an empty member_labels list.
          await fetch(`${API_BASE}/api/circles/${detail.id}/encryption`, {
            method: 'PUT',
            headers,
            signal: AbortSignal.timeout(15_000),
            body: JSON.stringify({ name_ciphertext: nameCiphertext, member_labels: [] }),
          }).catch(() => { /* best-effort; retried on next load */ })
        }
      }
```
(This is best-effort and idempotent: once converged, `name_version` becomes 1 and the block is skipped on the next load.)

- [ ] **Step 2: Typecheck + the existing useCircles/e2ee tests**

```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?"
npx vitest run src/services/__tests__/e2eeService.test.ts 2>&1 | tail -6
```
Expected: `tsc:0`; e2ee tests pass. (No new test for the side-effecting fetch here; it is covered by the endpoint test in Task 4 and the round-trip in manual/integration.)

- [ ] **Step 3: Commit**

```bash
git add apps/pwa/src/hooks/useCircles.ts
git commit -m "C-3 Phase B: PWA lazy-migrates legacy circle names to ciphertext"
```

---

### Task 9: Migration 016 — drop legacy `circles.name` (deferred)

**Files:**
- Create: `infra/postgres/migrations/016_circle_drop_plaintext_name.sql`

Drops the legacy plaintext `circles.name` once the lazy migration has had time to converge. On a fresh DB there are no `name_version=0` rows, so it is safe immediately.

- [ ] **Step 1: Write the migration**

Create `infra/postgres/migrations/016_circle_drop_plaintext_name.sql`:

```sql
-- infra/postgres/migrations/016_circle_drop_plaintext_name.sql
-- C-3 Phase B: drop the legacy plaintext circle name.
-- DEPLOY ORDERING (existing data): apply only after the client lazy migration has
-- converged (owners online at least once, name_version flipped to 1). Circles
-- still at name_version=0 lose their plaintext name and show "(unnamed)" until the
-- owner renames. On a fresh/empty DB this is a no-op-safe immediate drop. Idempotent.

ALTER TABLE circles DROP COLUMN IF EXISTS name;
```

- [ ] **Step 2: Apply to compose + verify**

```bash
cat infra/postgres/migrations/016_circle_drop_plaintext_name.sql | docker compose exec -T postgres psql -U sentinel -d sentinelmesh
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) AS name_gone FROM information_schema.columns WHERE table_name='circles' AND column_name='name';"
docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
  "SELECT count(*) AS ct_kept FROM information_schema.columns WHERE table_name='circles' AND column_name='name_ciphertext';"
```
Expected: `name_gone = 0` (legacy plaintext name dropped); `ct_kept = 1` (ciphertext retained).

- [ ] **Step 3: Sync the gateway struct + reads (post-drop)**

After 016 drops `circles.name`, the `Circle` sqlx struct and the `get_circle`/`list_circles` JSON must stop referencing `name`. In `services/gateway/src/routes/circles.rs`: remove `pub name: Option<String>` from the `Circle` struct; change the two `SELECT * FROM circles` reads to explicit column lists `SELECT id, owner_token, name_ciphertext, name_version, created_at` (so `*` cannot reference the dropped column); and remove `"name": circle.name,` from the `get_circle`/`list_circles`/`create_circle` JSON. Update the `Circle` test literals to drop the `name` field. Build + test:
```bash
cd services/gateway && cargo test routes::circles 2>&1 | tail -8
```
Expected: compiles; tests pass. The PWA already prefers `name_ciphertext` (version 1) and only fell back to `name` for legacy rows — with 016 applied, all rows are version 1, so the fallback is dead but harmless (a missing `name` field reads as `undefined`); no PWA change required, but verify `tsc` stays green:
```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?"
```

- [ ] **Step 4: Commit**

```bash
git add infra/postgres/migrations/016_circle_drop_plaintext_name.sql services/gateway/src/routes/circles.rs
git commit -m "C-3 Phase B: migration 016 drop legacy circles.name; gateway reads ciphertext only"
```

---

### Task 10: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Gateway fmt/clippy/tests as CI does**

```bash
cd services/gateway && cargo fmt --all && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings 2>&1 | grep -E "^error|^warning"; echo "clippy done"
cargo test 2>&1 | tail -8
```
Expected: `fmt --check` clean (commit any reformat); clippy prints no error/warning lines; all gateway tests pass.

- [ ] **Step 2: PWA full suite + typecheck**

```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?" && npx vitest run 2>&1 | tail -8
```
Expected: `tsc:0`; all PWA tests pass.

- [ ] **Step 3: Fresh-DB migration check (CI parity, non-`sentinel` role)**

```bash
docker compose exec -T postgres psql -U sentinel -d postgres -q -c "DROP DATABASE IF EXISTS c3pb_ci;" -c "DROP ROLE IF EXISTS c3pb_user;" -c "CREATE ROLE c3pb_user SUPERUSER LOGIN;" -c "CREATE DATABASE c3pb_ci OWNER c3pb_user;"
cat infra/postgres/init.sql | docker compose exec -T postgres psql -U c3pb_user -d c3pb_ci -v ON_ERROR_STOP=1 -q 2>&1 | grep -iE "error" || echo "init OK"
for m in 013_circle_tokenization 014_circle_drop_plaintext 015_circle_name_label_ciphertext 016_circle_drop_plaintext_name; do echo "== $m =="; cat infra/postgres/migrations/${m}.sql | docker compose exec -T postgres psql -U c3pb_user -d c3pb_ci -v ON_ERROR_STOP=1 -q >/tmp/$m.out 2>&1; echo "exit:$?"; grep -iE "error" /tmp/$m.out || echo "(no errors)"; done
docker compose exec -T postgres psql -U c3pb_user -d c3pb_ci -c "SELECT count(*) AS name_gone FROM information_schema.columns WHERE table_name='circles' AND column_name='name';"
docker compose exec -T postgres psql -U sentinel -d postgres -q -c "DROP DATABASE IF EXISTS c3pb_ci;" -c "DROP ROLE IF EXISTS c3pb_user;"
```
Expected: `init OK`; all four migrations `exit:0` `(no errors)`; `name_gone = 0`. (013/014 carried over from Phase A; 015/016 are new. If 005 PostGIS fails on the local alpine image, that is a local-image limitation unrelated to C-3 — note it and rely on the compose checks in Tasks 1/9.)

- [ ] **Step 4: Commit fixups, push, open PR**

```bash
git add -A && git commit -m "C-3 Phase B: fmt/lint fixups" || echo "nothing to commit"
git push -u origin feat/c3-phase-b-encryption
gh pr create --base main --head feat/c3-phase-b-encryption \
  --title "C-3 Phase B: client encryption (circle names + member labels)" \
  --body-file <(printf '%s\n' "Implements Phase B of docs/superpowers/specs/2026-06-05-c3-social-graph-privacy-design.md. Encrypts the circle name and per-member labels under the circle key (server stores only ciphertext); the PWA decrypts to render real names/people and recovers each member pubkey from the label, restoring presence and per-member proximity. PUT /circles/:id/encryption performs the lazy migration of pre-Phase-B circles; migration 015 adds the ciphertext columns and 016 drops the legacy circles.name. Builds on the merged Phase A tokenization.")
```
(If the `<(...)` process substitution is unavailable in the shell, write the body to a temp file and pass `--body-file <path>`, matching the Phase A PR approach — avoid inline `--body` with apostrophes.)

---

## Self-Review

- **Spec coverage (Phase B rows):** migration 015 name/label ciphertext columns + `name_version` (Task 1); client AES-GCM string crypto (Task 2); gateway stores/returns ciphertext, `create_circle`/`add_member` take ciphertext (Task 3); lazy-migration endpoint `PUT /circles/:id/encryption` (Task 4); shared TS types (Task 5); PWA encrypt on create/add (Task 6); rich roster — decrypt names/labels, recover pubkeys, restore presence + per-member proximity (Task 7); PWA lazy migration trigger (Task 8); migration 016 deferred `circles.name` drop + gateway read sync (Task 9); fmt/clippy/tests + fresh-DB CI-parity + PR (Task 10). The degraded-state follow-ups the Phase A reviews noted (member presence, per-member proximity) are restored in Task 7.
- **Placeholder scan:** none — every code step has full Rust/SQL/TS plus exact commands and expected output. Task 6/7 name the exact substitutions to apply by reading the (small, localized) component sites rather than dumping the large unrelated component bodies; the encryption/decryption calls, request bodies, and selectors are spelled out.
- **Type consistency:** `name_ciphertext`/`name_version`/`member_label_ciphertext` columns (Task 1) match the sqlx structs + queries (Tasks 3, 9), the request bodies (Tasks 3, 4), the shared TS types (Task 5), and the PWA mappers (Tasks 6–8). `encryptString(key,text)->string` / `decryptString(key,ct)->string|null` (Task 2) are used identically in Tasks 6–8. `computeProximityAlerts(members, locations, events)` (Task 7) restores the Phase-A-removed `members` param; the `CircleMember` client fields `pubkey?`/`label?` are added to the shared type (Task 7 Step 1) and consumed in the slice/sidebar/proximity (Task 7). `name_version` is `i16` (Rust) / `number` (TS) / `SMALLINT` (SQL) consistently.
- **Known caveats (carried from the spec):** members the owner cannot re-identify during lazy migration stay unlabeled ("unknown member") until re-added; the automatic lazy pass migrates the name only (empty `member_labels`) since the owner cannot reverse a `member_token` — labels fill in as members are (re-)added with `add_member`. Migration 016 deploy-ordering: apply only after the client lazy migration converges (documented in the migration header); fresh DB is immediate-safe.
```
