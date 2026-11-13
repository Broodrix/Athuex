#include "athuex.h"
#include "harness/llama_harness.h"
#include "harness/nvidia_client.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <time.h>
#include <stdatomic.h>

struct athuex_ctx {
    athuex_config    cfg;
    llama_harness   *local;
    nvidia_client   *cloud;
    atomic_bool      stop;
};

athuex_ctx *athuex_create(const athuex_config *cfg) {
    if (!cfg) return NULL;
    athuex_ctx *c = calloc(1, sizeof(*c));
    if (!c) return NULL;
    c->cfg = *cfg;

    if (c->cfg.n_threads <= 0) {
        long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
        c->cfg.n_threads = (ncpu >= 4) ? 2 : 1;
        /* Deliberately 2 for sustained mobile — higher counts thermal-throttle A75. */
    }
    if (c->cfg.n_ctx <= 0) c->cfg.n_ctx = 2048;

    if (c->cfg.model_path && c->cfg.model_path[0]) {
        llama_harness_opts o = {
            .model_path      = c->cfg.model_path,
            .n_ctx           = c->cfg.n_ctx,
            .n_threads       = c->cfg.n_threads,
            .n_threads_batch = c->cfg.n_threads,
            .n_batch         = 256,
        };
        c->local = llama_harness_create(&o);
        if (c->local) {
            printf("[athuex] local harness ready: %s (ctx=%d, threads=%d)\n",
                   c->cfg.model_path, c->cfg.n_ctx, c->cfg.n_threads);
        } else {
            fprintf(stderr, "[athuex] failed to load %s\n", c->cfg.model_path);
        }
    }
    if (c->cfg.nvidia_key && c->cfg.nvidia_key[0]) {
        c->cloud = nvidia_create(c->cfg.nvidia_key, c->cfg.nvidia_proxy);
        if (c->cloud) printf("[athuex] cloud harness ready\n");
    }

    atomic_store(&c->stop, false);
    return c;
}

struct llama_harness *athuex_local_handle(athuex_ctx *c) {
    return c ? c->local : NULL;
}

int athuex_generate_local(athuex_ctx *c, const athuex_gen_req *r) {
    if (!c || !r) return ATHUEX_ERR_ARG;
    if (!c->local) return ATHUEX_ERR_INIT;
    return llama_harness_generate(c->local, r->prompt,
                                  r->temperature, r->top_p, r->top_k,
                                  r->repeat_penalty, r->max_tokens,
                                  r->on_token, NULL, r->user);
}

int athuex_generate_cloud(athuex_ctx *c, const athuex_gen_req *r) {
    if (!c || !r) return ATHUEX_ERR_ARG;
    if (!c->cloud) return ATHUEX_ERR_INIT;
    return nvidia_stream(c->cloud,
                         r->model ? r->model : "meta/llama-3.3-70b-instruct",
                         r->prompt, r->temperature, r->top_p, r->max_tokens,
                         r->on_token, NULL, r->user);
}

void athuex_generate_abort(athuex_ctx *c) {
    if (!c) return;
    if (c->local) llama_harness_abort(c->local);
    if (c->cloud) nvidia_abort(c->cloud);
}

int athuex_run(athuex_ctx *c) {
    if (!c) return ATHUEX_ERR_ARG;
    while (!atomic_load(&c->stop)) {
        struct timespec ts = { .tv_sec = 0, .tv_nsec = 16 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
    return ATHUEX_OK;
}

void athuex_stop(athuex_ctx *c) { if (c) atomic_store(&c->stop, true); }

void athuex_destroy(athuex_ctx *c) {
    if (!c) return;
    athuex_generate_abort(c);
    if (c->local) llama_harness_destroy(c->local);
    if (c->cloud) nvidia_destroy(c->cloud);
    free(c);
}
