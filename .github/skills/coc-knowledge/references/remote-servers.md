# CoC DevTunnel Remote Servers

This document explains how CoC uses Microsoft Dev Tunnels to expose a CoC server from one machine and connect to it from another CoC dashboard.

## Overview

CoC has two related DevTunnel flows:

1. **Hosting a CoC server through a DevTunnel** on the remote machine.
2. **Registering that DevTunnel as a remote server** in another CoC dashboard.

The tunnel is identified by a stable DevTunnel ID, such as `my-remote-coc`. CoC does not store the public DevTunnel URL as the durable identity. Instead, it stores the tunnel ID and resolves the current local endpoint when it connects.

## Host-side setup

Run these commands on the machine that should host the remote CoC server:

```powershell
.\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc
.\scripts\coc-serve-loop.ps1 -TunnelId my-remote-coc
```

For a persistent Windows service, use:

```powershell
.\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc
.\scripts\Manage-CoCService.ps1 install -TunnelId my-remote-coc
.\scripts\Manage-CoCService.ps1 start
```

`config-devtunnel.ps1` prepares the tunnel:

- Ensures the `devtunnel` CLI is available.
- Creates or reuses the requested tunnel ID.
- Creates or reuses exactly one HTTP port binding.
- Picks a stable free local port if `-Port` is not provided.

`coc-serve-loop.ps1 -TunnelId <id>` then:

- Reads the configured HTTP port with `devtunnel port list <id>`.
- Starts `devtunnel host <id>`.
- Starts `coc serve --no-open --port <configured-port>`.
- Stops the hosted tunnel process when the serve loop exits.

In tunnel mode the loop hosts the tunnel **before** announcing the serve step. If `devtunnel host` fails to start or does not publish a public URL within `COC_DEVTUNNEL_URL_TIMEOUT` seconds (default 30), the loop prints the captured `devtunnel host` output, skips `coc serve`, and exits non-zero (`1`) rather than silently serving on localhost with no working tunnel. (On PowerShell 7 for Linux/macOS the host process is launched without the Windows-only `-WindowStyle Hidden`, which otherwise throws and prevents hosting.)

`Manage-CoCService.ps1 install -TunnelId <id>` wraps the same serve loop in a scheduled task. Do not pass `-Port` with `-TunnelId`; the port belongs to the DevTunnel binding and must be configured with `config-devtunnel.ps1`.

### Linux/WSL equivalents

The bash ports mirror the PowerShell scripts one-to-one and share `scripts/devtunnel-utils.sh`:

```bash
./scripts/config-devtunnel.sh --tunnel-id my-remote-coc
./scripts/coc-serve-loop.sh --tunnel-id my-remote-coc
```

`--tunnel-id`/`-t` maps to `-TunnelId` and `--port`/`-p` maps to `-Port`; the default tunnel ID is `<hostname-lowercased>-coc`. `config-devtunnel.sh` installs the Linux or macOS `devtunnel` build when missing. If the tunnel ID is owned by a different account (devtunnel reports `Tunnel not found` / `request not permitted` / `unauthorized tunnel access`), both scripts print "owned by a different account or in use elsewhere" and exit `2` instead of a confusing not-found message — log in as the tunnel's owner or pick a different `--tunnel-id`.

## Dashboard-side registration

In the CoC dashboard, the Servers view is enabled by default through `servers.enabled` and supports two remote server kinds:

- **Direct URL**: stores a fixed `http://` or `https://` CoC server URL.
- **DevTunnel ID**: stores a DevTunnel ID and lets CoC establish a local tunnel connection.

When you add a DevTunnel remote server, CoC persists an entry like this in the global remote server registry:

```json
{
  "id": "<generated-id>",
  "label": "dev-vm",
  "kind": "devtunnel",
  "tunnelId": "my-remote-coc",
  "addedAt": 0,
  "updatedAt": 0
}
```

The registry file is `~/.coc/remote-servers.json`.

## Connection lifecycle

When a DevTunnel remote server is created, tested, health-checked, or explicitly connected, CoC runs this sequence:

