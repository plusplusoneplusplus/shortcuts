---
status: pending
---

# 003: `useChatReadState` localStorage hook

## Summary
Create a new React hook `useChatReadState` that tracks which chat sessions have unread messages using browser localStorage. Exposes `isUnread()`, `markRead()`, and `unreadCount()` functions.

## Motivation
This is a standalone, independently testable hook with no UI coupling. It provides the data layer for unread indicators (Commit 004) and can be developed in parallel with Commits 001-002.

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/react/chat/useChatReadState.ts` — New hook

### Hook API Design:
```typescript
export interface UseChatReadStateResult {
    /** Whether a session has unread turns (turnCount > lastSeenTurnCount). */
    isUnread: (sessionId: string, currentTurnCount?: number) => boolean;
    /** Mark a session as read at its current turn count. */
    markRead: (sessionId: string, turnCount: number) => void;
    /** Count of unread sessions from a list. */
    unreadCount: (sessions: ChatSessionItem[]) => number;
}

export function useChatReadState(workspaceId: string): UseChatReadStateResult;
```

### localStorage Data Shape:
```json
{
  "coc:chatReadState": {
    "<workspaceId>": {
      "<sessionId>": {
        "lastSeenTurnCount": 5
      }
    }
  }
}
```

## Implementation Notes
- Use `coc:chatReadState` as the localStorage key (namespaced to avoid collisions)
- On mount, read the full state from localStorage and extract the workspace slice
- `isUnread(sessionId, turnCount)`: returns `true` if `turnCount > lastSeenTurnCount` (or if no entry exists AND turnCount > 0). If turnCount is undefined/null, return false (no data to compare).
- `markRead(sessionId, turnCount)`: updates `lastSeenTurnCount` in state and persists to localStorage
- `unreadCount(sessions)`: counts sessions where `isUnread(s.id, s.turnCount)` is true
- First visit (no localStorage entry): all sessions appear as READ (no dots). This avoids a flood of dots on first use — only new activity after first visit triggers unread.
- Handle localStorage errors gracefully (e.g., storage full, private browsing) — fall back to in-memory state
- Follow the same patterns as `usePinnedChats.ts` (the existing hook that uses preferences API for persistence):

Current usePinnedChats pattern (for reference):
```typescript
export function usePinnedChats(workspaceId: string): UsePinnedChatsResult {
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const allPinnedRef = useRef<Record<string, string[]>>({});
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        // ... fetch from preferences API
        return () => { mountedRef.current = false; };
    }, [workspaceId]);
    // ...
}
```

The new hook follows a similar structure but reads from localStorage instead of the preferences API.

## Tests

### Files to Create
- `packages/coc/test/spa/react/useChatReadState.test.ts` — Full test suite

### Test Cases:
- `isUnread` returns false when no localStorage entry exists (first visit)
- `isUnread` returns true when turnCount > lastSeenTurnCount
- `isUnread` returns false when turnCount <= lastSeenTurnCount
- `isUnread` returns false when turnCount is undefined
- `markRead` updates localStorage and subsequent `isUnread` returns false
- `unreadCount` correctly counts unread sessions from a list
- Hook handles localStorage errors gracefully (falls back to in-memory)
- Multiple workspaces are isolated from each other
- Cleanup: stale session entries don't cause errors

## Acceptance Criteria
- [ ] `useChatReadState` hook created with `isUnread`, `markRead`, `unreadCount`
- [ ] State persisted to localStorage under `coc:chatReadState`
- [ ] First visit = all sessions read (no false unread flood)
- [ ] localStorage errors handled gracefully
- [ ] Full test coverage

## Dependencies
- Depends on: None (can be developed in parallel with 001-002)

## Assumed Prior State
None — this hook is independent. It uses `ChatSessionItem` type from `dashboard.ts` which already exists with `turnCount` field.
