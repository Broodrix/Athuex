/* QuickJS host scaffold. Compiles against third_party/quickjs.
 * Registers athuex.generateLocal + athuex.generateCloud as JS functions.
 * DOM bridge (document.getElementById, innerRML, etc.) is NOT here —
 * that's the RmlUi integration on top. */

#include "js_host.h"
#include "harness/llama_harness.h"
#include "quickjs.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

struct athuex_js {
    JSRuntime  *rt;
    JSContext  *ctx;
    athuex_ctx *native;
};

/* Buffer used to capture tokens while the JS call is in progress */
typedef struct {
    char  *buf;
    size_t cap;
    size_t len;
} tok_acc;

static int js_tok_cb(const char *piece, int n, void *user) {
    tok_acc *a = user;
    if (a->len + n < a->cap) {
        memcpy(a->buf + a->len, piece, n);
        a->len += n;
    }
    return 0;
}

static JSValue js_generate_local(JSContext *jctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc < 1) return JS_NewString(jctx, "{\"error\":\"prompt required\"}");

    athuex_js *host = JS_GetContextOpaque(jctx);
    if (!host || !host->native) return JS_NewString(jctx, "{\"error\":\"not ready\"}");

    const char *prompt = JS_ToCString(jctx, argv[0]);
    if (!prompt) return JS_NewString(jctx, "{\"error\":\"bad prompt\"}");

    float temp = 0.6f, top_p = 0.9f, rp = 1.1f;
    int   top_k = 40, max_tokens = 256;

    if (argc >= 2 && JS_IsObject(argv[1])) {
        JSValue v;
        v = JS_GetPropertyStr(jctx, argv[1], "temperature");
        if (JS_IsNumber(v)) JS_ToFloat32(jctx, &temp, v); JS_FreeValue(jctx, v);
        v = JS_GetPropertyStr(jctx, argv[1], "top_p");
        if (JS_IsNumber(v)) JS_ToFloat32(jctx, &top_p, v); JS_FreeValue(jctx, v);
        v = JS_GetPropertyStr(jctx, argv[1], "top_k");
        if (JS_IsNumber(v)) JS_ToInt32(jctx, &top_k, v); JS_FreeValue(jctx, v);
        v = JS_GetPropertyStr(jctx, argv[1], "repeat_penalty");
        if (JS_IsNumber(v)) JS_ToFloat32(jctx, &rp, v); JS_FreeValue(jctx, v);
        v = JS_GetPropertyStr(jctx, argv[1], "max_tokens");
        if (JS_IsNumber(v)) JS_ToInt32(jctx, &max_tokens, v); JS_FreeValue(jctx, v);
    }

    tok_acc acc = { .cap = 64 * 1024 };
    acc.buf = calloc(acc.cap, 1);

    athuex_gen_req req = {
        .prompt = prompt, .temperature = temp, .top_p = top_p,
        .top_k = top_k, .repeat_penalty = rp, .max_tokens = max_tokens,
        .on_token = js_tok_cb, .user = &acc,
    };
    athuex_generate_local(host->native, &req);

    JSValue ret = JS_NewString(jctx, acc.buf ? acc.buf : "");
    free(acc.buf);
    JS_FreeCString(jctx, prompt);
    return ret;
}

athuex_js *athuex_js_create(athuex_ctx *native) {
    athuex_js *h = calloc(1, sizeof(*h));
    h->native = native;
    h->rt  = JS_NewRuntime();
    if (!h->rt) { free(h); return NULL; }
    h->ctx = JS_NewContext(h->rt);
    if (!h->ctx) { JS_FreeRuntime(h->rt); free(h); return NULL; }
    JS_SetContextOpaque(h->ctx, h);

    /* Register athuex namespace */
    JSValue global = JS_GetGlobalObject(h->ctx);
    JSValue ns = JS_NewObject(h->ctx);
    JS_SetPropertyStr(h->ctx, ns, "generateLocal",
        JS_NewCFunction(h->ctx, js_generate_local, "generateLocal", 2));
    JS_SetPropertyStr(h->ctx, global, "athuex", ns);
    JS_FreeValue(h->ctx, global);
    return h;
}

int athuex_js_eval(athuex_js *h, const char *src, const char *filename) {
    if (!h) return -1;
    JSValue r = JS_Eval(h->ctx, src, strlen(src), filename ? filename : "<eval>",
                        JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) {
        JSValue e = JS_GetException(h->ctx);
        const char *msg = JS_ToCString(h->ctx, e);
        fprintf(stderr, "[js] %s: %s\n", filename, msg ? msg : "(no msg)");
        JS_FreeCString(h->ctx, msg);
        JS_FreeValue(h->ctx, e);
        JS_FreeValue(h->ctx, r);
        return -1;
    }
    JS_FreeValue(h->ctx, r);
    return 0;
}

int athuex_js_eval_file(athuex_js *h, const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "[js] cannot open %s\n", path); return -1; }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc(n + 1);
    fread(buf, 1, n, f);
    buf[n] = 0;
    fclose(f);
    int rc = athuex_js_eval(h, buf, path);
    free(buf);
    return rc;
}

void athuex_js_destroy(athuex_js *h) {
    if (!h) return;
    if (h->ctx) JS_FreeContext(h->ctx);
    if (h->rt)  JS_FreeRuntime(h->rt);
    free(h);
}