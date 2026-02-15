---
commit: "008"
title: Create HttpTransport and wire WebSocket for real-time comment updates
status: pending
---

# 008 — Create HttpTransport and wire WebSocket for real-time comment updates

## Why

The review editor SPA running in a browser has no access to `vscode.postMessage`. It needs a concrete `EditorTransport` implementation that routes **commands** (addComment, deleteComment, etc.) through REST `fetch()` calls to the API from commit 007 and receives **server-push events** (update, commentChanged, scrollToComment) over a WebSocket connection. This commit also extends the CoC WebSocket server with review-editor-scoped events so multiple browser tabs editing different files receive only relevant updates.

## Dependencies

- **003** — `EditorTransport` interface definition (the abstract contract this commit implements)
- **007** — REST API routes (`/api/review/files/:path/comments`, etc.) that `HttpTransport.send()` delegates to
- CoC WebSocket server (`packages/coc/src/server/websocket.ts`) — already landed, provides `ProcessWebSocketServer`, `WSClient`, heartbeat, and broadcast infrastructure

## What changes

### Overview

Three layers of work:

1. **Server-side** — extend `ProcessWebSocketServer` and `ServerMessage`/`ClientMessage` types with review editor events; bridge `CommentsManager` change callbacks to WebSocket broadcasts scoped by file path
2. **Client-side WebSocket module** — new `packages/coc/src/server/spa/client/review-websocket.ts` following the existing `websocket.ts` pattern (connect, exponential backoff reconnect, ping/pong, message dispatch)
3. **`HttpTransport`** — new `EditorTransport` implementation that wires `send()` → REST and `onMessage()` → WebSocket listener

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/review-websocket.ts` — client-side WebSocket module for the review editor SPA
- `packages/coc/src/server/review-websocket-bridge.ts` — server-side bridge that connects CommentsManager events to WebSocket broadcasts

### Files to Modify

- `packages/coc/src/server/websocket.ts` — extend types and add file-scoped subscription support
- `packages/coc/src/server/index.ts` — wire the review-websocket-bridge into server startup
- `packages/coc/src/server/review-handler.ts` — emit change events after comment mutations

## Implementation Notes

### 1. Extend WebSocket types (`packages/coc/src/server/websocket.ts`)

#### New server → client message types

Add to the `ServerMessage` union:

```typescript
| { type: 'comment-added'; filePath: string; comment: MarkdownCommentSummary }
| { type: 'comment-updated'; filePath: string; comment: MarkdownCommentSummary }
| { type: 'comment-deleted'; filePath: string; commentId: string }
| { type: 'comment-resolved'; filePath: string; commentId: string }
| { type: 'comments-cleared'; filePath: string; count: number }
| { type: 'document-updated'; filePath: string; content: string; comments: MarkdownCommentSummary[] }
```

`MarkdownCommentSummary` is a lightweight projection (id, filePath, selection, selectedText, comment text, status, author, tags, timestamps) — same pattern as `ProcessSummary` which strips large fields.

#### New client → server message types

Add to the `ClientMessage` union:

```typescript
| { type: 'subscribe-file'; filePath: string }
| { type: 'unsubscribe-file'; filePath: string }
```

#### File-scoped subscription on `WSClient`

Add an optional `Set<string>` field to `WSClient`:

```typescript
export interface WSClient {
    // ...existing fields...
    subscribedFiles?: Set<string>;
}
```

#### Scoped broadcast helper

Add a `broadcastFileEvent(filePath: string, message: ServerMessage)` method to `ProcessWebSocketServer` that only sends to clients whose `subscribedFiles` includes the given path (or to all clients if no file subscription is set, preserving backward compat with process events):

```typescript
broadcastFileEvent(filePath: string, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
        if (!client.subscribedFiles || client.subscribedFiles.has(filePath)) {
            client.send(data);
        }
    }
}
```

#### Handle new client messages

Extend `handleClientMessage` to handle `subscribe-file` and `unsubscribe-file`:

```typescript
case 'subscribe-file':
    client.lastSeen = Date.now();
    if (!client.subscribedFiles) client.subscribedFiles = new Set();
    client.subscribedFiles.add(message.filePath);
    break;
case 'unsubscribe-file':
    client.lastSeen = Date.now();
    client.subscribedFiles?.delete(message.filePath);
    break;
