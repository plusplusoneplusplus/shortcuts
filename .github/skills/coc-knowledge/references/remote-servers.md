# CoC DevTunnel Remote Servers

How CoC exposes a server from one machine through Microsoft Dev Tunnels and connects to it
from another CoC dashboard. Two flows: **hosting** a CoC server behind a DevTunnel, and
**registering** that tunnel as a remote server in another dashboard.

Durable identity is the tunnel ID (e.g. `my-remote-coc`), not the public DevTunnel URL. CoC
stores the ID and resolves the current local endpoint at connect time.

## Host-side setup

```powershell
.\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc
.\scripts\coc-serve-loop.ps1 -TunnelId my-remote-coc
```

For a persistent Windows service, replace the second line with
`.\scripts\Manage-CoCService.ps1 install -TunnelId my-remote-coc` then `... start`; it wraps
the same serve loop in a scheduled task. Do not pass `-Port` with `-TunnelId` — the port
belongs to the DevTunnel binding and is configured by `config-devtunnel.ps1`.

`config-devtunnel.ps1` ensures the `devtunnel` CLI is available, creates or reuses the tunnel
ID, creates or reuses exactly one HTTP port binding, and picks a stable free local port when
`-Port` is omitted.

`coc-serve-loop.ps1 -TunnelId <id>` reads the configured HTTP port with
`devtunnel port list <id>`, starts `devtunnel host <id>`, starts
`coc serve --no-open --port <configured-port>`, and stops the hosted tunnel process on exit.
In tunnel mode it hosts the tunnel **before** announcing the serve step: if `devtunnel host`
fails to start or publishes no public URL within `COC_DEVTUNNEL_URL_TIMEOUT` seconds (default
30), the loop prints the captured host output, skips `coc serve`, and exits `1` rather than
serving on localhost with a dead tunnel. On PowerShell 7 for Linux/macOS the host process is
launched without the Windows-only `-WindowStyle Hidden`, which otherwise throws.

### Linux/WSL equivalents

The bash ports mirror the PowerShell scripts one-to-one and share `scripts/devtunnel-utils.sh`:

```bash
./scripts/config-devtunnel.sh --tunnel-id my-remote-coc
./scripts/coc-serve-loop.sh --tunnel-id my-remote-coc
```

`--tunnel-id`/`-t` maps to `-TunnelId`, `--port`/`-p` to `-Port`; the default tunnel ID is
`<hostname-lowercased>-coc`. `config-devtunnel.sh` installs the Linux or macOS `devtunnel`
build when missing. When the tunnel ID belongs to a different account (devtunnel reports
`Tunnel not found`, `request not permitted`, or `unauthorized tunnel access`), both scripts
print "owned by a different account or in use elsewhere" and exit `2`.

## Dashboard-side registration

The Servers view is enabled by default through `servers.enabled` and supports two remote
server kinds: **Direct URL** (a fixed `http(s)://` CoC server URL) and **DevTunnel ID** (a
tunnel ID CoC connects to locally). Entries persist in the global registry
`~/.coc/remote-servers.json`:

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

## Connection lifecycle

When a DevTunnel server is created, tested, health-checked, or explicitly connected:

1. Run `devtunnel port list <tunnelId>`; require exactly one HTTP port (the remote/host port).
2. Start `devtunnel connect <tunnelId>` unless CoC already manages a child process for it.
3. Read the **forwarded local port** from connect stdout/stderr (lines like
   `Forwarding from 127.0.0.1:<local> to host port <host>`), because `devtunnel connect`
   forwards the remote port to a possibly-random local port. If no forwarding line appears
   within `forwardReadyTimeoutMs` (default 10s), fall back to the configured HTTP port.
4. Build the effective local URL `http://127.0.0.1:<forwarded-local-port>`.
5. Poll `GET /api/health` on it until ready or the readiness timeout (default 20s) expires.
   Each attempt has its own budget (`healthRequestTimeoutMs`, default 5s) so WAN relay latency
   does not clamp it to the poll interval.
6. Mark runtime state `online`, recording local port, effective URL, and public URL when the
   CLI output includes one.

Multiple registered servers may point at the same tunnel ID; CoC deduplicates the managed
connection by tunnel ID.

## Runtime state

The persisted entry holds durable configuration only. Runtime fields are computed by the
running server and returned by the API:

| Field | Meaning |
| --- | --- |
| `status` | `idle`, `connecting`, `online`, `offline`, or `failed` |
| `effectiveUrl` | Local URL used by the current dashboard server, e.g. `http://127.0.0.1:51234` |
| `localPort` | Forwarded local port from `devtunnel connect` (falls back to the port-list HTTP port) |
| `publicUrl` | Public DevTunnel URL when available from CLI output |
| `lastChecked` | Last runtime state or health check timestamp |
| `lastError` | Last connector error, if any |

Health checks call `GET /api/health`, `GET /api/admin/version`, and `GET /api/admin/config`
(optional display hostname). With no effective local endpoint, health is offline and the error
surfaces the underlying connector failure (auth, missing CLI, readiness timeout).

