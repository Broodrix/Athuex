#!/data/data/com.termux/files/usr/bin/bash
# athuex_tui.sh — menu-driven Text UI wrapper around build_athuex.sh
# Requires only bash + coreutils (+ git, gh, jq for the underlying build).
set -uo pipefail

# ─── Paths ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_SCRIPT="$SCRIPT_DIR/build_athuex.sh"
VERIFY_SCRIPT="$SCRIPT_DIR/scripts/verify_tree.sh"
CONFIG_FILE="${ATHUEX_TUI_CONFIG:-$HOME/.athuex_tui.conf}"
LOG_DIR="${ATHUEX_TUI_LOGS:-$HOME/.athuex_tui_logs}"

# ─── CLI ──────────────────────────────────────────────────────────────
case "${1:-}" in
  -h|--help)
    cat <<EOF
Athuex Build TUI — menu-driven wrapper for build_athuex.sh

Usage: bash athuex_tui.sh [OPTIONS]

Options:
  -h, --help       Show this help
  --no-tui         Run build_athuex.sh directly (no TUI)

Config: $CONFIG_FILE
Logs:   $LOG_DIR
EOF
    exit 0
    ;;
  --no-tui) exec bash "$BUILD_SCRIPT" "${@:2}" ;;
esac

# ─── Fallback if not a suitable terminal ──────────────────────────────
if [ ! -t 0 ] || [ ! -t 1 ] || [ "${TERM:-dumb}" = "dumb" ] || [ ! -f "$BUILD_SCRIPT" ]; then
  echo "TUI unavailable (non-tty or missing build script). Executing build_athuex.sh…" >&2
  exec bash "$BUILD_SCRIPT" "$@"
fi

mkdir -p "$LOG_DIR"

# ─── Defaults (overridable via config) ────────────────────────────────
REPO_SLUG="Broodrix/Athuex"
BRANCH="master"
WORKFLOW_FILE="build-apk.yml"
# shellcheck disable=SC1090
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

# ─── Colors ───────────────────────────────────────────────────────────
R=$'\e[0m'; B=$'\e[1m'; D=$'\e[2m'
FR=$'\e[31m'; FG=$'\e[32m'; FY=$'\e[33m'; FB=$'\e[34m'; FM=$'\e[35m'; FC=$'\e[36m'
BG_B=$'\e[44m'
CLR=$'\e[2J\e[H'; HIDE=$'\e[?25l'; SHOW=$'\e[?25h'

# ─── Terminal geometry ────────────────────────────────────────────────
COLS=80; LINES=24
update_size() {
  local sz; sz=$(stty size 2>/dev/null || echo "24 80")
  LINES=${sz%% *}; COLS=${sz##* }
  [ "$COLS" -lt 60 ] && COLS=60
  [ "$LINES" -lt 20 ] && LINES=20
}
trap 'update_size' WINCH
update_size

# ─── Global task state ────────────────────────────────────────────────
TASK_PID=""; TASK_LOG=""; TASK_NAME=""; TASK_START=0

# ─── Cleanup ──────────────────────────────────────────────────────────
cleanup() { printf '%s%s' "$SHOW" "$R"; }
trap cleanup EXIT INT TERM

# ─── Primitives ───────────────────────────────────────────────────────
clr()  { printf '%s' "$CLR"; }
mv()   { printf '\e[%d;%dH' "$1" "$2"; }
cl()   { printf '\e[2K'; }
rep()  { local s='' i; for ((i=0;i<$2;i++)); do s+=$1; done; printf '%s' "$s"; }
hline(){ mv "$1" 1; cl; printf '%s%s%s' "$D" "$(rep '─' "$COLS")" "$R"; }

# ─── Key reader (blocking) ────────────────────────────────────────────
read_key() {
  local k="" rest=""
  IFS= read -rsn1 k || { echo ""; return; }
  if [ "$k" = $'\e' ]; then
    IFS= read -rsn2 -t 0.05 rest 2>/dev/null || true
    case "$rest" in
      '[A'|'OA') echo up ;;
      '[B'|'OB') echo down ;;
      '[C'|'OC') echo right ;;
      '[D'|'OD') echo left ;;
      *) echo esc ;;
    esac
  elif [ -z "$k" ]; then echo enter
  elif [ "$k" = q ]; then echo quit
  else echo "$k"
  fi
}

