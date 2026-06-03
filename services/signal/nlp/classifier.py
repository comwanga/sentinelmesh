import re
from typing import TypedDict


class ClassificationResult(TypedDict):
    event_type: str
    confidence: float


# How many tokens on each side of a keyword to scan for a suppressing cue.
# 5 (not 3): in real news text the cue is rarely adjacent to the keyword,
# e.g. "There is currently no evidence of a fire".
NEGATION_WINDOW = 5

# Keyword-only matching can never claim more than this confidence. It is a
# heuristic, not a calibrated classifier, and must not masquerade as one.
CONFIDENCE_CAP = 0.6

# Keyword sets per event type (English + Swahili).
# Higher keyword density in text -> higher confidence.
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

# Cues that negate a FOLLOWING keyword (scanned in the preceding window).
_NEGATION_CUES = {"no", "not", "without", "hakuna", "hapana", "si"}

# Cues that mark an event as resolved/over (scanned in the trailing window).
# "over" is deliberately excluded — it collides with "spread over", "all over".
_RESOLUTION_CUES = {
    "ended", "contained", "cleared", "clear", "resolved",
    "imeisha", "imezimwa",
}

_WORD_RE = re.compile(r"\w+")


def _is_suppressed(text_lower: str, keyword: str) -> bool:
    """
    True if EVERY occurrence of keyword in text is suppressed by a negation cue
    in the preceding NEGATION_WINDOW tokens or a resolution cue in the following
    NEGATION_WINDOW tokens. A single un-suppressed occurrence keeps the hit.
    """
    occurrences = 0
    suppressed = 0
    start = 0
    while True:
        idx = text_lower.find(keyword, start)
        if idx == -1:
            break
        occurrences += 1
        before = _WORD_RE.findall(text_lower[:idx])[-NEGATION_WINDOW:]
        after = _WORD_RE.findall(text_lower[idx + len(keyword):])[:NEGATION_WINDOW]
        negated = any(tok in _NEGATION_CUES for tok in before)
        resolved = any(tok in _RESOLUTION_CUES for tok in after)
        if negated or resolved:
            suppressed += 1
        start = idx + len(keyword)
    return occurrences > 0 and suppressed == occurrences


def classify_event(text: str) -> ClassificationResult:
    """
    Classify text into a safety event type using keyword density scoring.
    Keyword hits that are negated ("no fire") or resolved ("fire contained")
    are not counted. Confidence is capped at CONFIDENCE_CAP because this is a
    heuristic, not a calibrated classifier.
    """
    text_lower = text.lower()
    scores: dict[str, float] = {}

    for event_type, keywords in _KEYWORDS.items():
        hits = sum(
            1
            for kw in keywords
            if kw in text_lower and not _is_suppressed(text_lower, kw)
        )
        if hits > 0:
            # Normalise: 3+ hits = full (pre-cap) confidence in that category
            scores[event_type] = min(hits / 3.0, 1.0)

    if not scores:
        return {"event_type": _DEFAULT, "confidence": 0.1}

    best_type = max(scores, key=lambda k: scores[k])
    confidence = min(scores[best_type], CONFIDENCE_CAP)
    return {"event_type": best_type, "confidence": round(confidence, 3)}
