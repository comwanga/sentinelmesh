import spacy
from gazetteer.loader import lookup_place, list_aliases

# Load once at module import — spaCy model is heavy, never reload per request
nlp = spacy.load("en_core_web_sm")

# Pre-sort aliases by length (longest first) to prefer specific matches.
# "mathare valley" should match before "mathare".
_all_aliases = sorted(list_aliases(), key=len, reverse=True)

def extract_locations(text: str) -> list[dict]:
    """
    Find Kenya locations in text using two strategies:
    1. spaCy NER for GPE/LOC entities, resolved via gazetteer (higher confidence)
    2. Direct string scan of all known aliases (catches short names spaCy misses)

    Returns up to 3 results sorted by confidence, highest first.
    Never fabricates a coordinate — returns empty list if nothing matches.
    """
    doc = nlp(text)
    found: dict[str, dict] = {}  # canonical_name → result

    # Strategy 1: spaCy named entities
    for ent in doc.ents:
        if ent.label_ not in ("GPE", "LOC", "FAC"):
            continue
        place = lookup_place(ent.text)
        if place and place["place_name"] not in found:
            found[place["place_name"]] = {**place, "confidence": 0.85}

    # Strategy 2: direct alias scan (catches short names and Swahili variants)
    text_lower = text.lower()
    for alias in _all_aliases:
        if alias in text_lower:
            place = lookup_place(alias)
            if place and place["place_name"] not in found:
                found[place["place_name"]] = {**place, "confidence": 0.65}

    results = sorted(found.values(), key=lambda x: x["confidence"], reverse=True)
    return results[:3]
