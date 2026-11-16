## 2.11.9 (2026-11-16)

- **Build fix:** Implemented missing `resolveReadablePath(Uri)` in `MainActivity.kt` (was referenced but undefined → Kotlin compile failure). Full SAF path resolution for Preserve Space (file://, DocumentsContract primary/SD, Downloads raw, MediaStore `_data`).
- **Version bump:** 2.11.9 / versionCode 2119. Workflow + all version strings updated.
- Retains full 2.11.8 feature set (Preserve Space UI, vector icons, mobile scroll, multi-panel workspace).

## 2.11.8 (2026-11-16)

- **Preserve Space (model load):** Settings → Local/GGUF offers **Run (no copy)** (default) vs **Import + Run**. Run resolves a readable path without duplicating the GGUF when the provider allows; Import always copies into the app models directory.
- **Vector icons:** `native/shared/athuex_icons.h` — Menu, Settings, SendUp, Stop, Mic, Waveform, Attach, etc. drawn with ImDrawList (no emoji font / tofu boxes on Galaxy A06).
- **App icon texture:** transparent PNG embedded via `athuex_icon_data.h` + stb_image; shown in toolbar and empty-chat hero.
- **Mobile scroll:** fixed `MTechnoMobileScroll.hpp` — direct `win->Scroll.y`, deadzone without jump, InvisibleButton chips, zero per-frame string churn, `Reset()` on tab change.
- **Multi-panel workspace:** Chat / Files / IDE / Live / Browser / Tools / Programs navbar; tabbed Settings (Local, Sampling, Cloud); drawer links to About + Adapters.
- Version **2.11.8** / versionCode **2118**. Workflow included.

## 2.11.7 (2026-11-15)

- **CI compile fix:** replace non-public `ImMin` with portable min expressions in drawer/settings layout (ImMin lives in imgui_internal.h and is not available with public imgui.h only).
- **Warning cleanup:** remove unused `bg` variable in bubble draw path (`-Wextra` clean).
- All v2.11.6 UI work retained (toolbar, bubbles, streaming cursor, liquid-glass composer, drawer, settings).
- Version **2.11.7** / versionCode **2117**.
- `.github/workflows/build-apk.yml` shipped in the zip.

## 2.11.6 (2026-11-15)

- **Industry-standard Chat UI (native ImGui):**
  - **Top toolbar (52px):** hamburger toggles history drawer, brand **Athuex**, live token speed / status, settings gear.
  - **Message bubbles:** user right-aligned (`--panel2` + 3px accent green border); assistant left-aligned (`#1c2128` + 3px blue border); Copy / Retry action row on assistant messages.
  - **Streaming cursor:** blinking green block while generation is active.
  - **History drawer:** slide-over panel with New chat + session placeholder.
  - **Settings popup:** model combo, Browse GGUF, Threads / Context sliders.
  - **Liquid-glass chatbar:** auto-growing multiline input, Attach (+), AI Route pill (INT / EXT / HYB), Think toggle pill, circular mic, circular green Submit / red Stop.
- Previous latency stack retained (3-frame wake, `eglSwapInterval(0)`, single-line MATCH_PARENT EditText, TextWatcher append fast-path, generation epoch, thread-safe input queue).
- Version **2.11.6** / versionCode **2116**.

## 2.11.5 (2026-11-14)

- **Keyboard latency (P08):** render-on-demand now schedules **3 frames** per wake so ImGui InputTextMultiline can settle cursor, scroll and WantTextInput without waiting for the next keystroke.
- **Non-blocking swap:** `eglSwapInterval(display, 0)` after `eglMakeCurrent` — removes 16–33 ms VSync stalls on Mali-G52 (Galaxy A06) when waking from idle.
- **IME EditText:** single-line + `MATCH_PARENT` width + horizontal scroll; eliminates DynamicLayout wrapping of the full prompt into an 8 px column on every character.
- **TextWatcher fast path:** pure append at end of buffer uses `subSequence` only (no full `toString()` / full-string diff) for ~95% of typing.
- Compiler path already forces **-O3** on ImGui + llama/ggml (verified); arm64-v8a only.
- **Packaging:** ship `.github/workflows/build-apk.yml` in the release zip (was omitted by a `*.git*` exclude). Workflow triggers on both `main` and `master`.
- Version **2.11.5** / versionCode **2115**.

## 2.11.4 (2026-11-14)

- **IME latency repair:** added batched text-delta JNI bridge. A text edit now acquires the native queue mutex once and wakes rendering once instead of doing so for every UTF-16 code unit.
- **Input correctness:** removed overlapping DEL/ENTER key-listener injection; the EditText text watcher is the single source of truth. UTF-16 surrogate pairs are converted into Unicode code points before entering ImGui.
- **Keyboard recovery:** added an asynchronous soft-keyboard retry and removed `toggleSoftInput`, which could accidentally close the keyboard after a failed first request.
- **Thread safety:** prompt clearing requested from the Android UI thread is now applied on the ImGui render thread. Fixed a JNI string pointer being logged after `ReleaseStringUTFChars`.
- Build reliability: Termux script reads `versionName` from Gradle rather than historical version strings; CI push trigger matches the configured `master` branch.
- Version **2.11.4** / versionCode **2114**.

## 2.11.3 (2026-11-14)

- **Generation epoch (lifecycle hardening):** each `athuex_worker_start` claims a monotonic epoch under the control mutex. Finishing runs only clear `g_active` if they still own that epoch — a late-finishing previous generation can no longer wipe a newly claimed slot.
- **Join-before-claim:** the previous worker thread is joined *before* the new generation is admitted. Removes the race window where `run_gen` ended with `g_active = false` after the next start had already set it true.
- **Input queue on buffer clear:** `nativeClearInputBuffer` also drains pending key edges via `athuex_input_clear_composer()`, so queued backspaces cannot resurrect text after Send/hide.
- **Tree hygiene:** `scripts/verify_tree.sh` is version-aware (reads `versionName` / `versionCode` from Gradle) and asserts the input module, generation epoch, and frame-stable snapshot.
- Version **2.11.3** / versionCode **2113**.

## 2.11.2 (2026-11-14)

- **Post-first-generation instability repaired**: ImGuiIO is no longer mutated from the Java UI thread. All touch and soft-keyboard events are enqueued; only the render thread drains them via `athuex_input_drain()` before `NewFrame`. This eliminates the classic race that appeared after the first model load (memory pressure + concurrent IO access).
- **Text-input lag on delete/retype repaired**: same queue path + bounded edge buffer (384) + overflow logging. Composer is explicitly cleared on generation start so the transparent EditText and `g_PromptBuf` stay aligned; no more backspace floods from desync.
- **Frame-stable display snapshot**: `athuex_worker_sync_text()` returns a pointer that is stable for the entire UI frame (`athuex_worker_ui_frame_begin()`), preventing mid-frame string reallocation while the UI is reading tokens.
- **Input module**: new `athuex_input.h` / `athuex_input.cpp` (POSIX-style single path, zero per-frame alloc after warmup).
- **clearComposer()**: Kotlin bridge method so native can reset the IME buffer without hiding the keyboard when appropriate.
- Version **2.11.2** / versionCode **2112**.

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
