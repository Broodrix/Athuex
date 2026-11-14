# DEPRECATED — do not use.
# The production native build is driven exclusively by:
#   native/imgui_app/CMakeLists.txt
# (referenced from android/app/build.gradle externalNativeBuild).
#
# This file is retained only so accidental Gradle lookups do not fail.
# It intentionally builds nothing.
cmake_minimum_required(VERSION 3.22.1)
project(athuex_legacy_placeholder C)
message(STATUS "Athuex: legacy cpp/CMakeLists.txt ignored — using native/imgui_app")
