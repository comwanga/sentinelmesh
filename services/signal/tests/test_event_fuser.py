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
