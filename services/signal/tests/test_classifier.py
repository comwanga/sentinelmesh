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
