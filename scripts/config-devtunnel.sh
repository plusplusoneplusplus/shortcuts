#!/usr/bin/env bash
#
# Installs and configures the Microsoft Dev Tunnel used by the CoC service (Linux/WSL).
#
# Linux/WSL counterpart of config-devtunnel.ps1. Ensures the devtunnel CLI is
# available, creates or reuses the stable CoC tunnel ID, and owns the persistent
# TunnelId -> HTTP port binding. It does NOT host the tunnel; use
# coc-serve-loop.sh --tunnel-id <id> to read the configured binding and start
# devtunnel host together with the server:
#
#   ./scripts/coc-serve-loop.sh --tunnel-id <tunnel-id>
#
# Usage:
#   ./scripts/config-devtunnel.sh
#   ./scripts/config-devtunnel.sh --tunnel-id my-remote-coc
#   ./scripts/config-devtunnel.sh --tunnel-id my-remote-coc --port 51234
#
# Exit codes: 0 = ready, 1 = unavailable, 2 = unauthenticated / invalid config.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/devtunnel-utils.sh
. "$SCRIPT_DIR/devtunnel-utils.sh"

PORT=""
PORT_PROVIDED=false
TUNNEL_ID="$(hostname | tr '[:upper:]' '[:lower:]')-coc"
LOCAL_BIN="$HOME/.coc/bin"
LOCAL_EXE="$LOCAL_BIN/devtunnel"
DEVTUNNEL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port)
            PORT="$2"
            PORT_PROVIDED=true
            shift 2
            ;;
        -t|--tunnel-id)
            TUNNEL_ID="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [-t|--tunnel-id ID] [-p|--port PORT]"
            echo ""
            echo "Options:"
            echo "  -t, --tunnel-id ID   Dev Tunnel ID to configure (default: <hostname>-coc)"
            echo "  -p, --port PORT      HTTP port to expose. If omitted, a random free"
            echo "                       local port is selected and persisted on the tunnel."
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

log() {
    local color="$1"; shift
    echo -e "\033[${color}m[$(date '+%Y-%m-%d %H:%M:%S')] $*\033[0m"
}
log_info()  { log 37 "$*"; }
log_cyan()  { log 36 "$*"; }
log_green() { log 32 "$*"; }
log_warn()  { log 33 "$*"; }
log_error() { log 31 "$*"; }

if $PORT_PROVIDED && { ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); }; then
    log_error "--port must be between 1 and 65535."
    exit 2
fi

# ── devtunnel CLI resolution / install ──────────────────────────────────────────

install_devtunnel_cli() {
    if command -v devtunnel >/dev/null 2>&1; then
        DEVTUNNEL="$(command -v devtunnel)"
        return 0
    fi

    if [[ -x "$LOCAL_EXE" ]]; then
        DEVTUNNEL="$LOCAL_EXE"
        log_green "Using devtunnel CLI from $LOCAL_EXE"
        return 0
    fi

    log_warn "devtunnel CLI not found. Downloading to $LOCAL_EXE..."
    mkdir -p "$LOCAL_BIN"

    local arch os url
    arch="$(uname -m)"
    os="$(uname -s)"
    case "$os" in
        Linux)
            case "$arch" in
                x86_64|amd64) url="https://aka.ms/TunnelsCliDownload/linux-x64" ;;
                aarch64|arm64) url="https://aka.ms/TunnelsCliDownload/linux-arm64" ;;
                *) url="" ;;
            esac
            ;;
        Darwin)
            case "$arch" in
                x86_64|amd64) url="https://aka.ms/TunnelsCliDownload/osx-x64" ;;
                arm64|aarch64) url="https://aka.ms/TunnelsCliDownload/osx-arm64" ;;
                *) url="" ;;
            esac
            ;;
        *) url="" ;;
    esac
    if [[ -z "$url" ]]; then
        log_error "Unsupported platform '$os/$arch'. Install devtunnel manually from https://learn.microsoft.com/azure/developer/dev-tunnels/get-started."
        return 1
    fi

    if curl -fsSL "$url" -o "$LOCAL_EXE"; then
        chmod +x "$LOCAL_EXE"
        if "$LOCAL_EXE" --version >/dev/null 2>&1; then
            DEVTUNNEL="$LOCAL_EXE"
            log_green "devtunnel CLI installed to $LOCAL_EXE."
            return 0
        fi
    fi

    log_error "Unable to install devtunnel CLI. Install it manually from https://learn.microsoft.com/azure/developer/dev-tunnels/get-started."
    return 1
}

