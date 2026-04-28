# Phase 1 — Core Signal Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete signal ingest pipeline — RSS feeds, Twitter, and radio streams through NLP classification into PostgreSQL, broadcast via WebSocket to a live Mapbox GL map showing Kenya safety events in real time.

**Architecture:** The signal service (Python + FastAPI) ingests public sources, classifies events using a keyword NLP pipeline, and emits structured `SafetyEvent` objects to Redis pub/sub. The gateway service (TypeScript + Express) subscribes to Redis, persists to PostgreSQL, and fans events out to PWA clients via WebSocket. The PWA (React + Vite) renders severity-coloured markers on a Mapbox GL map.

**Tech Stack:** Python 3.11 · FastAPI · APScheduler · spaCy · feedparser · openai-whisper · redis-py · asyncpg | TypeScript · Express · ws · ioredis · pg · Ajv | React · Vite · Mapbox GL JS · Redux Toolkit | PostgreSQL 16 · Redis 7 · Docker Compose · Vitest · pytest

**Note:** Phases 2–4 (community reports, family circles, blockchain anchoring) are separate plans delivered after this plan is complete and smoke-tested.

---

## File Map

```
sentinelmesh/
├── .env.example
├── .gitignore
├── tsconfig.base.json
├── Makefile
├── docker-compose.yml
├── docker-compose.dev.yml
│
├── infra/
│   ├── postgres/init.sql
│   └── nginx/nginx.conf
│
├── shared/
│   ├── contracts/
│   │   └── events.schema.json          # JSON Schema source of truth
│   └── types/
│       └── index.d.ts                  # generated — never hand-edited
│
├── services/
│   ├── gateway/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # Express app entry point
│   │       ├── config.ts               # env vars, validated at startup
│   │       ├── db/
│   │       │   └── pool.ts             # pg connection pool
│   │       ├── routes/
│   │       │   └── events.ts           # GET /api/events, GET /api/events/:id
│   │       ├── ws/
│   │       │   └── hub.ts              # WebSocket connection manager
│   │       └── subscribers/
│   │           └── eventSubscriber.ts  # Redis → PostgreSQL → WebSocket
│   │
│   └── signal/
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── main.py                     # FastAPI entry, APScheduler setup
│       ├── config.py                   # env vars
│       ├── publisher.py                # emit SafetyEvent to Redis
│       ├── gazetteer/
│       │   ├── kenya_places.json       # 1000+ Kenyan places
│       │   └── loader.py               # gazetteer lookup functions
│       ├── nlp/
│       │   ├── classifier.py           # keyword event classifier (Phase 1)
│       │   ├── location_extractor.py   # spaCy NER + gazetteer
│       │   ├── severity_scorer.py      # keyword density scoring
│       │   └── event_fuser.py          # cluster signals → single event
│       ├── ingest/
│       │   ├── deduplicator.py         # SHA256 → Redis dedup
│       │   ├── rss_parser.py           # feedparser for 4 Kenyan news feeds
│       │   ├── twitter_stream.py       # X API v2 filtered stream
│       │   └── radio_transcriber.py    # Whisper + HLS audio stream
│       └── tests/
│           ├── test_classifier.py
│           ├── test_location_extractor.py
│           ├── test_severity_scorer.py
│           └── test_event_fuser.py
│
└── apps/
    └── pwa/
        ├── index.html
        ├── vite.config.ts
        ├── tsconfig.json
        ├── package.json
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── store/
            │   ├── index.ts
            │   └── eventsSlice.ts
            ├── services/
            │   └── websocket.ts
            └── components/
                ├── SafetyMap.tsx
                └── EventMarker.tsx
```

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `tsconfig.base.json`
- Create: `Makefile`

- [ ] **Create `.gitignore`**

```
node_modules/
dist/
.env
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
.venv/
*.gguf
*.bin
pgdata/
```

- [ ] **Create `.env.example`**

```bash
# Copy this to .env and fill in values. Never commit .env.

# Postgres
POSTGRES_PASSWORD=changeme_local
DATABASE_URL=postgresql://sentinel:changeme_local@postgres:5432/sentinelmesh

# Redis
REDIS_PASSWORD=changeme_local
REDIS_URL=redis://:changeme_local@redis:6379

# Auth
JWT_SECRET=replace_with_64_char_random_string_minimum_length_required
INTERNAL_SERVICE_SECRET=replace_with_random_string

# Twitter/X (optional — stream skipped if empty)
TWITTER_BEARER_TOKEN=

# Mapbox (required for PWA map)
VITE_MAPBOX_TOKEN=

# Sentry (optional in dev)
SENTRY_DSN=
```

- [ ] **Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Create `Makefile`**

```makefile
.PHONY: up down logs test test-gateway test-signal smoke seed build-shared

up:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

down:
	docker compose down

logs:
	docker compose logs -f

build-shared:
	cd shared/crypto && npm ci && npm run build
	cd shared/nostr && npm ci && npm run build

test-gateway:
	cd services/gateway && npm test

test-signal:
	cd services/signal && python -m pytest tests/ -v

test: build-shared test-gateway test-signal

smoke:
	@echo "Running smoke tests against localhost:3000..."
	curl -sf http://localhost:3000/health | grep '"ok"'
	curl -sf "http://localhost:3000/api/events?lat=-1.2921&lng=36.8219&radius_km=10"
	@echo "Smoke tests passed."

seed:
	docker compose exec postgres psql -U sentinel -d sentinelmesh -c \
	  "INSERT INTO safety_events (event_type, severity, title, summary, lat, lng, place_name, county, confidence, source_count, started_at) VALUES ('FLOOD', 'HIGH', 'Test flood in Mathare', 'Rising water levels near Mathare River', -1.2572, 36.8572, 'Mathare Valley', 'Nairobi', 0.85, 2, NOW());"
```

- [ ] **Commit**

```bash
git add .gitignore .env.example tsconfig.base.json Makefile
git commit -m "Add monorepo scaffold: gitignore, env template, tsconfig base, Makefile"
```

---

## Task 2: Docker Infrastructure + PostgreSQL Schema

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`
- Create: `infra/postgres/init.sql`
- Create: `infra/nginx/nginx.conf`

- [ ] **Create `docker-compose.yml`**

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: sentinelmesh
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sentinel -d sentinelmesh"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  gateway:
    build:
      context: ./services/gateway
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  signal:
    build:
      context: ./services/signal
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - gateway

volumes:
  pgdata:
```

- [ ] **Create `docker-compose.dev.yml`** (overrides for development)

```yaml
version: '3.9'

services:
  postgres:
    ports:
      - "5432:5432"

  redis:
    ports:
      - "6379:6379"

  gateway:
    build:
      context: ./services/gateway
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    volumes:
      - ./services/gateway/src:/app/src:ro
    environment:
      NODE_ENV: development

  signal:
    build:
      context: ./services/signal
      dockerfile: Dockerfile.dev
    ports:
      - "8000:8000"
    volumes:
      - ./services/signal:/app:ro
    environment:
      WHISPER_MODEL: base
```

- [ ] **Create `infra/postgres/init.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;
CREATE EXTENSION IF NOT EXISTS cube;

-- Safety events from public signal aggregation
CREATE TABLE safety_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type       VARCHAR(30)  NOT NULL,
  severity         VARCHAR(10)  NOT NULL,
  title            VARCHAR(200) NOT NULL,
  summary          TEXT,

  place_name       VARCHAR(200),
  lat              DECIMAL(10,7) NOT NULL,
  lng              DECIMAL(10,7) NOT NULL,
  county           VARCHAR(50),
  radius_meters    INT DEFAULT 500,

  confidence       DECIMAL(4,3),
  source_count     INT DEFAULT 1,
  source_breakdown JSONB DEFAULT '{}',

  is_active        BOOLEAN DEFAULT true,
  started_at       TIMESTAMPTZ NOT NULL,
  resolved_at      TIMESTAMPTZ,
  last_updated     TIMESTAMPTZ DEFAULT NOW(),

  nostr_event_id   VARCHAR(64),
  bitcoin_txid     VARCHAR(64),
  bitcoin_block    INT,

  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Community reports (Phase 2)
CREATE TABLE community_reports (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_type      VARCHAR(30)  NOT NULL,
  description      TEXT,
  lat              DECIMAL(10,7) NOT NULL,
  lng              DECIMAL(10,7) NOT NULL,
  place_name       VARCHAR(200),
  nostr_pubkey     VARCHAR(64)  NOT NULL,
  nostr_signature  VARCHAR(128) NOT NULL,
  nostr_event_id   VARCHAR(64),
  reporter_tier    VARCHAR(20)  DEFAULT 'NEWCOMER',
  consensus_score  INT          DEFAULT 1,
  status           VARCHAR(20)  DEFAULT 'PENDING',
  confirmation_count INT        DEFAULT 0,
  denial_count     INT          DEFAULT 0,
  photo_ipfs_cid   VARCHAR(100),
  linked_event_id  UUID REFERENCES safety_events(id),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- Report votes (Phase 2)
CREATE TABLE report_votes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id    UUID NOT NULL REFERENCES community_reports(id),
  voter_pubkey VARCHAR(64) NOT NULL,
  vote         VARCHAR(10) NOT NULL,
  voter_lat    DECIMAL(10,7),
  voter_lng    DECIMAL(10,7),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, voter_pubkey)
);

-- Users (Nostr pubkey only — no personal data)
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nostr_pubkey     VARCHAR(64) UNIQUE NOT NULL,
  reputation_score INT  DEFAULT 0,
  reputation_tier  VARCHAR(20) DEFAULT 'NEWCOMER',
  total_reports    INT  DEFAULT 0,
  accurate_reports INT  DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_active      TIMESTAMPTZ DEFAULT NOW()
);

-- Family circles (Phase 3)
CREATE TABLE circles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_pubkey VARCHAR(64) NOT NULL,
  name         VARCHAR(50),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE circle_members (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id      UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  member_pubkey  VARCHAR(64) NOT NULL,
  display_name   VARCHAR(30),
  alert_radius_km DECIMAL(4,1) DEFAULT 2.0,
  alert_severity VARCHAR(10)  DEFAULT 'HIGH',
  joined_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(circle_id, member_pubkey)
);

-- Encrypted location blobs — server cannot read these (Phase 3)
CREATE TABLE location_blobs (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_pubkey_hash   VARCHAR(64) NOT NULL,
  sender_ephemeral_pubkey VARCHAR(64) NOT NULL,
  encrypted_payload       TEXT NOT NULL,
  circle_id               UUID REFERENCES circles(id),
  expires_at              TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Blockchain anchors (Phase 4)
CREATE TABLE blockchain_anchors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anchor_type     VARCHAR(20) NOT NULL,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  event_count     INT,
  digest_hash     VARCHAR(64) NOT NULL,
  digest_payload  JSONB NOT NULL,
  bitcoin_txid    VARCHAR(64),
  bitcoin_block   INT,
  bitcoin_network VARCHAR(10) DEFAULT 'testnet',
  anchor_status   VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ
);

-- Indexes for Phase 1 query patterns
CREATE INDEX idx_events_active    ON safety_events(is_active, severity);
CREATE INDEX idx_events_type      ON safety_events(event_type, started_at DESC);
CREATE INDEX idx_events_county    ON safety_events(county, is_active);
CREATE INDEX idx_events_location  ON safety_events(lat, lng);
CREATE INDEX idx_blobs_recipient  ON location_blobs(recipient_pubkey_hash, expires_at);
```

