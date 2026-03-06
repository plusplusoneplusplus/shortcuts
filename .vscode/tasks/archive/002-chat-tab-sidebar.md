---
status: pending
---

# 002: Chat Tab — Add Sidebar with Session History

## Summary

Refactor `RepoChatTab` from a single-conversation view into a split-panel layout with a left sidebar listing past chat sessions (fetched from `GET /api/queue/history?type=chat&repoId=...`) and a right panel showing the active conversation, replacing the localStorage single-taskId approach with explicit session selection.

## Motivation

The Chat tab currently tracks only one chat session per workspace via a localStorage key (`coc-chat-task-${workspaceId}`). Users cannot browse or revisit previous chats. This commit adds the sidebar chrome and session switching logic as a self-contained unit, cleanly separated from the server-side history endpoint (Commit 1) and future enhancements (Commits 3–4).

## Changes

### Files to Create

- `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` — New component rendering the left sidebar panel. Responsibilities:
  - Fetch chat history via `fetchApi('/queue/history?type=chat&repoId=...')`
  - Render each session as a `<Card>` with: status icon (`statusIcon()`), first-message preview (truncated to ~60 chars from `payload.prompt`), turn count (from enriched history or fallback "—"), relative timestamp (`formatRelativeTime(createdAt)`)
  - Highlight active session with `ring-2 ring-[#0078d4]` (same pattern as `RepoQueueTab`)
  - "New Chat" `<Button variant="primary" size="sm">` at top
  - Empty state: centered "No previous chats" message with a prompt to start one
  - Accept props: `workspaceId`, `sessions`, `activeTaskId`, `onSelectSession(taskId)`, `onNewChat()`, `loading`

- `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` — Custom hook encapsulating session-list state. Responsibilities:
  - Fetch history on mount and expose `sessions`, `loading`, `error`
  - Expose `refresh()` function for manual re-fetch (called after new chat creation)
  - Auto-refresh: re-fetch when `workspaceId` changes
  - Return type: `{ sessions: ChatSessionItem[], loading: boolean, error: string | null, refresh: () => void }`

### Files to Modify

- `packages/coc/src/server/spa/client/react/types/dashboard.ts` — Add new types:
  ```ts
  /** Summary of a chat session for sidebar display */
  export interface ChatSessionItem {
      id: string;            // queue task ID
      processId?: string;    // linked process ID (for fetching conversation)
      status: string;        // 'running' | 'completed' | 'failed' | 'cancelled'
      createdAt: string;     // ISO timestamp
      completedAt?: string;  // ISO timestamp
      firstMessage: string;  // first user prompt (for preview, may be truncated by server)
      turnCount?: number;    // number of conversation turns (from enriched history)
  }
  ```

- `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — Major refactor:
  1. **Wrap in split-panel layout**: Replace root `<div>` with a flex row container (`flex h-full overflow-hidden`) mirroring `RepoQueueTab`.
     - Left: `<ChatSessionSidebar>` at `w-80 flex-shrink-0 border-r` 
     - Right: existing conversation UI in `flex-1 min-w-0`
  2. **Replace localStorage single-taskId with session selection state**:
     - Remove `STORAGE_KEY` / `localStorage.getItem/setItem/removeItem` calls
     - Add `selectedTaskId` state (initialized to `null`)
     - On mount: fetch history via `useChatSessions`, auto-select the most recent running/incomplete session (if any)
     - On sidebar click: set `selectedTaskId`, fetch task → process → conversation turns (reuse existing restore logic)
  3. **Wire "New Chat" button**:
     - `onNewChat` callback: clear `selectedTaskId`, `turns`, `task`, `sessionExpired` → show start-chat screen in right panel
     - After `handleStartChat` succeeds: set `selectedTaskId` to new task ID, call `sessionsHook.refresh()` to update sidebar
  4. **Wire session loading**:
     - Extract existing mount-restore logic (fetch `/queue/${id}` → `/processes/${processId}`) into a `loadSession(taskId)` function
     - Call `loadSession` both on mount (for auto-select) and on sidebar click
  5. **Preserve all existing functionality**: image paste (`useImagePaste` × 2), streaming SSE, follow-up messages, session expiry (410), stop streaming button — these remain untouched in the right panel
  6. **Sidebar auto-refresh after new chat**: After `handleStartChat` completes, call `sessionsHook.refresh()`

### Files to Delete

- (none)

## Implementation Notes

### Layout Pattern (matching RepoQueueTab)
```tsx
<div className="flex h-full overflow-hidden" data-testid="chat-split-panel">
  {/* Left sidebar — fixed width */}
  <ChatSessionSidebar
    className="w-80 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c]"
    workspaceId={workspaceId}
    sessions={sessionsHook.sessions}
    activeTaskId={selectedTaskId}
    onSelectSession={handleSelectSession}
    onNewChat={handleNewChat}
    loading={sessionsHook.loading}
  />
  {/* Right panel — grows to fill */}
  <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
    {/* Existing conversation UI (start screen or active chat) */}
  </div>
