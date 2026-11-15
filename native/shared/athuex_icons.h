#pragma once
/* athuex_icons.h — DPI-aware vector glyphs for Athuex ImGui UI (Galaxy A06 safe)
 * Drawn on normalized [-1,1] grid; no emoji font required.
 */
#include "imgui.h"
#include <cmath>

enum class AthuexIcon {
  SendUp, Stop, Mic, Waveform, Attach, Sparkles,
  Copy, Check, Retry, ThumbUp, ThumbDown,
  Menu, NewChat, Search, Settings, Trash,
  Code, Terminal, Folder, ChevronDown, Play
};

inline void DrawAthuexIcon(ImDrawList* dl, AthuexIcon icon, ImVec2 center, float size, ImU32 col) {
  if (!dl || size < 1.0f) return;
  const float r = size * 0.5f;
  const float t = size * 0.085f;
  const float cx = center.x, cy = center.y;
  auto P = [&](float x, float y) { return ImVec2(cx + x * r, cy + y * r); };

  switch (icon) {
    case AthuexIcon::SendUp: {
      dl->AddLine(P(0.0f, 0.55f), P(0.0f, -0.50f), col, t);
      dl->AddLine(P(-0.42f, -0.10f), P(0.0f, -0.55f), col, t);
      dl->AddLine(P(0.42f, -0.10f), P(0.0f, -0.55f), col, t);
      break;
    }
    case AthuexIcon::Stop: {
      dl->AddRectFilled(P(-0.42f, -0.42f), P(0.42f, 0.42f), col, size * 0.12f);
      break;
    }
    case AthuexIcon::Mic: {
      dl->AddRectFilled(P(-0.22f, -0.65f), P(0.22f, 0.10f), col, r * 0.22f);
      dl->PathArcTo(P(0.0f, -0.05f), r * 0.48f, 0.0f, 3.14159f, 16);
      dl->PathStroke(col, 0, t * 0.85f);
      dl->AddLine(P(0.0f, 0.43f), P(0.0f, 0.72f), col, t * 0.85f);
      dl->AddLine(P(-0.28f, 0.72f), P(0.28f, 0.72f), col, t * 0.85f);
      break;
    }
    case AthuexIcon::Waveform: {
      float heights[] = {0.25f, 0.65f, 0.40f, 0.75f, 0.30f};
      for (int i = 0; i < 5; ++i) {
        float x = -0.56f + i * 0.28f;
        dl->AddLine(P(x, -heights[i]), P(x, heights[i]), col, t * 0.9f);
      }
      break;
    }
    case AthuexIcon::Attach: {
      dl->AddLine(P(-0.25f, 0.20f), P(0.30f, -0.35f), col, t * 0.85f);
      dl->PathArcTo(P(0.18f, -0.23f), r * 0.26f, -2.35f, 0.78f, 12);
      dl->PathStroke(col, 0, t * 0.85f);
      dl->AddLine(P(0.36f, -0.05f), P(-0.18f, 0.50f), col, t * 0.85f);
      dl->PathArcTo(P(-0.04f, 0.36f), r * 0.34f, 0.78f, 3.92f, 12);
      dl->PathStroke(col, 0, t * 0.85f);
      dl->AddLine(P(-0.28f, 0.12f), P(0.12f, -0.28f), col, t * 0.85f);
      break;
    }
    case AthuexIcon::Sparkles: {
      ImVec2 pts[] = {
        P(0.0f, -0.70f), P(0.18f, -0.18f), P(0.70f, 0.0f), P(0.18f, 0.18f),
        P(0.0f, 0.70f), P(-0.18f, 0.18f), P(-0.70f, 0.0f), P(-0.18f, -0.18f)};
      dl->AddConvexPolyFilled(pts, 8, col);
      dl->AddCircleFilled(P(0.45f, -0.45f), r * 0.12f, col, 8);
      dl->AddCircleFilled(P(-0.50f, 0.35f), r * 0.09f, col, 8);
      break;
    }
    case AthuexIcon::Copy: {
      dl->AddRect(P(-0.15f, -0.45f), P(0.55f, 0.25f), col, size * 0.08f, 0, t * 0.8f);
      dl->AddRect(P(-0.55f, -0.15f), P(0.15f, 0.55f), col, size * 0.08f, 0, t * 0.8f);
      break;
    }
    case AthuexIcon::Check: {
      dl->AddLine(P(-0.45f, 0.05f), P(-0.10f, 0.40f), col, t);
      dl->AddLine(P(-0.10f, 0.40f), P(0.55f, -0.40f), col, t);
      break;
    }
    case AthuexIcon::Retry: {
      dl->PathArcTo(P(0.0f, 0.0f), r * 0.48f, -2.2f, 2.4f, 20);
      dl->PathStroke(col, 0, t * 0.9f);
      dl->AddTriangleFilled(P(0.42f, -0.35f), P(0.68f, -0.05f), P(0.28f, -0.05f), col);
      break;
    }
    case AthuexIcon::ThumbUp: {
      dl->AddRectFilled(P(-0.45f, 0.05f), P(-0.20f, 0.55f), col, 2.0f);
      dl->AddLine(P(-0.20f, 0.05f), P(0.05f, -0.40f), col, t);
      dl->AddLine(P(0.05f, -0.40f), P(0.35f, -0.40f), col, t);
      dl->AddLine(P(0.35f, -0.40f), P(0.45f, 0.05f), col, t);
      dl->AddLine(P(0.45f, 0.05f), P(0.45f, 0.55f), col, t);
      dl->AddLine(P(0.45f, 0.55f), P(-0.20f, 0.55f), col, t);
      break;
    }
    case AthuexIcon::ThumbDown: {
      dl->AddRectFilled(P(-0.45f, -0.55f), P(-0.20f, -0.05f), col, 2.0f);
      dl->AddLine(P(-0.20f, -0.05f), P(0.05f, 0.40f), col, t);
      dl->AddLine(P(0.05f, 0.40f), P(0.35f, 0.40f), col, t);
      dl->AddLine(P(0.35f, 0.40f), P(0.45f, -0.05f), col, t);
      dl->AddLine(P(0.45f, -0.05f), P(0.45f, -0.55f), col, t);
      dl->AddLine(P(0.45f, -0.55f), P(-0.20f, -0.55f), col, t);
      break;
    }
    case AthuexIcon::Menu: {
      dl->AddLine(P(-0.55f, -0.40f), P(0.55f, -0.40f), col, t);
      dl->AddLine(P(-0.55f, 0.0f), P(0.55f, 0.0f), col, t);
      dl->AddLine(P(-0.55f, 0.40f), P(0.55f, 0.40f), col, t);
      break;
    }
    case AthuexIcon::NewChat: {
      dl->AddRect(P(-0.50f, -0.50f), P(0.50f, 0.50f), col, size * 0.1f, 0, t * 0.85f);
      dl->AddLine(P(0.0f, -0.28f), P(0.0f, 0.28f), col, t);
      dl->AddLine(P(-0.28f, 0.0f), P(0.28f, 0.0f), col, t);
      break;
    }
    case AthuexIcon::Search: {
      dl->AddCircle(P(-0.12f, -0.12f), r * 0.44f, col, 20, t * 0.85f);
      dl->AddLine(P(0.20f, 0.20f), P(0.58f, 0.58f), col, t * 0.95f);
      break;
    }
    case AthuexIcon::Settings: {
      dl->AddCircle(P(0.0f, 0.0f), r * 0.34f, col, 16, t * 0.85f);
      for (int i = 0; i < 8; ++i) {
        float a = i * 0.785398f;
        dl->AddLine(P(cosf(a) * 0.44f, sinf(a) * 0.44f),
                    P(cosf(a) * 0.64f, sinf(a) * 0.64f), col, t * 0.9f);
      }
      break;
    }
    case AthuexIcon::Trash: {
      dl->AddLine(P(-0.52f, -0.35f), P(0.52f, -0.35f), col, t * 0.8f);
      dl->AddLine(P(-0.20f, -0.55f), P(0.20f, -0.55f), col, t * 0.8f);
      dl->AddLine(P(-0.38f, -0.35f), P(-0.30f, 0.55f), col, t * 0.8f);
      dl->AddLine(P(0.38f, -0.35f), P(0.30f, 0.55f), col, t * 0.8f);
      dl->AddLine(P(-0.30f, 0.55f), P(0.30f, 0.55f), col, t * 0.8f);
      break;
    }
    case AthuexIcon::Code: {
      dl->AddLine(P(-0.25f, -0.35f), P(-0.62f, 0.0f), col, t * 0.85f);
      dl->AddLine(P(-0.62f, 0.0f), P(-0.25f, 0.35f), col, t * 0.85f);
      dl->AddLine(P(0.25f, -0.35f), P(0.62f, 0.0f), col, t * 0.85f);
      dl->AddLine(P(0.62f, 0.0f), P(0.25f, 0.35f), col, t * 0.85f);
      dl->AddLine(P(0.10f, -0.45f), P(-0.10f, 0.45f), col, t * 0.8f);
      break;
    }
    case AthuexIcon::Terminal: {
      dl->AddRect(P(-0.60f, -0.48f), P(0.60f, 0.48f), col, size * 0.1f, 0, t * 0.8f);
      dl->AddLine(P(-0.35f, -0.18f), P(-0.12f, 0.02f), col, t * 0.85f);
      dl->AddLine(P(-0.12f, 0.02f), P(-0.35f, 0.22f), col, t * 0.85f);
      dl->AddLine(P(-0.02f, 0.22f), P(0.32f, 0.22f), col, t * 0.85f);
      break;
    }
    case AthuexIcon::Folder: {
      ImVec2 p[] = {P(-0.60f, -0.45f), P(-0.15f, -0.45f), P(0.0f, -0.28f),
                    P(0.60f, -0.28f), P(0.60f, 0.48f), P(-0.60f, 0.48f)};
      dl->AddPolyline(p, 6, col, ImDrawFlags_Closed, t * 0.8f);
      break;
    }
    case AthuexIcon::ChevronDown: {
      dl->AddLine(P(-0.42f, -0.18f), P(0.0f, 0.25f), col, t * 0.9f);
      dl->AddLine(P(0.0f, 0.25f), P(0.42f, -0.18f), col, t * 0.9f);
      break;
    }
    case AthuexIcon::Play: {
      dl->AddTriangleFilled(P(-0.32f, -0.48f), P(0.52f, 0.0f), P(-0.32f, 0.48f), col);
      break;
    }
  }
}

inline bool IconButton(const char* id, AthuexIcon icon, float btn_size, ImU32 icon_col, float icon_ratio = 0.52f) {
  bool pressed = ImGui::Button(id, ImVec2(btn_size, btn_size));
  ImVec2 min = ImGui::GetItemRectMin();
  ImVec2 max = ImGui::GetItemRectMax();
  ImVec2 center((min.x + max.x) * 0.5f, (min.y + max.y) * 0.5f);
  DrawAthuexIcon(ImGui::GetWindowDrawList(), icon, center, btn_size * icon_ratio, icon_col);
  return pressed;
}
