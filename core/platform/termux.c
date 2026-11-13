#include "athuex.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <signal.h>

static athuex_ctx *g_ctx = NULL;
static void on_sigint(int _) { (void)_; if (g_ctx) athuex_stop(g_ctx); }

static void on_token(const char *piece, int n, void *user) {
    (void)user;
    fwrite(piece, 1, n, stdout);
    fflush(stdout);
}

int main(int argc, char **argv) {
    athuex_config cfg = {
        .n_threads = 2, .n_ctx = 2048, .headless = true,
    };
    const char *prompt = NULL;
    bool use_cloud = false;

    for (int i = 1; i < argc; i++) {
        const char *a = argv[i];
        if (!strcmp(a, "--cloud")) use_cloud = true;
        else if (!strncmp(a, "--key=", 6))   cfg.nvidia_key = a + 6;
        else if (!strncmp(a, "--proxy=", 8)) cfg.nvidia_proxy = a + 8;
        else if (!strncmp(a, "--threads=", 10)) cfg.n_threads = atoi(a + 10);
        else if (!strncmp(a, "--ctx=", 6))   cfg.n_ctx = atoi(a + 6);
        else if (a[0] != '-') {
            if (!cfg.model_path) cfg.model_path = a;
            else if (!prompt) prompt = a;
        }
    }
    if (!prompt) {
        fprintf(stderr,
            "usage: %s model.gguf \"prompt\" [--threads=N --ctx=N]\n"
            "       %s --cloud --key=KEY \"prompt\" [--proxy=URL]\n",
            argv[0], argv[0]);
        return 2;
    }

    signal(SIGINT, on_sigint);
    g_ctx = athuex_create(&cfg);
    if (!g_ctx) { fprintf(stderr, "init failed\n"); return 1; }

    athuex_gen_req req = {
        .model = "meta/llama-3.3-70b-instruct",
        .prompt = prompt,
        .temperature = 0.6f, .top_p = 0.9f,
        .top_k = 40, .repeat_penalty = 1.1f, .max_tokens = 256,
        .on_token = on_token, .user = NULL,
    };

    printf("---\n");
    int rc = use_cloud ? athuex_generate_cloud(g_ctx, &req)
                       : athuex_generate_local(g_ctx, &req);
    printf("\n---\n");
    athuex_destroy(g_ctx);
    return rc == 0 ? 0 : 1;
}