```

### 2. Server-side bridge (`packages/coc/src/server/review-websocket-bridge.ts`)

A function `bridgeReviewToWebSocket(commentsManager, wsServer)` that:
- Listens to CommentsManager change events (the `onChange` callback or EventEmitter pattern from commit 002)
- On each change, calls `wsServer.broadcastFileEvent(filePath, { type: 'comment-added', ... })` etc.
- Maps CommentsManager events to the corresponding `ServerMessage` types

```typescript
export function bridgeReviewToWebSocket(
    commentsManager: CommentsManagerBase,
    wsServer: ProcessWebSocketServer
): void {
    commentsManager.onDidChangeComments((event) => {
        switch (event.type) {
            case 'added':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-added',
                    filePath: event.filePath,
                    comment: toCommentSummary(event.comment),
                });
                break;
            case 'updated':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-updated',
                    filePath: event.filePath,
                    comment: toCommentSummary(event.comment),
                });
                break;
            case 'deleted':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-deleted',
                    filePath: event.filePath,
                    commentId: event.commentId,
                });
                break;
            case 'resolved':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-resolved',
                    filePath: event.filePath,
                    commentId: event.commentId,
                });
                break;
            case 'cleared':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comments-cleared',
                    filePath: event.filePath,
                    count: event.count,
                });
                break;
        }
    });
}
```

Also export `toCommentSummary()` for converting full `MarkdownComment` to the lightweight wire format.

### 3. Wire bridge into server (`packages/coc/src/server/index.ts`)

After the existing `registerReviewRoutes(routes, projectDir)` call (from commit 007), add:

```typescript
import { bridgeReviewToWebSocket } from './review-websocket-bridge';
// ...
bridgeReviewToWebSocket(commentsManager, wsServer);
```

This requires `registerReviewRoutes` to return (or export) the `CommentsManager` instance it creates, so the bridge can subscribe to its events. Adjust the return type:

```typescript
const { commentsManager } = registerReviewRoutes(routes, projectDir);
bridgeReviewToWebSocket(commentsManager, wsServer);
```

### 4. Emit change events from review-handler (`packages/coc/src/server/review-handler.ts`)

The REST route handlers from commit 007 mutate comments via `CommentsManager`. After each mutation, the CommentsManager's internal event emitter fires, which the bridge (section 2) picks up. No manual WebSocket calls needed in route handlers — the bridge pattern keeps them decoupled.

If CommentsManager from commit 002 does not yet have an event emitter for mutations, add one:

```typescript
// In CommentsManager after addComment:
this.emit('change', { type: 'added', filePath, comment: newComment });
```

### 5. Client-side review WebSocket (`packages/coc/src/server/spa/client/review-websocket.ts`)

Follows the exact pattern of the existing `packages/coc/src/server/spa/client/websocket.ts`:

```typescript
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let pingInterval: ReturnType<typeof setInterval> | null = null;

type ReviewWsHandler = (msg: ReviewServerMessage) => void;
const handlers: ReviewWsHandler[] = [];

export function onReviewMessage(handler: ReviewWsHandler): () => void {
    handlers.push(handler);
    return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
    };
}

export function connectReviewWebSocket(filePath: string): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host + '/ws';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        reconnectDelay = 1000;
        // Subscribe to the specific file
        ws!.send(JSON.stringify({ type: 'subscribe-file', filePath }));
        // Start keepalive pings
        pingInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30_000);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            for (const h of handlers) h(msg);
        } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
            connectReviewWebSocket(filePath);
        }, reconnectDelay);
    };

    ws.onerror = () => {};
}

export function disconnectReviewWebSocket(): void {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (ws) { ws.close(); ws = null; }
}
```

Key differences from the process dashboard WebSocket:
- **File-scoped**: sends `subscribe-file` on connect instead of `subscribe` (workspace)
- **Handlers array**: instead of directly mutating app state, exposes `onReviewMessage()` for the `HttpTransport` to consume
- **Reconnect re-subscribes**: on reconnect, re-sends the `subscribe-file` message

### 6. HttpTransport (client-side `EditorTransport` implementation)

Location: alongside the review editor SPA client code or in a shared module. Implements the `EditorTransport` interface from commit 003.

```typescript
export class HttpTransport implements EditorTransport {
    private messageHandlers: Array<(msg: ExtensionMessage) => void> = [];
    private filePath: string;
    private apiBase: string;
    private unsubscribeWs: (() => void) | null = null;

    constructor(filePath: string, apiBase: string = '/api') {
        this.filePath = filePath;
        this.apiBase = apiBase;
    }