</div>
```

### Session Selection Logic
- On mount: fetch history → if sessions exist, auto-select the first `running` session; else auto-select the most recent session; else show "New Chat" start screen.
- `handleSelectSession(taskId)`: set `selectedTaskId`, call `loadSession(taskId)`. If session was previously loaded and cached in `conversationCache`, use cache; otherwise fetch fresh.
- `handleNewChat()`: reset `selectedTaskId` to `null`, clear `turns`/`task`/`error`/`sessionExpired` → right panel shows start-chat textarea.

### Loading a Session (`loadSession`)
Extracted from the existing mount `useEffect`:
```ts
async function loadSession(taskId: string) {
    setLoading(true);
    setError(null);
    setSessionExpired(false);
    try {
        const queueData = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
        const task = queueData?.task;
        setTask(task);
        setChatTaskId(taskId);
        if (task?.processId) {
            const procData = await fetchApi(`/processes/${encodeURIComponent(task.processId)}`);
            setTurnsAndCache(getConversationTurns(procData));
        }
    } catch (err: any) {
        if (err.message?.includes('404')) {
            // Session no longer exists — remove from sidebar on next refresh
            setError('Chat session not found');
        } else {
            setError(err.message || 'Failed to load chat');
        }
    } finally {
        setLoading(false);
    }
}
```

### localStorage Migration
- **Remove**: All `localStorage.getItem/setItem/removeItem(STORAGE_KEY)` calls.
- **Replace with**: `selectedTaskId` state + sidebar-driven selection. No persistence needed — the sidebar fetches history from server on every mount.
- **Backward compat**: Not required (per project rules). Old localStorage keys are simply ignored.

### Sidebar Session Card Layout
Each session card in the sidebar:
```
┌──────────────────────────────┐
│ 🔄  What is the auth flow... │  ← status icon + truncated first message
│ 4 turns · 2 hours ago       │  ← turn count + relative time
└──────────────────────────────┘
```
- Use `<Card onClick={...}>` with conditional `ring-2 ring-[#0078d4]` for active state
- First message: `session.firstMessage.slice(0, 60)` + ellipsis if truncated
- Turn count: `session.turnCount ?? '—'` + " turns"
- Relative time: `formatRelativeTime(session.createdAt)`
- Status icon: `statusIcon(session.status)`

### Reuse Existing Utilities
- `statusIcon()`, `formatRelativeTime()` from `utils/format`
- `fetchApi()` from `hooks/useApi`
- `Card`, `Button`, `Spinner`, `Badge` from `shared`
- `cn()` for conditional class merging
- `getConversationTurns()` helper already in `RepoChatTab.tsx` (move to a shared location or keep in-file)

### Edge Cases
- **Session 404**: If `loadSession` gets a 404, show error in right panel and refresh sidebar to remove stale entry.
- **Session expiry mid-conversation**: Existing 410 handling remains; sidebar still shows the session but follow-up is disabled.
- **Empty workspace**: No sessions → sidebar shows empty state; right panel shows start-chat screen.
- **Streaming in progress**: If user clicks a different session while streaming, call `stopStreaming()` before loading the new session.

## Tests

- **ChatSessionSidebar rendering**: Renders session list with correct preview text, turn count, timestamps, and status icons
- **ChatSessionSidebar empty state**: Shows "No previous chats" when sessions array is empty
- **ChatSessionSidebar active highlight**: Active session has `ring-2` class, others do not
- **ChatSessionSidebar new chat button**: Calls `onNewChat` callback when clicked
- **useChatSessions hook**: Fetches `/queue/history?type=chat&repoId=...` on mount, returns sessions sorted by `createdAt` desc
- **useChatSessions refresh**: Calling `refresh()` re-fetches and updates session list
- **RepoChatTab split layout**: Root element has `flex h-full` layout with sidebar and main panel children
- **RepoChatTab session selection**: Clicking a sidebar session calls `loadSession` and renders conversation in right panel
- **RepoChatTab new chat flow**: "New Chat" resets right panel to start screen; after sending first message, sidebar refreshes and new session appears
- **RepoChatTab no localStorage**: Verify no `localStorage.getItem/setItem/removeItem` calls remain
- **RepoChatTab streaming switch**: Switching sessions while streaming stops the current EventSource before loading new session

## Acceptance Criteria

- [ ] Chat tab renders a split-panel layout: fixed-width sidebar (left) + conversation panel (right)
- [ ] Sidebar fetches and displays chat session history from `GET /api/queue/history?type=chat&repoId=...`
- [ ] Each sidebar item shows status icon, first-message preview (≤60 chars), turn count, and relative timestamp
- [ ] Clicking a session loads its conversation in the right panel
- [ ] Active session is visually highlighted in the sidebar (`ring-2` blue border)
- [ ] "New Chat" button resets the right panel to the start-chat screen
- [ ] After starting a new chat, the sidebar auto-refreshes and shows the new session
- [ ] localStorage-based session tracking is fully removed
- [ ] All existing Chat tab functionality is preserved: image paste, streaming, follow-ups, session expiry, stop button
- [ ] Switching sessions while streaming stops the current stream first
- [ ] Empty state is handled: sidebar shows "No previous chats" message
- [ ] All new and existing tests pass

## Dependencies

- Depends on: 001 (server returns chat-filtered history with `firstMessage` and `turnCount` fields)

## Assumed Prior State

Server now supports `GET /api/queue/history?type=chat&repoId=...` returning chat session summaries with first message preview and turn count. Each history item includes at minimum: `id`, `processId`, `status`, `createdAt`, `completedAt`, `payload.prompt` (or enriched `firstMessage`), and `turnCount`.
