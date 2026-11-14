#ifndef ATHUEX_H
#define ATHUEX_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    ATHUEX_OK       = 0,
    ATHUEX_ERR_INIT = -1,
    ATHUEX_ERR_ARG  = -2,
    ATHUEX_ERR_IO   = -3,
    ATHUEX_ERR_JS   = -4,
} athuex_status;

typedef struct athuex_config {
    const char *model_path;
    const char *nvidia_key;
    const char *nvidia_proxy;
    int         n_threads;
    int         n_ctx;
    int         ui_width;
    int         ui_height;
    const char *web_root;
    bool        headless;
} athuex_config;

typedef struct athuex_ctx athuex_ctx;

athuex_ctx *athuex_create(const athuex_config *cfg);
int         athuex_run(athuex_ctx *ctx);
void        athuex_stop(athuex_ctx *ctx);
void        athuex_destroy(athuex_ctx *ctx);

/* Token callback: void return to match llama_tok_cb / current llama.cpp */
typedef void (*athuex_tok_cb)(const char *piece, int n, void *user);

typedef struct {
    const char *model;
    const char *prompt;
    float       temperature;
    float       top_p;
    int         top_k;
    float       repeat_penalty;
    int         max_tokens;
    athuex_tok_cb on_token;
    void       *user;
} athuex_gen_req;

int  athuex_generate_local(athuex_ctx *ctx, const athuex_gen_req *req);
int  athuex_generate_cloud(athuex_ctx *ctx, const athuex_gen_req *req);
void athuex_generate_abort(athuex_ctx *ctx);

struct llama_harness;
struct nvidia_client;
struct llama_harness *athuex_local_handle(athuex_ctx *ctx);

#ifdef __cplusplus
}
#endif
#endif
