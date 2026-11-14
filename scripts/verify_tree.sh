#!/data/data/com.termux/files/usr/bin/bash
# Athuex tree verify — version-aware (reads versionName from gradle).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
ok()   { echo "OK  $1"; }
miss() { echo "MISS $1"; fail=1; }

GRADLE="android/app/build.gradle"
VERSION="$(grep -oE 'versionName[[:space:]]*[=]?[[:space:]]*"[^"]+"' "$GRADLE" 2>/dev/null \
  | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
CODE="$(grep -oE 'versionCode[[:space:]]+[0-9]+' "$GRADLE" 2>/dev/null \
  | head -1 | awk '{print $2}' || true)"

if [ -z "$VERSION" ]; then
  miss "detect versionName from $GRADLE"
  VERSION="UNKNOWN"
else
  ok "versionName=$VERSION versionCode=${CODE:-?}"
fi

echo "=== Athuex v${VERSION} tree verify ==="

[ -f native/imgui_app/CMakeLists.txt ] && ok CMake || miss CMake
[ -f native/imgui_app/src/llama_worker.cpp ] && ok worker || miss worker
[ -f native/imgui_app/src/athuex_input.cpp ] && ok input_module || miss input_module
[ -f native/imgui_app/src/athuex_input.h ] && ok input_header || miss input_header
[ -f native/shared/athuex_theme.h ] && ok shared_theme || miss shared_theme
[ -f third_party/clay/README.md ] && ok clay_placeholder || miss clay_placeholder
[ -f tools/registry.js ] && ok tools/registry.js || miss tools/registry.js
[ -s programs/ide/tabs.js ] && ok 'IDE tabs module' || miss 'IDE tabs module'
[ -f .github/workflows/build-apk.yml ] && ok workflow || miss workflow
[ -f LICENSE ] && ok LICENSE || miss LICENSE
[ -f CHANGELOG.md ] && ok CHANGELOG || miss CHANGELOG
[ -f docs/P02_clay_ui_complete.txt ] && ok P02_doc || miss P02_doc
[ -f docs/P06_generation_lifecycle_repair.md ] && ok P06_lifecycle_doc || miss P06_lifecycle_doc
[ -f TEST_INSTRUCTIONS.md ] && ok TEST_INSTRUCTIONS || miss TEST_INSTRUCTIONS

grep -q "$VERSION" native/imgui_app/CMakeLists.txt && ok "CMake ATHUEX_VERSION=$VERSION" || miss "CMake ATHUEX_VERSION"
grep -q "$VERSION" js/version.js && ok "js/version.js $VERSION" || miss "js/version.js"
if [ -n "$CODE" ]; then
  grep -q "versionCode $CODE" android/app/build.gradle && ok "versionCode $CODE" || miss "versionCode"
fi

grep -q 'set_worker_priority\|nice=10' native/imgui_app/src/llama_worker.cpp && ok 'P01 priority' || miss 'P01 priority'
grep -q 'GGML_OPENMP OFF' native/imgui_app/CMakeLists.txt && ok 'OpenMP off' || miss 'OpenMP off'
grep -q 'LLAMA_LOAD_MODE_MMAP' core/harness/llama_harness.c && ok mmap || miss mmap
grep -q 'compare_exchange_strong' native/imgui_app/src/llama_worker.cpp && ok 'worker single-flight' || miss 'worker single-flight'
grep -q 'g_gen_epoch\|finish_generation' native/imgui_app/src/llama_worker.cpp && ok 'generation epoch' || miss 'generation epoch'
grep -q 'athuex_input_drain' native/imgui_app/src/app.cpp && ok 'input drain on render thread' || miss 'input drain'
grep -q 'athuex_worker_ui_frame_begin' native/imgui_app/src/app.cpp && ok 'frame-stable snapshot' || miss 'frame-stable snapshot'
grep -q 'llama_harness_reset_abort' core/harness/llama_harness.c && ok 'explicit abort reset' || miss 'explicit abort reset'
grep -q 'athuex_input.cpp' native/imgui_app/CMakeLists.txt && ok 'input in CMake sources' || miss 'input in CMake'
grep -q 'fun clearComposer' android/app/src/main/java/com/athuex/app/MainActivity.kt && ok 'clearComposer Kotlin' || miss 'clearComposer'
grep -q 'nativeInjectTextDelta' android/app/src/main/java/com/athuex/app/MainActivity.kt && ok 'batched IME JNI declaration' || miss 'batched IME JNI declaration'
grep -q 'Java_com_athuex_app_MainActivity_nativeInjectTextDelta' native/imgui_app/src/app.cpp && ok 'batched IME JNI implementation' || miss 'batched IME JNI implementation'
grep -q 'athuex_input_inject_text_delta' native/imgui_app/src/athuex_input.cpp && ok 'batched native input queue' || miss 'batched native input queue'
if grep -q 'setOnKeyListener' android/app/src/main/java/com/athuex/app/MainActivity.kt; then miss 'duplicate key listener forwarding'; else ok 'single IME text forwarding path'; fi
grep -q 'g_ClearPromptRequested.exchange' native/imgui_app/src/app.cpp && ok 'render-thread prompt clear' || miss 'render-thread prompt clear'

# No force-push / embedded tokens in build scripts
if grep -qE 'force-push|safe\.directory=\*|ghp_[A-Za-z0-9]' build_athuex.sh 2>/dev/null; then
  miss 'build script hygiene (token or force-push)'
else
  ok 'build script hygiene'
fi


grep -q 'eglSwapInterval' native/imgui_app/src/app.cpp && ok 'eglSwapInterval(0)' || miss 'eglSwapInterval(0)'
grep -q 'compare_exchange_weak' native/imgui_app/src/app.cpp && ok '3-frame render credit' || miss '3-frame render credit'
grep -q 'fetch_sub(1' native/imgui_app/src/app.cpp && ok 'render credit consume' || miss 'render credit consume'
grep -q 'isSingleLine = true' android/app/src/main/java/com/athuex/app/MainActivity.kt && ok 'single-line hidden EditText' || miss 'single-line hidden EditText'
grep -q 'subSequence(start' android/app/src/main/java/com/athuex/app/MainActivity.kt && ok 'TextWatcher append fast-path' || miss 'TextWatcher append fast-path'
[ -f docs/P08_keyboard_latency_repair.md ] && ok 'P08 doc' || miss 'P08 doc'

exit "$fail"
