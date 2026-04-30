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

# Verified 2026-04-30. Original radiojar URLs (citizen-radio, radio-maisha) return 404.
# These three endpoints were confirmed live (HTTP 200, audio/* Content-Type):
#   nation_fm   - Nation FM Kenya via radiojar (GET only; HEAD returns 400)
#   nrg_radio   - NRG Radio Kenya via Shoutcast (GET only; HEAD returns 404)
#   kameme_fm   - Kameme FM (Royal Media) via StreamGuys (HEAD + GET both 200)
RADIO_STREAMS = {
    "nation_fm":  "http://stream.radiojar.com/3by7s8eg65quv",
    "nrg_radio":  "https://streamingv2.shoutcast.com/nrg-radio-ke",
    "kameme_fm":  "https://kamemefm-atunwadigital.streamguys1.com/kamemefm",
}

KENYA_BBOX = "33.91,-4.67,41.90,4.62"
