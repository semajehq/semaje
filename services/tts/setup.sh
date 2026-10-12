#!/usr/bin/env bash
# One-time setup for the TTS service. Idempotent.
#   services/tts/setup.sh                    # Piper only (commercial-safe default)
#   SEMAJE_MMS=1 services/tts/setup.sh       # + MMS-TTS runtime (non-commercial weights; opt in at runtime)
#   TTS_PRELOAD="sw_CD-lanfrica-medium en_US-lessac-high" services/tts/setup.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SEMAJE_HOME="${SEMAJE_HOME:-$HOME/.local/share/semaje}"
VENV="${TTS_VENV:-$SEMAJE_HOME/venv-tts}"
export TTS_VOICE_DIR="${TTS_VOICE_DIR:-$SEMAJE_HOME/voices}"
PYTHON="${PYTHON:-python3.11}"

[ -x "$VENV/bin/python" ] || "$PYTHON" -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip uv
UV="$VENV/bin/uv pip install --python $VENV/bin/python --quiet"
$UV -r "$HERE/requirements.txt" -r "$HERE/requirements-dev.txt"
[ "${SEMAJE_MMS:-0}" = "1" ] && $UV -r "$HERE/requirements-mms.txt"

PRELOAD="${TTS_PRELOAD:-en_US-lessac-high sw_CD-lanfrica-medium}"
echo "==> Pre-downloading Piper voices into $TTS_VOICE_DIR: $PRELOAD"
cd "$ROOT"
"$VENV/bin/python" - "$PRELOAD" <<'PY'
import sys
from services.tts import catalog, config
from services.tts.engines.piper_engine import download, is_installed
wanted = sys.argv[1].split()
for voice in catalog.piper_voices():
    if voice.id in wanted:
        print(f"   {voice.id}: {'already installed' if is_installed(voice, config.VOICE_DIR) else 'downloading…'}", flush=True)
        if not is_installed(voice, config.VOICE_DIR):
            download(voice, config.VOICE_DIR)
PY
echo "Done. Start with: npm run dev:tts   (or services/tts/run.sh)"
