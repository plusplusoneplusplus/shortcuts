---
status: done
---

# 003: SSE Pipeline Event Relay & Client Handling

## Summary

Add server-side SSE relay for `pipeline-phase` and `pipeline-progress` events through the existing `onProcessOutput` callback in `sse-handler.ts`, and update the SPA `ProcessDetail` component to listen for these named SSE events via `addEventListener` instead of the catch-all `onmessage`.

## Motivation

The SSE handler (`sse-handler.ts`) is the only bridge between the server-side process store and the browser SPA. Pipeline visualization requires real-time phase transitions and progress updates to reach the client. This commit is isolated because it touches the server↔client streaming contract — the SSE wire format and the client event listener setup — without changing any UI rendering. Separating it ensures the event plumbing is correct and testable before visualization components consume the data (commits 004–006).

## Changes

### Files to Create

- `packages/coc-server/test/sse-pipeline-events.test.ts` — SSE handler tests for pipeline event types
- `packages/coc/test/spa/react/ProcessDetail-pipeline-events.test.tsx` — Client-side listener tests

### Files to Modify

- **`packages/coc-server/src/sse-handler.ts`** — Add two new branches to the `onProcessOutput` callback (lines 84–124) for `pipeline-phase` and `pipeline-progress` event types.

- **`packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx`** — Refactor the SSE streaming `useEffect` (lines 122–150) to replace `es.onmessage` with specific `addEventListener` calls, and add local state for pipeline phase/progress data.

- **`packages/coc/src/server/spa/client/react/context/AppContext.tsx`** — (Optional, only if pipeline state needs to be shared outside ProcessDetail) Add `SET_PIPELINE_PHASES` / `SET_PIPELINE_PROGRESS` actions to the reducer. However, since only ProcessDetail consumes this data in this commit, prefer local `useState` in ProcessDetail and defer context integration to the visualization commit.

### Files to Delete

(none)

## Implementation Notes

### SSE Handler (`sse-handler.ts`)

The `onProcessOutput` callback at line 84 is a flat if/else chain dispatching on `event.type`. Each branch picks fields from the `ProcessOutputEvent` and calls `sendEvent(res, eventName, payload)` (line 137–139), which serializes to `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`.

**Add two new branches** after the `permission-request` block (line 115) and before the `complete` block (line 116):

```typescript
} else if (event.type === 'pipeline-phase') {
    sendEvent(res, 'pipeline-phase', {
        phase: event.phase,
        status: event.phaseStatus,
        stats: event.stats,
    });
} else if (event.type === 'pipeline-progress') {
    sendEvent(res, 'pipeline-progress', {
        phase: event.phase,
        completedItems: event.completedItems,
        failedItems: event.failedItems,
        totalItems: event.totalItems,
        percentage: event.percentage,
    });
}
```

Also update the JSDoc protocol comment at lines 17–29 to include the two new event types:

```
 *   event: pipeline-phase    → { phase, status, stats }
 *   event: pipeline-progress → { phase, completedItems, failedItems, totalItems, percentage }
```

**Key detail:** The `sendEvent` helper (line 137) already handles arbitrary event names and JSON serialization, so no changes needed there.

### ProcessDetail SSE Refactor (`ProcessDetail.tsx`)

The current SSE setup at lines 122–150 uses `es.onmessage` (line 133), which only receives **unnamed** SSE events (events without an `event:` field). However, the server sends **all** events as named events (e.g., `event: chunk`, `event: status`). This means `es.onmessage` currently never fires for the existing named events — the component relies on the REST fetch + cache for conversation data, not on live SSE chunks.

**Refactor approach:**

1. Replace `es.onmessage` (lines 133–139) with specific `addEventListener` calls:

```typescript
es.addEventListener('chunk', (e) => {
    try {
        const data = JSON.parse(e.data);
        dispatch({ type: 'APPEND_TURN', processId: selectedId, turn: data });
        setTurns(prev => [...prev, data]);
    } catch { /* ignore parse errors */ }
});

es.addEventListener('conversation-snapshot', (e) => {
    try {
        const data = JSON.parse(e.data);
        if (data.turns) {
            setTurns(data.turns);
            dispatch({ type: 'CACHE_CONVERSATION', processId: selectedId, turns: data.turns });
        }
    } catch { /* ignore */ }
});

es.addEventListener('pipeline-phase', (e) => {
    try {
        const data = JSON.parse(e.data);
        setPipelinePhases(prev => {
            const idx = prev.findIndex(p => p.phase === data.phase);
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = data;
                return updated;
            }
            return [...prev, data];
        });
    } catch { /* ignore */ }
});

es.addEventListener('pipeline-progress', (e) => {
    try {
        const data = JSON.parse(e.data);
        setPipelineProgress(data);
    } catch { /* ignore */ }
});

es.addEventListener('status', (e) => {
    try {
        const data = JSON.parse(e.data);
        dispatch({ type: 'PROCESS_UPDATED', process: { id: selectedId, status: data.status } });
    } catch { /* ignore */ }
});
```

2. Add new local state near line 61–66:

```typescript
const [pipelinePhases, setPipelinePhases] = useState<Array<{ phase: string; status: string; stats?: Record<string, unknown> }>>([]);
const [pipelineProgress, setPipelineProgress] = useState<{ phase: string; completedItems: number; failedItems: number; totalItems: number; percentage: number } | null>(null);
```

