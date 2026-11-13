## 2.11.1 (2026-11-13)

- **Generation lifecycle repair:** fixed a rejected-overlength-prompt path that could leave the worker marked active and disable further sends.
- **Cancellation race repair:** cancellation is no longer reset inside the generation function; reset occurs before generation under lifecycle synchronization, so Stop requests during startup are preserved.
- **Harness concurrency:** generation admission uses atomic compare/exchange; worker stop and harness replacement/destruction coordinate through a mutex.
- **Output stability:** replaced the token-piece vector (which discarded old tokens when full) with a bounded pending-text buffer; UI reads now receive a thread-local snapshot rather than a pointer to a string being modified by the worker.
- **Worker startup:** thread creation failures are caught and restore the idle state; prompt validation happens before claiming the worker slot.
- **IDE recovery:** restored the zero-byte `programs/ide/tabs.js` module from the interfaces required by the IDE's existing modules; added tab switching, save/auto-save, close, file creation and language-selection flows.
- **IDE persistence:** fixed auto-save to flush the VFS after writing; silent auto-save previously updated only the in-memory VFS object.
- **Packaging hygiene:** removed missing optional Wllama/SMFS files from service-worker precache and removed the nonexistent Android `web/` assets directory.
- **Build-script safety:** stopped embedding the GitHub token in the push URL, removed global `safe.directory=*` and global identity changes, and replaced force-push with a normal fast-forward push.
- Version **2.11.1** / versionCode **2111**.

## 2.11.0 (2026-11-13)

- **P02 architecture lock**: Clay + pure-C99 + GLES3 engine fully specified in `docs/P02_clay_ui_complete.txt` (theme tokens, font atlas, instanced renderer, 6-panel layout, gesture/IME, zero per-frame alloc design).
- Production path remains the proven **ImGui** native stack (v2.10.0 P01 priority + mmap + OpenMP-off). Clay is prepared as the next UI engine; no half-migrated code that could freeze the A06.
- Shared theme header extracted (`native/shared/athuex_theme.h`) so both ImGui and future Clay paths use the same ide.css tokens.
- GitHub Actions workflow kept and verified (shallow-clone llama.cpp, NDK 26, arm64-v8a).
- Version **2.11.0** / versionCode **2110**.

## 2.10.0 (2026-11-13)

- **P01 bottleneck repair (ImGui path)**: worker thread runs at **nice 10** + optional `SCHED_BATCH` so the UI (nice 0) is never starved during GGUF load or generation.
- Dynamic thread selection: `max(2, min(4, ncpu - 2))` leaves cores for the render/IME thread on 4–8 core devices (Galaxy A06 class).
- Confirmed **mmap** load path (`LLAMA_LOAD_MODE_MMAP`), **GGML_OPENMP=OFF**, no mlock, progress-aware load, cooperative cancel.
- Hardened worker lifecycle: join previous thread before start, bounded display/history, prompt length guard, clear error surface.
- GitHub Actions workflow `build-apk.yml` added (shallow-clone llama.cpp, NDK 26, arm64-v8a debug APK artifact).
- Version **2.10.0** / versionCode **2100**.

## 2.9.8 (2026-11-13)

- **Build fix**: ggml requires non-finite math. `-ffast-math` implies `-ffinite-math-only` → hard error in `ggml-cpu/vec.h`.
- Use **`-O3 -DNDEBUG -fno-finite-math-only`** (no `-ffast-math`) for native + llama/ggml.
- Speed path kept: Release CMake, ARM **dotprod**, ctx ≥ 2048, 4 threads, mmap load.
- Version **2.9.8** / versionCode **298**.

## 2.9.7

- `LLAMA_LOAD_MODE_MMAP` (use_mmap removed upstream).

## 2.9.6

- Forced -O3 on Debug APK; root cause of ~0.5 t/s.
