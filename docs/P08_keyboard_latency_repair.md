# P08 — Keyboard / IME latency repair (v2.11.5)

## Root causes (Galaxy A06)

1. **Single-frame wake** — `g_RenderRequested.store(0)` after one frame; ImGui InputText needs 2–3 frames for cursor/scroll/WantTextInput.
2. **8×8 multiline EditText** — DynamicLayout wraps the full prompt into an 8 px column every keystroke.
3. **eglSwapInterval default 1** — idle→wake `eglSwapBuffers` blocks on VSync (16–33 ms).
4. **Full `s.toString()` + prefix diff** on every keystroke.

## Fixes applied

| Area | Change |
|------|--------|
| `app.cpp` `request_render` | Raise credit to **3** frames (CAS loop) |
| `app.cpp` `render_loop` | `fetch_sub(1)` instead of `store(0)` |
| `app.cpp` `init_egl` | `eglSwapInterval(g_EglDisplay, 0)` after MakeCurrent |
| `MainActivity.kt` EditText | `isSingleLine=true`, `MATCH_PARENT`×8, horizontal scroll |
| `MainActivity.kt` TextWatcher | Append-at-end fast path via `subSequence` (no full toString) |
| Build | Already `-O3` for ImGui + ggml (verified in CMakeLists) |

## Verification

```bash
bash scripts/verify_tree.sh
# APK: type rapidly in composer — characters should appear without one-key lag
```
