# Fix: Chat input disabled while task is running in RepoChatTab

## Problem

In `RepoChatTab`, the follow-up input textarea is disabled when `task.status` is `'queued'` or `'running'`. This prevents users from typing a follow-up message while a chat task is actively processing — they must wait for completion before interacting.

The floating `NewChatDialog` does **not** have this restriction, creating an inconsistency between the two chat UIs.

### Root cause

`RepoChatTab.tsx` line 119:
```typescript
const inputDisabled = sending || isStreaming || task?.status === 'queued' || task?.status === 'running';
```

vs `NewChatDialog.tsx` line 102:
```typescript
const inputDisabled = sending || isStreaming;
```

## Proposed approach

Align `RepoChatTab` with `NewChatDialog` by removing the `task.status` checks from `inputDisabled`. The `sending` and `isStreaming` guards are sufficient — they already prevent sending a follow-up while one is in-flight.

For `queued` status specifically, the input should remain disabled since the chat hasn't started yet (no process to send a follow-up to). The `running` check should be removed.

## Todos

### 1. Update inputDisabled in RepoChatTab
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

Change line 119 from:
```typescript
const inputDisabled = sending || isStreaming || task?.status === 'queued' || task?.status === 'running';
```
to:
```typescript
const inputDisabled = sending || isStreaming || task?.status === 'queued';
```

Keep `queued` because there's no process/session yet to send a follow-up to. Remove `running` because users should be able to queue up a follow-up while the AI is working.

### 2. Verify sendFollowUp guards
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx`

Confirm that `sendFollowUp` already has server-side guards (it checks `!processId`, `sending`, `sessionExpired`) so removing the client-side `running` disable is safe. The backend `/processes/:id/message` endpoint should handle concurrent messages gracefully.

### 3. Add/update tests
**File:** `packages/coc/src/server/spa/client/react/repos/RepoChatTab.test.tsx` (or similar)

- Test that textarea is **enabled** when `task.status === 'running'` and not streaming/sending
- Test that textarea is **disabled** when `task.status === 'queued'`
- Test that textarea is **disabled** when `isStreaming` or `sending` is true

### 4. Manual verification
- Start a chat in RepoChatTab, confirm input is enabled while task is running
- Confirm input is still disabled while queued, streaming, or sending
- Confirm floating NewChatDialog behavior is unchanged
