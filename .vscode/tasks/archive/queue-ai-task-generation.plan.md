# Plan: Use Queue for AI Task Generation (instead of inline streaming)

## Problem
Currently, "Generate task with AI" opens a dialog that streams the AI response inline via SSE (`POST /api/workspaces/:id/tasks/generate`). The dialog stays open showing a `<pre>` block with real-time chunks while the user waits. This blocks the UI and is inconsistent with the Queue-based workflow used elsewhere.

## Proposed Approach
Switch the dialog to submit the task to the **queue** via the existing `POST /api/workspaces/:id/queue/generate` endpoint, then immediately close the dialog. The user can track progress in the **Queue tab**.

The backend queue endpoint already exists and returns `{ taskId, queuedAt }` immediately.

## Key Files
- `packages/coc/src/server/spa/client/react/tasks/GenerateTaskDialog.tsx` — Dialog component
- `packages/coc/src/server/spa/client/react/hooks/useTaskGeneration.ts` — Current SSE streaming hook
- `packages/coc/src/server/task-generation-handler.ts` — Backend (queue endpoint already at line ~279)
- `packages/coc/src/server/spa/client/react/tasks/RepoQueueTab.tsx` — Queue tab (for reference)

## Changes

### 1. Create `useQueueTaskGeneration` hook
**File**: `packages/coc/src/server/spa/client/react/hooks/useQueueTaskGeneration.ts`

- New hook that POSTs to `/api/workspaces/:id/queue/generate` (not the SSE endpoint)
- Returns `{ enqueue, status, taskId, error }` — simple states: `idle | submitting | queued | error`
- On success, returns the `taskId` so the dialog can report it
- No SSE streaming — just a single POST + JSON response

### 2. Update `GenerateTaskDialog.tsx`
- Replace `useTaskGeneration` with `useQueueTaskGeneration`
- Remove the inline streaming display (`<pre>{chunks.join('')}</pre>`, spinner, progress message)
- On successful queue submission:
  - Show a brief "Queued!" confirmation toast/message
  - Call `onSuccess` callback (which closes the dialog)
  - Optionally switch to the Queue tab
- Keep the form fields (Prompt, Task name, Target folder, Model) unchanged
- Add optional Priority selector (the queue endpoint accepts `priority: high|normal|low`)

### 3. Navigate to Queue tab on success
- After dialog closes on successful enqueue, auto-navigate to the Queue tab so the user can see their task
- Use existing navigation mechanism (likely tab state in AppContext or URL routing)

### 4. Cleanup (optional)
- The old `useTaskGeneration` hook and the SSE `/tasks/generate` endpoint can remain for backward compatibility (they may be used elsewhere) — no deletion needed

## UX Flow (After Change)
1. User clicks "Generate task with AI" → dialog opens (same form)
2. User fills Prompt, optional Name/Folder/Model → clicks "Generate"
3. Dialog submits to queue → shows brief "Task queued (#N)" → closes
4. View auto-switches to Queue tab where the task appears as queued/running
5. User sees progress in Queue tab (existing queue UI handles status, streaming, completion)

## Out of Scope
- Changing the queue execution backend (already works)
- Modifying the Queue tab UI (already displays task-generation items)
- Removing the SSE endpoint (keep for backward compat)
