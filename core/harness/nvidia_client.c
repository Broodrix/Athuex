#include "nvidia_client.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdatomic.h>

#if defined(ATHUEX_NO_CURL) || defined(ANDROID)

/* Android / no-libcurl build: cloud harness is a no-op stub.
 * Local GGUF path is the production mobile path. */

struct nvidia_client {
    char *api_key;
    atomic_bool abort;
};

nvidia_client *nvidia_create(const char *api_key, const char *proxy_url) {
    (void)proxy_url;
    if (!api_key || !api_key[0]) return NULL;
    nvidia_client *c = calloc(1, sizeof(*c));
    if (!c) return NULL;
    c->api_key = strdup(api_key);
    if (!c->api_key) { free(c); return NULL; }
    atomic_store(&c->abort, false);
    return c;
}

void nvidia_destroy(nvidia_client *c) {
    if (!c) return;
    free(c->api_key);
    free(c);
}

int nvidia_stream(nvidia_client *c, const char *model, const char *prompt,
                  float temperature, float top_p, int max_tokens,
                  llama_tok_cb cb, llama_done_cb done_cb, void *user) {
    (void)c; (void)model; (void)prompt;
    (void)temperature; (void)top_p; (void)max_tokens; (void)cb;
    if (done_cb) done_cb(user);
    return -1; /* cloud unavailable in this build */
}

void nvidia_abort(nvidia_client *c) {
    if (c) atomic_store(&c->abort, true);
}

#else
/* Full libcurl implementation (Termux / desktop) */
#include "nvidia_client.h"
#include <curl/curl.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdatomic.h>
#include <ctype.h>

#define NVIDIA_ENDPOINT "https://integrate.api.nvidia.com/v1/chat/completions"
#define LINE_CAP 8192
#define EMIT_CAP 2048

struct nvidia_client {
    char *api_key;
    char *proxy_url;
    CURL *curl;
    atomic_bool abort;
};

/* Process-lifetime curl init (matches llama backend policy). */
static atomic_bool g_curl_inited = false;

typedef struct {
    nvidia_client *client;
    llama_tok_cb   cb;
    llama_done_cb  done_cb;
    void          *user;
    char           emit[EMIT_CAP];
    int            emit_len;
    char           line[LINE_CAP];
    int            line_len;
    int            done_sent;
} stream_ctx;

static void flush_emit(stream_ctx *s) {
    if (s->emit_len > 0 && s->cb) {
        s->cb(s->emit, s->emit_len, s->user);
        s->emit_len = 0;
    }
}

static void append_emit(stream_ctx *s, char ch) {
    if (s->emit_len >= EMIT_CAP - 1) flush_emit(s);
    if (s->emit_len < EMIT_CAP - 1) s->emit[s->emit_len++] = ch;
}

/* Extract "content":"..." value from a single JSON object line (SSE data). */
static void emit_delta(stream_ctx *s, const char *json_line) {
    const char *p = strstr(json_line, "\"content\":\"");
    if (!p) {
        /* Also accept "content": null or missing — nothing to emit. */
        return;
    }
    p += 11;
    while (*p && *p != '"') {
        char ch = *p++;
        if (ch == '\\' && *p) {
            char e = *p++;
            switch (e) {
                case 'n': ch = '\n'; break;
                case 't': ch = '\t'; break;
                case 'r': ch = '\r'; break;
                case '"': ch = '"';  break;
                case '\\': ch = '\\'; break;
                case '/': ch = '/';  break;
                case 'u': {
                    /* Basic \uXXXX → UTF-8 (BMP only). */
                    char hex[5] = {0};
                    if (p[0] && p[1] && p[2] && p[3]) {
                        hex[0] = p[0]; hex[1] = p[1]; hex[2] = p[2]; hex[3] = p[3];
                        p += 4;
                        long cp = strtol(hex, NULL, 16);
                        if (cp < 0x80) {
                            append_emit(s, (char)cp);
                        } else if (cp < 0x800) {
                            append_emit(s, (char)(0xC0 | (cp >> 6)));
                            append_emit(s, (char)(0x80 | (cp & 0x3F)));
                        } else {
                            append_emit(s, (char)(0xE0 | (cp >> 12)));
                            append_emit(s, (char)(0x80 | ((cp >> 6) & 0x3F)));
                            append_emit(s, (char)(0x80 | (cp & 0x3F)));
                        }
                    }
                    continue;
                }
                default: ch = e; break;
            }
        }
        append_emit(s, ch);
    }
    flush_emit(s);
}

static void process_line(stream_ctx *s, const char *line) {
    /* Trim trailing CR */
    size_t n = strlen(line);
    while (n > 0 && (line[n - 1] == '\r' || line[n - 1] == '\n')) n--;
    if (n == 0) return;

    if (n >= 6 && strncmp(line, "data: ", 6) == 0) {
        const char *data = line + 6;
        if (strcmp(data, "[DONE]") == 0) {
            flush_emit(s);
            if (!s->done_sent && s->done_cb) {
                s->done_cb(s->user);
                s->done_sent = 1;
            }
        } else {
            emit_delta(s, data);
        }
    }
}

/* Line-buffered, re-entrant safe across curl write chunks. */
static size_t on_chunk(char *ptr, size_t size, size_t nmemb, void *ud) {
    stream_ctx *s = (stream_ctx *)ud;
    size_t total = size * nmemb;
    if (atomic_load(&s->client->abort)) return 0; /* abort transfer */

    for (size_t i = 0; i < total; i++) {
        char ch = ptr[i];
        if (ch == '\n') {
            s->line[s->line_len] = '\0';
            process_line(s, s->line);
            s->line_len = 0;
        } else if (s->line_len < LINE_CAP - 1) {
            s->line[s->line_len++] = ch;
        }
        /* else: drop overflow bytes of a pathological long line */
    }
    return total;
}

