#!/usr/bin/env bash
#
# Runs `coc serve` in a rebuild-restart loop.
# Hit POST /api/admin/restart from any browser/node to trigger a rebuild + restart.
#
# 1. Builds all coc packages (forge → coc) and npm-links them.
# 2. Starts `coc serve --no-open`.
# 3. When the server exits with code 75 (restart requested), loops back to step 1.
# 4. Any other exit code (0 = clean shutdown, Ctrl+C, etc.) stops the loop.
#
# Usage:
#   ./scripts/coc-serve-loop.sh
#   ./scripts/coc-serve-loop.sh -p 8080
#   ./scripts/coc-serve-loop.sh --skip-initial-build

set -euo pipefail

RESTART_EXIT_CODE=75
PORT=4000
HOST=127.0.0.1
SKIP_INITIAL_BUILD=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -H|--host)
            HOST="$2"
            shift 2
            ;;
        --skip-initial-build)
            SKIP_INITIAL_BUILD=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [-p|--port PORT] [-H|--host ADDR] [--skip-initial-build]"
            echo ""
            echo "Options:"
            echo "  -p, --port PORT        Port to serve on (default: 4000)"
            echo "  -H, --host ADDR        Bind address (default: 127.0.0.1)"
            echo "  --skip-initial-build   Skip the first build"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -d "$PWD/packages/coc" ]]; then
    REPO_ROOT="$PWD"
fi

build_coc() {
    echo ""
    echo -e "\033[36m=== Installing dependencies ===\033[0m"
    pushd "$REPO_ROOT" > /dev/null
    if ! npm install; then
        echo -e "\033[31mnpm install failed with exit code $?.\033[0m"
        popd > /dev/null
        return 1
    fi
    echo -e "\033[36m=== Building coc packages ===\033[0m"
    if npm run coc:link; then
        echo -e "\033[32mBuild succeeded.\033[0m"
        popd > /dev/null
        return 0
    else
        echo -e "\033[31mBuild failed with exit code $?.\033[0m"
        popd > /dev/null
        return 1
    fi
}

first=true

while true; do
    if $first && $SKIP_INITIAL_BUILD; then
        echo -e "\033[33mSkipping initial build (--skip-initial-build).\033[0m"
    else
        set +e
        build_coc
        build_ok=$?
        set -e
        if [[ $build_ok -ne 0 ]]; then
            echo -e "\033[31mBuild failed. Waiting 5s before retrying...\033[0m"
            sleep 5
            continue
        fi
    fi
    first=false

    echo ""
    echo -e "\033[36m=== Starting coc serve (host $HOST, port $PORT) ===\033[0m"
    echo -e "\033[90mPOST /api/admin/restart to rebuild & restart.\033[0m"
    echo ""

    set +e
    coc serve --no-open --port "$PORT" --host "$HOST"
    exit_code=$?
    set -e

    if [[ $exit_code -eq $RESTART_EXIT_CODE ]]; then
        echo -e "\n\033[33mRestart requested (exit code $RESTART_EXIT_CODE). Rebuilding...\033[0m"
        continue
    fi

    echo -e "\n\033[36mServer exited with code $exit_code. Stopping loop.\033[0m"
    break
done