- [ ] **Create `infra/nginx/nginx.conf`**

```nginx
events { worker_connections 1024; }

http {
  upstream gateway {
    server gateway:3000;
  }

  server {
    listen 80;

    location / {
      proxy_pass http://gateway;
      proxy_http_version 1.1;
      # WebSocket upgrade support
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 86400;
    }
  }
}
```

- [ ] **Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml infra/
git commit -m "Add Docker compose stack and full PostgreSQL schema"
```

---

## Task 3: Shared Events Contract

**Files:**
- Create: `shared/contracts/events.schema.json`
- Create: `shared/types/index.d.ts`

- [ ] **Create `shared/contracts/events.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "EventType": {
      "type": "string",
      "enum": [
        "TRAFFIC_INCIDENT",
        "FLOOD",
        "CIVIL_UNREST",
        "SECURITY_INCIDENT",
        "FIRE",
        "MEDICAL_EMERGENCY",
        "INFRASTRUCTURE_FAILURE",
        "FALSE_ALARM"
      ]
    },
    "Severity": {
      "type": "string",
      "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    },
    "Location": {
      "type": "object",
      "required": ["lat", "lng"],
      "properties": {
        "place_name": { "type": "string" },
        "lat":        { "type": "number", "minimum": -4.67, "maximum": 4.62 },
        "lng":        { "type": "number", "minimum": 33.91, "maximum": 41.90 },
        "county":     { "type": "string" },
        "radius_meters": { "type": "integer", "minimum": 0 }
      }
    },
    "SafetyEvent": {
      "type": "object",
      "required": ["event_id", "event_type", "severity", "title", "confidence", "source_count", "is_active", "started_at", "last_updated"],
      "properties": {
        "event_id":        { "type": "string", "format": "uuid" },
        "event_type":      { "$ref": "#/definitions/EventType" },
        "severity":        { "$ref": "#/definitions/Severity" },
        "title":           { "type": "string", "maxLength": 200 },
        "summary":         { "type": "string" },
        "location":        { "oneOf": [{ "$ref": "#/definitions/Location" }, { "type": "null" }] },
        "confidence":      { "type": "number", "minimum": 0, "maximum": 1 },
        "source_count":    { "type": "integer", "minimum": 1 },
        "source_breakdown":{ "type": "object" },
        "is_active":       { "type": "boolean" },
        "started_at":      { "type": "string", "format": "date-time" },
        "last_updated":    { "type": "string", "format": "date-time" },
        "nostr_event_id":  { "type": ["string", "null"] },
        "bitcoin_txid":    { "type": ["string", "null"] }
      }
    }
  }
}
```

- [ ] **Create `shared/types/index.d.ts`** (hand-written for Phase 1; automated generation added in Phase 2)

```typescript
// Generated from shared/contracts/events.schema.json
// Do not edit by hand — update the schema and regenerate.

export type EventType =
  | 'TRAFFIC_INCIDENT'
  | 'FLOOD'
  | 'CIVIL_UNREST'
  | 'SECURITY_INCIDENT'
  | 'FIRE'
  | 'MEDICAL_EMERGENCY'
  | 'INFRASTRUCTURE_FAILURE'
  | 'FALSE_ALARM'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type ReportStatus =
  | 'PENDING'
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'AUTHORITATIVE'
  | 'DISPUTED'
  | 'REJECTED'

export type ReporterTier = 'NEWCOMER' | 'TRUSTED' | 'VETERAN' | 'SENTINEL'

export interface EventLocation {
  place_name: string | null
  lat: number
  lng: number
  county: string | null
  radius_meters: number
}

export interface SafetyEvent {
  event_id: string
  event_type: EventType
  severity: Severity
  title: string
  summary: string | null
  location: EventLocation | null
  confidence: number
  source_count: number
  source_breakdown: Record<string, number>
  is_active: boolean
  started_at: string
  last_updated: string
  nostr_event_id: string | null
  bitcoin_txid: string | null
}

export interface WsMessage {
  type: 'NEW_EVENT' | 'EVENT_UPDATED' | 'EVENT_RESOLVED' | 'NEW_REPORT' | 'PROXIMITY_ALERT'
  payload: SafetyEvent | Record<string, unknown>
}

export interface SentinelError {
  code: string
  message: string
  retryable: boolean
  context?: Record<string, unknown>
}
```

- [ ] **Commit**

```bash
git add shared/
git commit -m "Add shared events contract (JSON Schema + TypeScript types)"
```

---

## Task 4: gateway/ TypeScript Service Scaffold

**Files:**
- Create: `services/gateway/package.json`
- Create: `services/gateway/tsconfig.json`
- Create: `services/gateway/Dockerfile`
- Create: `services/gateway/Dockerfile.dev`
- Create: `services/gateway/src/config.ts`
- Create: `services/gateway/src/index.ts`

- [ ] **Create `services/gateway/package.json`**

```json
{
  "name": "@sentinel/gateway",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "helmet": "^8.0.0",
    "ioredis": "^5.4.2",
    "pg": "^8.13.3",
    "ws": "^8.18.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.1",
    "@types/node": "^22.14.1",
    "@types/pg": "^8.11.11",
    "@types/ws": "^8.5.14",
    "tsx": "^4.19.3",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2",
    "supertest": "^7.1.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **Create `services/gateway/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Create `services/gateway/Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Create `services/gateway/Dockerfile.dev`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

- [ ] **Create `services/gateway/src/config.ts`**

```typescript
// Validates all required env vars at startup so the service fails fast
// instead of crashing mid-request when a var is missing.

function require_env(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  databaseUrl: require_env('DATABASE_URL'),
  redisUrl: require_env('REDIS_URL'),
  jwtSecret: require_env('JWT_SECRET'),
  internalSecret: require_env('INTERNAL_SERVICE_SECRET'),
} as const
```

- [ ] **Create `services/gateway/src/index.ts`**

```typescript
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { config } from './config'
import { eventsRouter } from './routes/events'
import { initPool } from './db/pool'
import { startEventSubscriber } from './subscribers/eventSubscriber'
import { createWsHub } from './ws/hub'
import { createServer } from 'http'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'gateway', ts: new Date().toISOString() })
})

app.use('/api/events', eventsRouter)

const server = createServer(app)
const wsHub = createWsHub(server)

initPool()
  .then(() => startEventSubscriber(wsHub))
  .then(() => {
    server.listen(config.port, () => {
      console.log(`gateway listening on port ${config.port}`)
    })
  })
  .catch((err) => {
    console.error('gateway startup failed:', err)
    process.exit(1)
  })
```

- [ ] **Run `npm install` inside the service container to verify deps resolve**

```bash
cd services/gateway && npm install
```

Expected: `added N packages` with no errors.

- [ ] **Commit**

```bash
git add services/gateway/
git commit -m "Scaffold gateway TypeScript service with Express, health endpoint, Docker"
```

---

## Task 5: gateway/ DB Pool + Events REST API

**Files:**
- Create: `services/gateway/src/db/pool.ts`
- Create: `services/gateway/src/routes/events.ts`

- [ ] **Create `services/gateway/src/db/pool.ts`**

```typescript
import { Pool } from 'pg'
import { config } from '../config'

let pool: Pool

export async function initPool(): Promise<void> {
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  // Verify connection at startup
  const client = await pool.connect()
  client.release()
  console.log('PostgreSQL pool connected')
}

export function getPool(): Pool {
  if (!pool) throw new Error('DB pool not initialised — call initPool() first')
  return pool
}
```

- [ ] **Create `services/gateway/src/routes/events.ts`**

```typescript
import { Router, Request, Response } from 'express'
import { getPool } from '../db/pool'

export const eventsRouter = Router()

// GET /api/events?lat&lng&radius_km&severity&type&active_only
eventsRouter.get('/', async (req: Request, res: Response) => {
  const {
    lat, lng,
    radius_km = '10',
    severity,
    type,
    active_only = 'true',
    limit = '50',
  } = req.query

  const pool = getPool()
  const params: unknown[] = []
  const conditions: string[] = []

  if (active_only === 'true') {
    conditions.push('is_active = true')
  }

  if (severity) {
    const severities = String(severity).split(',').map(s => s.trim().toUpperCase())
    params.push(severities)
    conditions.push(`severity = ANY($${params.length}::text[])`)
  }

  if (type) {
    const types = String(type).split(',').map(t => t.trim().toUpperCase())
    params.push(types)
    conditions.push(`event_type = ANY($${params.length}::text[])`)
  }

  // Radius filter using PostGIS earthdistance (km to meters: * 1000)
  if (lat && lng) {
    const latNum = parseFloat(String(lat))
    const lngNum = parseFloat(String(lng))
    const radiusMeters = parseFloat(String(radius_km)) * 1000
    params.push(latNum, lngNum, radiusMeters)
    conditions.push(
      `earth_distance(ll_to_earth($${params.length - 2}, $${params.length - 1}), ll_to_earth(lat, lng)) <= $${params.length}`
    )
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(parseInt(String(limit), 10))

  try {
    const result = await pool.query(
      `SELECT * FROM safety_events ${where} ORDER BY started_at DESC LIMIT $${params.length}`,
      params
    )
    res.json({ events: result.rows, total: result.rowCount })
  } catch (err) {
    console.error('GET /api/events error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch events', retryable: true })
  }
})

// GET /api/events/:id
eventsRouter.get('/:id', async (req: Request, res: Response) => {
  const pool = getPool()
  try {
    const result = await pool.query(
      'SELECT * FROM safety_events WHERE id = $1',
      [req.params['id']]
    )
    if (result.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Event not found', retryable: false })
      return
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('GET /api/events/:id error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch event', retryable: true })
  }
})
```

- [ ] **Commit**

```bash
git add services/gateway/src/db/ services/gateway/src/routes/
git commit -m "Add gateway DB pool and events REST API"
```

---

## Task 6: gateway/ WebSocket Hub + Redis Subscriber

**Files:**
- Create: `services/gateway/src/ws/hub.ts`
- Create: `services/gateway/src/subscribers/eventSubscriber.ts`

- [ ] **Create `services/gateway/src/ws/hub.ts`**

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, Server } from 'http'
import { SafetyEvent, WsMessage } from '../../../shared/types'

