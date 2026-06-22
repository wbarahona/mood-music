#!/usr/bin/env bash
set -euo pipefail

APP_SUPPORT="$HOME/Library/Application Support/com.wbarahona.mood-music"

echo "Resetting Mood Music to factory state…"

# Downloaded / compiled AI models
if [ -d "$APP_SUPPORT/models" ]; then
  echo "  removing models…"
  rm -rf "$APP_SUPPORT/models"
fi

# Tauri plugin-store: API keys, Spotify tokens, service config
if [ -f "$APP_SUPPORT/mood-music.json" ]; then
  echo "  removing stored keys…"
  rm -f "$APP_SUPPORT/mood-music.json"
fi

echo "Done. Launch the app and it will start from the beginning."
