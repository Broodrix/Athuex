cmake_minimum_required(VERSION 3.20)
project(athuex C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(LLAMA_DIR   ${CMAKE_SOURCE_DIR}/../third_party/llama.cpp)
set(QUICKJS_DIR ${CMAKE_SOURCE_DIR}/../third_party/quickjs)

add_library(athuex_core STATIC
    athuex.c
    harness/llama_harness.c
    harness/nvidia_client.c
)

target_include_directories(athuex_core PUBLIC
    ${CMAKE_SOURCE_DIR}
    ${LLAMA_DIR}/include
    ${LLAMA_DIR}/ggml/include
)

target_compile_options(athuex_core PRIVATE
    -O3 -march=armv8-a+dotprod+fp16 -flto -ffast-math
    -fomit-frame-pointer -pthread -Wall -Wextra
)

target_link_directories(athuex_core PUBLIC
    ${LLAMA_DIR}/build
    ${LLAMA_DIR}/build/ggml/src
)

target_link_libraries(athuex_core PUBLIC
    llama ggml ggml-base curl pthread
)

add_executable(athuex_cli platform/termux.c)
target_link_libraries(athuex_cli PRIVATE athuex_core m)