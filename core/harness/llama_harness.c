#include "llama_harness.h"
#include "llama.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdatomic.h>
#include <limits.h>

/* Process-lifetime backend init guard. */
static atomic_bool g_backend_inited = false;

/* KV / memory clear — API evolution (memory / kv_self / kv_cache). */
static void athuex_ctx_memory_clear(struct llama_context *ctx) {
    if (!ctx) return;
#if defined(ATHUEX_LLAMA_MEMORY)
    llama_memory_clear(llama_get_memory(ctx), true);
#elif defined(ATHUEX_LLAMA_KV_SELF)
    llama_kv_self_clear(ctx);
#elif defined(ATHUEX_LLAMA_KV_CACHE)
    llama_kv_cache_clear(ctx);
#else
    llama_memory_clear(llama_get_memory(ctx), true);
#endif
}

struct llama_harness {
    struct llama_model       *model;
    struct llama_context     *ctx;
    const struct llama_vocab *vocab;
    int n_threads;
    int n_ctx;
    atomic_bool abort;
    atomic_bool busy;
};

llama_harness *llama_harness_create(const llama_harness_opts *o) {
    if (!o || !o->model_path || !o->model_path[0]) return NULL;

    bool expected = false;
    if (atomic_compare_exchange_strong(&g_backend_inited, &expected, true)) {
        llama_backend_init();
    }

    struct llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    /* Current llama.cpp: mmap via load_mode (use_mmap/use_mlock removed). */
    mp.load_mode = LLAMA_LOAD_MODE_MMAP;

    struct llama_model *model = llama_model_load_from_file(o->model_path, mp);
    if (!model) return NULL;

    struct llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = o->n_ctx           >= 2048 ? (uint32_t)o->n_ctx : 2048u;
    cp.n_batch         = o->n_batch         > 0 ? (uint32_t)o->n_batch : 256u;  /* P01: lower peak RSS */
    cp.n_threads       = o->n_threads       > 0 ? o->n_threads       : 4;
    int batch_th = o->n_threads_batch > 0 ? o->n_threads_batch : cp.n_threads;
    if (batch_th > cp.n_threads) batch_th = cp.n_threads;
    cp.n_threads_batch = batch_th;
#if defined(LLAMA_FLASH_ATTN_TYPE_AUTO)
    cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO;
#endif

    struct llama_context *ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        llama_model_free(model);
        return NULL;
    }

    /* Re-apply threads in case defaults ignored n_threads in params. */
    llama_set_n_threads(ctx, cp.n_threads, cp.n_threads_batch);

    llama_harness *h = (llama_harness *)calloc(1, sizeof(*h));
    if (!h) {
        llama_free(ctx);
        llama_model_free(model);
        return NULL;
    }
    h->model     = model;
    h->ctx       = ctx;
    h->vocab     = llama_model_get_vocab(model);
    h->n_threads = cp.n_threads;
    h->n_ctx     = (int)cp.n_ctx;
    atomic_store(&h->abort, false);
    atomic_store(&h->busy, false);
    return h;
}

void llama_harness_destroy(llama_harness *h) {
    if (!h) return;
    atomic_store(&h->abort, true);
    if (h->ctx) {
        llama_free(h->ctx);
        h->ctx = NULL;
    }
    if (h->model) {
        llama_model_free(h->model);
        h->model = NULL;
    }
    free(h);
}

bool llama_harness_is_ready(const llama_harness *h) {
    return h && h->ctx && h->model && h->vocab;
}

