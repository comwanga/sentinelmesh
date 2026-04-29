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
