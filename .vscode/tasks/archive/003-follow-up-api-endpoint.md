---
status: pending
priority: high
commit: 3 of 9
feature: CoC Conversational UI
package: coc
---

# Commit 3: Add POST /api/processes/:id/message Endpoint

Add a new REST endpoint that accepts follow-up messages for an existing process and triggers a new AI response turn, enabling multi-turn ChatGPT-style conversation within the CoC web dashboard.

## Motivation

Commits 001 (ConversationTurn types) and 002 (SDK `sendFollowUp` method) established the data model and the SDK-level follow-up capability. This commit exposes that functionality as an HTTP API so the SPA dashboard can send follow-up messages to a completed process and receive streamed AI responses in real time via the existing SSE infrastructure.

## Changes

### 1. `packages/coc/src/server/api-handler.ts` — New route

Add `POST /api/processes/:id/message` inside `registerApiRoutes()`, after the existing `POST /api/processes/:id/cancel` route (around line 518). Follow the established pattern of regex-based routes with `parseBody`, `sendJSON`, and `sendError` helpers.

```typescript
// POST /api/processes/:id/message — Send a follow-up message
routes.push({
    method: 'POST',
    pattern: /^\/api\/processes\/([^/]+)\/message$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const process = await store.getProcess(id);
        if (!process) {
            return sendError(res, 404, 'Process not found');
        }

        // Validate the process has an SDK session to follow up on
        if (!process.sdkSessionId) {
            return sendError(res, 409, 'Process has no SDK session — follow-up not supported');
        }

        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return sendError(res, 400, 'Invalid JSON');
        }

        if (!body.content || typeof body.content !== 'string') {
            return sendError(res, 400, 'Missing required field: content (string)');
        }

        // Append user turn to conversationTurns
        const userTurn: ConversationTurn = {
            role: 'user',
            content: body.content,
            timestamp: new Date().toISOString(),
        };
        const existingTurns = process.conversationTurns || [];
        const updatedTurns = [...existingTurns, userTurn];
        const turnIndex = updatedTurns.length - 1;

        await store.updateProcess(id, {
            conversationTurns: updatedTurns,
            status: 'running',
        });

        // Delegate AI execution to the queue executor bridge (fire-and-forget)
        bridge.executeFollowUp(id, body.content).catch(() => {
            // Error handling is done inside executeFollowUp
        });

        sendJSON(res, 202, { processId: id, turnIndex });
    },
});
```

**Key decisions:**
- Return `202 Accepted` immediately — the AI response streams asynchronously via SSE
- Validate `sdkSessionId` exists (409 if not) — processes created by CLI backend or without session tracking cannot be followed up
- Append the user turn eagerly before delegating to the bridge, so it's persisted even if execution fails
- The `bridge` reference must be passed into `registerApiRoutes()` — see signature change below

**Signature change for `registerApiRoutes()`:**

```typescript
// Before:
export function registerApiRoutes(routes: Route[], store: ProcessStore): void {

// After:
export function registerApiRoutes(
    routes: Route[],
    store: ProcessStore,
    bridge?: QueueExecutorBridge
): void {
```

The `bridge` parameter is optional for backward compatibility — when absent, the `/message` endpoint returns `501 Not Implemented`. The existing `index.ts` server setup must pass the bridge instance when calling `registerApiRoutes()`.

**Import additions** at the top of `api-handler.ts`:

```typescript
import type { ConversationTurn } from '@plusplusoneplusplus/pipeline-core';
import type { QueueExecutorBridge } from './queue-executor-bridge';
```

### 2. `packages/coc/src/server/queue-executor-bridge.ts` — Add `executeFollowUp()`

Export a new interface and add the method to `CLITaskExecutor`. The bridge factory must also expose this capability.

**2a. New `QueueExecutorBridge` interface** — add after the existing `QueueExecutorBridgeOptions` interface (around line 53):

```typescript
/**
 * Exposes follow-up execution for the API layer.
 * Implemented by CLITaskExecutor, surfaced via the bridge factory.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string): Promise<void>;
}
```

**2b. Add `executeFollowUp()` method** to `CLITaskExecutor` (after the existing `cancel()` method, around line 175):