1. Runs `devtunnel port list <tunnelId>`.
2. Parses the output and requires exactly one HTTP port (the remote/host port).
3. Starts `devtunnel connect <tunnelId>` if CoC is not already managing a child process for that tunnel.
4. Reads the **forwarded local port** from the `devtunnel connect` stdout/stderr (it parses lines such as `Forwarding from 127.0.0.1:<local> to host port <host>`), because `devtunnel connect` forwards the remote HTTP port to a possibly-different, often random, local port. If no forwarding line appears within `forwardReadyTimeoutMs` (default 10s), it falls back to the configured HTTP port.
5. Builds the effective local URL as `http://127.0.0.1:<forwarded-local-port>`.
6. Polls `GET /api/health` on that local URL until it is ready or the readiness timeout expires.
7. Marks the runtime state as `online` and records the local port, effective URL, and public URL if the CLI output includes one.

Multiple registered remote servers can point at the same tunnel ID. CoC deduplicates the managed tunnel connection by tunnel ID.

## Runtime state

The persisted server entry contains durable configuration only. Runtime fields are calculated by the running CoC server and returned by the API:

| Field | Meaning |
| --- | --- |
| `status` | `idle`, `connecting`, `online`, `offline`, or `failed` |
| `effectiveUrl` | Local URL used by the current dashboard server, for example `http://127.0.0.1:51234` |
| `localPort` | Forwarded local port from `devtunnel connect` (falls back to the `devtunnel port list` HTTP port) |
| `publicUrl` | Public DevTunnel URL when available from CLI output |
| `lastChecked` | Last runtime state or health check timestamp |
| `lastError` | Last connector error, if any |

Health checks call:

- `GET /api/health`
- `GET /api/admin/version`
- `GET /api/admin/config` for the optional display hostname

If no effective local endpoint is available, health is reported as offline.

Direct URL servers have no managed connector, so their runtime `status` is the last health-probe result against the configured `url`, cached per server id by the routes layer: `online` when reachable, `offline` when not, and `idle` before the first probe. The probe runs on create, edit, and `GET /api/servers/:id/health`; `GET /api/servers` additionally refreshes URL reachability in the background (serve-stale-revalidate) so a reachable direct-URL server converges to `online` on subsequent polls and contributes its clones to the dashboard.

## API routes

The dashboard and client package use these server routes:

| Route | Description |
| --- | --- |
| `GET /api/servers` | List direct URL and DevTunnel remote servers with runtime state |
| `POST /api/servers` | Add a remote server; DevTunnel entries attempt connection immediately |
| `PATCH /api/servers/:id` | Edit a remote server; old unused tunnel connections are disconnected |
| `DELETE /api/servers/:id` | Remove a remote server; unused tunnel connections are disconnected |
| `POST /api/servers/test` | Test a direct URL or DevTunnel input before saving |
| `POST /api/servers/:id/connect` | Connect a DevTunnel or SSH server |
| `POST /api/servers/:id/disconnect` | Disconnect a DevTunnel or SSH server |
| `POST /api/servers/:id/reconnect` | Kill and recreate the managed `devtunnel connect` or `ssh -N` process |
| `GET /api/servers/:id/health` | Connect if needed, then probe health |
| `GET /api/servers/:id/connection` | Return current runtime connection state |
| `POST /api/servers/cherry-pick-transfer` | Initiating-server orchestration for patch-transfer cherry-picks between the current CoC and/or registered online remote CoC servers. The request names source/target `workspaceId` plus optional `serverId` (`local` or omitted means current CoC) and either `source.commitHash` (single) or `source.commitHashes` (oldest-first range), and the route composes each server's existing git patch export/apply APIs in one export + one apply round-trip regardless of range size, without returning effective URLs or local paths. |

Direct URL servers do not support connect, disconnect, or reconnect because they do not have a managed tunnel process.

## Reconnect behavior

Reconnect is available from the Servers UI for DevTunnel and SSH entries. It:

