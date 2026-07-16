#!/usr/bin/env bash
#
# coccontainer-serve-loop.sh
#
# Runs `coccontainer serve` in a rebuild-restart loop.
# Hit POST /api/admin/restart from any browser/node to trigger a rebuild + restart.
#
# 1. Builds all packages (forge → coc → coccontainer) and npm-links them.
# 2. Starts `coccontainer serve --no-open`.
# 3. When the server exits with code 75 (restart requested), loops back to step 1.
# 4. Any other exit code (0 = clean shutdown, Ctrl+C, etc.) stops the loop.
#
# Usage:
#   ./scripts/coccontainer-serve-loop.sh
#   ./scripts/coccontainer-serve-loop.sh --port 8080
#   ./scripts/coccontainer-serve-loop.sh --skip-initial-build

set -euo pipefail

RESTART_EXIT_CODE=75
PORT=5000
BIND_ADDRESS='127.0.0.1'
SKIP_INITIAL_BUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --host|-H)
            BIND_ADDRESS="$2"
            shift 2
            ;;
        --skip-initial-build|-s)
            SKIP_INITIAL_BUILD=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: $0 [--port PORT] [--host BIND_ADDRESS] [--skip-initial-build]" >&2
            exit 1
            ;;
    esac
done

# Resolve repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -d "$PWD/packages/coccontainer" ]]; then
    REPO_ROOT="$PWD"
fi

build_coccontainer() {
    echo -e "\n\033[36m=== Installing dependencies ===\033[0m"
    cd "$REPO_ROOT"
    npm install || { echo -e "\033[31mnpm install failed\033[0m"; return 1; }

    echo -e "\n\033[36m=== Building all packages (coc-memory → coc-agent-sdk → forge → coc-client → coc-workflow → coc-connector → coc → coccontainer) ===\033[0m"

    cd "$REPO_ROOT/packages/coc-memory"
    npm run build || { echo -e "\033[31mcoc-memory build failed\033[0m"; return 1; }

    cd "$REPO_ROOT/packages/coc-agent-sdk"
    npm run build || { echo -e "\033[31mcoc-agent-sdk build failed\033[0m"; return 1; }

    cd "$REPO_ROOT/packages/forge"
    npm run build || { echo -e "\033[31mforge build failed\033[0m"; return 1; }
    npm link

    cd "$REPO_ROOT/packages/coc-client"
    npm run build || { echo -e "\033[31mcoc-client build failed\033[0m"; return 1; }

    cd "$REPO_ROOT/packages/coc-workflow"
    npm run build || { echo -e "\033[31mcoc-workflow build failed\033[0m"; return 1; }

    cd "$REPO_ROOT/packages/coc-connector"
    npm run build || { echo -e "\033[31mcoc-connector build failed\033[0m"; return 1; }

    cd "$REPO_ROOT/packages/coc"
    npm run build || { echo -e "\033[31mcoc build failed\033[0m"; return 1; }

    cd "$REPO_ROOT/packages/coccontainer"
    npm run build || { echo -e "\033[31mcoccontainer build failed\033[0m"; return 1; }
    npm link
    # Remove symlinked forge so global link resolves correctly
    local forge_link="$PWD/node_modules/@plusplusoneplusplus/forge"
    if [[ -d "$forge_link" ]]; then
        rm -rf "$forge_link"
    fi

    # Re-run npm install after npm link steps — npm link inside workspace packages
    # prunes optional peer deps (@openai/codex-sdk, @anthropic-ai/claude-agent-sdk)
    # from root node_modules. A second install restores them from the local cache.
    cd "$REPO_ROOT"
    npm install || { echo -e "\033[31mPost-link npm install failed\033[0m"; return 1; }

    echo -e "\n\033[36m=== Verifying native dependencies ===\033[0m"
    node "$REPO_ROOT/scripts/ensure-native-dependency.mjs" better-sqlite3 || {
        echo -e "\033[31mNative dependency verification failed\033[0m"
        return 1
    }

    cd "$REPO_ROOT"
    echo -e "\033[32mBuild succeeded.\033[0m"
    return 0
}

first=true

while true; do
    # Build step
    if [[ "$first" == true && "$SKIP_INITIAL_BUILD" == true ]]; then
        echo -e "\033[33mSkipping initial build (--skip-initial-build).\033[0m"
    else
        if ! build_coccontainer; then
            echo -e "\033[31mBuild failed. Waiting 5s before retrying...\033[0m"
            sleep 5
            continue
        fi
    fi
    first=false

    # Serve step
    echo -e "\n\033[36m=== Starting coccontainer serve (host $BIND_ADDRESS, port $PORT) ===\033[0m"
    echo -e "\033[90mPOST /api/admin/restart to rebuild & restart.\033[0m\n"

    set +e
    coccontainer serve --no-open --port "$PORT" --host "$BIND_ADDRESS"
    exit_code=$?
    set -e

    if [[ $exit_code -eq $RESTART_EXIT_CODE ]]; then
        echo -e "\n\033[33mRestart requested (exit code $RESTART_EXIT_CODE). Rebuilding...\033[0m"
        continue
    fi

    echo -e "\n\033[36mServer exited with code $exit_code. Stopping loop.\033[0m"
    break
done
