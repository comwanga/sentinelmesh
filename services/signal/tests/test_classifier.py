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


from nlp.classifier import classify_event, CONFIDENCE_CAP, NEGATION_WINDOW


def test_negated_fire_is_false_alarm():
    # "no" immediately precedes the keyword
    result = classify_event("No fire, all clear at Gikomba market")
    assert result["event_type"] == "FALSE_ALARM"


def test_negation_within_window_suppresses_hit():
    # negation cue is 3 tokens before the keyword (within window of 5)
    result = classify_event("There is currently no evidence of a fire")
    assert result["event_type"] == "FALSE_ALARM"


def test_trailing_resolution_cue_suppresses_hit():
    # resolution cue ("contained") follows the keyword
    result = classify_event("Authorities confirmed the explosion has been contained")
    assert result["event_type"] == "FALSE_ALARM"


def test_swahili_negation_suppresses_hit():
    result = classify_event("Hakuna moto, ni habari za uongo")
    assert result["event_type"] == "FALSE_ALARM"


def test_non_negated_event_still_classifies():
    # negation word present but NOT near the keyword -> hit still counts
    result = classify_event("Huge fire at the market, no one knows the cause yet")
    assert result["event_type"] == "FIRE"


def test_confidence_is_capped_at_0_6():
    # text with many fire keywords would otherwise score 1.0
    result = classify_event("Fire blaze inferno flames burning smoke at the market")
    assert result["event_type"] == "FIRE"
    assert result["confidence"] <= CONFIDENCE_CAP


def test_window_constant_is_five():
    assert NEGATION_WINDOW == 5
