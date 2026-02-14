---
status: pending
---

# 005: Add WebSocket handler for real-time process updates

## Summary
Add a raw WebSocket server that broadcasts process lifecycle events to connected dashboard clients, enabling real-time UI updates without polling.

## Motivation
The dashboard (commit 006+) needs to reflect process state changes instantly — when a process is added, progresses, completes, fails, or is cancelled. Polling the REST API would introduce latency and unnecessary load. A WebSocket channel lets the server push events the moment they occur.

The deep-wiki package already proves the pattern: `packages/deep-wiki/src/server/websocket.ts` implements a complete WebSocket server in ~80 lines using only Node.js built-ins (`crypto`, `net`, `http`). We replicate the same approach — zero npm dependencies, manual RFC 6455 handshake, text frame encoding/decoding — and extend it with process-specific event broadcasting and optional workspace-scoped subscriptions.

## Changes

### Files to Create
- `packages/pipeline-cli/src/server/websocket.ts` — WebSocket server with process event broadcasting
- `packages/pipeline-cli/test/server/websocket.test.ts` — Comprehensive WebSocket tests

### Files to Modify
- `packages/pipeline-cli/src/server/index.ts` — Wire WebSocket server to HTTP server's `upgrade` event; clean shutdown

## Implementation Notes

### WebSocket Server (`websocket.ts`)

Follow the deep-wiki pattern (`packages/deep-wiki/src/server/websocket.ts`) closely — same handshake, same frame codec, same client lifecycle. Key differences from deep-wiki:

**Types:**

```typescript
export interface WSClient {
    socket: Socket;
    id: string;                    // Unique client ID (crypto.randomUUID)
    send: (data: string) => void;
    close: () => void;
    workspaceId?: string;          // Set via subscribe message
    lastSeen: number;              // Timestamp for heartbeat timeout
}

/** Server → Client message types */
export type ServerMessage =
    | { type: 'welcome'; clientId: string; timestamp: number }
    | { type: 'pong' }
    | { type: 'process-added'; process: ProcessSummary }
    | { type: 'process-updated'; process: ProcessSummary }
    | { type: 'process-removed'; processId: string }
    | { type: 'processes-cleared'; count: number };

/** Client → Server message types */
export type ClientMessage =
    | { type: 'ping' }
    | { type: 'subscribe'; workspaceId: string };
```

**Class: `ProcessWebSocketServer`**

Extends the deep-wiki `WebSocketServer` pattern with:

1. **Welcome on connect** — After handshake, immediately send `{ type: "welcome", clientId, timestamp }`. The timestamp lets clients detect missed events on reconnect.

2. **Heartbeat** — Client sends `{ type: "ping" }` every 30s, server responds with `{ type: "pong" }`. Server tracks `lastSeen` per client; a `setInterval` (every 60s) prunes clients whose `lastSeen` is older than 90s. This catches zombie connections (e.g., browser tab closed without clean close frame).

3. **Workspace subscription** — Client sends `{ type: "subscribe", workspaceId: "..." }`. Server stores `workspaceId` on the `WSClient`. When broadcasting process events, if the process has a `workspaceId` field, only send to clients subscribed to that workspace (or to clients with no subscription, which receive everything).

4. **Process event broadcasting** — `broadcastProcessEvent(message: ServerMessage)` iterates all clients, applies workspace filter, and calls `client.send()`. This is the method the server factory calls from the ProcessStore callback.

**Frame encoding/decoding** — Copy `sendFrame()` and `decodeFrame()` verbatim from deep-wiki's `websocket.ts`. These are pure functions implementing RFC 6455 text frame format:
- `sendFrame(socket, data)`: FIN bit + opcode 0x1, payload length encoding (7-bit / 16-bit / 64-bit)
- `decodeFrame(buf)`: Handles masked client frames, returns decoded text or null for non-text opcodes

**Handshake** — Same as deep-wiki: listen for HTTP `upgrade` on path `/ws`, validate `Sec-WebSocket-Key`, respond with SHA-1 accept key. Reject upgrades to other paths with `socket.destroy()`.

### Integration with Server Factory (`index.ts`)

In the server factory function (from commit 003):

