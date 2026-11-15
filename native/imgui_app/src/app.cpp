/* Athuex native app — v2.11.6 pure-native ImGui
 * EGL + Dear ImGui (vendored), render-on-demand, JNI surface bridge.
 * v2.11.6: industry-standard Chat UI — 52px toolbar (hamburger+brand+
 *         metrics+gear), message bubbles with accent borders, streaming
 *         cursor, liquid-glass composer (route/think pills, circular
 *         submit/stop/mic), history drawer, settings popup.
 * v2.11.5: multi-frame wake (3 frames/input), eglSwapInterval(0).
 * v2.11.3: generation-epoch worker lifecycle (join-before-claim).
 * v2.11.2: thread-safe input queue, frame-stable snapshot, composer resync.
 * Production path for Android APK on Galaxy A06-class devices.
 */
#include <jni.h>
#include "athuex_input.h"
#include <android/native_window_jni.h>
#include <android/log.h>
#include <EGL/egl.h>
#include <GLES3/gl3.h>

#include <atomic>
#include <condition_variable>
#include <cstring>
#include <cmath>
#include <cstdio>
#include <mutex>
#include <string>
#include <thread>

#include "llama_worker.h"

#if defined(ATHUEX_HAS_IMGUI)
#include "imgui.h"
#include "imgui_impl_android.h"
#include "imgui_impl_opengl3.h"
#endif

#define LOG_TAG "AthuexApp"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

/* -------------------------------------------------------------------------- */
/* Render-on-demand synchronization                                           */
/* -------------------------------------------------------------------------- */
std::mutex              g_RenderMutex;
std::condition_variable g_RenderCond;
std::atomic<int>        g_RenderRequested{0};
std::atomic<bool>       g_AppRunning{true};
std::atomic<bool>       g_ImGuiReady{false};

void request_render(void) {
  /* Ensure at least 3 frames so ImGui InputText settles cursor/scroll/WantTextInput. */
  int cur = g_RenderRequested.load(std::memory_order_relaxed);
  while (cur < 3 && !g_RenderRequested.compare_exchange_weak(
             cur, 3, std::memory_order_relaxed, std::memory_order_relaxed)) {
  }
  g_RenderCond.notify_one();
}

/* -------------------------------------------------------------------------- */
/* EGL state                                                                  */
/* -------------------------------------------------------------------------- */
EGLDisplay     g_EglDisplay = EGL_NO_DISPLAY;
EGLSurface     g_EglSurface = EGL_NO_SURFACE;
EGLContext     g_EglContext = EGL_NO_CONTEXT;
ANativeWindow *g_NativeWindow = nullptr;
int            g_WindowWidth  = 0;
int            g_WindowHeight = 0;
std::thread    g_RenderThread;
std::atomic<bool> g_SurfaceAlive{false};

/* Optional path injected from Java (models dir) */
static std::string g_StoragePath;
static std::string g_ActiveModel;
static std::mutex g_ActiveModelMutex;

static std::string active_model_snapshot() {
  std::lock_guard<std::mutex> lock(g_ActiveModelMutex);
  return g_ActiveModel;
}

static void set_active_model(const std::string &model) {
  std::lock_guard<std::mutex> lock(g_ActiveModelMutex);
  g_ActiveModel = model;
}
static char        g_PromptBuf[2048] = {};
static std::atomic<bool> g_ClearPromptRequested{false};
static int         g_Threads = 4;
static int         g_Ctx     = 2048; /* 4 GB safe default */
static std::string g_StatusMsg;
static std::mutex g_StatusMutex;

static std::string status_snapshot() {
  std::lock_guard<std::mutex> lock(g_StatusMutex);
  return g_StatusMsg;
}

static void set_status_message(const std::string &message) {
  std::lock_guard<std::mutex> lock(g_StatusMutex);
  g_StatusMsg = message;
}
static float       g_Density = 2.0f;   /* from DisplayMetrics.density */
static float       g_ScaledDensity = 2.0f;
static bool        g_ModeThink = false;
static bool        g_ShowDrawer = false;
static bool        g_ShowSettings = false;
static int         g_RouteMode = 0; /* 0=INT Local, 1=EXT External, 2=HYB Hybrid */
static bool        g_VoiceListening = false;
static bool        g_ModeExt = false;

/* JNI keyboard helpers (resolved on create) */
static JavaVM *g_JavaVM = nullptr;
static jobject g_ActivityRef = nullptr;
static jmethodID g_ShowKeyboard = nullptr;
static jmethodID g_HideKeyboard = nullptr;
static jmethodID g_OpenPicker = nullptr;
static bool g_KeyboardVisible = false;


static void open_gguf_picker() {
  if (!g_JavaVM || !g_ActivityRef || !g_OpenPicker) return;
  JNIEnv *env = nullptr;
  bool attached = false;
  if (g_JavaVM->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
    if (g_JavaVM->AttachCurrentThread(&env, nullptr) != 0) return;
    attached = true;
  }
  if (env) env->CallVoidMethod(g_ActivityRef, g_OpenPicker);
  if (attached) g_JavaVM->DetachCurrentThread();
}

static void set_keyboard_visible(bool visible) {
  if (!g_JavaVM || !g_ActivityRef) return;
  JNIEnv *env = nullptr;
  bool attached = false;
  if (g_JavaVM->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
    if (g_JavaVM->AttachCurrentThread(&env, nullptr) != 0) return;
    attached = true;
  }
  if (env) {
    if (visible && !g_KeyboardVisible && g_ShowKeyboard) {
      env->CallVoidMethod(g_ActivityRef, g_ShowKeyboard);
      g_KeyboardVisible = true;
    } else if (!visible && g_KeyboardVisible && g_HideKeyboard) {
      env->CallVoidMethod(g_ActivityRef, g_HideKeyboard);
      g_KeyboardVisible = false;
    }
  }
  if (attached) g_JavaVM->DetachCurrentThread();
}