    // --- EditorTransport.send() → REST fetch ---
    async send(message: WebviewMessage): Promise<void> {
        const encodedPath = encodeURIComponent(this.filePath);
        switch (message.type) {
            case 'addComment':
                await this.post(`/review/files/${encodedPath}/comments`, {
                    selection: message.selection,
                    selectedText: message.selection?.selectedText,
                    comment: message.comment,
                    mermaidContext: message.mermaidContext,
                });
                break;
            case 'editComment':
                await this.patch(`/review/files/${encodedPath}/comments/${message.commentId}`, {
                    comment: message.comment,
                });
                break;
            case 'deleteComment':
                await this.delete(`/review/files/${encodedPath}/comments/${message.commentId}`);
                break;
            case 'resolveComment':
                await this.patch(`/review/files/${encodedPath}/comments/${message.commentId}`, {
                    status: 'resolved',
                });
                break;
            case 'reopenComment':
                await this.patch(`/review/files/${encodedPath}/comments/${message.commentId}`, {
                    status: 'open',
                });
                break;
            case 'resolveAll':
                await this.post(`/review/files/${encodedPath}/comments/resolve-all`, {});
                break;
            case 'deleteAll':
                await this.delete(`/review/files/${encodedPath}/comments`);
                break;
            case 'ready':
                // Fetch initial state via REST
                const data = await this.get(`/review/files/${encodedPath}`);
                this.dispatchToHandlers({
                    type: 'update',
                    content: data.content,
                    comments: data.comments,
                    filePath: this.filePath,
                });
                break;
            case 'resolveImagePath':
                // Resolve to server image URL
                this.dispatchToHandlers({
                    type: 'imageResolved',
                    imgId: message.imgId,
                    uri: `${this.apiBase}/review/images/${encodeURIComponent(message.path)}`,
                });
                break;
            default:
                // AI-related messages, prompt files, etc. — no-op in browser or
                // delegate to future AI REST endpoints
                console.debug('[HttpTransport] Unhandled message type:', message.type);
                break;
        }
    }

    // --- EditorTransport.onMessage() → WebSocket listener ---
    onMessage(handler: (msg: ExtensionMessage) => void): void {
        this.messageHandlers.push(handler);
    }

    // --- Connection lifecycle ---
    connect(): void {
        this.unsubscribeWs = onReviewMessage((msg) => {
            const extensionMsg = this.mapServerToExtension(msg);
            if (extensionMsg) {
                this.dispatchToHandlers(extensionMsg);
            }
        });
        connectReviewWebSocket(this.filePath);
    }

    disconnect(): void {
        if (this.unsubscribeWs) { this.unsubscribeWs(); this.unsubscribeWs = null; }
        disconnectReviewWebSocket();
        this.messageHandlers = [];
    }

    // --- Private helpers ---

    private dispatchToHandlers(msg: ExtensionMessage): void {
        for (const h of this.messageHandlers) h(msg);
    }

    /** Map server WebSocket events to ExtensionMessage format the webview understands. */
    private mapServerToExtension(msg: any): ExtensionMessage | null {
        switch (msg.type) {
            case 'comment-added':
            case 'comment-updated':
            case 'comment-deleted':
            case 'comment-resolved':
            case 'comments-cleared':
            case 'document-updated':
                // Re-fetch full state to keep webview in sync
                // (simpler than incremental patching for initial implementation)
                this.refetchState();
                return null; // update dispatched async from refetchState
            default:
                return null;
        }
    }

    /** Fetch current file+comments and dispatch an 'update' message. */
    private async refetchState(): Promise<void> {
        try {
            const data = await this.get(`/review/files/${encodeURIComponent(this.filePath)}`);
            this.dispatchToHandlers({
                type: 'update',
                content: data.content,
                comments: data.comments,
                filePath: this.filePath,
            });
        } catch (err) {
            console.error('[HttpTransport] Failed to refetch state:', err);
        }
    }

    private async get(path: string): Promise<any> {
        const res = await fetch(`${this.apiBase}${path}`);
        if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
        return res.json();
    }

