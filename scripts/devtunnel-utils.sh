#!/usr/bin/env bash
#
# Shared Microsoft Dev Tunnel helpers for the CoC service scripts (Linux/WSL).
# Linux/WSL counterpart of devtunnel-utils.ps1. Source this file; it only
# defines functions and has no top-level side effects.

# Returns 0 when the devtunnel CLI output indicates an authentication problem.
is_devtunnel_auth_error() {
    grep -qiE 'not logged in|not authenticated|login required|log in|\b401\b|unauthorized' <<<"${1:-}"
}

# Returns 0 when the devtunnel CLI output indicates the tunnel ID exists but is
# not accessible to the current account: owned by a different identity or in use
# elsewhere. These signals surface when listing/inspecting the tunnel, never for
# a tunnel the current account owns, so they unambiguously indicate ownership.
is_devtunnel_not_owned_error() {
    grep -qiE 'tunnel not found|request not permitted|unauthorized tunnel access' <<<"${1:-}"
}

# Parses HTTP port numbers from `devtunnel port list` output. Handles JSON,
# table, and key-value styles (mirrors Get-HttpDevTunnelPorts). Prints one
# unique port per line.
get_http_devtunnel_ports() {
    node -e '
        let raw = "";
        process.stdin.on("data", (d) => (raw += d));
        process.stdin.on("end", () => {
            const ports = new Set();
            const add = (value) => {
                const n = Number(value);
                if (Number.isInteger(n) && n >= 1 && n <= 65535) ports.add(n);
            };

            // 1. JSON output.
            try {
                const data = JSON.parse(raw.trim());
                let items = [];
                if (Array.isArray(data)) items = data;
                else if (data && Array.isArray(data.ports)) items = data.ports;
                else if (data && Array.isArray(data.items)) items = data.items;
                else if (data) items = [data];
                for (const it of items) {
                    if (!it) continue;
                    const proto = String(it.protocol ?? it.protocols ?? "").toLowerCase();
                    const port = it.portNumber ?? it.port ?? it.port_number ?? it.number;
                    if (/\bhttp\b/.test(proto) && /^\d+$/.test(String(port))) add(port);
                }
            } catch {
                // devtunnel defaults to table output; fall through to text parsing.
            }

            // 2. Table / key-value output.
            let pending = null;
            for (const line of raw.split(/\r?\n/)) {
                const t = line.trim();
                if (!t) continue;
                const km = t.match(/\bport(?:\s+number)?\b\s*[:=]\s*(\d{1,5})/i);
                if (km) pending = Number(km[1]);
                if (/\bprotocol\b\s*[:=]\s*http\b/i.test(t)) {
                    if (pending !== null) {
                        add(pending);
                        pending = null;
                    }
                    continue;
                }
                if (/\bhttp\b/i.test(t)) {
                    const nm = t.match(/(?<![\d.])([1-9]\d{0,4})(?![\d.])/);
                    if (nm) add(nm[1]);
                }
            }

            console.log([...ports].join("\n"));
        });
    ' <<<"${1:-}"
}

# Prints a free local TCP port chosen by the OS.
get_random_free_port() {
    node -e 'const n=require("net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()});'
}
