#ifndef ATHUEX_LLAMA_HARNESS_H
#define ATHUEX_LLAMA_HARNESS_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct llama_harness llama_harness;

typedef void (*llama_tok_cb)(const char *piece, int n_bytes, void *user);
typedef void (*llama_done_cb)(void *user);

typedef struct llama_harness_opts {
    const char *model_path;
    int         n_ctx;
    int         n_threads;
    int         n_threads_batch;
    int         n_batch;
} llama_harness_opts;

llama_harness *llama_harness_create(const llama_harness_opts *opts);
void           llama_harness_destroy(llama_harness *h);
int llama_harness_generate(llama_harness *h, const char *prompt,
                           float temperature, float top_p, int top_k,
                           float repeat_penalty, int max_tokens,
                           llama_tok_cb cb, llama_done_cb done_cb, void *user);
void llama_harness_abort(llama_harness *h);
void llama_harness_reset_abort(llama_harness *h);
bool llama_harness_is_ready(const llama_harness *h);

#ifdef __cplusplus
}
#endif

#endif /* ATHUEX_LLAMA_HARNESS_H */
