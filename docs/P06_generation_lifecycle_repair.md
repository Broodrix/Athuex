# Athuex v2.11.1 — generation lifecycle repair

## Confirmed defects repaired

1. `athuex_worker_start()` previously claimed `g_active` before checking the 12,000-character prompt limit. An oversized prompt returned without clearing `g_active`; the UI then remained in the active/Stop state and refused later generations. Validation now occurs before the worker slot is claimed.
2. `llama_harness_generate()` previously reset its abort flag at function entry. A Stop request arriving between the worker's final preflight check and entry into generation could be overwritten. Abort reset is now explicit and occurs before the final cancellation check; generation itself never clears a concurrent abort.
3. The previous `busy` check/set was two independent atomic operations. It is now a compare/exchange admission operation.
4. The worker previously used an unsynchronized harness pointer from Stop while the worker could replace or destroy the harness. Harness pointer lifecycle and abort access now share a mutex.
5. Token queue overflow discarded the oldest pending token pieces. A bounded pending text buffer now retains the newest text without per-token vector allocations.
6. `athuex_worker_sync_text()` returned `g_display.c_str()` after releasing the mutex, allowing the worker to mutate the underlying string while ImGui read it. It now returns a thread-local snapshot.
7. Thread construction exceptions now restore the worker to idle and record an error instead of leaving the UI wedged.

## Verification boundaries

- Native worker C++ translation unit: checked with Clang C++17 `-fsyntax-only -Wall -Wextra -Werror` using a minimal Android log header stub; passed.
- JavaScript files: run `node --check` across all project `.js` files.
- Release tree checks: `bash scripts/verify_tree.sh`.
- Android APK build and runtime behavior require Android SDK/NDK, a network-fetched llama.cpp checkout, and a physical device. These were not available in this audit environment, so no APK build or on-device stability claim is made.
- No static check can prove absence of all C/C++ memory defects or leaks. Run the on-device repeated-generation and cancellation matrix in `BUILD_AND_TEST.md`.

## Repeated-generation regression matrix

- Generate 10 short prompts consecutively without restarting the app.
- Generate a long answer, wait for completion, then generate another prompt.
- Press Stop during model load, during first-token latency, and during token streaming; then generate again.
- Submit a prompt longer than 12,000 characters through a native test harness (the UI input buffer may prevent this path); verify the next valid prompt still starts.
- Switch models between completed generations and repeat.
- Background/foreground the app during generation, then verify Stop and subsequent generation.
- Confirm output is not silently truncated during a burst and that the chat remains responsive.

## Additional verified source defects repaired

8. `programs/ide/tabs.js` was a zero-byte file even though `programs/ide.js` treats the tabs module as mandatory. The IDE loader skipped the empty source and the editor therefore failed its required-module check. Implemented the missing tab module against the actual state, VFS, shell, dialog and editor interfaces already present in the archive.
9. IDE auto-save called `VFS.write(..., {silent:true})` but skipped `VFS.save()`, so the write was not persisted to localStorage. Auto-save now explicitly flushes the VFS.
10. The service-worker precache referenced three absent files (`smfs/smfs.zip`, `models/wllama.js`, `models/wllama.wasm`). These were removed from precache; the Wllama loader already has its CDN fallback.
11. Android Gradle referenced a nonexistent root `web/` assets directory despite the native ImGui Activity being the APK entry point. Removed the stale assets source-set reference.
12. The Termux build script previously wrote GitHub credentials into a remote URL, used a force push, added a global `safe.directory=*`, altered global Git identity/configuration, and overwrote `.gitignore`. It now uses GitHub CLI's credential helper, repo-local Git identity, a per-command trust exception for the current repo, idempotent ignore additions, origin validation, and a normal non-force push.
