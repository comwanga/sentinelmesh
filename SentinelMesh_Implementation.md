# SentinelMesh
## Complete Implementation Specification

> *A privacy-first, blockchain-verified public safety intelligence layer for Kenya.*
> *Aggregates open signals and opt-in community data to give ordinary people the situational awareness that only governments and corporations currently have.*

**Version:** 1.0 — Implementation Draft  
**Scope:** Kenya (Swahili + English), Android + PWA  
**Network:** Bitcoin Testnet → Mainnet, Nostr Protocol  
**Stack:** React Native · Node.js · Python · PostgreSQL · Redis · Nostr · Bitcoin OP_RETURN

---

## Table of Contents

1. [Project Philosophy](#1-project-philosophy)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Module 1 — Public Signal Aggregation](#3-module-1--public-signal-aggregation)
4. [Module 2 — Community Report Submission & Verification](#4-module-2--community-report-submission--verification)
5. [Module 3 — Family Location Circle & Crisis Proximity Alerts](#5-module-3--family-location-circle--crisis-proximity-alerts)
6. [Module 4 — Blockchain Anchoring (Nostr + OP_RETURN)](#6-module-4--blockchain-anchoring-nostr--op_return)
7. [Data Architecture](#7-data-architecture)
8. [API Specification](#8-api-specification)
9. [Mobile Application (Android + PWA)](#9-mobile-application-android--pwa)
10. [AI & NLP Pipeline](#10-ai--nlp-pipeline)
11. [Privacy & Security Model](#11-privacy--security-model)
12. [Infrastructure & Deployment](#12-infrastructure--deployment)
13. [Build Sequence & Milestones](#13-build-sequence--milestones)
14. [Testnet → Mainnet Checklist](#14-testnet--mainnet-checklist)
15. [Module 5 — Acoustic Threat Detection](#15-module-5--acoustic-threat-detection)
16. [Module 6 — Safe Route Recommendations](#16-module-6--safe-route-recommendations)
17. [Module 7 — Lightning Zaps for Community Reporters](#17-module-7--lightning-zaps-for-community-reporters)

---

## 1. Project Philosophy

### The Problem With Existing Safety Systems

During the Westgate attack (2013), Mathare floods (recurring), and every election cycle since 2007, ordinary Kenyans faced the same three failures:

- **Information fog** — WhatsApp rumours, no verified source of truth
- **Location anxiety** — no way to confirm a family member's safety in real time
- **Decision paralysis** — no alternative routes, no safe zones, no ground truth

Existing tools are either siloed (Google Maps), exploitative (commercial tracking apps), state-controlled (government SMS alerts), or unverifiable (Twitter/X). None of them are owned by communities. None of them are cryptographically trustworthy.

### The SentinelMesh Thesis

> Move the source of truth from governments and corporations to communities — and make it cryptographically unchallengeable.

SentinelMesh is not a surveillance system. It is the architectural opposite of one. Every design decision in this document flows from three non-negotiable principles:

**Principle 1 — Consent is code, not policy.**
Location sharing is opt-in, revocable instantly, and cryptographically enforced. There is no database of user locations to subpoena, breach, or sell.

**Principle 2 — Public information is a public good.**
Social media posts, news articles, radio broadcasts, and government alerts are already public. Aggregating, classifying, and verifying them creates value for communities without violating anyone's privacy.

**Principle 3 — Verifiability over trust.**
Every community report is cryptographically signed. Every critical safety event is Bitcoin-anchored. If a government later denies an incident occurred, the blockchain says otherwise. This is not a feature — it is the foundational value proposition for communities that have historically been lied to by authorities.

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│         React Native (Android)  ·  PWA (Any Browser)           │
└─────────────────────┬───────────────────────┬───────────────────┘
                      │                       │
                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API GATEWAY                               │
│              Node.js + Express · WebSockets · Redis             │
└──────┬──────────────┬──────────────┬──────────────┬────────────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
┌──────────┐  ┌──────────────┐ ┌─────────┐  ┌────────────────┐
│  Signal  │  │  Community   │ │ Family  │  │  Blockchain    │
│  Ingest  │  │  Reports     │ │ Circles │  │  Anchor        │
│  Python  │  │  Node.js     │ │ Node.js │  │  Service       │
│  FastAPI │  │              │ │ E2E enc │  │  Nostr+Bitcoin │
└──────┬───┘  └──────┬───────┘ └────┬────┘  └───────┬────────┘
       │              │              │               │
       ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                │
│         PostgreSQL · Redis · IPFS (report media)                │
└─────────────────────────────────────────────────────────────────┘
       │                                            │
       ▼                                            ▼
┌──────────────────┐                    ┌───────────────────────┐
│   Nostr Relays   │                    │  Bitcoin Testnet/     │
│  (event record)  │                    │  Mainnet (OP_RETURN)  │
└──────────────────┘                    └───────────────────────┘
```

### Component Responsibilities

| Component | Language | Responsibility |
|---|---|---|
| API Gateway | Node.js + Express | Auth, routing, WebSocket hub, rate limiting |
| Signal Ingest Service | Python + FastAPI | Scraping, NLP, event classification |
| Community Reports | Node.js | Report CRUD, consensus scoring, Nostr signing |
| Family Circles | Node.js | E2E encrypted location, proximity alerts |
| Blockchain Anchor | Node.js | Nostr publishing, Bitcoin OP_RETURN commits |
| Mobile App | React Native | Android app, offline support |
| PWA | React + Vite | Browser-based, works on any smartphone |
| Database | PostgreSQL | Persistent structured storage |
| Cache / Pub-Sub | Redis | Real-time alert delivery, session state |

---

## 3. Module 1 — Public Signal Aggregation

### 3.1 Overview

This module continuously ingests publicly available data from four source categories, runs it through an NLP classification pipeline, and emits structured safety events. No personal data is collected at any point. All source material is already public.

### 3.2 Data Sources — Kenya Scope

#### Social Media
```
Twitter/X Firehose (filtered stream)
  Keywords: matatu, accident, moto, barabara, flood, mafuriko,
            msongamano, polisi, maandamano, fire, moto, bomb,
            earthquake, tetemeko, storm, dhoruba
  Languages: sw, en
  Geo-filter: Kenya bounding box (-4.67, 33.91, 4.62, 41.90)

Facebook Graph API (public posts only)
  Groups: Nairobi Traffic Updates, Kenya Emergency Alerts,
          Matatu Owners Association (public pages)
  
Telegram Public Channels
  @NairobiTraffic, @KenyaAlerts, @NairobiNews (public only)
```

#### News APIs
```
RSS Feeds (parsed every 60 seconds):
  - Nation Media: https://nation.africa/kenya/rss
  - Standard Media: https://standardmedia.co.ke/rss/kenya.xml
  - Citizen Digital: https://citizentv.co.ke/feed/
  - NTV Kenya: https://ntv.co.ke/feed/
  - KBC: https://kbc.co.ke/feed/

Scraping targets (polite crawl, 5min intervals):
  - Kenya Red Cross situation reports
  - Kenya Met Department weather alerts
  - NTSA traffic advisories
  - County Government emergency notices
```

#### Radio Transcription (Swahili + English)
```
Streams (HLS/MP3 public streams):
  - Citizen Radio: 98.4 FM stream
  - Radio Maisha: public stream
  - Inooro FM: public stream (Kikuyu — major language in Nairobi)
  - Radio Jambo: public stream

Processing:
  - Whisper Large v3 (multilingual, Swahili-capable)
  - Transcribed in 30-second rolling windows
  - Only flagged segments stored — raw audio never persisted
```

#### Official Government APIs
```
Kenya Meteorological Department (KMD)
  - Weather warnings API
  - Flood watch bulletins

National Disaster Operations Centre (NDOC)
  - Public situation reports (PDF parsing)

NTSA
  - Traffic incident reports (public)

Kenya Power
  - Outage maps (public API)
```

### 3.3 Signal Ingest Pipeline

```
Raw Source Data
      │
      ▼
┌─────────────────────────────────┐
│     Deduplication Layer         │
│  SHA256 content hash → Redis    │
│  Discard if seen in last 24h    │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│     Language Detection          │
│  langdetect → sw / en / other   │
│  Discard if not sw or en        │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│     NLP Classification          │
│  Fine-tuned Gemma 2 2B          │
│  Categories:                    │
│    TRAFFIC_INCIDENT             │
│    FLOOD / NATURAL_DISASTER     │
│    CIVIL_UNREST                 │
│    SECURITY_INCIDENT            │
│    FIRE                         │
│    MEDICAL_EMERGENCY            │
│    INFRASTRUCTURE_FAILURE       │
│    FALSE_ALARM                  │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│     Location Extraction         │
│  spaCy NER → GPE entities       │
│  Kenya gazetteer lookup         │
│  → (lat, lng, place_name)       │
│  → Confidence score 0.0–1.0     │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│     Severity Scoring            │
│  Keyword density + source trust │
│  CRITICAL / HIGH / MEDIUM / LOW │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│     Event Fusion                │
│  Cluster signals within 2km/    │
│  30min window → single event    │
│  Source count raises confidence │
└──────────────┬──────────────────┘
               │
               ▼
         Structured Event
         (emitted to Redis pub/sub
          → API Gateway
          → Connected clients)
```

### 3.4 Kenya Gazetteer

A critical component for accurate location extraction in Kenya. Standard NER models struggle with Kenyan place names.

```python
# gazetteer/kenya_places.json structure
{
  "nairobi": {
    "lat": -1.2921, "lng": 36.8219,
    "county": "Nairobi",
    "aliases": ["nai", "the city", "CBD", "jiji"]
  },
  "mathare": {
    "lat": -1.2572, "lng": 36.8572,
    "county": "Nairobi",
    "type": "informal_settlement",
    "aliases": ["mathare valley"]
  },
  "kibra": {
    "lat": -1.3135, "lng": 36.7845,
    "county": "Nairobi",
    "type": "informal_settlement",
    "aliases": ["kibera"]
  },
  "westlands": {
    "lat": -1.2642, "lng": 36.8018,
    "county": "Nairobi",
    "aliases": ["westy"]
  }
  // ... 2,000+ Kenyan places, estates, junctions, landmarks
}
```

The gazetteer must include:
- All 47 county names and headquarters
- Major urban estates and informal settlements
- Road names and junctions (Uhuru Highway, Mombasa Road, etc.)
- Landmarks (Westgate, KICC, GPO, Kenyatta Hospital)
- Swahili place name variants
- Common shorthand used in social media

### 3.5 Swahili NLP Fine-Tuning

Standard English NLP models perform poorly on Kenyan Swahili, which includes heavy code-switching and Sheng.

```
Training approach:
  Base model: google/gemma-2-2b-it (instruction-tuned)
  Fine-tuning dataset:
    - 10,000 manually labelled Kenyan tweets (sw+en)
    - KBC/Citizen news archive (2018–2024)
    - Kenya Red Cross situation reports (translated)
    - Sheng dictionary integration
  
  Training infrastructure:
    - Google Colab Pro (A100 GPU) for fine-tuning
    - GGUF quantised model (Q4_K_M) for inference
    - Inference server: llama.cpp on 4-core VPS (2GB RAM sufficient)

  Target metrics:
    - Event classification F1 > 0.85
    - Location extraction precision > 0.80
    - Swahili tweet classification accuracy > 0.82
```

### 3.6 Signal Ingest Service — File Structure

```
signal-service/
├── main.py                    # FastAPI entry point
├── ingest/
│   ├── twitter_stream.py      # Filtered stream listener
│   ├── rss_parser.py          # News RSS polling
│   ├── radio_transcriber.py   # Whisper + HLS stream processing
│   ├── telegram_monitor.py    # Public channel monitoring
│   └── official_feeds.py      # KMD, NTSA, NDOC scrapers
├── nlp/
│   ├── classifier.py          # Event type classification
│   ├── location_extractor.py  # NER + gazetteer lookup
│   ├── severity_scorer.py     # Severity scoring logic
│   └── event_fuser.py         # Cluster nearby signals into events
├── gazetteer/
│   ├── kenya_places.json      # Full Kenya place database
│   └── loader.py
├── models/
│   └── sentinel_gemma_q4.gguf # Fine-tuned quantised model
└── requirements.txt
```

### 3.7 Structured Event Schema

```json
{
  "event_id": "uuid-v4",
  "event_type": "FLOOD",
  "severity": "HIGH",
  "title": "Flash flooding reported in Mathare Valley",
  "summary": "Multiple reports of rising water levels near Mathare River. Residents advised to avoid low-lying areas.",
  "location": {
    "place_name": "Mathare Valley, Nairobi",
    "lat": -1.2572,
    "lng": 36.8572,
    "county": "Nairobi",
    "radius_meters": 800
  },
  "confidence": 0.87,
  "source_count": 4,
  "sources": [
    { "type": "twitter", "count": 2 },
    { "type": "news", "count": 1 },
    { "type": "radio", "count": 1 }
  ],
  "languages_detected": ["sw", "en"],
  "is_active": true,
  "started_at": "2026-04-28T09:15:00Z",
  "last_updated": "2026-04-28T09:47:00Z",
  "nostr_event_id": "hex-string",
  "bitcoin_txid": null
}
```

---

## 4. Module 2 — Community Report Submission & Verification

### 4.1 Overview

Community reports are ground truth submitted by real users on the ground. They complement the public signal layer with hyperlocal, real-time information that no algorithm can detect — "the road at Kariobangi junction is completely blocked."

Every report is cryptographically signed with the submitter's Nostr private key. The submitter is anonymous to the world but verifiable as a real human account. Consensus scoring means a report from one person is tentative; confirmed by five is authoritative.

### 4.2 Report Types

```
ROAD_BLOCKED        — Accident, protest, flooding, collapse
FLOODING            — Water levels, impassable roads
SECURITY_INCIDENT   — Armed incident, robbery, unrest
FIRE                — Building, vehicle, bush fire
PROTEST_MARCH       — Peaceful or violent, direction of movement
ACCIDENT            — Vehicle collision, injuries
INFRASTRUCTURE      — Power outage, water shortage, bridge damage
ALL_CLEAR           — Confirming a previous report is resolved
OTHER               — Free text with location
```

### 4.3 Report Submission Flow

```
User submits report
        │
        ▼
Client-side processing (on device):
  1. Attach current GPS coordinates
  2. Optional: attach photo (compressed to 800px max)
  3. Sign report payload with user's Nostr private key
  4. Generate report_id = SHA256(content + timestamp + pubkey)
        │
        ▼
POST /api/reports
  Payload: {
    type, description, location, photo_ipfs_cid,
    nostr_pubkey, nostr_signature, timestamp
  }
        │
        ▼
Server-side validation:
  1. Verify Nostr signature against pubkey
  2. Rate limit: max 10 reports/hour per pubkey
  3. Check for duplicate report_id
  4. Spam score: ML classifier on description text
  5. If spam_score > 0.8 → reject with reason
        │
        ▼
Store in PostgreSQL (status: PENDING)
        │
        ▼
Publish to Nostr relay (kind: 30078 — application-specific)
        │
        ▼
Push to nearby users via WebSocket
(users within 5km receive the report as UNVERIFIED)
```

### 4.4 Verification & Consensus System

A report moves through four states based on community consensus:

```
PENDING → UNVERIFIED → VERIFIED → AUTHORITATIVE
                   ↓
                DISPUTED → REJECTED
```

**Scoring rules:**

| Action | Score Change | Notes |
|---|---|---|
| Initial submission | +1 | Submitter's own vote |
| Another user confirms | +2 | Must be within 3km of report location |
| Another user denies | -3 | Location-proximate denial weighted higher |
| Official source corroborates | +10 | KMD, NTSA, Red Cross |
| Reporter has >20 accurate past reports | +1 bonus | Reputation multiplier |
| Report is 2hrs old with no confirmation | -1 decay | Automatic staleness decay |

**State transitions:**

```
score >= 3  → UNVERIFIED
score >= 7  → VERIFIED
score >= 15 → AUTHORITATIVE
score <= -3 → DISPUTED
score <= -8 → REJECTED (hidden from feed, kept for audit)
```

### 4.5 Photo Handling — Privacy-First

Photos are a double-edged feature. They increase report credibility but risk capturing people's faces or private property.

```
Client-side before upload:
  1. Strip ALL EXIF metadata (GPS, device model, timestamp)
  2. Detect and blur faces using on-device ML (MediaPipe Face Detection)
  3. Compress to max 800px wide, 85% JPEG quality
  4. Upload to IPFS via local node or Pinata
  5. Only IPFS CID stored in report — image never touches our servers

Server-side:
  - Never store raw images
  - Never process image content server-side
  - IPFS CID is the only reference
```

### 4.6 Reputation System

Users build reputation through accurate reporting. Reputation is stored on Nostr — not on our servers — so it is portable across any app that speaks Nostr.

```
Reputation tiers:
  NEWCOMER    0–10 accurate reports    → reports start at score 1
  TRUSTED     11–50 accurate reports   → reports start at score 2
  VETERAN     51–200 accurate reports  → reports start at score 3
  SENTINEL    200+ accurate reports    → reports start at score 5,
                                          can mark reports AUTHORITATIVE

Reputation is calculated from:
  - Reports that reached VERIFIED or AUTHORITATIVE: +1 each
  - Reports that reached REJECTED: -3 each
  - Reports confirmed by official sources: +5 each
```

### 4.7 Anti-Abuse Measures

During political events, coordinated fake reports are a real attack vector.

```
Rate limiting:
  - 10 reports/hour per Nostr pubkey
  - 3 reports/hour for NEWCOMER tier
  - Burst limit: max 3 reports within 5 minutes

Sybil resistance:
  - New accounts (< 7 days old) limited to NEWCOMER tier regardless of volume
  - Multiple accounts from same device fingerprint flagged
  - Reports from new accounts during flagged political events require
    manual review before appearing on map

Content filtering:
  - ML spam classifier (trained on Kenyan spam patterns)
  - Keyword blocklist for coordinated disinformation patterns
  - Identical or near-identical reports from different accounts → auto-cluster
    and flag for review (possible coordinated attack)

Emergency override:
  - During CRITICAL severity events, SENTINEL-tier users can fast-track
    AUTHORITATIVE status with single confirmation
```

### 4.8 Community Reports — File Structure

```
backend/src/reports/
├── reportController.js      # Express route handlers
├── reportService.js         # Business logic, scoring
├── consensusEngine.js       # Score calculation, state transitions
├── reputationService.js     # User reputation management
├── spamClassifier.js        # ML-based spam detection
├── photoProcessor.js        # EXIF stripping, IPFS upload
└── nostrPublisher.js        # Sign and publish to Nostr relays
```

---

## 5. Module 3 — Family Location Circle & Crisis Proximity Alerts

### 5.1 Overview

The Family Circle is a private, end-to-end encrypted location sharing network. Every member holds their own encryption key. The server stores only encrypted location blobs — it mathematically cannot read anyone's location.

This is architecturally different from Life360 or Google Family Sharing, where the company can read every location update. In SentinelMesh, the server is a blind courier.

### 5.2 Cryptographic Design

```
Key Generation (on device, never leaves device):
  Each user generates an X25519 keypair on first app launch
  Private key: stored in Android Keystore (hardware-backed if available)
  Public key: shared with circle members

Location Sharing Encryption:
  For each circle member who should see my location:
    1. Generate ephemeral X25519 keypair
    2. ECDH key exchange with recipient's public key → shared_secret
    3. Encrypt location payload with AES-256-GCM using shared_secret
    4. Upload encrypted blob to server, tagged with recipient's pubkey

Server stores:
  { recipient_pubkey_hash, encrypted_blob, timestamp }
  — Cannot decrypt. Cannot correlate to identity. Cannot be subpoenaed effectively.

Decryption (on recipient's device):
  1. Download encrypted blobs tagged with own pubkey hash
  2. ECDH with sender's ephemeral pubkey → shared_secret
  3. Decrypt with AES-256-GCM
  4. Render location on private map
```

### 5.3 Circle Management

```
Create Circle:
  - Owner generates circle_id = UUID
  - Invite members via:
      a. QR code (contains invite_token signed by owner's key)
      b. Deep link: sentinelmesh://circle/join/{invite_token}
      c. 8-digit circle code (human-readable, expires in 24h)

Join Circle:
  - Scan QR or enter code
  - App verifies invite_token signature against owner's known pubkey
  - Member submits their public key to circle roster
  - Owner approves (explicit consent required)

Leave Circle:
  - One tap, immediate
  - Server deletes all stored location blobs for that member
  - Other members' devices purge cached location on next sync

Circle Roles:
  OWNER    — can add/remove members, set alert preferences, disband circle
  MEMBER   — shares location, receives locations, can trigger check-in request
```

### 5.4 Location Update Protocol

```
Update frequency (adaptive to battery + context):
  Normal mode:        every 5 minutes
  Crisis mode:        every 60 seconds (triggered by nearby event)
  Ghost mode:         no updates (user-toggled, instant)
  Low battery (<20%): every 15 minutes

Update payload (before encryption):
  {
    lat: float,
    lng: float,
    accuracy_meters: int,
    bearing: float,          // direction of travel
    speed_kmh: float,
    battery_percent: int,
    is_moving: bool,
    timestamp: unix_ms
  }

Battery optimisation:
  - Use Android Fused Location Provider (balances GPS + cell + WiFi)
  - Background location only when circle has active crisis event nearby
  - Foreground service notification shown when in active tracking mode
    (required by Android, also transparent to user)
```

### 5.5 Crisis Proximity Alert System

This is the core safety feature — automated alerts when a family member is near a verified safety event.

```
Alert trigger conditions:
  Member location is within ALERT_RADIUS of a verified event
  AND event severity is HIGH or CRITICAL
  AND member has not acknowledged the event

Alert radius by event type:
  SECURITY_INCIDENT:   2.0 km
  FLOOD:               1.5 km
  FIRE:                1.0 km
  ROAD_BLOCKED:        0.5 km
  PROTEST_MARCH:       1.5 km
  CIVIL_UNREST:        3.0 km

Alert content sent to circle owner/members:
  {
    type: "PROXIMITY_ALERT",
    member_name: "[First name only]",     // never full name in notification
    event_type: "FLOOD",
    event_summary: "Flash flooding in Mathare Valley",
    distance_km: 0.8,
    member_last_seen: "3 minutes ago",
    action_options: ["Request Check-In", "Call", "View Map"]
  }
```

### 5.6 Check-In System

During a crisis, sometimes the most useful thing is knowing someone is safe — not their exact location.

```
Check-In Request:
  Circle member A sends check-in request to member B
  → Member B receives: "Wanjiku is asking if you're safe"
  → Member B taps: [I'm Safe] [I Need Help] [Custom Message]

I'm Safe response:
  → Broadcasts encrypted "SAFE" status to circle
  → No location shared
  → Expires after 2 hours (must re-confirm)

I Need Help response:
  → Broadcasts encrypted "HELP" status
  → Shares location to all circle members for 30 minutes
  → Triggers emergency alert notification to all members
  → Option to share last known location with emergency services
    (explicit second consent required)

Dead Man's Switch (opt-in):
  During CRITICAL events:
  If member has not moved AND has not checked in for [X minutes]:
  → Circle members notified: "No movement detected from [Name] for 45 minutes"
  X is configurable per member: 30 / 45 / 60 / 90 minutes
```

### 5.7 Ghost Mode & Privacy Controls

```
Ghost Mode:
  - Activated with single tap
  - Immediately stops all location updates
  - Deletes pending encrypted blobs from server
  - Other members see: "[Name] is currently invisible"
  - No reason required, no questions asked

Scheduled Ghost Mode:
  "Don't share my location between 10pm and 6am"
  "Don't share my location on weekends"

Location Precision Control:
  PRECISE    → actual GPS coordinates (default during crisis)
  FUZZY      → ±500m randomisation (default normal mode)
  ZONE       → only shows "in Westlands" not exact street
```

---

## 6. Module 4 — Blockchain Anchoring (Nostr + OP_RETURN)

### 6.1 Overview

Two blockchain layers serve different purposes:

- **Nostr** — real-time, decentralised, censorship-resistant event publishing. Every safety event and community report is published to Nostr relays. This ensures no single server can suppress information during a crisis.

- **Bitcoin OP_RETURN** — permanent, immutable anchoring of weekly event digests. This creates a tamper-evident historical record that no authority can alter retroactively.

Together they answer: *"Did SentinelMesh report this event, and when?"* — with mathematical certainty.

### 6.2 Nostr Integration

#### Why Nostr for Safety Events

Nostr is a decentralised protocol where events are signed by private keys and relayed by independent servers. During the 2023 Kenya elections, Twitter was throttled in Kenya. During Westgate, WhatsApp groups were the primary information channel — unverifiable and ephemeral.

Nostr events are:
- Cryptographically signed — impossible to forge or attribute falsely
- Relayed across dozens of independent servers — impossible to fully suppress
- Permanently referenceable by event ID
- Verifiable by anyone without trusting SentinelMesh

#### Nostr Event Kinds Used

```
Kind 1     — Short text notes (safety event summaries, public alerts)
Kind 30078 — Application-specific data (community reports, structured events)
Kind 1984  — Reporting (used for disputed/flagged reports)
Kind 9735  — Zaps (future: tip community reporters with Lightning sats)
```

#### Safety Event Publishing

```javascript
// Every VERIFIED or AUTHORITATIVE safety event is published to Nostr

async function publishEventToNostr(safetyEvent) {
  const content = JSON.stringify({
    title: safetyEvent.title,
    type: safetyEvent.event_type,
    severity: safetyEvent.severity,
    location: safetyEvent.location,
    summary: safetyEvent.summary,
    confidence: safetyEvent.confidence,
    source_count: safetyEvent.source_count,
    sentinel_event_id: safetyEvent.event_id,
  });

  const nostrEvent = {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", safetyEvent.event_id],           // unique identifier
      ["t", safetyEvent.event_type],          // event type tag
      ["t", "sentinel-kenya"],                // app namespace tag
      ["t", safetyEvent.severity],            // severity tag
      ["g", String(safetyEvent.location.lat)], // geohash-compatible
      ["g", String(safetyEvent.location.lng)],
    ],
    content,
    pubkey: SENTINEL_SYSTEM_PUBKEY,           // SentinelMesh's own Nostr identity
  };

  // Sign with SentinelMesh system key
  const signedEvent = await signNostrEvent(nostrEvent, SENTINEL_PRIVATE_KEY);

  // Publish to multiple relays for redundancy
  const relays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.snort.social",
    "wss://nostr.wine",
    "wss://africa.nostr.net",   // Africa-focused relay when available
  ];

  await Promise.allSettled(relays.map(relay => publishToRelay(relay, signedEvent)));

  return signedEvent.id; // Nostr event ID stored in our DB
}
```

#### Community Report Publishing

```javascript
// Community reports are published under the reporter's own Nostr identity
// They sign client-side — SentinelMesh never holds their private key

async function publishCommunityReport(report, userSignedEvent) {
  // Verify the user signed this correctly before relaying
  const isValid = verifyNostrSignature(userSignedEvent);
  if (!isValid) throw new Error('Invalid Nostr signature');

  // Relay to our preferred relays on behalf of the user
  const relays = SENTINEL_RELAY_LIST;
  await Promise.allSettled(relays.map(r => publishToRelay(r, userSignedEvent)));

  return userSignedEvent.id;
}
```

### 6.3 Bitcoin OP_RETURN Anchoring

#### What Gets Anchored

Not every event goes on-chain — Bitcoin transaction fees make that impractical. Instead, we anchor **weekly event digests** and **critical individual events**.

```
Weekly digest (every Sunday 21:00 UTC = midnight Nairobi):
  - SHA256 hash of all VERIFIED+ events for the week
  - Written to Bitcoin testnet (mainnet post-launch)
  - Cost: ~1000 sats (~KES 0.14) per week

Critical event anchoring (immediate):
  - CRITICAL severity events above confidence 0.90
  - Any event officially denied by government sources
  - Events with 50+ community confirmations
  - Cost: ~1000 sats per event
```

#### Anchor Construction

```javascript
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const crypto = require('crypto');

const ECPair = ECPairFactory(ecc);
const NETWORK = process.env.BITCOIN_NETWORK === 'mainnet'
  ? bitcoin.networks.bitcoin
  : bitcoin.networks.testnet;

async function anchorEventDigest(events) {
  // Build a canonical, sorted representation of all events
  const digest = {
    version: "1.0",
    app: "sentinel-mesh-kenya",
    period_start: events[0].started_at,
    period_end: events[events.length - 1].started_at,
    event_count: events.length,
    events: events.map(e => ({
      id: e.event_id,
      type: e.event_type,
      severity: e.severity,
      location: e.location.place_name,
      nostr_id: e.nostr_event_id,
      started_at: e.started_at,
    })),
  };

  // Canonical JSON → deterministic hash
  const canonical = JSON.stringify(digest, Object.keys(digest).sort());
  const digestHash = crypto.createHash('sha256').update(canonical).digest('hex');

  // Build OP_RETURN transaction
  const keyPair = ECPair.fromWIF(process.env.ANCHOR_WIF, NETWORK);
  const utxo = await fetchBestUTXO(process.env.ANCHOR_ADDRESS);

  const psbt = new bitcoin.Psbt({ network: NETWORK });

  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: bitcoin.address.toOutputScript(process.env.ANCHOR_ADDRESS, NETWORK),
      value: utxo.value,
    },
  });

  // OP_RETURN output with our 32-byte digest hash
  const opReturnScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN,
    Buffer.from(digestHash, 'hex'),
  ]);

  psbt.addOutput({ script: opReturnScript, value: 0 });
  psbt.addOutput({ address: process.env.ANCHOR_ADDRESS, value: utxo.value - 1000 });

  psbt.signInput(0, keyPair);
  psbt.finalizeAllInputs();

  const rawTx = psbt.extractTransaction().toHex();
  const txid = await broadcastTransaction(rawTx);

  return { txid, digestHash, digest };
}
```

#### Anchor Verification — Public API

Anyone can verify that SentinelMesh reported a specific event:

```
GET /api/verify/event/{event_id}

Response:
{
  "event_id": "...",
  "event_summary": "Flash flooding in Mathare Valley",
  "started_at": "2026-04-28T09:15:00Z",
  "nostr_event_id": "hex...",
  "nostr_relay_url": "wss://relay.damus.io",
  "bitcoin_txid": "hex...",
  "bitcoin_block": 2841293,
  "digest_hash": "hex...",
  "explorer_url": "https://blockstream.info/testnet/tx/{txid}",
  "verification_status": "CONFIRMED",
  "instructions": "To verify independently: 1) Look up the txid on any Bitcoin block explorer. 2) Find the OP_RETURN output. 3) The data field contains the SHA256 digest hash. 4) Download event data from /api/events/{event_id} and compute SHA256 to confirm match."
}
```

### 6.4 Nostr Key Management

```
SentinelMesh System Key:
  - One Nostr keypair representing SentinelMesh as an entity
  - Private key stored in environment variable (HSM in production)
  - Public key published in app and documentation for verification

User Keys:
  - Generated on device during onboarding
  - Private key: Android Keystore (hardware-backed)
  - Public key: stored in our DB linked to account
  - Users can export their nsec for use in other Nostr clients
  - Users can import existing Nostr identity

Key Recovery:
  - 12-word BIP39 mnemonic generated at onboarding
  - Shown once, user writes it down
  - No server-side key recovery (by design — we cannot see your location)
  - Lost key = new identity, historical reputation lost
    (this is a known UX tradeoff — document it clearly)
```

### 6.5 Blockchain Anchor Service — File Structure

```
backend/src/blockchain/
├── nostrPublisher.js         # Nostr event signing and relay publishing
├── nostrVerifier.js          # Signature verification
├── bitcoinAnchor.js          # OP_RETURN transaction builder
├── anchorScheduler.js        # Cron: weekly digest + critical event triggers
├── verificationApi.js        # Public verification endpoint
├── keyManager.js             # System key handling
└── relayManager.js           # Relay health monitoring, failover
```

---

## 7. Data Architecture

### 7.1 PostgreSQL Schema

```sql
-- ─── SAFETY EVENTS ─────────────────────────────────────────────────
-- Events derived from public signal aggregation
CREATE TABLE safety_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type        VARCHAR(30) NOT NULL,
  severity          VARCHAR(10) NOT NULL,        -- CRITICAL|HIGH|MEDIUM|LOW
  title             VARCHAR(200) NOT NULL,
  summary           TEXT,
  
  -- Location
  place_name        VARCHAR(200),
  lat               DECIMAL(10, 7) NOT NULL,
  lng               DECIMAL(10, 7) NOT NULL,
  county            VARCHAR(50),
  radius_meters     INT DEFAULT 500,
  
  -- Confidence & sourcing
  confidence        DECIMAL(4, 3),               -- 0.000 to 1.000
  source_count      INT DEFAULT 1,
  source_breakdown  JSONB DEFAULT '{}',           -- {twitter:2, news:1, radio:1}
  
  -- Lifecycle
  is_active         BOOLEAN DEFAULT true,
  started_at        TIMESTAMPTZ NOT NULL,
  resolved_at       TIMESTAMPTZ,
  last_updated      TIMESTAMPTZ DEFAULT NOW(),
  
  -- Blockchain references
  nostr_event_id    VARCHAR(64),
  bitcoin_txid      VARCHAR(64),
  bitcoin_block     INT,
  
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── COMMUNITY REPORTS ─────────────────────────────────────────────
CREATE TABLE community_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_type       VARCHAR(30) NOT NULL,
  description       TEXT,
  
  lat               DECIMAL(10, 7) NOT NULL,
  lng               DECIMAL(10, 7) NOT NULL,
  place_name        VARCHAR(200),
  
  -- Nostr identity (not linked to real identity on our servers)
  nostr_pubkey      VARCHAR(64) NOT NULL,
  nostr_signature   VARCHAR(128) NOT NULL,
  nostr_event_id    VARCHAR(64),
  
  -- Reputation at time of report
  reporter_tier     VARCHAR(20) DEFAULT 'NEWCOMER',
  
  -- Consensus state
  consensus_score   INT DEFAULT 1,
  status            VARCHAR(20) DEFAULT 'PENDING',
  confirmation_count INT DEFAULT 0,
  denial_count       INT DEFAULT 0,
  
  -- Media
  photo_ipfs_cid    VARCHAR(100),
  
  -- Linked to a safety event if confirmed
  linked_event_id   UUID REFERENCES safety_events(id),
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── REPORT VOTES ──────────────────────────────────────────────────
CREATE TABLE report_votes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id         UUID NOT NULL REFERENCES community_reports(id),
  voter_pubkey      VARCHAR(64) NOT NULL,
  vote              VARCHAR(10) NOT NULL,         -- CONFIRM | DENY
  voter_lat         DECIMAL(10, 7),               -- must be near report to vote
  voter_lng         DECIMAL(10, 7),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, voter_pubkey)                 -- one vote per person per report
);

-- ─── USER ACCOUNTS ─────────────────────────────────────────────────
-- Minimal. We store as little as possible.
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nostr_pubkey      VARCHAR(64) UNIQUE NOT NULL,
  
  -- Reputation only — no name, no email, no phone
  reputation_score  INT DEFAULT 0,
  reputation_tier   VARCHAR(20) DEFAULT 'NEWCOMER',
  total_reports     INT DEFAULT 0,
  accurate_reports  INT DEFAULT 0,
  
  -- Account age for Sybil resistance
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  last_active       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FAMILY CIRCLES ────────────────────────────────────────────────
CREATE TABLE circles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_pubkey      VARCHAR(64) NOT NULL,
  name              VARCHAR(50),                  -- "Kamau Family"
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE circle_members (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id         UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  member_pubkey     VARCHAR(64) NOT NULL,
  display_name      VARCHAR(30),                  -- chosen by the member themselves
  
  -- Alert preferences for this member
  alert_radius_km   DECIMAL(4, 1) DEFAULT 2.0,
  alert_severity    VARCHAR(10) DEFAULT 'HIGH',   -- minimum severity to alert
  
  joined_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(circle_id, member_pubkey)
);

-- ─── LOCATION BLOBS ────────────────────────────────────────────────
-- Encrypted location updates. Server cannot read these.
CREATE TABLE location_blobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_pubkey_hash VARCHAR(64) NOT NULL,     -- SHA256 of recipient pubkey
  sender_ephemeral_pubkey VARCHAR(64) NOT NULL,   -- for ECDH decryption
  encrypted_payload TEXT NOT NULL,                -- AES-256-GCM, server blind
  circle_id         UUID REFERENCES circles(id),
  expires_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BLOCKCHAIN ANCHORS ────────────────────────────────────────────
CREATE TABLE blockchain_anchors (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anchor_type       VARCHAR(20) NOT NULL,         -- WEEKLY_DIGEST | CRITICAL_EVENT
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  event_count       INT,
  digest_hash       VARCHAR(64) NOT NULL,
  digest_payload    JSONB NOT NULL,
  bitcoin_txid      VARCHAR(64),
  bitcoin_block     INT,
  bitcoin_network   VARCHAR(10) DEFAULT 'testnet',
  anchor_status     VARCHAR(20) DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ
);

-- ─── INDEXES ───────────────────────────────────────────────────────
CREATE INDEX idx_events_location    ON safety_events USING GIST (
  ll_to_earth(lat, lng)             -- PostGIS-compatible geo index
);
CREATE INDEX idx_events_active      ON safety_events(is_active, severity);
CREATE INDEX idx_events_type        ON safety_events(event_type, started_at DESC);
CREATE INDEX idx_reports_location   ON community_reports(lat, lng);
CREATE INDEX idx_reports_status     ON community_reports(status);
CREATE INDEX idx_blobs_recipient    ON location_blobs(recipient_pubkey_hash, expires_at);
CREATE INDEX idx_anchors_status     ON blockchain_anchors(anchor_status);
```

### 7.2 Redis Key Structure

```
# Active safety events cache (TTL: 5 minutes)
sentinel:events:active                → sorted set by severity

# Event details (TTL: 30 minutes)
sentinel:event:{event_id}             → JSON string

# WebSocket subscriptions (which clients want which geo area)
sentinel:subs:county:{county_name}    → set of socket_ids

# Rate limiting
sentinel:ratelimit:reports:{pubkey}   → counter (TTL: 1 hour)

# Deduplication (signal ingest)
sentinel:dedup:{content_hash}         → "1" (TTL: 24 hours)

# Location blob queue (pending delivery)
sentinel:locations:{pubkey_hash}      → list of encrypted blobs
```

---

## 8. API Specification

### 8.1 Safety Events

```
GET  /api/events
     ?lat=-1.2921&lng=36.8219
     &radius_km=10
     &severity=HIGH,CRITICAL
     &type=FLOOD,SECURITY_INCIDENT
     &active_only=true
     → { events: [...], total: int }

GET  /api/events/{event_id}
     → Full event object with source breakdown

GET  /api/events/{event_id}/reports
     → Community reports linked to this event

GET  /api/verify/{event_id}
     → Blockchain verification status and proof
```

### 8.2 Community Reports

```
POST /api/reports
     Body: { type, description, lat, lng, photo_ipfs_cid,
             nostr_pubkey, nostr_signature, timestamp }
     → { report_id, status, nostr_event_id }

POST /api/reports/{report_id}/vote
     Body: { vote: "CONFIRM"|"DENY", voter_lat, voter_lng,
             nostr_pubkey, nostr_signature }
     → { new_score, new_status }

GET  /api/reports
     ?lat&lng&radius_km&status
     → { reports: [...] }
```

### 8.3 Family Circles

```
POST /api/circles
     Auth: Bearer JWT
     Body: { name }
     → { circle_id, invite_token }

POST /api/circles/join
     Auth: Bearer JWT
     Body: { invite_token, display_name, member_pubkey }
     → { circle_id, members: [...] }

DELETE /api/circles/{circle_id}/members/me
     Auth: Bearer JWT
     → 204 No Content (immediate effect)

POST /api/circles/{circle_id}/location
     Auth: Bearer JWT
     Body: { recipient_pubkey_hash, sender_ephemeral_pubkey, encrypted_payload }
     → 201 Created

GET  /api/circles/{circle_id}/locations
     Auth: Bearer JWT
     → { blobs: [{ sender_ephemeral_pubkey, encrypted_payload }] }
     (Server returns blobs — client decrypts)

POST /api/circles/{circle_id}/checkin
     Auth: Bearer JWT
     Body: { status: "SAFE"|"HELP"|"CUSTOM", message?: string }
     → 200 OK (broadcast to circle)
```

### 8.4 WebSocket Events

```
Connect: wss://api.sentinelmesh.ke/ws
         ?county=nairobi&lat=-1.2921&lng=36.8219

Server → Client events:

  { type: "NEW_EVENT",      payload: SafetyEvent }
  { type: "EVENT_UPDATED",  payload: { event_id, changes } }
  { type: "EVENT_RESOLVED", payload: { event_id } }
  { type: "NEW_REPORT",     payload: CommunityReport }
  { type: "REPORT_VERIFIED",payload: { report_id, new_status } }
  { type: "PROXIMITY_ALERT",payload: ProximityAlert }
  { type: "CHECKIN_UPDATE", payload: { member_name, status } }
  { type: "LOCATION_UPDATE",payload: { blobs: [...] } }
```

---

## 9. Mobile Application (Android + PWA)

### 9.1 React Native Project Structure

```
sentinel-mobile/
├── android/                          # Android native config
├── src/
│   ├── App.tsx                       # Root component, navigation
│   ├── screens/
│   │   ├── MapScreen.tsx             # Main safety map
│   │   ├── EventDetailScreen.tsx     # Full event details + verify
│   │   ├── ReportScreen.tsx          # Submit community report
│   │   ├── CircleScreen.tsx          # Family circle management
│   │   ├── LocationScreen.tsx        # Live location view (circle)
│   │   └── VerifyScreen.tsx          # Blockchain proof viewer
│   ├── components/
│   │   ├── EventMarker.tsx           # Map pin by severity/type
│   │   ├── EventCard.tsx             # Event summary card
│   │   ├── ReportCard.tsx            # Community report card
│   │   ├── ProximityAlert.tsx        # Crisis proximity banner
│   │   ├── MemberDot.tsx             # Family member on map
│   │   ├── GhostModeToggle.tsx       # Instant privacy toggle
│   │   └── CheckInButton.tsx         # I'm Safe / I Need Help
│   ├── services/
│   │   ├── locationService.ts        # Fused location, background tracking
│   │   ├── cryptoService.ts          # X25519, AES-256-GCM
│   │   ├── nostrService.ts           # Key generation, signing
│   │   ├── websocketService.ts       # Real-time connection
│   │   └── notificationService.ts   # FCM push notifications
│   ├── store/
│   │   ├── eventsSlice.ts            # Redux: safety events
│   │   ├── circleSlice.ts            # Redux: family circle state
│   │   └── settingsSlice.ts          # Redux: user preferences
│   └── utils/
│       ├── geo.ts                    # Distance calculations
│       ├── severity.ts               # Severity → colour/icon
│       └── offline.ts                # SQLite offline cache
├── pwa/                              # PWA-specific config
│   ├── manifest.json
│   ├── service-worker.js             # Offline caching strategy
│   └── index.html
└── package.json
```

### 9.2 Offline Strategy

Crises often coincide with network congestion. The app must be useful when connectivity is poor.

```
Offline-first approach:

Data cached locally (SQLite via react-native-sqlite-storage):
  - Last 100 safety events for user's county
  - All events from last 24 hours within 20km
  - User's circle member list and last known locations
  - User's pending reports (submitted when connectivity returns)
  - Full Kenya event history for verification

Cache invalidation:
  - Events: sync every 5 minutes when connected
  - Locations: sync every 60 seconds when connected
  - On reconnect: pull delta since last_sync timestamp

Background sync (Android WorkManager):
  - Retry failed report submissions
  - Pull latest events even when app is not open
  - Deliver proximity alerts via FCM even offline

PWA offline:
  - Service Worker caches app shell + map tiles for Nairobi + surroundings
  - Mapbox offline tile packs for key Kenya counties
  - IndexedDB mirrors SQLite structure for web
```

### 9.3 Map Configuration

```typescript
// Mapbox configuration for Kenya
const MAP_CONFIG = {
  initialRegion: {
    // Centre on Nairobi
    latitude: -1.2921,
    longitude: 36.8219,
    latitudeDelta: 0.15,
    longitudeDelta: 0.15,
  },
  
  // Offline tile pack — download on first launch over WiFi
  offlinePack: {
    name: 'nairobi-county',
    bounds: [
      [36.6500, -1.4500],   // SW
      [37.1000, -1.1500],   // NE
    ],
    minZoom: 10,
    maxZoom: 16,
  },
  
  styleUrl: 'mapbox://styles/mapbox/dark-v11', // dark = battery saving
};

// Event type → map pin colour
const SEVERITY_COLOURS = {
  CRITICAL: '#FF2D2D',
  HIGH:     '#FF8C00',
  MEDIUM:   '#FFD700',
  LOW:      '#4CAF50',
};

// Event type → icon
const EVENT_ICONS = {
  FLOOD:              '🌊',
  SECURITY_INCIDENT:  '🔴',
  FIRE:               '🔥',
  ROAD_BLOCKED:       '🚧',
  PROTEST_MARCH:      '📢',
  ACCIDENT:           '🚗',
  INFRASTRUCTURE:     '⚡',
  CIVIL_UNREST:       '⚠️',
};
```

### 9.4 PWA Configuration

```json
// manifest.json
{
  "name": "SentinelMesh",
  "short_name": "Sentinel",
  "description": "Community safety intelligence for Kenya",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#FF4500",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "categories": ["safety", "navigation", "lifestyle"],
  "lang": "sw"
}
```

---

## 10. AI & NLP Pipeline

### 10.1 Model Stack

```
Task                    Model                         Runtime
──────────────────────────────────────────────────────────────────
Event classification    Gemma 2 2B (fine-tuned)        llama.cpp
Named entity recog.     spaCy + custom pipeline        Python
Location resolution     Kenya gazetteer lookup         PostgreSQL
Radio transcription     Whisper Large v3               Python
Spam detection          DistilBERT fine-tuned          Python
Face detection (photo)  MediaPipe (on-device)          React Native
Language detection      langdetect                     Python
Acoustic threat det.    YAMNet TFLite (on-device)      React Native (TFLite)
```

### 10.2 Fine-Tuning Dataset Construction

```
Target: 10,000 labelled examples for event classification

Sources:
  1. Kenya Red Cross situation reports 2018–2024 (PDF → text)
     Labels: FLOOD, FIRE, SECURITY_INCIDENT, MEDICAL_EMERGENCY
     Count target: 2,000 examples

  2. Twitter archive — Kenya safety hashtags
     #NairobiTraffic, #KenyaFloods, #Maandamano, #NairobiAccident
     Labels: manual annotation + heuristic pre-labelling
     Count target: 5,000 examples (sw + en mixed)

  3. Nation/Standard news headlines + first paragraphs
     Labels: derived from article category + keyword rules
     Count target: 2,000 examples

  4. Synthetic Swahili examples (GPT-4 assisted generation)
     For underrepresented categories (EARTHQUAKE, TSUNAMI)
     Count target: 1,000 examples

Annotation guidelines:
  - Each example annotated by 2 independent annotators
  - Disagreements resolved by third annotator
  - Minimum Cohen's kappa > 0.80 before training
  - Sheng phrases mapped to standard Swahili equivalents

Label distribution target:
  TRAFFIC_INCIDENT:       25%
  FLOOD:                  20%
  CIVIL_UNREST:           15%
  SECURITY_INCIDENT:      15%
  FIRE:                   10%
  MEDICAL_EMERGENCY:       8%
  INFRASTRUCTURE:          5%
  FALSE_ALARM:             2%
```

### 10.3 Whisper Radio Pipeline

```python
import whisper
import httpx
import asyncio
from io import BytesIO

# Load Whisper once at startup — large-v3 for best Swahili accuracy
model = whisper.load_model("large-v3")

RADIO_STREAMS = {
  "citizen_radio": "https://stream.radiojar.com/citizen-radio",
  "radio_maisha":  "https://stream.radiojar.com/radio-maisha",
  "inooro_fm":     "https://stream.radiojar.com/inooro-fm",
}

async def transcribe_stream_window(stream_url: str, duration_seconds: int = 30):
  """
  Capture a 30-second audio window from a radio stream
  and transcribe it with Whisper.
  """
  async with httpx.AsyncClient() as client:
    audio_buffer = BytesIO()
    
    # Capture 30 seconds of audio
    async with client.stream("GET", stream_url) as response:
      bytes_read = 0
      target_bytes = 128000 * duration_seconds // 8  # ~128kbps
      
      async for chunk in response.aiter_bytes(chunk_size=4096):
        audio_buffer.write(chunk)
        bytes_read += len(chunk)
        if bytes_read >= target_bytes:
          break
    
    audio_buffer.seek(0)
    
    # Transcribe — force Swahili + English detection
    result = model.transcribe(
      audio_buffer,
      language=None,           # auto-detect sw or en
      task="transcribe",
      initial_prompt="Kenya news broadcast in Swahili or English:",
      fp16=False,              # use fp32 on CPU inference
    )
    
    return {
      "text": result["text"],
      "language": result["language"],
      "segments": result["segments"],
    }

async def monitor_radio_continuous():
  """
  Run all radio streams concurrently, transcribing every 30 seconds.
  Pass transcripts to NLP classifier.
  """
  while True:
    tasks = [
      transcribe_stream_window(url)
      for url in RADIO_STREAMS.values()
    ]
    
    transcripts = await asyncio.gather(*tasks, return_exceptions=True)
    
    for transcript in transcripts:
      if isinstance(transcript, Exception):
        continue  # stream temporarily unavailable
      
      if len(transcript["text"].strip()) < 20:
        continue  # silence or noise, skip
      
      # Pass to event classifier
      await classify_and_emit(transcript["text"], source="radio")
    
    await asyncio.sleep(30)  # next window
```

### 10.4 Location Extraction Pipeline

```python
import spacy
import json

nlp = spacy.load("en_core_web_sm")  # base model

with open("gazetteer/kenya_places.json") as f:
  GAZETTEER = json.load(f)

# Build reverse lookup including aliases
ALIAS_MAP = {}
for canonical_name, data in GAZETTEER.items():
  ALIAS_MAP[canonical_name.lower()] = (canonical_name, data)
  for alias in data.get("aliases", []):
    ALIAS_MAP[alias.lower()] = (canonical_name, data)

def extract_locations(text: str) -> list[dict]:
  """
  Extract Kenya locations from text using spaCy NER
  combined with Kenya gazetteer lookup.
  Returns list of {place_name, lat, lng, confidence} dicts.
  """
  doc = nlp(text)
  
  found_locations = []
  
  # Check spaCy's GPE (geopolitical entity) entities
  for ent in doc.ents:
    if ent.label_ in ("GPE", "LOC", "FAC"):
      lookup = ALIAS_MAP.get(ent.text.lower())
      if lookup:
        canonical_name, data = lookup
        found_locations.append({
          "place_name": canonical_name,
          "lat": data["lat"],
          "lng": data["lng"],
          "county": data.get("county"),
          "confidence": 0.85,  # spaCy + gazetteer match
        })
  
  # Also do direct gazetteer scan for short place names spaCy might miss
  text_lower = text.lower()
  for alias, (canonical_name, data) in ALIAS_MAP.items():
    if alias in text_lower and alias not in [l["place_name"].lower() for l in found_locations]:
      found_locations.append({
        "place_name": canonical_name,
        "lat": data["lat"],
        "lng": data["lng"],
        "county": data.get("county"),
        "confidence": 0.65,  # direct string match only
      })
  
  # Deduplicate and return highest-confidence match
  seen = set()
  unique = []
  for loc in sorted(found_locations, key=lambda x: x["confidence"], reverse=True):
    if loc["place_name"] not in seen:
      seen.add(loc["place_name"])
      unique.append(loc)
  
  return unique[:3]  # max 3 locations per signal
```

---

## 11. Privacy & Security Model

### 11.1 Data Minimisation by Design

```
What we store                What we DO NOT store
────────────────────────────────────────────────────
Nostr pubkey                 Real name
Reputation score             Phone number
Report history               Email address
Encrypted location blobs     Decrypted locations
Circle membership            Location history
Nostr event IDs              Raw audio from radio streams
IPFS CIDs for photos         Original unprocessed photos
                             EXIF data from any image
                             Individual movement patterns
                             Device identifiers
```

### 11.2 Threat Model

```
Threat: Government demands user location data
Mitigation: Server stores only encrypted blobs. Mathematically cannot comply.

Threat: Database breach exposes user locations
Mitigation: Encrypted blobs are useless without user's private key.

Threat: Coordinated fake reports during election
Mitigation: Sybil resistance, account age requirements, SENTINEL tier slow to earn,
            reputation system with economic cost to creating fake history.

Threat: State actor suppresses safety events
Mitigation: Events published to Nostr (multi-relay), anchored to Bitcoin.
            Deletion from SentinelMesh servers does not remove from chain.

Threat: App is forced to add tracking backdoor
Mitigation: Open source. Any backdoor is visible in code.
            E2E encryption means backdoor would require re-engineering clients.

Threat: SentinelMesh company becomes surveillance tool
Mitigation: Nostr keys are user-owned, portable to any Nostr client.
            Data export always available. Network is not dependent on us.
```

### 11.3 Authentication

```
User identity = Nostr keypair (generated on device)
No passwords. No email accounts. No phone verification.

JWT sessions:
  - Issued by signing a challenge with Nostr private key
  - Server verifies signature against pubkey
  - JWT contains only: { sub: nostr_pubkey, iat, exp }
  - JWT TTL: 30 days
  - Refresh: re-sign challenge (key never leaves device)

API security:
  - All endpoints: HTTPS only (TLS 1.3)
  - Community reports: Nostr signature verified server-side
  - Location blobs: encrypted before leaving device
  - Rate limiting: per pubkey, per IP
  - Helmet.js security headers
  - CORS: app domains only
```

---

## 12. Infrastructure & Deployment

### 12.1 Server Architecture

```
Production setup:

  Railway (primary):
    - API Gateway (Node.js): 2 × 2vCPU / 4GB RAM instances
    - Signal Service (Python): 1 × 4vCPU / 8GB RAM (NLP inference)
    - Blockchain Service (Node.js): 1 × 1vCPU / 1GB RAM

  Managed services:
    - PostgreSQL: Railway Postgres (daily backups)
    - Redis: Railway Redis
    - IPFS: Pinata (photo storage)

  CDN:
    - Cloudflare (global edge, DDoS protection)
    - Cloudflare R2 (static assets, PWA files)

  Monitoring:
    - Uptime: BetterStack
    - Error tracking: Sentry
    - Metrics: Prometheus + Grafana

Estimated monthly cost (initial):
  Railway instances:    ~$80
  PostgreSQL:           ~$20
  Redis:                ~$15
  Pinata IPFS:          ~$10
  Cloudflare:           Free tier initially
  Bitcoin anchor wallet: ~5000 sats/year (~KES 0.70)
  ─────────────────────────────
  Total:                ~$125/month (~KES 17,500)
```

### 12.2 Environment Variables

```bash
# ─── SERVER ──────────────────────────────────────────
NODE_ENV=production
PORT=3000
DASHBOARD_URL=https://sentinel.ke

# ─── DATABASE ────────────────────────────────────────
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# ─── NOSTR ───────────────────────────────────────────
NOSTR_PRIVATE_KEY=hex_private_key
NOSTR_PUBLIC_KEY=hex_public_key
NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol,wss://nostr.wine

# ─── BITCOIN ─────────────────────────────────────────
BITCOIN_NETWORK=testnet
ANCHOR_WIF=testnet_wif_private_key
ANCHOR_ADDRESS=testnet_address
BITCOIN_RPC_URL=http://user:pass@localhost:18332

# ─── TWITTER ─────────────────────────────────────────
TWITTER_BEARER_TOKEN=...
TWITTER_API_KEY=...
TWITTER_API_SECRET=...

# ─── IPFS ────────────────────────────────────────────
PINATA_API_KEY=...
PINATA_SECRET=...

# ─── SIGNAL SERVICE (Python) ─────────────────────────
SIGNAL_SERVICE_URL=http://signal-service:8000
SIGNAL_SERVICE_SECRET=internal_secret

# ─── PUSH NOTIFICATIONS ──────────────────────────────
FCM_SERVER_KEY=...

# ─── AUTH ────────────────────────────────────────────
JWT_SECRET=min_64_char_random_string
JWT_EXPIRES_IN=30d
```

---

## 13. Build Sequence & Milestones

### Phase 1 — Core Signal Layer (Weeks 1–3)

```
Week 1:
  ☐ PostgreSQL schema deployed
  ☐ Signal ingest service scaffolded (Python + FastAPI)
  ☐ RSS news parsers live (Nation, Standard, Citizen, NTV)
  ☐ Basic event classification with pretrained model (English only)
  ☐ Safety events stored and served via REST API

Week 2:
  ☐ Kenya gazetteer built (1,000+ places minimum)
  ☐ Location extraction pipeline live
  ☐ Twitter filtered stream live (Kenya bounding box)
  ☐ WebSocket server broadcasting events to connected clients
  ☐ Redis pub/sub wired end-to-end

Week 3:
  ☐ Whisper radio transcription pipeline (2 stations minimum)
  ☐ Swahili fine-tuning dataset construction begun
  ☐ Event deduplication and fusion working
  ☐ PWA scaffold deployed — map shows live events
```

### Phase 2 — Community Reports (Weeks 4–5)

```
Week 4:
  ☐ Nostr keypair generation on client
  ☐ Report submission endpoint with Nostr signature verification
  ☐ Report vote system and consensus scoring engine
  ☐ IPFS photo upload with EXIF stripping (client-side)
  ☐ Reports visible on map (PENDING and above)

Week 5:
  ☐ Reputation system implemented
  ☐ Anti-abuse: rate limiting, spam classifier
  ☐ Report → safety event linking (AUTHORITATIVE reports upgrade events)
  ☐ Nostr relay publishing for community reports
  ☐ Report verification page (show Nostr event ID + relay link)
```

### Phase 3 — Family Circles (Weeks 6–7)

```
Week 6:
  ☐ X25519 key generation and storage (Android Keystore)
  ☐ Location encryption/decryption (AES-256-GCM) on device
  ☐ Circle creation and invite flow (QR + 8-digit code)
  ☐ Encrypted location blob upload/download
  ☐ Location rendering on private map (circle view)

Week 7:
  ☐ Ghost mode (instant, one-tap)
  ☐ Proximity alert engine (member near verified event)
  ☐ Check-in system (I'm Safe / I Need Help)
  ☐ Dead man's switch (opt-in, configurable)
  ☐ FCM push notifications for proximity alerts
```

### Phase 4 — Blockchain & Polish (Weeks 8–10)

```
Week 8:
  ☐ Nostr system keypair configured
  ☐ Safety events auto-published to Nostr on VERIFIED status
  ☐ Bitcoin testnet OP_RETURN weekly digest anchor
  ☐ Critical event immediate anchoring
  ☐ Public verification API endpoint

Week 9:
  ☐ Android APK build (React Native)
  ☐ PWA production build + service worker offline caching
  ☐ Mapbox offline tile pack for Nairobi + major counties
  ☐ Swahili fine-tuned model integrated (replace pretrained)
  ☐ Full offline mode tested (airplane mode simulation)

Week 10:
  ☐ Security audit (auth flows, encryption, injection)
  ☐ Load testing (simulate 10,000 concurrent WebSocket connections)
  ☐ 3 pilot chamas / community groups in Kibera onboarded
  ☐ Bug fixes from pilot feedback
  ☐ Testnet → Mainnet Bitcoin switch
```

### Phase 5 — Competitive Parity & Beyond (Weeks 11–14)

> Closes the gap with Spairally on real-time threat detection, adds proactive escape navigation, and activates Bitcoin Lightning tipping for community reporters.
> Implementation plans: see `docs/superpowers/plans/2026-04-30-*.md`

```
Week 11:
  ☐ YAMNet TFLite model bundled into Android APK
  ☐ AudioCapture service — 16kHz PCM windowing (Task 2 of acoustic plan)
  ☐ AcousticDetectionService — TFLite inference loop (Task 3)
  ☐ AcousticAlert banner component (Task 6)
  ☐ Acoustic detection wired into MapScreen with mic permission (Task 7)

Week 12:
  ☐ Acoustic auto-submit — detections become PENDING community reports (Task 5)
  ☐ Geo utility functions — bearing, destination point, line distance (Task 1 of routes plan)
  ☐ RoutingService — Mapbox Directions escape waypoint fetching (Task 2)
  ☐ SafeRouteOverlay — Mapbox polyline layer (Task 3)
  ☐ ProximityAlert wired to fetch and display escape routes (Task 4)

Week 13:
  ☐ lightning_zaps DB migration (Task 1 of zaps plan)
  ☐ LND REST client — invoice creation and payment lookup (Task 2)
  ☐ ZapService — invoice lifecycle + Kind 9735 receipt (Task 3)
  ☐ Zap API routes with HMAC webhook verification (Task 4)

Week 14:
  ☐ ZapButton component on ReportCard (Task 5)
  ☐ ZapScreen — QR invoice display and Lightning wallet deep links (Task 6)
  ☐ total_zaps_sats aggregated and displayed on report cards
  ☐ End-to-end test: acoustic detection → report → proximity alert → escape routes
  ☐ End-to-end test: report → zap → Kind 9735 receipt on Nostr
  ☐ Pilot with 5 community reporters in Nairobi receiving first zaps
```

---

## 14. Testnet → Mainnet Checklist

```
Bitcoin:
  ☐ Switch BITCOIN_NETWORK=mainnet
  ☐ Fund anchor wallet with real BTC (5,000 sats sufficient for 5 years)
  ☐ Update block explorer URLs to mainnet Blockstream

Nostr:
  ☐ Generate production system keypair (store private key in HSM or vault)
  ☐ Publish SentinelMesh npub to app documentation
  ☐ Add africa.nostr.net to relay list when available

Infrastructure:
  ☐ Enable Cloudflare DDoS protection (critical during election periods)
  ☐ Set up database read replica for signal service queries
  ☐ Configure automated daily PostgreSQL backups to separate region
  ☐ Set up Sentry error tracking in production
  ☐ Configure BetterStack uptime alerts (SMS to on-call)

AI Models:
  ☐ Swahili fine-tuned model validated (F1 > 0.85 on held-out test set)
  ☐ Whisper pipeline running 24/7 on minimum 3 radio stations
  ☐ Kenya gazetteer expanded to 2,000+ places

Legal & Compliance:
  ☐ Privacy policy published (clear data minimisation commitment)
  ☐ Open source repository published (builds community trust)
  ☐ Terms of service: explicitly prohibit law enforcement resale
  ☐ Kenya Data Protection Act (2019) compliance review
  ☐ Communications Authority of Kenya notification (if required)

Community:
  ☐ 10+ pilot communities across Nairobi counties onboarded
  ☐ Community feedback loop established
  ☐ SENTINEL-tier user group identified and engaged
  ☐ Swahili app localisation 100% complete
```

---

---

## 15. Module 5 — Acoustic Threat Detection

### 15.1 Overview

Spairally's core differentiator is that it detects threats **as they happen**, on-device, without waiting for a tweet or a news article. SentinelMesh closes this gap by embedding a YAMNet-based TFLite classifier into the Android app. When the model detects a threat sound above confidence 0.80, it alerts the user instantly — no network required — and silently submits a `PENDING` community report so the broader SentinelMesh network can corroborate.

The key advantage over Spairally: SentinelMesh's community consensus engine suppresses false positives. A car backfire that triggers YAMNet never reaches `VERIFIED` status unless nearby users confirm it. Spairally shows a single model's output with no check.

### 15.2 Threat Categories Detected

```
YAMNet Class → SentinelMesh Category
─────────────────────────────────────
Gunshot (427)         → SECURITY_INCIDENT
Explosion (429)       → SECURITY_INCIDENT
Screaming (25)        → SECURITY_INCIDENT
Yell (26)             → SECURITY_INCIDENT
Glass breaking (60)   → SECURITY_INCIDENT
Crowd (345)           → CIVIL_UNREST
Fire alarm (401)      → FIRE
Smoke detector (402)  → FIRE
Crash (504, 505)      → ACCIDENT
```

### 15.3 Detection Flow

```
Microphone (16kHz mono)
        │
        ▼
┌─────────────────────────────────┐
│     AudioCapture                │
│  0.96s windows (15,360 samples) │
│  PCM → Float32 normalised       │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   AcousticDetectionService      │
│   YAMNet TFLite (1.7MB)         │
│   521 class scores              │
│   Threshold: 0.80               │
└──────┬───────────────┬──────────┘
       │ < threshold   │ ≥ threshold
       ▼               ▼
    (discard)    ThreatDetection
                       │
              ┌────────┴────────┐
              ▼                 ▼
        Redux store        autoSubmit()
        → AcousticAlert    → POST /api/reports
          (on-screen)        status: PENDING
                             (community verifies)
```

### 15.4 Privacy Guarantees

- Raw audio never leaves the device. No audio is stored anywhere.
- The model processes 0.96-second windows in real time and discards them.
- Auto-submitted reports contain only: event category, description noting "acoustic detection", GPS coordinates, and Nostr signature.

### 15.5 New Mobile Files

```
sentinel-mobile/src/
├── constants/
│   └── acousticThreats.ts        # YAMNet class map, getThreatFromScores
├── services/
│   ├── audioCapture.ts           # 16kHz microphone capture + PCM windowing
│   ├── acousticDetectionService.ts # TFLite inference loop
│   └── reportAutoSubmit.ts       # Wraps detections into /api/reports POST
├── store/
│   └── acousticSlice.ts          # Redux: isRunning, currentAlert
└── components/
    └── AcousticAlert.tsx          # Alert banner, auto-dismisses in 30s
```

**No new backend code.** Acoustic detections use the existing `POST /api/reports` endpoint and the existing consensus verification pipeline.

**Full implementation plan:** `docs/superpowers/plans/2026-04-30-acoustic-threat-detection.md`

---

## 16. Module 6 — Safe Route Recommendations

### 16.1 Overview

When a proximity alert fires — "you are 800m from an active CIVIL_UNREST event" — SentinelMesh now does what Spairally does: shows the user how to get away. The escape routes are computed using Mapbox Directions API from the user's current position, routing away from the event in 3 bearing directions. Routes that pass through the event zone are filtered out and not shown.

This is meaningfully better than Spairally's acoustic-only escape routes because SentinelMesh routes around a **verified, georeferenced event polygon** with a known radius, not just a microphone's sense of direction.

### 16.2 Route Calculation Logic

```
Given: user_location, event_location, event_radius_meters

1. safe_bearing = bearing FROM event_location TO user_location
   (the direction that moves away from the threat)

2. Three escape waypoints, each 2km from user:
   waypoint_1 = destination(user, 2km, safe_bearing)
   waypoint_2 = destination(user, 2km, safe_bearing + 45°)
   waypoint_3 = destination(user, 2km, safe_bearing - 45°)

3. For each waypoint:
   → call Mapbox Walking Directions API
   → check every coordinate in returned route geometry
   → if any coordinate is within (event_radius + 200m) of event_location: discard
   → otherwise: include route

4. Return up to 3 surviving routes, labelled Route 1–3
```

### 16.3 Map Rendering

Routes are rendered as `@rnmapbox/maps` `LineLayer` overlays on the existing Mapbox map. Colours signal confidence:

```
Route 1 (safest bearing):  green  #00C853
Route 2 (+45° bearing):    yellow #FFD600
Route 3 (−45° bearing):    orange #FF6D00
```

Routes are cleared when the proximity alert is dismissed.

### 16.4 New Mobile Files

```
sentinel-mobile/src/
├── utils/
│   └── geo.ts                    # bearingBetween, destinationPoint, pointToLineDistance
├── services/
│   └── routingService.ts         # fetchSafeRoutes — waypoints + Mapbox Directions + filter
└── components/
    └── SafeRouteOverlay.tsx       # ShapeSource + LineLayer for route display
```

`ProximityAlert.tsx` and `MapScreen.tsx` are modified to trigger route fetch and render overlay.

**No new backend code.** All routing computation is client-side.

**Full implementation plan:** `docs/superpowers/plans/2026-04-30-safe-route-recommendations.md`

---

## 17. Module 7 — Lightning Zaps for Community Reporters

### 17.1 Overview

Community reporters who submit accurate, AUTHORITATIVE reports are the backbone of SentinelMesh. Module 7 lets the community reward them with Bitcoin Lightning tips (zaps). This is the Nostr Kind 9735 zap spec applied to safety reporting — a mechanism no Western public safety app has shipped and that Spairally has no equivalent of.

The incentive alignment: accurate reporting earns sats. Inaccurate reporting destroys reputation. The Lightning economic layer makes the reputation system tangible.

### 17.2 Zap Flow

```
1. User sees a community report that helped them
2. Taps ⚡ ZapButton → selects amount (default: 21 sats)
3. App: POST /api/zaps/request { report_id, amount_sats }
4. Backend:
   a. Fetches reporter's Nostr pubkey from community_reports
   b. Calls LND REST API → creates BOLT11 invoice
   c. Returns { zap_id, payment_request }
5. App: shows invoice as QR code + copyable string + wallet deep links
6. User pays from any Lightning wallet
7. LND: fires payment webhook → POST /api/zaps/webhook
8. Backend:
   a. Verifies HMAC signature
   b. Marks lightning_zaps row as paid
   c. Publishes Nostr Kind 9735 zap receipt to reporter's relays
9. Reporter's report card shows updated sats count
```

### 17.3 Why Nostr Kind 9735

The zap receipt is published under SentinelMesh's Nostr system keypair and tagged with the reporter's pubkey. This means:
- The reporter can see all their earned zaps in any Nostr client — not just SentinelMesh
- The record is censorship-resistant — SentinelMesh cannot retroactively erase a reporter's earnings
- The total sats a reporter has earned is publicly verifiable by anyone

### 17.4 New Backend Files

```
backend/src/
├── migrations/
│   └── 004_add_zaps.sql          # lightning_zaps table
├── lightning/
│   ├── lndClient.js              # LND REST API wrapper
│   └── zapService.js             # createZapRequest, handlePaymentWebhook, Kind 9735
└── routes/
    └── zap.js                    # POST /api/zaps/request, POST /api/zaps/webhook
```

### 17.5 New Mobile Files

```
sentinel-mobile/src/
├── components/
│   └── ZapButton.tsx             # ⚡ tip button shown on report cards
└── screens/
    └── ZapScreen.tsx             # QR invoice, copy, Lightning wallet deep links
```

`ReportCard.tsx` is modified to include `ZapButton` and display `total_zaps_sats`.

### 17.6 New API Endpoints

```
POST /api/zaps/request
     Body: { report_id: string, amount_sats: number }
     → { zap_id, payment_request, amount_sats }

POST /api/zaps/webhook
     Header: x-lnd-signature (HMAC-SHA256)
     Body: { payment_hash: string }
     → { ok: true }
```

### 17.7 New DB Table

```sql
lightning_zaps (
  id, report_id, recipient_pubkey,
  amount_sats, bolt11_invoice, payment_hash,
  status,           -- pending | paid | expired
  paid_at,
  zap_receipt_id,   -- Nostr Kind 9735 event ID
  zap_receipt_json,
  created_at, expires_at
)
```

**Full implementation plan:** `docs/superpowers/plans/2026-04-30-lightning-zaps-reporters.md`

---

## Appendix: Why This Cannot Become Surveillance

The question will be asked — by users, by journalists, by governments. This is the honest technical answer:

**Server-side:** The database stores encrypted location blobs the server cannot decrypt. Even a court order to produce user locations produces mathematically useless ciphertext.

**Identity layer:** Nostr pubkeys have no required link to real identity. No name, no phone, no email collected at registration.

**Public signal layer:** Only publicly available data is processed. No private communications are intercepted. This is the same data a diligent human researcher could read manually — the AI simply reads faster.

**Community reports:** Users are anonymous to the system. The Nostr pubkey is a pseudonym. Reputation is earned by pseudonym, not person.

**Open source mandate:** All code is public. Any backdoor inserted under government pressure is visible to every security researcher globally. The encryption cannot be silently weakened.

**Nostr portability:** Users own their keys. If SentinelMesh is compromised or shut down, users take their identity and reputation to any Nostr client. The network survives the company.

---

*SentinelMesh — Built for communities. Verified by Bitcoin. Owned by no one.*
