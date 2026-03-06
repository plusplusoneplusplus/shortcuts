# Fix Duplicate Assistant Message Bubble in Chat

## Problem

When a chat task is running and the server has already flushed a partial streaming assistant turn to the process store, `loadSession()` unconditionally appends **another** empty streaming assistant placeholder. This causes **two** "ASSISTANT" message boxes to appear in the chat UI.

## Root Cause

In `RepoChatTab.tsx` line 170–171, when `task.status === 'running'`, the code always appends a new streaming placeholder:

```ts
setTurnsAndCache([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
```

But `loadedTurns` (from `getConversationTurns`) may already contain a streaming assistant turn that was written by `flushConversationTurn()` in `queue-executor-bridge.ts`. The flush writes `{ role: 'assistant', streaming: true }` into the process store when enough chunks accumulate or 5+ seconds elapse.

**Timeline:**
1. Task starts → store has `[user]`
2. `flushConversationTurn(pid, true)` fires mid-stream → appends `{ role: 'assistant', streaming: true }` → store has `[user, assistant(streaming)]`
3. `loadSession()` fetches process → `getConversationTurns()` returns `[user, assistant(streaming)]`
4. Code appends another placeholder → `setTurns([user, assistant(streaming), assistant(empty, streaming)])` → **two bubbles**

## Fix

**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`
**Lines:** 170–171

Before appending a streaming placeholder, check if the last loaded turn is already an assistant turn:

```ts
if (loadedTask?.status === 'running') {
    const lastTurn = loadedTurns[loadedTurns.length - 1];
    if (lastTurn?.role === 'assistant') {
        // Server already flushed a partial streaming turn — mark it streaming, don't duplicate
        setTurnsAndCache(loadedTurns.map((t, i) =>
            i === loadedTurns.length - 1 ? { ...t, streaming: true } : t
        ));
    } else {
        // No assistant turn yet — add the placeholder
        setTurnsAndCache([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
    }
}
```

This ensures:
- If the last turn is already an assistant (flushed), we reuse it and just ensure `streaming: true`
- If the last turn is a user turn (no flush yet), we still create the placeholder as before

## Verification

1. Start a chat that triggers a tool call (e.g., an explore task)
2. Verify only one ASSISTANT bubble appears during streaming
3. Verify the final result still renders correctly after the task completes
4. Verify follow-up messages still work correctly (they use `sendFollowUp` which has its own streaming logic)

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Guard streaming placeholder append in `loadSession` (lines 170–171) |
