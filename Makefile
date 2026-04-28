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