static bool egl_ok(const char *what) {
  EGLint err = eglGetError();
  if (err != EGL_SUCCESS) {
    LOGE("%s failed: 0x%x", what, err);
    return false;
  }
  return true;
}

static void init_egl() {
  if (g_EglDisplay != EGL_NO_DISPLAY) {
    /* Already have display; only recreate surface if needed. */
    if (g_EglSurface == EGL_NO_SURFACE && g_NativeWindow) {
      /* Will be handled below after config. */
    } else {
      return;
    }
  }

  g_EglDisplay = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  if (g_EglDisplay == EGL_NO_DISPLAY) {
    LOGE("eglGetDisplay failed");
    return;
  }
  if (!eglInitialize(g_EglDisplay, nullptr, nullptr) || !egl_ok("eglInitialize")) return;

  const EGLint attribs[] = {
      EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
      EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
      EGL_BLUE_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_RED_SIZE, 8,
      EGL_ALPHA_SIZE, 0,
      EGL_DEPTH_SIZE, 0,
      EGL_STENCIL_SIZE, 0,
      EGL_NONE};
  EGLConfig config = nullptr;
  EGLint num = 0;
  if (!eglChooseConfig(g_EglDisplay, attribs, &config, 1, &num) || num < 1 || !egl_ok("eglChooseConfig")) {
    LOGE("no suitable EGL config");
    return;
  }

  if (g_EglContext == EGL_NO_CONTEXT) {
    const EGLint ctxAttr[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE};
    g_EglContext = eglCreateContext(g_EglDisplay, config, EGL_NO_CONTEXT, ctxAttr);
    if (g_EglContext == EGL_NO_CONTEXT || !egl_ok("eglCreateContext")) return;
  }

  if (g_EglSurface != EGL_NO_SURFACE) {
    eglDestroySurface(g_EglDisplay, g_EglSurface);
    g_EglSurface = EGL_NO_SURFACE;
  }
  if (!g_NativeWindow) return;

  g_EglSurface = eglCreateWindowSurface(g_EglDisplay, config, g_NativeWindow, nullptr);
  if (g_EglSurface == EGL_NO_SURFACE || !egl_ok("eglCreateWindowSurface")) return;

  if (!eglMakeCurrent(g_EglDisplay, g_EglSurface, g_EglSurface, g_EglContext) || !egl_ok("eglMakeCurrent")) return;

  /* Disable vsync blocking so render-on-demand wakes are not stalled 16–33ms on Mali. */
  eglSwapInterval(g_EglDisplay, 0);

  LOGI("EGL ready GL_VERSION=%s", reinterpret_cast<const char *>(glGetString(GL_VERSION)));
}

