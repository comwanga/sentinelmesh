.PHONY: up dev up-signal up-ml up-blockchain down down-clean logs install fmt lint test test-rust test-gateway test-blockchain test-pwa test-signal build-pwa config smoke seed

up:
	docker compose up --build

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

up-signal:
	docker compose --profile signal up --build

up-ml:
	docker compose --profile ml up --build

up-blockchain:
	docker compose --profile blockchain up --build

down:
	docker compose down

down-clean:
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

test-blockchain:
	cd services && cargo test -p blockchain --locked

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
	docker compose --env-file .env.example --profile signal --profile ml --profile blockchain config --quiet

smoke:
	curl -fsS http://localhost/live
	curl -fsS http://localhost/ready
	curl -fsS http://localhost/
	curl -fsS http://localhost/alerts
	curl -fsS http://localhost/api/events?limit=1

seed:
	docker compose exec postgres sh -c 'PGPASSWORD="$$APP_DATABASE_PASSWORD" psql -U sentinel_app -d sentinelmesh -v ON_ERROR_STOP=1 -c "INSERT INTO safety_events (event_type, severity, title, summary, lat, lng, place_name, county, confidence, source_count, started_at, trust_state, origin_class) VALUES ('\''FLOOD'\'', '\''HIGH'\'', '\''Test flood in Mathare'\'', '\''Rising water levels near Mathare River'\'', -1.2572, 36.8572, '\''Mathare Valley'\'', '\''Nairobi'\'', 0.85, 2, NOW(), '\''confirmed'\'', '\''human'\'');"'
