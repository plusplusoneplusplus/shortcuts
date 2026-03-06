# Queue Task Creates Chat — Regression Fix

## Problem

Clicking **"+ Queue Task"** in the CoC dashboard's Queue tab and submitting a freeform prompt now creates a chat session that appears in the **Chat** tab. This is a regression — freeform queue tasks should appear only in the Queue tab and not pollute the Chat sidebar.

## Root Cause

The `EnqueueDialog.tsx` freeform path POSTs to `POST /api/queue/enqueue` **without a `type` field**:

```tsx
// packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx L126-137
await fetch('/api/queue/enqueue', {
    method: 'POST',
    body: JSON.stringify({
        prompt: prompt.trim(),
        model: model || undefined,
        workspaceId: workspaceId || undefined,
        folderPath: folderPath || undefined,
        images: images.length > 0 ? images : undefined,
    }),
});
```

On the server, `queue-handler.ts` L420-455 detects the missing `type` and **hardcodes `type: 'chat'`**:

```ts
// packages/coc/src/server/queue-handler.ts L428-431
const taskSpec = hasTaskEnvelope ? body : {
    type: 'chat',           // ← BUG: forces all freeform enqueues to be chat
    payload: { kind: 'chat', prompt: body.prompt.trim(), ... },
};
```

This causes a cascade:
1. Process is stored as `type: queue-chat` (queue-executor-bridge.ts L153)
2. `RepoChatTab.tsx` L231-233 refreshes chat sessions whenever any `type === 'chat'` task exists
3. `useChatSessions.ts` fetches `/queue/history?type=chat` — showing the queued task in the Chat sidebar
4. `useRepoQueueStats.ts` L20 counts it as a chat task, bumping the Chat badge count

## Fix

### Option A — Client-side fix (recommended, minimal change)

Change `EnqueueDialog.tsx` to send the task as `type: 'follow-prompt'` via the `/api/queue/tasks` endpoint (same path already used for skill-based tasks), instead of the legacy `/api/queue/enqueue` endpoint.

**File:** `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` L125-137

```tsx
// Before (broken):
await fetch('/api/queue/enqueue', {
    method: 'POST',
    body: JSON.stringify({ prompt, model, workspaceId, folderPath, images }),
});

// After (fixed):
const ws = appState.workspaces.find((w: any) => w.id === workspaceId);
const body: any = {
    type: 'follow-prompt',
    priority: 'normal',
    payload: {
        promptContent: prompt.trim(),
        workingDirectory: ws?.rootPath || folderPath || undefined,
    },
    images: images.length > 0 ? images : undefined,
};
if (model) body.config = { model };
await fetch(getApiBase() + '/queue/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});
```

This unifies both skill-based and freeform paths through the same endpoint and task type.

### Option B — Server-side fix (alternative)

Change the default type in `queue-handler.ts` from `'chat'` to `'follow-prompt'` and adjust the payload shape:

**File:** `packages/coc/src/server/queue-handler.ts` L431

```ts
// Before:
type: 'chat',
payload: { kind: 'chat' as const, prompt: body.prompt.trim(), ... }

// After:
type: 'follow-prompt',
payload: { promptContent: body.prompt.trim(), workingDirectory: body.folderPath, ... }
```

### Recommendation

**Option A** is preferred because:
- It removes usage of the legacy `/api/queue/enqueue` endpoint from the dialog
- Both skill-based and freeform tasks now go through the same `/api/queue/tasks` endpoint
- The server-side legacy endpoint can remain for backward compatibility with external callers

## Todos

1. ~~**fix-enqueue-dialog** — Change `EnqueueDialog.tsx` freeform path to send `type: 'follow-prompt'` via `/api/queue/tasks`~~ ✅
2. ~~**verify-chat-tab** — Verify Chat tab no longer shows queued freeform tasks~~ ✅ (type is now follow-prompt)
3. ~~**verify-queue-tab** — Verify Queue tab still shows freeform tasks correctly~~ ✅ (uses same /queue/tasks endpoint)
4. ~~**update-tests** — Update any tests that rely on freeform enqueue producing `type: 'chat'`~~ ✅

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/queue/EnqueueDialog.tsx` | Client dialog — sends the enqueue request |
| `packages/coc/src/server/queue-handler.ts` L407-473 | Server handler — hardcodes `type: 'chat'` for legacy path |
| `packages/coc/src/server/queue-executor-bridge.ts` | Executor — processes tasks by type |
| `packages/coc-server/src/task-types.ts` | Type definitions for `ChatPayload` vs `FollowPromptPayload` |
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Chat tab — refreshes on `type === 'chat'` tasks |
| `packages/coc/src/server/spa/client/react/chat/useChatSessions.ts` | Fetches chat sessions from `/queue/history?type=chat` |
| `packages/coc/src/server/spa/client/react/hooks/useRepoQueueStats.ts` | Counts chat vs non-chat tasks for badges |
