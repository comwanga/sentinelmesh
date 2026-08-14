#!/bin/sh
set -eu
# Disposable relay conformance smoke test. This is a SKELETON: it automates what
# can be automated without a pinned relay (NIP-11 + lifecycle spin-up) and prints
# a checklist for the interactive NIP-42/NIP-29/gift-wrap checks, which require a
# chosen relay implementation and a Nostr client tool. See
# docs/operations/relay-conformance.md before enabling chat.

: "${RELAY_IMAGE:?set RELAY_IMAGE (e.g. nostr-rs-relay:0.9.x)}"
: "${RELAY_HTTPS_URL:?set RELAY_HTTPS_URL (e.g. https://localhost:8080)}"
: "${RELAY_WS_URL:?set RELAY_WS_URL (e.g. ws://localhost:8080)}"

project="sentinelmesh-relay-test-$$"
export COMPOSE_PROJECT_NAME="$project"
container="${project}-relay"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --name "$container" -p 8080:8080 "$RELAY_IMAGE" >/dev/null

attempt=0
until curl -fsS -H 'Accept: application/nostr+json' "$RELAY_HTTPS_URL" >/tmp/relay-info.json 2>/dev/null; do
  attempt=$((attempt + 1))
  test "$attempt" -lt 60 || { echo "relay did not become ready" >&2; exit 1; }
  sleep 1
done

# NIP-11 conformance: required NIPs and a stable pubkey.
required="1 9 11 42"
for nip in $required; do
  python3 - "$nip" <<'PY'
import json, sys
nip = int(sys.argv[1])
info = json.load(open('/tmp/relay-info.json'))
nips = info.get('supported_nips', [])
if nip not in nips:
    raise SystemExit(f"relay does not advertise NIP-{nip}")
PY
done
test -n "$(python3 -c "import json; print(json.load(open('/tmp/relay-info.json')).get('pubkey',''))")"

echo "NIP-11 conformance OK for NIPs: $required"
echo
echo "Interactive checks (require a pinned relay + Nostr client; see relay-conformance.md):"
echo "  [ ] NIP-42 AUTH challenge + kind-22242 response and reconnect"
echo "  [ ] NIP-29 create(9007)/post(9)/delete(9005)/remove(9001)/pin(9010)"
echo "  [ ] NIP-29 39000-39003 signed by the relay self pubkey"
echo "  [ ] recipient A cannot query recipient B's kind-1059 gift wraps"
echo "  [ ] webhook HMAC + X-Relay-Delivery idempotency redelivery"
echo "  [ ] relay restart + history recovery; retention expiry"
echo "relay conformance smoke (automated subset) passed"