# ─── Status helpers ───────────────────────────────────────────────────
get_version() {
  local v
  v=$(grep -oE 'versionName[[:space:]]*[=]?[[:space:]]*"[^"]+"' \
      "$SCRIPT_DIR/android/app/build.gradle" 2>/dev/null \
    | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')
  [ -z "$v" ] && v="?"
  printf '%s' "$v"
}
git_name()  { git -C "$SCRIPT_DIR" config user.name  2>/dev/null || true; }
git_email() { git -C "$SCRIPT_DIR" config user.email 2>/dev/null || true; }
gh_authed() { command -v gh >/dev/null 2>&1 && gh auth status 2>&1 | grep -q "Logged in"; }
task_running(){ [ -n "$TASK_PID" ] && [ -n "$TASK_LOG" ] && [ ! -f "${TASK_LOG}.exit" ]; }

# ─── Header ───────────────────────────────────────────────────────────
draw_header() {
  local ver; ver=$(get_version)
  local name; name=$(git_name);  [ -z "$name"  ] && name="${FR}<unset>${R}"
  local email; email=$(git_email);[ -z "$email" ] && email="${FR}<unset>${R}"
  local gh; if gh_authed; then gh="${FG}✓ authenticated${R}"; else gh="${FR}✗ not authenticated${R}"; fi

  mv 1 1; cl; printf '%s━ Athuex Build TUI ━%s %sv%s%s' "$FB$B" "$R" "$D" "$ver" "$R"
  mv 2 1; cl; printf '  %sRepo:%s   %s %s(%s)%s'  "$B" "$R" "$REPO_SLUG" "$D" "$BRANCH" "$R"
  mv 3 1; cl; printf '  %sBranch:%s %s'            "$B" "$R" "$BRANCH"
  mv 4 1; cl; printf '  %sUser:%s   %s'            "$B" "$R" "$name $email"
  mv 5 1; cl; printf '  %sGH:%s     %s'            "$B" "$R" "$gh"
  hline 6
}

# ─── Preflight (return 0 ok / 1 warn / 2 needs settings) ──────────────
preflight_check() {
  local -a issues=()
  [ -z "$(git_name)"  ] && issues+=("git user.name is not set")
  [ -z "$(git_email)" ] && issues+=("git user.email is not set")
  gh_authed || issues+=("gh is not authenticated with 'workflow' scope")
  [ ${#issues[@]} -eq 0 ] && return 0

  clear_screen_draw_warn() {
    clr; draw_header
    mv 8 3; printf '%s⚠  Preflight issues detected:%s' "$FY$B" "$R"
    local i; for i in "${!issues[@]}"; do
      mv $((9+i)) 5; printf '%s•%s %s' "$FY" "$R" "${issues[$i]}"
    done
    mv $((9+${#issues[@]}+1)) 3
    printf '%sFix these in Settings before running a build.%s' "$D" "$R"
    mv "$LINES" 1; cl
    printf '%s[S] Open Settings   [Enter] Back to menu%s' "$D" "$R"
  }
  clear_screen_draw_warn

  local k
  while true; do
    k=$(read_key)
    case "$k" in
      s|S) return 2 ;;
      enter|esc) return 1 ;;
    esac
  done
}

# ─── Task execution ───────────────────────────────────────────────────
task_start() {
  local name=$1; shift
  local log="$LOG_DIR/$(date +%Y%m%d_%H%M%S)_$(printf '%s' "$name" | tr ' /' '__').log"
  rm -f "${log}.exit" 2>/dev/null || true
  : > "$log"

  (
    if command -v stdbuf >/dev/null 2>&1; then
      stdbuf -oL -eL "$@"
    else
      "$@"
    fi
    echo $? > "${log}.exit"
  ) >"$log" 2>&1 </dev/null &

  TASK_PID=$!
  TASK_LOG="$log"
  TASK_NAME="$name"
  TASK_START=$(date +%s)
}

log_tail_lines() {
  # log_tail_lines <log> <n>
  local log=$1 n=$2
  [ ! -f "$log" ] && return
  tail -n "$n" "$log" 2>/dev/null \
    | sed -E 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\r//g'
}

draw_task_result() {
  local rc=$1
  clr; draw_header
  mv 8 3; cl
  if [ "${rc:-1}" -eq 0 ]; then
    printf '%s%s ✓ %s completed successfully%s' "$FG" "$B" "$TASK_NAME" "$R"
  else
    printf '%s%s ✗ %s failed (exit %s)%s' "$FR" "$B" "$TASK_NAME" "$rc" "$R"
  fi
  mv 10 3; cl; printf '%sLog: %s%s' "$D" "$TASK_LOG" "$R"
  hline 11

  local n=$((LINES - 14)); [ "$n" -lt 5 ] && n=5
  local i=0 line
  while IFS= read -r line; do
    mv $((12+i)) 3; cl
    printf '%s%.*s%s' "$D" $((COLS - 5)) "$line" "$R"
    i=$((i+1))
  done < <(log_tail_lines "$TASK_LOG" "$n")

  mv "$LINES" 1; cl
  printf '%sPress Enter to return to menu%s' "$D" "$R"
  IFS= read -rsn1 _ || true
}

task_watch() {
  [ -z "$TASK_PID" ] && return 1
  printf '%s' "$HIDE"

  local spinners=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
  local si=0
  local log_row=11
  local n_lines=$((LINES - log_row - 2)); [ "$n_lines" -lt 3 ] && n_lines=3

  while task_running; do
    update_size
    clr; draw_header
    local now; now=$(date +%s); local el=$((now - TASK_START))
    mv 8 3; cl
    printf '%s%s %s%s  %s(%02d:%02d elapsed)%s' \
      "$FC$B" "${spinners[$((si % 10))]}" "$TASK_NAME" "$R" \
      "$D" $((el/60)) $((el%60)) "$R"
    mv 9 3; cl; printf '%sLog: %s%s' "$D" "$TASK_LOG" "$R"
    hline 10

    # log tail
    local i=0 line
    while IFS= read -r line; do
      mv $((log_row + i)) 3; cl
      printf '%s%.*s%s' "$D" $((COLS - 5)) "$line" "$R"
      i=$((i+1))
    done < <(log_tail_lines "$TASK_LOG" "$n_lines")

    mv "$LINES" 1; cl
    printf '%s▶ Running…  q detach  Ctrl+C abort%s' "$D" "$R"

    local k=""
    IFS= read -rsn1 -t 0.4 k 2>/dev/null || true
    if [ "$k" = "q" ] || [ "$k" = "Q" ]; then
      printf '%s' "$SHOW"
      return 0
    fi
    si=$((si+1))
  done

  wait "$TASK_PID" 2>/dev/null || true
  local rc=0
  [ -f "${TASK_LOG}.exit" ] && rc=$(cat "${TASK_LOG}.exit" 2>/dev/null || echo "?")
  TASK_PID=""
  draw_task_result "$rc"
  printf '%s' "$SHOW"
  return 0
}

task_reattach() {
  [ -z "$TASK_LOG" ] && return
  if [ -f "${TASK_LOG}.exit" ]; then
    local rc; rc=$(cat "${TASK_LOG}.exit" 2>/dev/null || echo "?")
    TASK_PID=""
    draw_task_result "$rc"
  else
    task_watch
  fi
}

# ─── Settings ─────────────────────────────────────────────────────────
save_config() {
  {
    printf 'REPO_SLUG=%q\n'   "$REPO_SLUG"
    printf 'BRANCH=%q\n'      "$BRANCH"
    printf 'WORKFLOW_FILE=%q\n' "$WORKFLOW_FILE"
  } > "$CONFIG_FILE"
}

prompt_line() {
  # prompt_line <label> <default> -> echoes input
  local label=$1 def=${2:-} val=""
  mv "$LINES" 1; cl
  printf '%s%s%s ' "$B" "$label" "$R"
  if [ -n "$def" ]; then printf '%s[%s]%s ' "$D" "$def" "$R"; fi
  IFS= read -r val || true
  [ -z "$val" ] && val="$def"
  printf '%s' "$val"
}

settings_menu() {
  while true; do
    clr; draw_header
    mv 8 1; cl; printf '%sSettings%s' "$B" "$R"; hline 9
    local items=(
      "Set git user.name       $(git_name || echo '<unset>')"
      "Set git user.email      $(git_email || echo '<unset>')"
      "Set repo slug           $REPO_SLUG"
      "Set branch              $BRANCH"
      "Set workflow file       $WORKFLOW_FILE"
      "Re-authenticate gh      $(gh_authed && echo '✓ ok' || echo '✗ needed')"
      "Back"
    )
    local sel=0 i
    for i in "${!items[@]}"; do
      mv $((10+i)) 3; cl
      if [ "$i" -eq "$sel" ]; then
        printf '%s ▶ %s %s' "$BG_B$B" "$R" "${items[$i]}"
      else
        printf '   %s' "${items[$i]}"
      fi
    done
    mv "$LINES" 1; cl
    printf '%s↑↓ move  Enter select  q back%s' "$D" "$R"

    local k; k=$(read_key)
    case "$k" in
      up)   sel=$(( (sel - 1 + ${#items[@]}) % ${#items[@]} )) ;;
      down) sel=$(( (sel + 1) % ${#items[@]} )) ;;
      quit|esc) return ;;
      enter)
        case "$sel" in
          0) local v; v=$(prompt_line "New git user.name" "$(git_name)")
             [ -n "$v" ] && git -C "$SCRIPT_DIR" config user.name "$v" ;;
          1) local v; v=$(prompt_line "New git user.email" "$(git_email)")
             [ -n "$v" ] && git -C "$SCRIPT_DIR" config user.email "$v" ;;
          2) local v; v=$(prompt_line "Repo slug" "$REPO_SLUG")
             [ -n "$v" ] && REPO_SLUG="$v" && save_config ;;
          3) local v; v=$(prompt_line "Branch" "$BRANCH")
             [ -n "$v" ] && BRANCH="$v" && save_config ;;
          4) local v; v=$(prompt_line "Workflow file" "$WORKFLOW_FILE")
             [ -n "$v" ] && WORKFLOW_FILE="$v" && save_config ;;
          5) printf '%s' "$SHOW"; stty sane 2>/dev/null || true; clr
             echo "Handing off to gh auth login (browser required)…"
             echo ""
             gh auth login -h github.com -p https -s workflow -w || true
             echo ""; echo "Press Enter to return to TUI."
             IFS= read -r _ || true; printf '%s' "$HIDE" ;;
          6) return ;;
        esac
        ;;
    esac
  done
}

