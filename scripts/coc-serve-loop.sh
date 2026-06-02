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
# In tunnel mode (--tunnel-id), hosts the Microsoft Dev Tunnel configured by
# config-devtunnel.sh and serves on its configured HTTP port. Run
# `devtunnel host` is managed for you per serve iteration.
#
# Usage:
#   ./scripts/coc-serve-loop.sh
#   ./scripts/coc-serve-loop.sh -p 8080
#   ./scripts/coc-serve-loop.sh --skip-initial-build
#   ./scripts/config-devtunnel.sh --tunnel-id my-remote-coc
#   ./scripts/coc-serve-loop.sh --tunnel-id my-remote-coc

set -euo pipefail

RESTART_EXIT_CODE=75
PORT=4000
PORT_PROVIDED=false
HOST=127.0.0.1
SKIP_INITIAL_BUILD=false
TUNNEL_ID=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port)
            PORT="$2"
            PORT_PROVIDED=true
            shift 2
            ;;
        -H|--host)
            HOST="$2"
            shift 2
            ;;
        -t|--tunnel-id)
            TUNNEL_ID="$2"
            shift 2
            ;;
        --skip-initial-build)
            SKIP_INITIAL_BUILD=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [-p|--port PORT] [-H|--host ADDR] [-t|--tunnel-id ID] [--skip-initial-build]"
            echo ""
            echo "Options:"
            echo "  -p, --port PORT        Port to serve on (default: 4000). Cannot be used"
            echo "                         with --tunnel-id; configure tunnel ports with"
            echo "                         config-devtunnel.sh instead."
            echo "  -H, --host ADDR        Bind address (default: 127.0.0.1)"
            echo "  -t, --tunnel-id ID     Host the Dev Tunnel with this ID and serve on its"
            echo "                         configured HTTP port (see config-devtunnel.sh)."
            echo "  --skip-initial-build   Skip the first build"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -n "$TUNNEL_ID" ]] && $PORT_PROVIDED; then
    echo "--port cannot be used with --tunnel-id. Configure the tunnel port with config-devtunnel.sh, then start the loop with only --tunnel-id." >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/devtunnel-utils.sh
. "$SCRIPT_DIR/devtunnel-utils.sh"

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
        # Re-run npm install after coc:link because npm link inside workspace packages
        # (packages/forge, packages/coc) triggers a workspace tree re-evaluation that
        # prunes optional peer dependencies (@openai/codex-sdk, @anthropic-ai/claude-agent-sdk)
        # from root node_modules. A second install restores them from the local cache.
        if ! npm install; then
            echo -e "\033[31mPost-link npm install failed with exit code $?.\033[0m"
            popd > /dev/null
            return 1
        fi
        echo -e "\033[32mBuild succeeded.\033[0m"
        popd > /dev/null
        return 0
    else
        echo -e "\033[31mBuild failed with exit code $?.\033[0m"
        popd > /dev/null
        return 1
    fi
}

# ── Dev Tunnel host process ──────────────────────────────────────────────────────

DEVTUNNEL_HOST_PID=""
DEVTUNNEL_HOST_OUT=""

resolve_devtunnel_cmd() {
    if command -v devtunnel >/dev/null 2>&1; then
        command -v devtunnel
        return 0
    fi
    local local_exe="$HOME/.coc/bin/devtunnel"
    if [[ -x "$local_exe" ]]; then
        echo "$local_exe"
        return 0
    fi
    return 1
}

# Selects the public devtunnels.ms URL that matches the served port, falling
# back to the first URL found. Mirrors Select-DevTunnelUrl.
select_devtunnel_url() {
    node -e '
        const text = process.argv[1] || "";
        const port = Number(process.argv[2]);
        const m = text.match(/https:\/\/[^\s,]+devtunnels\.ms[^\s,]*/g);
        if (!m) process.exit(0);
        const urls = m.map((u) => u.replace(/[.;)\]]+$/, ""));
        const matchesPort = (u) => {
            try {
                const x = new URL(u);
                if (Number(x.port) === port) return true;
                const esc = String(port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                return new RegExp("(^|[-.])" + esc + "([-.]|$)").test(x.hostname);
            } catch {
                return false;
            }
        };
        for (const u of urls) if (matchesPort(u)) { console.log(u); process.exit(0); }
        console.log(urls[0]);
    ' "$1" "$2"
}

