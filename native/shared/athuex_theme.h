/* athuex_theme.h — shared ide.css design tokens
 * Used by the production ImGui path and the future Clay path.
 * Colours match the web shell / P02 Clay document.
 */
#ifndef ATHUEX_THEME_H
#define ATHUEX_THEME_H

#ifdef __cplusplus
extern "C" {
#endif

/* Layout constants (dp / logical pixels at density 1) */
#define ATH_TOOLBAR_H   52
#define ATH_CHIPBAR_H   44
#define ATH_FOOTER_H    24
#define ATH_CHATBAR_H   56
#define ATH_SIDE_W      280

/* Font IDs (Clay / ImGui mapping) */
#define ATH_FONT_BODY   0
#define ATH_FONT_HEAD   1
#define ATH_FONT_MONO   2

/* Colour helpers — ImGui uses ImVec4 / ImU32; Clay uses Clay_Color.
 * Callers convert as needed. Values are sRGB 0–255. */
typedef struct AthColor {
    unsigned char r, g, b, a;
} AthColor;

#define ATH_C(r,g,b)    ((AthColor){ (unsigned char)(r), (unsigned char)(g), (unsigned char)(b), 255 })
#define ATH_CA(r,g,b,a) ((AthColor){ (unsigned char)(r), (unsigned char)(g), (unsigned char)(b), (unsigned char)(a) })

/* Core palette (matches css/ide.css and P02) */
static const AthColor ATH_BG        = ATH_C(0x0D, 0x11, 0x17); /* #0d1117 */
static const AthColor ATH_TOP_BAR   = ATH_C(0x01, 0x04, 0x09); /* #010409 */
static const AthColor ATH_PANEL     = ATH_C(0x16, 0x1B, 0x22); /* #161b22 */
static const AthColor ATH_PANEL2    = ATH_C(0x21, 0x26, 0x2D); /* #21262d */
static const AthColor ATH_BORDER    = ATH_C(0x30, 0x36, 0x3D); /* #30363d */
static const AthColor ATH_TEXT      = ATH_C(0xE6, 0xED, 0xF3); /* #e6edf3 */
static const AthColor ATH_MUTED     = ATH_C(0x8B, 0x94, 0x9E); /* #8b949e */
static const AthColor ATH_ACCENT    = ATH_C(0x3F, 0xB9, 0x50); /* #3fb950 nvidia green */
static const AthColor ATH_ACCENT2   = ATH_C(0x2E, 0xA0, 0x43); /* darker green */
static const AthColor ATH_DANGER    = ATH_C(0xF8, 0x51, 0x49); /* #f85149 */
static const AthColor ATH_BLUE      = ATH_C(0x58, 0xA6, 0xFF); /* #58a6ff */
static const AthColor ATH_CHAT_AI_BG= ATH_C(0x12, 0x1A, 0x24);
static const AthColor ATH_CHAT_USER = ATH_C(0x1C, 0x2B, 0x3A);

#ifdef __cplusplus
}
#endif
#endif /* ATHUEX_THEME_H */
