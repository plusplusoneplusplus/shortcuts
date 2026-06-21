# Streaming & Real-Time Architecture

CoC uses three communication channels between server and browser, plus a WebSocket tunnel for container↔agent communication.

## Communication Channels (Browser ↔ Server)

| Channel | Direction | Purpose | Lifecycle |
|---------|-----------|---------|-----------|
| REST (HTTP) | Browser → Server | Commands (start chat, update settings, CRUD) | Per-request |
| SSE (HTTP) | Server → Browser | Per-process token streaming | Open while viewing a chat, closes on `done` |
| WebSocket | Server ↔ Browser | Global real-time notifications | Persistent (dashboard lifetime) |

### SSE (Server-Sent Events)

- Browser opens `EventSource("GET /api/processes/{processId}/stream")`
- Server responds with `Content-Type: text/event-stream`, keeps connection open
- Connection starts with a `conversation-snapshot` event for persisted turns. When present on the process record, the snapshot includes `sessionTokenLimit`, `sessionCurrentTokens`, `sessionSystemTokens`, `sessionToolTokens`, and `sessionConversationTokens` so the dashboard can render the context-window indicator immediately after reconnect.
- Streams tokens, tool calls, status for ONE specific process
- Closes when process completes or browser navigates away
- Under HTTP/1.1 (localhost): each SSE = separate TCP connection
- Under HTTP/2: multiplexed over one TCP connection

**Why per-process SSE?** Selective subscription — browser only receives heavy token data for the chat it's actively viewing. Avoids flooding all tabs with all processes' output.

### Warm-status SSE (`?warm=1`)

`GET /api/processes/{processId}/stream?warm=1` is a lightweight variant (`streamWarmStatusOnly` in `streaming/sse-handler.ts`) used solely to drive the composer's "session warm" dot. Unlike the main stream it sends no conversation snapshot, relays only `warm_status` frames, and stays open across terminal process status (the dominant case is a finished chat whose provider client is still parked warm).

On connect it: (1) subscribes to process output, (2) registers interest with the `WarmStatusBridge`, then (3) reads `warmBridge.getCurrentStatus(provider, cwd)` and sends it as an **initial `warm_status` snapshot** (`{ status: 'cold' | 'warming' | 'warm' | 'active' }`) before the first heartbeat. Subscribing before the snapshot read closes the gap where a transition could fire between registration and the listener attaching. The snapshot makes an already-warm chat show the dot immediately instead of waiting for the next transition; `cold` snapshots are sent too (useful after reconnects, unsupported providers, TTL expiry, or restart). A transition racing the snapshot can produce a duplicate frame — harmless, since the SPA assigns status idempotently. `getCurrentStatus` returns `cold` for providers without `getWarmStatus` (e.g. Claude).

### WebSocket (Global Events)

- Single persistent connection opened when dashboard loads
- Broadcasts lightweight status/CRUD notifications about ALL processes and system state
- Used for UI synchronization across all open browser tabs

### Why Both SSE and WebSocket?

- SSE = heavy payload, selective (only viewed chat)
- WebSocket = lightweight notifications, global (all events to all clients)
- If everything went through WebSocket, every browser tab would receive token-by-token output from ALL running processes

### Cross-Origin Policy (REST + WS) — loopback only

The dashboard SPA may talk directly to a *different* CoC server forwarded at `http://127.0.0.1:{localPort}` (a cross-origin call: same host, different port). Both the REST CORS layer and the WS upgrade path therefore allow cross-origin access **from loopback origins only**:

- `isLoopbackOrigin(origin)` (`packages/coc/src/server/shared/cors.ts`) is the single shared predicate. Loopback = hostname `localhost`, `127.0.0.1`, or `::1`, scheme `http`/`https`, any port. Everything else (other hostnames, non-http(s) schemes, look-alikes like `attacker.localhost.evil.com`, private LAN IPs) is rejected.
- REST: `applyCorsHeaders()` reflects the request `Origin` only when allowed and **never emits `Access-Control-Allow-Origin: *`**. Non-loopback origins get no ACAO header (browser blocks the read). Same-origin / no-`Origin` requests are unaffected.
- WS: `attachWebSocketUpgradeHandler()` (`streaming/websocket.ts`) calls `isWebSocketOriginAllowed()` before dispatching `/ws` or `/ws/terminal`. A non-loopback `Origin` upgrade is answered `403 Forbidden` and the socket destroyed; a missing `Origin` (non-browser client) is allowed.
- This is always-on for loopback origins (not gated by `features.remoteShell`, which is a client-side UI flag).

