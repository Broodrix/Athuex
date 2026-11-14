#ifndef ATHUEX_NVIDIA_H
#define ATHUEX_NVIDIA_H

#include "llama_harness.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct nvidia_client nvidia_client;

nvidia_client *nvidia_create(const char *api_key, const char *proxy_url);
void           nvidia_destroy(nvidia_client *c);

int nvidia_stream(nvidia_client *c, const char *model, const char *prompt,
                  float temperature, float top_p, int max_tokens,
                  llama_tok_cb cb, llama_done_cb done_cb, void *user);

void nvidia_abort(nvidia_client *c);

#ifdef __cplusplus
}
#endif

#endif /* ATHUEX_NVIDIA_H */
