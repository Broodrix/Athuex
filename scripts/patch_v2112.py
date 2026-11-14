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
# The motion handler above is replaced at stage-time with a scope-correct version:
INPUT_CPP = INPUT_CPP.replace(
    "    lk.~lock_guard(); /* wake outside lock */\n    wake();\n    return 1;",
    "    /* lock released by scope below */\n    wake();\n    return 1;")
# and wrap the switch in its own scope so the mutex is released before wake():
INPUT_CPP = INPUT_CPP.replace(
    "    std::lock_guard<std::mutex> lk(g_m);\n    switch (act) {",
    "    {\n    std::lock_guard<std::mutex> lk(g_m);\n    switch (act) {")
INPUT_CPP = INPUT_CPP.replace(
    "    default: break;\n    }\n    /* lock released by scope below */",
    "    default: break;\n    }\n    }\n    /* lock released by scope above */")

STUB_LOG = r'''#pragma once
#include <stdio.h>
#define ANDROID_LOG_INFO 4
#define ANDROID_LOG_ERROR 6
static inline int __android_log_print(int, const char*, const char*, ...) { return 0; }
'''
STUB_INPUT = r'''#pragma once
#include <stdint.h>
struct AInputEvent;
#define AINPUT_EVENT_TYPE_MOTION 2
#define AINPUT_EVENT_TYPE_KEY 1
#define AMOTION_EVENT_ACTION_MASK 0xff
#define AMOTION_EVENT_ACTION_DOWN 0
#define AMOTION_EVENT_ACTION_UP 1
#define AMOTION_EVENT_ACTION_MOVE 2
#define AMOTION_EVENT_ACTION_CANCEL 3
#define AMOTION_EVENT_ACTION_OUTSIDE 4
#define AMOTION_EVENT_ACTION_POINTER_DOWN 5
#define AMOTION_EVENT_ACTION_POINTER_UP 6
#define AMOTION_EVENT_ACTION_POINTER_INDEX_MASK 0xff00
#define AMOTION_EVENT_ACTION_POINTER_INDEX_SHIFT 8
#ifdef __cplusplus
extern "C" {
#endif
int32_t AInputEvent_getType(const AInputEvent*);
int32_t AMotionEvent_getAction(const AInputEvent*);
float AMotionEvent_getX(const AInputEvent*, size_t);
float AMotionEvent_getY(const AInputEvent*, size_t);
#ifdef __cplusplus
}
#endif
'''
STUB_JNI = r'''#pragma once
#include <stdint.h>
typedef int32_t jint; typedef uint16_t jchar; typedef int32_t jsize;
typedef void* jobject; typedef jobject jclass; typedef jobject jstring; typedef void* jmethodID;
#define JNI_OK 0
#define JNI_EDETACHED (-2)
#define JNI_VERSION_1_6 0x00010006
#define JNIEXPORT __attribute__((visibility("default")))
#define JNICALL
struct JNINativeInterface_; struct JNIInvokeInterface_;
typedef const struct JNINativeInterface_* JNIEnv;
typedef const struct JNIInvokeInterface_* JavaVM;
'''
# Local syntax check uses the REAL NDK jni.h when available; the stub jni.h is
# intentionally minimal and only used to satisfy -fsyntax-only on Termux.
# CI (NDK) compiles the real thing.

CHECK_SH = r'''#!/data/data/com.termux/files/usr/bin/bash
# v2.11.2 — on-device syntax verification of new native modules (Termux clang).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f third_party/imgui/imgui.h ] || { echo "vendored imgui missing"; exit 1; }
mkdir -p tests/stubs/android
CXX=${CXX:-clang++}
"$CXX" -fsyntax-only -std=c++17 -Wall -Wextra -Werror \
  -Itests/stubs -Ithird_party/imgui \
  native/imgui_app/src/athuex_input.cpp
echo "athuex_input.cpp: syntax OK"
if [ -f third_party/llama.cpp/include/llama.h ]; then
  "$CXX" -fsyntax-only -std=c++17 -Wall -Wextra \
    -Itests/stubs -Ithird_party/imgui -Icore/harness \
    -Ithird_party/llama.cpp/include -Inative/imgui_app/src \
    native/imgui_app/src/llama_worker.cpp && echo "llama_worker.cpp: syntax OK"
else
  echo "llama.cpp not cloned locally — worker syntax check runs in CI"
fi
command -v node >/dev/null && find js programs tools -name '*.js' -print0 2>/dev/null | xargs -0 -n1 node --check && echo "JS: all parse OK"
'''

