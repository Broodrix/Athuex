#pragma once
#include "imgui.h"
#include "imgui_internal.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace MTechno {

struct ScrollMarker {
    float y = 0.0f;
    std::string label;
    int level = 1;
};

struct MobileScrollConfig {
    float touchFriction = 0.94f;
    float minFlingVel = 120.0f;
    float maxFlingVel = 4500.0f;
    float dragDeadzone = 6.0f;
    bool alwaysVisible = false;
    float hideDelay = 1.1f;
    float hitWidth = 28.0f;
    float thumbWidth = 6.0f;
    float thumbWidthHot = 12.0f;
    float minThumbHeight = 44.0f;
    float edgePadding = 3.0f;
    bool showSections = true;
    bool showPins = true;
    bool lightBackground = false;
    bool lowSpecMode = true;
};

class MobileScrollWidget {
public:
    MobileScrollConfig cfg;

    void SetResumePosition(float savedY) {
        if (savedY > 150.0f) {
            resumeY_ = savedY;
            showResumeChip_ = true;
        }
    }

    float GetScrollY() const { return pos_; }

    void AddSectionMarker(const char* title, int level = 1) {
        if (!cfg.showSections || !title) return;
        if (sectionsNext_ >= sections_.size()) {
            sections_.push_back(ScrollMarker{});
        }
        ScrollMarker& s = sections_[sectionsNext_];
        s.y = ImGui::GetCursorPosY();
        s.label = title;
        s.level = level;
        ++sectionsNext_;
    }

    void TogglePinAtCurrent(const char* customLabel = nullptr) {
        if (maxScrollY_ <= 0.0f) return;
        for (size_t i = 0; i < pins_.size(); ++i) {
            if (std::abs(pins_[i].y - pos_) < viewH_ * 0.18f) {
                pins_.erase(pins_.begin() + i);
                ShowToast("Pin removed");
                return;
            }
        }
        if (pins_.size() >= 25) {
            ShowToast("Max 25 pins reached");
            return;
        }
        char buf[64];
        if (customLabel && customLabel[0]) {
            std::snprintf(buf, sizeof(buf), "Pin %d: %s", (int)pins_.size() + 1, customLabel);
        } else {
            const char* sec = FindCurrentSectionLabel(pos_);
            if (sec) std::snprintf(buf, sizeof(buf), "Pin %d: %s", (int)pins_.size() + 1, sec);
            else     std::snprintf(buf, sizeof(buf), "Pin %d", (int)pins_.size() + 1);
        }
        ScrollMarker m;
        m.y = pos_;
        m.label = buf;
        m.level = 1;
        pins_.push_back(std::move(m));
        std::sort(pins_.begin(), pins_.end(),
                  [](const ScrollMarker& a, const ScrollMarker& b) { return a.y < b.y; });
        ShowToast(buf);
        Reveal();
    }

    void Begin(const char* id, ImVec2 size = ImVec2(0, 0), float dpiScale = 1.0f) {
        dpi_ = dpiScale > 0.1f ? dpiScale : 1.0f;
        sectionsNext_ = 0;

        ImGuiWindowFlags flags = ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse;
        ImGui::BeginChild(id, size, false, flags);

        ImGuiWindow* win = ImGui::GetCurrentWindow();
        winPos_  = win->Pos;
        winSize_ = win->Size;
        viewH_   = win->InnerRect.GetHeight();

        if (!initialized_) {
            pos_ = win->Scroll.y;
            initialized_ = true;
        }

        UpdateTouchAndPhysics(win);

        ImVec2 savedCursor = ImGui::GetCursorScreenPos();
        if (showBackChip_ || showResumeChip_) {
            ImVec2 cMin, cMax;
            GetChipBounds(cMin, cMax);
            ImGui::SetCursorScreenPos(cMin);
            if (ImGui::InvisibleButton("##mtechno_mobile_chip", ImVec2(cMax.x - cMin.x, cMax.y - cMin.y))) {
                if (showBackChip_) {
                    showBackChip_ = false;
                    JumpTo(backY_, false);
                } else {
                    showResumeChip_ = false;
                    JumpTo(resumeY_, true);
                }
            }
        }
        ImGui::SetCursorScreenPos(savedCursor);
    }