```typescript
/**
 * Execute a follow-up message on an existing process's SDK session.
 *
 * Flow:
 * 1. Look up process → get sdkSessionId
 * 2. Call sdkService.sendFollowUp(sdkSessionId, message, { onStreamingChunk })
 * 3. Stream chunks via store.emitProcessOutput()
 * 4. On completion, append assistant turn to conversationTurns
 * 5. Update process status back to 'completed'
 */
async executeFollowUp(processId: string, message: string): Promise<void> {
    const logger = getLogger();
    const startTime = Date.now();

    logger.debug(LogCategory.AI, `[FollowUp] Starting follow-up for process ${processId}`);

    const process = await this.store.getProcess(processId);
    if (!process) {
        throw new Error(`Process not found: ${processId}`);
    }
    if (!process.sdkSessionId) {
        throw new Error(`Process ${processId} has no SDK session`);
    }

    // Initialize output buffer for this follow-up
    this.outputBuffers.set(processId, '');

    try {
        const sdkService = getCopilotSDKService();
        const result = await sdkService.sendFollowUp(process.sdkSessionId, message, {
            onStreamingChunk: (chunk: string) => {
                // Accumulate for persistence
                const existing = this.outputBuffers.get(processId) ?? '';
                this.outputBuffers.set(processId, existing + chunk);
                try {
                    this.store.emitProcessOutput(processId, chunk);
                } catch {
                    // Non-fatal
                }
            },
            onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
        });

        const duration = Date.now() - startTime;
        logger.debug(LogCategory.AI, `[FollowUp] Completed for ${processId} in ${duration}ms`);

        // Append assistant turn to conversationTurns
        const refreshed = await this.store.getProcess(processId);
        const turns = refreshed?.conversationTurns || [];
        const assistantTurn: ConversationTurn = {
            role: 'assistant',
            content: result.response || '(No text response)',
            timestamp: new Date().toISOString(),
        };

        await this.store.updateProcess(processId, {
            conversationTurns: [...turns, assistantTurn],
            status: 'completed',
            endTime: new Date(),
            result: result.response || undefined,
        });
        this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const duration = Date.now() - startTime;
        logger.debug(LogCategory.AI, `[FollowUp] Failed for ${processId} in ${duration}ms: ${errorMsg}`);

        // Append error turn and mark failed
        const refreshed = await this.store.getProcess(processId);
        const turns = refreshed?.conversationTurns || [];
        const errorTurn: ConversationTurn = {
            role: 'assistant',
            content: `Error: ${errorMsg}`,
            timestamp: new Date().toISOString(),
        };

        await this.store.updateProcess(processId, {
            conversationTurns: [...turns, errorTurn],
            status: 'failed',
            endTime: new Date(),
            error: errorMsg,
        });
        this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
    } finally {
        // Persist accumulated output to disk
        const buffer = this.outputBuffers.get(processId) ?? '';
        this.outputBuffers.delete(processId);
        // Append to existing output file rather than overwriting
        await this.persistOutput(processId, buffer);
    }
}
```

**Import additions** at the top of `queue-executor-bridge.ts`:

```typescript
import type { ConversationTurn } from '@plusplusoneplusplus/pipeline-core';
```

**2c. Update `createQueueExecutorBridge()` return type** — the factory currently returns `QueueExecutor`. It must also expose the `CLITaskExecutor` instance so the API layer can call `executeFollowUp()`. Two options:

**Option A (preferred): Return a compound object:**

```typescript
export function createQueueExecutorBridge(
    queueManager: TaskQueueManager,
    store: ProcessStore,
    options: QueueExecutorBridgeOptions = {}
): { executor: QueueExecutor; bridge: QueueExecutorBridge } {
    const taskExecutor = new CLITaskExecutor(store, { /* ... */ });
    const executor = createQueueExecutor(queueManager, taskExecutor, { /* ... */ });
    return { executor, bridge: taskExecutor };
}
```

This is a breaking change to the return type. Update all call sites (there is one in `packages/coc/src/server/index.ts`).

**Option B (minimal): Keep return type, add bridge as property on executor:**

Store the `taskExecutor` reference on the executor object via a symbol or public field. Option A is cleaner.

### 3. `packages/coc/src/server/index.ts` — Wire the bridge

Update the server setup to pass the bridge to `registerApiRoutes()`:

```typescript
// Before:
const executor = createQueueExecutorBridge(queueManager, store, bridgeOptions);
registerApiRoutes(routes, store);

// After:
const { executor, bridge } = createQueueExecutorBridge(queueManager, store, bridgeOptions);
registerApiRoutes(routes, store, bridge);
```

### 4. `packages/coc/src/server/sse-handler.ts` — Support re-streaming

The current `handleProcessStream()` immediately sends `done` and closes for processes not in `running` or `queued` status (line 48). When a follow-up transitions a completed process back to `running`, clients that reconnect should be able to subscribe to the new stream.

**Minimal change:** No code changes are strictly needed — the existing logic already handles this correctly:

- When the process is `completed`, the SSE endpoint sends final status and closes
- When the client sends a follow-up via POST `/message`, the process transitions to `running`
- The client opens a new SSE connection, which sees `status: 'running'` and subscribes to `onProcessOutput`
- The SPA will open a new EventSource after sending each follow-up

If the SPA keeps an existing SSE connection open during a follow-up, the connection will have already closed (after the initial `done` event). The SPA must reconnect. **Document this in the SPA task** (commit 6 or later).

