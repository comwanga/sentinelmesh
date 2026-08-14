.PHONY: up dev dev-pwa up-signal up-ml down down-clean logs install fmt lint test test-rust test-gateway test-pwa test-signal build-pwa config smoke seed migrate prod-config prod-up backup restore-verify watchdog test-operations

up:
	docker compose up --build

# Live-reload dev: postgres/redis/gateway(cargo-watch)/PWA(Vite HMR on :5173).
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Fastest PWA HMR: run Vite on the host against a dockerized backend (`make dev`
# or at least `docker compose up -d postgres redis gateway-rs migrate`).
dev-pwa:
	cd apps/pwa && npm run dev

up-signal:
	docker compose --profile signal up --build

up-ml:
	docker compose --profile ml up --build

down:
	docker compose down

down-clean:
	@echo "WARNING: deleting all local SentinelMesh volumes and data" >&2
	docker compose down -v --remove-orphans

logs:
	docker compose logs -f

install:
	cd apps/pwa && npm ci
	python -m pip install -r services/signal/requirements.api.txt -r services/signal/requirements.dev.txt

fmt:
	cd services && cargo fmt --all

lint:
	cd services && cargo fmt --all --check
	cd services && cargo clippy --workspace --all-targets -- -D warnings
	cd apps/pwa && npx tsc --noEmit

test-gateway:
	cd services && cargo test -p gateway --locked

test-rust:
	cd services && cargo test --workspace --locked

test-pwa:
	cd apps/pwa && npm test -- --maxWorkers=1

build-pwa:
	cd apps/pwa && npm run build

test-signal:
	cd services/signal && python -m pytest tests/ -q

test: test-rust test-pwa test-signal

config:
	docker compose --env-file .env.example config --quiet
	docker compose --env-file .env.example --profile signal --profile ml config --quiet

migrate:
	./ops/compose.sh run --rm migrate

prod-config:
	./ops/production-preflight.sh

prod-up: prod-config
	./ops/compose.sh -f docker-compose.yml -f docker-compose.production.yml up -d --build --wait

backup:
	./ops/postgres-backup.sh

restore-verify:
	@test -n "$(BACKUP)" || (echo "usage: make restore-verify BACKUP=backups/file.dump" >&2; exit 1)
	./ops/postgres-restore-verify.sh "$(BACKUP)"

watchdog:
	./ops/watchdog.sh

test-operations:
	./tests/operations-smoke.sh

smoke:
	curl -fsS http://localhost/live
	curl -fsS http://localhost/ready
	curl -fsS http://localhost/
	curl -fsS http://localhost/alerts
	curl -fsS http://localhost/api/events?limit=1

seed:
	docker compose exec postgres sh -c 'PGPASSWORD="$$APP_DATABASE_PASSWORD" psql -U sentinel_app -d sentinelmesh -v ON_ERROR_STOP=1 -c "INSERT INTO safety_events (event_type, severity, title, summary, lat, lng, place_name, county, confidence, source_count, started_at, trust_state, origin_class) VALUES ('\''FLOOD'\'', '\''HIGH'\'', '\''Test flood in Mathare'\'', '\''Rising water levels near Mathare River'\'', -1.2572, 36.8572, '\''Mathare Valley'\'', '\''Nairobi'\'', 0.85, 2, NOW(), '\''confirmed'\'', '\''human'\'');"'
