#!/usr/bin/env bash
# Build the v4 Agent Skill ZIP for LoomLoom private package upload.
# This script only writes a local ZIP; it does not upload or publish anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL_NAME="loomloom-019fad3b-8831-7986-bdd0-db4620e261b8"
SKILL_DIR="$ROOT/skill/$SKILL_NAME"
OUT_DIR="$ROOT/release/v4"
OUT="$OUT_DIR/loomloom-buffett-screener-v4.zip"

if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  echo "Skill directory not found: $SKILL_DIR" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT"

cd "$ROOT/skill"
zip -qr "$OUT" "$SKILL_NAME" \
  -x "*.DS_Store" \
  -x "*/__pycache__/*" \
  -x "*.pyc" \
  -x "*/model/fixtures/*" \
  -x "*/model/test_*.py" \
  -x "*/scripts/*.test.mjs" \
  -x "*/scripts/dev/*"

echo "built: $OUT"
echo "bytes: $(wc -c < "$OUT" | tr -d ' ')"
if command -v shasum >/dev/null; then
  echo "sha256: $(shasum -a 256 "$OUT" | awk '{print $1}')"
elif command -v sha256sum >/dev/null; then
  echo "sha256: $(sha256sum "$OUT" | awk '{print $1}')"
fi
unzip -l "$OUT" | tail -5