CHANGELOG_ENTRY = """## 2.11.2 (2026-11-14)
- **Post-first-generation instability repaired**: frame-stable worker snapshot
  (no dangling c_str within a frame); all ImGuiIO input moved to the render
  thread via a mutex-protected input module; abort callback reset on every
  generation exit path before the active flag clears.
- **Touch repaired**: single injection path (backend no longer double-injects
  motion), ACTION_CANCEL / secondary-pointer handling, pos-before-button
  ordering, consistent TouchScreen source, event trickling disabled.
- **IME repaired**: EditText is source of truth; coalesced surrogate-safe
  resync on the render thread; composer cleared on send via JNI bridge
  (watcher-guarded); software key double-handling removed.
- Packaging: build_athuex.sh branch master->main; ProGuard keeps for JNI members.
- Version 2.11.2 / versionCode 2112 everywhere; verify_tree extended.
"""

# ---------------------------------------------------------------- patch ops
def op_new_files():
    stage("native/imgui_app/src/athuex_input.h", INPUT_H)
    stage("native/imgui_app/src/athuex_input.cpp", INPUT_CPP)
    stage("tests/stubs/android/log.h", STUB_LOG)
    stage("tests/stubs/android/input.h", STUB_INPUT)
    stage("tests/stubs/jni.h", STUB_JNI)
    stage("scripts/check_native_v2112.sh", CHECK_SH)
    log("new: input module, test stubs, native check script")

def op_precheck():
    w = load("native/imgui_app/src/llama_worker.cpp")
    c = load("native/imgui_app/CMakeLists.txt")
    checks = [
        ("worker single-flight", "compare_exchange_strong" in w),
        ("worker priority", ("set_worker_priority" in w) or ("nice=10" in w)),
        ("OpenMP off", "GGML_OPENMP OFF" in c),
        ("mmap", "LLAMA_LOAD_MODE_MMAP" in load("core/harness/llama_harness.c")),
        ("abort reset exists", "llama_harness_reset_abort" in load("core/harness/llama_harness.c")),
        ("display cap present", "g_display" in w),
    ]
    for name, ok in checks:
        log("precheck %-24s %s" % (name, "OK" if ok else "FAIL"))
        need(ok, "v2.11.1 invariant missing: " + name)

def derive_worker(w):
    cas = re.findall(r"(\w+)\.compare_exchange_strong", w)
    need(len(set(cas)) == 1, "cannot derive active flag (CAS sites: %r)" % cas)
    active = cas[0]
    disp = "g_display" if "g_display" in w else None
    need(disp, "g_display not found")
    mus = re.findall(r"lock_guard<std::mutex>\s+\w+\(\s*(\w+)\s*\)", w)
    need(mus, "no lock_guard<std::mutex> found in worker")
    mu = max(set(mus), key=mus.count)
    snap = re.search(r"const\s+char\s*\*\s*(\w+)\s*\(\s*(?:void)?\s*\)\s*\{", w)
    cands = []
    for m in re.finditer(r"const\s+char\s*\*\s*(\w+)\s*\(\s*(?:void)?\s*\)\s*\{", w):
        end = brace_end(w, m.end() - 1)
        body = w[m.end():end]
        if "thread_local" in body and "c_str" in body:
            cands.append((m.group(1), m.start(), end))
    need(len(cands) == 1, "snapshot function not uniquely identifiable: %r" % [c[0] for c in cands])
    log("derived: active=%s display=%s mutex=%s snapshot=%s" % (active, disp, mu, cands[0][0]))
    return active, disp, mu, cands[0]