**Optional enhancement (recommended for future commit):** Add a `turn` field to SSE chunk events so the SPA can associate chunks with the correct conversation turn:

```typescript
// Future: event: chunk → { content: string, turnIndex: number }
```

This is not required for commit 3 but should be noted for the SPA integration commit.

## Process Status Transitions

```
Initial run:   queued → running → completed
Follow-up:     completed → running → completed
                completed → running → failed
```

The endpoint must only accept follow-ups on processes that have `sdkSessionId` set. The status is not checked (a follow-up could theoretically be sent to a `failed` process to retry), but the `sdkSessionId` is the hard requirement.

## Request / Response Contract

**Request:**
```
POST /api/processes/:id/message
Content-Type: application/json

{
    "content": "Can you also add error handling for the edge case?"
}
```

**Response (success):**
```
HTTP/1.1 202 Accepted
Content-Type: application/json

{
    "processId": "queue-abc123",
    "turnIndex": 2
}
```

**Response (process not found):**
```
HTTP/1.1 404 Not Found
{ "error": "Process not found" }
```

**Response (missing content):**
```
HTTP/1.1 400 Bad Request
{ "error": "Missing required field: content (string)" }
```

**Response (no SDK session):**
```
HTTP/1.1 409 Conflict
{ "error": "Process has no SDK session — follow-up not supported" }
```

## Tests

Add tests in `packages/coc/test/server/api-handler.test.ts` inside a new `describe('POST /api/processes/:id/message')` block. Follow the existing patterns: `createExecutionServer()` with port 0, `postJSON` helper, `makeProcess` factory.

**Test cases:**

1. **Returns 404 for unknown process** — POST to `/api/processes/nonexistent/message` with valid body, expect 404 with `"Process not found"`.

2. **Returns 400 for missing content** — Create a process, POST to `/message` with `{}`, expect 400 with `"Missing required field: content (string)"`.

3. **Returns 400 for non-string content** — POST with `{ content: 123 }`, expect 400.

4. **Returns 400 for invalid JSON** — POST with malformed body, expect 400 with `"Invalid JSON"`.

5. **Returns 409 for process without sdkSessionId** — Create a process without `sdkSessionId`, POST follow-up, expect 409 with `"Process has no SDK session"`.

6. **Returns 202 and appends user turn** — Create a process with `sdkSessionId`, POST follow-up, expect 202 with `{ processId, turnIndex }`. Verify `store.getProcess()` shows the user turn in `conversationTurns` and status is `running`.

7. **Returns 202 for process with empty conversationTurns** — Verify `turnIndex` is 0 when no prior turns exist.

For test cases 6–7, the bridge's `executeFollowUp` can be stubbed or the test can use a mock bridge that resolves immediately. Since the real SDK is unavailable in tests, the bridge should be injected as a dependency.

**Test file for bridge** (`packages/coc/test/server/queue-executor-bridge.test.ts`) — add a new `describe('executeFollowUp')` block:

8. **Throws for missing process** — Call `executeFollowUp('nonexistent', 'msg')`, expect error.

9. **Throws for process without sdkSessionId** — Create process without session, call follow-up, expect error.

10. **On success, appends assistant turn and sets status to completed** — Mock `sdkService.sendFollowUp()` to return a response, verify `conversationTurns` has both user and assistant turns, status is `completed`.

11. **On failure, appends error turn and sets status to failed** — Mock `sdkService.sendFollowUp()` to throw, verify error turn is appended and status is `failed`.

12. **Streams chunks via store.emitProcessOutput** — Mock `sendFollowUp` with `onStreamingChunk` callback, verify `store.emitProcessOutput` is called for each chunk.

## Acceptance Criteria

- [ ] `POST /api/processes/:id/message` accepts `{ content: string }` and returns 202
- [ ] Endpoint returns 404 for unknown process ID
- [ ] Endpoint returns 400 for missing or non-string `content`
- [ ] Endpoint returns 409 for process without `sdkSessionId`
- [ ] User turn is appended to `conversationTurns` before AI execution begins
- [ ] Process status transitions: `completed` → `running` → `completed` (or `failed`)
- [ ] Assistant turn (or error turn) is appended to `conversationTurns` on completion
- [ ] Streaming chunks are emitted via `store.emitProcessOutput()` for SSE delivery
- [ ] Output is persisted to disk via `OutputFileManager`
- [ ] `createQueueExecutorBridge()` exposes `bridge` for API layer consumption
- [ ] All new tests pass (`npm run test:run` in `packages/coc/`)
- [ ] Existing tests still pass (no regressions)

## Dependencies

- Depends on: 001 (ConversationTurn types on AIProcess), 002 (SDK `sendFollowUp` method)
- Depended on by: 004+ (SPA conversation UI that calls this endpoint)