static struct llama_sampler *make_sampler(const struct llama_vocab *vocab,
                                          float temp, float top_p, int top_k,
                                          float rp) {
    struct llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    struct llama_sampler *chain = llama_sampler_chain_init(sp);
    if (!chain) return NULL;

    if (rp > 1.001f) {
        int32_t n_vocab = vocab ? (int32_t)llama_vocab_n_tokens(vocab) : 0;
        llama_sampler_chain_add(chain,
            llama_sampler_init_penalties(n_vocab, 64, rp, 0.0f, 0.0f));
    }
    if (top_k > 0)
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(top_k));
    if (top_p > 0.0f && top_p < 1.0f)
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(top_p, 1));
    if (temp <= 0.0f)
        llama_sampler_chain_add(chain, llama_sampler_init_greedy());
    else {
        llama_sampler_chain_add(chain, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(chain, llama_sampler_init_dist(0));
    }
    return chain;
}

int llama_harness_generate(llama_harness *h, const char *prompt,
                           float temp, float top_p, int top_k, float rp,
                           int max_tokens, llama_tok_cb cb,
                           llama_done_cb done_cb, void *user) {
    if (!h || !h->ctx || !h->vocab || !prompt) return -1;
    bool expected = false;
    if (!atomic_compare_exchange_strong(&h->busy, &expected, true)) return -2;
    if (max_tokens < 1) max_tokens = 1;

    size_t plen = strlen(prompt);
    if (plen > (size_t)INT_MAX - 128) {
        atomic_store(&h->busy, false);
        return -1;
    }

    int n_max = (int)plen + 128;
    llama_token *toks = (llama_token *)malloc(sizeof(llama_token) * (size_t)n_max);
    if (!toks) {
        atomic_store(&h->busy, false);
        return -1;
    }

    int n_tok = llama_tokenize(h->vocab, prompt, (int)plen, toks, n_max, true, true);
    if (n_tok < 0) {
        /* Negative = required size; retry once with exact size. */
        int need = -n_tok;
        free(toks);
        if (need <= 0 || need > h->n_ctx) {
            atomic_store(&h->busy, false);
            return -1;
        }
        toks = (llama_token *)malloc(sizeof(llama_token) * (size_t)need);
        if (!toks) {
            atomic_store(&h->busy, false);
            return -1;
        }
        n_tok = llama_tokenize(h->vocab, prompt, (int)plen, toks, need, true, true);
        if (n_tok < 0) {
            free(toks);
            atomic_store(&h->busy, false);
            return -1;
        }
    }

    if (n_tok + max_tokens > h->n_ctx - 8) {
        free(toks);
        atomic_store(&h->busy, false);
        return -3;
    }

    athuex_ctx_memory_clear(h->ctx);

    /* Ensure thread count on every generate (cheap, prevents drift). */
    llama_set_n_threads(h->ctx, h->n_threads, h->n_threads);

    struct llama_batch batch = llama_batch_get_one(toks, n_tok);
    if (llama_decode(h->ctx, batch) != 0) {
        free(toks);
        atomic_store(&h->busy, false);
        return -1;
    }
    free(toks);
    toks = NULL;

    struct llama_sampler *smpl = make_sampler(h->vocab, temp, top_p, top_k, rp);
    if (!smpl) {
        atomic_store(&h->busy, false);
        return -1;
    }

    int n_gen = 0;
    while (n_gen < max_tokens && !atomic_load(&h->abort)) {
        llama_token tok = llama_sampler_sample(smpl, h->ctx, -1);
        if (llama_vocab_is_eog(h->vocab, tok)) break;

        char piece[512];
        int nb = llama_token_to_piece(h->vocab, tok, piece, (int)sizeof(piece), 0, true);
        if (nb > 0 && cb) cb(piece, nb, user);

        struct llama_batch b = llama_batch_get_one(&tok, 1);
        if (llama_decode(h->ctx, b) != 0) break;
        n_gen++;
    }

    llama_sampler_free(smpl);
    if (done_cb) done_cb(user);
    atomic_store(&h->busy, false);
    return 0;
}

void llama_harness_abort(llama_harness *h) {
    if (h) atomic_store(&h->abort, true);
}

void llama_harness_reset_abort(llama_harness *h) {
    if (h && !atomic_load(&h->busy))
        atomic_store(&h->abort, false);
}