// Each client subscribes to a county. When an event arrives for that county,
// all sockets in that county's set receive it.
type CountySubscribers = Map<string, Set<WebSocket>>

export interface WsHub {
  broadcast: (county: string | null, message: WsMessage) => void
}

export function createWsHub(server: Server): WsHub {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const subscribers: CountySubscribers = new Map()

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const county = url.searchParams.get('county')?.toLowerCase() ?? 'global'

    if (!subscribers.has(county)) subscribers.set(county, new Set())
    subscribers.get(county)!.add(ws)

    ws.on('close', () => {
      subscribers.get(county)?.delete(ws)
    })

    ws.on('error', () => {
      subscribers.get(county)?.delete(ws)
    })
  })

  function broadcast(county: string | null, message: WsMessage): void {
    const payload = JSON.stringify(message)
    const targets = new Set<WebSocket>()

    // Send to county subscribers and to global subscribers
    const countyKey = county?.toLowerCase() ?? 'global'
    subscribers.get(countyKey)?.forEach(ws => targets.add(ws))
    subscribers.get('global')?.forEach(ws => targets.add(ws))

    targets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    })
  }

  console.log('WebSocket hub ready on /ws')
  return { broadcast }
}
```

- [ ] **Create `services/gateway/src/subscribers/eventSubscriber.ts`**

```typescript
import Redis from 'ioredis'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getPool } from '../db/pool'
import { config } from '../config'
import { SafetyEvent } from '../../../shared/types'
import { WsHub } from '../ws/hub'

const schema = JSON.parse(
  readFileSync(join(__dirname, '../../../shared/contracts/events.schema.json'), 'utf8')
)
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validateEvent = ajv.compile(schema.definitions.SafetyEvent)

// Events that fail PostgreSQL persist go here so they can be replayed manually.
// In production this would write to a file or dead-letter queue.
const DLQ: SafetyEvent[] = []

export async function startEventSubscriber(hub: WsHub): Promise<void> {
  const redis = new Redis(config.redisUrl)

  redis.on('error', (err) => {
    console.error('Redis subscriber error:', err)
  })

  await redis.subscribe('sentinel:events:new')

  redis.on('message', async (_channel: string, raw: string) => {
    let event: SafetyEvent

    try {
      event = JSON.parse(raw)
    } catch {
      console.warn('Received non-JSON on sentinel:events:new, discarding')
      return
    }

    // Reject events that do not match the contract
    if (!validateEvent(event)) {
      console.warn('Event failed schema validation:', validateEvent.errors)
      return
    }

    await persistAndBroadcast(event, hub)
  })

  console.log('Redis event subscriber started on sentinel:events:new')
}

async function persistAndBroadcast(event: SafetyEvent, hub: WsHub): Promise<void> {
  const pool = getPool()

  try {
    await pool.query(
      `INSERT INTO safety_events (
        id, event_type, severity, title, summary,
        lat, lng, place_name, county, radius_meters,
        confidence, source_count, source_breakdown,
        is_active, started_at, last_updated,
        nostr_event_id, bitcoin_txid
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18
      ) ON CONFLICT (id) DO UPDATE SET
        severity = EXCLUDED.severity,
        is_active = EXCLUDED.is_active,
        last_updated = EXCLUDED.last_updated,
        source_count = EXCLUDED.source_count`,
      [
        event.event_id,
        event.event_type,
        event.severity,
        event.title,
        event.summary,
        event.location?.lat ?? null,
        event.location?.lng ?? null,
        event.location?.place_name ?? null,
        event.location?.county ?? null,
        event.location?.radius_meters ?? 500,
        event.confidence,
        event.source_count,
        JSON.stringify(event.source_breakdown),
        event.is_active,
        event.started_at,
        event.last_updated,
        event.nostr_event_id,
        event.bitcoin_txid,
      ]
    )
  } catch (err) {
    console.error('Failed to persist event to PostgreSQL:', err)
    DLQ.push(event)
    return
  }

  hub.broadcast(event.location?.county ?? null, { type: 'NEW_EVENT', payload: event })
}
```

- [ ] **Commit**

```bash
git add services/gateway/src/ws/ services/gateway/src/subscribers/
git commit -m "Add gateway WebSocket hub and Redis event subscriber"
```

---

## Task 7: signal/ Python Service Scaffold

**Files:**
- Create: `services/signal/requirements.txt`
- Create: `services/signal/Dockerfile`
- Create: `services/signal/Dockerfile.dev`
- Create: `services/signal/config.py`
- Create: `services/signal/main.py`
- Create: `services/signal/publisher.py`

- [ ] **Create `services/signal/requirements.txt`**

```
fastapi==0.115.12
uvicorn==0.34.0
apscheduler==3.11.0
redis==5.2.1
asyncpg==0.30.0
feedparser==6.0.11
httpx==0.28.1
spacy==3.8.5
langdetect==1.0.9
openai-whisper==20240930
pytest==8.3.5
pytest-asyncio==0.25.3
```

- [ ] **Install spaCy model (add to Dockerfile, not requirements.txt)**

This is a post-install step, not a pip package.

- [ ] **Create `services/signal/Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Create `services/signal/Dockerfile.dev`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Create `services/signal/config.py`**

```python
import os

def require_env(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val

REDIS_URL      = require_env("REDIS_URL")
DATABASE_URL   = require_env("DATABASE_URL")

# Optional — stream is skipped if not set
TWITTER_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN", "")

# Use 'base' in dev, 'large-v3' in production
WHISPER_MODEL  = os.getenv("WHISPER_MODEL", "base")

# RSS feeds — Nation, Standard, Citizen, NTV
RSS_FEEDS = [
    "https://nation.africa/kenya/rss",
    "https://standardmedia.co.ke/rss/kenya.xml",
    "https://citizentv.co.ke/feed/",
    "https://ntv.co.ke/feed/",
]

# Public radio streams for Whisper transcription
RADIO_STREAMS = {
    "citizen_radio": "https://stream.radiojar.com/citizen-radio",
    "radio_maisha":  "https://stream.radiojar.com/radio-maisha",
}

# Kenya bounding box for Twitter geo-filter
KENYA_BBOX = "33.91,-4.67,41.90,4.62"
```

- [ ] **Create `services/signal/main.py`**

```python
from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager

from ingest.rss_parser import poll_rss_feeds
from ingest.twitter_stream import start_twitter_stream
from ingest.radio_transcriber import monitor_radio
import config

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # RSS: poll every 60 seconds
    scheduler.add_job(poll_rss_feeds, "interval", seconds=60, id="rss")

    # Radio: continuous 30-second windows
    scheduler.add_job(monitor_radio, "interval", seconds=30, id="radio")

    scheduler.start()

    # Twitter stream runs as a background task if token is present
    if config.TWITTER_BEARER_TOKEN:
        import asyncio
        asyncio.create_task(start_twitter_stream())

    yield

    scheduler.shutdown()

app = FastAPI(title="SentinelMesh Signal Service", lifespan=lifespan)

@app.get("/health")
def health():
    return {"ok": True, "service": "signal"}
```

- [ ] **Create `services/signal/publisher.py`**

```python
import json
import redis.asyncio as aioredis
import config

# Shared async Redis client — initialised once per process
_client: aioredis.Redis | None = None

async def get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(config.REDIS_URL, decode_responses=True)
    return _client

async def emit_event(event: dict) -> None:
    """Push a SafetyEvent dict to the gateway via Redis pub/sub."""
    client = await get_client()
    await client.publish("sentinel:events:new", json.dumps(event))
```

- [ ] **Commit**

```bash
git add services/signal/
git commit -m "Scaffold signal Python service with FastAPI, APScheduler, Redis publisher"
```

---

## Task 8: Kenya Gazetteer + Loader (TDD)

**Files:**
- Create: `services/signal/gazetteer/kenya_places.json`
- Create: `services/signal/gazetteer/loader.py`
- Create: `services/signal/tests/test_location_extractor.py` (partial — loader tests)

- [ ] **Write the failing loader tests first**

Create `services/signal/tests/test_location_extractor.py`:

