# Fix: AI-Generated Chat Title Not Wired to UI

## Problem

In CoC's chat tab, `generateTitleIfNeeded()` in the backend successfully generates an AI-summarized title and persists it via `store.updateProcess(processId, { title })`. The queue-handler API correctly exposes this title in `chatMeta.title`. However, the title **never reaches the UI** — the sidebar always shows `firstMessage` instead.

## Root Cause Analysis

There is a **3-layer disconnect** between backend title generation and frontend rendering:

| Layer | File | Line(s) | Status | Problem |
|-------|------|---------|--------|---------|
| Backend | `packages/coc/src/server/queue-executor-bridge.ts` | 379–404 | ✅ Works | `generateTitleIfNeeded()` generates title, saves via `store.updateProcess()` |
| API | `packages/coc/src/server/queue-handler.ts` | 313 | ✅ Works | `chatMeta.title = process.title` exposed in API response |
| Type | `packages/coc/src/server/spa/client/react/types/dashboard.ts` | 57–66 | ❌ Missing | `ChatSessionItem` has no `title` field |
| Mapping | `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` | 23–39 | ❌ Drops | `toSessionItem()` never reads `task.chatMeta?.title` |
| Render | `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | 148–152 | ❌ Hardcoded | Always renders `session.firstMessage`, never checks for title |
| Refresh | `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | 536–543 | ❌ Timing | `refresh()` fires immediately after send, before async title generation completes (~3–5s) |

**Additional issue:** No WebSocket/SSE event exists to push title updates to the client. The only way the frontend can learn about the new title is by re-fetching the session list.

## Proposed Approach

### Fix 1: Add `title` to `ChatSessionItem` type
**File:** `packages/coc/src/server/spa/client/react/types/dashboard.ts` line 66

Add `title?: string;` to the `ChatSessionItem` interface, after `firstMessage`.

### Fix 2: Map `title` from `chatMeta` in `toSessionItem()`
**File:** `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` line 38

Add `title: task.chatMeta?.title,` to the return object in `toSessionItem()`.

### Fix 3: Render `title` with fallback to `firstMessage` in sidebar
**File:** `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` line 148–152

Replace:
```tsx
{session.firstMessage.length > 60
    ? session.firstMessage.slice(0, 60) + '…'
    : session.firstMessage || 'Chat session'}
```
With:
```tsx
{(session.title || session.firstMessage).length > 60
    ? (session.title || session.firstMessage).slice(0, 60) + '…'
    : session.title || session.firstMessage || 'Chat session'}
```

### Fix 4: Delayed re-fetch to pick up async title
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` ~line 543

After the immediate `sessionsHook.refresh()` on line 543, add a delayed refresh:
```ts
setTimeout(() => sessionsHook.refresh(), 5000);
```

This gives the async `generateTitleIfNeeded()` time to complete and persist the title. A more robust approach would be a WebSocket push event, but the delayed refresh is the minimal fix.

### Fix 5 (optional enhancement): Add `updateSessionTitle` to `useChatSessions`
**File:** `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts`

Add a helper method to optimistically update a session's title in local state:
```ts
const updateSessionTitle = useCallback((taskId: string, title: string) => {
    setSessions(prev => prev.map(s => s.id === taskId ? { ...s, title } : s));
}, []);
```
Expose in the return object. This allows future WebSocket-based title pushes without requiring a full re-fetch.

## Testing Plan

### Test 1: `toSessionItem` maps title from chatMeta
**File:** `packages/coc/test/server/chat-title-wiring.test.ts` (new)

- Mock a task object with `chatMeta.title` set → verify `toSessionItem()` returns it in `.title`
- Mock a task object without `chatMeta.title` → verify `.title` is `undefined`
- Verify `firstMessage` is still correctly mapped independently of title

### Test 2: ChatSessionSidebar renders title when available
**File:** `packages/coc/test/server/chat-title-wiring.test.ts`

Using mock/rendering approach (consistent with existing test patterns using `vi.fn()`):

- Render sidebar item with `{ title: 'AI Summary', firstMessage: 'long original prompt...' }` → verify displayed text is "AI Summary"
- Render sidebar item with `{ title: undefined, firstMessage: 'original prompt' }` → verify displayed text is "original prompt"
- Render sidebar item with `{ title: '', firstMessage: 'original prompt' }` → verify fallback to "original prompt"
- Render sidebar item with long title (>60 chars) → verify truncation with `…`

### Test 3: End-to-end title flow with mock AI
**File:** `packages/coc/test/server/chat-title-e2e.test.ts` (new)

This test validates the full chain: generate → persist → API → frontend mapping.

1. **Setup:**
   - Create mock `ProcessStore` using existing `createMockProcessStore()` from `test/helpers/mock-process-store.ts`
   - Create mock `aiService` with a `transform()` that returns a deterministic title string
   - Create a `CLITaskExecutor` instance (or directly test `generateTitleIfNeeded` if made testable)

2. **Flow:**
   - Insert a process with no title
   - Call `generateTitleIfNeeded(processId, [{ role: 'user', content: 'How do I configure webpack for multiple entry points?' }])`
   - Wait for the async fire-and-forget to complete (`await vi.waitFor(...)` or `flushPromises()`)
   - Verify `store.updateProcess` was called with `{ title: <expected> }`
   - Simulate the queue-handler API: build `chatMeta` from the updated process → verify `chatMeta.title` matches
   - Pass through `toSessionItem()` → verify `.title` is propagated

3. **Edge cases:**
   - Process already has a title → `transform()` should NOT be called (idempotent guard)
   - AI returns empty string → title should not be set
   - AI throws → title should remain unset, no crash
   - First user message is empty → `generateTitleIfNeeded` returns early

### Test 4: useChatSessions refresh picks up title
**File:** `packages/coc/test/server/chat-title-wiring.test.ts`

- Mock `fetchApi` to return history with `chatMeta.title` on second call but not first
- Call `refresh()` → verify sessions are updated with the new title
- Verify `prependSession` without title, then `refresh` with title → session now has title

### Test 5: Delayed refresh timing in RepoChatTab
**File:** `packages/coc/test/server/chat-title-wiring.test.ts`

- After sending a message, verify that `refresh()` is called twice: once immediately, once after ~5s delay
- Use `vi.useFakeTimers()` / `vi.advanceTimersByTime(5000)` to control timing

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/coc/src/server/spa/client/react/types/dashboard.ts` | Edit | Add `title?: string` to `ChatSessionItem` |
| `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` | Edit | Map `title` in `toSessionItem()`, add `updateSessionTitle` |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Edit | Render `title \|\| firstMessage` |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Edit | Add delayed `refresh()` after send |
| `packages/coc/test/server/chat-title-wiring.test.ts` | Create | Unit tests for mapping, rendering, refresh |
| `packages/coc/test/server/chat-title-e2e.test.ts` | Create | End-to-end mock AI title flow test |

## Notes

- No backend changes needed — `generateTitleIfNeeded()` and the API response are already correct.
- The delayed refresh is a pragmatic minimal fix. A future enhancement could add a WebSocket event (`titleUpdated`) from the server after `store.updateProcess()` completes, which would enable instant title updates without polling.
- All test files follow existing Vitest patterns in `packages/coc/test/server/`. Mocking uses `vi.fn()` injection, consistent with `mock-process-store.ts`.