def op_worker():
    p = "native/imgui_app/src/llama_worker.cpp"
    w = load(p)
    if "athuex_worker_ui_frame_begin" in w:
        log("worker: already patched"); return
    active, disp, mu, (sname, s0, s1) = derive_worker(w)
    new_snap = (
        "/*v2.11.2*/ static std::atomic<uint64_t> g_ui_frame{0};\n"
        "void athuex_worker_ui_frame_begin(void) { g_ui_frame.fetch_add(1, std::memory_order_relaxed); }\n"
        "/* Frame-stable snapshot: pointer valid for the entire UI frame. */\n"
        "const char* %s(void) {\n"
        "    thread_local std::string cache;\n"
        "    thread_local uint64_t stamp = ~0ull;\n"
        "    const uint64_t f = g_ui_frame.load(std::memory_order_relaxed);\n"
        "    std::lock_guard<std::mutex> lk(%s);\n"
        "    if (f != stamp || cache.size() != %s.size()) { cache.assign(%s); stamp = f; }\n"
        "    return cache.c_str();\n"
        "}\n" % (sname, mu, disp, disp))
    w = w[:s0] + new_snap + w[s1:]
    # reset abort + log before every active.store(false)
    pat = re.compile(r"([ \t]*)(" + re.escape(active) + r"\.store\(false)")
    out, last, n = [], 0, 0
    for m in pat.finditer(w):
        prev = w[:m.start()].rstrip().splitlines()
        if prev and "llama_harness_reset_abort" in prev[-1]:
            continue
        out.append(w[last:m.start()])
        out.append(m.group(1) + "llama_harness_reset_abort(); " + MARK + "\n" +
                   m.group(1) + '__android_log_print(ANDROID_LOG_INFO, "AthuexWorker", "gen end: abort reset");\n' +
                   m.group(1))
        last = m.start() + len(m.group(1)); n += 1
    out.append(w[last:]); w = "".join(out)
    need(n >= 1, "no %s.store(false) sites found" % active)
    log("worker: %d finalize path(s) hardened" % n)
    # composer clear + start log at CAS success path
    m = re.search(r"^.*" + re.escape(active) + r"\.compare_exchange_strong.*$", w, re.M)
    line = m.group(0)
    if re.search(r"if\s*\(\s*!", line):
        end = w.find(";", m.start()) + 1
        ins = end
    else:
        ins = w.find("{", m.start()) + 1
    hook = ('\n    athuex_input_clear_composer(); ' + MARK +
            '\n    __android_log_print(ANDROID_LOG_INFO, "AthuexWorker", "gen start");')
    w = w[:ins] + hook + w[ins:]
    w = sub_once(w, r'#include "llama_worker\.h"',
                 '#include "llama_worker.h"\n#include "athuex_input.h" ' + MARK,
                 "worker include")
    need("#include <atomic>" in w, "worker missing <atomic>")
    stage(p, w)
    h = "native/imgui_app/src/llama_worker.h"
    hs = load(h)
    hs = sub_once(hs, r"int athuex_worker_token_count\(void\);",
                  "/*v2.11.2*/ void athuex_worker_ui_frame_begin(void);\nint athuex_worker_token_count(void);",
                  "worker header decl")
    stage(h, hs)