    void End() {
        ImGuiWindow* win = ImGui::GetCurrentWindow();
        maxScrollY_ = win->ScrollMax.y;

        if (showResumeChip_ && (maxScrollY_ <= viewH_ * 0.3f || resumeY_ > maxScrollY_)) {
            showResumeChip_ = false;
        }

        RenderOverlay(win);
        ImGui::EndChild();
    }

    void Reset() {
        initialized_   = false;
        pos_ = velocity_ = maxScrollY_ = viewH_ = 0.0f;
        winPos_ = winSize_ = ImVec2(0, 0);
        touchMode_     = TouchMode::None;
        touchStartY_   = touchLastY_ = scrollStartY_ = 0.0f;
        passedDeadzone_ = false;
        revealTimer_   = 0.0f;
        showBackChip_  = false;
        backY_ = backTimer_ = 0.0f;
        showResumeChip_ = false;
        resumeY_       = 0.0f;
        toastText_.clear();
        toastTimer_    = 0.0f;
        pins_.clear();
        sections_.clear();
        sectionsNext_  = 0;
    }

private:
    bool  initialized_ = false;
    float dpi_         = 1.0f;
    float pos_         = 0.0f;
    float velocity_    = 0.0f;
    float maxScrollY_  = 0.0f;
    float viewH_       = 0.0f;
    ImVec2 winPos_, winSize_;

    enum class TouchMode { None, ContentPan, ThumbScrub };
    TouchMode touchMode_ = TouchMode::None;
    float touchStartY_   = 0.0f;
    float touchLastY_    = 0.0f;
    float scrollStartY_  = 0.0f;
    bool  passedDeadzone_ = false;

    float revealTimer_ = 0.0f;
    bool  showBackChip_ = false;
    float backY_       = 0.0f;
    float backTimer_   = 0.0f;

    bool  showResumeChip_ = false;
    float resumeY_        = 0.0f;

    std::string toastText_;
    float toastTimer_ = 0.0f;

    std::vector<ScrollMarker> sections_;
    std::vector<ScrollMarker> pins_;
    size_t sectionsNext_ = 0;

    static float Clamp(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }

    void Reveal() { revealTimer_ = cfg.hideDelay; }

    void ShowToast(const char* msg, float sec = 1.4f) {
        toastText_ = msg;
        toastTimer_ = sec;
    }

    const char* FindCurrentSectionLabel(float y) const {
        for (int i = (int)sectionsNext_ - 1; i >= 0; --i) {
            if (sections_[i].y <= y + 60.0f * dpi_) return sections_[i].label.c_str();
        }
        return nullptr;
    }

    void JumpTo(float targetY, bool offerBack = true) {
        if (maxScrollY_ <= 0.0f) return;
        float to = Clamp(targetY, 0.0f, maxScrollY_);
        if (offerBack && std::abs(to - pos_) > viewH_ * 1.1f) {
            backY_ = pos_;
            showBackChip_ = true;
            backTimer_ = 6.5f;
            showResumeChip_ = false;
        }
        pos_ = to;
        velocity_ = 0.0f;
        ImGuiWindow* win = ImGui::GetCurrentWindow();
        if (win) {
            win->Scroll.y = pos_;
            win->ScrollTarget.y = pos_;
        }
        Reveal();
    }

    void GetChipBounds(ImVec2& cMin, ImVec2& cMax) const {
        const char* labelText = showBackChip_ ? "<  Back to previous position"
                                              : ">  Resume where you left off";
        char pctBuf[16] = "";
        if (showResumeChip_ && maxScrollY_ > 0.0f) {
            float r = Clamp(resumeY_ / maxScrollY_, 0.0f, 1.0f);
            std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", (int)std::round(r * 100.0f));
        }
        ImVec2 sz = ImGui::CalcTextSize(labelText);
        float subW = pctBuf[0] ? (ImGui::CalcTextSize(pctBuf).x + 12.0f * dpi_) : 0.0f;
        float chipW = sz.x + subW + 28.0f * dpi_;
        float chipH = 34.0f * dpi_;
        cMax = ImVec2(winPos_.x + winSize_.x - 16.0f * dpi_,
                      winPos_.y + winSize_.y - 16.0f * dpi_);
        cMin = ImVec2(cMax.x - chipW, cMax.y - chipH);
    }

