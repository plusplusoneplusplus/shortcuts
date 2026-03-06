# Fix Chat Conversation Rendering Bug

## Problem

When selecting a chat session in the CoC dashboard Chat tab, the right panel shows only the "Chat" header with an empty conversation area — no messages, no input area, no error feedback. The user sees a blank panel despite having an active or completed chat session.

**Screenshot observations:**
- First chat selected: "for the current AI task scheduling in the repo's..." — shows `—` for turn count, status is running/queued ("just now")
- Right panel: "Chat" header visible, but no conversation messages, no follow-up input area, no loading spinner

## Root Cause Analysis

### Bug 1 (Primary): Process 404 for queued/just-started tasks

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — `loadSession()` (lines 140–172)

The `loadSession` function performs two sequential API calls:
1. `GET /api/queue/{taskId}` → returns the task object (including `processId`)
2. `GET /api/processes/{processId}` → returns conversation data

**Problem:** After fetch #1 succeeds, `setChatTaskId(taskId)` is called (line 150), which switches the render from the start screen to `renderConversation()`. However, if fetch #2 fails (404), the error is caught and `turns` remains empty.

This 404 happens when:
- The task is in `queued` state (not yet started) — the bridge hasn't called `execute()` yet, so no process exists in the store
- `task.processId` is `undefined` (set only at line 193 of `queue-executor-bridge.ts`, during execute)
- The fallback PID `queue_${taskId}` doesn't exist in the process store yet

**Evidence from screenshot:** The first chat shows `—` for turn count (no `chatMeta` because `enrichChatTasks` skips tasks without `processId`), confirming the process hasn't been created yet.

### Bug 2: Missing input area and error feedback

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — `renderConversation()` (lines 479–551)

The render structure is:
```
renderConversation():
  ├── Header ("Chat")
  ├── Conversation area (flex-1 min-h-0 overflow-y-auto)
  │   └── loading ? <Spinner /> : turns.map(...)
  └── Input area (border-t)
      ├── error text (red)
      └── textarea + Send button
```

When `turns` is empty and `loading` is false, the conversation area renders nothing. The input area SHOULD still render at the bottom but appears invisible in the screenshot. Two possible explanations:
- The error message `"Chat session not found"` is set but the small `text-xs text-red-500` text is below the visible fold
- Or a rendering error causes the component to partially fail (no error boundary in RepoChatTab)

### Bug 3: No recovery mechanism for queued tasks

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — SSE useEffect (lines 223–257)

The SSE streaming subscription only activates when `task?.status === 'running'` (line 228). For a `queued` task, there is no mechanism to:
- Detect when the task transitions from `queued` → `running`
- Re-fetch the process once it becomes available
- Show a "Waiting to start…" placeholder

## Fix Plan

### Task 1: Handle missing process gracefully in `loadSession` ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

Instead of treating a 404 process as a hard error, detect when the task is queued/running without a process and show an appropriate placeholder:

```tsx
// In loadSession(), after fetching queue data:
const pid = loadedTask?.processId ?? `queue_${taskId}`;

// If task is queued and has no processId, don't fetch process — show placeholder
if (!loadedTask?.processId && loadedTask?.status === 'queued') {
    // Show the user's prompt as a pending user turn
    const prompt = loadedTask?.payload?.prompt ?? '';
    if (prompt) {
        setTurnsAndCache([{ role: 'user', content: prompt, timeline: [] }]);
    }
    return; // Don't try to fetch non-existent process
}
```

### Task 2: Add polling/WebSocket listener for queued → running transition ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

Add a `useEffect` that polls or listens for task status changes when the current task is queued:

```tsx
// Poll for queued tasks until they start running
useEffect(() => {
    if (!chatTaskId || task?.status !== 'queued') return;
    const interval = setInterval(async () => {
        try {
            const data = await fetchApi(`/queue/${encodeURIComponent(chatTaskId)}`);
            const t = data?.task;
            if (t?.status !== 'queued') {
                setTask(t);
                if (t?.processId || t?.status === 'running') {
                    loadSession(chatTaskId); // re-fetch now that process exists
                }
            }
        } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
}, [chatTaskId, task?.status, loadSession]);
```

### Task 3: Show user turn from task payload when process is unavailable ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — `getConversationTurns()`

Extend the synthetic turn fallback to also work with task payload data (not just process data):

```tsx
function getConversationTurns(data: any, task?: any): ClientConversationTurn[] {
    // ... existing checks ...
    
    // New fallback: construct from task payload when process has no turns
    if (task?.payload?.prompt) {
        return [{ role: 'user', content: task.payload.prompt, timeline: [] }];
    }
    return [];
}
```

### Task 4: Add loading/waiting state indicator for queued tasks ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — `renderConversation()`

After the turns list, show a "Waiting to start…" indicator when task is queued:

```tsx
{/* In conversation area, after turns.map() */}
{!loading && turns.length === 0 && task?.status === 'queued' && (
    <div className="flex items-center gap-2 text-sm text-[#848484] py-4">
        <Spinner /> Waiting to start…
    </div>
)}
```

### Task 5: Improve error visibility ✅

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` — `renderConversation()`

Move error display to the conversation area (above the input), making it more prominent:

```tsx
{/* In conversation area */}
{!loading && error && turns.length === 0 && (
    <div className="flex flex-col items-center justify-center h-full text-sm text-[#848484] gap-2">
        <span>⚠️ {error}</span>
        <Button size="sm" variant="secondary" onClick={() => loadSession(chatTaskId!)}>
            Retry
        </Button>
    </div>
)}
```

### Task 6: Add tests ✅

**File:** `packages/coc/test/spa/react/RepoChatTab.test.ts`

Add test cases for:
- Queued task with no processId → shows user prompt + "Waiting to start" indicator
- Process 404 → shows retry-able error in conversation area
- Running task with conversationTurns → renders bubbles normally
- Polling kicks in for queued tasks and re-fetches on status change

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Tasks 1–5: Handle missing process, add polling, improve error UX |
| `packages/coc/test/spa/react/RepoChatTab.test.ts` | Task 6: New test cases |

## Testing Strategy

1. Unit tests: Mock API responses for queued/running/completed task states
2. Manual: Start a new chat, verify user sees their prompt immediately + "Waiting to start…"
3. Manual: After task starts running, verify conversation populates automatically
4. Manual: Click a completed chat with turns, verify conversation renders
5. Manual: Simulate process store unavailability, verify error + retry button
