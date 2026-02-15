---
status: pending
---

# 005: Extend CoC WebSocket for Wiki Events

## Summary
Add wiki-specific message types (`wiki-reload`, `wiki-rebuilding`, `wiki-error`) to CoC's `ProcessWebSocketServer` and hook WikiManager's FileWatcher events to broadcast via WebSocket.

## Motivation
Deep-wiki's live-reload uses WebSocket to notify the SPA client when repository files change. Rather than running a separate WebSocket server, we extend CoC's existing `ProcessWebSocketServer` with new message types — keeping a single `/ws` endpoint. This avoids port conflicts and lets the SPA dashboard consume both process events and wiki events on one connection.

## Current State Analysis

### CoC `ProcessWebSocketServer` (`packages/coc/src/server/websocket.ts`)
- **Client model:** `WSClient` with `id`, `socket`, `send()`, `close()`, `workspaceId?`, `lastSeen`
- **Server → Client messages** (`ServerMessage` union):
  - `welcome`, `pong` (connection lifecycle)
  - `process-added`, `process-updated`, `process-removed`, `processes-cleared` (process lifecycle)
  - `queue-updated` (queue state snapshot)
  - `tasks-changed` (file-watcher for task dirs)
- **Client → Server messages** (`ClientMessage` union):
  - `ping` — heartbeat, server replies `pong`
  - `subscribe` — sets `client.workspaceId` for workspace-scoped filtering
- **Broadcast:** `broadcastProcessEvent(message: ServerMessage)` — applies workspace filtering via `getMessageWorkspaceId()`
- **Heartbeat:** 60s interval, 90s timeout, prunes dead clients
- **Frame helpers:** `sendFrame()`, `decodeFrame()` exported for testing

### Deep-wiki `WebSocketServer` (`packages/deep-wiki/src/server/websocket.ts`)
- **Simpler client model:** `WSClient` with `socket`, `send()`, `close()` — no `id`, no `workspaceId`, no `lastSeen`
- **Server → Client messages** (3 types, sent as `WSMessage`):
  - `{ type: "reload", components: string[] }` — files rebuilt, SPA should re-fetch
  - `{ type: "rebuilding", components: string[] }` — rebuild in progress, SPA shows spinner
  - `{ type: "error", message: string }` — rebuild or watcher error
- **Client → Server messages:**
  - `{ type: "ping" }` — handled via `onMessage()` callback, server replies `pong`
- **Broadcast:** `broadcast(message: WSMessage)` — sends to ALL clients, no filtering
- **No heartbeat:** no dead-connection pruning (relies on browser reconnect)

### Deep-wiki FileWatcher → WebSocket wiring (`packages/deep-wiki/src/server/index.ts`, lines 153-198)
The `createServer()` function wires them together:
1. Creates `WebSocketServer`, calls `attach(server)`, registers `onMessage` for ping/pong
2. Creates `FileWatcher` with callbacks:
   - **`onChange(affectedComponentIds)`**:
     - Broadcasts `{ type: 'rebuilding', components }` immediately
     - Calls `wikiData.reload()` to refresh in-memory data
     - Broadcasts `{ type: 'reload', components }` on success
     - Broadcasts `{ type: 'error', message }` on failure
   - **`onError(err)`**: Broadcasts `{ type: 'error', message: err.message }`
3. Calls `fileWatcher.start()` to begin watching
4. On server close: `fileWatcher.stop()`, `wsServer.closeAll()`

## Changes

### Files to Create
- (none)

### Files to Modify

#### `packages/coc/src/server/websocket.ts`
1. **Extend `ServerMessage` union** with three new variants:
   ```typescript
   | { type: 'wiki-reload'; wikiId: string; components: string[] }
   | { type: 'wiki-rebuilding'; wikiId: string; components: string[] }
   | { type: 'wiki-error'; wikiId: string; message: string }
   ```
   The `wikiId` field scopes events to a specific wiki instance (a WikiManager manages one wiki identified by its directory path). This mirrors how `workspaceId` scopes process events.

2. **Extend `ClientMessage` union** with wiki subscription:
   ```typescript
   | { type: 'subscribe-wiki'; wikiId: string }
   ```
   This lets clients opt into events for a specific wiki. Stored on `WSClient` as `subscribedWikiIds: Set<string>`.

3. **Add `wikiIds` field to `WSClient`**:
   ```typescript
   export interface WSClient {
       // ...existing fields...
       subscribedWikiIds?: Set<string>;
   }
   ```

4. **Add `broadcastWikiEvent(message)` method** to `ProcessWebSocketServer`:
   ```typescript
   broadcastWikiEvent(message: ServerMessage): void {
       const data = JSON.stringify(message);
       const wikiId = 'wikiId' in message ? (message as any).wikiId : undefined;
       for (const client of this.clients) {
           // If client has wiki subscriptions, only send matching wiki events
           if (client.subscribedWikiIds && client.subscribedWikiIds.size > 0) {
               if (wikiId && client.subscribedWikiIds.has(wikiId)) {
                   client.send(data);
               }
               continue;
           }
           // Clients with no wiki subscription get all wiki events (backward compat)
           client.send(data);
       }
   }
   ```

5. **Handle `subscribe-wiki` in `handleClientMessage()`**:
   ```typescript
   case 'subscribe-wiki':
       client.lastSeen = Date.now();
       if (!client.subscribedWikiIds) {
           client.subscribedWikiIds = new Set();
       }
       client.subscribedWikiIds.add(message.wikiId);
       break;
   ```

