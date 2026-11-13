/* Athuex native worker — v2.11.1
 * P01 bottleneck repair: low-priority worker (nice 10), leave cores for UI,
 * mmap load, OpenMP off (CMake), bounded buffers, cooperative cancel.
 * Background generation + token ring + capped file history.
 * UI wake throttled (~15 fps) so EGL is never flooded per token.
 */
#include "llama_worker.h"
#include "llama_harness.h"

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <dirent.h>
#include <errno.h>
#include <sched.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <android/log.h>

#define LOG_TAG "AthuexWorker"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

extern void request_render(void);

namespace {

std::mutex               g_mu;
std::mutex               g_harness_mu;
std::mutex               g_control_mu;
std::mutex               g_models_mu;
std::string              g_pending;
std::string              g_display;
std::thread              g_thread;
std::atomic<bool>        g_active{false};
std::atomic<bool>        g_cancel{false};
llama_harness           *g_harness = nullptr;
std::string              g_loaded_model;
std::vector<std::string> g_models;
std::string              g_history_path; /* set from storage dir */
std::string              g_last_error;
std::atomic<int>         g_token_count{0};
std::atomic<long long>   g_gen_start_ms{0};

/* Hard caps for 4 GB devices — never exceed. */
static constexpr size_t kMaxDisplayChars = 256 * 1024;   /* 256 KiB chat buffer */
static constexpr size_t kMaxHistoryBytes = 1024 * 1024;  /* 1 MiB history file */
static constexpr size_t kMaxPendingChars = 256 * 1024;    /* bounded pending output */

/**
 * P01: leave at least 2 cores for the (nice 0) UI / IME / render thread.
 * Cap at 4 for thermal headroom on Helio G85 / A06 class.
 */
static int choose_threads(int requested) {
  long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
  if (ncpu < 1) ncpu = 4;
  int leave = 2;
  int max_use = (int)ncpu - leave;
  if (max_use < 2) max_use = 2;
  if (max_use > 4) max_use = 4;
  int t = (requested > 0) ? requested : max_use;
  if (t < 2) t = 2;
  if (t > max_use) t = max_use;
  return t;
}

static int clamp_ctx(int c) {
  if (c < 2048) return 2048; /* product minimum */
  if (c > 4096) return 4096; /* hard cap on 4 GB class */
  return c;
}

/**
 * P01 critical: worker must run below the UI thread so the kernel always
 * prefers the render / IME path. nice 10 + SCHED_BATCH (best-effort).
 */
static void set_worker_priority(void) {
  pid_t tid = (pid_t)syscall(SYS_gettid);
  if (setpriority(PRIO_PROCESS, tid, 10) < 0) {
    LOGE("setpriority(nice=10) failed: errno=%d", errno);
  } else {
    LOGI("worker tid=%d set to nice=10", (int)tid);
  }
  /* SCHED_BATCH: throughput-oriented, yields to interactive threads.
   * Many Android kernels ignore this for non-root; failure is non-fatal. */
  struct sched_param sp = {};
  sp.sched_priority = 0;
  if (sched_setscheduler(tid, SCHED_BATCH, &sp) < 0) {
    LOGI("SCHED_BATCH not permitted (ok on most ROMs): errno=%d", errno);
  }
}

/** Truncate display from the front if over budget (keeps newest content). */
static void trim_display_locked() {
  if (g_display.size() <= kMaxDisplayChars) return;
  /* Prefer cutting at a newline boundary to avoid mid-token garbage. */
  size_t excess = g_display.size() - kMaxDisplayChars;
  size_t cut = g_display.find('\n', excess);
  if (cut == std::string::npos || cut > excess + 4096)
    cut = excess;
  else
    cut += 1;
  g_display.erase(0, cut);
  g_display.insert(0, "[…history truncated…]\n");
}

void push_token(const char *piece, int n, void * /*user*/) {
  if (!piece || n <= 0) return;
  {
    std::lock_guard<std::mutex> lock(g_mu);
    const size_t count = static_cast<size_t>(n);
    if (count >= kMaxPendingChars) {
      g_pending.assign(piece + (count - kMaxPendingChars), kMaxPendingChars);
    } else {
      if (g_pending.size() + count > kMaxPendingChars) {
        const size_t excess = g_pending.size() + count - kMaxPendingChars;
        g_pending.erase(0, excess);
      }
      g_pending.append(piece, count);
    }
  }
  g_token_count.fetch_add(1, std::memory_order_relaxed);
  /* Time-based UI throttle (~15 fps max) — never wake EGL every token. */
  static auto s_last_ui = std::chrono::steady_clock::time_point{};
  auto now = std::chrono::steady_clock::now();
  if (s_last_ui.time_since_epoch().count() == 0 ||
      std::chrono::duration_cast<std::chrono::milliseconds>(now - s_last_ui).count() >= 66) {
    s_last_ui = now;
    request_render();
  }
}

bool ensure_harness(const std::string &model, int threads, int n_ctx) {
  {
    std::lock_guard<std::mutex> lock(g_harness_mu);
    if (g_harness && g_loaded_model == model) return true;
    if (g_harness) {
      llama_harness_destroy(g_harness);
      g_harness = nullptr;
      g_loaded_model.clear();
    }
  }
  int th = choose_threads(threads);
  int cx = clamp_ctx(n_ctx);

  llama_harness_opts opts{};
  opts.model_path      = model.c_str();
  opts.n_ctx           = cx;
  opts.n_threads       = th;
  opts.n_threads_batch = th; /* never > compute threads */
  opts.n_batch         = 256; /* smaller batch reduces peak RSS on 4 GB */
  llama_harness *created = llama_harness_create(&opts);
  if (!created) {
    LOGE("llama_harness_create failed: %s", model.c_str());
    std::lock_guard<std::mutex> lock(g_mu);
    g_last_error = "llama_harness_create failed (mmap load)";
    return false;
  }
  {
    std::lock_guard<std::mutex> lock(g_harness_mu);
    g_harness = created;
    g_loaded_model = model;
  }
  LOGI("model loaded: %s (ctx=%d threads=%d batch=%d mmap) [P01 path]",
       model.c_str(), cx, th, opts.n_batch);
  return true;
}

void append_history_file(const std::string &role, const std::string &text) {
  if (text.empty()) return;
  std::string history_path;
  {
    std::lock_guard<std::mutex> lock(g_models_mu);
    history_path = g_history_path;
  }
  if (history_path.empty()) return;

  /* Simple size gate: if over limit, truncate file (keep newest by rewrite). */
  struct stat st{};
  if (stat(history_path.c_str(), &st) == 0 && (size_t)st.st_size > kMaxHistoryBytes) {
    FILE *f = fopen(history_path.c_str(), "w");
    if (f) {
      fputs("# Athuex history (rotated — older entries discarded)\n\n", f);
      fclose(f);
    }
  }

  FILE *f = fopen(history_path.c_str(), "a");
  if (!f) return;
  fprintf(f, "### %s\n%s\n\n", role.c_str(), text.c_str());
  fclose(f);
}

void run_gen(std::string model, std::string prompt, int threads, int n_ctx) {
  /* P01: drop priority before any heavy work so UI stays responsive. */
  set_worker_priority();

  g_token_count.store(0, std::memory_order_relaxed);
  const auto start_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
  g_gen_start_ms.store(start_ms, std::memory_order_release);
  { std::lock_guard<std::mutex> lock(g_mu); g_last_error.clear(); }
  {
    std::lock_guard<std::mutex> lock(g_mu);
    g_pending.clear();
    if (g_display.capacity() < 4096) g_display.reserve(8192);
    if (!g_display.empty() && g_display.back() != '\n') g_display += '\n';
    /* Show only the user-visible part of instruct-wrapped prompts */
    std::string shown = prompt;
    const std::string marker = "### Instruction:\n";
    auto pos = shown.find(marker);
    if (pos != std::string::npos) {
      shown = shown.substr(pos + marker.size());
      auto end = shown.find("\n\n### Response:");
      if (end != std::string::npos) shown = shown.substr(0, end);
    }
    g_display += "You: " + shown + "\nAthuex: ";
    trim_display_locked();
  }
  append_history_file("user", prompt);
  request_render();

  if (g_cancel.load()) {
    g_active = false;
    request_render();
    return;
  }

  if (!ensure_harness(model, threads, n_ctx)) {
    {
      std::lock_guard<std::mutex> lock(g_mu);
      g_display += "[error] failed to load model\n";
      if (g_last_error.empty()) g_last_error = "failed to load model";
      trim_display_locked();
    }
    g_active = false;
    request_render();
    return;
  }

  if (g_cancel.load()) {
    g_active = false;
    request_render();
    return;
  }

  /* Capture generated text for history (bounded). */
  std::string generated;
  generated.reserve(4096);
  auto capture_tok = [](const char *piece, int n, void *user) {
    auto *out = static_cast<std::string *>(user);
    if (piece && n > 0) {
      if (out->size() < 64 * 1024) /* cap capture too */
        out->append(piece, static_cast<size_t>(n));
    }
    push_token(piece, n, nullptr);
  };

  llama_harness *harness = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_harness_mu);
    harness = g_harness;
    if (harness) llama_harness_reset_abort(harness);
  }
  if (g_cancel.load()) {
    g_active = false;
    request_render();
    return;
  }
  int rc = harness ? llama_harness_generate(
      harness, prompt.c_str(),
      0.7f, 0.9f, 40, 1.05f, 512,
      capture_tok, nullptr, &generated) : -1;

  if (rc != 0) {
    LOGE("llama_harness_generate returned %d", rc);
    std::lock_guard<std::mutex> lock(g_mu);
    if (rc == -3)
      g_display += "\n[error] prompt too long for context\n";
    else
      g_display += "\n[error] generation failed\n";
    trim_display_locked();
  } else {
    append_history_file("assistant", generated);
  }
  g_active = false;
  request_render();
}

} // namespace