Direct URL servers have no managed connector, so their `status` is the last health-probe result
against the configured `url`, cached per server id by `RemoteServerRuntimeService`: `online`
when reachable, `offline` when not, `idle` before the first probe. The probe runs on create,
edit, and `GET /api/servers/:id/health`; `GET /api/servers` also refreshes reachability in the
background (stale-while-revalidate) so a reachable direct-URL server converges to `online` and
contributes its clones to the dashboard.

## API routes

| Route | Description |
| --- | --- |
| `GET /api/servers` | List direct URL and DevTunnel servers with runtime state |
| `POST /api/servers` | Add a server; DevTunnel entries attempt connection immediately |
| `PATCH /api/servers/:id` | Edit a server; unused tunnel connections are disconnected |
| `DELETE /api/servers/:id` | Remove a server; unused tunnel connections are disconnected |
| `POST /api/servers/test` | Test a direct URL or DevTunnel input before saving |
| `POST /api/servers/:id/connect` | Connect a DevTunnel or SSH server |
| `POST /api/servers/:id/disconnect` | Disconnect a DevTunnel or SSH server |
| `POST /api/servers/:id/reconnect` | Kill and recreate the managed `devtunnel connect` / `ssh -N` process |
| `GET /api/servers/:id/health` | Connect if needed, then probe health |
| `GET /api/servers/:id/connection` | Current runtime connection state |
| `POST /api/servers/cherry-pick-transfer` | Initiating-server orchestration for patch-transfer cherry-picks between the current CoC and/or registered online remote CoC servers |

Direct URL servers do not support connect/disconnect/reconnect — there is no managed process.

`cherry-pick-transfer` names source/target `workspaceId` plus optional `serverId` (`local` or
omitted means the current CoC) and either `source.commitHash` (single) or
`source.commitHashes` (oldest-first range). The route composes each server's existing git patch
export/apply APIs into one export + one apply round-trip regardless of range size, without
returning effective URLs or local paths.

## Reconnect behavior

Reconnect (DevTunnel and SSH entries) marks the managed child process as intentionally stopped,
kills it, clears any in-flight connection attempt, and re-runs the full connection flow
(process start, health polling, plus port list for DevTunnel). Use it when the managed process
is stale, the local listener stopped responding, or the public endpoint changed. SSH
connections also auto-reconnect with exponential backoff when `ssh` exits unexpectedly.

## Common failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `devtunnel CLI is not installed or not on PATH` | Dashboard machine cannot run `devtunnel` | Install the CLI or add it to `PATH` |
| `devtunnel CLI is not authenticated` | CLI cannot access the tunnel | `devtunnel user login` |
| `No HTTP ports are configured for this DevTunnel` | Tunnel exists with no HTTP binding | Run `config-devtunnel.ps1 -TunnelId <id>` host-side |
| `Multiple HTTP ports are configured for this DevTunnel` | CoC cannot choose a single local endpoint | Remove extra HTTP ports or recreate the tunnel |
| `... is not accessible to the current account` / `owned by a different account` | Host and dashboard logged in with different identities | `devtunnel user login` as the owner, or use another tunnel ID |
| Health offline with no effective endpoint | Connector failed before local URL resolution | Read the surfaced connector error; verify `devtunnel port list <id>` |
| Health offline with an HTTP or fetch error | Tunnel connected but CoC is unreachable on the resolved port | Verify the host runs `coc serve` on the configured tunnel port |

## Implementation map

Core connector classes and types live in `@plusplusoneplusplus/forge/connectors`, shared by
`coc` and `coccontainer`; coc server files re-export from forge.

- `scripts/config-devtunnel.ps1` — tunnel and HTTP port binding.
- `scripts/coc-serve-loop.ps1` — hosts the tunnel and runs `coc serve`.
- `scripts/Manage-CoCService.ps1` — scheduled-task wrapper.
- `scripts/config-devtunnel.sh`, `scripts/coc-serve-loop.sh`, `scripts/devtunnel-utils.sh` —
  Linux/WSL equivalents.
- `packages/forge/src/connectors/types.ts` — `RemoteServer`, `SshRemoteServer`, connection states.
- `packages/forge/src/connectors/health.ts` — `waitForHealth`, `startProcess`, `defaultHealthChecker`.
- `packages/forge/src/connectors/ssh-connector.ts` — `ssh -N` child processes with auto-reconnect.
- `packages/forge/src/connectors/devtunnel-connector.ts` — `devtunnel connect` processes and readiness polling.
- `packages/forge/src/connectors/devtunnel-port-parser.ts` — parses `devtunnel port list` output.
- `packages/coc/src/server/servers/remote-server-store.ts` — validates and persists entries.
- `packages/coc/src/server/servers/remote-server-health.ts` — probes remote CoC health and metadata.
- `packages/coc/src/server/servers/remote-server-runtime-service.ts` — runtime decoration,
  direct-URL health caching, connector lifecycle, health checks, restart proxying.
- `packages/coc/src/server/servers/cherry-pick-transfer-service.ts` — cross-server transfer orchestration.
- `packages/coc/src/server/servers/remote-server-routes.ts` — thin HTTP adapter over those services.
- `packages/coc-client/src/domains/servers.ts` — typed client methods.
- `packages/coc/src/server/spa/client/react/features/servers/` — dashboard UI.
- `packages/coccontainer/src/proxy/ssh-bridge.ts` — container SSH bridge over forge's `SshConnector`.
