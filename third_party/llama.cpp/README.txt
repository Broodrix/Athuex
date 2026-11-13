llama.cpp is NOT vendored in git (size / churn).

CI (.github/workflows/build-apk.yml) shallow-clones:
  https://github.com/ggml-org/llama.cpp.git
into this directory before the Android NDK build.

Local Termux / desktop:
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git third_party/llama.cpp

Required files after clone:
  include/llama.h
  CMakeLists.txt