6. **Update `getMessageWorkspaceId()`** to return `undefined` for wiki events (wiki events use their own filtering path, not workspace filtering).

#### `packages/coc/src/server/wiki/wiki-manager.ts`
1. **Accept WebSocket server reference** in WikiManager constructor options or via a setter.
2. **Wire FileWatcher callbacks to WebSocket** following the deep-wiki pattern:
   ```typescript
   // In the method that starts the file watcher:
   this.fileWatcher = new FileWatcher({
       repoPath: this.repoPath,
       wikiDir: this.wikiDir,
       componentGraph: this.wikiData.graph,
       debounceMs: this.options.watchDebounceMs,
       onChange: (affectedComponentIds) => {
           this.wsServer?.broadcastWikiEvent({
               type: 'wiki-rebuilding',
               wikiId: this.id,
               components: affectedComponentIds,
           });
           try {
               this.wikiData.reload();
               this.wsServer?.broadcastWikiEvent({
                   type: 'wiki-reload',
                   wikiId: this.id,
                   components: affectedComponentIds,
               });
           } catch (err) {
               const msg = err instanceof Error ? err.message : 'Unknown error';
               this.wsServer?.broadcastWikiEvent({
                   type: 'wiki-error',
                   wikiId: this.id,
                   message: msg,
               });
           }
       },
       onError: (err) => {
           this.wsServer?.broadcastWikiEvent({
               type: 'wiki-error',
               wikiId: this.id,
               message: err.message,
           });
       },
   });
   ```

#### `packages/coc/src/server/index.ts`
1. **Pass `wsServer` to WikiManager** when creating wiki instances so WikiManager can call `broadcastWikiEvent()`.
2. This wiring happens wherever WikiManager is instantiated (likely in response to a wiki serve request or route registration).

### Files to Delete
- (none — deep-wiki's `websocket.ts` deleted in cleanup commit)

## Implementation Notes

### Message Type Naming Convention
Deep-wiki uses bare names (`reload`, `rebuilding`, `error`). CoC prefixes with `wiki-` to avoid collision with existing process/queue event types. This is important because both event domains share the same `/ws` endpoint.

### Broadcast Separation
- `broadcastProcessEvent()` — unchanged, handles process/queue/task events with workspace-scoped filtering
- `broadcastWikiEvent()` — new, handles wiki events with wiki-scoped filtering via `subscribedWikiIds`
- Both methods iterate `this.clients` but apply different filtering logic. A client can subscribe to both a `workspaceId` and one or more `wikiId`s simultaneously.

### Wiki ID Design
The `wikiId` is a string identifier for a wiki instance, typically derived from the wiki directory path (e.g., hashed or slugified). This mirrors how `workspaceId` is a SHA-256 hash of the workspace root. WikiManager generates and owns this ID.

### Backward Compatibility
- Existing `ServerMessage` variants are untouched — `process-added`, `process-updated`, etc. continue to work identically
- Existing `ClientMessage` types (`ping`, `subscribe`) are untouched
- Clients that don't send `subscribe-wiki` receive all wiki events (opt-out model, same as workspace filtering where unsubscribed clients get everything)
- The `broadcastProcessEvent()` method is not modified; wiki events go through the separate `broadcastWikiEvent()` method

### Deep-wiki Ping/Pong
Deep-wiki's `onMessage` handler for `ping` → `pong` is already covered by CoC's `handleClientMessage` which handles `ping` natively. No additional work needed.

## Tests

### New Tests (in `packages/coc/test/websocket.test.ts` or new file)
- **Wiki event broadcast:** Connect a client, call `broadcastWikiEvent({ type: 'wiki-reload', wikiId: 'w1', components: ['a'] })`, verify client receives the message
- **Wiki subscription filtering:** Connect two clients, subscribe client A to `wikiId: 'w1'`, subscribe client B to `wikiId: 'w2'`. Broadcast a `wiki-reload` for `w1` — only client A receives it
- **Unsubscribed clients receive all:** Connect a client without `subscribe-wiki`, broadcast `wiki-reload` — client receives it
- **Existing events unchanged:** Verify `process-added`, `queue-updated`, `tasks-changed` still broadcast correctly after changes
- **Wiki message format:** Verify serialized JSON matches `{ type: 'wiki-reload', wikiId: string, components: string[] }` schema
- **subscribe-wiki client message:** Send `{ type: 'subscribe-wiki', wikiId: 'w1' }` from client, verify `client.subscribedWikiIds` contains `'w1'`
- **Multiple wiki subscriptions:** Client subscribes to `w1` then `w2`, receives events for both

### Existing Tests (should still pass)
- All existing WebSocket tests in `packages/coc/test/websocket.test.ts`
- All integration tests that use the WebSocket connection

## Acceptance Criteria
- [x] Wiki events broadcast via existing `/ws` endpoint
- [x] New message types: `wiki-reload`, `wiki-rebuilding`, `wiki-error`
- [x] New client message type: `subscribe-wiki`
- [x] `WSClient` extended with `subscribedWikiIds` field
- [x] `broadcastWikiEvent()` method applies wiki-scoped filtering
- [x] Existing process/queue/task WebSocket messages unchanged
- [x] `broadcastProcessEvent()` not modified
- [x] FileWatcher events in WikiManager trigger WebSocket broadcasts
- [x] CoC build succeeds (`npm run build` in `packages/coc/`)
- [x] All existing CoC tests pass
- [x] New wiki WebSocket tests pass

## Dependencies
- Depends on: 003 (WikiManager with FileWatcher)
