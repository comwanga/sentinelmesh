from typing import TypedDict

class ClassificationResult(TypedDict):
    event_type: str
    confidence: float

# Keyword sets per event type (English + Swahili).
# Higher keyword density in text → higher confidence.
_KEYWORDS: dict[str, list[str]] = {
    "FLOOD": [
        "flood", "flooding", "mafuriko", "inundation",
        "submerged", "overflow", "river burst", "imefurika",
        "water level", "flash flood",
    ],
    "TRAFFIC_INCIDENT": [
        "accident", "ajali", "crash", "collision", "matatu",
        "lorry", "msongamano", "congestion", "road block",
        "traffic", "barabara", "blocked", "overturned", "pileup",
    ],
    "CIVIL_UNREST": [
        "protest", "maandamano", "demonstration", "riot",
        "teargas", "police", "polisi", "dispersed", "chaos",
        "clashes", "agitation", "strike", "mgomo",
    ],
    "SECURITY_INCIDENT": [
        "robbery", "armed", "shooting", "gunshot", "carjacking",
        "mugging", "abduction", "kidnap", "terror", "bomb",
        "explosion", "wezi", "bunduki", "hijack",
    ],
    "FIRE": [
        "fire", "moto", "blaze", "inferno", "burning",
        "smoke", "flames", "inachoma", "arson", "gutted",
    ],
    "MEDICAL_EMERGENCY": [
        "ambulance", "hospital", "emergency", "injured",
        "casualty", "dead", "killed", "wounded", "hospitalized",
        "death toll",
    ],
    "INFRASTRUCTURE_FAILURE": [
        "power outage", "blackout", "umeme", "electricity",
        "water shortage", "bridge", "collapse",
        "kenya power", "kplc", "no water",
    ],
}

_DEFAULT = "FALSE_ALARM"


def classify_event(text: str) -> ClassificationResult:
    """
    Classify text into a safety event type using keyword density scoring.
    Returns the highest-scoring type and a 0–1 confidence value.
    Confidence is proportional to keyword matches relative to keywords available.
    """
    text_lower = text.lower()
    scores: dict[str, float] = {}

    for event_type, keywords in _KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw in text_lower)
        if hits > 0:
            # Normalise: 3+ hits = full confidence in that category
            scores[event_type] = min(hits / 3.0, 1.0)

    if not scores:
        return {"event_type": _DEFAULT, "confidence": 0.1}

    best_type = max(scores, key=lambda k: scores[k])
    return {"event_type": best_type, "confidence": round(scores[best_type], 3)}
