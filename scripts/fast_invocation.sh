#!/data/data/com.termux/files/usr/bin/bash
# Optional llama-server path (for browser harness fallback).
# Prefer Athuex C CLI (termux/start.sh) for true standalone streaming.
set -euo pipefail
MODEL="${1:-$HOME/storage/downloads/gguf_models/Qwen3-0.6B-Q4_K_M.gguf}"
PORT="${2:-8080}"
LLAMA_BIN="${LLAMA_BIN:-$HOME/llama.cpp/build/bin/llama-server}"

[[ -f "$MODEL" ]] || { echo "Model missing: $MODEL"; exit 1; }
[[ -x "$LLAMA_BIN" ]] || { echo "llama-server not found: $LLAMA_BIN"; exit 1; }

if ! echo "$MODEL" | grep -qi 'Q4_K_M'; then
    echo "[warn] Prefer Q4_K_M for Athuex local policy on 4 GB devices."
fi

exec "$LLAMA_BIN" \
  -m "$MODEL" \
  -c 2048 \
  --port "$PORT" \
  --host 127.0.0.1 \
  -t 2 \
  --threads-batch 4 \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  --flash-attn \
  --mlock \
  --parallel 1 \
  --no-warmup \
  --n-predict 256 \
  --log-disable