**Per-clone global sockets (dashboard).** `useWebSocket` opens the global `/ws` to the LOCAL server only. When remote clones are shown, `RemoteCloneEventBridge` (`spa/client/react/features/remote-shell/`) opens one additional global `/ws` per ONLINE remote clone (`getCocClientFor(baseUrl).events.connect`, deduped by `baseUrl`) and feeds their messages into the same `onMessage` dispatcher — so remote processes' `process-added/updated/removed` lifecycle events reach the dashboard and remote task rows transition `running → completed` live, exactly like local ones. The per-process token SSE is already routed per-clone via `useChatSSE`/`cloneApiBase`.

## Internal Architecture (Single Node.js Process)

Everything runs in one Node.js process. LLM API calls are async network I/O (not CPU-bound).

### Event Producers

| Producer | What it does |
|----------|-------------|
| **Executors** (chat, autopilot, ralph, plan, follow-up) | Call LLM API, receive streaming tokens, update process state |
| **REST Route Handlers** (work-items, turns, admin) | Handle browser requests, modify DB, notify clients |
| **File System Watchers** (fs.watch) | Detect file changes on disk (tasks, workflows, templates, notes) |
| **Queue Bridge** | Manages task queue state machine (drain events) |

### ProcessStore — Two Separate Event Channels

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

### WebSocket Broadcast — All Event Types

`wsServer.broadcastProcessEvent()` is called from two sources:

1. **ProcessStore.onProcessChange** (via websocket-infrastructure.ts)
2. **Direct calls** from routes, watchers, bridge, executors

Full catalog:

| Event Type | Sender |
|---|---|
| `process-added` | store.onProcessChange → websocket-infrastructure |
| `process-updated` | store.onProcessChange → websocket-infrastructure |
| `process-removed` | store.onProcessChange → websocket-infrastructure |
| `drain-start/progress/complete/timeout` | Queue bridge → websocket-infrastructure |
| `tasks-changed` | watcher-infrastructure, routes/index |
| `workflows-changed` | watcher-infrastructure, routes/index |
| `templates-changed` | watcher-infrastructure, routes/index |
| `notes-changed` | watcher-infrastructure |
| `git-changed` | broadcastGitChanged() |
| `work-item-added` | work-item-routes, work-item-execution-routes |
| `work-item-updated` | work-item-routes, plan-routes, execution-routes |
| `work-item-removed` | work-item-routes |
| `turn-deleted` | turn-actions-handler |
| `turn-pinned` | turn-actions-handler |
| `turn-archived` | turn-actions-handler |
| `memory-promoted` | auto-promote, memory-promote-executor |
| `memory-promotion-failed` | auto-promote, memory-promote-executor |
| `server-restarting` | admin-handler |
| `config-changed` | admin-handler |
| `wiki-reload/rebuilding/error` | broadcastWikiEvent() |
| `comment-added/updated/deleted` | diff-comments-handler |
| `canvas-updated` | canvas-routes (user saves; AI edits use the per-process SSE channel instead) |

## Data Flow — Standalone Mode

```
LLM API (external)
  → Executor (receives tokens via HTTP streaming)
    → store.emitProcessEvent(processId, {type:'chunk', content:'...'})
      → ProcessStore.onProcessOutput listeners:
        → SSE Handler → writes to browser HTTP response
      → ProcessStore.onProcessChange:
        → wsServer.broadcastProcessEvent() → browser WebSocket
```

## Data Flow — Container Mode (Call-Home)