static int progress_abort(void *p, curl_off_t a, curl_off_t b, curl_off_t c, curl_off_t d) {
    (void)a; (void)b; (void)c; (void)d;
    return atomic_load(&((nvidia_client *)p)->abort) ? 1 : 0;
}

nvidia_client *nvidia_create(const char *api_key, const char *proxy_url) {
    if (!api_key || !api_key[0]) return NULL;

    bool expected = false;
    if (atomic_compare_exchange_strong(&g_curl_inited, &expected, true)) {
        curl_global_init(CURL_GLOBAL_DEFAULT);
    }

    nvidia_client *c = calloc(1, sizeof(*c));
    if (!c) return NULL;
    c->api_key = strdup(api_key);
    if (!c->api_key) { free(c); return NULL; }
    c->proxy_url = proxy_url ? strdup(proxy_url) : NULL;
    c->curl = curl_easy_init();
    if (!c->curl) {
        free(c->api_key);
        free(c->proxy_url);
        free(c);
        return NULL;
    }
    atomic_store(&c->abort, false);
    return c;
}

void nvidia_destroy(nvidia_client *c) {
    if (!c) return;
    if (c->curl) curl_easy_cleanup(c->curl);
    free(c->api_key);
    free(c->proxy_url);
    free(c);
    /* Do NOT call curl_global_cleanup here — process lifetime. */
}

static char *json_escape(const char *s) {
    if (!s) return NULL;
    size_t cap = strlen(s) * 6 + 1;
    char *out = malloc(cap);
    if (!out) return NULL;
    size_t j = 0;
    for (size_t i = 0; s[i]; i++) {
        unsigned char ch = (unsigned char)s[i];
        switch (ch) {
            case '"':  out[j++] = '\\'; out[j++] = '"';  break;
            case '\\': out[j++] = '\\'; out[j++] = '\\'; break;
            case '\n': out[j++] = '\\'; out[j++] = 'n';  break;
            case '\r': out[j++] = '\\'; out[j++] = 'r';  break;
            case '\t': out[j++] = '\\'; out[j++] = 't';  break;
            default:
                if (ch < 0x20)
                    j += (size_t)snprintf(out + j, cap - j, "\\u%04x", ch);
                else
                    out[j++] = (char)ch;
        }
    }
    out[j] = 0;
    return out;
}

int nvidia_stream(nvidia_client *c, const char *model, const char *prompt,
                  float temperature, float top_p, int max_tokens,
                  llama_tok_cb cb, llama_done_cb done_cb, void *user) {
    if (!c || !prompt) return -1;

    char *escaped = json_escape(prompt);
    if (!escaped) return -1;

    char *body = NULL;
    if (asprintf(&body,
        "{\"model\":\"%s\",\"messages\":[{\"role\":\"user\",\"content\":\"%s\"}],"
        "\"temperature\":%.2f,\"top_p\":%.2f,\"max_tokens\":%d,\"stream\":true}",
        model ? model : "meta/llama-3.3-70b-instruct",
        escaped, temperature, top_p, max_tokens) < 0) {
        free(escaped);
        return -1;
    }
    free(escaped);

    char url[512];
    if (c->proxy_url && c->proxy_url[0])
        snprintf(url, sizeof(url), "%s?url=%s", c->proxy_url, NVIDIA_ENDPOINT);
    else
        snprintf(url, sizeof(url), "%s", NVIDIA_ENDPOINT);

    struct curl_slist *hdr = NULL;
    hdr = curl_slist_append(hdr, "Content-Type: application/json");
    hdr = curl_slist_append(hdr, "Accept: text/event-stream");
    char auth[320];
    snprintf(auth, sizeof(auth), "Authorization: Bearer %s", c->api_key);
    hdr = curl_slist_append(hdr, auth);

    stream_ctx s;
    memset(&s, 0, sizeof(s));
    s.client   = c;
    s.cb       = cb;
    s.done_cb  = done_cb;
    s.user     = user;

    /* Reset easy handle options for reuse safety. */
    curl_easy_reset(c->curl);
    curl_easy_setopt(c->curl, CURLOPT_URL, url);
    curl_easy_setopt(c->curl, CURLOPT_POSTFIELDS, body);
    curl_easy_setopt(c->curl, CURLOPT_HTTPHEADER, hdr);
    curl_easy_setopt(c->curl, CURLOPT_WRITEFUNCTION, on_chunk);
    curl_easy_setopt(c->curl, CURLOPT_WRITEDATA, &s);
    curl_easy_setopt(c->curl, CURLOPT_XFERINFOFUNCTION, progress_abort);
    curl_easy_setopt(c->curl, CURLOPT_XFERINFODATA, c);
    curl_easy_setopt(c->curl, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(c->curl, CURLOPT_TIMEOUT, 300L);
    curl_easy_setopt(c->curl, CURLOPT_FOLLOWLOCATION, 1L);

    atomic_store(&c->abort, false);
    CURLcode rc = curl_easy_perform(c->curl);

    flush_emit(&s);
    if (!s.done_sent && s.done_cb) s.done_cb(s.user);

    curl_slist_free_all(hdr);
    free(body);
    return rc == CURLE_OK ? 0 : -1;
}

void nvidia_abort(nvidia_client *c) {
    if (c) atomic_store(&c->abort, true);
}

#endif /* ATHUEX_NO_CURL / ANDROID */
