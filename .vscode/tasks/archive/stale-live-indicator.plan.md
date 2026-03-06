# Fix Stale "Live" Indicator on Completed Tasks

## Problem

When a task completes in the CoC dashboard, the sidebar and header badge correctly show "✅ Completed", but the conversation content area still displays the red **"Live"** streaming indicator on assistant turns. Clicking the task in the sidebar does not refresh the content. Only a full page refresh (F5) resolves it.

## Root Cause

Three compounding issues in the SPA frontend:

1. **`turn.streaming` is never cleared on completion** — `ConversationTurnBubble.tsx:663` renders "Live" when `turn.streaming === true`. Turns arrive via SSE `chunk` events with `streaming: true`, but nothing ever sets it to `false` when the process completes.

2. **`ProcessDetail` doesn't re-fetch on status change** — The data-fetch `useEffect` depends only on `[selectedId, dispatch]` (`ProcessDetail.tsx:127`). When WebSocket fires `process-updated` with `status: 'completed'`, the effect doesn't re-run, so clean turns from the REST endpoint are never loaded.

3. **No `done` SSE event listener** — The server sends a `done` event on completion (`sse-handler.ts:131-138`), but `ProcessDetail.tsx` has no listener for it.

4. **`INVALIDATE_CONVERSATION` is never dispatched** — The action and reducer case exist in `AppContext.tsx` but nothing invokes it on completion, so the 60-minute conversation cache serves stale turns with `streaming: true`.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx` | SSE consumer, data fetch, turn state |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Renders "Live" badge on `turn.streaming` |
| `packages/coc/src/server/spa/client/react/context/AppContext.tsx` | Global state, `INVALIDATE_CONVERSATION` action |
| `packages/coc/src/server/spa/client/react/App.tsx` | WebSocket message handler |
| `packages/coc-server/src/sse-handler.ts` | Server-side SSE stream management |

## Acceptance Criteria

- [ ] When a task completes, the "Live" indicator disappears without requiring F5
- [ ] Clicking a completed task in the sidebar shows the final content (no stale streaming state)
- [ ] Conversation cache is invalidated when a process transitions to a terminal status
- [ ] No regression: streaming "Live" indicator still appears correctly during active streaming
- [ ] Works for all terminal statuses: `completed`, `failed`, `cancelled`

## Subtasks

### 1. Clear streaming flags on SSE `status`/`done` events
In `ProcessDetail.tsx`, inside the existing `status` SSE event handler (and add a `done` listener), clear `streaming` on all local turns:
```ts
setTurns(prev => prev.map(t => t.streaming ? { ...t, streaming: false } : t));
```

### 2. Invalidate conversation cache on completion
In `App.tsx` WebSocket `onMessage`, when `process-updated` arrives with a terminal status (`completed`/`failed`/`cancelled`), dispatch:
```ts
dispatch({ type: 'INVALIDATE_CONVERSATION', processId: msg.process.id });
```

### 3. Re-fetch on status change
In `ProcessDetail.tsx`, add `process?.status` to the data-fetch `useEffect` dependency array so the detail view re-fetches clean data when status changes:
```ts
}, [selectedId, process?.status, dispatch]);
```

### 4. Add tests
- Unit test: verify `INVALIDATE_CONVERSATION` is dispatched on terminal WebSocket events
- Unit test: verify `setTurns` clears streaming flags on SSE `done` event
- Integration test: verify clicking a completed task shows non-streaming content

## Notes

- The sidebar badge updates correctly because it reads `process.status` from context (updated via WebSocket). The bug is isolated to the detail panel's local `turns` state.
- Fix #1 (clear streaming flags) is the most impactful single change. Fixes #2 and #3 provide defense-in-depth.
- The `INVALIDATE_CONVERSATION` action and reducer already exist — they just need to be wired up.
