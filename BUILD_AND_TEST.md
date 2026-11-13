# Athuex v2.11.1 — build and verification

## Environment

- Android device target: arm64-v8a (Samsung Galaxy A06 class)
- Android Studio/CI: JDK 17, Android SDK platform 34, NDK 26.3.11579264, CMake 3.22.1
- llama.cpp is fetched by the GitHub Actions workflow; it is intentionally not vendored in this source ZIP.

## Termux build trigger

From the extracted project root:

```bash
bash scripts/verify_tree.sh
bash build_athuex.sh
```

The build script authenticates with GitHub CLI and pushes to the configured repository. Review the target repository/branch before running it; it currently targets `Broodrix/Athuex` on `master`. It validates `origin` and uses a normal non-force push.

## Local checks

```bash
bash scripts/verify_tree.sh
find . -type f -name '*.js' -print0 | while IFS= read -r -d '' f; do
  node --check "$f" || exit 1
done
```

Native worker syntax check (Android NDK build remains the authoritative compile):

```bash
clang++ -std=c++17 -fsyntax-only -Wall -Wextra -Werror \
  -I"$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include" \
  -Icore/harness -Inative/imgui_app/src native/imgui_app/src/llama_worker.cpp
```

The local command above also needs the Android NDK sysroot's `android/log.h`; on non-Android hosts use the test stub approach described in `docs/P06_generation_lifecycle_repair.md`.

## CI / APK

- GitHub Actions workflow: `.github/workflows/build-apk.yml`
- Expected artifact: `athuex-v2.11.1-debug.apk`
- ABI: `arm64-v8a`
- versionName: `2.11.1`
- versionCode: `2111`

Build the APK in CI and install it on the device. This source ZIP is not itself an APK.

## IDE regression tests\n\n1. Open the IDE and confirm it loads all modules without a missing-module warning.\n2. Open two files, edit both, switch between tabs, and confirm each editor buffer is retained.\n3. Enable auto-save, edit a file, wait longer than 1.2 seconds, close/reopen the app, and confirm the edit persisted.\n4. Save As to a new path, overwrite a file only after confirmation, and verify the VFS tree.\n5. Create/close scratch tabs, close dirty tabs with both Save and Discard, and verify the correct tab becomes active.\n\n## Device regression tests

1. Generate 10 short prompts consecutively without restarting the app.
2. Generate a long answer, wait for completion, then generate another prompt.
3. Press Stop during model load, first-token latency, and active streaming. After each stop, send another prompt.
4. Submit an over-12,000-character prompt through a native test harness, then send a valid prompt; the worker must not remain stuck.
5. Switch between two installed GGUF models between generations.
6. Background and foreground the app during generation; verify Stop and the next generation.
7. Watch Logcat for `AthuexWorker`; confirm no crash, abort deadlock, or repeated worker creation.
8. Repeat the matrix after a clean app restart and after Android reclaims the app in the background.

## What is not claimed

A clean APK build, zero runtime leaks, complete memory-safety proof, model-quality improvement, and Galaxy A06 runtime stability cannot be established by source inspection alone. The previous APK v2.11.0 build success and the supplied screenshot are accepted as user-reported baseline evidence, not as verification of v2.11.1.
