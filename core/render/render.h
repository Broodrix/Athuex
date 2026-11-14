#ifndef ATHUEX_RENDER_H
#define ATHUEX_RENDER_H

#include <stdint.h>
#include <stdbool.h>

typedef struct athuex_render athuex_render;

athuex_render *athuex_render_create(void *native_window, int w, int h);
void           athuex_render_draw(athuex_render *r, uint64_t frame);
void           athuex_render_destroy(athuex_render *r);

#endif