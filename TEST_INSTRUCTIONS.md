# Athuex v2.11.7 — Test Instructions (Galaxy A06 + Termux / QuickEdit)

## What this release adds (v2.11.7)

1. **Toolbar (52px)**  
   - Left: ☰ opens Chat History drawer; brand **Athuex**.  
   - Right: live token speed (`X.X t/s · N tok`) while generating, or status / Ready; ⚙ opens Settings.

2. **Chat bubbles**  
   - User: right-aligned, panel background, 3px green left border.  
   - Assistant: left-aligned, darker bubble, 3px blue left border; Copy / Retry under finished replies.  
   - Streaming: blinking green cursor at the end of the stream while the worker is active.

3. **Composer (liquid-glass)**  
   - Auto-growing multiline (“Ask Anything”).  
   - Left: **+** attach (placeholder status), **INT/EXT/HYB** route pill (cycles), **Think** pill.  
   - Right: mic toggle, circular **Submit** (green arrow when text present) or **Stop** (red square during generation).

4. **Settings popup**  
   - Model dropdown (scanned GGUFs), Browse GGUF…, Threads (1–4), Context (1024–4096).

5. **History drawer**  
   - New chat clears stream + composer; session list is placeholder for a later phase.

## Regression (must still pass from v2.11.5)

0. **Typing stress**: type fast continuous characters; each char appears without waiting for the next key. 300–500 characters, backspace/retype, paste, emoji/accents — no dropped/duplicated characters, no long UI stall.
1. Generation starts and streams tokens; Stop cancels.
2. Model pick via Settings → Browse or dropdown after scan.
3. No crash on surface destroy / activity pause.

## Build

```bash
bash scripts/verify_tree.sh
bash build_athuex.sh
# Install the produced APK on Galaxy A06 and run the checks above.
```

## Notes

- Attach file and full voice input are structured in the UI; backends land in a later phase.
- Markdown / syntax-highlighted code blocks with copy-on-block remain simplified (plain text + bubble actions) until a lightweight markdown pass is added.
