#include <jni.h>
#include <android/log.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "athuex.h"

#define TAG "AthuexJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static athuex_ctx *g_ctx = NULL;

typedef struct {
    char  *buf;
    size_t cap;
    size_t len;
} cap_ctx;

/* Growable capture buffer — starts small, doubles as needed (industry pattern). */
static int cap_ensure(cap_ctx *c, size_t need) {
    if (!c) return -1;
    if (c->len + need + 1 <= c->cap) return 0;
    size_t ncap = c->cap ? c->cap : 4096;
    while (ncap < c->len + need + 1) {
        if (ncap > (SIZE_MAX / 2)) return -1;
        ncap *= 2;
    }
    /* Hard ceiling 4 MiB — protects 4 GB devices. */
    if (ncap > 4 * 1024 * 1024) ncap = 4 * 1024 * 1024;
    if (c->len + need + 1 > ncap) return -1;
    char *nb = (char *)realloc(c->buf, ncap);
    if (!nb) return -1;
    c->buf = nb;
    c->cap = ncap;
    return 0;
}

static void cap_tok(const char *piece, int n, void *user) {
    cap_ctx *c = (cap_ctx *)user;
    if (!c || !piece || n <= 0) return;
    if (cap_ensure(c, (size_t)n) != 0) return;
    memcpy(c->buf + c->len, piece, (size_t)n);
    c->len += (size_t)n;
    c->buf[c->len] = '\0';
}

static void clear_exc(JNIEnv *env) {
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionDescribe(env);
        (*env)->ExceptionClear(env);
    }
}

JNIEXPORT jboolean JNICALL
Java_com_athuex_MainActivity_nativeInit(JNIEnv *env, jobject thiz,
                                        jstring model_path, jstring api_key,
                                        jstring proxy_url, jstring web_root) {
    (void)thiz;
    const char *mp = model_path ? (*env)->GetStringUTFChars(env, model_path, NULL) : NULL;
    const char *ak = api_key    ? (*env)->GetStringUTFChars(env, api_key, NULL)    : NULL;
    const char *px = proxy_url  ? (*env)->GetStringUTFChars(env, proxy_url, NULL)  : NULL;
    const char *wr = web_root   ? (*env)->GetStringUTFChars(env, web_root, NULL)   : NULL;
    clear_exc(env);

    athuex_config cfg = {
        .model_path = mp, .nvidia_key = ak, .nvidia_proxy = px, .web_root = wr,
        .headless = true, .n_threads = 2, .n_ctx = 1536,
    };
    g_ctx = athuex_create(&cfg);

    if (mp) (*env)->ReleaseStringUTFChars(env, model_path, mp);
    if (ak) (*env)->ReleaseStringUTFChars(env, api_key, ak);
    if (px) (*env)->ReleaseStringUTFChars(env, proxy_url, px);
    if (wr) (*env)->ReleaseStringUTFChars(env, web_root, wr);
    clear_exc(env);

    LOGI("init: %s", g_ctx ? "ok" : "failed");
    return g_ctx ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_athuex_MainActivity_nativeGenerateLocal(JNIEnv *env, jobject thiz, jstring prompt) {
    (void)thiz;
    if (!g_ctx) return (*env)->NewStringUTF(env, "{\"error\":\"not initialized\"}");

    const char *p = (*env)->GetStringUTFChars(env, prompt, NULL);
    if (!p) return (*env)->NewStringUTF(env, "{\"error\":\"null prompt\"}");

    cap_ctx cc = { .buf = NULL, .cap = 0, .len = 0 };
    if (cap_ensure(&cc, 4096) != 0) {
        (*env)->ReleaseStringUTFChars(env, prompt, p);
        return (*env)->NewStringUTF(env, "{\"error\":\"oom\"}");
    }

    athuex_gen_req req = {
        .prompt = p, .temperature = 0.6f, .top_p = 0.9f,
        .top_k = 40, .repeat_penalty = 1.1f, .max_tokens = 256,
        .on_token = cap_tok, .user = &cc,
    };
    int rc = athuex_generate_local(g_ctx, &req);

    (*env)->ReleaseStringUTFChars(env, prompt, p);
    clear_exc(env);

    jstring out;
    if (rc == -3) {
        out = (*env)->NewStringUTF(env, "[error] prompt too long for context");
    } else if (rc != 0) {
        out = (*env)->NewStringUTF(env, "[error] generation failed");
    } else {
        out = (*env)->NewStringUTF(env, cc.buf ? cc.buf : "");
    }
    free(cc.buf);
    clear_exc(env);
    return out;
}

JNIEXPORT void JNICALL
Java_com_athuex_MainActivity_nativeStop(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx) athuex_stop(g_ctx);
}

JNIEXPORT void JNICALL
Java_com_athuex_MainActivity_nativeDestroy(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx) {
        athuex_destroy(g_ctx);
        g_ctx = NULL;
    }
}
