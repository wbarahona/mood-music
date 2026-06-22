#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SD_SWIFT_DIR="$REPO_ROOT/sd-swift"
ML_SD_DIR="$REPO_ROOT/ml-stable-diffusion"
BINARY_OUT="$REPO_ROOT/src-tauri/binaries/sd-swift-aarch64-apple-darwin"

# The Claude Code / VS Code harness injects GIT_CONFIG_COUNT=1 with
# safe.bareRepository=explicit, which blocks Swift PM from cloning bare repos.
# Clear those vars so SPM's git calls work normally.
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 2>/dev/null || true

echo "Building sd-swift for $(uname -m)…"

if [ ! -d "$ML_SD_DIR" ]; then
  echo "  cloning apple/ml-stable-diffusion…"
  git clone https://github.com/apple/ml-stable-diffusion "$ML_SD_DIR"
fi

cd "$SD_SWIFT_DIR"
swift build -c release

cp .build/release/sd-swift "$BINARY_OUT"
echo "Done → $BINARY_OUT"