# ─── Task launchers ───────────────────────────────────────────────────
run_full_build() {
  task_start "Full build" bash -c "
    echo '=== Phase 1/2: Verify tree ==='
    bash '$VERIFY_SCRIPT'
    rc=\$?
    if [ \$rc -ne 0 ]; then
      echo ''
      echo 'Verification failed (rc='\$rc'). Aborting.'
      exit \$rc
    fi
    echo ''
    echo '=== Phase 2/2: Build (push → watch → download) ==='
    bash '$BUILD_SCRIPT'
  "
  task_watch
}

run_verify_only() {
  task_start "Verify tree" bash "$VERIFY_SCRIPT"
  task_watch
}

run_push_build() {
  task_start "Push & build" bash "$BUILD_SCRIPT"
  task_watch
}

run_recent() {
  clr; draw_header
  mv 8 3; printf '%sRecent workflow runs — %s%s' "$B" "$REPO_SLUG" "$R"
  mv 9 3; printf '%sPress q to return…%s' "$D" "$R"
  hline 11
  # hand off to gh, which will pick a tty-free plain output
  mv 12 1; cl
  ( gh run list -R "$REPO_SLUG" --workflow="$WORKFLOW_FILE" --limit 15 ) 2>&1 \
    | sed -E 's/\x1b\[[0-9;?]*[a-zA-Z]//g' \
    | head -n $((LINES - 15)) \
    | while IFS= read -r line; do
        printf '   %s\n' "$line"
      done
  mv "$LINES" 1; cl
  printf '%sPress Enter to return to menu%s' "$D" "$R"
  IFS= read -rsn1 _ || true
}

