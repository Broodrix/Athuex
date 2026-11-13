#!/data/data/com.termux/files/usr/bin/bash
# Athuex v2.8.4 — one-shot Termux bootstrap (POSIX-friendly, modular)
# Installs packages, builds llama.cpp if needed, builds & installs athuex_cli to $HOME.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA="${LLAMA:-$HOME/llama.cpp}"
INSTALL_DIR="${INSTALL_DIR:-$HOME}"
JOBS="$(nproc 2>/dev/null || echo 4)"

log()  { printf '[athuex] %s\n' "$*"; }
die()  { printf '[athuex] ERROR: %s\n' "$*" >&2; exit 1; }

need_pkg() {
  local p
  for p in "$@"; do
    if ! command -v "$p" >/dev/null 2>&1; then
      return 1
    fi
  done
  return 0
}

install_deps() {
  log "Checking packages (clang cmake make git curl)..."
  if ! need_pkg clang cmake make git; then
    log "Installing build packages via pkg..."
    pkg update -y || true
    pkg install -y clang cmake make git libcurl || die "pkg install failed"
  fi
  # libcurl may be present as libcurl.so without curl binary; clang is enough for link.
  log "Packages OK"
}

ensure_llama() {
  if [[ ! -d "$LLAMA" ]]; then
    log "Cloning llama.cpp → $LLAMA"
    git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA" \
      || die "git clone llama.cpp failed"
  fi
  if [[ ! -f "$LLAMA/build/src/libllama.a" ]]; then
    log "Building llama.cpp (static, Release, native)..."
    (cd "$LLAMA" && \
      cmake -B build -DCMAKE_BUILD_TYPE=Release \
            -DGGML_NATIVE=ON -DLLAMA_CURL=OFF \
            -DBUILD_SHARED_LIBS=OFF && \
      cmake --build build -j"$JOBS") \
      || die "llama.cpp build failed"
  fi
  [[ -f "$LLAMA/build/src/libllama.a" ]] || die "libllama.a still missing after build"
  log "llama.cpp ready: $LLAMA"
}

build_cli() {
  log "Building Athuex CLI..."
  cd "$ROOT/termux"
  make clean 2>/dev/null || true
  make -j"$JOBS" LLAMA="$LLAMA" INSTALL_DIR="$INSTALL_DIR"
  [[ -x "$INSTALL_DIR/athuex_cli" ]] || die "install failed — $INSTALL_DIR/athuex_cli missing"
  log "Installed: $INSTALL_DIR/athuex_cli"
}

print_usage() {
  cat <<EOF

=== Athuex v2.8.4 ready ===

Run:
  $INSTALL_DIR/athuex_cli /path/to/model-Q4_K_M.gguf "Your prompt"

Or use the helper (auto-finds GGUF):
  bash $ROOT/termux/start.sh [model.gguf|folder] ["prompt"]

Tips:
  - Prefer *Q4_K_M*.gguf on 4 GB devices
  - THREADS=2 CTX=1536 bash termux/start.sh ...
  - Shared storage is often noexec; always use the \$HOME binary
  - Native ImGui APK path: see native/README.md and docs/PHASE4_NATIVE_IMGUI_2.8.4.md

EOF
}

main() {
  log "Athuex v2.8.4 bootstrap (root=$ROOT)"
  install_deps
  ensure_llama
  build_cli
  print_usage
}

main "$@"