```typescript
// Create WebSocket server
const wsServer = new ProcessWebSocketServer();
wsServer.attach(httpServer);

// Bridge ProcessStore events → WebSocket broadcasts
processStore.onProcessChange((event) => {
    switch (event.type) {
        case 'added':
            wsServer.broadcastProcessEvent({
                type: 'process-added',
                process: toProcessSummary(event.process)
            });
            break;
        case 'updated':
            wsServer.broadcastProcessEvent({
                type: 'process-updated',
                process: toProcessSummary(event.process)
            });
            break;
        case 'removed':
            wsServer.broadcastProcessEvent({
                type: 'process-removed',
                processId: event.processId
            });
            break;
        case 'cleared':
            wsServer.broadcastProcessEvent({
                type: 'processes-cleared',
                count: event.count
            });
            break;
    }
});
```

`toProcessSummary()` strips large fields (full output text) to keep WebSocket messages small — clients fetch full details via REST if needed.

**Shutdown:** On `server.close()`, call `wsServer.closeAll()` to terminate all connections and clear the heartbeat interval.

### Design Decisions

- **No `ws` or `socket.io` dependency** — The raw implementation is ~100 lines and avoids adding npm deps to the CLI. Proven in deep-wiki production use.
- **Workspace filtering is optional** — Clients that never send `subscribe` receive all events. This keeps the simple case simple (single-workspace) while supporting multi-workspace dashboards.
- **ProcessSummary, not full process** — WebSocket messages carry a lightweight summary (id, name, status, progress, timestamps). Full process data (output log, parameters) is available via `GET /api/processes/:id`.
- **No message buffering** — If a client disconnects and reconnects, it gets a `welcome` with current timestamp. The client should call `GET /api/processes` to resync state. This avoids server-side message queuing complexity.

## Tests

### Handshake
- **WebSocket handshake succeeds** — Connect to `/ws`, verify 101 response with correct `Sec-WebSocket-Accept` header
- **Rejects non-WebSocket upgrades** — Upgrade request to `/other` → socket destroyed
- **Rejects missing key** — Upgrade without `Sec-WebSocket-Key` → socket destroyed

### Welcome Message
- **Welcome sent on connect** — After handshake, first message is `{ type: "welcome", clientId, timestamp }`
- **Client ID is unique** — Two connections receive different `clientId` values

### Process Event Broadcasting
- **Process-added broadcast** — Add a process to store → connected client receives `{ type: "process-added", process: {...} }`
- **Process-updated broadcast** — Update process status → client receives `{ type: "process-updated", process: {...} }`
- **Process-removed broadcast** — Remove process → client receives `{ type: "process-removed", processId: "..." }`
- **Processes-cleared broadcast** — Clear all → client receives `{ type: "processes-cleared", count: N }`
- **Multiple clients receive broadcasts** — Connect 3 clients, trigger event → all 3 receive it

### Workspace Subscription Filtering
- **Unsubscribed client receives all events** — Client sends no `subscribe` → receives events from any workspace
- **Subscribed client receives only matching events** — Client subscribes to workspace "A" → receives "A" events, not "B" events
- **Mixed clients** — One subscribed to "A", one unsubscribed → both receive "A" events, only unsubscribed receives "B" events

### Heartbeat and Timeout
- **Ping/pong** — Client sends `{ type: "ping" }` → server responds `{ type: "pong" }`
- **Dead connection cleanup** — Simulate client that stops sending pings → after timeout interval, client is removed from set
- **Active connection preserved** — Client that pings regularly is not pruned

### Shutdown
- **closeAll terminates connections** — Call `closeAll()` → all client sockets end, `clientCount` is 0
- **Heartbeat interval cleared** — After `closeAll()`, no further timeout checks run (no leaked intervals)

### Frame Codec (unit-level)
- **Small payload** — Encode/decode string < 126 bytes
- **Medium payload** — Encode/decode string 126–65535 bytes
- **Masked client frame** — Decode frame with mask bit set (browsers always mask)

## Acceptance Criteria
- [ ] `ProcessWebSocketServer` class handles upgrade, handshake, and client lifecycle
- [ ] `sendFrame` / `decodeFrame` correctly encode/decode RFC 6455 text frames
- [ ] Welcome message sent immediately after successful handshake
- [ ] Process store events are broadcast to all connected clients
- [ ] Workspace subscription filtering works correctly
- [ ] Heartbeat mechanism detects and removes dead connections
- [ ] `closeAll()` cleanly shuts down all connections and clears intervals
- [ ] Server factory wires WebSocket to HTTP server and ProcessStore
- [ ] All tests pass with `npm run test:run` in `packages/pipeline-cli/`
- [ ] No new npm dependencies added

## Dependencies
- Depends on: 002 (ProcessStore with `onProcessChange` callback), 003 (HTTP server factory)
- References: `packages/deep-wiki/src/server/websocket.ts` (implementation pattern)