1. Marks the existing managed child process as intentionally stopped.
2. Kills the old `devtunnel connect` / `ssh -N` process if one exists.
3. Clears any in-flight connection attempt.
4. Re-runs the full connection flow: process start and health polling (plus port list for DevTunnel).

Use reconnect when the managed CLI/`ssh` process is stale, the local listener stopped responding, or the public tunnel endpoint changed. SSH connections also auto-reconnect with exponential backoff when the `ssh` process exits unexpectedly.

## Common failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `devtunnel CLI is not installed or not on PATH` | The dashboard machine cannot run `devtunnel` | Install the CLI or add it to `PATH` |
| `devtunnel CLI is not authenticated` | The CLI cannot access the tunnel | Run `devtunnel user login` |
| `No HTTP ports are configured for this DevTunnel` | The tunnel exists but has no HTTP binding | Run `.\scripts\config-devtunnel.ps1 -TunnelId <id>` on the host side |
| `Multiple HTTP ports are configured for this DevTunnel` | CoC cannot choose a single local endpoint | Remove extra HTTP ports or recreate the tunnel |
| `... is not accessible to the current account` / `owned by a different account` | The tunnel ID is owned by a different identity (the host and dashboard logged in with different accounts) | Log in as the tunnel's owner with `devtunnel user login`, or use a different tunnel ID |
| Health is offline with no effective endpoint | The connector failed before local URL resolution | The offline error now surfaces the underlying connector error (auth, CLI missing, readiness timeout); check it and verify `devtunnel port list <id>` works |
| Health is offline with an HTTP or fetch error | The tunnel connected, but CoC is not reachable through the resolved port | Verify the host is running `coc serve` on the configured tunnel port |
| Manual `devtunnel connect <id>` works (forwards to `127.0.0.1:<local>`) but CoC still reports offline | The connector health-checks the wrong local port | Resolved: CoC now parses the forwarded local port from `devtunnel connect` output instead of assuming local port equals the configured HTTP port |
| Same-machine WSL tunnel connects but a remote-node tunnel reports offline | Health requests over a WAN DevTunnel relay exceed the per-attempt timeout | Resolved: each health attempt now has its own budget (`healthRequestTimeoutMs`, default 5s) within a longer readiness window (default 20s) instead of being clamped to the poll interval |

## Implementation map

The core connector classes and types live in `@plusplusoneplusplus/forge/connectors`, shared by both `coc` and `coccontainer`. The coc server files re-export from forge for backward compatibility.

Key files:

- `scripts\config-devtunnel.ps1` configures the stable tunnel and HTTP port binding.
- `scripts\coc-serve-loop.ps1` hosts the tunnel and runs `coc serve`.
- `scripts\Manage-CoCService.ps1` installs and manages the scheduled-task wrapper.
- `packages\forge\src\connectors\types.ts` shared types: `RemoteServer`, `SshRemoteServer`, connection states.
- `packages\forge\src\connectors\health.ts` shared `waitForHealth`, `startProcess`, `defaultHealthChecker`.
- `packages\forge\src\connectors\ssh-connector.ts` manages `ssh -N` child processes with auto-reconnect.
- `packages\forge\src\connectors\devtunnel-connector.ts` manages `devtunnel connect` child processes and readiness polling.
- `packages\forge\src\connectors\devtunnel-port-parser.ts` parses `devtunnel port list` output.
- `scripts/config-devtunnel.sh`, `scripts/coc-serve-loop.sh`, `scripts/devtunnel-utils.sh` are the Linux/WSL equivalents of the host-side PowerShell scripts.
- `packages\coc\src\server\servers\remote-server-store.ts` validates and persists remote server entries.
- `packages\coc\src\server\servers\remote-server-health.ts` probes remote CoC health and metadata.
- `packages\coc\src\server\servers\remote-server-routes.ts` exposes the REST API.
- `packages\coc-client\src\domains\servers.ts` exposes the typed client methods.
- `packages\coc\src\server\spa\client\react\features\servers\` contains the dashboard UI.
- `packages\coccontainer\src\proxy\ssh-bridge.ts` container-specific SSH bridge wrapper using `SshConnector` from forge.
