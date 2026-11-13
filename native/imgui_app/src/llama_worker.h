#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Athuex worker API — v2.11.1
 * Background GGUF load + generation on a low-priority thread (nice 10).
 * UI remains responsive; cooperative cancel; bounded display/history.
 */

/** Start background generation against a local GGUF (loads model on first use). */
void athuex_worker_start(const char *model_path, const char *prompt,
                         int threads, int n_ctx);

/** Request cooperative cancel of the current generation / load. */
void athuex_worker_stop(void);

/** 1 if a generation (or load) is in progress. */
int athuex_worker_is_active(void);

/**
 * Drain pending tokens into the display buffer and return a stable C string
 * owned by the worker (valid until next sync/clear/shutdown).
 */
const char *athuex_worker_sync_text(void);

/** Clear the display buffer (e.g. new chat). */
void athuex_worker_clear_text(void);

/** Tear down worker thread and free the loaded harness. */
void athuex_worker_shutdown(void);

/** Optional: scan a directory for *.gguf paths (fills internal list). */
void athuex_worker_scan_models(const char *dir_path);

/** Number of models found by last scan. */
int athuex_worker_model_count(void);

/** Path of model at index (0-based), or NULL. */
const char *athuex_worker_model_at(int index);

/** Last error message (empty if none). Valid until next start/clear. */
const char *athuex_worker_last_error(void);

/** Approximate tokens emitted in the current or last generation. */
int athuex_worker_token_count(void);

/** Milliseconds elapsed since generation started (0 when idle). */
int athuex_worker_elapsed_ms(void);

#ifdef __cplusplus
}
#endif
