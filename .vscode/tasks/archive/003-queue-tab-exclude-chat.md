---
status: pending
---

# 003: Queue Tab — Exclude Chat-Type Tasks

## Summary

Filter `type: 'chat'` tasks out of the Queue tab's running, queued, and history lists so the Queue tab exclusively shows background pipeline jobs. Filtering is applied both on initial HTTP fetch results and on live WebSocket `queue-updated` snapshot data.

## Motivation

With chat sessions now surfaced in their own dedicated Chat tab (Commit 2), the Queue tab should only display background jobs (pipelines, code reviews, etc.). Showing chat tasks in both tabs would be confusing and redundant. This commit is isolated because it touches only the Queue tab component and its data flow, with no server-side API changes required.

## Changes

### Files to Create
- (none)

### Files to Modify

- `packages/coc/src/server/spa/client/react/repos/RepoQueueTab.tsx` — Add client-side filtering to exclude `type === 'chat'` tasks from `running`, `queued`, and `history` arrays. Apply the filter in two locations:
  1. After the initial HTTP fetch (`fetchQueue`) sets state from `/queue` and `/queue/history` responses.
  2. In the `useEffect` that applies per-repo WebSocket updates from `repoQueue`.
  
  Additionally, update the empty-state check (line 119) to use the filtered arrays so the "No tasks in queue" placeholder appears correctly when the only tasks are chat-type.

### Files to Delete
- (none)

## Implementation Notes

### Filtering approach — client-side

Client-side filtering (`.filter(t => t.type !== 'chat')`) is preferred over server-side `excludeType` query params because:
- The `type` field is already present on every task summary (confirmed in `QueueTaskSummary` and `QueueHistoryTaskSummary` interfaces in `packages/coc-server/src/websocket.ts`, and in the `mapQueued`/`mapRunning`/`mapHistory` helpers in `packages/coc/src/server/index.ts` which copy `t.type` into every WS payload).
- A single helper function can filter all three arrays consistently.
- No server-side changes needed — this commit stays fully contained in one file.

### Helper constant

Define a reusable filter predicate at module scope for clarity and to avoid inline repetition:

```ts
const isNonChat = (t: { type?: string }) => t.type !== 'chat';
```

### Application points

1. **`fetchQueue` callback (lines 34-48):** After receiving HTTP response data, filter before calling `setRunning`, `setQueued`, `setHistory`:
   ```ts
   setRunning((data?.running || []).filter(isNonChat));
   setQueued((data?.queued || []).filter(isNonChat));
   // ...
   setHistory((historyData?.history || []).filter(isNonChat));
   ```

2. **WebSocket `useEffect` (lines 57-66):** When `repoQueue` arrives from the `QueueContext`, filter before setting state:
   ```ts
   setRunning(repoQueue.running.filter(isNonChat));
   setQueued(repoQueue.queued.filter(isNonChat));
   setHistory(repoQueue.history.filter(isNonChat));
   ```

### Counts and stats

The section headers already derive counts from the array length (e.g., `running.length`, `queued.length`, `history.length` on lines 171, 193, 219). Since filtering happens before state is set, these counts will automatically reflect only non-chat tasks. No additional count adjustments are needed.

### QueueContext not modified

The `QueueContext` reducer (`QueueContext.tsx`) is intentionally left unmodified. It stores the full unfiltered queue state for potential use by other consumers (e.g., the global queue panel, badge counts). Filtering is the responsibility of the Queue tab view layer.

## Tests

- Add or update test in `packages/coc/src/server/spa/client/react/repos/` (or co-located test file) verifying:
  1. **Chat tasks filtered from running list** — Given a `repoQueue` with `[{ type: 'chat' }, { type: 'pipeline' }]` running, the rendered Queue tab shows only the pipeline task.
  2. **Chat tasks filtered from queued list** — Same pattern for queued tasks.
  3. **Chat tasks filtered from history list** — Same pattern for completed history entries.
  4. **Empty state shown when only chat tasks exist** — If all running/queued/history items are `type: 'chat'`, the "No tasks in queue" placeholder is displayed.
  5. **WebSocket update applies filter** — When `repoQueue` context value updates with chat tasks included, the component re-renders without those chat items.

## Acceptance Criteria

- [ ] Queue tab running section does not display any tasks with `type === 'chat'`
- [ ] Queue tab queued section does not display any tasks with `type === 'chat'`
- [ ] Queue tab history section does not display any tasks with `type === 'chat'`
- [ ] Section counts (e.g., "Running Tasks (2)") reflect only non-chat tasks
- [ ] Empty state ("No tasks in queue") appears when the only tasks are chat-type
- [ ] WebSocket live-updates are filtered identically to the initial HTTP fetch
- [ ] QueueContext stores unfiltered data — other consumers are unaffected
- [ ] No server-side changes required
- [ ] Existing queue tab tests continue to pass

## Dependencies

- Depends on: 001 (API type filter support, though this commit doesn't use it)
- Depends on: 002 (Chat tab exists to display the chat tasks excluded here)

## Assumed Prior State

- Commit 1 applied: API supports type filtering (available for future server-side use)
- Commit 2 applied: Chat sessions have their own dedicated UI in Chat tab