# Reads the single configured HTTP port for the tunnel. Prints the port on
# success; logs to stderr and returns non-zero otherwise.
resolve_configured_devtunnel_port() {
    local id="$1" cmd out rc=0
    if ! cmd="$(resolve_devtunnel_cmd)"; then
        echo -e "\033[31mdevtunnel CLI not found. Run ./scripts/config-devtunnel.sh before starting the loop with --tunnel-id.\033[0m" >&2
        return 1
    fi

    out="$("$cmd" port list "$id" 2>&1)" || rc=$?
    if is_devtunnel_auth_error "$out"; then
        echo -e "\033[31mdevtunnel is not authenticated. Run '$cmd user login', then rerun this script.\033[0m" >&2
        return 1
    fi
    if (( rc != 0 )); then
        echo -e "\033[31mFailed to list dev tunnel ports for '$id': $out\033[0m" >&2
        return 1
    fi

    local ports=()
    local line
    while IFS= read -r line; do
        [[ -n "$line" ]] && ports+=("$line")
    done < <(get_http_devtunnel_ports "$out" | grep -E '^[0-9]+$')
    if (( ${#ports[@]} == 0 )); then
        echo -e "\033[31mDev tunnel '$id' has no configured HTTP port. Run ./scripts/config-devtunnel.sh -t $id first.\033[0m" >&2
        return 1
    fi
    if (( ${#ports[@]} > 1 )); then
        echo -e "\033[31mDev tunnel '$id' has multiple HTTP ports (${ports[*]}). Remove the extra ports or recreate the tunnel, then rerun this script.\033[0m" >&2
        return 1
    fi
    echo "${ports[0]}"
}

start_devtunnel_host() {
    local id="$1" port="$2" cmd
    if ! cmd="$(resolve_devtunnel_cmd)"; then
        echo -e "\033[33mdevtunnel CLI not found. Run ./scripts/config-devtunnel.sh before starting the loop with --tunnel-id.\033[0m" >&2
        return 1
    fi

    DEVTUNNEL_HOST_OUT="$(mktemp "${TMPDIR:-/tmp}/coc-devtunnel-XXXXXX")"
    "$cmd" host "$id" >"$DEVTUNNEL_HOST_OUT" 2>&1 &
    DEVTUNNEL_HOST_PID=$!

    local timeout="${COC_DEVTUNNEL_URL_TIMEOUT:-30}"
    [[ "$timeout" =~ ^[1-9][0-9]*$ ]] || timeout=30
    local deadline url=""
    deadline=$(( $(date +%s) + timeout ))
    while (( $(date +%s) < deadline )); do
        if ! kill -0 "$DEVTUNNEL_HOST_PID" 2>/dev/null; then break; fi
        url="$(select_devtunnel_url "$(cat "$DEVTUNNEL_HOST_OUT" 2>/dev/null)" "$port")"
        [[ -n "$url" ]] && break
        sleep 0.5
    done

    if [[ -n "$url" ]]; then
        echo -e "\033[32mDev tunnel URL: $url\033[0m"
        return 0
    fi
    return 1
}

# Recursively terminates a process and its descendants (portable; no pkill).
# Sends SIGTERM, then SIGKILL to any survivor after a short grace period.
kill_process_tree() {
    local pid="$1" child
    local children
    children="$(ps -ax -o pid=,ppid= 2>/dev/null | awk -v p="$pid" '$2==p{print $1}')"
    for child in $children; do
        kill_process_tree "$child"
    done
    kill "$pid" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5 6; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null || true
}

stop_devtunnel_host() {
    if [[ -n "$DEVTUNNEL_HOST_PID" ]]; then
        if kill -0 "$DEVTUNNEL_HOST_PID" 2>/dev/null; then
            echo -e "\033[33mStopping dev tunnel process $DEVTUNNEL_HOST_PID...\033[0m"
            kill_process_tree "$DEVTUNNEL_HOST_PID"
        fi
        # Reap the direct background child even if it already exited so it does
        # not linger as a zombie.
        wait "$DEVTUNNEL_HOST_PID" 2>/dev/null || true
    fi
    [[ -n "$DEVTUNNEL_HOST_OUT" ]] && rm -f "$DEVTUNNEL_HOST_OUT" 2>/dev/null || true
    DEVTUNNEL_HOST_PID=""
    DEVTUNNEL_HOST_OUT=""
}

trap stop_devtunnel_host EXIT
trap 'stop_devtunnel_host; exit 130' INT
trap 'stop_devtunnel_host; exit 143' TERM

# ── Main loop ────────────────────────────────────────────────────────────────────

tunnel_enabled=false
if [[ -n "$TUNNEL_ID" ]]; then
    tunnel_enabled=true
    resolve_rc=0
    resolved_port="$(resolve_configured_devtunnel_port "$TUNNEL_ID")" || resolve_rc=$?
    if [[ $resolve_rc -ne 0 ]]; then
        exit 2
    fi
    PORT="$resolved_port"
    echo -e "\033[32mUsing dev tunnel '$TUNNEL_ID' configured HTTP port $PORT.\033[0m"
fi

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

    if $tunnel_enabled; then
        if ! start_devtunnel_host "$TUNNEL_ID" "$PORT"; then
            echo -e "\033[31mFailed to host dev tunnel '$TUNNEL_ID'. Aborting startup instead of serving locally without a working tunnel.\033[0m" >&2
            if [[ -n "$DEVTUNNEL_HOST_OUT" && -s "$DEVTUNNEL_HOST_OUT" ]]; then
                echo -e "\033[31mdevtunnel host output:\033[0m" >&2
                cat "$DEVTUNNEL_HOST_OUT" >&2
            fi
            echo -e "\033[33mVerify you are logged in as the tunnel owner ('devtunnel user login') and that 'devtunnel host $TUNNEL_ID' works, then retry. Set COC_DEVTUNNEL_URL_TIMEOUT to wait longer.\033[0m" >&2
            stop_devtunnel_host
            exit 1
        fi
    fi

    echo ""
    echo -e "\033[36m=== Starting coc serve (host $HOST, port $PORT) ===\033[0m"
    echo -e "\033[90mPOST /api/admin/restart to rebuild & restart.\033[0m"
    echo ""

    set +e
    coc serve --no-open --port "$PORT" --host "$HOST"
    exit_code=$?
    set -e

    stop_devtunnel_host

    if [[ $exit_code -eq $RESTART_EXIT_CODE ]]; then
        echo -e "\n\033[33mRestart requested (exit code $RESTART_EXIT_CODE). Rebuilding...\033[0m"
        continue
    fi

    echo -e "\n\033[36mServer exited with code $exit_code. Stopping loop.\033[0m"
    break
done