3. Reset pipeline state when `selectedId` changes — add to the existing fetch `useEffect` (line 78):

```typescript
setPipelinePhases([]);
setPipelineProgress(null);
```

**Note:** The `pipelinePhases` and `pipelineProgress` state is local to `ProcessDetail` for now. Commit 004+ will introduce a `PipelineDAG` component that receives these as props.

### AppContext (`AppContext.tsx`)

No changes in this commit. The `AppAction` union (lines 65–99) and `appReducer` (lines 103–249) use a standard `useReducer` pattern. If future commits need pipeline state globally (e.g., to show phase badges in the sidebar), actions like `SET_PIPELINE_PHASES` and `SET_PIPELINE_PROGRESS` can be added at that point. For now, local state in `ProcessDetail` avoids unnecessary re-renders of the entire app tree.

### Type Dependencies (from commit 001)

This commit assumes `ProcessOutputEvent.type` (currently `'chunk' | 'complete' | 'tool-start' | 'tool-complete' | 'tool-failed' | 'permission-request'` at `process-store.ts:17`) has been extended with `'pipeline-phase' | 'pipeline-progress'`, and the corresponding optional fields (`phase`, `phaseStatus`, `stats`, `completedItems`, `failedItems`, `totalItems`, `percentage`) exist on the interface.

## Tests

### SSE Handler Tests (`packages/coc-server/test/sse-pipeline-events.test.ts`)

Follow the exact pattern from `sse-replay.test.ts` — uses `createMockProcessStore`, `createProcessFixture`, `createMockReq`, `createMockRes`, and `parseSSEFrames` helpers.

1. **`pipeline-phase event is relayed as named SSE event`** — Create a running process, capture the `onProcessOutput` callback, emit a `{ type: 'pipeline-phase', phase: 'discovery', phaseStatus: 'running', stats: { components: 5 } }` event, parse SSE frames, assert `event: pipeline-phase` with correct payload fields.

2. **`pipeline-progress event is relayed as named SSE event`** — Same setup, emit `{ type: 'pipeline-progress', phase: 'analysis', completedItems: 3, failedItems: 0, totalItems: 10, percentage: 30 }`, assert SSE frame has `event: pipeline-progress` with all fields.

3. **`pipeline events do not interfere with existing chunk/complete flow`** — Emit a sequence of `chunk` → `pipeline-phase` → `pipeline-progress` → `complete`, verify all four are present in the correct order and the connection ends properly.

4. **`pipeline-phase with status "completed" includes stats`** — Verify that stats object is preserved through JSON serialization (no field stripping).

### ProcessDetail Listener Tests (`packages/coc/test/spa/react/ProcessDetail-pipeline-events.test.tsx`)

Follow patterns from existing SPA tests (e.g., `ConversationTurnBubble.test.tsx`, `ProcessesSidebar.test.tsx`). Mock `EventSource` globally.

1. **`registers addEventListener for pipeline-phase and pipeline-progress`** — Mount ProcessDetail with a running process selected, assert that `addEventListener` was called with `'pipeline-phase'` and `'pipeline-progress'` among other event names.

2. **`pipeline-phase listener updates local state`** — Simulate dispatching a `pipeline-phase` MessageEvent via the mocked EventSource, verify the component's state updates (assert via exposed props or test IDs if rendering is added later).

3. **`pipeline-progress listener updates progress state`** — Similar to above for progress events.

4. **`pipeline state resets on process selection change`** — Select process A (receives pipeline events), switch to process B, verify pipeline state is cleared.

5. **`EventSource cleanup removes all listeners on unmount`** — Mount and unmount, verify `es.close()` is called (existing behavior, but ensure new listeners don't leak).

## Acceptance Criteria

- [ ] SSE handler relays `pipeline-phase` events with `{ phase, status, stats }` payload
- [ ] SSE handler relays `pipeline-progress` events with `{ phase, completedItems, failedItems, totalItems, percentage }` payload
- [ ] JSDoc protocol comment in `sse-handler.ts` documents both new event types
- [ ] ProcessDetail uses `addEventListener` for all SSE event types (no `onmessage`)
- [ ] ProcessDetail maintains local `pipelinePhases` and `pipelineProgress` state
- [ ] Pipeline state resets when `selectedId` changes
- [ ] Existing SSE behavior (chunk, conversation-snapshot, status, done, tool-*, permission-request, heartbeat) is unaffected
- [ ] All new tests pass; existing `sse-replay.test.ts` tests remain green
- [ ] `npm run build` succeeds
- [ ] `cd packages/coc-server && npm run test:run` passes
- [ ] `cd packages/coc && npm run test:run` passes

## Dependencies

- Depends on: 001 (ProcessOutputEvent type extension with `pipeline-phase` and `pipeline-progress`)

## Assumed Prior State

`ProcessOutputEvent` type union (in `packages/pipeline-core/src/process-store.ts:17`) includes `'pipeline-phase' | 'pipeline-progress'` with their payload fields: `phase?: string`, `phaseStatus?: string`, `stats?: Record<string, unknown>`, `completedItems?: number`, `failedItems?: number`, `totalItems?: number`, `percentage?: number`.