void athuex_worker_start(const char *model_path, const char *prompt,
                         int threads, int n_ctx) {
  if (!model_path || !prompt || !prompt[0]) return;
  /* Validate before claiming the worker slot; rejected requests must not wedge UI. */
  if (std::char_traits<char>::length(prompt) > 12000) {
    LOGE("prompt too long (>%d chars) — refuse", 12000);
    {
      std::lock_guard<std::mutex> lock(g_mu);
      g_display += "\n[error] prompt too long (max 12000 chars)\n";
      trim_display_locked();
    }
    request_render();
    return;
  }
  {
    std::lock_guard<std::mutex> control_lock(g_control_mu);
    bool expected = false;
    if (!g_active.compare_exchange_strong(expected, true)) {
      LOGE("generation already active — refuse new start");
      return;
    }
    g_cancel.store(false);
  }

  /* Join any finished previous worker so we never leak threads. */
  if (g_thread.joinable()) {
    g_thread.join();
  }

  try {
    g_thread = std::thread(run_gen, std::string(model_path), std::string(prompt),
                           threads, n_ctx);
  } catch (const std::exception &e) {
    g_active.store(false);
    LOGE("failed to start worker: %s", e.what());
    std::lock_guard<std::mutex> lock(g_mu);
    g_last_error = "failed to start generation thread";
  } catch (...) {
    g_active.store(false);
    LOGE("failed to start worker (unknown error)");
    std::lock_guard<std::mutex> lock(g_mu);
    g_last_error = "failed to start generation thread";
  }
}

