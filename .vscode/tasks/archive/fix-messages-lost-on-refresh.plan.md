# Fix: Queue Tab Loses Earlier Messages After F5 Refresh

## Problem Statement

When the Queue tab (SPA in a VS Code webview) is refreshed (F5 / extension restart / webview recreate), earlier messages in a running or completed multi-turn conversation disappear. The user sees only partial content — typically just the latest streaming chunk — instead of the full conversation history.

## Root Cause Analysis

The investigation uncovered **three interacting bugs**, not one. All three must be fixed together for correct behavior.

---

### Bug 1 (Critical): `turnsRef` / React State Desync

**Location:** `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`

**The mechanism:**

Two `useEffect` hooks fire on task selection:
1. **Fetch effect (line 291)** — calls `GET /api/processes/:id`, gets full `conversationTurns`, calls `setTurns(t)` at line 315 + `appDispatch` for cache
2. **SSE effect (line 337)** — opens `EventSource` to `/api/processes/:id/stream`, receives replayed chunks, calls `setTurnsAndCache((prev) => ...)` at line 359

**The bug:** The fetch `.then()` at line 315 calls `setTurns(t)` directly — this updates **React state** but NOT `turnsRef.current`. Meanwhile, `setTurnsAndCache` (line 102-108) reads from `turnsRef.current` as its source of truth:

```ts
const setTurnsAndCache = (nextTurns) => {
    const prev = turnsRef.current;  // ← still [] because fetch didn't update it
    const resolved = typeof nextTurns === 'function' ? nextTurns(prev) : nextTurns;
    turnsRef.current = resolved;
    setTurns(resolved);  // overwrites React state with SSE-built data
};
```

When the first SSE chunk arrives, it reads `turnsRef.current = []` (empty!), creates a fresh assistant turn with just that chunk, and `setTurns(...)` **overwrites** the full conversation that the fetch had loaded. All earlier user turns and completed assistant turns vanish.

**Impact:** The entire conversation history from the fetch is silently replaced with just the SSE-streamed portion.

---

### Bug 2 (Critical): SSE Replay Sends Unstructured Chunks

**Location:** `packages/coc-server/src/sse-handler.ts`, lines 137-145

When a new SSE connection opens, the server replays stored conversation history:

```ts
function replayConversationTurns(res, process) {
    const turns = process.conversationTurns;
    for (const turn of turns) {
        if (turn.role === 'assistant' && turn.content) {
            sendEvent(res, 'chunk', { content: turn.content });
        }
    }
}
```

**Problems:**
1. **User turns are dropped** — only `assistant` turns are emitted. The client never learns about user messages from replay.
2. **Multiple assistant turns merge into one** — each replayed turn is sent as a `chunk` event. The client's handler (`ensureAssistantTurn` + append) concatenates ALL of them into a single assistant turn, destroying the conversation structure.
3. **No distinction between replay and live** — the client receives `chunk` events for both replayed history and live streaming, with no way to tell them apart.

**Impact:** A 4-turn conversation (user → assistant → user → assistant) gets replayed as "assistant1-content" + "assistant2-content" concatenated into one turn. Tool call timelines, turn boundaries, and user messages are all lost.

---

### Bug 3 (Moderate): Flush Gap for Running Processes

**Location:** `packages/coc/src/server/queue-executor-bridge.ts`, lines 105-107, 747-764

Streaming content is accumulated in an in-memory `outputBuffers` Map and only flushed to the ProcessStore every **50 chunks or 5 seconds** (`THROTTLE_TIME_MS=5000`, `THROTTLE_CHUNK_COUNT=50`).

When an SSE connection opens, `replayConversationTurns` reads `process.conversationTurns` from the **store** (disk). Content accumulated since the last throttled flush (up to 5 seconds) is **not included** in the replay.

Meanwhile, the live `store.onProcessOutput` subscription picks up **new** chunks from after the connection was established. Content between the last flush and the SSE connection is lost.

**Impact:** Up to 5 seconds of streaming content (potentially hundreds of tokens) is silently dropped on reconnect.

---

## Fix Design

### Fix 1: Sync `turnsRef` in Fetch Path

**File:** `QueueTaskDetail.tsx`, line 315

Change `setTurns(t)` to `setTurnsAndCache(t)` so that `turnsRef.current` stays in sync with React state:

```diff
 .then((data: any) => {
     setProcessDetails(data?.process || null);
     const t = getConversationTurns(data);
     appDispatch({ type: 'CACHE_CONVERSATION', processId: selectedTaskId, turns: t });
-    setTurns(t);
+    setTurnsAndCache(t);
 })
```

Same issue may exist in the cache-hit path (line 301): `setTurns(cached.turns)` should also sync `turnsRef`.

### Fix 2: Structured SSE Replay via `conversation-snapshot` Event

**File:** `sse-handler.ts`, `replayConversationTurns` function

Instead of emitting raw `chunk` events, send a single structured `conversation-snapshot` event with the full turns array:

