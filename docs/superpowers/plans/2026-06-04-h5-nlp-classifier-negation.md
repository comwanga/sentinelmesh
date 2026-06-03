# H-5 Phase 1 — Classifier Negation + Confidence Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NLP keyword classifier negation-aware and stop it from claiming high confidence, closing the "keyword counter" half of audit finding H-5.

**Architecture:** `services/signal/nlp/classifier.py` keeps its keyword-density approach but (1) suppresses a keyword hit when a negation cue precedes it or a resolution cue follows it within a configurable token window, returning `FALSE_ALARM` when the winning category is fully suppressed, and (2) caps keyword-only confidence at 0.6 so it reads as an explicit heuristic. Pure rule-based, no ML, no new dependencies.

**Tech Stack:** Python 3, `pytest` (existing). Tests run from `services/signal` (imports are `from nlp.classifier import ...`).

**Spec:** `docs/superpowers/specs/2026-06-04-h5-nlp-guardrails-design.md` (Part A).

**Scope note:** This is Phase 1 of three. Phase 2 (Rust trust ladder on `safety_events`) and Phase 3 (PWA trust-state labeling) get their own plans. This plan is self-contained and shippable on its own.

---

### Task 1: Add negation-aware suppression and confidence cap to the classifier

**Files:**
- Modify: `services/signal/nlp/classifier.py`
- Test: `services/signal/tests/test_classifier.py`

- [ ] **Step 1: Write the failing tests**

Append these tests to `services/signal/tests/test_classifier.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from the `services/signal` directory):
```bash
cd services/signal && python -m pytest tests/test_classifier.py -v
```
Expected: FAIL — `ImportError: cannot import name 'CONFIDENCE_CAP'` (and the new behaviour tests fail because suppression does not exist yet).

- [ ] **Step 3: Implement negation handling and the confidence cap**

Replace the entire contents of `services/signal/nlp/classifier.py` with:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from the `services/signal` directory):
```bash
cd services/signal && python -m pytest tests/test_classifier.py -v
```
Expected: PASS — all new tests plus the pre-existing `test_classifier.py` cases. Note the pre-existing `test_flood_high_confidence` asserts `confidence > 0.5`; the cap is 0.6 so a 3-keyword flood headline still passes (0.6 > 0.5). If any pre-existing case now fails because it asserted `> 0.6`, that is a real semantic change — stop and report it rather than weakening the cap.

- [ ] **Step 5: Commit**

```bash
git add services/signal/nlp/classifier.py services/signal/tests/test_classifier.py
git commit -m "H-5: negation handling and confidence cap in NLP classifier"
```

---

### Task 2: Verify the ingest confidence gate still admits genuine events

**Files:**
- Read only: `services/signal/ingest/rss_parser.py:25-27`, `services/signal/ingest/twitter_stream.py:85-87`, `services/signal/worker/transcriber.py:74-77`

The ingest sites drop anything below confidence 0.3 (transcriber 0.4). With the new 0.6 cap, a single-keyword hit scores `min(1/3, 0.6) = 0.333` and still clears the 0.3 RSS/Twitter gate; a two-keyword hit scores `min(2/3, 0.6) = 0.6`. The transcriber's 0.4 gate now requires at least two keywords. This is the intended tightening — confirm no gate constant needs changing.

- [ ] **Step 1: Confirm the gates are still satisfiable and no code change is needed**

Run (from the `services/signal` directory):
```bash
cd services/signal && python -c "from nlp.classifier import classify_event; print(classify_event('Major accident on Thika Road, matatu overturned')); print(classify_event('Fire at the market'))"
```
Expected output (two dicts): the accident text yields `TRAFFIC_INCIDENT` with confidence ≥ 0.6 (multiple keywords: accident, matatu, overturned), and the single-keyword fire text yields `FIRE` with confidence 0.333 (above the 0.3 RSS/Twitter gate, below the 0.4 transcriber gate — single-source audio fire is intentionally not auto-ingested). No code change required.

- [ ] **Step 2: No commit**

This task is verification only; nothing to commit.

---

## Self-Review

- **Spec coverage (Part A):** negation window 5 (`NEGATION_WINDOW`, Task 1 Step 3 + `test_window_constant_is_five`); bilingual cues (`_NEGATION_CUES`/`_RESOLUTION_CUES` incl. Swahili, `test_swahili_negation_suppresses_hit`); all-hits-negated → FALSE_ALARM (`_is_suppressed` + `classify_event`, `test_negated_fire_is_false_alarm`); confidence cap 0.6 (`CONFIDENCE_CAP`, `test_confidence_is_capped_at_0_6`); honest-confidence rationale documented in docstrings. The spec's "preceding window" is implemented as a surrounding window (preceding negation cues + trailing resolution cues) so the spec's own example "the explosion has been contained" is handled; `over` dropped from resolution cues to avoid "spread over" false negatives — both noted in code comments.
- **Placeholder scan:** none — every step has full code or an exact command + expected output.
- **Type consistency:** `classify_event` keeps its `ClassificationResult` return type and `{event_type, confidence}` shape (unchanged consumer contract); new public names `NEGATION_WINDOW`, `CONFIDENCE_CAP`, `_is_suppressed` are used consistently across Task 1 Steps 1 and 3.
