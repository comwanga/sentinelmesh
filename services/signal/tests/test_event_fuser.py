import pytest
import json
import jsonschema
from pathlib import Path
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

def test_build_event_schema_fields_present():
    event = build_event([SIGNAL_A, SIGNAL_B])
    assert event["schema_version"] == 1
    assert "id" in event
    assert event["event_type"] == "FLOOD"
    assert event["severity"] == "HIGH"
    assert "title" in event
    assert "started_at" in event
    assert event["is_active"] is True
    assert "created_at" in event

def test_build_event_flat_location():
    event = build_event([SIGNAL_A])
    assert event["lat"] == -1.2572
    assert event["lng"] == 36.8572
    assert event["place_name"] == "mathare"
    assert event["county"] == "Nairobi"
    assert "location" not in event

def test_build_event_started_at_is_earliest():
    earlier = {**SIGNAL_A, "timestamp": datetime(2026, 4, 28, 8, 0, tzinfo=timezone.utc)}
    later = {**SIGNAL_B, "timestamp": datetime(2026, 4, 28, 9, 0, tzinfo=timezone.utc)}
    event = build_event([later, earlier])
    assert event["started_at"] == earlier["timestamp"].isoformat()

def test_build_event_no_extra_fields():
    event = build_event([SIGNAL_A])
    allowed = {"schema_version", "id", "event_type", "severity", "title", "lat", "lng",
               "started_at", "summary", "place_name", "county", "is_active", "created_at"}
    assert set(event.keys()) == allowed

def test_build_event_raises_when_location_missing():
    no_loc = {**SIGNAL_A, "location": None}
    with pytest.raises(ValueError, match="no coordinates"):
        build_event([no_loc])

def test_build_event_output_is_valid_against_schema():
    schema_path = Path(__file__).parent.parent / "event_schema.json"
    schema = json.loads(schema_path.read_text())

    event = build_event([SIGNAL_A, SIGNAL_B])
    jsonschema.validate(instance=event, schema=schema)  # raises if invalid
