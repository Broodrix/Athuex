# Athuex v2.8.4 Termux CLI — reproducible static link + llama.cpp API auto-detect
# Note: Android shared storage is often noexec — install copies binary to $HOME.
LLAMA   ?= $(HOME)/llama.cpp
CC      ?= clang
ROOT    := $(realpath $(dir $(lastword $(MAKEFILE_LIST)))/..)
INSTALL_DIR ?= $(HOME)

# Auto-detect which KV/memory clear API this llama.cpp provides.
LLAMA_H := $(LLAMA)/include/llama.h
ifeq ($(shell test -f "$(LLAMA_H)" && grep -q 'llama_memory_clear' "$(LLAMA_H)" && echo yes),yes)
  API_FLAG := -DATHUEX_LLAMA_MEMORY
  API_NOTE := memory (llama_memory_clear)
else ifeq ($(shell test -f "$(LLAMA_H)" && grep -q 'llama_kv_self_clear' "$(LLAMA_H)" && echo yes),yes)
  API_FLAG := -DATHUEX_LLAMA_KV_SELF
  API_NOTE := kv_self (llama_kv_self_clear)
else ifeq ($(shell test -f "$(LLAMA_H)" && grep -q 'llama_kv_cache_clear' "$(LLAMA_H)" && echo yes),yes)
  API_FLAG := -DATHUEX_LLAMA_KV_CACHE
  API_NOTE := kv_cache (llama_kv_cache_clear)
else
  API_FLAG := -DATHUEX_LLAMA_KV_SELF
  API_NOTE := kv_self (default)
endif

CFLAGS  := -O3 -march=armv8-a+dotprod+fp16 \
           -fomit-frame-pointer -pthread -Wall -Wextra -Werror \
           -I$(ROOT)/core \
           -I$(LLAMA)/include -I$(LLAMA)/ggml/include \
           $(API_FLAG)

LDFLAGS := $(LLAMA)/build/src/libllama.a \
           $(LLAMA)/build/ggml/src/libggml.a \
           $(LLAMA)/build/ggml/src/libggml-base.a \
           $(LLAMA)/build/ggml/src/libggml-cpu.a \
           -lcurl -lstdc++ -pthread -lm

SRCS := $(ROOT)/core/athuex.c \
        $(ROOT)/core/harness/llama_harness.c \
        $(ROOT)/core/harness/nvidia_client.c \
        $(ROOT)/core/platform/termux.c

.PHONY: all run clean info install

all: info athuex_cli install

info:
	@echo "Athuex: llama clear API = $(API_NOTE)"
	@echo "  header: $(LLAMA_H)"

athuex_cli: $(SRCS)
	$(CC) $(CFLAGS) $(SRCS) -o $@ $(LDFLAGS)
	chmod +x $@

# Shared storage (/storage/emulated/0/...) is often mounted noexec on Android.
# Always install a runnable copy under $HOME.
install: athuex_cli
	cp -f athuex_cli "$(INSTALL_DIR)/athuex_cli"
	chmod +x "$(INSTALL_DIR)/athuex_cli"
	@echo "Installed: $(INSTALL_DIR)/athuex_cli"
	@echo "Run with:  $(INSTALL_DIR)/athuex_cli /path/to/model.gguf \"prompt\""

run: install
	"$(INSTALL_DIR)/athuex_cli" $(MODEL) "$(PROMPT)"

clean:
	rm -f athuex_cli
