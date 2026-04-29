import os


def require_env(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required env var: {key}")
    return val


REDIS_URL = require_env("REDIS_URL")

# DATABASE_URL: required by the API service but never used by ml-worker.
# The API lifespan validates it is non-empty before accepting traffic.
DATABASE_URL = os.getenv("DATABASE_URL", "")

TWITTER_BEARER_TOKEN = os.getenv("TWITTER_BEARER_TOKEN", "")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

RSS_FEEDS = [
    "https://nation.africa/kenya/rss",
    "https://standardmedia.co.ke/rss/kenya.xml",
    "https://citizentv.co.ke/feed/",
    "https://ntv.co.ke/feed/",
]

RADIO_STREAMS = {
    "citizen_radio": "https://stream.radiojar.com/citizen-radio",
    "radio_maisha":  "https://stream.radiojar.com/radio-maisha",
}

KENYA_BBOX = "33.91,-4.67,41.90,4.62"