static void term_egl_surface_only() {
  if (g_EglDisplay != EGL_NO_DISPLAY) {
    eglMakeCurrent(g_EglDisplay, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (g_EglSurface != EGL_NO_SURFACE) {
      eglDestroySurface(g_EglDisplay, g_EglSurface);
      g_EglSurface = EGL_NO_SURFACE;
    }
  }
}

static void term_egl() {
  term_egl_surface_only();
  if (g_EglDisplay != EGL_NO_DISPLAY) {
    if (g_EglContext != EGL_NO_CONTEXT) {
      eglDestroyContext(g_EglDisplay, g_EglContext);
      g_EglContext = EGL_NO_CONTEXT;
    }
    eglTerminate(g_EglDisplay);
    g_EglDisplay = EGL_NO_DISPLAY;
  }
}

#if defined(ATHUEX_HAS_IMGUI)
/** Nvidia green (#76B900) + black liquid-glass aesthetic matching index.html. */
static void ApplyAthuexTheme() {
  ImGuiStyle &s = ImGui::GetStyle();
  s.WindowRounding    = 10.0f;
  s.ChildRounding     = 8.0f;
  s.FrameRounding     = 6.0f;
  s.PopupRounding     = 8.0f;
  s.ScrollbarRounding = 6.0f;
  s.GrabRounding      = 4.0f;
  s.TabRounding       = 6.0f;
  s.WindowBorderSize  = 1.0f;
  s.FrameBorderSize   = 0.0f;
  s.WindowPadding     = ImVec2(12, 12);
  s.FramePadding      = ImVec2(10, 6);
  s.ItemSpacing       = ImVec2(8, 6);
  s.ItemInnerSpacing  = ImVec2(6, 4);
  s.ScrollbarSize     = 12.0f;
  s.GrabMinSize       = 10.0f;

  ImVec4 *c = s.Colors;
  /* Design tokens from css/ide.css (authoritative HTML visual language) */
  /* --bg #0d1117  --panel #161b22  --panel2 #21262d  --border #30363d */
  /* --text #e6edf3  --muted #8b949e  --accent #76b900 */
  c[ImGuiCol_WindowBg]             = ImVec4(0.051f, 0.067f, 0.090f, 1.00f); /* #0d1117 */
  c[ImGuiCol_ChildBg]              = ImVec4(0.086f, 0.106f, 0.133f, 0.95f); /* #161b22 */
  c[ImGuiCol_PopupBg]              = ImVec4(0.086f, 0.106f, 0.133f, 0.98f);
  c[ImGuiCol_Border]               = ImVec4(0.188f, 0.212f, 0.239f, 1.00f); /* #30363d */
  c[ImGuiCol_BorderShadow]         = ImVec4(0.00f, 0.00f, 0.00f, 0.00f);
  c[ImGuiCol_FrameBg]              = ImVec4(0.129f, 0.149f, 0.176f, 1.00f); /* #21262d */
  c[ImGuiCol_FrameBgHovered]       = ImVec4(0.18f, 0.22f, 0.12f, 0.90f);
  c[ImGuiCol_FrameBgActive]        = ImVec4(0.22f, 0.28f, 0.12f, 0.95f);
  c[ImGuiCol_TitleBg]              = ImVec4(0.051f, 0.067f, 0.090f, 1.00f);
  c[ImGuiCol_TitleBgActive]        = ImVec4(0.086f, 0.106f, 0.133f, 1.00f);
  c[ImGuiCol_TitleBgCollapsed]     = ImVec4(0.051f, 0.067f, 0.090f, 0.80f);
  c[ImGuiCol_MenuBarBg]            = ImVec4(0.086f, 0.106f, 0.133f, 0.95f);
  c[ImGuiCol_ScrollbarBg]          = ImVec4(0.05f, 0.05f, 0.06f, 0.60f);
  c[ImGuiCol_ScrollbarGrab]        = ImVec4(0.30f, 0.45f, 0.05f, 0.70f);
  c[ImGuiCol_ScrollbarGrabHovered] = ImVec4(0.40f, 0.60f, 0.05f, 0.85f);
  c[ImGuiCol_ScrollbarGrabActive]  = ImVec4(0.46f, 0.72f, 0.00f, 1.00f);
  c[ImGuiCol_CheckMark]            = ImVec4(0.46f, 0.72f, 0.00f, 1.00f);
  c[ImGuiCol_SliderGrab]           = ImVec4(0.46f, 0.72f, 0.00f, 0.90f);
  c[ImGuiCol_SliderGrabActive]     = ImVec4(0.55f, 0.85f, 0.05f, 1.00f);
  c[ImGuiCol_Button]               = ImVec4(0.20f, 0.32f, 0.05f, 0.90f);
  c[ImGuiCol_ButtonHovered]        = ImVec4(0.35f, 0.55f, 0.05f, 1.00f);
  c[ImGuiCol_ButtonActive]         = ImVec4(0.46f, 0.72f, 0.00f, 1.00f);
  c[ImGuiCol_Header]               = ImVec4(0.20f, 0.32f, 0.05f, 0.70f);
  c[ImGuiCol_HeaderHovered]        = ImVec4(0.35f, 0.55f, 0.05f, 0.85f);
  c[ImGuiCol_HeaderActive]         = ImVec4(0.46f, 0.72f, 0.00f, 0.95f);
  c[ImGuiCol_Separator]            = ImVec4(0.30f, 0.45f, 0.05f, 0.50f);
  c[ImGuiCol_SeparatorHovered]     = ImVec4(0.46f, 0.72f, 0.00f, 0.70f);
  c[ImGuiCol_SeparatorActive]      = ImVec4(0.55f, 0.85f, 0.05f, 1.00f);
  c[ImGuiCol_ResizeGrip]           = ImVec4(0.30f, 0.45f, 0.05f, 0.40f);
  c[ImGuiCol_ResizeGripHovered]    = ImVec4(0.46f, 0.72f, 0.00f, 0.70f);
  c[ImGuiCol_ResizeGripActive]     = ImVec4(0.55f, 0.85f, 0.05f, 0.95f);
  c[ImGuiCol_Tab]                  = ImVec4(0.15f, 0.22f, 0.05f, 0.85f);
  c[ImGuiCol_TabHovered]           = ImVec4(0.35f, 0.55f, 0.05f, 0.90f);
  c[ImGuiCol_TabActive]            = ImVec4(0.25f, 0.40f, 0.05f, 1.00f);
  c[ImGuiCol_TabUnfocused]         = ImVec4(0.10f, 0.12f, 0.08f, 0.90f);
  c[ImGuiCol_TabUnfocusedActive]   = ImVec4(0.18f, 0.28f, 0.05f, 0.95f);
  c[ImGuiCol_PlotLines]            = ImVec4(0.46f, 0.72f, 0.00f, 1.00f);
  c[ImGuiCol_PlotLinesHovered]     = ImVec4(0.60f, 0.90f, 0.10f, 1.00f);
  c[ImGuiCol_PlotHistogram]        = ImVec4(0.40f, 0.65f, 0.00f, 1.00f);
  c[ImGuiCol_PlotHistogramHovered] = ImVec4(0.55f, 0.85f, 0.05f, 1.00f);
  c[ImGuiCol_Text]                 = ImVec4(0.902f, 0.929f, 0.953f, 1.00f); /* #e6edf3 */
  c[ImGuiCol_TextDisabled]         = ImVec4(0.545f, 0.580f, 0.620f, 1.00f); /* #8b949e */
  c[ImGuiCol_TextSelectedBg]       = ImVec4(0.30f, 0.50f, 0.05f, 0.45f);
  c[ImGuiCol_DragDropTarget]       = ImVec4(0.46f, 0.72f, 0.00f, 0.90f);
  c[ImGuiCol_NavHighlight]         = ImVec4(0.46f, 0.72f, 0.00f, 1.00f);
  c[ImGuiCol_NavWindowingHighlight]= ImVec4(1.00f, 1.00f, 1.00f, 0.70f);
  c[ImGuiCol_NavWindowingDimBg]    = ImVec4(0.20f, 0.20f, 0.20f, 0.20f);
  c[ImGuiCol_ModalWindowDimBg]     = ImVec4(0.05f, 0.05f, 0.06f, 0.60f);
}
#endif

static void render_frame() {
  /* Snapshot JNI-owned model selection once per frame; never race std::string. */
  std::string active_model = active_model_snapshot();
  std::string status_msg = status_snapshot();
#if defined(ATHUEX_HAS_IMGUI)
  if (!g_ImGuiReady.load()) return;

  athuex_worker_ui_frame_begin(); /*v2.11.2 frame-stable display snapshot */
  if (g_ClearPromptRequested.exchange(false, std::memory_order_acq_rel))
    g_PromptBuf[0] = '\0'; /* ImGui-owned buffers are render-thread-only. */
  athuex_input_drain(); /*v2.11.2: only render thread mutates ImGuiIO */
  ImGui_ImplOpenGL3_NewFrame();
  ImGui_ImplAndroid_NewFrame();
  ImGui::NewFrame();

  /* Industry-standard soft-keyboard gate: show when any ImGui widget wants text. */
  {
    ImGuiIO &io = ImGui::GetIO();
    if (io.WantTextInput)
      set_keyboard_visible(true);
  }

  ImGui::SetNextWindowPos(ImVec2(0, 0));
  ImGui::SetNextWindowSize(ImVec2(static_cast<float>(g_WindowWidth),
                                  static_cast<float>(g_WindowHeight)));
  ImGui::Begin("Athuex", nullptr,
               ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
               ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoNavFocus);

  /* Design tokens (ide.css / athuex_theme.h) */
  const ImVec4 COL_ACCENT  = ImVec4(0.46f, 0.72f, 0.00f, 1.0f);      /* #76b900 */
  const ImVec4 COL_MUTED   = ImVec4(0.545f, 0.580f, 0.620f, 1.0f);   /* #8b949e */
  const ImVec4 COL_TEXT    = ImVec4(0.902f, 0.929f, 0.953f, 1.0f);   /* #e6edf3 */
  const ImVec4 COL_PANEL   = ImVec4(0.086f, 0.106f, 0.133f, 1.0f);   /* #161b22 */
  const ImVec4 COL_PANEL2  = ImVec4(0.129f, 0.149f, 0.176f, 1.0f);   /* #21262d */
  const ImVec4 COL_BG      = ImVec4(0.051f, 0.067f, 0.090f, 1.0f);   /* #0d1117 */
  const ImVec4 COL_BLUE    = ImVec4(0.345f, 0.651f, 1.00f, 1.0f);    /* #58a6ff */
  const ImVec4 COL_DANGER  = ImVec4(0.973f, 0.318f, 0.286f, 1.0f);   /* #f85149 */
  const ImVec4 COL_AI_BG   = ImVec4(0.110f, 0.129f, 0.157f, 1.0f);   /* #1c2128 */
  const ImVec4 COL_BORDER  = ImVec4(0.188f, 0.212f, 0.239f, 1.0f);   /* #30363d */
  const ImVec4 COL_TOPBAR  = ImVec4(0.004f, 0.016f, 0.035f, 1.0f);   /* #010409 */

  const float toolbar_h = 52.0f;
  const float chatbar_min = 118.0f;
  bool generating = athuex_worker_is_active() != 0;

  /* ── Top Toolbar 52px ───────────────────────────────────────── */
  {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, COL_TOPBAR);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8, 8));
    ImGui::BeginChild("toolbar", ImVec2(0, toolbar_h), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);

    /* Left: hamburger + brand */
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0,0,0,0));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_PANEL2);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, COL_PANEL);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    if (ImGui::Button("##ham", ImVec2(36, 36))) {
      g_ShowDrawer = !g_ShowDrawer;
    }
    {
      ImVec2 p = ImGui::GetItemRectMin();
      ImDrawList *dl = ImGui::GetWindowDrawList();
      float cx = p.x + 18, cy = p.y + 18;
      dl->AddText(ImVec2(cx - 8, cy - 10), ImGui::GetColorU32(COL_TEXT), "\xE2\x98\xB0"); /* ☰ */
    }
    ImGui::SameLine(0, 6);
    ImGui::TextColored(COL_ACCENT, "Athuex");
    ImGui::SameLine(0, 4);
    ImGui::TextColored(COL_MUTED, "AI");
    if (!active_model.empty()) {
      const char *base = strrchr(active_model.c_str(), '/');
      base = base ? base + 1 : active_model.c_str();
      ImGui::SameLine(0, 6);
      ImGui::TextColored(COL_MUTED, "·");
      ImGui::SameLine(0, 4);
      ImGui::TextColored(COL_TEXT, "%.22s", base);
    }
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(3);

    /* Right: metrics + status + gear */
    char met[72];
    if (generating) {
      int tok = athuex_worker_token_count();
      float sec = athuex_worker_elapsed_ms() / 1000.0f;
      float tps = (sec > 0.05f) ? (tok / sec) : 0.0f;
      snprintf(met, sizeof(met), "%.1f t/s  %d tok", tps, tok);
    } else if (!status_msg.empty()) {
      snprintf(met, sizeof(met), "%s", status_msg.c_str());
    } else {
      snprintf(met, sizeof(met), "Ready");
    }
    ImVec2 ts = ImGui::CalcTextSize(met);
    float right_x = ImGui::GetWindowWidth() - ts.x - 52.0f;
    if (right_x < ImGui::GetCursorPosX() + 8)
      right_x = ImGui::GetCursorPosX() + 8;
    ImGui::SameLine(right_x);
    ImGui::TextColored(generating ? COL_ACCENT : COL_MUTED, "%s", met);

    ImGui::SameLine(ImGui::GetWindowWidth() - 44.0f);
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0,0,0,0));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_PANEL2);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, COL_PANEL);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
    if (ImGui::Button("##gear", ImVec2(36, 36))) {
      g_ShowSettings = !g_ShowSettings;
    }
    {
      ImVec2 p = ImGui::GetItemRectMin();
      ImDrawList *dl = ImGui::GetWindowDrawList();
      dl->AddText(ImVec2(p.x + 9, p.y + 7), ImGui::GetColorU32(COL_MUTED), "\xE2\x9A\x99"); /* ⚙ */
    }
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(3);

    ImGui::EndChild();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
  }

  /* ── History Drawer (overlay when open) ─────────────────────── */
  if (g_ShowDrawer) {
    ImGui::SetNextWindowPos(ImVec2(0, toolbar_h));
    ImGui::SetNextWindowSize(ImVec2(ImMin(280.0f, (float)g_WindowWidth * 0.78f),
                                    (float)g_WindowHeight - toolbar_h));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, COL_PANEL);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    ImGui::Begin("##drawer", &g_ShowDrawer,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
                 ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoMove);
    ImGui::TextColored(COL_MUTED, "CHAT HISTORY");
    ImGui::Separator();
    if (ImGui::Button("New chat", ImVec2(-1, 0))) {
      athuex_worker_clear_text();
      g_PromptBuf[0] = '\0';
      g_ShowDrawer = false;
      set_status_message("new chat");
    }
    ImGui::Spacing();
    ImGui::TextWrapped("Current session is shown in the main stream. Session list and persistence land in a later phase.");
    ImGui::Spacing();
    if (ImGui::Button("Close", ImVec2(-1, 0)))
      g_ShowDrawer = false;
    ImGui::End();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
  }

  /* ── Settings popup ─────────────────────────────────────────── */
  if (g_ShowSettings) {
    ImGui::OpenPopup("Settings");
  }
  ImGui::SetNextWindowSize(ImVec2(ImMin(340.0f, (float)g_WindowWidth - 24.0f), 0), ImGuiCond_Appearing);
  if (ImGui::BeginPopupModal("Settings", &g_ShowSettings,
                             ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::TextColored(COL_ACCENT, "Engine");
    ImGui::Separator();
    const char *preview = active_model.empty() ? "(no model)" : active_model.c_str();
    const char *basep = strrchr(preview, '/');
    if (basep) preview = basep + 1;
    if (ImGui::BeginCombo("Model", preview)) {
      int n = athuex_worker_model_count();
      for (int i = 0; i < n; ++i) {
        const char *path = athuex_worker_model_at(i);
        if (!path) continue;
        const char *b = strrchr(path, '/');
        b = b ? b + 1 : path;
        bool selected = (active_model == path);
        if (ImGui::Selectable(b, selected)) {
          set_active_model(path);
          set_status_message(std::string("model: ") + b);
        }
        if (selected) ImGui::SetItemDefaultFocus();
      }
      ImGui::EndCombo();
    }
    if (ImGui::Button("Browse GGUF…", ImVec2(-1, 0))) {
      open_gguf_picker();
      g_ShowSettings = false;
      ImGui::CloseCurrentPopup();
    }
    ImGui::SliderInt("Threads", &g_Threads, 1, 4);
    ImGui::SliderInt("Context", &g_Ctx, 1024, 4096);
    ImGui::Spacing();
    ImGui::TextColored(COL_MUTED, "Route: %s", g_RouteMode == 0 ? "INT Local" :
                                               g_RouteMode == 1 ? "EXT External" : "HYB Hybrid");
    ImGui::Spacing();
    if (ImGui::Button("Done", ImVec2(-1, 0))) {
      g_ShowSettings = false;
      ImGui::CloseCurrentPopup();
    }
    ImGui::EndPopup();
  }

  /* ── Chat header (active model) ─────────────────────────────── */
  {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, COL_PANEL);
    ImGui::BeginChild("chat_hdr", ImVec2(0, 28), false, ImGuiWindowFlags_NoScrollbar);
    const char *label = active_model.empty() ? "No model loaded" : "Assistant";
    ImGui::TextColored(COL_MUTED, "%s", label);
    if (!active_model.empty()) {
      const char *base = strrchr(active_model.c_str(), '/');
      base = base ? base + 1 : active_model.c_str();
      ImGui::SameLine();
      ImGui::TextColored(COL_BLUE, "%.40s", base);
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
  }

  /* ── Message stream ─────────────────────────────────────────── */
  float footer_h = chatbar_min;
  if (generating) footer_h += 4.0f;
  ImGui::BeginChild("Chat", ImVec2(0, -footer_h), true);

  const char *txt = athuex_worker_sync_text();
  if (txt && txt[0]) {
    const char *line = txt;
    while (*line) {
      const char *nl = strchr(line, '\n');
      int len = nl ? (int)(nl - line) : (int)strlen(line);

      bool is_user = (len >= 5 && strncmp(line, "You: ", 5) == 0);
      bool is_ai   = (len >= 8 && strncmp(line, "Athuex: ", 8) == 0);

      if (is_user || is_ai) {
        const char *body = is_user ? line + 5 : line + 8;
        int body_len = is_user ? len - 5 : len - 8;
        if (body_len < 0) body_len = 0;

        float avail = ImGui::GetContentRegionAvail().x;
        float max_w = avail * 0.92f;
        ImVec2 text_sz = ImGui::CalcTextSize(body, body + body_len, false, max_w - 16.0f);
        float bubble_w = text_sz.x + 20.0f;
        if (bubble_w > max_w) bubble_w = max_w;
        if (bubble_w < 48.0f) bubble_w = 48.0f;

        float indent = is_user ? (avail - bubble_w) : 0.0f;
        if (indent < 0) indent = 0;
        ImGui::SetCursorPosX(ImGui::GetCursorPosX() + indent);

        ImVec2 p0 = ImGui::GetCursorScreenPos();
        ImDrawList *dl = ImGui::GetWindowDrawList();
        ImU32 bg = ImGui::GetColorU32(is_user ? COL_PANEL2 : COL_AI_BG);
        ImU32 border = ImGui::GetColorU32(is_user ? COL_ACCENT : COL_BLUE);

        ImGui::PushStyleColor(ImGuiCol_ChildBg, is_user ? COL_PANEL2 : COL_AI_BG);
        ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 8.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10, 8));
        char child_id[32];
        snprintf(child_id, sizeof(child_id), "##b%p", (void*)line);
        ImGui::BeginChild(child_id, ImVec2(bubble_w, text_sz.y + 16.0f), true,
                          ImGuiWindowFlags_NoScrollbar);
        ImGui::PushTextWrapPos(ImGui::GetCursorPos().x + bubble_w - 20.0f);
        ImGui::TextUnformatted(body, body + body_len);
        ImGui::PopTextWrapPos();
        ImGui::EndChild();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();

        /* 3px left accent border */
        ImVec2 p1 = ImGui::GetItemRectMax();
        dl->AddRectFilled(ImVec2(p0.x, p0.y), ImVec2(p0.x + 3.0f, p1.y), border, 2.0f);

        if (is_ai && !generating) {
          ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6, 2));
          ImGui::PushStyleColor(ImGuiCol_Button, COL_PANEL2);
          ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_PANEL);
          if (ImGui::SmallButton("Copy")) {
            /* clipboard via system would need JNI; status feedback for now */
            set_status_message("copied (local)");
          }
          ImGui::SameLine();
          if (ImGui::SmallButton("Retry")) {
            set_status_message("retry — re-send last prompt from history");
          }
          ImGui::PopStyleColor(2);
          ImGui::PopStyleVar();
        }
        ImGui::Spacing();
      } else if (len > 0) {
        ImGui::TextWrapped("%.*s", len, line);
      }
      if (!nl) break;
      line = nl + 1;
    }
  } else {
    ImGui::Dummy(ImVec2(0, 24));
    ImGui::TextColored(COL_MUTED, "  Ask anything…");
  }

  /* Streaming cursor */
  if (generating) {
    double t = ImGui::GetTime();
    bool on = (fmod(t, 1.0) < 0.55);
    if (on) {
      ImGui::SameLine(0, 2);
      ImGui::TextColored(COL_ACCENT, "\xE2\x96\xAE"); /* ▮ */
    } else {
      ImGui::SameLine(0, 2);
      ImGui::TextColored(COL_MUTED, "\xE2\x96\xAF"); /* ▯ */
    }
    ImGui::SetScrollHereY(1.0f);
    request_render();
  }
  ImGui::EndChild();

  /* ── Liquid-glass Chatbar ───────────────────────────────────── */
  {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, COL_PANEL);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10, 8));
    ImGui::BeginChild("chatbar", ImVec2(0, 0), false, ImGuiWindowFlags_NoScrollbar);

    /* Auto-growing multiline (clamped) */
    float line_h = ImGui::GetTextLineHeight();
    int lines = 1;
    for (const char *p = g_PromptBuf; *p; ++p)
      if (*p == '\n') ++lines;
    float input_h = line_h * (float)(lines < 1 ? 1 : (lines > 4 ? 4 : lines)) + 16.0f;
    if (input_h < line_h * 2.2f) input_h = line_h * 2.2f;

    ImGui::PushStyleColor(ImGuiCol_FrameBg, COL_PANEL2);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 10.0f);
    ImGui::PushItemWidth(-1.0f);
    bool enter = ImGui::InputTextMultiline(
        "##prompt", g_PromptBuf, sizeof(g_PromptBuf),
        ImVec2(-1.0f, input_h),
        ImGuiInputTextFlags_EnterReturnsTrue |
            ImGuiInputTextFlags_CtrlEnterForNewLine);
    if (ImGui::IsItemActivated()) set_keyboard_visible(true);
    ImGui::PopItemWidth();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();

    ImGui::Spacing();

    /* Bottom controls row */
    const float btn = 36.0f;
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 18.0f);

    /* Attach */
    ImGui::PushStyleColor(ImGuiCol_Button, COL_PANEL2);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_BORDER);
    if (ImGui::Button("+##att", ImVec2(btn, btn))) {
      set_status_message("attach — file picker next phase");
    }
    ImGui::PopStyleColor(2);
    if (ImGui::IsItemHovered()) ImGui::SetTooltip("Attach file");

    /* Route pill */
    ImGui::SameLine(0, 6);
    const char *route_labs[] = {"INT", "EXT", "HYB"};
    ImGui::PushStyleColor(ImGuiCol_Button, COL_PANEL2);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_BORDER);
    if (ImGui::Button(route_labs[g_RouteMode % 3], ImVec2(48, btn))) {
      g_RouteMode = (g_RouteMode + 1) % 3;
      g_ModeExt = (g_RouteMode != 0);
    }
    ImGui::PopStyleColor(2);
    if (ImGui::IsItemHovered())
      ImGui::SetTooltip("AI Route: INT Local / EXT External / HYB Hybrid");

    /* Think pill */
    ImGui::SameLine(0, 6);
    if (g_ModeThink) {
      ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.102f, 0.180f, 0.039f, 1.0f));
      ImGui::PushStyleColor(ImGuiCol_Text, COL_ACCENT);
    } else {
      ImGui::PushStyleColor(ImGuiCol_Button, COL_PANEL2);
      ImGui::PushStyleColor(ImGuiCol_Text, COL_MUTED);
    }
    if (ImGui::Button("Think", ImVec2(56, btn)))
      g_ModeThink = !g_ModeThink;
    ImGui::PopStyleColor(2);

    /* Right side: mic + submit/stop */
    float right = ImGui::GetContentRegionAvail().x;
    ImGui::SameLine(ImGui::GetCursorPosX() + right - (btn * 2 + 8));

    /* Mic */
    if (g_VoiceListening) {
      ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.40f, 0.08f, 0.08f, 1.0f));
      ImGui::PushStyleColor(ImGuiCol_Text, COL_DANGER);
    } else {
      ImGui::PushStyleColor(ImGuiCol_Button, COL_PANEL2);
      ImGui::PushStyleColor(ImGuiCol_Text, COL_MUTED);
    }
    if (ImGui::Button("\xF0\x9F\x8E\xA4##mic", ImVec2(btn, btn))) { /* 🎤 */
      g_VoiceListening = !g_VoiceListening;
      set_status_message(g_VoiceListening ? "listening…" : "mic off");
    }
    ImGui::PopStyleColor(2);

    ImGui::SameLine(0, 8);

    if (generating) {
      ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.45f, 0.10f, 0.10f, 1.0f));
      ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_DANGER);
      ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1,1,1,1));
      if (ImGui::Button("##stop", ImVec2(btn, btn))) {
        athuex_worker_stop();
        set_status_message("stopping…");
      }
      {
        ImVec2 p = ImGui::GetItemRectMin();
        ImDrawList *dl = ImGui::GetWindowDrawList();
        dl->AddRectFilled(ImVec2(p.x + 11, p.y + 11), ImVec2(p.x + 25, p.y + 25),
                          ImGui::GetColorU32(ImVec4(1,1,1,0.95f)), 2.0f);
      }
      ImGui::PopStyleColor(3);
    } else {
      bool has_text = g_PromptBuf[0] != '\0';
      if (has_text) {
        ImGui::PushStyleColor(ImGuiCol_Button, COL_ACCENT);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.55f, 0.85f, 0.10f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, COL_BG);
      } else {
        ImGui::PushStyleColor(ImGuiCol_Button, COL_PANEL2);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_BORDER);
        ImGui::PushStyleColor(ImGuiCol_Text, COL_MUTED);
      }
      if (ImGui::Button("##send", ImVec2(btn, btn)) || (enter && has_text)) {
        if (has_text && !active_model.empty()) {
          std::string final_prompt;
          if (g_ModeThink)
            final_prompt += "Think step by step before answering.\n\n";
          if (g_ModeExt || g_RouteMode == 1)
            final_prompt += "Provide a detailed and complete answer.\n\n";
          final_prompt += "### Instruction:\n";
          final_prompt += g_PromptBuf;
          final_prompt += "\n\n### Response:\n";
          athuex_worker_start(active_model.c_str(), final_prompt.c_str(),
                              g_Threads, g_Ctx);
          g_PromptBuf[0] = '\0';
          set_status_message("");
          set_keyboard_visible(false);
        } else if (active_model.empty()) {
          set_status_message("no model — open Settings");
          g_ShowSettings = true;
        } else if (!has_text) {
          set_status_message("type a prompt");
        }
      }
      if (has_text) {
        ImVec2 p = ImGui::GetItemRectMin();
        ImDrawList *dl = ImGui::GetWindowDrawList();
        /* simple arrow glyph */
        dl->AddText(ImVec2(p.x + 10, p.y + 7), ImGui::GetColorU32(COL_BG), "\xE2\x9E\xA1"); /* ➡ */
      }
      ImGui::PopStyleColor(3);
    }

    ImGui::PopStyleVar(); /* FrameRounding */
    ImGui::EndChild();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
  }

  ImGui::End();
  ImGui::Render();
