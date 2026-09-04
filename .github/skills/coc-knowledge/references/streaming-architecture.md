# Streaming & Real-Time Architecture

CoC uses three browser↔server channels plus a WebSocket tunnel for container↔agent
communication.

| Channel | Direction | Purpose | Lifecycle |
|---------|-----------|---------|-----------|
| REST (HTTP) | Browser → Server | Commands (start chat, update settings, CRUD) | Per-request |
| SSE (HTTP) | Server → Browser | Per-process token streaming | Open while viewing a chat, closes on `done` |
| WebSocket | Server ↔ Browser | Global real-time notifications | Persistent (dashboard lifetime) |

## SSE (per-process)

The browser opens `EventSource("GET /api/processes/{processId}/stream")`; the server replies
`Content-Type: text/event-stream` and holds the connection open, streaming tokens, tool calls,
and status for ONE process. It closes when the process completes or the browser navigates away.
Under HTTP/1.1 each SSE is its own TCP connection; under HTTP/2 they multiplex.

The stream starts with a `conversation-snapshot` event carrying persisted turns. When present
on the process record the snapshot includes `sessionTokenLimit`, `sessionCurrentTokens`,
`sessionSystemTokens`, `sessionToolTokens`, and `sessionConversationTokens` so the dashboard
renders the context-window indicator immediately after reconnect.

**Why per-process?** Selective subscription — a browser receives heavy token data only for the
chat it is viewing, instead of every tab being flooded with every process's output.

### Warm-status SSE (`?warm=1`)

`GET /api/processes/{processId}/stream?warm=1` (`streamWarmStatusOnly` in
`streaming/sse-handler.ts`) drives the composer's conversation-warm dot. Unlike the main
stream it sends no conversation snapshot, relays only `warm_status` frames, and stays open
across terminal process status — the dominant case is a finished chat whose provider client is
still parked warm.

On connect it (1) subscribes to process output, (2) registers interest with the
`WarmStatusBridge` under `makeWarmKey(provider, processId)`, then (3) reads
`warmBridge.getCurrentStatus(provider, processId, cwd)` →
`service.getWarmStatus({ warmKey: processId, workingDirectory: cwd })` and sends it as an
**initial `warm_status` snapshot** (`{ status: 'cold' | 'warming' | 'warm' | 'active' }`)
before the first heartbeat. Subscribing before the snapshot read closes the gap where a
transition could fire between registration and listener attachment. The snapshot makes an
already-warm chat show the dot immediately; `cold` snapshots are sent too (useful after
reconnects, unsupported providers, TTL expiry, or restart). A transition racing the snapshot
can duplicate a frame — harmless, since the SPA assigns status idempotently.
`getCurrentStatus` returns `cold` for providers without `getWarmStatus` (e.g. Claude).

### Background-task replay on connect

`BackgroundTasksRegistry` (`streaming/background-tasks-registry.ts`, module singleton) holds
the latest `BackgroundTasksInfo` per processId. `BaseExecutor.buildBackgroundTaskHandler`
records each snapshot there before emitting the live `background-tasks` process event; a
snapshot with `backgroundTotalActive === 0` deletes the entry, so "no entry" and "nothing
active" are the same state. `ChatBaseExecutor` and `FollowUpExecutor` clear the entry in their
turn `finally`, covering the drain-cap abort that never emits a settle.

`handleProcessStream` replays that snapshot as a `background-tasks` frame on connect, so a
reload or a late-opened chat sees the "waiting for background tasks" indicator instead of
nothing. The replay runs after the terminal-status early return (a finished process never gets
a stale indicator), and after the output subscribe, skipped when a live `background-tasks`
event already went out on this stream — the client is last-write-wins, so the older snapshot
must not overwrite it. Nothing is sent when there is no snapshot. The `?warm=1` stream returns
before all replay. State is in-memory on purpose: a background task cannot outlive the server
process, so a persisted snapshot could only ever be wrong after a restart.

## WebSocket (global events)

A single persistent connection opened when the dashboard loads, broadcasting lightweight
status/CRUD notifications about ALL processes and system state to synchronize every open tab.
SSE stays separate because routing token-by-token output for all running processes over this
channel would flood every tab.

