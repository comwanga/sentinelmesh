import json
from pathlib import Path
from typing import Optional

_GAZETTEER_PATH = Path(__file__).parent / "kenya_places.json"

# Build a flat alias → canonical_name map at import time.
# This means lookups are O(1) at runtime.
_alias_map: dict[str, tuple[str, dict]] = {}

def _load() -> None:
    data = json.loads(_GAZETTEER_PATH.read_text(encoding="utf-8"))
    for canonical_name, entry in data.items():
        record = {**entry, "place_name": canonical_name}
        _alias_map[canonical_name.lower()] = (canonical_name, record)
        for alias in entry.get("aliases", []):
            _alias_map[alias.lower()] = (canonical_name, record)

_load()

def lookup_place(text: str) -> Optional[dict]:
    """
    Return place data for a name or alias, or None if not in gazetteer.
    Never returns a guessed or fabricated coordinate.
    """
    return _alias_map.get(text.strip().lower(), (None, None))[1]

def list_aliases() -> list[str]:
    """Return all known place names and aliases."""
    return list(_alias_map.keys())
