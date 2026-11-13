#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
ok() { echo "OK  $1"; }
miss() { echo "MISS $1"; fail=1; }
echo "=== Athuex v2.11.1 tree verify ==="
[ -f native/imgui_app/CMakeLists.txt ] && ok CMake || miss CMake
[ -f native/imgui_app/src/llama_worker.cpp ] && ok worker || miss worker
[ -f native/shared/athuex_theme.h ] && ok shared_theme || miss shared_theme
[ -f third_party/clay/README.md ] && ok clay_placeholder || miss clay_placeholder
[ -f tools/registry.js ] && ok tools/registry.js || miss tools/registry.js
[ -s programs/ide/tabs.js ] && ok 'IDE tabs module' || miss 'IDE tabs module'
[ -f .github/workflows/build-apk.yml ] && ok workflow || miss workflow
grep -q 'ATHUEX_VERSION: "2.11.1"' .github/workflows/build-apk.yml && ok 'workflow 2.11.1' || miss 'workflow version'
grep -q '2.11.1' js/version.js && ok version || miss version
grep -q 'set_worker_priority\|nice=10' native/imgui_app/src/llama_worker.cpp && ok 'P01 priority' || miss 'P01 priority'
grep -q 'GGML_OPENMP OFF' native/imgui_app/CMakeLists.txt && ok 'OpenMP off' || miss 'OpenMP off'
grep -q 'LLAMA_LOAD_MODE_MMAP' core/harness/llama_harness.c && ok mmap || miss mmap
[ -f LICENSE ] && ok LICENSE || miss LICENSE
[ -f CHANGELOG.md ] && ok CHANGELOG || miss CHANGELOG
[ -f docs/P02_clay_ui_complete.txt ] && ok P02_doc || miss P02_doc
[ -f docs/P06_generation_lifecycle_repair.md ] && ok P06_lifecycle_doc || miss P06_lifecycle_doc
grep -q 'compare_exchange_strong' native/imgui_app/src/llama_worker.cpp && ok 'worker single-flight' || miss 'worker single-flight'
grep -q 'thread_local std::string snapshot' native/imgui_app/src/llama_worker.cpp && ok 'stable UI snapshot' || miss 'stable UI snapshot'
grep -q 'llama_harness_reset_abort' core/harness/llama_harness.c && ok 'explicit abort reset' || miss 'explicit abort reset'
grep -q 'versionCode 2111' android/app/build.gradle && ok 'versionCode 2111' || miss 'versionCode'

exit "$fail"