void athuex_worker_stop(void) {
  {
    std::lock_guard<std::mutex> control_lock(g_control_mu);
    g_cancel.store(true);
  }
  std::lock_guard<std::mutex> harness_lock(g_harness_mu);
  if (g_harness) llama_harness_abort(g_harness);
}

int athuex_worker_is_active(void) {
  return g_active.load() ? 1 : 0;
}

const char *athuex_worker_sync_text(void) {
  static thread_local std::string snapshot;
  std::lock_guard<std::mutex> lock(g_mu);
  if (!g_pending.empty()) {
    g_display.append(g_pending);
    g_pending.clear();
    trim_display_locked();
  }
  snapshot = g_display;
  return snapshot.c_str();
}

void athuex_worker_clear_text(void) {
  std::lock_guard<std::mutex> lock(g_mu);
  g_pending.clear();
  g_display.clear();
}

void athuex_worker_shutdown(void) {
  athuex_worker_stop();
  if (g_thread.joinable()) g_thread.join();
  {
    std::lock_guard<std::mutex> lock(g_harness_mu);
    if (g_harness) {
      llama_harness_destroy(g_harness);
      g_harness = nullptr;
    }
    g_loaded_model.clear();
  }
  {
    std::lock_guard<std::mutex> lock(g_mu);
    g_pending.clear();
    g_display.clear();
  }
}

