# GitHub Repo:

`https://github.com/Broodrix/Athuex/tree/master`

# Athuex v2.11.5

Local-first AI APK (Galaxy A06).

Production UI: **Dear ImGui** (native, GLES3).  
P01: worker nice-10, mmap, OpenMP-off, cores left for UI.  
P02: Clay + pure-C99 engine fully specified; migration path prepared.

**v2.11.5 highlights**
- 3-frame render wake + `eglSwapInterval(0)` (IME cursor settles without next-keystroke lag)
- Single-line full-width hidden EditText + TextWatcher append fast-path (no 8px DynamicLayout tax)
- Generation epoch + join-before-claim retained
- Thread-safe input queue retained and hardened on buffer clear
- Version-aware `scripts/verify_tree.sh`

```bash
bash scripts/verify_tree.sh
bash build_athuex.sh
```
