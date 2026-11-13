#!/usr/bin/env python3
# Athuex v2.11.2 patch program — anchor-verified, idempotent, dry-run by default.
# Usage: python3 scripts/patch_v2112.py          (report only)
#        python3 scripts/patch_v2112.py --apply  (write, with .bak_v2111 backups)
import os, re, sys, shutil, datetime

ROOT = os.getcwd()
APPLY = "--apply" in sys.argv
MARK = "/*v2.11.2*/"
KMARK = "//v2.11.2"
FILES = {}   # path -> new content (staged)
REPORT = []

def log(s): REPORT.append(s); print(s)
def die(s): print("FATAL: " + s); print("No files written."); sys.exit(2)

def load(p):
    if p in FILES: return FILES[p]
    fp = os.path.join(ROOT, p)
    if not os.path.isfile(fp): die("missing file: " + p)
    return open(fp, encoding="utf-8").read()

def stage(p, s): FILES[p] = s

def save_all():
    for p, s in FILES.items():
        fp = os.path.join(ROOT, p)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        if os.path.isfile(fp) and not os.path.isfile(fp + ".bak_v2111"):
            shutil.copy2(fp, fp + ".bak_v2111")
        open(fp, "w", encoding="utf-8").write(s)
    log("Wrote %d files (backups: *.bak_v2111)" % len(FILES))

def need(cond, msg):
    if not cond: die(msg)

def sub_once(s, pat, repl, label, flags=0):
    m = list(re.finditer(pat, s, flags))
    need(len(m) == 1, "%s: expected 1 match, got %d" % (label, len(m)))
    return s[:m[0].start()] + repl + s[m[0].end():]

def brace_end(s, i):
    # i = index of '{'; returns index just past matching '}'
    depth = 0; j = i
    while j < len(s):
        c = s[j]
        if c == '/' and j+1 < len(s) and s[j+1] == '/':
            j = s.find('\n', j);  j = len(s) if j < 0 else j; continue
        if c == '/' and j+1 < len(s) and s[j+1] == '*':
            j = s.find('*/', j+2); need(j >= 0, "unterminated comment"); j += 2; continue
        if c in '"\'':
            q = c; j += 1
            while j < len(s) and s[j] != q:
                j += 2 if s[j] == '\\' else 1
            j += 1; continue
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return j + 1
        j += 1
    die("unbalanced braces")

# ---------------------------------------------------------------- new module
INPUT_H = r'''/* Athuex input module — v2.11.2
 * Single thread-safe path: producers (touch/JNI, main thread) enqueue;
 * only the render thread touches ImGuiIO via athuex_input_drain().
 * Zero per-frame allocation after warmup. */
#pragma once
#include <stdint.h>
struct AInputEvent;
struct _JNIEnv; typedef struct _JNIEnv JNIEnv;
struct _jobject; typedef struct _jobject* jobject;
#ifdef __cplusplus
extern "C" {
#endif
void athuex_input_set_wake(void (*fn)(void));
void athuex_input_drain(void);                 /* render thread, before NewFrame */
int  athuex_input_handle_motion(const AInputEvent* e); /* main thread */
void athuex_input_bridge_init(JNIEnv* env, jobject activity);
void athuex_input_bridge_shutdown(void);
void athuex_input_clear_composer(void);        /* any thread */
#ifdef __cplusplus
}
#endif
'''

