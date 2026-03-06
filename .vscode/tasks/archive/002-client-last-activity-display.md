---
status: pending
---

# 002: Client-side `lastActivityAt` type, mapping, and display

## Summary
Add `lastActivityAt` to the `ChatSessionItem` type, map it in `toSessionItem()`, and update `ChatSessionSidebar` to display the relative time using `lastActivityAt` instead of `createdAt`.

## Motivation
Commit 001 adds `lastActivityAt` to the server response. The client needs to consume it so the sidebar shows "2 min ago" based on last activity, not creation time. This makes the time display consistent with the new sort order.

## Changes

### Files to Modify
- `packages/coc/src/server/spa/client/react/types/dashboard.ts` — Add `lastActivityAt?: string` to `ChatSessionItem` (ISO string, optional for backward compat)

Current ChatSessionItem (lines 57-65):
```typescript
export interface ChatSessionItem {
    id: string;
    processId?: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    firstMessage: string;
    turnCount?: number;
}
```

- `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` — In `toSessionItem()`, map `task.chatMeta?.lastActivityAt` to ISO string, falling back to `completedAt` then `createdAt`

Current toSessionItem (lines 23-37):
```typescript
function toSessionItem(task: any): ChatSessionItem {
    return {
        id: task.id,
        processId: task.processId,
        status: task.status ?? 'unknown',
        createdAt: typeof task.createdAt === 'number'
            ? new Date(task.createdAt).toISOString()
            : (task.createdAt ?? ''),
        completedAt: typeof task.completedAt === 'number'
            ? new Date(task.completedAt).toISOString()
            : task.completedAt,
        firstMessage: task.chatMeta?.firstMessage || task.firstMessage || task.payload?.prompt || '',
        turnCount: task.chatMeta?.turnCount ?? task.turnCount,
    };
}
```

- `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` — Change line 102 from `formatRelativeTime(session.createdAt)` to `formatRelativeTime(session.lastActivityAt || session.createdAt)` so the time display reflects last activity

Current line 102:
```typescript
<span>{formatRelativeTime(session.createdAt)}</span>
```

## Implementation Notes
- `lastActivityAt` is optional to maintain backward compatibility if the server hasn't been updated yet
- The ISO conversion follows the same pattern already used for `createdAt` and `completedAt` in `toSessionItem`
- The sidebar fallback `session.lastActivityAt || session.createdAt` ensures graceful degradation

## Tests
- Update `packages/coc/test/spa/react/useChatSessions.test.ts`: verify `toSessionItem` maps `chatMeta.lastActivityAt` correctly, and falls back to `createdAt` when absent
- Update `packages/coc/test/spa/react/ChatSessionSidebar.test.ts`: verify the sidebar renders `lastActivityAt` as relative time when present

## Acceptance Criteria
- [x] `ChatSessionItem` has optional `lastActivityAt: string` field
- [x] `toSessionItem` maps `chatMeta.lastActivityAt` (numeric epoch) → ISO string
- [x] `ChatSessionSidebar` displays `lastActivityAt` as relative time, falling back to `createdAt`
- [x] Existing tests still pass
- [x] New/updated tests verify the mapping and display

## Dependencies
- Depends on: 001 (server provides `chatMeta.lastActivityAt`)

## Assumed Prior State
Commit 001 is applied: `enrichChatTasks` now includes `lastActivityAt` in `chatMeta`, and `/api/queue/history?type=chat` sorts by it.
