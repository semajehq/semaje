# syntax=docker/dockerfile:1
# semaje TTS service — Piper (and optionally MMS-TTS).
#   docker build -f services/tts/Dockerfile .                       # Piper only
#   docker build -f services/tts/Dockerfile --build-arg MMS=1 .     # + MMS runtime (CPU torch)
FROM python:3.11-slim

ARG MMS=0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Slow or flaky links (common on enterprise networks): long timeouts, retries, cached wheels.
ENV PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY services/tts/requirements*.txt services/tts/
RUN --mount=type=cache,target=/root/.cache/pip pip install -r services/tts/requirements.txt \
  && if [ "$MMS" = "1" ]; then \
       pip install --extra-index-url https://download.pytorch.org/whl/cpu -r services/tts/requirements-mms.txt; \
     fi

COPY packages/__init__.py packages/__init__.py
COPY packages/languages/ packages/languages/
COPY services/tts/ services/tts/
RUN touch services/__init__.py \
  && useradd --system --uid 10001 semaje && mkdir -p /voices && chown semaje /voices
USER semaje

ENV TTS_PORT=8012 TTS_VOICE_DIR=/voices HF_HOME=/voices/hf PYTHONUNBUFFERED=1
VOLUME /voices
EXPOSE 8012
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8012/health/live', timeout=3)"
CMD ["python", "-m", "services.tts.app"]