def op_app():
    p = "native/imgui_app/src/app.cpp"
    a = load(p)
    if "athuex_input_drain" in a:
        log("app: already patched"); return
    # include
    a = sub_once(a, r"#include <jni\.h>",
                 '#include <jni.h>\n#include "athuex_input.h" ' + MARK, "app include")
    # motion branch -> module (single path)
    ms = [m for m in re.finditer(r"AINPUT_EVENT_TYPE_MOTION", a)
          if re.search(r"\b(if|case)\b", a[max(0, m.start()-120):m.start()])]
    need(len(ms) == 1, "motion branch not unique (%d)" % len(ms))
    ob = a.find("{", ms[0].end())
    need(ob > 0, "motion block open brace not found")
    cb = brace_end(a, ob)
    a = a[:ob+1] + "\n    athuex_input_handle_motion(event); " + MARK + "\n" + a[cb-1:]
    # gate backend to KEY only (kill double injection)
    def gate(m):
        ret, var = m.group(1) or "", m.group(2)
        if ret:
            return ("if (AInputEvent_getType(%s) == AINPUT_EVENT_TYPE_KEY) "
                    "return ImGui_ImplAndroid_HandleInputEvent(%s); return 0;" % (var, var))
        return ("if (AInputEvent_getType(%s) == AINPUT_EVENT_TYPE_KEY) "
                "ImGui_ImplAndroid_HandleInputEvent(%s);" % (var, var))
    a, n = re.subn(r"(return\s+)?ImGui_ImplAndroid_HandleInputEvent\(\s*(\w+)\s*\)\s*;", gate, a)
    need(n >= 1, "backend HandleInputEvent call not found")
    log("app: %d backend call(s) gated to KEY" % n)
    # drain + frame hook before ImGui::NewFrame
    a = sub_once(a, r"ImGui::NewFrame\(\);",
                 "athuex_input_drain(); athuex_worker_ui_frame_begin(); " + MARK +
                 "\nImGui::NewFrame();", "frame hook")
    # trickle off
    a = sub_once(a, r"(io\.ConfigFlags\s*\|=\s*ImGuiConfigFlags_IsTouchScreen\s*;)",
                 r"\1\nio.ConfigInputTrickleEventQueue = false; " + MARK, "trickle off")
    # wake wiring (derive cv + mutex from real wait site)
    wm = re.search(r"(\w+)\.wait\(", a)
    need(wm, "no condition_variable wait site found")
    cv = wm.group(1)
    mm = re.findall(r"unique_lock<std::mutex>\s+\w+\(\s*(\w+)\s*\)", a[:wm.start()])
    need(mm, "no unique_lock mutex found near wait")
    mu = mm[-1]
    log("derived wake: cv=%s mutex=%s" % (cv, mu))
    a = sub_once(a, r"g_ImGuiReady = true;",
                 "g_ImGuiReady = true;\n"
                 "athuex_input_set_wake([]{ { std::lock_guard<std::mutex> lk(%s); } %s.notify_all(); }); %s"
                 % (mu, cv, MARK), "wake wiring")
    # bridge init / shutdown
    a = re.sub(r"(Java_com_athuex_app_MainActivity_nativeOnCreate\s*\([^)]*\)\s*\{)",
               r"\1\n    athuex_input_bridge_init(env, thiz); " + MARK, a, count=1)
    need("athuex_input_bridge_init" in a, "nativeOnCreate anchor not found")
    if re.search(r"Java_com_athuex_app_MainActivity_nativeOnDestroy\s*\([^)]*\)\s*\{", a):
        a = re.sub(r"(Java_com_athuex_app_MainActivity_nativeOnDestroy\s*\([^)]*\)\s*\{)",
                   r"\1\n    athuex_input_bridge_shutdown(); " + MARK, a, count=1)
    else:
        log("WARN: nativeOnDestroy not found — global ref lives for process lifetime (single activity)")
    stage(p, a)

def op_cmake():
    p = "native/imgui_app/CMakeLists.txt"
    c = load(p)
    if "athuex_input.cpp" in c: log("cmake: already patched"); return
    c = sub_once(c, r"\$\{IMGUI_DIR\}/backends/imgui_impl_opengl3\.cpp",
                 "${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp\n"
                 "    ${CMAKE_CURRENT_SOURCE_DIR}/src/athuex_input.cpp", "cmake source")
    stage(p, c)

def op_kotlin():
    p = "android/app/src/main/java/com/athuex/app/MainActivity.kt"
    if not os.path.isfile(os.path.join(ROOT, p)):
        hits = []
        for dp, _, fns in os.walk(os.path.join(ROOT, "android")):
            if "MainActivity.kt" in fns: hits.append(os.path.relpath(os.path.join(dp, "MainActivity.kt"), ROOT))
        need(len(hits) == 1, "MainActivity.kt not uniquely located: %r" % hits)
        p = hits[0]
    k = load(p)
    if KMARK in k: log("kotlin: already patched"); return
    em = re.search(r"(?:val|var)\s+(\w+)\s*=\s*EditText\(", k)
    need(em, "EditText variable not found")
    et = em.group(1)
    log("derived EditText var: %s" % et)
    # replace TextWatcher object
    wm = re.search(r"object\s*:\s*TextWatcher\s*\{", k)
    need(wm, "TextWatcher object not found")
    end = brace_end(k, wm.end() - 1)
    watcher = (
        "object : TextWatcher { " + KMARK + "\n"
        "    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}\n"
        "    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}\n"
        "    override fun afterTextChanged(s: android.text.Editable?) {\n"
        "        if (imeGuard) return\n"
        "        nativeSetText(s?.toString() ?: \"\")\n"
        "    }\n"
        "}")
    k = k[:wm.start()] + watcher + k[end:]
    # neutralize software key double-handling
    km = re.search(r"setOnKeyListener\s*\{", k)
    if km:
        kend = brace_end(k, km.end() - 1)
        k = k[:km.start()] + "setOnKeyListener { _, _, _ -> false } " + KMARK + k[kend:]
    # externals + guard + clearComposer
    anchor = re.search(r"external fun nativeInjectChar[^\n]*\n", k)
    need(anchor, "nativeInjectChar declaration not found")
    add = (
        "    external fun nativeSetText(text: String) " + KMARK + "\n"
        "    external fun nativeInjectKey(keycode: Int)\n"
        "    @Volatile private var imeGuard = false\n"
        "    fun clearComposer() { runOnUiThread { imeGuard = true; " + et + ".setText(\"\"); imeGuard = false } }\n")
    k = k[:anchor.end()] + add + k[anchor.end():]
    stage(p, k)