run_logs() {
  clr; draw_header
  mv 8 3; printf '%sLogs in %s%s' "$B" "$LOG_DIR" "$R"
  hline 9
  local -a files=()
  local i=0
  while IFS= read -r f; do
    files+=("$f"); i=$((i+1))
    [ "$i" -ge $((LINES - 12)) ] && break
  done < <(find "$LOG_DIR" -maxdepth 1 -type f -name '*.log' 2>/dev/null \
             | sort -r | head -n 20)
  if [ ${#files[@]} -eq 0 ]; then
    mv 11 3; printf '%s(no logs yet)%s' "$D" "$R"
  else
    for i in "${!files[@]}"; do
      mv $((10+i)) 3; cl
      printf '%s%s%s' "$D" "$(basename "${files[$i]}")" "$R"
    done
  fi
  mv "$LINES" 1; cl
  printf '%sPress Enter to return to menu%s' "$D" "$R"
  IFS= read -rsn1 _ || true
}

# ─── Main menu ────────────────────────────────────────────────────────
main_menu_loop() {
  while true; do
    clr; draw_header

    local -a labels=() actions=()
    if task_running; then
      local el=$(( $(date +%s) - TASK_START ))
      labels+=("${FG}${B}Reattach${R} to running build — ${TASK_NAME} (${el}s)")
      actions+=("reattach")
    fi
    labels+=(
      "Full build pipeline          verify → push → watch → download"
      "Verify tree only             scripts/verify_tree.sh"
      "Push & build (skip verify)   build_athuex.sh"
      "Recent workflow runs         gh run list"
      "View local logs              $LOG_DIR"
      "Settings                     git / gh / branch"
      "Quit"
    )
    actions+=(fullbuild verify build recent logs settings quit)

    mv 8 3; cl; printf '%sMain Menu%s' "$B" "$R"
    hline 9
    local sel=0 i
    for i in "${!labels[@]}"; do
      mv $((10+i)) 3; cl
      if [ "$i" -eq "$sel" ]; then
        printf '%s ▶ %s %s' "$BG_B$B" "$R" "${labels[$i]}"
      else
        printf '   %s' "${labels[$i]}"
      fi
    done
    mv "$LINES" 1; cl
    printf '%s↑↓ move  Enter select  1-%d jump  q quit%s' "$D" "${#labels[@]}" "$R"

    local k; k=$(read_key)
    local pick=""
    case "$k" in
      up)   sel=$(( (sel - 1 + ${#labels[@]}) % ${#labels[@]} )) ;;
      down) sel=$(( (sel + 1) % ${#labels[@]} )) ;;
      quit|esc) pick="quit" ;;
      enter) pick="${actions[$sel]}" ;;
      [1-9])
        local idx=$((k - 1))
        [ "$idx" -lt "${#labels[@]}" ] && pick="${actions[$idx]}"
        ;;
    esac
    [ -z "$pick" ] && continue

    case "$pick" in
      quit)
        if task_running; then
          mv "$LINES" 1; cl
          printf '%sA build is still running (PID %s). Really quit? [y/N]%s' "$FY" "$TASK_PID" "$R"
          local a; IFS= read -rsn1 a || true
          if [ "$a" != "y" ] && [ "$a" != "Y" ]; then continue; fi
        fi
        return ;;
      reattach) task_reattach ;;
      fullbuild)
        preflight_check; local pf=$?
        case $pf in
          0) run_full_build ;;
          2) settings_menu ;;
        esac ;;
      verify) run_verify_only ;;
      build)
        preflight_check; local pf=$?
        case $pf in
          0) run_push_build ;;
          2) settings_menu ;;
        esac ;;
      recent) run_recent ;;
      logs)   run_logs ;;
      settings) settings_menu ;;
    esac
  done
}

# ─── Entry point ──────────────────────────────────────────────────────
printf '%s' "$HIDE"
main_menu_loop
printf '%s%s\n' "$SHOW" "$R"