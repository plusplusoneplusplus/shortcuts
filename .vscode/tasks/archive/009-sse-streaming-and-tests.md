---
status: pending
---

# 009: SSE Streaming and Integration Tests

## Summary
Add Server-Sent Events (SSE) streaming for real-time process output and comprehensive integration tests covering the full server lifecycle, WebSocket broadcasts, multi-workspace isolation, and the extension client.

## Motivation
SSE streaming enables clients to follow running process output in real time without polling — each output chunk is pushed as it arrives, and a final status event closes the stream. Integration tests are essential to validate that all prior commits (001–008) compose correctly under real HTTP traffic, concurrent access, and failure conditions.

## Changes

### Files to Create

- `packages/pipeline-cli/src/server/sse-handler.ts` — SSE endpoint handler for `GET /api/processes/:id/stream`
- `packages/pipeline-cli/test/server/integration.test.ts` — Server integration tests (Vitest)

### Files to Modify

- `src/test/suite/server-client.test.ts` — Extend with integration-level tests (file created in commit 008)

- `packages/pipeline-core/src/process-store.ts` — Add `onProcessOutput(id, callback)` to the `ProcessStore` interface; implement in `FileProcessStore` via in-memory EventEmitter
- `packages/pipeline-cli/src/server/router.ts` — Wire `GET /api/processes/:id/stream` to SSE handler
- `packages/pipeline-core/test/file-process-store.test.ts` — Expand with concurrent write safety, large dataset (500 processes), and retention pruning tests

## Implementation Notes

### Part A: SSE Streaming

#### SSE Handler (`sse-handler.ts`)

```typescript
import { IncomingMessage, ServerResponse } from 'node:http';
import { ProcessStore } from 'pipeline-core';

export function handleProcessStream(
    req: IncomingMessage,
    res: ServerResponse,
    processId: string,
    store: ProcessStore
): void {
    // 1. Look up the process — 404 if not found
    const process = store.get(processId);
    if (!process) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Process not found' }));
        return;
    }

    // 2. Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',   // disable nginx buffering
    });
    res.flushHeaders();

    // 3. If already completed/failed/cancelled, send final status + close
    if (process.status !== 'running' && process.status !== 'queued') {
        sendEvent(res, 'status', {
            status: process.status,
            result: process.result,
            error: process.error,
        });
        sendEvent(res, 'done', { processId });
        res.end();
        return;
    }

    // 4. Subscribe to output chunks via store.onProcessOutput
    const unsubscribe = store.onProcessOutput(processId, (event) => {
        if (event.type === 'chunk') {
            sendEvent(res, 'chunk', { content: event.content });
        } else if (event.type === 'complete') {
            sendEvent(res, 'status', {
                status: event.status,
                duration: event.duration,
            });
            sendEvent(res, 'done', { processId });
            res.end();
            cleanup();
        }
    });

    // 5. Heartbeat to detect stale connections (every 15s)
    const heartbeat = setInterval(() => {
        sendEvent(res, 'heartbeat', {});
    }, 15_000);

    // 6. Cleanup on client disconnect
    const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
    };
    req.on('close', cleanup);
}

function sendEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```

**SSE Event Protocol:**
```
event: chunk
data: {"content": "partial output text"}

event: status
data: {"status": "completed", "duration": "2m 34s"}

event: done
data: {"processId": "abc-123"}

event: heartbeat
data: {}
```

#### ProcessStore Streaming Support

Add to the `ProcessStore` interface in `process-store.ts`:

```typescript
/** Output event emitted during process execution */
interface ProcessOutputEvent {
    type: 'chunk' | 'complete';
    content?: string;        // for 'chunk' events
    status?: AIProcessStatus; // for 'complete' events
    duration?: string;        // for 'complete' events
}

/** Subscribe to output events for a running process. Returns unsubscribe function. */
onProcessOutput(id: string, callback: (event: ProcessOutputEvent) => void): () => void;

/** Emit an output chunk for a running process (called by execution engine). */
emitProcessOutput(id: string, content: string): void;

/** Emit process completion (called by execution engine). */
emitProcessComplete(id: string, status: AIProcessStatus, duration: string): void;
```

`FileProcessStore` implementation:
- Use an in-memory `Map<string, EventEmitter>` keyed by process ID
- `emitProcessOutput` / `emitProcessComplete` fire events on the relevant emitter
- `onProcessOutput` attaches a listener and returns an unsubscribe function that calls `removeListener`
- Emitters are created lazily on first subscribe or emit, and removed on `complete` event after notifying all listeners
- These events are **not** persisted to disk — they are transient in-memory streams

#### Router Wiring

In `router.ts`, add route matching for the SSE endpoint:

```typescript
// Inside the route dispatcher:
// Match: GET /api/processes/:id/stream
if (method === 'GET' && segments[0] === 'api' && segments[1] === 'processes'
    && segments[3] === 'stream' && segments.length === 4) {
    return handleProcessStream(req, res, segments[2], store);
}
```

Place this **before** the generic `GET /api/processes/:id` route to avoid ambiguity.

### Part B: Integration Tests

#### Server Integration Tests (`integration.test.ts`)

Use Vitest. Start a real HTTP server on port 0 (random), run tests against it, shut down in `afterAll`.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';  // devDependency if not already present

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
    // Start server on random port
    server = createServer({ store, port: 0 });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});
```

**Test Groups:**

1. **Full Lifecycle** (`describe('full lifecycle')`)
   - Register workspace → `POST /api/workspaces` → 201
   - Create process → `POST /api/processes` → 201 with ID
   - Get process → `GET /api/processes/:id` → 200 with correct data
   - Update process → `PATCH /api/processes/:id` → 200
   - List processes → `GET /api/processes?workspace=...` → 200 with array
   - Delete process → `DELETE /api/processes/:id` → 204
   - Get deleted → `GET /api/processes/:id` → 404

2. **WebSocket Broadcasts** (`describe('websocket')`)
   - Connect to `ws://127.0.0.1:${port}/ws`
   - Create process via REST, receive `process-added` event via WS
   - Update process, receive `process-updated` event
   - Verify event shape: `{ type, process, timestamp }`

