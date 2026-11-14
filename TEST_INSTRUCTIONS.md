# Athuex v2.11.5 — Test Instructions (Galaxy A06 + Termux / QuickEdit)

## What this release fixes (v2.11.5)
- **3-frame render wake** so ImGui InputText settles without one-keystroke lag.
- **eglSwapInterval(0)** — no VSync block on idle→wake on Galaxy A06 Mali.
- **Single-line full-width hidden EditText** — no DynamicLayout wrap of the whole prompt into 8px.
- **TextWatcher append fast-path** — pure typing avoids full `toString()` + string diff.
- Retained: batched IME JNI, generation epoch, thread-safe input queue, render-thread prompt clear.

## Build (CI or local)
```bash
# From project root
bash scripts/verify_tree.sh
bash build_athuex.sh
```
Or push and let `.github/workflows/build-apk.yml` produce the arm64-v8a APK.

## Install & smoke test on device
0. **Typing stress (v2.11.5)**: type fast continuous characters; each char should appear without waiting for the next key. Also: enter 300–500 characters, use repeated backspace/retype, paste text, include emoji and accented characters; verify no dropped or duplicated characters and no long UI stall.
0. **Keyboard recovery**: dismiss the keyboard, tap the composer repeatedly, rotate/background/restore if supported; verify keyboard reliably opens and never toggles itself closed.
1. Install the APK (debug or release).
2. Open Athuex → Browse / pick a Q4_K_M `.gguf` (or let auto-scan find one in the models folder).
3. **First generation**
   - Type a short prompt → Send.
   - Confirm tokens stream, UI stays responsive, Stop works.
4. **Second generation (critical)**
   - After the first finishes, type another prompt (delete some characters, retype).
   - Confirm: no lag on backspace/retype, no freeze, generation starts cleanly.
5. **Keyboard**
   - Focus the prompt, type, delete, paste if possible.
   - After Send the keyboard should hide; focusing the field again should show it.
6. **Stop mid-generation**
   - Start a long prompt, press Stop, then start a new one immediately.

## Expected logs (adb logcat -s AthuexApp AthuexWorker AthuexInput)
- `input bridge ready`
- `gen start` on each successful admission
- No repeated ImGui / native crash after first load

## If something fails
- Capture logcat from the moment of the second Send.
- Note whether the model was still loaded (mmap) and free RAM at the time.
