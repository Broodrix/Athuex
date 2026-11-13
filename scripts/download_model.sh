#!/data/data/com.termux/files/usr/bin/bash
# Download a small Q4_K_M GGUF suitable for Athuex local path (Galaxy A06 class).
# User may replace with any Q4_K_M of choice.
set -euo pipefail
DEST="${1:-$HOME/storage/downloads/gguf_models}"
mkdir -p "$DEST"
if ! command -v huggingface-cli >/dev/null 2>&1; then
    pip install --quiet huggingface_hub
fi
# Prefer Q4_K_M as required by Athuex local policy
huggingface-cli download Qwen/Qwen3-0.6B-GGUF \
    Qwen3-0.6B-Q4_K_M.gguf \
    --local-dir "$DEST" || \
huggingface-cli download Qwen/Qwen3-0.6B-GGUF \
    Qwen3-0.6B-Q4_0.gguf \
    --local-dir "$DEST"
echo "Saved under: $DEST"
ls -lh "$DEST"/*.gguf 2>/dev/null || true
