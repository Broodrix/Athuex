# Athuex v2.11.9 — Test Instructions (Galaxy A06)

## Preserve Space
1. Settings → Local / GGUF → select **Run (no copy)** → Browse GGUF from Downloads.
2. Expect toast `Run (no copy): <name>` when path resolves; otherwise a one-time import fallback.
3. Switch to **Import + Run** → Browse again → file appears under app models/ and is selectable.

## Icons
1. Toolbar shows 3-line menu + Athuex logo texture + gear (vector) — no empty boxes.
2. Chatbar: attach paperclip, mic, upward send arrow / stop square are vector-drawn.

## Scroll
1. Generate a long reply (or paste history). Flick-scroll the chat; thumb appears on the right edge.
2. Drag the thumb to scrub; release should settle without lag.
3. Switch to IDE tab and back — scroll state resets cleanly.

## Panels
1. Navbar: Chat / Files / IDE / Live / Browser / Tools / Programs.
2. Files → select WELCOME.md opens IDE tab.
3. Settings tabs: Local, Sampling, Cloud.
4. Drawer: New chat, About, Adapters.

## Regression
- Fast typing still latency-free (v2.11.5 stack).
- Stop cancels generation; token speed shows during stream.
