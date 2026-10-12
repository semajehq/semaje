#!/usr/bin/env bash
# Clone (or update) every semaje repo side by side, next to this one:
#
#   ../semaje-stt  ../semaje-tts  ../semaje-languages  ../semaje-web  ../semaje-extension
#
# Then: docker compose -f docker-compose.yml -f compose.dev.yml up -d --build
set -euo pipefail
cd "$(dirname "$0")/../.."
for repo in semaje-stt semaje-tts semaje-languages semaje-web semaje-extension; do
  if [ -d "$repo/.git" ]; then
    echo "==> $repo: pulling"
    git -C "$repo" pull --ff-only --quiet
  else
    echo "==> $repo: cloning"
    git clone --quiet "https://github.com/semajehq/$repo.git"
  fi
done
echo "Workspace ready in $(pwd)"