    void UpdateTouchAndPhysics(ImGuiWindow* win) {
        ImGuiIO& io = ImGui::GetIO();
        float dt = Clamp(io.DeltaTime, 0.001f, 0.05f);

        if (revealTimer_ > 0.0f) revealTimer_ -= dt;
        if (toastTimer_  > 0.0f) toastTimer_  -= dt;
        if (backTimer_   > 0.0f) {
            backTimer_ -= dt;
            if (backTimer_ <= 0.0f) showBackChip_ = false;
        }

        if (maxScrollY_ <= 0.0f) {
            pos_ = velocity_ = 0.0f;
            win->Scroll.y = 0.0f;
            win->ScrollTarget.y = 0.0f;
            return;
        }

        float hitW = cfg.hitWidth * dpi_;
        ImVec2 trackMin(winPos_.x + winSize_.x - hitW, winPos_.y);
        ImVec2 trackMax(winPos_.x + winSize_.x,        winPos_.y + winSize_.y);

        bool inWindow = ImGui::IsMouseHoveringRect(winPos_,
                          ImVec2(winPos_.x + winSize_.x, winPos_.y + winSize_.y), false);
        bool inTrack  = ImGui::IsMouseHoveringRect(trackMin, trackMax, false);

        if (inWindow && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            touchStartY_  = touchLastY_ = io.MousePos.y;
            scrollStartY_ = pos_;
            velocity_ = 0.0f;
            passedDeadzone_ = false;

            if (inTrack) {
                touchMode_ = TouchMode::ThumbScrub;
                passedDeadzone_ = true;
                ImGui::ClearActiveID();
                Reveal();
            } else {
                touchMode_ = TouchMode::ContentPan;
            }
        }

        if (touchMode_ != TouchMode::None && ImGui::IsMouseDown(ImGuiMouseButton_Left)) {
            float dy = io.MousePos.y - touchStartY_;

            if (touchMode_ == TouchMode::ContentPan) {
                if (!passedDeadzone_ && std::abs(dy) > cfg.dragDeadzone * dpi_) {
                    passedDeadzone_ = true;
                    if (dy > 0.0f) scrollStartY_ += cfg.dragDeadzone * dpi_;
                    else           scrollStartY_ -= cfg.dragDeadzone * dpi_;
                    ImGui::ClearActiveID();
                }
                if (passedDeadzone_) {
                    float frameDy = io.MousePos.y - touchLastY_;
                    pos_ = Clamp(scrollStartY_ - dy, 0.0f, maxScrollY_);
                    float instVel = -frameDy / dt;
                    velocity_ = velocity_ * 0.45f + instVel * 0.55f;
                    Reveal();
                }
            } else if (touchMode_ == TouchMode::ThumbScrub) {
                float pad    = cfg.edgePadding * dpi_;
                float innerH = winSize_.y - pad * 2.0f;
                float thumbH = Clamp(innerH * (viewH_ / (viewH_ + maxScrollY_)),
                                     cfg.minThumbHeight * dpi_, innerH);
                float travel = std::max(1.0f, innerH - thumbH);

                float ratio = Clamp((io.MousePos.y - (winPos_.y + pad + thumbH * 0.5f)) / travel,
                                    0.0f, 1.0f);
                pos_ = ratio * maxScrollY_;
                velocity_ = 0.0f;
                Reveal();
            }
            touchLastY_ = io.MousePos.y;
        }

        if (touchMode_ != TouchMode::None && ImGui::IsMouseReleased(ImGuiMouseButton_Left)) {
            if (touchMode_ == TouchMode::ThumbScrub &&
                std::abs(pos_ - scrollStartY_) > viewH_ * 1.4f) {
                backY_ = scrollStartY_;
                showBackChip_ = true;
                backTimer_ = 6.5f;
            }
            if (touchMode_ == TouchMode::ContentPan &&
                std::abs(velocity_) < cfg.minFlingVel * dpi_) {
                velocity_ = 0.0f;
            }
            velocity_ = Clamp(velocity_, -cfg.maxFlingVel * dpi_, cfg.maxFlingVel * dpi_);
            touchMode_ = TouchMode::None;
        }

        if (touchMode_ == TouchMode::None && std::abs(velocity_) > 1.0f) {
            pos_ += velocity_ * dt;
            float decay = std::pow(cfg.touchFriction, (dt * 1000.0f) / 16.667f);
            velocity_ *= decay;
            if (pos_ <= 0.0f) {
                pos_ = 0.0f; velocity_ = 0.0f;
            } else if (pos_ >= maxScrollY_) {
                pos_ = maxScrollY_; velocity_ = 0.0f;
            }
            Reveal();
        }

        pos_ = Clamp(pos_, 0.0f, maxScrollY_);
        win->Scroll.y = pos_;
        win->ScrollTarget.y = pos_;

        if (showResumeChip_ && pos_ > viewH_ * 0.35f) showResumeChip_ = false;
        if (showBackChip_ && std::abs(pos_ - backY_) < viewH_ * 0.3f) showBackChip_ = false;
    }