    private async post(path: string, body: any): Promise<any> {
        const res = await fetch(`${this.apiBase}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
        return res.json();
    }

    private async patch(path: string, body: any): Promise<any> {
        const res = await fetch(`${this.apiBase}${path}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
        return res.json();
    }

    private async delete(path: string): Promise<any> {
        const res = await fetch(`${this.apiBase}${path}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
        return res.json();
    }
}
```

**Design decisions:**

- **Refetch-on-change strategy**: When a WebSocket event arrives (comment-added, etc.), the transport refetches the full file+comments state from REST rather than doing incremental patching. This is simpler, avoids state divergence bugs, and mirrors how the VS Code extension sends a full `update` message after any mutation. Can be optimized to incremental updates later.
- **`ready` message**: Triggers initial REST fetch instead of waiting for extension push. The webview code that sends `{ type: 'ready' }` on startup works unchanged.
- **Image resolution**: Maps `resolveImagePath` to the server's `/api/review/images/` endpoint URL instead of VS Code's `asWebviewUri()`.
- **Unhandled messages**: AI-related messages (askAI, sendToChat, executeWorkPlan, etc.) are logged but not implemented in this commit. They require the AI service integration planned for later commits.

### 7. Message type mapping (server → client)

| Server WebSocket Event | Client Action | ExtensionMessage |
|------------------------|---------------|------------------|
| `comment-added` | Refetch state | `{ type: 'update', ... }` |
| `comment-updated` | Refetch state | `{ type: 'update', ... }` |
| `comment-deleted` | Refetch state | `{ type: 'update', ... }` |
| `comment-resolved` | Refetch state | `{ type: 'update', ... }` |
| `comments-cleared` | Refetch state | `{ type: 'update', ... }` |
| `document-updated` | Refetch state | `{ type: 'update', ... }` |

### 8. Multi-tab / multi-file support

- Each browser tab creates its own `HttpTransport` instance with a specific `filePath`
- Each tab's WebSocket connection subscribes to only that file via `subscribe-file`
- A client can subscribe to multiple files (the `subscribedFiles` set supports it) for future split-view scenarios
- The server broadcasts only to subscribed clients, keeping traffic minimal

## Files touched

| File | Action |
|------|--------|
| `packages/coc/src/server/websocket.ts` | **Edit** — add `subscribedFiles` to `WSClient`, new message types to `ServerMessage`/`ClientMessage`, `broadcastFileEvent` method, handle `subscribe-file`/`unsubscribe-file` |
| `packages/coc/src/server/review-websocket-bridge.ts` | **Create** — `bridgeReviewToWebSocket()` + `toCommentSummary()` |
| `packages/coc/src/server/spa/client/review-websocket.ts` | **Create** — client-side review WebSocket (connect, reconnect, subscribe, dispatch) |
| `packages/coc/src/server/index.ts` | **Edit** — import and wire `bridgeReviewToWebSocket`, adjust `registerReviewRoutes` call to get `commentsManager` reference |
| `packages/coc/src/server/review-handler.ts` | **Edit** — return `commentsManager` from `registerReviewRoutes` so bridge can subscribe |

## Estimated size

- `websocket.ts` edits: ~40 lines added (types, method, handler cases)
- `review-websocket-bridge.ts`: ~80 lines
- `review-websocket.ts` (client): ~70 lines
- `index.ts` edits: ~5 lines
- `review-handler.ts` edits: ~5 lines (return commentsManager)
- **Total: ~200 lines new/modified**

## Tests

- **`packages/coc/test/review-websocket-bridge.test.ts`** — Unit test the bridge: mock CommentsManager events → verify correct `broadcastFileEvent` calls with correct message types and file paths
- **`packages/coc/test/websocket-file-subscribe.test.ts`** — Test file-scoped subscriptions: create two mock clients subscribing to different files, broadcast a `comment-added` for file A, verify only client A receives it
- **`packages/coc/test/review-websocket-client.test.ts`** — Test client-side module: mock WebSocket, verify `subscribe-file` sent on connect, verify handler dispatch, verify reconnect re-subscribes
- **Extend existing `packages/coc/test/commands/serve.test.ts`** — Add integration smoke test: start server, connect WebSocket, subscribe to a file, trigger a comment add via REST, verify WebSocket message received

## Acceptance Criteria

- [ ] `WSClient` supports file-scoped subscriptions (`subscribedFiles` set)
- [ ] `subscribe-file` / `unsubscribe-file` client messages are handled by the server
- [ ] `broadcastFileEvent` only sends to clients subscribed to the target file
- [ ] CommentsManager mutations in REST handlers trigger WebSocket broadcasts via the bridge
- [ ] Client-side review WebSocket connects, subscribes, receives events, and reconnects with exponential backoff
- [ ] `HttpTransport` implements `EditorTransport`: `send()` routes to REST, `onMessage()` receives from WebSocket
- [ ] `HttpTransport.send({ type: 'ready' })` fetches initial state via REST and dispatches `update` message
- [ ] `HttpTransport.send({ type: 'resolveImagePath', ... })` resolves to server image URL
- [ ] Multi-tab scenario: two tabs editing different files receive only their own file's events
- [ ] All new and existing tests pass (`npm run test:run` in `packages/coc/`)
- [ ] No `vscode` imports in any new file (pure Node.js / browser code only)
