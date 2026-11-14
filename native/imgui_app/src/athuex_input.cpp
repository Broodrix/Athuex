/* Athuex input module — v2.11.2
 * Producers enqueue under mutex; render thread drains into ImGuiIO.
 * Prevents the classic "ImGuiIO race after first generation" instability
 * and input-event flooding on Galaxy A06-class devices.
 */
#include "athuex_input.h"

#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <mutex>
#include <string>
#include <cfloat>
#include <cstring>

#if defined(ATHUEX_HAS_IMGUI)
#include "imgui.h"
#endif

#define ILOG(...) __android_log_print(ANDROID_LOG_INFO,  "AthuexInput", __VA_ARGS__)
#define IERR(...) __android_log_print(ANDROID_LOG_ERROR, "AthuexInput", __VA_ARGS__)

namespace {

struct Edge {
  uint8_t kind;   /* 0 = button, 1 = key/char */
  uint8_t down;   /* for button: 1=down 0=up */
  int32_t code;   /* unicode or special (8=BS, 10/13=Enter) */
  float   x, y;
  uint8_t has_pos;
};

enum { E_BTN = 0, E_KEY = 1, EDGE_CAP = 8192 };

std::mutex              g_m;
Edge                    g_edges[EDGE_CAP];
int                     g_en = 0;
float                   g_hx = -FLT_MAX, g_hy = -FLT_MAX;
bool                    g_hover = false;
bool                    g_btn_down = false;
std::atomic<uint32_t>   g_over{0};
void (*g_wake)(void) = nullptr;

JavaVM *  g_vm   = nullptr;
jobject   g_act  = nullptr;
jmethodID g_clear = nullptr;

void push_edge(const Edge &e) { /* g_m must be held */
  if (g_en >= EDGE_CAP) {
    g_over.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  g_edges[g_en++] = e;
}

void wake() {
  void (*f)(void) = g_wake;
  if (f) f();
}

#if defined(ATHUEX_HAS_IMGUI)
void apply_key(ImGuiIO &io, ImGuiKey k) {
  io.AddKeyEvent(k, true);
  io.AddKeyEvent(k, false);
}
#endif

} // namespace

extern "C" void athuex_input_set_wake(void (*fn)(void)) {
  g_wake = fn;
}

extern "C" int athuex_input_handle_motion_xy(int action, float x, float y) {
  /* action = MotionEvent.getActionMasked(): 0=DOWN, 1=UP, 2=MOVE, 3=CANCEL, 5/6=POINTER */
  {
    std::lock_guard<std::mutex> lk(g_m);
    switch (action) {
    case 0: /* DOWN */
      if (g_btn_down) {
        /* Missed UP — heal so ImGui never stays pressed. */
        push_edge({E_BTN, 0, 0, x, y, 1});
      }
      g_btn_down = true;
      g_hx = x; g_hy = y; g_hover = true;
      push_edge({E_BTN, 1, 0, x, y, 1});
      break;
    case 5: /* POINTER_DOWN — ignore secondary fingers */
      break;
    case 2: /* MOVE */
      g_hx = x; g_hy = y; g_hover = true;
      break;
    case 1: /* UP */
    case 6: /* POINTER_UP (primary) */
      if (g_btn_down) {
        push_edge({E_BTN, 0, 0, x, y, 1});
      }
      g_btn_down = false;
      g_hx = x; g_hy = y; g_hover = true;
      break;
    case 3: /* CANCEL */
      if (g_btn_down) {
        push_edge({E_BTN, 0, 0, x, y, 1});
      }
      g_btn_down = false;
      g_hx = -FLT_MAX; g_hy = -FLT_MAX; g_hover = true;
      break;
    default:
      break;
    }
  }
  wake();
  return 1;
}

extern "C" void athuex_input_inject_char(int code) {
  {
    std::lock_guard<std::mutex> lk(g_m);
    Edge e{};
    e.kind = E_KEY;
    e.code = code;
    push_edge(e);
  }
  wake();
}

/* Batch an IME edit under one lock and one render wake. This avoids a JNI
 * call + mutex + condition-variable notification for every UTF-16 code unit. */
extern "C" void athuex_input_inject_text_delta(int delete_count, const uint16_t *text,
                                                int text_len) {
  if (delete_count < 0) delete_count = 0;
  if (text_len < 0) text_len = 0;
  {
    std::lock_guard<std::mutex> lk(g_m);
    /* Preserve queue ordering. The capacity is intentionally large enough for
     * a full ImGui composer edit, including delete-and-replace operations. */
    for (int i = 0; i < delete_count; ++i) {
      Edge e{}; e.kind = E_KEY; e.code = 8; push_edge(e);
    }
    for (int i = 0; i < text_len; ++i) {
      uint32_t cp = text ? text[i] : 0;
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < text_len && text[i + 1] >= 0xDC00 && text[i + 1] <= 0xDFFF) {
        cp = 0x10000u + ((cp - 0xD800u) << 10) + (text[++i] - 0xDC00u);
      } else if (cp >= 0xD800 && cp <= 0xDFFF) {
        cp = 0xFFFDu; /* malformed isolated surrogate */
      }
      Edge e{}; e.kind = E_KEY; e.code = static_cast<int32_t>(cp); push_edge(e);
    }
  }
  wake();
}

