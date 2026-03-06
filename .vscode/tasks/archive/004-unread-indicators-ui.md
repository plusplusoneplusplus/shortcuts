---
status: pending
---

# 004: Unread indicators UI and integration

## Summary
Add blue dot + bold styling to `ChatSessionSidebar` for unread sessions, wire `useChatReadState` into `RepoChatTab` to mark sessions as read on selection, and update the sidebar to live-reflect unread state.

## Motivation
This is the user-facing commit that ties everything together. Users will see a blue dot (●) and bold title on conversations with new turns they haven't seen, matching the Slack/Discord/iMessage pattern.

## Changes

### Files to Modify

1. `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx`:
   - Add `isUnread?: (sessionId: string, turnCount?: number) => boolean` to `ChatSessionSidebarProps`
   - In `renderCard`, conditionally apply:
     - Blue dot `●` (8px, color `#3794ff`) before the first-message text when `isUnread(session.id, session.turnCount)` is true
     - `font-semibold` on the first-message text for unread sessions (vs current normal weight)
   - The dot should replace/precede the status icon position for unread items, or appear as an additional indicator

Current renderCard first-message line (lines 85-89):
```tsx
<span className="truncate">
    {session.firstMessage.length > 60
        ? session.firstMessage.slice(0, 60) + '…'
        : session.firstMessage || 'Chat session'}
</span>
```

Current props interface (lines 16-27):
```typescript
export interface ChatSessionSidebarProps {
    className?: string;
    workspaceId: string;
    sessions: ChatSessionItem[];
    activeTaskId: string | null;
    onSelectSession: (taskId: string) => void;
    onNewChat: () => void;
    onCancelSession?: (taskId: string) => void;
    loading: boolean;
    pinnedIds?: string[];
    onTogglePin?: (taskId: string) => void;
}
```

2. `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`:
   - Import and call `useChatReadState(workspaceId)`
   - Pass `readState.isUnread` to `ChatSessionSidebar` as the new `isUnread` prop
   - In `handleSelectSession` callback, call `readState.markRead(taskId, session.turnCount)` — look up the session's turnCount from `sessionsHook.sessions` to pass the current count
   - Also call `markRead` when SSE streaming completes for the active session (the turn count may have increased)

RepoChatTab passes sessions to sidebar (lines 853-862):
```tsx
<ChatSessionSidebar
    className="w-80 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c]"
    workspaceId={workspaceId}
    sessions={sessionsHook.sessions}
    activeTaskId={selectedTaskId}
    onSelectSession={handleSelectSession}
    onNewChat={handleNewChat}
    onCancelSession={(taskId) => void handleCancelChat(taskId)}
    loading={sessionsHook.loading}
/>
```

## Implementation Notes
- The unread dot should be a `<span>` with `className="w-2 h-2 rounded-full bg-[#3794ff] flex-shrink-0"` — a small filled circle
- For unread sessions: dot visible + text `font-semibold`. For read sessions: dot hidden/absent + text normal weight.
- The dot appears in the same row as the status icon / first message, before the text
- Don't show unread dot for sessions that are currently active (activeTaskId === session.id) — the user is already looking at it
- When streaming completes (`done` SSE event), also mark read with the updated turn count
- The `isUnread` prop is optional to maintain backward compatibility

## Tests
- Update `packages/coc/test/spa/react/ChatSessionSidebar.test.ts`:
  - Test: unread session renders blue dot and semibold text
  - Test: read session does NOT render blue dot
  - Test: active session does NOT render blue dot even if unread
  - Test: sidebar works without `isUnread` prop (backward compat)
- Update `packages/coc/test/spa/react/RepoChatTab.test.ts` or `packages/coc/test/spa/react/repos/RepoChatTab-newChatTrigger.test.tsx`:
  - Test: selecting a session calls markRead
  - Test: useChatReadState is wired to sidebar's isUnread prop

## Acceptance Criteria
- [ ] Unread sessions show blue dot (●) and bold first-message text
- [ ] Read sessions show normal styling (no dot, normal weight)
- [ ] Active session never shows unread dot
- [ ] Selecting a session marks it as read
- [ ] SSE completion marks active session as read with updated turn count
- [ ] Sidebar works without `isUnread` prop (backward compat)
- [ ] All existing tests still pass
- [ ] New tests cover unread indicator rendering and mark-as-read integration

## Dependencies
- Depends on: 002 (ChatSessionItem has lastActivityAt for display), 003 (useChatReadState hook exists)

## Assumed Prior State
- Commit 001: Server sorts by lastActivityAt
- Commit 002: Client has lastActivityAt type/mapping/display
- Commit 003: `useChatReadState` hook exists with `isUnread`, `markRead`, `unreadCount`