is_already_configured() {
    grep -qiE 'already exists|conflict with existing entity' <<<"$1"
}

# ── Main ────────────────────────────────────────────────────────────────────────

if $PORT_PROVIDED; then
    log_cyan "=== Configuring dev tunnel '$TUNNEL_ID' for requested port $PORT ==="
else
    log_cyan "=== Configuring dev tunnel '$TUNNEL_ID' for a persistent generated port ==="
fi

if ! install_devtunnel_cli; then
    exit 1
fi

create_out="$("$DEVTUNNEL" create "$TUNNEL_ID" 2>&1)"
create_rc=$?
if is_devtunnel_auth_error "$create_out"; then
    log_warn "devtunnel is not authenticated. Run '$DEVTUNNEL user login', then rerun this script."
    exit 2
fi
if (( create_rc != 0 )) && ! is_already_configured "$create_out"; then
    log_error "Failed to create dev tunnel '$TUNNEL_ID': $create_out"
    exit 1
fi

list_out="$("$DEVTUNNEL" port list "$TUNNEL_ID" 2>&1)"
list_rc=$?
if is_devtunnel_auth_error "$list_out"; then
    log_warn "devtunnel is not authenticated. Run '$DEVTUNNEL user login', then rerun this script."
    exit 2
fi
if (( list_rc != 0 )); then
    log_error "Failed to list dev tunnel ports for '$TUNNEL_ID': $list_out"
    exit 1
fi

existing_ports=()
while IFS= read -r line; do
    [[ -n "$line" ]] && existing_ports+=("$line")
done < <(get_http_devtunnel_ports "$list_out" | grep -E '^[0-9]+$')

if (( ${#existing_ports[@]} > 1 )); then
    log_error "Dev tunnel '$TUNNEL_ID' has multiple HTTP ports (${existing_ports[*]}). Remove the extra ports or recreate the tunnel, then rerun this script."
    exit 2
fi

if (( ${#existing_ports[@]} == 1 )); then
    resolved_port="${existing_ports[0]}"
    if $PORT_PROVIDED && [[ "$PORT" != "$resolved_port" ]]; then
        log_warn "Dev tunnel '$TUNNEL_ID' already has HTTP port $resolved_port; reusing it instead of requested port $PORT."
    fi
    log_green "Dev tunnel '$TUNNEL_ID' is configured for HTTP port $resolved_port."
    log_green "Start CoC with: ./scripts/coc-serve-loop.sh --tunnel-id $TUNNEL_ID"
    exit 0
fi

if $PORT_PROVIDED; then
    resolved_port="$PORT"
else
    resolved_port="$(get_random_free_port)"
    log_warn "No HTTP port is configured for '$TUNNEL_ID'. Selected free local port $resolved_port."
fi

port_out="$("$DEVTUNNEL" port create "$TUNNEL_ID" -p "$resolved_port" --protocol http 2>&1)"
port_rc=$?
if is_devtunnel_auth_error "$port_out"; then
    log_warn "devtunnel is not authenticated. Run '$DEVTUNNEL user login', then rerun this script."
    exit 2
fi
if (( port_rc != 0 )) && ! is_already_configured "$port_out"; then
    log_error "Failed to create dev tunnel port $resolved_port for '$TUNNEL_ID': $port_out"
    exit 1
fi

log_green "Dev tunnel '$TUNNEL_ID' is configured for HTTP port $resolved_port."
log_green "Start CoC with: ./scripts/coc-serve-loop.sh --tunnel-id $TUNNEL_ID"
exit 0
