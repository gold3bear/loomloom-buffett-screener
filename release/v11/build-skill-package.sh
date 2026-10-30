#!/usr/bin/env bash
# Build the public v11 Agent Skill ZIP. Never ships internal model/prompt Code.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="loomloom-019fad3b-8831-7986-bdd0-db4620e261b8"
OUT="$ROOT/release/v11/loomloom-buffett-screener-v11-clean.zip"
cd "$ROOT/skill"
rm -f "$OUT"
zip -qr "$OUT" "$NAME" \
  -x "*.DS_Store" -x "*/__pycache__/*" -x "*.pyc" \
  -x "*/model/*" \
  -x "*/scripts/run-model.mjs" \
  -x "*/scripts/sync-model-code.mjs" \
  -x "*/scripts/*.test.mjs" -x "*/scripts/dev/*"
echo "built: $OUT"
echo "bytes: $(wc -c < "$OUT" | tr -d ' ')"