extern "C" void athuex_input_drain(void) {
#if defined(ATHUEX_HAS_IMGUI)
  if (!ImGui::GetCurrentContext()) return;
  ImGuiIO &io = ImGui::GetIO();

  Edge local[EDGE_CAP];
  int n = 0;
  float hx = -FLT_MAX, hy = -FLT_MAX;
  bool hover = false;
  {
    std::lock_guard<std::mutex> lk(g_m);
    n = g_en;
    if (n > 0) {
      std::memcpy(local, g_edges, sizeof(Edge) * (size_t)n);
      g_en = 0;
    }
    hx = g_hx; hy = g_hy; hover = g_hover;
  }

  if (hover && hx > -1e20f) {
    io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
    io.AddMousePosEvent(hx, hy);
  }

  for (int i = 0; i < n; ++i) {
    const Edge &e = local[i];
    if (e.kind == E_BTN) {
      if (e.has_pos) {
        io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
        io.AddMousePosEvent(e.x, e.y);
      }
      io.AddMouseButtonEvent(0, e.down != 0);
    } else if (e.kind == E_KEY) {
      if (e.code == 8) {
        apply_key(io, ImGuiKey_Backspace);
      } else if (e.code == 10 || e.code == 13) {
        io.AddInputCharacter('\n');
        apply_key(io, ImGuiKey_Enter);
      } else if (e.code >= 32) {
        io.AddInputCharacter((unsigned int)e.code);
      }
    }
  }

  const uint32_t dropped = g_over.exchange(0, std::memory_order_relaxed);
  if (dropped)
    ILOG("input queue overflow, dropped %u events (device under load)", dropped);
#else
  (void)0;
#endif
}

extern "C" void athuex_input_bridge_init(JNIEnv *env, jobject activity) {
  if (!env || !activity) return;
  env->GetJavaVM(&g_vm);
  if (g_act) {
    env->DeleteGlobalRef(g_act);
    g_act = nullptr;
  }
  g_act = env->NewGlobalRef(activity);
  jclass c = env->GetObjectClass(activity);
  /* Prefer clearComposer if present; fall back to nothing (hideKeyboard already clears). */
  g_clear = env->GetMethodID(c, "clearComposer", "()V");
  if (env->ExceptionCheck() || !g_clear) {
    env->ExceptionClear();
    g_clear = nullptr;
    ILOG("clearComposer() not found — using hide path only");
  }
  env->DeleteLocalRef(c);
  ILOG("input bridge ready");
}

extern "C" void athuex_input_bridge_shutdown(void) {
  if (g_vm && g_act) {
    JNIEnv *env = nullptr;
    if (g_vm->GetEnv((void **)&env, JNI_VERSION_1_6) == JNI_OK && env)
      env->DeleteGlobalRef(g_act);
  }
  g_act = nullptr;
  g_clear = nullptr;
  g_vm = nullptr;
}

extern "C" void athuex_input_clear_composer(void) {
  {
    std::lock_guard<std::mutex> lk(g_m);
    g_en = 0; /* drop pending key events so they don't resurrect old text */
  }
  if (!g_vm || !g_act || !g_clear) return;
  JNIEnv *env = nullptr;
  bool att = false;
  jint r = g_vm->GetEnv((void **)&env, JNI_VERSION_1_6);
  if (r == JNI_EDETACHED) {
    if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
    att = true;
  } else if (r != JNI_OK) {
    return;
  }
  env->CallVoidMethod(g_act, g_clear);
  if (env->ExceptionCheck()) env->ExceptionClear();
  if (att) g_vm->DetachCurrentThread();
}
