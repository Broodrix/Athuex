#!/data/data/com.termux/files/usr/bin/bash
# Fix dubious ownership on shared storage (Termux)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
git config --global --add safe.directory "$ROOT" || true
echo "safe.directory += $ROOT"
