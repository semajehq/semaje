#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
SEMAJE_HOME="${SEMAJE_HOME:-$HOME/.local/share/semaje}"
VENV="${TTS_VENV:-$SEMAJE_HOME/venv-tts}"
[ -x "$VENV/bin/python" ] || { echo "Run services/tts/setup.sh first."; exit 1; }
export TTS_VOICE_DIR="${TTS_VOICE_DIR:-$SEMAJE_HOME/voices}"
exec "$VENV/bin/python" -m services.tts.app