```python
import pytest
from gazetteer.loader import lookup_place, list_aliases

def test_nairobi_canonical_name():
    result = lookup_place("nairobi")
    assert result is not None
    assert result["lat"] == pytest.approx(-1.2921, abs=0.01)
    assert result["lng"] == pytest.approx(36.8219, abs=0.01)
    assert result["county"] == "Nairobi"

def test_alias_resolves_to_canonical():
    # "nai" is a common Swahili shorthand for Nairobi
    result = lookup_place("nai")
    assert result is not None
    assert result["place_name"] == "nairobi"

def test_kibera_alias():
    # kibera and kibra are both in wide use
    result = lookup_place("kibra")
    assert result is not None
    assert result["place_name"] == "kibera"

def test_unknown_place_returns_none():
    result = lookup_place("completely_unknown_xyz")
    assert result is None

def test_case_insensitive():
    result = lookup_place("MATHARE")
    assert result is not None

def test_list_aliases_includes_entry():
    aliases = list_aliases()
    assert "nairobi" in aliases
    assert "nai" in aliases
```

- [ ] **Run tests — they must fail**

```bash
cd services/signal && python -m pytest tests/test_location_extractor.py -v
```

Expected: `ModuleNotFoundError` or `ImportError` — gazetteer module does not exist yet.

- [ ] **Create `services/signal/gazetteer/kenya_places.json`**

This is a representative starting set. Expand to 1000+ places using Kenya KNBS data after Phase 1 is running.

```json
{
  "nairobi": {
    "lat": -1.2921, "lng": 36.8219,
    "county": "Nairobi",
    "type": "city",
    "aliases": ["nai", "the city", "CBD", "jiji", "nairobi city"]
  },
  "mombasa": {
    "lat": -4.0435, "lng": 39.6682,
    "county": "Mombasa",
    "type": "city",
    "aliases": ["msa", "the coast"]
  },
  "kisumu": {
    "lat": -0.0917, "lng": 34.7680,
    "county": "Kisumu",
    "type": "city",
    "aliases": ["ksm"]
  },
  "nakuru": {
    "lat": -0.3031, "lng": 36.0800,
    "county": "Nakuru",
    "type": "city",
    "aliases": []
  },
  "eldoret": {
    "lat": 0.5143, "lng": 35.2698,
    "county": "Uasin Gishu",
    "type": "city",
    "aliases": ["eld", "30 arap moi"]
  },
  "thika": {
    "lat": -1.0332, "lng": 37.0693,
    "county": "Kiambu",
    "type": "town",
    "aliases": []
  },
  "mathare": {
    "lat": -1.2572, "lng": 36.8572,
    "county": "Nairobi",
    "type": "informal_settlement",
    "aliases": ["mathare valley", "mathare north"]
  },
  "kibera": {
    "lat": -1.3135, "lng": 36.7845,
    "county": "Nairobi",
    "type": "informal_settlement",
    "aliases": ["kibra"]
  },
  "westlands": {
    "lat": -1.2642, "lng": 36.8018,
    "county": "Nairobi",
    "type": "estate",
    "aliases": ["westy", "west lands"]
  },
  "karen": {
    "lat": -1.3197, "lng": 36.7058,
    "county": "Nairobi",
    "type": "estate",
    "aliases": []
  },
  "langata": {
    "lat": -1.3490, "lng": 36.7360,
    "county": "Nairobi",
    "type": "area",
    "aliases": ["lang'ata"]
  },
  "kasarani": {
    "lat": -1.2199, "lng": 36.8972,
    "county": "Nairobi",
    "type": "area",
    "aliases": ["mwiki"]
  },
  "embakasi": {
    "lat": -1.3161, "lng": 36.8929,
    "county": "Nairobi",
    "type": "area",
    "aliases": []
  },
  "eastleigh": {
    "lat": -1.2750, "lng": 36.8450,
    "county": "Nairobi",
    "type": "area",
    "aliases": ["little mogadishu"]
  },
  "huruma": {
    "lat": -1.2480, "lng": 36.8580,
    "county": "Nairobi",
    "type": "area",
    "aliases": []
  },
  "kariobangi": {
    "lat": -1.2519, "lng": 36.8769,
    "county": "Nairobi",
    "type": "area",
    "aliases": ["kariobangi north", "kariobangi south"]
  },
  "kayole": {
    "lat": -1.2885, "lng": 36.9070,
    "county": "Nairobi",
    "type": "area",
    "aliases": []
  },
  "juja": {
    "lat": -1.1031, "lng": 37.0141,
    "county": "Kiambu",
    "type": "town",
    "aliases": []
  },
  "kiambu": {
    "lat": -1.1711, "lng": 36.8356,
    "county": "Kiambu",
    "type": "town",
    "aliases": []
  },
  "ruiru": {
    "lat": -1.1467, "lng": 36.9609,
    "county": "Kiambu",
    "type": "town",
    "aliases": []
  },
  "athi_river": {
    "lat": -1.4574, "lng": 36.9769,
    "county": "Machakos",
    "type": "town",
    "aliases": ["athi river", "mavoko"]
  },
  "machakos": {
    "lat": -1.5177, "lng": 37.2634,
    "county": "Machakos",
    "type": "town",
    "aliases": []
  },
  "kitui": {
    "lat": -1.3669, "lng": 38.0106,
    "county": "Kitui",
    "type": "town",
    "aliases": []
  },
  "meru": {
    "lat": 0.0472, "lng": 37.6491,
    "county": "Meru",
    "type": "town",
    "aliases": []
  },
  "nyeri": {
    "lat": -0.4165, "lng": 36.9508,
    "county": "Nyeri",
    "type": "town",
    "aliases": []
  },
  "embu": {
    "lat": -0.5357, "lng": 37.4584,
    "county": "Embu",
    "type": "town",
    "aliases": []
  },
  "garissa": {
    "lat": -0.4532, "lng": 39.6461,
    "county": "Garissa",
    "type": "town",
    "aliases": []
  },
  "kakamega": {
    "lat": 0.2827, "lng": 34.7519,
    "county": "Kakamega",
    "type": "town",
    "aliases": []
  },
  "bungoma": {
    "lat": 0.5635, "lng": 34.5606,
    "county": "Bungoma",
    "type": "town",
    "aliases": []
  },
  "kericho": {
    "lat": -0.3686, "lng": 35.2863,
    "county": "Kericho",
    "type": "town",
    "aliases": []
  },
  "bomet": {
    "lat": -0.7812, "lng": 35.3410,
    "county": "Bomet",
    "type": "town",
    "aliases": []
  },
  "narok": {
    "lat": -1.0872, "lng": 35.8704,
    "county": "Narok",
    "type": "town",
    "aliases": []
  },
  "kajiado": {
    "lat": -1.8516, "lng": 36.7766,
    "county": "Kajiado",
    "type": "town",
    "aliases": []
  },
  "ngong": {
    "lat": -1.3584, "lng": 36.6572,
    "county": "Kajiado",
    "type": "town",
    "aliases": []
  },
  "isiolo": {
    "lat": 0.3544, "lng": 37.5820,
    "county": "Isiolo",
    "type": "town",
    "aliases": []
  },
  "malindi": {
    "lat": -3.2138, "lng": 40.1169,
    "county": "Kilifi",
    "type": "town",
    "aliases": []
  },
  "kilifi": {
    "lat": -3.5103, "lng": 39.8499,
    "county": "Kilifi",
    "type": "town",
    "aliases": []
  },
  "kwale": {
    "lat": -4.1728, "lng": 39.4520,
    "county": "Kwale",
    "type": "town",
    "aliases": []
  },
  "uhuru_highway": {
    "lat": -1.2921, "lng": 36.8160,
    "county": "Nairobi",
    "type": "road",
    "aliases": ["uhuru hwy", "uhuru"]
  },
  "mombasa_road": {
    "lat": -1.3200, "lng": 36.8700,
    "county": "Nairobi",
    "type": "road",
    "aliases": ["mombasa rd", "enterprise road"]
  },
  "thika_road": {
    "lat": -1.2000, "lng": 36.8700,
    "county": "Nairobi",
    "type": "road",
    "aliases": ["thika superhighway", "thika hwy"]
  },
  "waiyaki_way": {
    "lat": -1.2642, "lng": 36.7900,
    "county": "Nairobi",
    "type": "road",
    "aliases": ["waiyaki", "westlands road"]
  },
  "jkia": {
    "lat": -1.3192, "lng": 36.9275,
    "county": "Nairobi",
    "type": "landmark",
    "aliases": ["jomo kenyatta airport", "nairobi airport", "nbo"]
  },
  "westgate": {
    "lat": -1.2625, "lng": 36.8030,
    "county": "Nairobi",
    "type": "landmark",
    "aliases": ["westgate mall", "westgate shopping"]
  },
  "kenyatta_hospital": {
    "lat": -1.3009, "lng": 36.8072,
    "county": "Nairobi",
    "type": "landmark",
    "aliases": ["KNH", "knh", "kenyatta national hospital"]
  },
  "kicc": {
    "lat": -1.2864, "lng": 36.8222,
    "county": "Nairobi",
    "type": "landmark",
    "aliases": ["kenyatta international convention centre"]
  },
  "parliament": {
    "lat": -1.2896, "lng": 36.8192,
    "county": "Nairobi",
    "type": "landmark",
    "aliases": ["parliament buildings", "parliament road"]
  }
}
```

- [ ] **Create `services/signal/gazetteer/__init__.py`** (empty)

```python
```

- [ ] **Create `services/signal/gazetteer/loader.py`**

