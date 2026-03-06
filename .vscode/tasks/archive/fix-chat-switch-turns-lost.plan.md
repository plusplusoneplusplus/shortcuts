# Fix: Chat turns lost when switching sessions and switching back

## Problem

In the SPA chat tab (`RepoChatTab.tsx`), when a user:
1. Has an active/streaming chat (follow-up in progress)
2. Clicks on a different chat session in the sidebar
3. Clicks back to the original in-progress session

...the **earlier conversation turns are not rendered**. Only the latest user message (or nothing) appears.

## Root Cause Analysis

Five interrelated bugs in `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`:

### Bug 1 (Critical): `waitForFollowUpCompletion` finish callback overwrites wrong session

When the user navigates away during streaming, `stopStreaming()` closes the EventSource. This triggers `es.onerror` → `finish()` in `waitForFollowUpCompletion`, which **asynchronously** fetches the OLD process data and calls `setTurnsAndCache()` — overwriting the newly loaded session's turns with stale data from the previous session.

**Lines 97–123**: `finish()` has no guard against the session having changed.

### Bug 2 (High): `setTurns([])` doesn't sync `turnsRef`

`handleSelectSession` (line 235) calls `setTurns([])` instead of `setTurnsAndCache([])`. This leaves `turnsRef.current` pointing at the previous session's turns. Any callback that reads `turnsRef` (e.g., `removeStreamingPlaceholder`, `sendFollowUp`) operates on stale data.

**Lines 235, 169, 246**: All use raw `setTurns([])`.

### Bug 3 (High): No abort guard in `loadSession`

`loadSession` is a plain `async/await` with no cancellation. Rapid session switching launches concurrent fetches. Whichever resolves last wins, potentially setting state for the wrong session.

**Lines 127–148**: No `AbortController` or request-id guard.

### Bug 4 (Medium): No streaming indicator when returning to a running chat

When `loadSession` loads a running chat, it restores the persisted turns (completed exchanges + pending user turn) but doesn't add a `streaming: true` assistant placeholder. The SSE effect then connects and waits for `done`/`status` — but the user sees no visual indicator that the AI is still generating. When the stream finishes, the final turns appear suddenly.

**Lines 190–224**: SSE effect doesn't listen for `chunk` events or inject a placeholder.

### Bug 5 (Low): `processId` missing from SSE effect deps

The SSE effect uses `processId` (line 197) but only declares `[chatTaskId, task?.status]` as dependencies (line 224). If `processId` changes without those deps changing, the effect uses a stale PID.

## Fix Plan

### Fix 1: Guard `waitForFollowUpCompletion` against session changes
- Add a `currentChatTaskIdRef` that tracks the active chat task ID
- Update it in `handleSelectSession`, `handleNewChat`, `handleStartChat`
- In `waitForFollowUpCompletion`'s `finish()`, check `currentChatTaskIdRef.current === chatTaskId` before calling `setTurnsAndCache`. If mismatched, skip the state update.

### Fix 2: Replace all `setTurns([])` with `setTurnsAndCache([])`
- `handleSelectSession` line 235
- Workspace reset effect line 169
- `handleNewChat` line 246

### Fix 3: Add load-session guard via request counter
- Add a `loadSessionCounterRef = useRef(0)`
- At the start of `loadSession`, increment the counter and capture the value
- Before each `set*` call inside `loadSession`, check if the captured value still matches the ref. If not, bail out (a newer load has started).

### Fix 4: Add streaming placeholder for running chats in `loadSession`
- After `setTurnsAndCache(getConversationTurns(procData))`, check if the loaded task is still `running`
- If so, append a `{ role: 'assistant', content: '', streaming: true }` placeholder
- The SSE effect's `finish()` will replace it with actual content when done

### Fix 5: Add `processId` to SSE effect dependency array
- Change `[chatTaskId, task?.status]` → `[chatTaskId, task?.status, processId]`

## Implementation Order

1. Fix 2 — trivial, one-liner replacements (prerequisite for others)
2. Fix 1 — add ref + guard in finish callback
3. Fix 3 — add counter guard in loadSession
4. Fix 4 — append streaming placeholder for running chats
5. Fix 5 — add dep to SSE effect

## Testing

- Manual: Start chat → send follow-up → click history → click back → verify all turns visible
- Manual: Rapid-click between 3+ sessions → verify no stale data
- Unit: Mock `fetchApi` with delayed responses, verify guard prevents stale writes
- Existing tests in `packages/coc/src/server/spa/client/react/repos/RepoChatTab.test.tsx` should still pass

## Files Changed

- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` (all fixes)