#endif


  glViewport(0, 0, g_WindowWidth, g_WindowHeight);
  glClearColor(0.051f, 0.067f, 0.090f, 1.0f); /* #0d1117 */
  glClear(GL_COLOR_BUFFER_BIT);
#if defined(ATHUEX_HAS_IMGUI)
  if (g_ImGuiReady.load() && ImGui::GetDrawData())
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
#endif
  if (g_EglDisplay != EGL_NO_DISPLAY && g_EglSurface != EGL_NO_SURFACE)
    eglSwapBuffers(g_EglDisplay, g_EglSurface);
}

static void render_loop() {
  init_egl();
#if defined(ATHUEX_HAS_IMGUI)
  if (!ImGui::GetCurrentContext()) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    {
      ImGuiIO &io = ImGui::GetIO();
      io.ConfigFlags |= ImGuiConfigFlags_IsTouchScreen;
      io.BackendFlags |= ImGuiBackendFlags_HasMouseCursors; /* harmless on Android */
    }
    ApplyAthuexTheme();
    ImGuiStyle &style = ImGui::GetStyle();
    /* Prefer real DisplayMetrics.density from Java; fall back to height heuristic. */
    float dens = g_Density;
    if (dens < 1.0f || dens > 4.5f) {
      dens = 2.0f;
      if (g_WindowHeight > 0) {
        dens = (float)g_WindowHeight / 720.0f;
        if (dens < 1.5f) dens = 1.5f;
        if (dens > 3.0f) dens = 3.0f;
      }
    }
    style.ScaleAllSizes(dens);
    float fontScale = (g_ScaledDensity > 0.5f && g_ScaledDensity < 5.0f)
                          ? g_ScaledDensity * 0.55f
                          : dens * 0.85f;
    if (fontScale < 1.0f) fontScale = 1.0f;
    if (fontScale > 3.5f) fontScale = 3.5f;
    ImGui::GetIO().FontGlobalScale = fontScale;
  }
  if (g_NativeWindow) {
    ImGui_ImplAndroid_Init(g_NativeWindow);
    ImGui_ImplOpenGL3_Init("#version 300 es");
    g_ImGuiReady = true;
    LOGI("ImGui ready dens=%.2f scaled=%.2f win=%dx%d", g_Density,
         g_ScaledDensity, g_WindowWidth, g_WindowHeight);
  }
