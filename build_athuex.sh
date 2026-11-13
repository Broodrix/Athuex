#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# ==================================================
# Configuration for Broodrix/Athuex
# ==================================================
REPO_SLUG="Broodrix/Athuex"
BRANCH="master"
WORKFLOW_FILE="build-apk.yml"

# Auto-detect version from build-apk.yml, README.md, or folder name
VERSION=$(grep -m1 -oE '[0-9]+\.[0-9]+\.[0-9]+' .github/workflows/${WORKFLOW_FILE} README.md 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || basename "$PWD" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "latest")

echo "=================================================="
echo "  Athuex v${VERSION} — Termux to GitHub Actions APK"
echo "  Target: ${REPO_SLUG} (${BRANCH})"
echo "=================================================="

# 1. Grant Termux storage access if needed
if [ ! -d "$HOME/storage/downloads" ]; then
    echo "[1/7] Granting Termux storage permission..."
    termux-setup-storage
    sleep 3
fi

# 2. Verify we are in the Athuex project root
if [ ! -f "native/imgui_app/CMakeLists.txt" ]; then
    echo "❌ Error: Run this script from the root of your Athuex folder."
    echo "Example: cd ~/storage/downloads/athuex_v287 && bash build_athuex.sh"
    exit 1
fi

# 3. Install required packages (git, gh, jq)
echo "[2/7] Checking required packages (git, gh, jq)..."
for pkg in git gh jq; do
    if ! command -v "$pkg" >/dev/null 2>&1; then
        pkg update -y && pkg install -y "$pkg"
    fi
done

# 4. Initialize repository and configure repository-local Git identity
if [ ! -d ".git" ]; then
    git init
fi
if [ -z "$(git config user.name || true)" ]; then
    read -rp "Enter your Git Name: " git_name
    git config user.name "$git_name"
fi
if [ -z "$(git config user.email || true)" ]; then
    read -rp "Enter your Git Email: " git_email
    git config user.email "$git_email"
fi
git config core.autocrlf input

# 5. Authenticate GitHub CLI with 'workflow' scope
echo "[3/7] Checking GitHub authentication & 'workflow' scope..."
if ! gh auth status 2>&1 | grep -q "workflow"; then
    echo "⚠️  Please log in via browser and approve the 'workflow' permission:"
    gh auth login -h github.com -p https -s workflow -w
fi
gh auth setup-git

# 6. Verify workflow file exists
if [ ! -f ".github/workflows/${WORKFLOW_FILE}" ]; then
    echo "❌ Error: .github/workflows/${WORKFLOW_FILE} not found in this folder."
    exit 1
fi

# 7. Prepare Git repository & point strictly to Broodrix/Athuex
echo "[4/7] Preparing Git repository..."
# Shared storage can trigger Git's dubious-ownership check. Trust only this repo
# for commands in this script; never add a global safe.directory="*" wildcard.
SAFE_GIT=(git -c "safe.directory=$(pwd)")
"${SAFE_GIT[@]}" branch -M "$BRANCH"

touch .gitignore
for pattern in 'third_party/llama.cpp/' '*.gguf' '*.apk' 'build/' '.gradle/' 'android/.gradle/' 'android/app/build/'; do
    grep -Fqx -- "$pattern" .gitignore || printf '%s\\n' "$pattern" >> .gitignore
done

# Use GitHub CLI's configured credential helper. Never place the access token
# in a remote URL or process argument.
"${SAFE_GIT[@]}" remote get-url origin >/dev/null 2>&1 || \
    "${SAFE_GIT[@]}" remote add origin "https://github.com/${REPO_SLUG}.git"
REMOTE_URL=$("${SAFE_GIT[@]}" remote get-url origin)
case "$REMOTE_URL" in
    "https://github.com/${REPO_SLUG}.git"|"git@github.com:${REPO_SLUG}.git") ;;
    *)
        echo "❌ Refusing to push: origin is not ${REPO_SLUG} (${REMOTE_URL})"
        exit 1
        ;;
esac

"${SAFE_GIT[@]}" add .
if ! "${SAFE_GIT[@]}" diff --cached --quiet; then
    "${SAFE_GIT[@]}" commit -m "Release Athuex v${VERSION}"
else
    echo "ℹ️  No new file changes to commit."
fi

COMMIT_SHA=$("${SAFE_GIT[@]}" rev-parse HEAD)

echo "[5/7] Pushing updates to ${REPO_SLUG} (${BRANCH})..."
# Normal push: fail on non-fast-forward instead of overwriting remote history.
"${SAFE_GIT[@]}" push origin "HEAD:refs/heads/${BRANCH}"

# 8. Check if push already triggered a build; if not, trigger manually
echo "[6/7] Checking GitHub Actions workflow (${WORKFLOW_FILE})..."
sleep 6

RUN_ID=$(gh run list -R "$REPO_SLUG" --workflow="$WORKFLOW_FILE" --commit="$COMMIT_SHA" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
    echo "▶️  Push did not auto-trigger build (non-native paths changed). Triggering manually..."
    gh workflow run "$WORKFLOW_FILE" -R "$REPO_SLUG" --ref "$BRANCH"
    sleep 8
    RUN_ID=$(gh run list -R "$REPO_SLUG" --workflow="$WORKFLOW_FILE" --branch="$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId')
else
    echo "⚡ Push automatically triggered build Run #${RUN_ID}!"
fi

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
    echo "❌ Error: Could not fetch workflow run ID. Check https://github.com/actions"
    exit 1
fi

echo "🚀 Watching live build logs for Run #${RUN_ID} (takes ~15-40 mins)..."
gh run watch "$RUN_ID" -R "$REPO_SLUG" --exit-status

echo "[7/7] Build succeeded! Downloading APK artifact..."
DEST_DIR="$HOME/storage/downloads/athuex_v${VERSION}_apk"
mkdir -p "$DEST_DIR"
gh run download "$RUN_ID" -R "$REPO_SLUG" -D "$DEST_DIR"

echo "=================================================="
echo "✅ APK ready at: $DEST_DIR"
find "$DEST_DIR" -type f -name "*.apk" -exec ls -lh {} +
echo "Tap the .apk file in your Android File Manager to install."
echo "=================================================="
