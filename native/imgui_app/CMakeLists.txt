cmake_minimum_required(VERSION 3.22.1)
project(athuex_native CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# ---------------------------------------------------------------------------
# CRITICAL PERF: Android Studio builds externalNativeBuild as Debug by default.
# Unoptimized ggml is ~10–50× slower than -O3 on ARM. Force fast flags always.
# ---------------------------------------------------------------------------
if(ANDROID)
  add_compile_definitions(ATHUEX_NO_CURL=1)
  message(STATUS "Athuex: ATHUEX_NO_CURL (NDK has no libcurl)")
  set(_ATHUEX_FAST "-O3 -DNDEBUG -fno-finite-math-only -fomit-frame-pointer -fvisibility=hidden")
  set(CMAKE_C_FLAGS             "${CMAKE_C_FLAGS} ${_ATHUEX_FAST}"             CACHE STRING "" FORCE)
  set(CMAKE_CXX_FLAGS           "${CMAKE_CXX_FLAGS} ${_ATHUEX_FAST}"           CACHE STRING "" FORCE)
  set(CMAKE_C_FLAGS_DEBUG       "${_ATHUEX_FAST} -g"                          CACHE STRING "" FORCE)
  set(CMAKE_CXX_FLAGS_DEBUG     "${_ATHUEX_FAST} -g"                          CACHE STRING "" FORCE)
  set(CMAKE_C_FLAGS_RELEASE     "${_ATHUEX_FAST}"                             CACHE STRING "" FORCE)
  set(CMAKE_CXX_FLAGS_RELEASE   "${_ATHUEX_FAST}"                             CACHE STRING "" FORCE)
  set(CMAKE_C_FLAGS_RELWITHDEBINFO "${_ATHUEX_FAST} -g"                       CACHE STRING "" FORCE)
  set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${_ATHUEX_FAST} -g"                     CACHE STRING "" FORCE)
endif()

set(ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
set(IMGUI_DIR "${ROOT}/third_party/imgui")

# ---------------------------------------------------------------------------
# llama.cpp path
# ---------------------------------------------------------------------------
set(LLAMA_DIR "${ROOT}/third_party/llama.cpp")
if(EXISTS "${ROOT}/native/llama.cpp/llama.cpp/include/llama.h")
  set(LLAMA_DIR "${ROOT}/native/llama.cpp/llama.cpp")
  message(STATUS "Athuex: llama at native/llama.cpp/llama.cpp")
elseif(EXISTS "${ROOT}/native/llama.cpp/include/llama.h")
  set(LLAMA_DIR "${ROOT}/native/llama.cpp")
  message(STATUS "Athuex: llama at native/llama.cpp")
elseif(EXISTS "${LLAMA_DIR}/llama.cpp/include/llama.h")
  set(LLAMA_DIR "${LLAMA_DIR}/llama.cpp")
  message(STATUS "Athuex: nested third_party/llama.cpp/llama.cpp")
elseif(EXISTS "${LLAMA_DIR}/include/llama.h")
  message(STATUS "Athuex: flat third_party/llama.cpp")
else()
  message(FATAL_ERROR "Athuex: llama.h not found. CI must clone ggml-org/llama.cpp into third_party/llama.cpp.")
endif()

option(ATHUEX_HAS_IMGUI "Compile Dear ImGui backends" ON)
option(ATHUEX_LLAMA_SUBDIR "add_subdirectory llama when no prebuilt .a" ON)

set(ATHUEX_NATIVE_SOURCES
  src/app.cpp
  src/llama_worker.cpp
  ${ROOT}/core/athuex.c
  ${ROOT}/core/harness/llama_harness.c
  ${ROOT}/core/harness/nvidia_client.c
  ${ROOT}/core/platform/android.c
)

if(ATHUEX_HAS_IMGUI AND EXISTS "${IMGUI_DIR}/imgui.cpp")
  message(STATUS "Athuex: ImGui enabled (v2.11.1)")
  list(APPEND ATHUEX_NATIVE_SOURCES
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_android.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
  )
  add_compile_definitions(ATHUEX_HAS_IMGUI=1 ATHUEX_VERSION=\"2.11.1\")
  add_compile_definitions(ATHUEX_NO_CURL=1)
else()
  add_compile_definitions(ATHUEX_VERSION=\"2.11.1\")
endif()

# KV API auto-detect
if(EXISTS "${LLAMA_DIR}/include/llama.h")
  file(READ "${LLAMA_DIR}/include/llama.h" _LH)
  if(_LH MATCHES "llama_memory_clear")
    add_compile_definitions(ATHUEX_LLAMA_MEMORY=1)
  elseif(_LH MATCHES "llama_kv_self_clear")
    add_compile_definitions(ATHUEX_LLAMA_KV_SELF=1)
  elseif(_LH MATCHES "llama_kv_cache_clear")
    add_compile_definitions(ATHUEX_LLAMA_KV_CACHE=1)
  else()
    add_compile_definitions(ATHUEX_LLAMA_KV_SELF=1)
  endif()
else()
  message(FATAL_ERROR "Athuex: ${LLAMA_DIR}/include/llama.h missing")
endif()

add_library(athuex_native SHARED ${ATHUEX_NATIVE_SOURCES})
if(ANDROID)
  target_compile_definitions(athuex_native PRIVATE ATHUEX_NO_CURL=1)
endif()

target_include_directories(athuex_native PRIVATE
  ${ROOT}/native/shared
  src ${ROOT}/core ${ROOT}/core/harness
  ${IMGUI_DIR} ${IMGUI_DIR}/backends
  ${LLAMA_DIR}/include ${LLAMA_DIR}/ggml/include
)

target_compile_options(athuex_native PRIVATE
  -O3 -DNDEBUG -fno-finite-math-only -fvisibility=hidden -fomit-frame-pointer -Wall -Wextra
)

find_library(log-lib log)
find_library(android-lib android)
find_library(EGL-lib EGL)
find_library(GLES-lib GLESv3)
find_library(atomic-lib atomic)

target_link_libraries(athuex_native
  ${log-lib}
  ${android-lib}
  ${EGL-lib}
  ${GLES-lib}
)
if(atomic-lib)
  target_link_libraries(athuex_native ${atomic-lib})
  message(STATUS "Athuex: linked libatomic")
else()
  message(STATUS "Athuex: libatomic not found — using compiler runtime (OK on NDK)")
endif()

# Prebuilt static libs (optional)
set(_PREBUILT_LLAMA "${LLAMA_DIR}/build-android")
file(GLOB_RECURSE _PREBUILT_LIBS
  "${_PREBUILT_LLAMA}/libllama.a"
  "${_PREBUILT_LLAMA}/**/libllama.a"
  "${_PREBUILT_LLAMA}/**/libggml*.a"
)
foreach(_cand
  "${_PREBUILT_LLAMA}/src/libllama.a"
  "${_PREBUILT_LLAMA}/ggml/src/libggml.a"
  "${_PREBUILT_LLAMA}/ggml/src/libggml-base.a"
  "${_PREBUILT_LLAMA}/ggml/src/libggml-cpu.a"
)
  if(EXISTS "${_cand}")
    list(APPEND _PREBUILT_LIBS "${_cand}")
  endif()
endforeach()
list(REMOVE_DUPLICATES _PREBUILT_LIBS)

if(_PREBUILT_LIBS)
  message(STATUS "Athuex: linking prebuilt llama static libs")
  foreach(_lib ${_PREBUILT_LIBS})
    message(STATUS "  ${_lib}")
    target_link_libraries(athuex_native ${_lib})
  endforeach()
  set(ATHUEX_LLAMA_SUBDIR OFF)
endif()

# Compile llama.cpp in-tree — MUST be optimized on Android arm64
if(ATHUEX_LLAMA_SUBDIR AND EXISTS "${LLAMA_DIR}/CMakeLists.txt")
  message(STATUS "Athuex: add_subdirectory llama (optimized ARM build)")
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
  set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
  set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
  set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
  set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
  set(GGML_BLAS OFF CACHE BOOL "" FORCE)
  set(GGML_CUDA OFF CACHE BOOL "" FORCE)
  set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
  # Helio G85 / Cortex-A75 class: ARMv8.2 + dotprod is a large win for Q4_K matmul
  if(ANDROID AND ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod" CACHE STRING "" FORCE)
    message(STATUS "Athuex: GGML_CPU_ARM_ARCH=armv8.2-a+dotprod")
  endif()
  add_subdirectory(${LLAMA_DIR} ${CMAKE_CURRENT_BINARY_DIR}/llama.cpp EXCLUDE_FROM_ALL)
  if(TARGET llama)
    target_link_libraries(athuex_native llama)
    # Belt-and-suspenders: force -O3 on llama/ggml targets even if parent is Debug
    foreach(_t llama ggml ggml-base ggml-cpu)
      if(TARGET ${_t})
        target_compile_options(${_t} PRIVATE -O3 -DNDEBUG -fno-finite-math-only -fomit-frame-pointer)
      endif()
    endforeach()
  endif()
  if(TARGET ggml)
    target_link_libraries(athuex_native ggml)
  endif()
endif()