    void DrawGlassPill(ImDrawList* dl, ImVec2 pMin, ImVec2 pMax,
                       const char* mainTxt, const char* subTxt, bool rightArrow) {
        ImU32 bg = cfg.lowSpecMode ? IM_COL32(20, 22, 28, 242) : IM_COL32(20, 22, 28, 210);
        ImU32 bd = IM_COL32(255, 255, 255, 45);
        float rounding = 12.0f * dpi_;
        dl->AddRectFilled(pMin, pMax, bg, rounding);
        dl->AddRect(pMin, pMax, bd, rounding, 0, 1.0f);
        float padX  = 12.0f * dpi_;
        float textY = pMin.y + (pMax.y - pMin.y - ImGui::GetTextLineHeight()) * 0.5f;
        dl->AddText(ImVec2(pMin.x + padX, textY), IM_COL32(255, 255, 255, 255), mainTxt);
        if (subTxt && subTxt[0]) {
            ImVec2 subSz = ImGui::CalcTextSize(subTxt);
            dl->AddText(ImVec2(pMax.x - padX - subSz.x, textY),
                        IM_COL32(255, 255, 255, 165), subTxt);
        }
        if (rightArrow) {
            float cy = (pMin.y + pMax.y) * 0.5f;
            float a  = 5.0f * dpi_;
            dl->AddTriangleFilled(ImVec2(pMax.x, cy - a),
                                  ImVec2(pMax.x + a, cy),
                                  ImVec2(pMax.x, cy + a), bg);
        }
    }