```ts
function replayConversationTurns(res: ServerResponse, process: AIProcess): void {
    const turns = process.conversationTurns;
    if (!turns || turns.length === 0) { return; }
    sendEvent(res, 'conversation-snapshot', { turns });
}
```

**Client side:** Add a `conversation-snapshot` event handler in the SSE useEffect that REPLACES the current turns state (not appends):

```ts
es.addEventListener('conversation-snapshot', (event) => {
    const data = JSON.parse(event.data);
    if (data.turns) {
        setTurnsAndCache(data.turns);
    }
});
```

This cleanly separates historical replay from live streaming, preserves turn structure, and includes user turns.

### Fix 3: Immediate Flush Before SSE Replay

**Files:** `process-store.ts` (interface), `file-process-store.ts` (impl), `queue-executor-bridge.ts` (registration), `sse-handler.ts` (invocation)

Add an optional `requestFlush` mechanism:

1. **ProcessStore interface** — add optional `requestFlush?(id: string): Promise<void>`
2. **FileProcessStore** — add a registry for flush handlers:
   ```ts
   private flushHandlers = new Map<string, () => Promise<void>>();
   registerFlushHandler(id: string, handler: () => Promise<void>): void { ... }
   unregisterFlushHandler(id: string): void { ... }
   async requestFlush(id: string): Promise<void> {
       const handler = this.flushHandlers.get(id);
       if (handler) await handler();
   }
   ```
3. **CLITaskExecutor** — on streaming start, register a flush handler:
   ```ts
   this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));
   ```
4. **SSE handler** — before replay, trigger flush:
   ```ts
   if (process.status === 'running' && store.requestFlush) {
       await store.requestFlush(processId);
       process = await store.getProcess(processId);  // re-read after flush
   }
   replayConversationTurns(res, process);
   ```

This ensures the SSE snapshot includes the very latest content, closing the 5-second gap.

---

## Implementation Order

### Todo 1: `fix-turns-ref-sync`
**Fix turnsRef desync in QueueTaskDetail.tsx**

Change `setTurns(t)` → `setTurnsAndCache(t)` in:
- Fetch `.then()` at line 315
- Cache-hit path at line 301
- Any other place that calls `setTurns()` without also updating `turnsRef`

This is the most impactful single fix and can be deployed independently.

### Todo 2: `add-conversation-snapshot-event`
**Add `conversation-snapshot` SSE event** (depends on todo 1)

Server-side:
- Change `replayConversationTurns` in `sse-handler.ts` to emit `conversation-snapshot` event
- Emit the full `conversationTurns` array as structured data

Client-side:
- Add `conversation-snapshot` handler in SSE useEffect that calls `setTurnsAndCache(data.turns)`
- Keep `chunk` handler for live streaming only (after snapshot is loaded)

### Todo 3: `add-flush-on-sse-connect`
**Trigger immediate flush before SSE replay** (depends on todo 2)

- Add `requestFlush` to ProcessStore interface (optional method)
- Implement flush handler registry in FileProcessStore
- Register flush handler in CLITaskExecutor on streaming start
- Call `requestFlush` in SSE handler before snapshot emission

### Todo 4: `add-tests`
**Add tests for all three fixes** (depends on todos 1-3)

- Unit test: turnsRef stays in sync after fetch in QueueTaskDetail
- Unit test: `conversation-snapshot` event emitted with proper structure
- Unit test: SSE handler calls `requestFlush` for running processes
- Integration test: reconnect after simulated refresh preserves full conversation

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Fix turnsRef sync, add conversation-snapshot handler |
| `packages/coc-server/src/sse-handler.ts` | Change replay to structured snapshot, add flush call |
| `packages/pipeline-core/src/process-store.ts` | Add optional `requestFlush`, `registerFlushHandler`, `unregisterFlushHandler` |
| `packages/pipeline-core/src/file-process-store.ts` | Implement flush handler registry |
| `packages/coc/src/server/queue-executor-bridge.ts` | Register flush handler on streaming start |

---

## Risk Assessment

- **Fix 1 (turnsRef sync):** Zero risk — purely additive, fixes an obvious state management bug
- **Fix 2 (conversation-snapshot):** Low risk — new SSE event type, backward-compatible (old clients ignore unknown events). Must ensure the snapshot replaces rather than appends.
- **Fix 3 (flush-on-connect):** Low risk — flush is idempotent and non-fatal. The `requestFlush` is optional on the interface. Only risk is slightly increased I/O on reconnect (one extra flush).

## Notes

- The `THROTTLE_TIME_MS=5000` / `THROTTLE_CHUNK_COUNT=50` values are reasonable for normal operation; the fix targets only the reconnect path.
- The `flushConversationTurn` JSDoc mentions a `streaming: false` call on completion, but this code path is never invoked. The completion path directly writes final turns. This is not a bug, just dead documentation.
- The `ai-process-manager.ts` in the VS Code extension (line 144-167) also drops `conversationTurns` when serializing to `workspaceState`. This is a separate issue — the Queue tab SPA doesn't use workspaceState, so it's not related to this bug.