### Per-clone global sockets

`useWebSocket` opens the global `/ws` to the LOCAL server only. When remote clones are shown,
`RemoteCloneEventBridge` (`spa/client/react/features/remote-shell/`) opens one additional
global `/ws` per ONLINE remote clone (`getCocClientFor(baseUrl).events.connect`, deduped by
`baseUrl`) and feeds their messages into the same `onMessage` dispatcher, so remote
`process-added/updated/removed` events reach the dashboard and remote task rows transition
`running → completed` live. Per-process token SSE is already routed per-clone via
`useChatSSE`/`cloneApiBase`.

## Cross-Origin Policy (REST + WS) — loopback only

The SPA may talk directly to a *different* CoC server forwarded at
`http://127.0.0.1:{localPort}` — same host, different port, so cross-origin. Both the REST CORS
layer and the WS upgrade path allow cross-origin access **from loopback origins only**:

- `isLoopbackOrigin(origin)` (`packages/coc/src/server/shared/cors.ts`) is the single shared
  predicate: hostname `localhost`, `127.0.0.1`, or `::1`, scheme `http`/`https`, any port.
  Everything else is rejected — other hostnames, non-http(s) schemes, look-alikes such as
  `attacker.localhost.evil.com`, private LAN IPs.
- REST: `applyCorsHeaders()` reflects the request `Origin` only when allowed and **never emits
  `Access-Control-Allow-Origin: *`**. Disallowed origins get no ACAO header. Same-origin and
  no-`Origin` requests are unaffected.
- WS: `attachWebSocketUpgradeHandler()` (`streaming/websocket.ts`) calls
  `isWebSocketOriginAllowed()` before dispatching `/ws` or `/ws/terminal`. A non-loopback
  `Origin` gets `403 Forbidden` and a destroyed socket; a missing `Origin` (non-browser client)
  is allowed.
- Always-on for loopback origins, not gated by `features.remoteShell` (a client-side UI flag).

## Internal Architecture (single Node.js process)

Everything runs in one Node.js process; LLM API calls are async network I/O, not CPU-bound.

### Event producers

| Producer | What it does |
|----------|-------------|
| **Executors** (chat, autopilot, ralph, plan, follow-up) | Call the LLM API, receive streaming tokens, update process state |
| **REST route handlers** (work-items, turns, admin) | Handle browser requests, modify the DB, notify clients |
| **File system watchers** (`fs.watch`) | Detect disk changes (tasks, workflows, templates, notes) |
| **Queue bridge** | Manages the task queue state machine (drain events) |

### ProcessStore — two event channels

```
ProcessStore
├── onProcessOutput(processId, event)   → per-process token/tool streaming
│   Events: chunk, tool-start, tool-complete, tool-failed,
│           permission-request, suggestions, ask-user, canvas-updated,
│           status, done
│
└── onProcessChange(event)              → process lifecycle (global)
    Events: process-added, process-updated, process-removed
```

### WebSocket broadcast catalog

`wsServer.broadcastProcessEvent()` is called from `ProcessStore.onProcessChange` (via
`websocket-infrastructure.ts`) and directly from routes, watchers, the bridge, and executors.

| Event Type | Sender |
|---|---|
| `process-added` / `process-updated` / `process-removed` | store.onProcessChange → websocket-infrastructure |
| `drain-start/progress/complete/timeout` | Queue bridge → websocket-infrastructure |
| `tasks-changed`, `workflows-changed`, `templates-changed` | watcher-infrastructure, routes/index |
| `notes-changed` | watcher-infrastructure |
| `git-changed` | `broadcastGitChanged()` |
| `workspace-topology-changed` | workspace register/update/delete routes |
| `server-topology-changed` | remote-server registry and connection routes |
| `work-item-added` / `work-item-removed` | work-item-routes (added also from work-item-execution-routes) |
| `work-item-updated` | work-item-routes, plan-routes, execution-routes |
| `turn-pinned` / `turn-archived` | turn-actions-handler |
| `memory-promoted` / `memory-promotion-failed` | auto-promote, memory-promote-executor |
| `server-restarting`, `config-changed` | admin-handler |
| `wiki-reload/rebuilding/error` | `broadcastWikiEvent()` |
| `comment-added/updated/deleted` | diff-comments-handler |
| `canvas-updated` | `CanvasUpdateNotifier` — the single fanout every canvas mutation (user save, capability, Kusto create/run) goes through. It emits this WS event AND a ProcessStore/SSE update on the canvas's `processId`; no route emits either on its own |