3. **SSE Streaming** (`describe('sse streaming')`)
   - Create a running process
   - Connect to `GET /api/processes/:id/stream`
   - Emit output chunks via store, verify `event: chunk` received
   - Emit completion, verify `event: status` and `event: done` received
   - Verify stream closes after `done`
   - Already-completed process: immediate `status` + `done` + close
   - Non-existent process: 404

4. **Multi-Workspace Isolation** (`describe('multi-workspace')`)
   - Register workspace A and workspace B
   - Create processes in both
   - `GET /api/processes?workspace=A` → only A's processes
   - `GET /api/processes?workspace=B` → only B's processes
   - `GET /api/processes` (no filter) → all processes

5. **Concurrent Requests** (`describe('concurrent')`)
   - Fire 10 simultaneous `POST /api/processes` requests via `Promise.all`
   - All 10 return 201 with unique IDs
   - `GET /api/processes` → list contains all 10

6. **Error Handling** (`describe('error handling')`)
   - `POST /api/processes` with missing required fields → 400
   - `GET /api/processes/nonexistent` → 404
   - `PATCH /api/processes/nonexistent` → 404
   - `DELETE /api/processes/nonexistent` → 404
   - Invalid JSON body → 400
   - Unsupported HTTP method on known route → 405

#### FileProcessStore Expanded Tests (`file-process-store.test.ts`)

Expand the existing test file (if it exists from commit 002) with:

1. **Concurrent Write Safety**
   - Fire 20 parallel `store.add()` calls via `Promise.all`
   - Verify all 20 persisted correctly (no data loss or corruption)
   - Fire 10 parallel `store.update()` on overlapping IDs
   - Verify final state is consistent

2. **Large Dataset Performance**
   - Insert 500 processes sequentially
   - `store.list()` returns all 500 within reasonable time (<500ms)
   - `store.list({ workspace: 'X' })` filters correctly
   - `store.get(id)` for the 500th item is fast (<10ms)

3. **Retention Pruning**
   - Insert 150 processes with old timestamps
   - Call `store.prune({ maxAge: '7d', maxCount: 100 })`
   - Verify count ≤ 100
   - Verify all remaining processes are within age window

4. **onProcessOutput / emitProcessOutput**
   - Subscribe, emit 3 chunks, verify callback received all 3 in order
   - Emit complete, verify callback receives complete event
   - After complete, emitter is cleaned up (no memory leak)
   - Unsubscribe before complete, verify no further callbacks

#### Extension Client Tests (`server-client.test.ts`)

Use Mocha (matching existing extension test patterns). Mock HTTP using a fake server or stub `http.request`.

1. **Submit Flow**
   - Client submits process → sends `POST /api/processes` with correct body
   - Verify request includes workspace identity header
   - On 201 response, client resolves with server-assigned ID

2. **Update Flow**
   - Client updates process status → sends `PATCH /api/processes/:id`
   - Verify body contains only changed fields
   - On 200 response, client resolves successfully

3. **Remove Flow**
   - Client removes process → sends `DELETE /api/processes/:id`
   - On 204, client resolves
   - On 404, client resolves without error (idempotent)

4. **Offline Queue**
   - Client in offline mode: submit 3 processes → queued locally
   - Verify no HTTP requests made while offline
   - Bring client online → `flush()` → all 3 sent as POST requests
   - Verify queue is empty after flush

5. **Workspace Identity**
   - Client generates deterministic workspace ID from workspace folder path
   - Same path → same ID across restarts
   - Different paths → different IDs

## Tests

All tests listed in Part B above. Summary:

| Test File | Framework | Test Count (approx.) |
|-----------|-----------|---------------------|
| `packages/pipeline-cli/test/server/integration.test.ts` | Vitest | ~20 |
| `packages/pipeline-core/test/file-process-store.test.ts` | Vitest | ~12 (new) |
| `src/test/suite/server-client.test.ts` | Mocha | ~10 |

**Run commands:**
- `cd packages/pipeline-cli && npx vitest run test/server/integration.test.ts`
- `cd packages/pipeline-core && npx vitest run test/file-process-store.test.ts`
- `npm test` (for extension Mocha tests including server-client)

## Acceptance Criteria
- [ ] `GET /api/processes/:id/stream` returns SSE stream with correct `Content-Type: text/event-stream`
- [ ] Running process: chunks arrive as `event: chunk` with `data: {"content": "..."}`
- [ ] Process completion emits `event: status` followed by `event: done`, then stream closes
- [ ] Completed process returns immediate `status` + `done` + close (no hanging connection)
- [ ] Non-existent process returns 404 (not SSE)
- [ ] Client disconnect triggers cleanup (unsubscribe + clear heartbeat)
- [ ] `ProcessStore.onProcessOutput` returns working unsubscribe function
- [ ] `FileProcessStore` emitter map cleaned up after process completes
- [ ] Integration tests pass: full lifecycle, WebSocket, SSE, multi-workspace, concurrent, errors
- [ ] FileProcessStore tests pass: concurrent writes, 500 processes, pruning, output events
- [ ] Extension client tests pass: submit, update, remove, offline queue, workspace identity
- [ ] No test pollution: each test group cleans up its processes and connections
- [ ] All pre-existing tests in pipeline-core, pipeline-cli, and extension continue to pass

## Dependencies
- Depends on: 001, 002, 003, 004, 005, 006, 007, 008
