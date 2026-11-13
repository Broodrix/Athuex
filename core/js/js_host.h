#ifndef ATHUEX_JS_HOST_H
#define ATHUEX_JS_HOST_H

#include "athuex.h"

typedef struct athuex_js athuex_js;

athuex_js *athuex_js_create(athuex_ctx *ctx);
int        athuex_js_eval(athuex_js *js, const char *src, const char *filename);
int        athuex_js_eval_file(athuex_js *js, const char *path);
void       athuex_js_destroy(athuex_js *js);

#endif