INPUT_CPP = r'''/* Athuex input module — v2.11.2. See header. */
#include "athuex_input.h"
#include <jni.h>
#include <android/input.h>
#include <android/log.h>
#include <atomic>
#include <mutex>
#include <string>
#include <cfloat>
#include "imgui.h"

#define ILOG(...) __android_log_print(ANDROID_LOG_INFO, "AthuexInput", __VA_ARGS__)
#define IERR(...) __android_log_print(ANDROID_LOG_ERROR, "AthuexInput", __VA_ARGS__)

namespace {
struct Edge { uint8_t kind; uint8_t down; int32_t code; float x, y; uint8_t pos; };
enum { E_BTN = 0, E_KEY = 1 };
constexpr int EDGE_CAP = 256;

std::mutex g_m;
Edge g_edges[EDGE_CAP]; int g_en = 0;
float g_hx = -FLT_MAX, g_hy = -FLT_MAX; bool g_hover = false;
bool g_btn_down = false;
std::u16string g_pending; bool g_text_dirty = false;
void (*g_wake)(void) = nullptr;
std::atomic<uint32_t> g_over{0};

JavaVM* g_vm = nullptr; jobject g_act = nullptr; jmethodID g_clear = nullptr;

void push_edge(const Edge& e) {           /* g_m held */
    if (g_en >= EDGE_CAP) { g_over.fetch_add(1, std::memory_order_relaxed); return; }
    g_edges[g_en++] = e;
}
void wake() { void (*f)(void) = g_wake; if (f) f(); }

void key_seq(ImGuiIO& io, ImGuiKey k) {
    io.AddKeyEvent(k, true); io.AddKeyEvent(k, false);
}
} // namespace

extern "C" void athuex_input_set_wake(void (*fn)(void)) { g_wake = fn; }

extern "C" int athuex_input_handle_motion(const AInputEvent* e) {
    if (AInputEvent_getType(e) != AINPUT_EVENT_TYPE_MOTION) return 0;
    const int32_t a = AMotionEvent_getAction(e);
    const int32_t act = a & AMOTION_EVENT_ACTION_MASK;
    const int32_t idx = (a & AMOTION_EVENT_ACTION_POINTER_INDEX_MASK)
                        >> AMOTION_EVENT_ACTION_POINTER_INDEX_SHIFT;
    const float x = AMotionEvent_getX(e, 0), y = AMotionEvent_getY(e, 0);
    std::lock_guard<std::mutex> lk(g_m);
    switch (act) {
    case AMOTION_EVENT_ACTION_DOWN:
        if (g_btn_down) push_edge({E_BTN, 0, 0, x, y, 1}); /* heal missed UP */
        g_btn_down = true;
        push_edge({E_BTN, 1, 0, x, y, 1});
        break;
    case AMOTION_EVENT_ACTION_POINTER_DOWN:
        break; /* secondary fingers ignored */
    case AMOTION_EVENT_ACTION_MOVE:
        g_hx = x; g_hy = y; g_hover = true;
        break;
    case AMOTION_EVENT_ACTION_UP:
    case AMOTION_EVENT_ACTION_POINTER_UP:
        if (act == AMOTION_EVENT_ACTION_POINTER_UP && idx != 0) break;
        if (g_btn_down) push_edge({E_BTN, 0, 0, x, y, 1});
        g_btn_down = false;
        break;
    case AMOTION_EVENT_ACTION_CANCEL:
    case AMOTION_EVENT_ACTION_OUTSIDE:
        if (g_btn_down) push_edge({E_BTN, 0, 0, x, y, 1});
        g_btn_down = false;
        g_hx = -FLT_MAX; g_hy = -FLT_MAX; g_hover = true;
        ILOG("touch CANCEL -> button released");
        break;
    default: break;
    }
    lk.~lock_guard(); /* wake outside lock */
    wake();
    return 1;
}

extern "C" void athuex_input_drain(void) {
    static Edge local[EDGE_CAP];
    static std::u16string text, applied;
    int n = 0; bool hover = false; float hx = 0, hy = 0; bool got_text = false;
    {
        std::lock_guard<std::mutex> lk(g_m);
        n = g_en; for (int i = 0; i < n; ++i) local[i] = g_edges[i]; g_en = 0;
        hover = g_hover; hx = g_hx; hy = g_hy; g_hover = false;
        if (g_text_dirty) { text.swap(g_pending); g_text_dirty = false; got_text = true; }
    }
    uint32_t over = g_over.exchange(0, std::memory_order_relaxed);
    if (over) IERR("edge overflow: %u events dropped", over);

    ImGuiIO& io = ImGui::GetIO();
    for (int i = 0; i < n; ++i) {
        const Edge& e = local[i];
        if (e.pos) { io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
                     io.AddMousePosEvent(e.x, e.y); }
        if (e.kind == E_BTN) io.AddMouseButtonEvent(e.code, e.down != 0);
        else io.AddKeyEvent((ImGuiKey)e.code, e.down != 0);
    }
    if (hover) { io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
                 io.AddMousePosEvent(hx, hy); }

    if (got_text) {
        size_t p = 0; const size_t mn = applied.size() < text.size() ? applied.size() : text.size();
        while (p < mn && applied[p] == text[p]) ++p;
        if (p > 0 && p < text.size() && p < applied.size() &&
            applied[p-1] >= 0xD800 && applied[p-1] <= 0xDBFF) --p; /* keep surrogate pair */
        const size_t del = applied.size() - p;
        if (del) {
            io.AddKeyEvent(ImGuiKey_LeftCtrl, true);
            key_seq(io, ImGuiKey_End);
            io.AddKeyEvent(ImGuiKey_LeftCtrl, false);
            for (size_t i = 0; i < del; ++i) key_seq(io, ImGuiKey_Backspace);
        }
        for (size_t i = p; i < text.size(); ++i)
            io.AddInputCharacterUTF16((ImWchar16)text[i]);
        applied = text;
        if (del || text.size() != p) ILOG("text resync: -%zu +%zu", del, text.size() - p);
    }
}

/* ---- JNI: called on Android main thread; enqueue only, never touch IO ---- */
extern "C" JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeSetText(JNIEnv* env, jobject, jstring s) {
    if (!s) return;
    const jchar* c = env->GetStringChars(s, nullptr); if (!c) return;
    const jsize n = env->GetStringLength(s);
    { std::lock_guard<std::mutex> lk(g_m);
      g_pending.assign((const char16_t*)c, (size_t)n); g_text_dirty = true; }
    env->ReleaseStringChars(s, c);
    wake();
}
extern "C" JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeInjectKey(JNIEnv*, jobject, jint keycode) {
    ImGuiKey k = ImGuiKey_None;
    switch (keycode) {
    case 66: k = ImGuiKey_Enter; break;      /* ENTER */
    case 67: k = ImGuiKey_Backspace; break;  /* DEL */
    case 112: k = ImGuiKey_Delete; break;
    case 21: k = ImGuiKey_LeftArrow; break;
    case 22: k = ImGuiKey_RightArrow; break;
    default: return;
    }
    { std::lock_guard<std::mutex> lk(g_m);
      push_edge({E_KEY, 1, (int32_t)k, 0, 0, 0});
      push_edge({E_KEY, 0, (int32_t)k, 0, 0, 0}); }
    wake();
}

/* ---- composer clear bridge (native -> Kotlin, posted to UI thread) ---- */
extern "C" void athuex_input_bridge_init(JNIEnv* env, jobject activity) {
    env->GetJavaVM(&g_vm);
    if (g_act) env->DeleteGlobalRef(g_act);
    g_act = env->NewGlobalRef(activity);
    jclass c = env->GetObjectClass(activity);
    g_clear = env->GetMethodID(c, "clearComposer", "()V");
    if (env->ExceptionCheck()) { env->ExceptionClear(); g_clear = nullptr;
        IERR("clearComposer() not found — composer resync disabled"); }
    env->DeleteLocalRef(c);
    ILOG("bridge ready");
}
extern "C" void athuex_input_bridge_shutdown(void) {
    if (g_vm && g_act) {
        JNIEnv* env = nullptr;
        if (g_vm->GetEnv((void**)&env, JNI_VERSION_1_6) == JNI_OK && env)
            env->DeleteGlobalRef(g_act);
    }
    g_act = nullptr; g_clear = nullptr;
}
extern "C" void athuex_input_clear_composer(void) {
    { std::lock_guard<std::mutex> lk(g_m);
      g_pending.clear(); g_text_dirty = true; } /* render thread resets applied */
    if (!g_vm || !g_act || !g_clear) return;
    JNIEnv* env = nullptr; bool att = false;
    jint r = g_vm->GetEnv((void**)&env, JNI_VERSION_1_6);
    if (r == JNI_EDETACHED) {
        if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
        att = true;
    } else if (r != JNI_OK) return;
    env->CallVoidMethod(g_act, g_clear);
    if (env->ExceptionCheck()) env->ExceptionClear();
    if (att) g_vm->DetachCurrentThread();
}
'''