void athuex_worker_scan_models(const char *dir_path) {
  if (!dir_path || !dir_path[0]) return;

  /* Build off-lock, then atomically publish a complete model list. */
  const std::string history_path = std::string(dir_path) + "/athuex_history.md";

  DIR *d = opendir(dir_path);
  if (!d) {
    LOGE("opendir failed: %s", dir_path);
    return;
  }
  struct dirent *ent;
  std::vector<std::string> preferred;
  std::vector<std::string> other;
  while ((ent = readdir(d)) != nullptr) {
    std::string name = ent->d_name;
    if (name.size() < 6) continue;
    /* Reject path traversal / absolute names from readdir (defensive). */
    if (name.find("..") != std::string::npos || name.find('/') != std::string::npos)
      continue;
    std::string lower = name;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return (char)tolower(c); });
    if (lower.size() < 5 || lower.compare(lower.size() - 5, 5, ".gguf") != 0)
      continue;
    std::string full = std::string(dir_path) + "/" + name;
    struct stat st{};
    if (stat(full.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) continue;
    if (lower.find("q4_k_m") != std::string::npos)
      preferred.push_back(full);
    else
      other.push_back(full);
  }
  closedir(d);
  /* Prefer Q4_K_M first (documented best quant for 4 GB). */
  std::vector<std::string> discovered = preferred;
  discovered.insert(discovered.end(), other.begin(), other.end());
  {
    std::lock_guard<std::mutex> lock(g_models_mu);
    g_history_path = history_path;
    g_models.swap(discovered);
  }
  LOGI("scanned %zu models in %s (%zu Q4_K_M preferred)",
       preferred.size() + other.size(), dir_path, preferred.size());
}

int athuex_worker_model_count(void) {
  std::lock_guard<std::mutex> lock(g_models_mu);
  return static_cast<int>(g_models.size());
}

const char *athuex_worker_model_at(int index) {
  static thread_local std::string snapshot;
  std::lock_guard<std::mutex> lock(g_models_mu);
  if (index < 0 || index >= static_cast<int>(g_models.size())) return nullptr;
  snapshot = g_models[static_cast<size_t>(index)];
  return snapshot.c_str();
}

const char *athuex_worker_last_error(void) {
  /* Never expose a pointer into a string concurrently mutated by the worker. */
  static thread_local std::string snapshot;
  std::lock_guard<std::mutex> lock(g_mu);
  snapshot = g_last_error;
  return snapshot.c_str();
}

int athuex_worker_token_count(void) {
  return g_token_count.load(std::memory_order_relaxed);
}

int athuex_worker_elapsed_ms(void) {
  const long long started = g_gen_start_ms.load(std::memory_order_acquire);
  if (started <= 0) return 0;
  const long long now = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
  const long long elapsed = now - started;
  if (elapsed <= 0) return 0;
  if (elapsed > 3600000) return 3600000;
  return static_cast<int>(elapsed);
}