    void RenderOverlay(ImGuiWindow* /*win*/) {
        if (maxScrollY_ <= 0.0f) return;
        ImDrawList* dl = ImGui::GetWindowDrawList();

        bool scrubbing = (touchMode_ == TouchMode::ThumbScrub);
        bool visible   = cfg.alwaysVisible || revealTimer_ > 0.0f || scrubbing;

        float pad    = cfg.edgePadding * dpi_;
        float innerH = winSize_.y - pad * 2.0f;
        float thumbH = Clamp(innerH * (viewH_ / (viewH_ + maxScrollY_)),
                             cfg.minThumbHeight * dpi_, innerH);
        float travel = std::max(0.0f, innerH - thumbH);
        float thumbTop = winPos_.y + pad + (pos_ / maxScrollY_) * travel;
        float rightEdge = winPos_.x + winSize_.x - pad;

        if (visible) {
            if (scrubbing) {
                float railW = cfg.thumbWidthHot * dpi_;
                dl->AddRectFilled(ImVec2(rightEdge - railW, winPos_.y + pad),
                                  ImVec2(rightEdge,        winPos_.y + winSize_.y - pad),
                                  IM_COL32(128, 128, 128, 35), railW * 0.5f);
            }

            if (cfg.showSections && sectionsNext_ >= 2 && sectionsNext_ <= 40) {
                ImU32 tickCol = cfg.lightBackground ? IM_COL32(30, 32, 38, 150)
                                                    : IM_COL32(255, 255, 255, 145);
                for (size_t i = 0; i < sectionsNext_; ++i) {
                    const ScrollMarker& s = sections_[i];
                    float ty = winPos_.y + pad
                             + (Clamp(s.y, 0.0f, maxScrollY_) / maxScrollY_) * travel
                             + thumbH * 0.5f;
                    float w = (s.level == 1 ? 10.0f : 6.0f) * dpi_;
                    float h = 3.0f * dpi_;
                    dl->AddRectFilled(ImVec2(rightEdge - w - 2.0f * dpi_, ty - h * 0.5f),
                                      ImVec2(rightEdge - 2.0f * dpi_,     ty + h * 0.5f),
                                      tickCol, 1.5f);
                }
            }

            if (cfg.showPins) {
                for (const auto& p : pins_) {
                    float ty = winPos_.y + pad
                             + (Clamp(p.y, 0.0f, maxScrollY_) / maxScrollY_) * travel
                             + thumbH * 0.5f;
                    float w = (scrubbing ? 16.0f : 11.0f) * dpi_;
                    float h = 4.0f * dpi_;
                    dl->AddRectFilled(ImVec2(rightEdge - w - 2.0f * dpi_, ty - h * 0.5f),
                                      ImVec2(rightEdge - 2.0f * dpi_,     ty + h * 0.5f),
                                      IM_COL32(76, 141, 255, 255), 2.0f);
                }
            }

            float curW = (scrubbing ? cfg.thumbWidthHot : cfg.thumbWidth) * dpi_;
            ImVec2 tMin(rightEdge - curW, thumbTop);
            ImVec2 tMax(rightEdge,        thumbTop + thumbH);
            ImU32 fillCol = scrubbing ? IM_COL32(255, 255, 255, 115) : IM_COL32(255, 255, 255, 65);
            ImU32 bordCol = scrubbing ? IM_COL32(255, 255, 255, 145) : IM_COL32(255, 255, 255, 80);
            dl->AddRectFilled(tMin, tMax, fillCol, curW * 0.5f);
            dl->AddRect(tMin, tMax, bordCol, curW * 0.5f, 0, 1.0f);

            if (scrubbing) {
                int pct = (int)std::round((pos_ / maxScrollY_) * 100.0f);
                char pctBuf[16];
                std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", pct);
                const char* secTitle = FindCurrentSectionLabel(pos_);
                const char* mainTxt = secTitle ? secTitle : pctBuf;
                const char* subTxt  = secTitle ? pctBuf : "";
                ImVec2 sz = ImGui::CalcTextSize(mainTxt);
                float subW  = subTxt[0] ? ImGui::CalcTextSize(subTxt).x + 14.0f * dpi_ : 0.0f;
                float pillW = std::min(sz.x + subW + 26.0f * dpi_, winSize_.x * 0.70f);
                float pillH = 30.0f * dpi_;
                float pillX = rightEdge - curW - 10.0f * dpi_ - pillW;
                float pillY = Clamp(thumbTop + thumbH * 0.5f - pillH * 0.5f,
                                    winPos_.y + 6.0f * dpi_,
                                    winPos_.y + winSize_.y - pillH - 6.0f * dpi_);
                DrawGlassPill(dl, ImVec2(pillX, pillY),
                                  ImVec2(pillX + pillW, pillY + pillH),
                                  mainTxt, subTxt, true);
            }
        }

        if (toastTimer_ > 0.0f && !scrubbing) {
            ImVec2 sz = ImGui::CalcTextSize(toastText_.c_str());
            float pillW = sz.x + 24.0f * dpi_;
            float pillH = 28.0f * dpi_;
            float px = winPos_.x + (winSize_.x - pillW) * 0.5f;
            float py = winPos_.y + 12.0f * dpi_;
            DrawGlassPill(dl, ImVec2(px, py), ImVec2(px + pillW, py + pillH),
                          toastText_.c_str(), nullptr, false);
        }

        if (showBackChip_ || showResumeChip_) {
            ImVec2 cMin, cMax;
            GetChipBounds(cMin, cMax);
            const char* labelText = showBackChip_ ? "<  Back to previous position"
                                                  : ">  Resume where you left off";
            char pctBuf[16] = "";
            if (showResumeChip_ && maxScrollY_ > 0.0f) {
                float r = Clamp(resumeY_ / maxScrollY_, 0.0f, 1.0f);
                std::snprintf(pctBuf, sizeof(pctBuf), "%d%%", (int)std::round(r * 100.0f));
            }
            DrawGlassPill(dl, cMin, cMax, labelText, pctBuf, false);
        }
    }
};

} // namespace MTechno
