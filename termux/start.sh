#!/data/data/com.termux/files/usr/bin/bash
# Athuex v2.8.4 — Termux CLI (fastest native path, 4 GB safe defaults)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA="${LLAMA:-$HOME/llama.cpp}"
GGUF_DIR="${GGUF_DIR:-$HOME/storage/downloads/gguf_models}"
THREADS="${THREADS:-2}"
CTX="${CTX:-1536}"

ARG1="${1:-}"
PROMPT="${2:-Hello from Athuex v2.8.4. Reply briefly.}"

find_gguf() {
  local dir="$1"
  local hit
  hit="$(find "$dir" -maxdepth 2 -type f -iname '*Q4_K_M*.gguf' 2>/dev/null | head -1 || true)"
  if [[ -z "$hit" ]]; then
    hit="$(find "$dir" -maxdepth 2 -type f -iname '*.gguf' 2>/dev/null | head -1 || true)"
  fi
  printf '%s' "$hit"
}

if [[ -z "$ARG1" ]]; then
  if [[ -d "$GGUF_DIR" ]]; then
    ARG1="$(find_gguf "$GGUF_DIR")"
  fi
fi

if [[ -d "${ARG1:-}" ]]; then
  GGUF_DIR="$ARG1"
  MODEL="$(find_gguf "$GGUF_DIR")"
elif [[ -f "${ARG1:-}" ]]; then
  MODEL="$ARG1"
else
  MODEL="${ARG1:-}"
fi

if [[ ! -d "$LLAMA" ]]; then
  echo "llama.cpp not found at $LLAMA"
  echo "  pkg install clang cmake git"
  echo "  git clone https://github.com/ggerganov/llama.cpp \"\$HOME/llama.cpp\""
  exit 1
fi

if [[ ! -d "$LLAMA/build" ]]; then
  echo "Building llama.cpp (one-time)..."
  (cd "$LLAMA" && cmake -B build -DCMAKE_BUILD_TYPE=Release \
      -DGGML_NATIVE=ON -DLLAMA_CURL=OFF && \
      cmake --build build -j"$(nproc 2>/dev/null || echo 4)")
fi

# Ensure static archives exist (Makefile expects them)
if [[ ! -f "$LLAMA/build/src/libllama.a" ]]; then
  echo "Missing $LLAMA/build/src/libllama.a — rebuild llama.cpp with static libs."
  exit 1
fi

if [[ -z "${MODEL:-}" || ! -f "$MODEL" ]]; then
  echo "No GGUF found."
  echo "Usage: $0 [model.gguf|folder] [\"prompt\"]"
  echo "Or set GGUF_DIR and place *Q4_K_M*.gguf files there."
  echo "Current GGUF_DIR=$GGUF_DIR"
  exit 1
fi

if ! echo "$MODEL" | grep -qi 'Q4_K_M'; then
  echo "[warn] Prefer Q4_K_M on 4 GB devices (Galaxy A06)."
fi

cd "$ROOT/termux"
make -j"$(nproc 2>/dev/null || echo 4)" LLAMA="$LLAMA"
# Android shared storage is often noexec — run from $HOME copy
BIN="${HOME}/athuex_cli"
if [[ ! -x "$BIN" ]]; then
  echo "error: $BIN not installed (make install failed)"
  exit 1
fi
echo ""
echo "=== Athuex CLI v2.8.4 — $(basename "$MODEL") (threads=$THREADS ctx=$CTX) ==="
exec "$BIN" "$MODEL" "$PROMPT" --threads="$THREADS" --ctx="$CTX"