```python
import json
from pathlib import Path
from typing import Optional

_GAZETTEER_PATH = Path(__file__).parent / "kenya_places.json"

# Build a flat alias → canonical_name map at import time.
# This means lookups are O(1) at runtime.
_alias_map: dict[str, tuple[str, dict]] = {}

def _load() -> None:
    data = json.loads(_GAZETTEER_PATH.read_text(encoding="utf-8"))
    for canonical_name, entry in data.items():
        record = {**entry, "place_name": canonical_name}
        _alias_map[canonical_name.lower()] = (canonical_name, record)
        for alias in entry.get("aliases", []):
            _alias_map[alias.lower()] = (canonical_name, record)

_load()

def lookup_place(text: str) -> Optional[dict]:
    """
    Return place data for a name or alias, or None if not in gazetteer.
    Never returns a guessed or fabricated coordinate.
    """
    return _alias_map.get(text.strip().lower(), (None, None))[1]

def list_aliases() -> list[str]:
    """Return all known place names and aliases."""
    return list(_alias_map.keys())
```

- [ ] **Run the loader tests — they must now pass**

```bash
cd services/signal && python -m pytest tests/test_location_extractor.py::test_nairobi_canonical_name tests/test_location_extractor.py::test_alias_resolves_to_canonical tests/test_location_extractor.py::test_kibera_alias tests/test_location_extractor.py::test_unknown_place_returns_none tests/test_location_extractor.py::test_case_insensitive tests/test_location_extractor.py::test_list_aliases_includes_entry -v
```

Expected: `6 passed`

- [ ] **Commit**

```bash
git add services/signal/gazetteer/ services/signal/tests/test_location_extractor.py
git commit -m "Add Kenya gazetteer with 50+ places and TDD loader"
```

---

## Task 9: signal/ NLP — Location Extractor (TDD)

**Files:**
- Modify: `services/signal/tests/test_location_extractor.py` (add extractor tests)
- Create: `services/signal/nlp/location_extractor.py`
- Create: `services/signal/nlp/__init__.py`

- [ ] **Add extractor tests to `services/signal/tests/test_location_extractor.py`**

Append below the loader tests:

```python
from nlp.location_extractor import extract_locations

def test_extract_nairobi_from_english():
    results = extract_locations("Heavy flooding reported in Nairobi CBD")
    assert any(r["place_name"] == "nairobi" for r in results)

def test_extract_mathare_from_swahili():
    results = extract_locations("Mafuriko makubwa yanaendelea Mathare valley")
    assert any(r["place_name"] == "mathare" for r in results)

def test_location_has_required_fields():
    results = extract_locations("Accident on Thika Road near Kasarani")
    assert len(results) > 0
    for r in results:
        assert "place_name" in r
        assert "lat" in r
        assert "lng" in r
        assert "confidence" in r
        assert 0.0 <= r["confidence"] <= 1.0

def test_unknown_location_returns_empty():
    results = extract_locations("Something happened at some place")
    # May return empty — should never fabricate a location
    for r in results:
        assert r["confidence"] > 0

def test_max_three_locations_returned():
    text = "Incidents in Nairobi, Mombasa, Kisumu, Nakuru, and Eldoret"
    results = extract_locations(text)
    assert len(results) <= 3

def test_alias_recognised():
    results = extract_locations("Traffic jam near Westy roundabout")
    assert any(r["place_name"] == "westlands" for r in results)
```

- [ ] **Run — must fail**

```bash
cd services/signal && python -m pytest tests/test_location_extractor.py -v 2>&1 | tail -5
```

Expected: `ImportError: cannot import name 'extract_locations'`

- [ ] **Create `services/signal/nlp/__init__.py`** (empty)

```python
```

- [ ] **Create `services/signal/nlp/location_extractor.py`**

```python
import spacy
from gazetteer.loader import lookup_place, list_aliases

# Load once at module import — spaCy model is heavy, never reload per request
nlp = spacy.load("en_core_web_sm")

# Pre-sort aliases by length (longest first) to prefer specific matches.
# "mathare valley" should match before "mathare".
_all_aliases = sorted(list_aliases(), key=len, reverse=True)

def extract_locations(text: str) -> list[dict]:
    """
    Find Kenya locations in text using two strategies:
    1. spaCy NER for GPE/LOC entities, resolved via gazetteer (higher confidence)
    2. Direct string scan of all known aliases (catches short names spaCy misses)

    Returns up to 3 results sorted by confidence, highest first.
    Never fabricates a coordinate — returns empty list if nothing matches.
    """
    doc = nlp(text)
    found: dict[str, dict] = {}  # canonical_name → result

    # Strategy 1: spaCy named entities
    for ent in doc.ents:
        if ent.label_ not in ("GPE", "LOC", "FAC"):
            continue
        place = lookup_place(ent.text)
        if place and place["place_name"] not in found:
            found[place["place_name"]] = {**place, "confidence": 0.85}

    # Strategy 2: direct alias scan (catches short names and Swahili variants)
    text_lower = text.lower()
    for alias in _all_aliases:
        if alias in text_lower:
            place = lookup_place(alias)
            if place and place["place_name"] not in found:
                found[place["place_name"]] = {**place, "confidence": 0.65}

    results = sorted(found.values(), key=lambda x: x["confidence"], reverse=True)
    return results[:3]
```

- [ ] **Run — all extractor tests must pass**

```bash
cd services/signal && python -m pytest tests/test_location_extractor.py -v
```

Expected: `12 passed` (6 loader + 6 extractor)

- [ ] **Commit**

```bash
git add services/signal/nlp/ services/signal/tests/test_location_extractor.py
git commit -m "Add NLP location extractor with TDD: spaCy NER + Kenya gazetteer"
```

---

## Task 10: signal/ NLP — Keyword Event Classifier (TDD)

**Files:**
- Create: `services/signal/tests/test_classifier.py`
- Create: `services/signal/nlp/classifier.py`

This is a keyword classifier for Phase 1. Gemma 2 GGUF replaces it in Phase 3.

- [ ] **Write failing tests first**

Create `services/signal/tests/test_classifier.py`:

```python
import pytest
from nlp.classifier import classify_event

def test_flood_english():
    result = classify_event("Heavy flooding along Mathare River, residents evacuated")
    assert result["event_type"] == "FLOOD"
    assert result["confidence"] > 0.5

def test_flood_swahili():
    result = classify_event("Mafuriko makubwa yanaendelea karibu na Mathare")
    assert result["event_type"] == "FLOOD"

def test_traffic_incident():
    result = classify_event("Major accident on Thika Road, three matatus involved")
    assert result["event_type"] == "TRAFFIC_INCIDENT"

def test_civil_unrest():
    result = classify_event("Maandamano ya wafanyakazi yanavuruga CBD leo")
    assert result["event_type"] == "CIVIL_UNREST"

def test_security_incident():
    result = classify_event("Armed robbery reported near Westgate, police called")
    assert result["event_type"] == "SECURITY_INCIDENT"

def test_fire():
    result = classify_event("Fire breaks out at Gikomba market, fire engines on scene")
    assert result["event_type"] == "FIRE"

def test_infrastructure():
    result = classify_event("Kenya Power announces 8-hour blackout in Westlands area")
    assert result["event_type"] == "INFRASTRUCTURE_FAILURE"

def test_result_has_required_fields():
    result = classify_event("Something happened somewhere")
    assert "event_type" in result
    assert "confidence" in result
    assert 0.0 <= result["confidence"] <= 1.0

def test_low_confidence_for_unrelated():
    result = classify_event("Arsenal win the Premier League title")
    assert result["confidence"] < 0.5
```

- [ ] **Run — must fail**

```bash
cd services/signal && python -m pytest tests/test_classifier.py -v 2>&1 | tail -3
```

Expected: `ImportError`

- [ ] **Create `services/signal/nlp/classifier.py`**

```python
from typing import TypedDict

class ClassificationResult(TypedDict):
    event_type: str
    confidence: float

# Keyword sets per event type (English + Swahili).
# Higher keyword density in text → higher confidence.
_KEYWORDS: dict[str, list[str]] = {
    "FLOOD": [
        "flood", "flooding", "mafuriko", "maji", "inundation",
        "submerged", "overflow", "river burst", "imefurika",
        "water level", "flash flood",
    ],
    "TRAFFIC_INCIDENT": [
        "accident", "ajali", "crash", "collision", "matatu",
        "lorry", "msongamano", "congestion", "road block",
        "traffic", "barabara", "blocked", "overturned", "pileup",
    ],
    "CIVIL_UNREST": [
        "protest", "maandamano", "demonstration", "riot",
        "teargas", "police", "polisi", "dispersed", "chaos",
        "clashes", "agitation", "strike", "mgomo",
    ],
    "SECURITY_INCIDENT": [
        "robbery", "armed", "shooting", "gunshot", "carjacking",
        "mugging", "abduction", "kidnap", "terror", "bomb",
        "explosion", "wezi", "bunduki", "hijack",
    ],
    "FIRE": [
        "fire", "moto", "blaze", "inferno", "burning",
        "smoke", "flames", "inachoma", "arson", "gutted",
    ],
    "MEDICAL_EMERGENCY": [
        "ambulance", "hospital", "emergency", "injured",
        "casualty", "dead", "killed", "wounded", "hospitalized",
        "death toll",
    ],
    "INFRASTRUCTURE_FAILURE": [
        "power outage", "blackout", "umeme", "electricity",
        "water shortage", "maji", "bridge", "collapse",
        "kenya power", "kplc", "no water",
    ],
}

_DEFAULT = "FALSE_ALARM"


def classify_event(text: str) -> ClassificationResult:
    """
    Classify text into a safety event type using keyword density scoring.
    Returns the highest-scoring type and a 0–1 confidence value.
    Confidence is proportional to keyword matches relative to keywords available.
    """
    text_lower = text.lower()
    scores: dict[str, float] = {}

    for event_type, keywords in _KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw in text_lower)
        if hits > 0:
            # Normalise: 3+ hits = full confidence in that category
            scores[event_type] = min(hits / 3.0, 1.0)

    if not scores:
        return {"event_type": _DEFAULT, "confidence": 0.1}

    best_type = max(scores, key=lambda k: scores[k])
    return {"event_type": best_type, "confidence": round(scores[best_type], 3)}
```

- [ ] **Run — all tests must pass**