#endif

  while (g_AppRunning.load() && g_SurfaceAlive.load()) {
    {
      std::unique_lock<std::mutex> lock(g_RenderMutex);
      g_RenderCond.wait(lock, [] {
        return g_RenderRequested.load() > 0 || !g_AppRunning.load() || !g_SurfaceAlive.load();
      });
      if (!g_AppRunning.load() || !g_SurfaceAlive.load()) break;
      /* Consume one frame credit; remaining credits keep the loop spinning. */
      g_RenderRequested.fetch_sub(1, std::memory_order_acq_rel);
    }
    if (g_EglDisplay == EGL_NO_DISPLAY || g_EglSurface == EGL_NO_SURFACE) {
      init_egl();
      if (g_EglDisplay == EGL_NO_DISPLAY) continue;
    }
    render_frame();
  }

#if defined(ATHUEX_HAS_IMGUI)
  if (g_ImGuiReady.load()) {
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplAndroid_Shutdown();
    g_ImGuiReady = false;
  }
  /* Keep ImGui context across surface recreations when possible; destroy only on full exit. */
  if (!g_AppRunning.load() && ImGui::GetCurrentContext()) {
    ImGui::DestroyContext();
  }
#endif
  term_egl_surface_only();
}

/* -------------------------------------------------------------------------- */
/* JNI entry points — package com.athuex.app.MainActivity                     */
/* -------------------------------------------------------------------------- */
extern "C" {

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeOnCreate(JNIEnv *env, jobject thiz,
                                                jstring storagePath) {
  g_AppRunning = true;
  env->GetJavaVM(&g_JavaVM);
  if (g_ActivityRef) env->DeleteGlobalRef(g_ActivityRef);
  g_ActivityRef = env->NewGlobalRef(thiz);
  jclass cls = env->GetObjectClass(thiz);
  g_ShowKeyboard = env->GetMethodID(cls, "showKeyboard", "()V");
  g_HideKeyboard = env->GetMethodID(cls, "hideKeyboard", "()V");
  g_OpenPicker = env->GetMethodID(cls, "openGgufPicker", "()V");
  athuex_input_bridge_init(env, thiz); /*v2.11.2*/
  athuex_input_set_wake(request_render);
  if (storagePath) {
    const char *p = env->GetStringUTFChars(storagePath, nullptr);
    if (p) {
      g_StoragePath = p;
      env->ReleaseStringUTFChars(storagePath, p);
    }
  }
  LOGI("nativeOnCreate storage=%s (v2.11.2)", g_StoragePath.c_str());
  if (!g_StoragePath.empty()) {
    athuex_worker_scan_models(g_StoragePath.c_str());
    if (athuex_worker_model_count() > 0 && active_model_snapshot().empty()) {
      const char *first_model = athuex_worker_model_at(0);
      if (first_model) set_active_model(first_model);
    }
  }
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeSetDensity(JNIEnv *, jobject,
                                                  jfloat density,
                                                  jfloat scaledDensity) {
  if (density > 0.5f && density < 5.0f) g_Density = density;
  if (scaledDensity > 0.5f && scaledDensity < 5.0f)
    g_ScaledDensity = scaledDensity;
  LOGI("nativeSetDensity density=%.2f scaled=%.2f", g_Density, g_ScaledDensity);
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeOnDestroy(JNIEnv *env, jobject) {
  g_AppRunning = false;
  g_SurfaceAlive = false;
  athuex_input_bridge_shutdown(); /*v2.11.2*/
  athuex_worker_shutdown();
  g_RenderRequested.fetch_add(1, std::memory_order_relaxed);
  g_RenderCond.notify_all();
  if (g_RenderThread.joinable()) g_RenderThread.join();
  term_egl();
#if defined(ATHUEX_HAS_IMGUI)
  if (ImGui::GetCurrentContext()) {
    ImGui::DestroyContext();
  }
  g_ImGuiReady = false;
#endif
  if (g_ActivityRef) {
    env->DeleteGlobalRef(g_ActivityRef);
    g_ActivityRef = nullptr;
  }
  g_ShowKeyboard = nullptr;
  g_HideKeyboard = nullptr;
  g_OpenPicker = nullptr;
  LOGI("nativeOnDestroy complete");
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeSurfaceCreated(JNIEnv *env, jobject,
                                                      jobject surface) {
  /* Stop previous render thread cleanly if any. */
  if (g_RenderThread.joinable()) {
    g_SurfaceAlive = false;
    g_RenderCond.notify_all();
    g_RenderThread.join();
  }
  g_NativeWindow = ANativeWindow_fromSurface(env, surface);
  g_SurfaceAlive = true;
  g_AppRunning = true;
  g_RenderThread = std::thread(render_loop);
  request_render();
  LOGI("nativeSurfaceCreated");
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeSurfaceChanged(JNIEnv *, jobject,
                                                      jint w, jint h) {
  g_WindowWidth = w;
  g_WindowHeight = h;
  request_render();
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeSurfaceDestroyed(JNIEnv *, jobject) {
  g_SurfaceAlive = false;
  g_RenderCond.notify_all();
  if (g_RenderThread.joinable()) g_RenderThread.join();
  term_egl_surface_only();
  if (g_NativeWindow) {
    ANativeWindow_release(g_NativeWindow);
    g_NativeWindow = nullptr;
  }
  LOGI("nativeSurfaceDestroyed");
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeOnTouchEvent(JNIEnv *, jobject,
                                                    jint action, jfloat x,
                                                    jfloat y) {
  /*v2.11.2: enqueue only — render thread applies to ImGuiIO */
  athuex_input_handle_motion_xy(action, x, y);
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeInjectChar(JNIEnv *, jobject,
                                                  jint code) {
  /*v2.11.2: enqueue only — render thread applies to ImGuiIO */
  athuex_input_inject_char(code);
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeInjectTextDelta(JNIEnv *env, jobject,
                                                        jint delete_count, jstring suffix) {
  if (!env) return;
  const jchar *chars = nullptr;
  jsize length = 0;
  if (suffix) {
    length = env->GetStringLength(suffix);
    chars = env->GetStringChars(suffix, nullptr);
    if (!chars && length > 0) return;
  }
  athuex_input_inject_text_delta(static_cast<int>(delete_count),
      reinterpret_cast<const uint16_t *>(chars), static_cast<int>(length));
  if (chars) env->ReleaseStringChars(suffix, chars);
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeClearInputBuffer(JNIEnv *, jobject) {
  /* Never mutate the ImGui-owned prompt from Android's UI thread. */
  g_ClearPromptRequested.store(true, std::memory_order_release);
  athuex_input_clear_composer(); /* clear queued keys + synchronize the IME */
  request_render();
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeOnModelPicked(JNIEnv *env, jobject,
                                                     jstring path) {
  if (!path) return;
  const char *p = env->GetStringUTFChars(path, nullptr);
  if (!p) return;
  const std::string picked_path(p);
  set_active_model(picked_path);
  if (!g_StoragePath.empty())
    athuex_worker_scan_models(g_StoragePath.c_str());
  set_status_message(std::string("model: ") + picked_path);
  env->ReleaseStringUTFChars(path, p);
  LOGI("nativeOnModelPicked %s", picked_path.c_str());
  request_render();
}



} /* extern "C" */