## Data flow — standalone mode

```
LLM API (external)
  → Executor (receives tokens via HTTP streaming)
    → store.emitProcessEvent(processId, {type:'chunk', content:'...'})
      → ProcessStore.onProcessOutput → SSE handler → browser HTTP response
      → ProcessStore.onProcessChange → wsServer.broadcastProcessEvent() → browser WebSocket
```

## Data flow — container mode (call-home)

The agent connects outbound to the container over WebSocket (the agent knows the container's
public IP); the container never contacts the agent's IP.

```
Browser ←─ SSE (HTTP) ─── Container ←─ WebSocket ─── Agent ──→ LLM API
Browser ←─ WebSocket ──── Container ←─ WebSocket ─── Agent
Browser ──→ REST (HTTP) → Container ──→ WebSocket ──→ Agent
```

### Container link protocol

The single agent↔container WebSocket carries both token streaming and global events:

| Message Type | Direction | Maps To |
|---|---|---|
| `{type:"request", ...}` | Container → Agent | Proxied REST request |
| `{type:"response", ...}` | Agent → Container | REST response |
| `{type:"subscribe-sse", processId}` | Container → Agent | Start streaming this process |
| `{type:"unsubscribe-sse", processId}` | Agent → Container | Stop streaming |
| `{type:"sse-event", processId, data}` | Agent → Container | Token/tool events, re-served as SSE |
| `{type:"event", data}` | Agent → Container | Global notifications, re-served via WebSocket |
| `{type:"heartbeat"}` | Both | Keep-alive (30s interval) |
| `{type:"register/registered"}` | Agent → Container | Initial handshake |

The container translates: `sse-event` becomes `event: chunk\ndata: ...\n\n` on the browser's SSE
response; `event` is forwarded through `wsServer.broadcastProcessEvent()` to the browser's
WebSocket.

### Event forwarding path

When a container link is active, broadcasts fan out via `wsServer.onBroadcast()`:
`broadcastProcessEvent()` / `broadcastGitChanged()` / `broadcastWikiEvent()` sends to local
browser WS clients and passes the same serialized data to registered `onBroadcast` listeners.
`server/index.ts` subscribes the container link
(`wsServer.onBroadcast(data => containerLink.forwardEvent(data))`);
`ContainerLinkClient.forwardEvent()` wraps it as `{type:"event", payload:{data}}` over the
call-home socket; the container's `AgentManager` emits `agent-event` and relays to its browser
WS clients via `wsRelay.emit('message', ...)`.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/streaming/sse-handler.ts` | SSE endpoint, subscribes to `store.onProcessOutput` |
| `packages/coc/src/server/streaming/websocket.ts` | `ProcessWebSocketServer`, `broadcastProcessEvent()` |
| `packages/coc/src/server/infrastructure/websocket-infrastructure.ts` | Wires `store.onProcessChange` and the queue bridge → wsServer |
| `packages/coc/src/server/infrastructure/watcher-infrastructure.ts` | File watchers → wsServer |
| `packages/coc/src/server/container-link/container-client.ts` | Agent-side WS client (call-home) |
| `packages/coc/src/server/container-link/protocol.ts` | Protocol message types |
| `packages/coccontainer/src/inbound/agent-manager.ts` | Container-side WS handler (`AgentManager`) |
| `packages/coc/src/server/spa/client/react/hooks/useWebSocket.ts` | SPA WebSocket hook |
| `packages/coc/src/server/spa/client/react/features/chat/hooks/useChatSSE.ts` | SPA SSE hook |
