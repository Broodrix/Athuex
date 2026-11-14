/* EGL + GLES3 renderer scaffold. Compiles on Android NDK.
 * Displays a clear color — proves the EGL context works.
 * RmlUi integration (HTML/CSS → vertex arrays) is the next ~500 lines. */

#include "render.h"
#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <android/native_window.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

struct athuex_render {
    EGLDisplay display;
    EGLSurface surface;
    EGLContext context;
    ANativeWindow *window;
    int w, h;
    uint32_t frame;
};

athuex_render *athuex_render_create(void *nw, int w, int h) {
    athuex_render *r = calloc(1, sizeof(*r));
    r->window = (ANativeWindow *)nw;
    r->w = w;
    r->h = h;

    r->display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (r->display == EGL_NO_DISPLAY) { free(r); return NULL; }

    EGLint major, minor;
    if (!eglInitialize(r->display, &major, &minor)) {
        fprintf(stderr, "[render] eglInitialize failed: 0x%x\n", eglGetError());
        free(r); return NULL;
    }
    printf("[render] EGL %d.%d\n", major, minor);

    const EGLint cfg_attr[] = {
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_SURFACE_TYPE,    EGL_WINDOW_BIT,
        EGL_RED_SIZE,   8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE,  8,
        EGL_ALPHA_SIZE, 8, EGL_DEPTH_SIZE, 24,
        EGL_NONE
    };
    EGLConfig cfg;
    EGLint n_cfg;
    if (!eglChooseConfig(r->display, cfg_attr, &cfg, 1, &n_cfg) || n_cfg == 0) {
        fprintf(stderr, "[render] eglChooseConfig failed\n");
        eglTerminate(r->display); free(r); return NULL;
    }

    const EGLint ctx_attr[] = { EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE };
    r->context = eglCreateContext(r->display, cfg, EGL_NO_CONTEXT, ctx_attr);
    if (r->context == EGL_NO_CONTEXT) {
        fprintf(stderr, "[render] eglCreateContext failed\n");
        eglTerminate(r->display); free(r); return NULL;
    }

    EGLint fmt;
    eglGetConfigAttrib(r->display, cfg, EGL_NATIVE_VISUAL_ID, &fmt);
    ANativeWindow_setBuffersGeometry(r->window, w, h, fmt);

    r->surface = eglCreateWindowSurface(r->display, cfg,
                                        (EGLNativeWindowType)r->window, NULL);
    if (r->surface == EGL_NO_SURFACE) {
        fprintf(stderr, "[render] eglCreateWindowSurface failed\n");
        eglDestroyContext(r->display, r->context);
        eglTerminate(r->display); free(r); return NULL;
    }
    if (!eglMakeCurrent(r->display, r->surface, r->surface, r->context)) {
        fprintf(stderr, "[render] eglMakeCurrent failed\n");
        eglDestroySurface(r->display, r->surface);
        eglDestroyContext(r->display, r->context);
        eglTerminate(r->display); free(r); return NULL;
    }

    printf("[render] GL %s\n", glGetString(GL_VERSION));
    glViewport(0, 0, w, h);
    return r;
}

void athuex_render_draw(athuex_render *r, uint64_t frame) {
    if (!r) return;
    /* Placeholder clear color — replace with RmlUi vertex draw */
    float t = (float)(frame % 120) / 120.0f;
    glClearColor(0.04f, 0.05f, 0.06f + 0.04f * t, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    eglSwapBuffers(r->display, r->surface);
    r->frame++;
}

void athuex_render_destroy(athuex_render *r) {
    if (!r) return;
    eglMakeCurrent(r->display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (r->surface != EGL_NO_SURFACE) eglDestroySurface(r->display, r->surface);
    if (r->context != EGL_NO_CONTEXT) eglDestroyContext(r->display, r->context);
    eglTerminate(r->display);
    free(r);
}