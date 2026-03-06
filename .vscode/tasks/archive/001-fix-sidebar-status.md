---
status: pending
---

# 001: Fix chat sidebar status updates and chatMeta mapping

## Summary

Fix the chat sidebar so it shows 🔄 while a follow-up is streaming and ✅ when done, fix the chatMeta field mapping bug, and ensure queued items display correctly.

## Motivation

Three related issues in the chat sidebar:
1. **Follow-up status not reflected:** `sendFollowUp` never updates the sidebar status or refreshes after completion, so the icon stays ✅ during streaming.
2. **chatMeta mapping bug:** Backend enriches tasks with `task.chatMeta.firstMessage` and `task.chatMeta.turnCount`, but `toSessionItem` reads `task.firstMessage` / `task.turnCount` (top-level) — enrichment data is silently lost, falling back to `payload.prompt`.
3. **Queued items:** Backend already returns queued tasks and `statusIcon` maps `'queued'→⏳`, but we should verify the mapping handles missing `chatMeta`/`processId` gracefully.

## Changes

### Files to Modify

- `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts`
  - Fix `toSessionItem` to read `task.chatMeta?.firstMessage` and `task.chatMeta?.turnCount` with existing fallbacks
  - Add `updateSessionStatus(taskId: string, status: string)` method that updates a session's status in local state
  - Export it from `UseChatSessionsResult`

- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`
  - In `sendFollowUp`, after the POST succeeds: call `sessionsHook.updateSessionStatus(chatTaskId, 'running')` to optimistically show 🔄
  - After `waitForFollowUpCompletion` resolves: call `sessionsHook.refresh()` to sync real status from server
  - Both calls should be inside the try block at the appropriate points

## Implementation Notes

### useChatSessions.ts — `toSessionItem` fix

Current (broken):
```ts
firstMessage: task.firstMessage ?? task.payload?.prompt ?? '',
turnCount: task.turnCount,
```

Fixed:
```ts
firstMessage: task.chatMeta?.firstMessage ?? task.firstMessage ?? task.payload?.prompt ?? '',
turnCount: task.chatMeta?.turnCount ?? task.turnCount,
```

### useChatSessions.ts — `updateSessionStatus`

```ts
const updateSessionStatus = useCallback((taskId: string, status: string) => {
    setSessions(prev => prev.map(s => s.id === taskId ? { ...s, status } : s));
}, []);
```

Add to the return object: `{ sessions, loading, error, refresh, prependSession, updateSessionStatus }`.

### RepoChatTab.tsx — `sendFollowUp` wiring

After the `response.ok` check succeeds (around line 340), before `waitForFollowUpCompletion`:
```ts
if (chatTaskId) sessionsHook.updateSessionStatus(chatTaskId, 'running');
```

After `waitForFollowUpCompletion` (around line 341), add:
```ts
sessionsHook.refresh();
```

### Queued items

Already supported end-to-end:
- Backend: `queue-handler.ts` lines 693-719 include queued+running tasks for `type=chat`
- Client: `toSessionItem` maps `status: task.status ?? 'unknown'` which preserves 'queued'
- UI: `statusIcon('queued')` → ⏳
- `handleStartChat` prepends with `status: body.task?.status ?? 'queued'` and calls refresh
- With the `chatMeta` fix, queued items without `processId` still get `firstMessage` from `task.payload?.prompt` fallback

No additional changes needed for queued item display.

## Tests

- `packages/coc/test/spa/react/useChatSessions.test.ts`:
  - Test `toSessionItem` reads `chatMeta.firstMessage` and `chatMeta.turnCount`
  - Test `toSessionItem` falls back to `payload.prompt` when `chatMeta` is missing (queued items)
  - Test `updateSessionStatus` updates the correct session in state

- `packages/coc/test/spa/react/RepoChatTab.test.ts`:
  - Test that `sendFollowUp` calls `updateSessionStatus` with 'running'
  - Test that follow-up completion triggers `sessionsHook.refresh()`

## Acceptance Criteria

- [ ] Sidebar shows 🔄 while a follow-up response is streaming
- [ ] Sidebar returns to ✅ (or real status) after follow-up completes
- [ ] `chatMeta.firstMessage` and `chatMeta.turnCount` are correctly read from enriched tasks
- [ ] Queued items (no processId/chatMeta) display with ⏳ and show prompt as firstMessage
- [ ] Existing tests pass; new tests cover the changes
- [ ] Build succeeds (`npm run build`)

## Dependencies

- Depends on: None
