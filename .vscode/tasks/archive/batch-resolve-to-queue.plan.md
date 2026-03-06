# Migrate Batch-Resolve to Repo Queue

## Problem

The "Resolve All" (batch-resolve) endpoint in `task-comments-handler.ts` currently:
1. Invokes AI **directly** via `createCLIAIInvoker()` — bypasses the repo queue entirely
2. Sets `approvePermissions: false` — AI cannot use tools (read files, run shell)
3. Does **not set** `workingDirectory` — SDK gets `undefined`, recreates the client needlessly
4. Blocks the HTTP response for up to 120s while waiting for AI

The desired behavior: batch-resolve should submit a `resolve-comments` task to the **repo-specific queue** with proper `workingDirectory` and tool permissions, then return immediately. The SPA polls/streams the result.

## Current State

| Component | File | Status |
|-----------|------|--------|
| `ResolveCommentsPayload` type | `pipeline-core/src/queue/types.ts:71-80` | Exists but **missing `workingDirectory`** |
| `isResolveCommentsPayload()` guard | `pipeline-core/src/queue/types.ts:560` | Exists |
| `'resolve-comments'` task type | `queue-handler.ts:27` | Registered as valid |
| `executeByType()` for resolve-comments | `queue-executor-bridge.ts:564-565` | **No-op placeholder** |
| Batch-resolve endpoint | `task-comments-handler.ts:620-671` | Direct AI invocation |
| SPA `resolveWithAI()` hook | `useTaskComments.ts:246-282` | Calls endpoint synchronously |

## Approach

Convert the batch-resolve flow from synchronous direct-AI to async queue-based:

**Server**: batch-resolve endpoint enqueues a `resolve-comments` task → returns task ID immediately  
**Executor**: `executeByType()` handles `resolve-comments` by building the prompt and calling `executeWithAI()`  
**SPA**: polls task status or listens via SSE/WebSocket, then applies the result when done

## Todos

### 1. Update `ResolveCommentsPayload` type
- **File**: `packages/pipeline-core/src/queue/types.ts:71-80`
- Add `workingDirectory?: string` field
- Add `documentContent: string` field (the full document text)
- Add `filePath: string` field (for prompt context)
- Keep existing fields: `documentUri`, `commentIds`, `promptTemplate`

### 2. Update `getWorkingDirectory()` in executor bridge
- **File**: `packages/coc/src/server/queue-executor-bridge.ts:777-791`
- Add `isResolveCommentsPayload` case to return `payload.workingDirectory || this.defaultWorkingDirectory`

### 3. Implement `resolve-comments` execution in bridge
- **File**: `packages/coc/src/server/queue-executor-bridge.ts:544-566`
- Replace the no-op placeholder for `resolve-comments`
- When `isResolveCommentsPayload(task.payload)`:
  - Import `buildBatchResolvePrompt` from `task-comments-handler.ts` (or extract to shared module)
  - Build prompt from `payload.documentContent`, `payload.commentIds`, `payload.filePath`
  - Load comments from `TaskCommentsManager` (or embed them in the payload)
  - Call `executeWithAI(task, prompt)` — this gives tools, streaming, proper cwd
- Return `{ revisedContent, commentIds }` as the task result

### 4. Update batch-resolve endpoint to enqueue instead of direct AI
- **File**: `packages/coc/src/server/task-comments-handler.ts:620-671`
- Instead of calling `createCLIAIInvoker()`, enqueue a `resolve-comments` task:
  - Look up the workspace to get `rootPath` for `workingDirectory`
  - Build the payload with `documentContent`, open comment IDs, `filePath`, `workingDirectory`
  - Enqueue via the repo queue (import `registry` or accept it as a dependency)
- Return `202 Accepted` with `{ taskId }` instead of blocking for AI result
- Keep `buildBatchResolvePrompt()` — just move its invocation to the executor

### 5. Update SPA `resolveWithAI()` to use async queue flow
- **File**: `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts:246-282`
- Step 1: POST to batch-resolve → get `{ taskId }` back
- Step 2: Poll `/api/queue/tasks/{taskId}` or listen via WebSocket for completion
- Step 3: When task completes, extract `revisedContent` and `commentIds` from result
- Step 4: PATCH document content and resolve comments (same as today)
- Handle in-progress state (show spinner with queue position)

### 6. Also update single-comment resolve (`fixWithAI`)
- **File**: `packages/coc/src/server/task-comments-handler.ts:526-618` (the `commandId === 'resolve'` branch)
- Same pattern: enqueue instead of direct AI, return task ID
- **File**: `packages/coc/src/server/spa/client/react/hooks/useTaskComments.ts:284-319`
- Same async polling pattern

### 7. Extract `buildBatchResolvePrompt` to shared location
- Currently in `task-comments-handler.ts:792-829`
- Move to a shared module (e.g., `packages/coc/src/server/resolve-prompt-builder.ts`) so both the handler and bridge can import it
- Or embed the full prompt in the payload so the bridge doesn't need to import it

## Notes

- The `resolve-comments` task type and `ResolveCommentsPayload` already exist as scaffolding — this is filling in the implementation
- The queue bridge already has `approvePermissions: true` by default, so AI will have tool access
- The bridge already handles `workingDirectory` via `getWorkingDirectory()` — just needs the new payload case
- SSE streaming (`store.emitProcessOutput`) and WebSocket broadcasting already work for other task types — resolve-comments gets this for free
- The SPA already has queue-aware UI patterns from other features (follow-prompt, task generation)
