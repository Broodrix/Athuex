/* Athuex input module — v2.11.2
 * Single thread-safe path: producers (JNI / UI thread) enqueue;
 * only the render thread touches ImGuiIO via athuex_input_drain().
 * Zero per-frame allocation after warmup. Bounded queues.
 */
#pragma once
#include <stdint.h>

struct AInputEvent;
struct _JNIEnv;
typedef struct _JNIEnv JNIEnv;
struct _jobject;
typedef struct _jobject *jobject;

#ifdef __cplusplus
extern "C" {
#endif

void athuex_input_set_wake(void (*fn)(void));
void athuex_input_drain(void); /* render thread only, before NewFrame */

/* Motion events (from nativeOnTouchEvent / AInputEvent path). */
int athuex_input_handle_motion_xy(int action, float x, float y);

/* Character / key injection from soft-keyboard EditText (UI thread). */
void athuex_input_inject_char(int code);
void athuex_input_inject_text_delta(int delete_count, const uint16_t *text, int text_len);

void athuex_input_bridge_init(JNIEnv *env, jobject activity);
void athuex_input_bridge_shutdown(void);

/* Clear pending text + ask Java to reset the composer EditText. */
void athuex_input_clear_composer(void);

#ifdef __cplusplus
}
#endif