def op_proguard():
    p = "android/app/proguard-rules.pro"
    s = load(p) if os.path.isfile(os.path.join(ROOT, p)) else ""
    if "clearComposer" in s: log("proguard: already patched"); return
    s += ("\n# v2.11.2 — JNI-called members\n"
          "-keepclasseswithmembernames class * { native <methods>; }\n"
          "-keepclassmembers class com.athuex.app.MainActivity { public void clearComposer(); }\n")
    stage(p, s)

def op_versions():
    targets = ["android/app/build.gradle", "js/version.js",
               "native/imgui_app/CMakeLists.txt", ".github/workflows/build-apk.yml",
               "README.md", "scripts/verify_tree.sh", "BUILD_AND_TEST.md"]
    for p in targets:
        if not os.path.isfile(os.path.join(ROOT, p)): continue
        s = load(p)
        s2 = s.replace("2.11.1", "2.11.2").replace("2111", "2112")
        if s2 != s: stage(p, s2); log("version bump: " + p)
    b = "build_athuex.sh"
    if os.path.isfile(os.path.join(ROOT, b)):
        s = load(b).replace('BRANCH="master"', 'BRANCH="main"')
        stage(b, s); log("build_athuex.sh: branch -> main")
    c = "CHANGELOG.md"
    s = load(c) if os.path.isfile(os.path.join(ROOT, c)) else "# Changelog\n"
    if "2.11.2" not in s:
        lines = s.split("\n")
        s = lines[0] + "\n\n" + CHANGELOG_ENTRY + "\n".join(lines[1:])
        stage(c, s)

def op_verify():
    p = "scripts/verify_tree.sh"
    s = load(p)
    if "athuex_input.cpp" in s: log("verify: already extended"); return
    add = r'''
# v2.11.2 invariants
[ -f native/imgui_app/src/athuex_input.cpp ] && ok input_module || miss input_module
grep -q 'athuex_input_drain' native/imgui_app/src/app.cpp && ok drain_hook || miss drain_hook
grep -q 'athuex_worker_ui_frame_begin' native/imgui_app/src/app.cpp && ok frame_hook || miss frame_hook
grep -q 'ConfigInputTrickleEventQueue = false' native/imgui_app/src/app.cpp && ok trickle_off || miss trickle_off
grep -q 'llama_harness_reset_abort(); /\*v2.11.2\*/' native/imgui_app/src/llama_worker.cpp && ok finalize_reset || miss finalize_reset
grep -q 'clearComposer' android/app/proguard-rules.pro && ok jni_keep || miss jni_keep
grep -q 'BRANCH="main"' build_athuex.sh && ok branch_main || miss branch_main
'''
    s = sub_once(s, r'exit "\$fail"', add + '\nexit "$fail"', "verify extension")
    stage(p, s)

def main():
    need(os.path.isfile("build_athuex.sh") or os.path.isdir("native/imgui_app"),
         "run from the extracted project root")
    log("Athuex v2.11.2 patch — %s mode" % ("APPLY" if APPLY else "DRY-RUN"))
    op_precheck(); op_new_files(); op_worker(); op_app(); op_cmake()
    op_kotlin(); op_proguard(); op_versions(); op_verify()
    if APPLY: save_all(); log("DONE. Next: bash scripts/check_native_v2112.sh && bash scripts/verify_tree.sh && bash build_athuex.sh")
    else: log("DRY-RUN complete: %d files would be written. Re-run with --apply." % len(FILES))

if __name__ == "__main__":
    main()