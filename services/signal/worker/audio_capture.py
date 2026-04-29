"""Frame-safe audio capture from a live radio stream using ffmpeg."""

import asyncio
import os
import tempfile


async def capture_audio_segment(stream_url: str, duration: int = 30) -> str:
    """
    Capture `duration` seconds from a live radio stream into a temp WAV file.

    Runs ffmpeg as a subprocess so it handles MP3/AAC codec framing correctly.
    Raw byte-slicing of a live stream produces corrupt audio because MP3 frames
    don't align to arbitrary byte offsets.

    Output is mono 16 kHz PCM — Whisper's native format, avoiding re-decode overhead.

    Returns the path to the temp file. Caller must delete it after use.
    Raises RuntimeError on ffmpeg failure or timeout.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()

    cmd = [
        "ffmpeg", "-y",
        "-i", stream_url,
        "-t", str(duration),
        "-vn",                   # strip any video stream
        "-acodec", "pcm_s16le",  # raw PCM — unambiguous, no decoder risk
        "-ar", "16000",          # 16 kHz — Whisper's native sample rate
        "-ac", "1",              # mono
        tmp.name,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )

    deadline = duration + 20  # buffer for stream negotiation and codec init
    try:
        await asyncio.wait_for(proc.wait(), timeout=deadline)
    except asyncio.TimeoutError:
        proc.kill()
        _safe_unlink(tmp.name)
        raise RuntimeError(
            f"ffmpeg timed out capturing {stream_url} after {deadline}s"
        )

    if proc.returncode != 0:
        _safe_unlink(tmp.name)
        raise RuntimeError(f"ffmpeg exit {proc.returncode} for {stream_url}")

    return tmp.name


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass
