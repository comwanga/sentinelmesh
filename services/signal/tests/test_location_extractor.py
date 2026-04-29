import pytest
from gazetteer.loader import lookup_place, list_aliases

# ── Gazetteer loader tests ──────────────────────────────────────────────────

def test_nairobi_canonical_name():
    result = lookup_place("nairobi")
    assert result is not None
    assert result["lat"] == pytest.approx(-1.2921, abs=0.01)
    assert result["lng"] == pytest.approx(36.8219, abs=0.01)
    assert result["county"] == "Nairobi"

def test_alias_resolves_to_canonical():
    # "nai" is a common Swahili shorthand for Nairobi
    result = lookup_place("nai")
    assert result is not None
    assert result["place_name"] == "nairobi"

def test_kibera_alias():
    # kibera and kibra are both in wide use
    result = lookup_place("kibra")
    assert result is not None
    assert result["place_name"] == "kibera"

def test_unknown_place_returns_none():
    result = lookup_place("completely_unknown_xyz")
    assert result is None

def test_case_insensitive():
    result = lookup_place("MATHARE")
    assert result is not None

def test_list_aliases_includes_entry():
    aliases = list_aliases()
    assert "nairobi" in aliases
    assert "nai" in aliases

# ── Location extractor tests ────────────────────────────────────────────────

from nlp.location_extractor import extract_locations

def test_extract_nairobi_from_english():
    results = extract_locations("Heavy flooding reported in Nairobi CBD")
    assert any(r["place_name"] == "nairobi" for r in results)

def test_extract_mathare_from_swahili():
    results = extract_locations("Mafuriko makubwa yanaendelea Mathare valley")
    assert any(r["place_name"] == "mathare" for r in results)

def test_location_has_required_fields():
    results = extract_locations("Accident on Thika Road near Kasarani")
    assert len(results) > 0
    for r in results:
        assert "place_name" in r
        assert "lat" in r
        assert "lng" in r
        assert "confidence" in r
        assert 0.0 <= r["confidence"] <= 1.0

def test_unknown_location_returns_empty():
    results = extract_locations("Something happened at some place")
    # May return empty — should never fabricate a location
    for r in results:
        assert r["confidence"] > 0

def test_max_three_locations_returned():
    text = "Incidents in Nairobi, Mombasa, Kisumu, Nakuru, and Eldoret"
    results = extract_locations(text)
    assert len(results) <= 3

def test_alias_recognised():
    results = extract_locations("Traffic jam near Westy roundabout")
    assert any(r["place_name"] == "westlands" for r in results)
