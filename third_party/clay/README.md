# Clay (future UI engine)

Athuex v2.11.0 prepares the Clay + pure-C99 + GLES3 path described in
`docs/P02_clay_ui_complete.txt`.

**Production UI for this release remains Dear ImGui** (native/imgui_app).

To activate Clay later:
1. Vendor the official single-header: https://github.com/nicbarker/clay
   → place `clay.h` here.
2. Add stb_truetype.h / stb_image.h (or reuse existing).
3. Implement the files listed in P02 under a new CMake target.
4. Switch android/app/build.gradle externalNativeBuild path when the
   Clay target is CI-green and device-tested on Galaxy A06.

Do not enable Clay until the full zero-leak, zero-per-frame-alloc
engine is validated. The P01 priority / mmap work must stay intact.
