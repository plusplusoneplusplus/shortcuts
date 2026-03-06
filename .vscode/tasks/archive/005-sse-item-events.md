---
status: pending
---

# 005: SSE Events for Item-Level Progress

## Summary
Add `item-process` SSE event type to the streaming handler, so the SPA can receive real-time notifications when individual map items start, complete, or fail during a live pipeline run.

## Motivation
The workflow detail view needs live updates as items progress. The bridge (Commit 3) already emits `store.emitProcessEvent(parentProcessId, { type: 'item-process', ... })` — this commit ensures those events reach the SSE client as named events.

## Changes

### Files to Modify

#### `packages/pipeline-core/src/process-store.ts`
- **Line 18** — extend the `ProcessOutputEvent.type` union (currently `'chunk' | 'complete' | 'tool-start' | 'tool-complete' | 'tool-failed' | 'permission-request' | 'pipeline-phase' | 'pipeline-progress' | 'suggestions'`) to include `'item-process'`
- Add new optional field to `ProcessOutputEvent` (after line 50, alongside `pipelinePhase?` and `pipelineProgress?`):
  ```ts
  /** Item-level process event data (for 'item-process' events). */
  itemProcess?: ItemProcessEventData;
  ```

#### `packages/pipeline-core/src/pipeline/types.ts`
- Add `ItemProcessEventData` interface (after `PipelineProgressEvent`, around line 472):
  ```ts
  /** Event emitted when an individual map item's child process changes state. */
  export interface ItemProcessEventData {
      /** Zero-based index of the item within the map input array. */
      itemIndex: number;
      /** Process ID of the child process handling this item. */
      processId: string;
      /** Current status of the item process. */
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      /** Pipeline phase the item is in (typically 'map'). */
      phase: PipelinePhase;
      /** Short label for UI display (e.g. first CSV column value). */
      itemLabel?: string;
      /** Error message when status is 'failed'. */
      error?: string;
  }
  ```
- Export `ItemProcessEventData` from `packages/pipeline-core/src/index.ts`

#### `packages/coc-server/src/sse-handler.ts`
- **Lines 119–122** show the existing pattern for pipeline events:
  ```ts
  } else if (event.type === 'pipeline-phase') {
      sendEvent(res, 'pipeline-phase', event.pipelinePhase);
  } else if (event.type === 'pipeline-progress') {
      sendEvent(res, 'pipeline-progress', event.pipelineProgress);
  ```
- Add a new branch in the if-chain (after the `pipeline-progress` handler at line 122, before `suggestions` at line 123):
  ```ts
  } else if (event.type === 'item-process') {
      sendEvent(res, 'item-process', event.itemProcess);
  ```
- Update the JSDoc protocol block (lines 19–31) to include:
  ```
  *   event: item-process    → { itemIndex, processId, status, phase, itemLabel?, error? }
  ```

### Event Flow
```
Executor (onItemProcessCreated)
  → Bridge (store.emitProcessEvent(parentProcessId, { type: 'item-process', itemProcess: {...} }))
    → FileProcessStore (notifies subscribers via onProcessOutput callbacks)
      → SSE handler (event.type === 'item-process' → sendEvent(res, 'item-process', event.itemProcess))
        → SPA WebSocket/EventSource client
```

## Implementation Notes

### SSE Emission Pattern (from `sse-handler.ts`)
The handler at line 87 subscribes via `store.onProcessOutput(processId, callback)`. Each event enters a flat if/else-if chain (lines 88–136) keyed on `event.type`. Pipeline-specific events pass through a nested data field (`event.pipelinePhase`, `event.pipelineProgress`). The `item-process` event follows this exact pattern using `event.itemProcess`.

The `sendEvent` helper (line 149) writes the SSE frame: `event: <name>\ndata: <JSON>\n\n`.

### Data Shape
Event data should be minimal — no full `conversationTurns` — just enough for the SPA to update a card:
```ts
{
    itemIndex: number,   // position in input array
    processId: string,   // child process ID for drill-down
    status: string,      // 'running' | 'completed' | 'failed' | 'cancelled'
    phase: string,       // typically 'map'
    itemLabel?: string,  // optional short display label
    error?: string       // only when status === 'failed'
}
```

### Throttling
Unlike `pipeline-progress` (which may be throttled at 250ms for continuous percentage updates), `item-process` events must NOT be throttled — they represent discrete state transitions (started → completed/failed), not continuous progress.

### Batch Mode
Events fire per-item (not per-batch), matching the `onItemProcessCreated` granularity from Commit 2. For a batch of 10, 10 `item-process` events fire with their respective `itemIndex` values.

## Tests
- Test: SSE stream receives `item-process` events during pipeline execution
- Test: Event data includes correct `itemIndex`, `processId`, and `status`
- Test: Failed items emit event with `error` field populated
- Test: Events arrive with correct indices (may be out of order for parallel execution, but indices must be accurate)
- Test: Non-pipeline processes don't emit `item-process` events
- Test: `sendEvent` produces correct SSE frame format for `item-process` type

## Acceptance Criteria
- [ ] `ProcessOutputEvent.type` union includes `'item-process'`
- [ ] `ItemProcessEventData` interface exported from `pipeline-core`
- [ ] `item-process` SSE events emitted per map item during live pipeline runs
- [ ] Event data includes `itemIndex`, `processId`, `status`, `phase`
- [ ] Events are NOT throttled (discrete state transitions)
- [ ] Follows existing SSE event emission pattern (if-chain in `sse-handler.ts` lines 88–136)
- [ ] JSDoc protocol block in `sse-handler.ts` updated
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: 003, 004

## Assumed Prior State
- Bridge emits `store.emitProcessEvent(parentProcessId, { type: 'item-process', ... })` (Commit 3)
- REST routes can serve child data for initial load (Commit 4)
- `ProcessStore.emitProcessEvent(id, event)` exists at `process-store.ts:188`
- `ProcessStore.onProcessOutput(id, callback)` exists at `process-store.ts:179`
