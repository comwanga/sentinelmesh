import os

def require_env(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val

REDIS_URL      = require_env("REDIS_URL")
DATABASE_URL   = require_env("DATABASE_URL")

# Optional — stream is skipped if not set
TWITTER_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN", "")

# Use 'base' in dev, 'large-v3' in production
WHISPER_MODEL  = os.getenv("WHISPER_MODEL", "base")

# RSS feeds — Nation, Standard, Citizen, NTV
RSS_FEEDS = [
    "https://nation.africa/kenya/rss",
    "https://standardmedia.co.ke/rss/kenya.xml",
    "https://citizentv.co.ke/feed/",
    "https://ntv.co.ke/feed/",
]

# Public radio streams for Whisper transcription
RADIO_STREAMS = {
    "citizen_radio": "https://stream.radiojar.com/citizen-radio",
    "radio_maisha":  "https://stream.radiojar.com/radio-maisha",
}

# Kenya bounding box for Twitter geo-filter
KENYA_BBOX = "33.91,-4.67,41.90,4.62"
