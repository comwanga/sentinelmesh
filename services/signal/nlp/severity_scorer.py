_CRITICAL_KEYWORDS = [
    "kills", "dead", "deaths", "fatalities", "mass casualty",
    "bomb", "blast", "explosion", "terrorist", "terror attack",
    "collapsed building", "multiple dead",
]

_HIGH_KEYWORDS = [
    "injured", "wounded", "armed", "shooting", "gunshot",
    "fire", "inferno", "major flood", "flash flood", "evacuation",
    "building collapse", "riot", "looting",
]

_MEDIUM_KEYWORDS = [
    "accident", "crash", "collision", "road block", "protest",
    "flooding", "power outage", "robbery", "traffic jam",
]


def score_severity(text: str) -> str:
    """
    Return CRITICAL, HIGH, MEDIUM, or LOW based on keyword presence.
    Checks from most severe downward — first match wins.
    """
    text_lower = text.lower()

    if any(kw in text_lower for kw in _CRITICAL_KEYWORDS):
        return "CRITICAL"
    if any(kw in text_lower for kw in _HIGH_KEYWORDS):
        return "HIGH"
    if any(kw in text_lower for kw in _MEDIUM_KEYWORDS):
        return "MEDIUM"
    return "LOW"
