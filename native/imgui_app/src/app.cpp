/* Athuex native app — v2.11.1 pure-native ImGui
 * EGL + Dear ImGui (vendored), render-on-demand, JNI surface bridge.
 * v2.11.1: HTML-parity chat shell + generation perf (WantTextInput + transparent EditText), CSS design tokens,
 *         touch source events, CI workflow.
 * Production path for Android APK on Galaxy A06-class devices.
 */
#include <jni.h>
#include <android/native_window_jni.h>
#include <android/log.h>
#include <EGL/egl.h>
#include <GLES3/gl3.h>

#include <atomic>
#include <condition_variable>
#include <cstring>
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
  g_RenderRequested.fetch_add(1, std::memory_order_relaxed);
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

  const ImVec4 COL_ACCENT = ImVec4(0.46f, 0.72f, 0.00f, 1.0f);      /* #76b900 */
  const ImVec4 COL_MUTED  = ImVec4(0.545f, 0.580f, 0.620f, 1.0f);   /* #8b949e */
  const ImVec4 COL_TEXT   = ImVec4(0.902f, 0.929f, 0.953f, 1.0f);   /* #e6edf3 */
  const ImVec4 COL_PANEL2 = ImVec4(0.129f, 0.149f, 0.176f, 1.0f);   /* #21262d */

  /* ── Toolbar (matches .toolbar ~52px) ───────────────────────── */
  {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.086f, 0.106f, 0.133f, 1.0f));
    ImGui::BeginChild("toolbar", ImVec2(0, 48), false, ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored(COL_ACCENT, "Athuex");
    ImGui::SameLine();
    ImGui::TextColored(COL_MUTED, "AI");
    if (!active_model.empty()) {
      const char *base = strrchr(active_model.c_str(), '/');
      base = base ? base + 1 : active_model.c_str();
      ImGui::SameLine();
      ImGui::TextColored(COL_MUTED, "·");
      ImGui::SameLine();
      ImGui::TextColored(COL_TEXT, "%.28s", base);
    }
    /* right-side metrics */
    char met[64];
    if (athuex_worker_is_active()) {
      int tok = athuex_worker_token_count();
      float sec = athuex_worker_elapsed_ms() / 1000.0f;
      float tps = (sec > 0.05f) ? (tok / sec) : 0.0f;
      snprintf(met, sizeof(met), "%.1f t/s · %d tok", tps, tok);
    } else if (!status_msg.empty()) {
      snprintf(met, sizeof(met), "%s", status_msg.c_str());
    } else {
      snprintf(met, sizeof(met), "Ready");
    }
    ImVec2 ts = ImGui::CalcTextSize(met);
    ImGui::SameLine(ImGui::GetWindowWidth() - ts.x - 12.0f);
    ImGui::TextColored(athuex_worker_is_active() ? COL_ACCENT : COL_MUTED, "%s", met);
    ImGui::EndChild();
    ImGui::PopStyleColor();
  }

  /* ── Quickbar chips (Chat active; others reserved) ──────────── */
  {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.004f, 0.016f, 0.035f, 1.0f));
    ImGui::BeginChild("quickbar", ImVec2(0, 40), false, ImGuiWindowFlags_NoScrollbar);
    const char *labs[] = {"Chat", "Files", "Edit", "Tools"};
    float chipW = (ImGui::GetContentRegionAvail().x - 3 * 6.0f) / 4.0f;
    if (chipW < 56.0f) chipW = 56.0f;
    for (int i = 0; i < 4; ++i) {
      if (i) ImGui::SameLine(0, 6);
      bool on = (i == 0);
      if (on) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.102f, 0.180f, 0.039f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.102f, 0.180f, 0.039f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.706f, 0.969f, 0.494f, 1.0f));
      } else {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0,0,0,0));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, COL_PANEL2);
        ImGui::PushStyleColor(ImGuiCol_Text, COL_MUTED);
      }
      ImGui::Button(labs[i], ImVec2(chipW, 30));
      ImGui::PopStyleColor(3);
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
  }

  /* ── Engine (compact, collapsed by default after model set) ─── */
  ImGuiTreeNodeFlags engFlags = active_model.empty()
      ? ImGuiTreeNodeFlags_DefaultOpen
      : ImGuiTreeNodeFlags_None;
  if (ImGui::CollapsingHeader("Engine", engFlags)) {
    const char *preview = active_model.empty()
                              ? "(tap Browse for .gguf)"
                              : active_model.c_str();
    if (ImGui::BeginCombo("##gguf", preview)) {
      int n = athuex_worker_model_count();
      for (int i = 0; i < n; ++i) {
        const char *path = athuex_worker_model_at(i);
        if (!path) continue;
        bool selected = (active_model == path);
        const char *base = strrchr(path, '/');
        base = base ? base + 1 : path;
        if (ImGui::Selectable(base, selected)) { active_model = path; set_active_model(active_model); }
        if (selected) ImGui::SetItemDefaultFocus();
      }
      ImGui::EndCombo();
    }
    ImGui::SameLine();
    if (ImGui::Button("Browse")) open_gguf_picker();
    ImGui::SliderInt("Threads", &g_Threads, 1, 4);
    ImGui::SliderInt("Context", &g_Ctx, 2048, 4096);
  }

  /* ── Chat messages ──────────────────────────────────────────── */
  float footer = ImGui::GetFrameHeightWithSpacing() * 5.8f;
  ImGui::BeginChild("Chat", ImVec2(0, -footer), true);
  const char *history = athuex_worker_sync_text();
  if (history && history[0]) {
    /* Role-aware wrap without per-line child windows (stable IDs, low cost). */
    const char *line = history;
    while (*line) {
      const char *nl = strchr(line, '\n');
      int len = nl ? (int)(nl - line) : (int)strlen(line);
      if (len >= 5 && strncmp(line, "You: ", 5) == 0) {
        ImGui::Spacing();
        ImGui::TextColored(COL_MUTED, "USER");
        ImGui::PushStyleColor(ImGuiCol_Text, COL_TEXT);
        ImGui::TextWrapped("%.*s", len - 5, line + 5);
        ImGui::PopStyleColor();
      } else if (len >= 8 && strncmp(line, "Athuex: ", 8) == 0) {
        ImGui::Spacing();
        ImGui::TextColored(COL_ACCENT, "AI");
        ImGui::TextWrapped("%.*s", len - 8, line + 8);
      } else if (len > 0) {
        ImGui::TextWrapped("%.*s", len, line);
      }
      if (!nl) break;
      line = nl + 1;
    }
  } else {
    ImGui::TextColored(COL_MUTED, "Ask anything…");
  }
  if (athuex_worker_is_active()) {
    ImGui::SetScrollHereY(1.0f);
    request_render();
  }
  ImGui::EndChild();

  ImGui::Separator();

  /* ── Mode chips ─────────────────────────────────────────────── */
  ImGui::Checkbox("Think", &g_ModeThink);
  ImGui::SameLine();
  ImGui::Checkbox("EXT", &g_ModeExt);

  /* ── Composer ───────────────────────────────────────────────── */
  ImGui::PushItemWidth(-1.0f);
  bool enter = ImGui::InputTextMultiline(
      "##prompt", g_PromptBuf, sizeof(g_PromptBuf),
      ImVec2(-1.0f, ImGui::GetTextLineHeight() * 2.6f),
      ImGuiInputTextFlags_EnterReturnsTrue |
          ImGuiInputTextFlags_CtrlEnterForNewLine);
  if (ImGui::IsItemActivated()) set_keyboard_visible(true);
  ImGui::PopItemWidth();

  if (athuex_worker_is_active()) {
    if (ImGui::Button("Stop", ImVec2(-FLT_MIN, 0))) {
      athuex_worker_stop();
      status_msg = "stopping…"; set_status_message(status_msg);
    }
  } else {
    if (ImGui::Button("Send", ImVec2(-FLT_MIN, 0)) || enter) {
      if (g_PromptBuf[0] && !active_model.empty()) {
        std::string final_prompt;
        if (g_ModeThink)
          final_prompt += "Think step by step before answering.\n\n";
        if (g_ModeExt)
          final_prompt += "Provide a detailed and complete answer.\n\n";
        /* Lightweight instruct wrapper — helps Qwen/instruct GGUFs stay coherent */
        final_prompt += "### Instruction:\n";
        final_prompt += g_PromptBuf;
        final_prompt += "\n\n### Response:\n";
        athuex_worker_start(active_model.c_str(), final_prompt.c_str(),
                            g_Threads, g_Ctx);
        g_PromptBuf[0] = '\0';
        status_msg.clear(); set_status_message(status_msg);
        set_keyboard_visible(false);
      } else if (active_model.empty()) {
        status_msg = "no model — Browse"; set_status_message(status_msg);
      } else if (!g_PromptBuf[0]) {
        status_msg = "type a prompt"; set_status_message(status_msg);
      }
    }
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
      g_RenderRequested.store(0);
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
  if (storagePath) {
    const char *p = env->GetStringUTFChars(storagePath, nullptr);
    if (p) {
      g_StoragePath = p;
      env->ReleaseStringUTFChars(storagePath, p);
    }
  }
  LOGI("nativeOnCreate storage=%s (v2.11.1)", g_StoragePath.c_str());
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
#if defined(ATHUEX_HAS_IMGUI)
  if (!g_ImGuiReady.load()) return;
  ImGuiIO &io = ImGui::GetIO();
  io.AddMouseSourceEvent(ImGuiMouseSource_TouchScreen);
  io.AddMousePosEvent(x, y);
  /* MotionEvent actionMasked: 0=DOWN, 1=UP, 2=MOVE, 3=CANCEL, 5/6=POINTER */
  if (action == 0 || action == 5) {
    io.AddMouseButtonEvent(0, true);
  } else if (action == 1 || action == 3 || action == 6) {
    io.AddMouseButtonEvent(0, false);
  }
  /* action == 2 (MOVE): position only — already set above */
#else
  (void)action;
  (void)x;
  (void)y;
#endif
  request_render();
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeInjectChar(JNIEnv *, jobject,
                                                  jint code) {
#if defined(ATHUEX_HAS_IMGUI)
  if (!g_ImGuiReady.load()) return;
  ImGuiIO &io = ImGui::GetIO();
  if (code == 8) {
    io.AddKeyEvent(ImGuiKey_Backspace, true);
    io.AddKeyEvent(ImGuiKey_Backspace, false);
  } else if (code == 10 || code == 13) {
    /* Soft keyboard Enter — drive both character and key so multiline + EnterReturnsTrue work */
    io.AddInputCharacter('\n');
    io.AddKeyEvent(ImGuiKey_Enter, true);
    io.AddKeyEvent(ImGuiKey_Enter, false);
  } else if (code >= 32) {
    io.AddInputCharacter(static_cast<unsigned int>(code));
  }
#endif
  request_render();
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeClearInputBuffer(JNIEnv *, jobject) {
  g_PromptBuf[0] = '\0';
}

JNIEXPORT void JNICALL
Java_com_athuex_app_MainActivity_nativeOnModelPicked(JNIEnv *env, jobject,
                                                     jstring path) {
  if (!path) return;
  const char *p = env->GetStringUTFChars(path, nullptr);
  if (!p) return;
  set_active_model(p);
  if (!g_StoragePath.empty())
    athuex_worker_scan_models(g_StoragePath.c_str());
  set_status_message(std::string("model: ") + p);
  env->ReleaseStringUTFChars(path, p);
  LOGI("nativeOnModelPicked %s", p);
  request_render();
}



} /* extern "C" */
