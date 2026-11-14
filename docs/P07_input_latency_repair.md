# P07 — Android IME latency and reliability repair (v2.11.4)

## Confirmed source defects addressed

1. `MainActivity.forwardTextDelta()` previously called JNI once per deleted UTF-16 unit and once per inserted unit. Each native call separately locked the queue and notified the render condition variable. This amplified IME composition/autocorrect/paste edits into many wakeups.
2. The `TextWatcher` and `OnKeyListener` both forwarded DEL/ENTER. On IMEs that deliver both text changes and key events, one physical edit could be applied twice.
3. The old prefix diff worked on UTF-16 code units and could split a surrogate pair (emoji/non-BMP characters).
4. `showKeyboard()` used `toggleSoftInput()` after a failed show request. Toggle is stateful and can dismiss the keyboard rather than recover it. It also had no delayed retry after focus settled.
5. `nativeClearInputBuffer()` wrote `g_PromptBuf` from the Android UI thread even though ImGui reads/writes it on the render thread. The clear now uses an atomic request consumed on the render thread.
6. Model-picker logging used a JNI string pointer after `ReleaseStringUTFChars`; the path is now copied before release.

## Implementation

- A single JNI `nativeInjectTextDelta(deleteCount, suffix)` transfers an edit as a batch.
- The native queue applies the complete delta under one lock and requests one render wake.
- UTF-16 surrogate pairs are decoded to Unicode code points before calling ImGui input APIs.
- The `TextWatcher` is the sole edit-forwarding path.
- Keyboard show requests use a delayed idempotent retry; no toggle operation is used.
- Composer clearing is render-thread-owned.

## Verification performed in this workspace

- `bash scripts/verify_tree.sh` — pass.
- `node --check` for all project JavaScript files outside vendored `third_party` — pass.
- Source review of JNI declaration/name/signature alignment and queue locking — performed.
- `bash -n` for project shell scripts, JSON parsing for project JSON files, and XML parsing — pass.
- Build workflow branch and Termux release-version detection aligned with the project's configured `master` branch and Gradle `versionName`.

## Device/build verification still required

This environment does not have the Android SDK/NDK, Gradle executable/wrapper, or vendored llama.cpp source needed to build the APK here. Therefore no APK build, Android/Kotlin compilation, runtime profiling, memory-sanitizer run, or Samsung Galaxy A06 test is claimed. The supplied report that v2.11.5 built successfully is user-reported baseline evidence; this ZIP is based on the attached v2.11.3 source tree, not the unavailable v2.11.5 source tree.

## Galaxy A06 acceptance matrix

1. Tap composer from a cold launch and after dismissing the keyboard repeatedly; confirm the keyboard opens each time.
2. Type 300–500 characters, backspace repeatedly, retype, select/replace a word, and paste a paragraph.
3. Test spaces, line breaks, accented characters, and emoji; verify there are no duplicated/dropped characters or malformed symbols.
4. Send, verify the prompt clears, and immediately focus the composer again.
5. Repeat while generation is active and after Stop; ensure input stays responsive and generation state remains correct.
6. Background/restore the app, then repeat keyboard open/close and typing tests.
7. Capture `adb logcat -s Athuex AthuexInput AthuexWorker` if any failure occurs.
