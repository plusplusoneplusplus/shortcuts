# Fix: Text Box and Send Button Disabled for Completed Chat

## Problem

In the CoC dashboard's chat UI (`RepoChatTab.tsx`), the textarea ("Follow up… Type / for skills") and the **Send** button remain **disabled** after a chat process completes. A **"Read-only"** badge is also shown in the Chat tab header.

Screenshot evidence: completed chats (green ✅ in sidebar) still show disabled inputs.

## Root Cause Investigation

### `inputDisabled` Condition

```typescript
// RepoChatTab.tsx ~line 118
const inputDisabled = sending || isStreaming || task?.status === 'queued';
```

For a completed chat, `sending` and `task?.status === 'queued'` should both be `false`. The culprit is most likely **`isStreaming` staying `true`**.

### The `isStreaming` State Gap

`setIsStreaming(false)` is called in three places:
1. `stopStreaming()` helper — called on user-initiated stop
2. Inside `waitForFollowUpCompletion()`'s `finish()` closure — for follow-up SSE
3. Inside the initial run useEffect's `finish()` closure — for initial task SSE

**Critical gap:** The `useEffect` cleanup function (lines ~417–420) that tears down the EventSource when `task?.status` changes does **not** call `setIsStreaming(false)`. If the SSE connection closes (network drop, server timeout, or missed final `status` event) before emitting the terminal status, `isStreaming` is never reset to `false`.

There is also **no guard `useEffect`** like:
```typescript
useEffect(() => {
    if (taskFinished && isStreaming) setIsStreaming(false);
}, [taskFinished, isStreaming]);
```

### "Read-only" Badge

The badge is purely visual and driven by `(task?.payload as any)?.readonly`. It does **not** directly affect `inputDisabled`, so this is a separate concern (likely intentional for certain chat types).

## Proposed Fix

### 1. Add safety reset in the main SSE useEffect cleanup

In `RepoChatTab.tsx`, find the `useEffect` that opens the initial SSE connection. In its **cleanup / teardown** path (when `task?.status` becomes a terminal value like `'completed'` or `'failed'`), explicitly call `setIsStreaming(false)`.

### 2. Add a guard useEffect

Add a small `useEffect` that resets `isStreaming` any time `taskFinished` becomes `true`:

```typescript
const taskFinished = task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled';

useEffect(() => {
    if (taskFinished) {
        setIsStreaming(false);
        setSending(false);
    }
}, [taskFinished]);
```

This acts as a safety net regardless of which SSE code path was used.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Add guard `useEffect`; fix cleanup in initial SSE `useEffect` to call `setIsStreaming(false)` |

## Verification

1. Start a chat task and wait for it to complete naturally.
2. Confirm the textarea and Send button become **enabled** after completion.
3. Start a chat and simulate SSE disconnect mid-run (network tab in DevTools → block SSE URL).
4. Confirm the textarea recovers (becomes enabled) once `task?.status` resolves to `'completed'`.
5. Confirm "Read-only" badge still shows for chats that have `payload.readonly = true`.

## Out of Scope

- The "Read-only" badge behavior (it is intentional).
- `ItemConversationPanel.tsx` — uses `sessionExpired` (HTTP 410) logic, separate mechanism.