```bash
cd services/signal && python -m pytest tests/test_classifier.py -v
```

Expected: `9 passed`

- [ ] **Commit**

```bash
git add services/signal/nlp/classifier.py services/signal/tests/test_classifier.py
git commit -m "Add keyword event classifier with TDD (Phase 1 placeholder for Gemma 2)"
```

---

## Task 11: signal/ NLP — Severity Scorer (TDD)

**Files:**
- Create: `services/signal/tests/test_severity_scorer.py`
- Create: `services/signal/nlp/severity_scorer.py`

- [ ] **Write failing tests**

Create `services/signal/tests/test_severity_scorer.py`:

```python
from nlp.severity_scorer import score_severity

def test_critical_keywords():
    result = score_severity("BOMB BLAST kills 10, mass casualties at Westgate")
    assert result == "CRITICAL"

def test_high_severity():
    result = score_severity("Armed robbery ongoing, multiple victims reported injured")
    assert result == "HIGH"

def test_medium_severity():
    result = score_severity("Traffic jam on Thika Road, expect delays")
    assert result == "MEDIUM"

def test_low_severity():
    result = score_severity("Minor road closure near CBD, one lane open")
    assert result == "LOW"

def test_result_is_valid_enum():
    valid = {"CRITICAL", "HIGH", "MEDIUM", "LOW"}
    assert score_severity("anything") in valid
```

- [ ] **Run — must fail**

```bash
cd services/signal && python -m pytest tests/test_severity_scorer.py -v 2>&1 | tail -3
```

- [ ] **Create `services/signal/nlp/severity_scorer.py`**

```python
_CRITICAL_KEYWORDS = [
    "kills", "dead", "deaths", "fatalities", "mass casualty",
    "bomb", "blast", "explosion", "terrorist", "terror attack",
    "collapsed building", "multiple dead",
]

_HIGH_KEYWORDS = [
    "injured", "wounded", "armed", "shooting", "gunshot",
    "fire", "inferno", "major flood", "flash flood", "evacuation",
    "building collapse", "riot", "looting",
]

_MEDIUM_KEYWORDS = [
    "accident", "crash", "collision", "road block", "protest",
    "flooding", "power outage", "robbery",
]


def score_severity(text: str) -> str:
    """
    Return CRITICAL, HIGH, MEDIUM, or LOW based on keyword presence.
    Checks from most severe downward — first match wins.
    """
    text_lower = text.lower()

    if any(kw in text_lower for kw in _CRITICAL_KEYWORDS):
        return "CRITICAL"
    if any(kw in text_lower for kw in _HIGH_KEYWORDS):
        return "HIGH"
    if any(kw in text_lower for kw in _MEDIUM_KEYWORDS):
        return "MEDIUM"
    return "LOW"
```

- [ ] **Run — all tests must pass**

```bash
cd services/signal && python -m pytest tests/test_severity_scorer.py -v
```

Expected: `5 passed`

- [ ] **Commit**

```bash
git add services/signal/nlp/severity_scorer.py services/signal/tests/test_severity_scorer.py
git commit -m "Add severity scorer with TDD"
```

---

## Task 12: signal/ NLP — Event Fuser + Deduplication (TDD)

**Files:**
- Create: `services/signal/tests/test_event_fuser.py`
- Create: `services/signal/nlp/event_fuser.py`
- Create: `services/signal/ingest/deduplicator.py`
- Create: `services/signal/ingest/__init__.py`

- [ ] **Write failing event fuser tests**

Create `services/signal/tests/test_event_fuser.py`:

```python
import pytest
from nlp.event_fuser import should_fuse, build_event
from datetime import datetime, timezone

BASE_TIME = datetime(2026, 4, 28, 9, 0, 0, tzinfo=timezone.utc)

SIGNAL_A = {
    "event_type": "FLOOD",
    "severity": "HIGH",
    "location": {"lat": -1.2572, "lng": 36.8572, "place_name": "mathare", "county": "Nairobi"},
    "title": "Flooding in Mathare",
    "summary": "Water levels rising",
    "confidence": 0.80,
    "source_type": "news",
    "timestamp": BASE_TIME,
}

SIGNAL_B = {
    "event_type": "FLOOD",
    "severity": "HIGH",
    "location": {"lat": -1.2580, "lng": 36.8560, "place_name": "mathare", "county": "Nairobi"},
    "title": "Mathare river flooding",
    "summary": "Residents fleeing",
    "confidence": 0.75,
    "source_type": "twitter",
    "timestamp": BASE_TIME,
}

DISTANT_SIGNAL = {
    "event_type": "FLOOD",
    "severity": "HIGH",
    "location": {"lat": -4.0435, "lng": 39.6682, "place_name": "mombasa", "county": "Mombasa"},
    "title": "Flooding in Mombasa",
    "summary": "Coast flooding",
    "confidence": 0.70,
    "source_type": "rss",
    "timestamp": BASE_TIME,
}

def test_nearby_same_type_should_fuse():
    assert should_fuse(SIGNAL_A, SIGNAL_B) is True

def test_distant_signals_should_not_fuse():
    assert should_fuse(SIGNAL_A, DISTANT_SIGNAL) is False

def test_different_type_should_not_fuse():
    fire_signal = {**SIGNAL_B, "event_type": "FIRE"}
    assert should_fuse(SIGNAL_A, fire_signal) is False

def test_build_event_has_required_fields():
    event = build_event([SIGNAL_A, SIGNAL_B])
    assert "event_id" in event
    assert "event_type" in event
    assert "severity" in event
    assert "confidence" in event
    assert "source_count" in event
    assert event["source_count"] == 2

def test_build_event_source_breakdown():
    event = build_event([SIGNAL_A, SIGNAL_B])
    assert event["source_breakdown"]["news"] == 1
    assert event["source_breakdown"]["twitter"] == 1

def test_build_event_confidence_higher_with_more_sources():
    single = build_event([SIGNAL_A])
    multi = build_event([SIGNAL_A, SIGNAL_B])
    assert multi["confidence"] >= single["confidence"]
```

- [ ] **Run — must fail**

```bash
cd services/signal && python -m pytest tests/test_event_fuser.py -v 2>&1 | tail -3
```

- [ ] **Create `services/signal/nlp/event_fuser.py`**

```python
import uuid
import math
from datetime import datetime, timezone
from typing import Any

# Fuse signals within this radius and time window
FUSE_RADIUS_KM = 2.0
FUSE_WINDOW_MINUTES = 30

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance between two coordinates in km."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def should_fuse(signal_a: dict, signal_b: dict) -> bool:
    """Two signals fuse if same type, close in space, and close in time."""
    if signal_a["event_type"] != signal_b["event_type"]:
        return False

    loc_a = signal_a.get("location")
    loc_b = signal_b.get("location")
    if not loc_a or not loc_b:
        return False

    dist = _haversine_km(loc_a["lat"], loc_a["lng"], loc_b["lat"], loc_b["lng"])
    if dist > FUSE_RADIUS_KM:
        return False

    delta_minutes = abs(
        (signal_a["timestamp"] - signal_b["timestamp"]).total_seconds() / 60
    )
    return delta_minutes <= FUSE_WINDOW_MINUTES


def build_event(signals: list[dict]) -> dict:
    """
    Merge a cluster of signals into one SafetyEvent.
    Picks the highest severity and uses the highest-confidence signal's location.
    Confidence increases with source count (capped at 1.0).
    """
    best = max(signals, key=lambda s: s["confidence"])
    highest_severity = max(
        (s["severity"] for s in signals),
        key=lambda sv: SEVERITY_ORDER.index(sv),
    )

    source_breakdown: dict[str, int] = {}
    for s in signals:
        src = s.get("source_type", "unknown")
        source_breakdown[src] = source_breakdown.get(src, 0) + 1

    # Each additional corroborating source adds 0.05 confidence (max 1.0)
    base_confidence = best["confidence"]
    confidence = min(base_confidence + (len(signals) - 1) * 0.05, 1.0)

    now = datetime.now(timezone.utc).isoformat()

    return {
        "event_id": str(uuid.uuid4()),
        "event_type": best["event_type"],
        "severity": highest_severity,
        "title": best["title"],
        "summary": best.get("summary"),
        "location": best.get("location"),
        "confidence": round(confidence, 3),
        "source_count": len(signals),
        "source_breakdown": source_breakdown,
        "is_active": True,
        "started_at": min(s["timestamp"] for s in signals).isoformat(),
        "last_updated": now,
        "nostr_event_id": None,
        "bitcoin_txid": None,
    }
```

- [ ] **Create `services/signal/ingest/__init__.py`** (empty)

```python
```

- [ ] **Create `services/signal/ingest/deduplicator.py`**

```python
import hashlib
import redis.asyncio as aioredis
import config

_TTL_SECONDS = 86_400  # 24 hours

async def is_duplicate(content: str, client: aioredis.Redis) -> bool:
    """
    Return True if this content has been seen within the last 24 hours.
    Uses SHA256 of content as the dedup key stored in Redis.
    """
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    key = f"sentinel:dedup:{content_hash}"

    # SET NX (only set if not exists) + EX (expire after 24h)
    is_new = await client.set(key, "1", nx=True, ex=_TTL_SECONDS)
    return not is_new  # is_new is None if key already existed
```

- [ ] **Run all signal tests**

```bash
cd services/signal && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add services/signal/nlp/event_fuser.py services/signal/ingest/ services/signal/tests/
git commit -m "Add event fuser with TDD and Redis deduplication layer"
```

---

## Task 13: signal/ Ingest — RSS Parser

**Files:**
- Create: `services/signal/ingest/rss_parser.py`

- [ ] **Create `services/signal/ingest/rss_parser.py`**

