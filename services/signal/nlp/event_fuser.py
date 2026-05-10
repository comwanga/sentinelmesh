import uuid
import math
from datetime import datetime, timezone

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
    Merge a cluster of signals into one RedisEventPayload.
    Output matches services/event_schema.json exactly.
    """
    best = max(signals, key=lambda s: s["confidence"])
    highest_severity = max(
        (s["severity"] for s in signals),
        key=lambda sv: SEVERITY_ORDER.index(sv),
    )

    loc = best.get("location") or {}

    if loc.get("lat") is None or loc.get("lng") is None:
        raise ValueError(f"cannot build event: signal has no coordinates (location={loc!r})")

    return {
        "schema_version": 1,
        "id": str(uuid.uuid4()),
        "event_type": best["event_type"],
        "severity": highest_severity,
        "title": best["title"],
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        "started_at": min(s["timestamp"] for s in signals).isoformat(),
        "summary": best.get("summary"),
        "place_name": loc.get("place_name"),
        "county": loc.get("county"),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
