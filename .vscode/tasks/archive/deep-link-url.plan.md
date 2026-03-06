# Chat Deep Link in URL

## Problem

Currently, when a user selects a chat conversation in the CoC SPA dashboard, the URL stays at `#repos/{repoId}/chat` with no indication of which chat is active. This means:

- Users cannot share or bookmark a specific chat conversation
- Browser back/forward doesn't restore the selected chat
- Refreshing the page loses the selected conversation (falls back to auto-select)

## Proposed Approach

Add a chat session ID segment to the URL: `#repos/{repoId}/chat/{taskId}`

This follows the **exact same pattern** already used for pipelines (`#repos/{repoId}/pipelines/{name}`) and queue tasks (`#repos/{repoId}/queue/{taskId}`).

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/context/AppContext.tsx` | Add `selectedChatSessionId` to state + new action |
| `packages/coc/src/server/spa/client/react/layout/Router.tsx` | Parse `chat/{taskId}` from hash, dispatch action |
| `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` | Pass `initialSessionId` prop to `RepoChatTab` |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Accept `initialSessionId`, update URL on session select/new-chat |
| Tests | Add test coverage for the new deep link parsing and session selection |

## Tasks

### 1. Add `selectedChatSessionId` to AppContext

**File:** `AppContext.tsx`

- Add `selectedChatSessionId: string | null` to `AppContextState` (default `null`)
- Add action type: `{ type: 'SET_SELECTED_CHAT_SESSION'; id: string | null }`
- Add reducer case: `return { ...state, selectedChatSessionId: action.id }`
- Mirror the existing `SET_SELECTED_PIPELINE` / `selectedPipelineName` pattern

### 2. Parse chat deep link in Router

**File:** `Router.tsx`

- Inside the `if (tab === 'repos')` block, after the existing pipeline/queue deep link handlers (~line 164), add:
  ```ts
  if (parts[2] === 'chat' && parts[3]) {
      dispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: decodeURIComponent(parts[3]) });
  }
  ```
- When navigating to `#repos/{repoId}/chat` (no session ID), dispatch with `id: null` to clear any stale selection

### 3. Wire deep link into RepoChatTab via RepoDetail

**File:** `RepoDetail.tsx`

- Read `selectedChatSessionId` from `AppContext`
- Pass it as `initialSessionId` prop to `<RepoChatTab>`
- After passing, clear it from context (dispatch `SET_SELECTED_CHAT_SESSION` with `null`) so it acts as a one-shot signal — same pattern used by queue deep links

### 4. Update RepoChatTab to support deep link + push URL on selection

**File:** `RepoChatTab.tsx`

- Accept new prop: `initialSessionId?: string | null`
- In the auto-select `useEffect` (currently ~line 174): if `initialSessionId` is provided and sessions are loaded, prefer it over the default `sessions[0]` auto-select
- In `handleSelectSession` (~line 254): update `location.hash` to include the session ID:
  ```ts
  location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(taskId);
  ```
- In `handleNewChat` (~line 264): reset URL back to `#repos/{repoId}/chat` (no session segment)
- When a new chat is created and gets a task ID, update the URL to include it

### 5. Add tests

- **Router test:** Verify `#repos/ws-123/chat/task-456` dispatches `SET_SELECTED_CHAT_SESSION` with `id: 'task-456'`
- **Router test:** Verify `#repos/ws-123/chat` dispatches with `id: null`
- **RepoChatTab test:** Verify `initialSessionId` triggers `loadSession` for that ID
- **RepoChatTab test:** Verify `handleSelectSession` updates `location.hash` with the task ID

## Edge Cases

- **Invalid/deleted chat ID in URL:** `loadSession` already handles fetch failures — the UI should show an error or fall back to empty state. No special handling needed.
- **Chat still running:** URL should work the same whether the chat is completed or in-progress.
- **URL encoding:** Chat task IDs are alphanumeric so encoding is straightforward, but use `encodeURIComponent`/`decodeURIComponent` for safety.
- **Keyboard shortcut (`c`):** Currently sets hash to `#repos/{repoId}/chat` — this is fine as-is (clears session selection when pressing the shortcut).

## URL Examples

| Scenario | URL |
|----------|-----|
| Chat tab, no session selected | `#repos/ws-kss6a7/chat` |
| Specific chat selected | `#repos/ws-kss6a7/chat/task-abc123` |
| After "New Chat" clicked | `#repos/ws-kss6a7/chat` |
