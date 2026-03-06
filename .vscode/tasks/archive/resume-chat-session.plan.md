# Resume Chat Session in CoC Dashboard

## Problem

When an AI SDK session expires (evicted from memory after idle timeout, server restart, etc.), the Chat tab permanently disables input with "Session expired. Start a new chat." The user loses the ability to continue that conversation thread. The Queue tab already offers a "Resume CLI" button that opens a terminal with `copilot --yolo --resume <sessionId>`, but no equivalent exists for Chat.

## Proposed Approach

Add two resume mechanisms to the Chat tab:

1. **In-browser resume** (primary) — A "Resume" button that attempts to restore the conversation within the dashboard, either by SDK session recovery or by creating a new session seeded with prior conversation context.
2. **Resume in Terminal** (secondary) — A "Resume in Terminal" button reusing the existing `/processes/:id/resume-cli` endpoint, for power users who prefer the CLI experience.

### In-Browser Resume Flow

```
User clicks "Resume"
  └─ POST /api/processes/:id/resume-chat
       ├─ Warm path: canResumeSession(sdkSessionId) === true
       │    └─ Return { resumed: true, processId }
       │    └─ UI re-enables input, user continues conversation
       └─ Cold path: SDK session cannot be resumed
            └─ Create NEW queue task (type: 'chat') with:
            │    • resumedFrom: oldProcessId
            │    • contextPrompt built from old conversationTurns
            │    • Copy of conversationTurns for display continuity
            └─ Return { resumed: false, newTaskId, newProcessId }
            └─ UI navigates to new session, shows combined history
```

## Implementation Todos

### 1. Server: Resume Chat Endpoint ✅

**File:** `packages/coc/src/server/queue-handler.ts` (or new file `chat-resume-handler.ts`)

Add `POST /api/processes/:id/resume-chat`:

- Fetch process record from store; validate it has `sdkSessionId` and `conversationTurns`
- **Warm resume**: Call `bridge.isSessionAlive(processId)`. If `true`:
  - Update process status to `completed` (ready for follow-ups via existing `/message` endpoint)
  - Clear any error state
  - Return `{ resumed: true, processId }`
- **Cold resume (context injection)**: If warm resume fails:
  - Read `conversationTurns` from the expired process
  - Build a context prompt that summarizes the prior conversation:
    ```
    Continue this conversation. Here is the prior context:
    
    <conversation_history>
    User: {turn1}
    Assistant: {turn2}
    ...
    </conversation_history>
    
    Acknowledge you have the context and are ready to continue.
    ```
  - Enqueue a new `type: 'chat'` task via the existing queue system with this context prompt
  - Store `resumedFrom: oldProcessId` in the new process metadata
  - After the new task starts and completes its first turn, prepend the old `conversationTurns` to the new process's turns for display continuity
  - Return `{ resumed: false, newTaskId, newProcessId }`
- Error cases: 404 (process not found), 409 (no session ID), 400 (process still active)

### 2. Server: Prepend Historical Turns on Cold Resume ✅

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

When executing a task with `resumedFrom` in the payload:
- After initial execution completes, fetch old process's `conversationTurns`
- Prepend them before the new context-setting exchange
- Mark prepended turns with `{ historical: true }` so the UI can style them differently if desired
- Persist the combined turns via `store.updateProcess()`

### 3. UI: Resume Button in Chat Conversation View ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

When `sessionExpired === true`:
- Replace the disabled input placeholder with a resume action area:
  - **"Resume" button** (primary) — calls `POST /api/processes/:id/resume-chat`
  - **"Resume in Terminal" button** (secondary) — calls `POST /api/processes/:id/resume-cli`
  - **"New Chat" button** — existing behavior
- Handle resume response:
  - `resumed: true` → clear `sessionExpired`, re-enable input
  - `resumed: false` → navigate to new task: update `chatTaskId`, `processId`, `selectedTaskId`, fetch and display combined turns
- Show loading state during resume attempt

### 4. UI: Resume Button in Chat Header ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

Add a small resume icon/button next to the chat title (the area the user circled in the screenshot) that appears when `sessionExpired === true`. This provides an always-visible affordance beyond the inline message.

### 5. UI: Session Sidebar Resume Indicator ✅

**File:** `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx`

- Show a visual indicator on sessions that were resumed (chain icon or "resumed" badge)
- For sessions that expired but haven't been resumed, show a subtle "expired" indicator
- Consider a right-click / context menu option to resume from the sidebar

### 6. UI: Historical Turn Styling ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

When displaying turns from a cold-resumed session:
- Prepended historical turns (from the original session) get a subtle visual separator: "— Resumed from previous session —"
- The context-setting assistant turn (acknowledging history) can be collapsed or hidden
- Recent turns after resume display normally

### 7. Tests ✅

- **Server tests**: Resume endpoint — warm path returns `resumed: true`, cold path creates new task, error cases (404, 409, 400)
- **Server tests**: Context prompt building from conversation turns
- **Server tests**: Historical turn prepending on cold resume
- **UI tests**: Resume button visibility tied to `sessionExpired` state
- **Integration**: Full resume flow — expire session → resume → continue conversation

## Key Files

| File | Changes |
|------|---------|
| `packages/coc/src/server/queue-handler.ts` | New `POST /api/processes/:id/resume-chat` route |
| `packages/coc/src/server/queue-executor-bridge.ts` | Handle `resumedFrom` payload, prepend historical turns |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Resume buttons, handle resume response, combined turn display |
| `packages/coc/src/server/spa/client/react/chat/ChatSessionSidebar.tsx` | Resume indicator, optional context menu |
| `packages/coc-server/src/api-handler.ts` | Possibly adjust 410 response to include `canResume` hint |

## Edge Cases & Considerations

- **Concurrent resume**: Prevent double-click by disabling button during request
- **Turn truncation**: For very long conversations, the context prompt may exceed token limits. Implement a sliding window (last N turns) or summarization strategy.
- **Image attachments**: Original image attachments in conversation turns cannot be re-sent to a new session (temp files may be gone). Show a note that images from the original session are not carried forward.
- **`resumedFrom` chain**: If a resumed session also expires and is resumed again, track the full chain for traceability.
- **Sidebar refresh**: After resume, the sidebar should update to reflect the new/updated session.
- **Deep links**: `#repos/:repoId/chat/:sessionId` should work for resumed sessions (new session ID).

## Out of Scope

- Automatic session keep-alive / heartbeat to prevent expiry
- Server-side session persistence across server restarts (depends on SDK capabilities)
- Conversation export/import