Agent connects outbound to container via WebSocket (agent knows container's public IP).
Container never contacts agent's IP.

```
Browser ←─ SSE (HTTP) ─── Container ←─ WebSocket ─── Agent ──→ LLM API
Browser ←─ WebSocket ──── Container ←─ WebSocket ─── Agent
Browser ──→ REST (HTTP) → Container ──→ WebSocket ──→ Agent
```

### Container Link Protocol (over WebSocket)

The single agent↔container WebSocket carries both token streaming AND global events:

| Message Type | Direction | Maps To |
|---|---|---|
| `{type:"request", ...}` | Container → Agent | Proxied REST request |
| `{type:"response", ...}` | Agent → Container | REST response |
| `{type:"subscribe-sse", processId}` | Container → Agent | "Start streaming this process to me" |
| `{type:"unsubscribe-sse", processId}` | Agent → Container | "Stop streaming" |
| `{type:"sse-event", processId, data}` | Agent → Container | Token/tool events (re-served as SSE to browser) |
| `{type:"event", data}` | Agent → Container | Global notifications (re-served via WebSocket to browser) |
| `{type:"heartbeat"}` | Both | Keep-alive (30s interval) |
| `{type:"register/registered"}` | Agent → Container | Initial handshake |

### Container as Translator

Container receives WebSocket JSON from agent and re-serves to its browser:
- `{type:"sse-event"}` → writes `event: chunk\ndata: ...\n\n` to browser's SSE HTTP response
- `{type:"event"}` → forwards via `wsServer.broadcastProcessEvent()` to browser's WebSocket

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Agent (CoC) — Single Node.js Process                  │
│                                                                         │
│  ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌─────────────────┐    │
│  │ Executor   │ │ REST Route  │ │  FS Watch  │ │  Queue Bridge   │    │
│  │(calls LLM) │ │  Handlers   │ │            │ │                 │    │
│  └─────┬──────┘ └──────┬──────┘ └─────┬──────┘ └───────┬─────────┘    │
│        │               │              │                │              │
│        │ tokens        │ direct call  │ direct call    │ direct call  │
│        ▼               ▼              ▼                ▼              │
│  ┌───────────────┐   ┌──────────────────────────────────────────┐     │
│  │ ProcessStore  │   │       ProcessWebSocketServer (wsServer)  │     │
│  │               │   │                                          │     │
│  │ onProcess     │   │       broadcastProcessEvent(msg)         │     │
│  │  Output()  ───┼──→│  (also fed by store.onProcessChange)     │     │
│  │               │   │                                          │     │
│  │ onProcess     │   │       onBroadcast() → Container Link     │     │
│  │  Change() ────┼──────────────────────┘                             │
│  └───────┬───────┘                      │                             │
│          │                              │                             │
│   ┌──────┴──────┐               ┌──────┴──────┐                      │
│   ▼             ▼               ▼             ▼                       │
│ ┌──────┐ ┌──────────┐    ┌──────────┐ ┌──────────────┐               │
│ │ SSE  │ │Container │    │ Browser  │ │  Container   │               │
│ │Handle│ │Link(WS)  │    │   WS     │ │  Link (WS)   │               │
│ │(HTTP)│ │sse-event │    │          │ │  event msgs  │               │
│ └──┬───┘ └────┬─────┘    └────┬─────┘ └──────┬───────┘               │
│    │          │               │              │                        │
└────┼──────────┼───────────────┼──────────────┼────────────────────────┘
     │          │               │              │
     ▼          ▼               ▼              ▼
┌────────┐ ┌────────┐    ┌────────┐      ┌─────────┐
│Browser │ │Containe│    │Browser │      │Container│
│SSE     │ │r       │    │  WS    │      │         │
│(tokens)│ │(:5000) │    │(events)│      │ (:5000) │
└────────┘ └───┬────┘    └────────┘      └────┬────┘
               │                              │
               └──────────┬───────────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │ Browser (SPA) │
                  │ on Container  │
                  │               │
                  │ ← SSE tokens  │
                  │ ← WS events   │
                  └───────────────┘
```

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/streaming/sse-handler.ts` | SSE endpoint, subscribes to `store.onProcessOutput` |
| `packages/coc/src/server/streaming/websocket.ts` | `ProcessWebSocketServer`, `broadcastProcessEvent()` |
| `packages/coc/src/server/infrastructure/websocket-infrastructure.ts` | Wires `store.onProcessChange` → wsServer, queue bridge → wsServer |
| `packages/coc/src/server/infrastructure/watcher-infrastructure.ts` | File watchers → wsServer |
| `packages/coc/src/server/container-link/container-client.ts` | Agent-side WS client (call-home) |
| `packages/coc/src/server/container-link/protocol.ts` | Protocol message types |
| `packages/coccontainer/src/inbound/inbound-agent-manager.ts` | Container-side WS handler |
| `packages/coc/src/server/spa/client/react/hooks/useWebSocket.ts` | SPA WebSocket hook |
| `packages/coc/src/server/spa/client/react/features/chat/hooks/useChatSSE.ts` | SPA SSE hook |

## Container Link Event Forwarding

When a container link is active, broadcast events are forwarded via `wsServer.onBroadcast()`:

1. `ProcessWebSocketServer.broadcastProcessEvent()` / `broadcastGitChanged()` / `broadcastWikiEvent()` sends to local browser WebSocket clients
2. The same serialized data is passed to registered `onBroadcast` listeners
3. In `server/index.ts`, the container link subscribes: `wsServer.onBroadcast(data => containerLink.forwardEvent(data))`
4. `ContainerLinkClient.forwardEvent()` wraps the data in `{type:"event", payload:{data}}` and sends over the call-home WebSocket
5. Container's `InboundAgentManager` receives the `event` message and emits `agent-event`
6. Container relays to its browser WebSocket clients via `wsRelay.emit('message', ...)`