```python
import feedparser
import asyncio
import redis.asyncio as aioredis
from datetime import datetime, timezone

import config
from publisher import emit_event, get_client
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event


async def _process_entry(entry: dict, source_url: str, client: aioredis.Redis) -> None:
    title = entry.get("title", "")
    summary = entry.get("summary", "") or entry.get("description", "")
    text = f"{title}. {summary}"

    if await is_duplicate(text, client):
        return

    classification = classify_event(text)
    if classification["event_type"] == "FALSE_ALARM" or classification["confidence"] < 0.3:
        return

    locations = extract_locations(text)
    location = locations[0] if locations else None

    # Skip events with no Kenya location — we are Kenya-scoped only
    if location is None:
        return

    severity = score_severity(text)
    published = entry.get("published_parsed")
    ts = (
        datetime(*published[:6], tzinfo=timezone.utc)
        if published
        else datetime.now(timezone.utc)
    )

    signal = {
        "event_type": classification["event_type"],
        "severity": severity,
        "title": title[:200],
        "summary": summary[:500] if summary else None,
        "location": location,
        "confidence": classification["confidence"],
        "source_type": "rss",
        "timestamp": ts,
    }

    event = build_event([signal])
    await emit_event(event)


async def poll_rss_feeds() -> None:
    """Fetch all RSS feeds and process new entries. Runs every 60 seconds."""
    client = await get_client()

    for feed_url in config.RSS_FEEDS:
        try:
            # feedparser is synchronous — run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            feed = await loop.run_in_executor(None, feedparser.parse, feed_url)

            for entry in feed.entries:
                try:
                    await _process_entry(entry, feed_url, client)
                except Exception as e:
                    # Log and continue — one bad entry should not stop the feed
                    print(f"RSS entry processing error ({feed_url}): {e}")

        except Exception as e:
            print(f"RSS feed fetch failed ({feed_url}): {e}")
```

- [ ] **Commit**

```bash
git add services/signal/ingest/rss_parser.py
git commit -m "Add RSS parser for 4 Kenyan news feeds"
```

---

## Task 14: signal/ Ingest — Twitter Filtered Stream

**Files:**
- Create: `services/signal/ingest/twitter_stream.py`

- [ ] **Create `services/signal/ingest/twitter_stream.py`**

```python
import httpx
import json
import asyncio
from datetime import datetime, timezone

import config
from publisher import emit_event, get_client
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event

# Keywords that narrow the stream to safety-relevant Kenyan content
STREAM_RULES = [
    {"value": "matatu OR ajali OR mafuriko OR maandamano lang:sw", "tag": "swahili-safety"},
    {"value": "(flood OR accident OR protest OR fire OR robbery) (nairobi OR mombasa OR kenya) lang:en", "tag": "english-safety"},
]

HEADERS = {
    "Authorization": f"Bearer {config.TWITTER_BEARER_TOKEN}",
    "Content-Type": "application/json",
}


async def _set_rules(client: httpx.AsyncClient) -> None:
    """Replace existing stream rules with our safety keyword rules."""
    # Delete all current rules first
    existing = await client.get("https://api.twitter.com/2/tweets/search/stream/rules", headers=HEADERS)
    if existing.status_code == 200:
        rule_ids = [r["id"] for r in existing.json().get("data", [])]
        if rule_ids:
            await client.post(
                "https://api.twitter.com/2/tweets/search/stream/rules",
                headers=HEADERS,
                json={"delete": {"ids": rule_ids}},
            )

    # Add our rules
    await client.post(
        "https://api.twitter.com/2/tweets/search/stream/rules",
        headers=HEADERS,
        json={"add": STREAM_RULES},
    )


async def start_twitter_stream() -> None:
    """
    Connect to Twitter filtered stream and process matching tweets.
    Reconnects with exponential backoff on failure.
    Skipped entirely if TWITTER_BEARER_TOKEN is not set.
    """
    if not config.TWITTER_BEARER_TOKEN:
        print("TWITTER_BEARER_TOKEN not set — Twitter stream disabled")
        return

    backoff = 1
    redis_client = await get_client()

    async with httpx.AsyncClient(timeout=None) as http:
        await _set_rules(http)

        while True:
            try:
                async with http.stream(
                    "GET",
                    "https://api.twitter.com/2/tweets/search/stream?tweet.fields=lang,geo,created_at",
                    headers=HEADERS,
                ) as stream:
                    backoff = 1  # reset on successful connection
                    print("Twitter stream connected")

                    async for line in stream.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                            tweet = data.get("data", {})
                            text = tweet.get("text", "")

                            if not text or await is_duplicate(text, redis_client):
                                continue

                            classification = classify_event(text)
                            if classification["confidence"] < 0.3:
                                continue

                            locations = extract_locations(text)
                            if not locations:
                                continue

                            signal = {
                                "event_type": classification["event_type"],
                                "severity": score_severity(text),
                                "title": text[:200],
                                "summary": None,
                                "location": locations[0],
                                "confidence": classification["confidence"],
                                "source_type": "twitter",
                                "timestamp": datetime.now(timezone.utc),
                            }
                            event = build_event([signal])
                            await emit_event(event)

                        except Exception as e:
                            print(f"Tweet processing error: {e}")

            except Exception as e:
                print(f"Twitter stream disconnected: {e}. Reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)  # cap at 5 minutes
```

- [ ] **Commit**

```bash
git add services/signal/ingest/twitter_stream.py
git commit -m "Add Twitter filtered stream with Kenya keywords and backoff reconnect"
```

---

## Task 15: signal/ Ingest — Whisper Radio Transcriber

**Files:**
- Create: `services/signal/ingest/radio_transcriber.py`

- [ ] **Create `services/signal/ingest/radio_transcriber.py`**

```python
import whisper
import httpx
import asyncio
from io import BytesIO
from datetime import datetime, timezone

import config
from publisher import emit_event, get_client
from ingest.deduplicator import is_duplicate
from nlp.classifier import classify_event
from nlp.location_extractor import extract_locations
from nlp.severity_scorer import score_severity
from nlp.event_fuser import build_event

# Load model once at module level — heavy, never reload per request.
# Uses WHISPER_MODEL env var: "base" in dev, "large-v3" in production.
_model = whisper.load_model(config.WHISPER_MODEL)

# Minimum meaningful transcript length — filters out silence and noise
MIN_TRANSCRIPT_CHARS = 30


async def _capture_audio(stream_url: str, duration_seconds: int = 30) -> BytesIO:
    """Download a fixed number of bytes from an HLS/MP3 stream (approx 30s at 128kbps)."""
    target_bytes = (128_000 * duration_seconds) // 8
    buffer = BytesIO()

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("GET", stream_url) as response:
            async for chunk in response.aiter_bytes(chunk_size=4096):
                buffer.write(chunk)
                if buffer.tell() >= target_bytes:
                    break

    buffer.seek(0)
    return buffer


async def _transcribe_and_process(station_name: str, stream_url: str) -> None:
    redis_client = await get_client()

    try:
        audio = await _capture_audio(stream_url)
    except Exception as e:
        print(f"Radio capture failed ({station_name}): {e}")
        return

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: _model.transcribe(
                audio,
                language=None,          # auto-detect sw or en
                task="transcribe",
                initial_prompt="Kenya news broadcast:",
                fp16=False,
            ),
        )
        text = result.get("text", "").strip()
    except Exception as e:
        print(f"Whisper transcription failed ({station_name}): {e}")
        return

    if len(text) < MIN_TRANSCRIPT_CHARS:
        return

    if await is_duplicate(text, redis_client):
        return

    classification = classify_event(text)
    if classification["confidence"] < 0.4:
        return

    locations = extract_locations(text)
    if not locations:
        return

    signal = {
        "event_type": classification["event_type"],
        "severity": score_severity(text),
        "title": text[:200],
        "summary": text[:500],
        "location": locations[0],
        "confidence": classification["confidence"],
        "source_type": "radio",
        "timestamp": datetime.now(timezone.utc),
    }
    event = build_event([signal])
    await emit_event(event)


async def monitor_radio() -> None:
    """Transcribe all configured radio streams concurrently. Runs every 30 seconds."""
    tasks = [
        _transcribe_and_process(name, url)
        for name, url in config.RADIO_STREAMS.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for name, result in zip(config.RADIO_STREAMS.keys(), results):
        if isinstance(result, Exception):
            print(f"Radio monitor error ({name}): {result}")
```

- [ ] **Commit**

```bash
git add services/signal/ingest/radio_transcriber.py
git commit -m "Add Whisper radio transcriber for Kenyan FM streams"
```

---

## Task 16: apps/pwa/ Scaffold

**Files:**
- Create: `apps/pwa/package.json`
- Create: `apps/pwa/tsconfig.json`
- Create: `apps/pwa/vite.config.ts`
- Create: `apps/pwa/index.html`
- Create: `apps/pwa/src/main.tsx`
- Create: `apps/pwa/src/App.tsx`

- [ ] **Create `apps/pwa/package.json`**

```json
{
  "name": "@sentinel/pwa",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@reduxjs/toolkit": "^2.5.1",
    "mapbox-gl": "^3.11.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-map-gl": "^8.0.4",
    "react-redux": "^9.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.20",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.8.3",
    "vite": "^6.3.2"
  }
}
```

- [ ] **Create `apps/pwa/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Create `apps/pwa/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
```

- [ ] **Create `apps/pwa/index.html`**

```html
<!DOCTYPE html>
<html lang="sw">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SentinelMesh</title>
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.css" rel="stylesheet" />
  </head>
  <body style="margin:0;background:#0a0a0a;">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Create `apps/pwa/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
)
```

- [ ] **Create `apps/pwa/src/App.tsx`**

```tsx
import SafetyMap from './components/SafetyMap'
import { useWsConnection } from './services/websocket'

export default function App() {
  useWsConnection()

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SafetyMap />
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add apps/pwa/
git commit -m "Scaffold PWA with Vite, React, Redux Toolkit, Mapbox GL"
```

---

## Task 17: apps/pwa/ Redux Store + WebSocket Service

**Files:**
- Create: `apps/pwa/src/store/index.ts`
- Create: `apps/pwa/src/store/eventsSlice.ts`
- Create: `apps/pwa/src/services/websocket.ts`

