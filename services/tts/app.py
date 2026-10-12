"""semaje TTS service — open-source text-to-speech. See contract.md."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from collections import OrderedDict

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from packages.languages import UnknownLanguage, registry

from . import catalog, config, metrics
from .encode import FormatError, encode
from .engines.base import Synth
from .text import TextError, chunk, validate

VERSION = "1.0.0"


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {"ts": round(record.created, 3), "level": record.levelname.lower(), "service": "tts",
                   "msg": record.getMessage(), **(getattr(record, "fields", {}) or {})}
        return json.dumps(payload, default=str)


log = logging.getLogger("semaje.tts")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(JsonFormatter())
    log.addHandler(_h)
    log.setLevel(config.LOG_LEVEL.upper())
    log.propagate = False


def _log(level, msg, **fields):
    log.log(level, msg, extra={"fields": fields})


# ── Loaded-voice cache (LRU, bounded so RAM stays predictable) ───
class SynthCache:
    def __init__(self, size: int):
        self.size = max(1, size)
        self.lock = threading.Lock()
        self.items: OrderedDict[str, Synth] = OrderedDict()

    def get(self, voice: catalog.Voice) -> Synth:
        with self.lock:
            synth = self.items.get(voice.id)
            if synth is not None:
                self.items.move_to_end(voice.id)
                return synth
        synth = make_synth(voice)
        synth.load()
        with self.lock:
            self.items[voice.id] = synth
            self.items.move_to_end(voice.id)
            while len(self.items) > self.size:
                self.items.popitem(last=False)
        return synth


def make_synth(voice: catalog.Voice) -> Synth:
    if voice.engine in ("piper", "custom"):
        from .engines.piper_engine import PiperSynth
        return PiperSynth(voice, config.VOICE_DIR)
    if voice.engine == "mms":
        from .engines.mms_engine import MmsSynth
        return MmsSynth(voice, config.VOICE_DIR)
    raise ValueError(f"unknown engine {voice.engine}")


def installed_ids() -> set[str]:
    from .engines.piper_engine import is_installed
    return {v.id for v in catalog.piper_voices() if is_installed(v, config.VOICE_DIR)} | \
           {v.id for v in catalog.custom_voices()}


cache = SynthCache(config.MAX_LOADED_VOICES)
_slots = asyncio.Semaphore(config.MAX_CONCURRENCY)

app = FastAPI(title="semaje TTS", version=VERSION)
PUBLIC_PATHS = {"/health/live", "/health"}


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    if config.API_TOKEN and request.url.path not in PUBLIC_PATHS:
        if request.headers.get("authorization", "") != f"Bearer {config.API_TOKEN}":
            return JSONResponse({"error": "unauthorized", "code": "unauthorized", "requestId": request_id},
                                status_code=401, headers={"x-request-id": request_id})
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    if request.url.path not in ("/health/live", "/metrics"):
        _log(logging.INFO, "http", requestId=request_id, method=request.method, path=request.url.path,
             status=response.status_code, ms=round((time.perf_counter() - started) * 1000, 1))
    return response


def _error(request: Request, status: int, message: str, code: str, headers=None) -> JSONResponse:
    return JSONResponse({"error": message, "code": code, "requestId": request.state.request_id},
                        status_code=status, headers={"x-request-id": request.state.request_id, **(headers or {})})


@app.get("/health/live")
def live():
    return {"ok": True}


@app.get("/health")
@app.get("/health/ready")
def health():
    return {
        "ok": True,
        "version": VERSION,
        "allowNoncommercial": config.ALLOW_NONCOMMERCIAL,
        "autoDownload": config.AUTO_DOWNLOAD,
        "loadedVoices": list(cache.items.keys()),
        "installedVoices": len(installed_ids()),
    }


@app.get("/metrics")
def prometheus():
    return PlainTextResponse(metrics.render(), media_type=metrics.CONTENT_TYPE)


@app.get("/voices")
def voices(request: Request, language: str = ""):
    try:
        lang = registry().resolve(language) if language else None
    except UnknownLanguage as exc:
        return _error(request, 400, str(exc), exc.code)
    installed = installed_ids()
    rows = []
    for v in catalog.all_voices():
        if lang and v.language != lang.code:
            continue
        rows.append({**v.to_dict(), "installed": v.id in installed or v.engine == "mms"})
    covered = sorted({r["language"] for r in rows})
    return {"count": len(rows), "languages": len(covered), "allowNoncommercial": config.ALLOW_NONCOMMERCIAL,
            "voices": rows}


class VoiceRequest(BaseModel):
    voice: str


@app.post("/voices/download")
def download_voice(req: VoiceRequest, request: Request):
    from .engines.piper_engine import download
    voice = next((v for v in catalog.piper_voices() if v.id == req.voice), None)
    if voice is None:
        return _error(request, 404, f"Unknown Piper voice {req.voice!r}", "no_voice")
    try:
        download(voice, config.VOICE_DIR)
    except OSError as exc:
        return _error(request, 502, f"Download failed: {exc}", "download_failed")
    return {"ok": True, "voice": voice.id}


class SynthesizeRequest(BaseModel):
    text: str
    language: str | None = None
    voice: str | None = None
    format: str = "wav"
    speed: float = Field(1.0, ge=0.25, le=4.0)
    speaker: int | None = Field(None, ge=0)


def _synthesize_blocking(req: SynthesizeRequest):
    text = validate(req.text, config.MAX_CHARS)
    voice = catalog.choose_voice(req.language, req.voice, catalog.all_voices(), config.ALLOW_NONCOMMERCIAL,
                                 installed_ids())
    started = time.perf_counter()
    synth = cache.get(voice)
    audio = synth.synthesize(chunk(text, config.CHUNK_CHARS), speed=req.speed, speaker=req.speaker)
    data, mime = encode(audio.samples, audio.sample_rate, req.format)
    elapsed = time.perf_counter() - started
    metrics.CHARS.labels(voice.engine).inc(len(text))
    metrics.AUDIO_SECONDS.labels(voice.engine).inc(audio.duration)
    metrics.LATENCY.labels(voice.engine).observe(elapsed)
    return voice, audio, data, mime, elapsed


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest, request: Request):
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=config.QUEUE_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        metrics.REJECTED.inc()
        return _error(request, 503, "TTS is at capacity; retry shortly.", "busy", {"Retry-After": "10"})
    try:
        voice, audio, data, mime, elapsed = await run_in_threadpool(_synthesize_blocking, req)
    except (TextError, FormatError, UnknownLanguage) as exc:
        metrics.REQUESTS.labels("none", "client_error").inc()
        return _error(request, 400, str(exc), exc.code)
    except catalog.VoiceError as exc:
        metrics.REQUESTS.labels("none", exc.code).inc()
        return _error(request, exc.status, exc.message, exc.code)
    except (FileNotFoundError, PermissionError) as exc:
        metrics.REQUESTS.labels("none", "unavailable").inc()
        return _error(request, 503, str(exc), "voice_unavailable")
    except Exception as exc:  # noqa: BLE001
        metrics.REQUESTS.labels("none", "error").inc()
        _log(logging.ERROR, "synthesize.failed", requestId=request.state.request_id, error=str(exc))
        return _error(request, 500, str(exc), "internal")
    finally:
        _slots.release()
    metrics.REQUESTS.labels(voice.engine, "ok").inc()
    return Response(content=data, media_type=mime, headers={
        "x-request-id": request.state.request_id,
        "x-semaje-voice": voice.id,
        "x-semaje-engine": voice.engine,
        "x-semaje-language": voice.language,
        "x-semaje-duration": f"{audio.duration:.3f}",
        "x-semaje-license": json.dumps(voice.license, separators=(",", ":"), ensure_ascii=True),
        "x-semaje-synthesis-ms": f"{elapsed * 1000:.0f}",
    })


def main():
    import uvicorn
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")


if __name__ == "__main__":
    main()