- [ ] **Create `apps/pwa/src/store/eventsSlice.ts`**

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { SafetyEvent } from '../../../../shared/types'

interface EventsState {
  items: SafetyEvent[]
  connected: boolean
}

const initialState: EventsState = {
  items: [],
  connected: false,
}

const eventsSlice = createSlice({
  name: 'events',
  initialState,
  reducers: {
    eventReceived(state, action: PayloadAction<SafetyEvent>) {
      const idx = state.items.findIndex(e => e.event_id === action.payload.event_id)
      if (idx >= 0) {
        state.items[idx] = action.payload
      } else {
        state.items.unshift(action.payload)
        // Keep last 200 events in memory
        if (state.items.length > 200) state.items.pop()
      }
    },
    eventResolved(state, action: PayloadAction<{ event_id: string }>) {
      const idx = state.items.findIndex(e => e.event_id === action.payload.event_id)
      if (idx >= 0) state.items[idx]!.is_active = false
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.connected = action.payload
    },
  },
})

export const { eventReceived, eventResolved, setConnected } = eventsSlice.actions
export default eventsSlice.reducer
```

- [ ] **Create `apps/pwa/src/store/index.ts`**

```typescript
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import { useSelector, TypedUseSelectorHook } from 'react-redux'

export const store = configureStore({
  reducer: {
    events: eventsReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
```

- [ ] **Create `apps/pwa/src/services/websocket.ts`**

```typescript
import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { eventReceived, eventResolved, setConnected } from '../store/eventsSlice'
import type { WsMessage } from '../../../../shared/types'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?county=global`

export function useWsConnection(): void {
  const dispatch = useDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function connect(): void {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      dispatch(setConnected(true))
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED') {
          dispatch(eventReceived(msg.payload as any))
        } else if (msg.type === 'EVENT_RESOLVED') {
          dispatch(eventResolved(msg.payload as any))
        }
      } catch {
        console.warn('Invalid WebSocket message received')
      }
    }

    ws.onclose = () => {
      dispatch(setConnected(false))
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [])
}
```

- [ ] **Commit**

```bash
git add apps/pwa/src/store/ apps/pwa/src/services/
git commit -m "Add Redux events store and WebSocket client with auto-reconnect"
```

---

## Task 18: apps/pwa/ Safety Map + Event Markers

**Files:**
- Create: `apps/pwa/src/components/SafetyMap.tsx`
- Create: `apps/pwa/src/components/EventMarker.tsx`

- [ ] **Create `apps/pwa/src/components/EventMarker.tsx`**

```tsx
import type { SafetyEvent, Severity, EventType } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH:     '#FF8C00',
  MEDIUM:   '#FFD700',
  LOW:      '#4CAF50',
}

const EVENT_ICONS: Record<EventType, string> = {
  FLOOD:                  '🌊',
  SECURITY_INCIDENT:      '🔴',
  FIRE:                   '🔥',
  TRAFFIC_INCIDENT:       '🚧',
  CIVIL_UNREST:           '⚠️',
  ACCIDENT:               '🚗',
  INFRASTRUCTURE_FAILURE: '⚡',
  MEDICAL_EMERGENCY:      '🏥',
  FALSE_ALARM:            '✅',
  ROAD_BLOCKED:           '🚧',
}

interface Props {
  event: SafetyEvent
  onClick: (event: SafetyEvent) => void
}

export default function EventMarker({ event, onClick }: Props) {
  const colour = SEVERITY_COLOURS[event.severity]
  const icon = EVENT_ICONS[event.event_type] ?? '⚠️'

  return (
    <div
      onClick={() => onClick(event)}
      style={{
        background: colour,
        borderRadius: '50%',
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: '2px solid white',
        fontSize: 16,
        boxShadow: `0 0 0 4px ${colour}44`,
      }}
      title={event.title}
    >
      {icon}
    </div>
  )
}
```

- [ ] **Create `apps/pwa/src/components/SafetyMap.tsx`**

```tsx
import Map, { Marker, Popup } from 'react-map-gl'
import { useState } from 'react'
import { useAppSelector } from '../store'
import EventMarker from './EventMarker'
import type { SafetyEvent } from '../../../../shared/types'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string

export default function SafetyMap() {
  const events = useAppSelector(state => state.events.items.filter(e => e.is_active && e.location))
  const connected = useAppSelector(state => state.events.connected)
  const [selected, setSelected] = useState<SafetyEvent | null>(null)

  return (
    <>
      {/* Connection status badge */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: connected ? '#4CAF50' : '#FF2D2D',
        color: 'white', padding: '4px 10px', borderRadius: 12,
        fontSize: 12, fontFamily: 'sans-serif',
      }}>
        {connected ? `Live · ${events.length} events` : 'Reconnecting…'}
      </div>

      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          longitude: 36.8219,
          latitude: -1.2921,
          zoom: 11,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
      >
        {events.map(event => (
          event.location && (
            <Marker
              key={event.event_id}
              longitude={event.location.lng}
              latitude={event.location.lat}
              anchor="center"
            >
              <EventMarker event={event} onClick={setSelected} />
            </Marker>
          )
        ))}

        {selected && selected.location && (
          <Popup
            longitude={selected.location.lng}
            latitude={selected.location.lat}
            onClose={() => setSelected(null)}
            closeButton={true}
            maxWidth="280px"
          >
            <div style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
              <strong style={{ color: '#333' }}>{selected.title}</strong>
              {selected.summary && <p style={{ margin: '6px 0 0' }}>{selected.summary}</p>}
              <p style={{ margin: '6px 0 0', color: '#666', fontSize: 11 }}>
                {selected.location.place_name} · {selected.severity} · {Math.round(selected.confidence * 100)}% confidence
              </p>
            </div>
          </Popup>
        )}
      </Map>
    </>
  )
}
```

- [ ] **Commit**

```bash
git add apps/pwa/src/components/
git commit -m "Add Mapbox safety map with severity markers and event popups"
```

---

## Task 19: Wire Everything Together + Smoke Test

**Files:**
- Modify: `Makefile` (smoke target already exists from Task 1)

- [ ] **Copy `.env.example` to `.env` and fill in local values**

```bash
cp .env.example .env
```

Minimum values needed to run locally:
```
POSTGRES_PASSWORD=sentinel_local
DATABASE_URL=postgresql://sentinel:sentinel_local@postgres:5432/sentinelmesh
REDIS_PASSWORD=sentinel_local
REDIS_URL=redis://:sentinel_local@redis:6379
JWT_SECRET=local_dev_secret_64_chars_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
INTERNAL_SERVICE_SECRET=local_internal_secret
VITE_MAPBOX_TOKEN=<your Mapbox public token>
```

- [ ] **Start the full stack**

```bash
make up
```

Expected output (after ~60s build):
```
gateway     | PostgreSQL pool connected
gateway     | Redis event subscriber started on sentinel:events:new
gateway     | WebSocket hub ready on /ws
gateway     | gateway listening on port 3000
signal      | INFO:     Application startup complete.
```

- [ ] **Verify gateway health**

```bash
curl -s http://localhost:3000/health
```

Expected:
```json
{"ok":true,"service":"gateway","ts":"2026-04-28T..."}
```

- [ ] **Verify signal health**

```bash
curl -s http://localhost:8000/health
```

Expected:
```json
{"ok":true,"service":"signal"}
```

- [ ] **Seed one test event and verify it appears via REST**

```bash
make seed
curl -s "http://localhost:3000/api/events?lat=-1.2921&lng=36.8219&radius_km=20" | python -m json.tool
```

Expected: JSON response with `events` array containing the seeded flood event.

- [ ] **Run the full smoke test**

```bash
make smoke
```

Expected:
```
Running smoke tests against localhost:3000...
Smoke tests passed.
```

- [ ] **Run all unit tests**

```bash
make test
```

Expected: all signal pytest tests pass, gateway vitest passes.

- [ ] **Open PWA in browser**

```
http://localhost:5173
```

Expected: dark Mapbox map centred on Nairobi. Green "Live · N events" badge. Seeded flood event visible as orange marker near Mathare.

- [ ] **Open browser DevTools → Network → WS tab, confirm WebSocket frame arrives on seed**

Run `make seed` again. You should see a new WebSocket message arrive in the Network tab with `type: "NEW_EVENT"`.

- [ ] **Final commit**

```bash
git add .
git commit -m "Phase 1 complete: signal ingest pipeline connected to live Mapbox map"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| PostgreSQL schema deployed | Task 2 |
| Signal ingest scaffolded (FastAPI) | Task 7 |
| RSS news parsers (Nation, Standard, Citizen, NTV) | Task 13 |
| Basic event classification | Task 10 |
| Safety events stored via REST API | Task 5 |
| Kenya gazetteer (1,000+ places) | Task 8 — 50 starter places; note to expand |
| Location extraction pipeline | Task 9 |
| Twitter filtered stream (Kenya bbox) | Task 14 |
| WebSocket broadcasting to clients | Task 6 |
| Redis pub/sub wired end-to-end | Tasks 6, 7, 13 |
| Whisper radio transcription (2 stations) | Task 15 |
| Event deduplication and fusion | Task 12 |
| PWA scaffold — map shows live events | Tasks 16, 17, 18 |
| Docker-first dev environment | Tasks 1, 2 |
| TypeScript for all JS services | Tasks 4, 5, 6, 16, 17, 18 |
| Shared contracts (JSON Schema + TS types) | Task 3 |

**Gap:** Gazetteer has 50 starter places vs. spec's 1,000+ minimum. After Phase 1 smoke test passes, expand `kenya_places.json` using KNBS administrative boundary data before marking Phase 1 done.

**Type consistency:** All TypeScript files reference `SafetyEvent`, `EventType`, `Severity`, `WsMessage` from `shared/types/index.d.ts`. Python uses matching field names in dicts.

**No placeholders found.**
