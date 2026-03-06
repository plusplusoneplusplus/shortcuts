---
status: pending
---

# 001: Short-circuit execute() for chat-followup tasks

## Summary

Add an early-return path in `QueueExecutorBridge.execute()` that detects `chat-followup` payloads and delegates directly to `executeFollowUp()`, bypassing the generic process-creation block that currently creates a redundant `queue_<taskId>` process entry ("ghost duplicate") in the queue UI.

## Motivation

Every call to `execute()` unconditionally creates a new `AIProcess` with id `queue_<taskId>` (lines 176-226), stores it via `this.store.addProcess()`, and assigns it to `task.processId`. For `chat-followup` tasks this is wrong because:

1. **Ghost processes** — The SPA queue panel shows a spurious `queue_<taskId>` entry alongside the original process. It has a truncated prompt preview, a user conversation turn, and status `running` → `completed`, but no meaningful response data because `executeFollowUp()` writes all output to the *original* process's store entry.
2. **Wasted persistence** — The finally block (lines 340-346) persists an empty output buffer keyed to the ghost `processId`, while the real output is persisted by `executeFollowUp()` under the original `processId`.
3. **Wrong `task.processId`** — The queue manager tracks progress via `task.processId`. For follow-ups it should point to the original `payload.processId`, not the ghost.

`executeFollowUp()` (lines 420-599) is fully self-contained: it handles process lookup, streaming, tool events, timeline buffering, throttle state cleanup, conversation turn assembly, `persistOutput`, `flushConversationTurn` registration/unregistration, `pendingSuggestions`, `generateTitleIfNeeded`, and error recovery with error turns. The generic `execute()` wrapper adds nothing of value for this code path.

## Changes

### Files to Create
- (none)

### Files to Modify
- `packages/coc/src/server/queue-executor-bridge.ts` — Insert an early-return block inside `execute()` immediately after the cancellation check (after line 174) and before the generic process-creation block (line 176).

### Files to Delete
- (none)

## Implementation Notes

Insert the following block at line 175 (between the cancellation guard and the `// Create a process in the store for tracking` comment):

```typescript
// ── Chat follow-up: skip ghost process creation — reuse the original process ──
if (isChatFollowUpPayload(task.payload)) {
    const payload = task.payload as unknown as ChatFollowUpPayload;
    task.processId = payload.processId;

    // Rehydrate externalized images if needed
    const rawPayload = task.payload as any;
    if (rawPayload?.imagesFilePath && (!Array.isArray(rawPayload.images) || rawPayload.images.length === 0)) {
        rawPayload.images = await ImageBlobStore.loadImages(rawPayload.imagesFilePath);
    }

    try {
        await this.executeFollowUp(payload.processId, payload.content, payload.attachments);
        const duration = Date.now() - startTime;
        logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} completed in ${duration}ms`);
        return { success: true, durationMs: duration };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const duration = Date.now() - startTime;
        logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} failed in ${duration}ms: ${errorMsg}`);
        return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: duration };
    } finally {
        if (payload.imageTempDir) {
            cleanupTempDir(payload.imageTempDir);
        }
    }
}
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| `task.processId = payload.processId` | The `QueueManager` uses `task.processId` for progress tracking and cancellation. Pointing it at the original process means the queue entry correctly reflects the real conversation. |
| Image rehydration duplicated here | Images are externalized to a blob store file during enqueue. The generic path rehydrates at line 201-204. Since we short-circuit before that, we must replicate the same `ImageBlobStore.loadImages()` call. |
| `cleanupTempDir` in finally | Mirrors the existing pattern in `executeByType` (lines 761-764). Temp dirs for decoded image attachments must be cleaned up regardless of success/failure. |
| Return shape matches `TaskExecutionResult` | The early return must conform to the same `{ success, error?, result?, durationMs }` contract so the queue manager's completion handler works unchanged. |
| No changes to `executeFollowUp()` | It already handles: `outputBuffers` init/cleanup, `registerFlushHandler`/`unregisterFlushHandler`, `throttleState` cleanup, `timelineBuffers` drain, conversation turn assembly, `persistOutput`, `emitProcessComplete`, and `generateTitleIfNeeded`. |

### What does NOT change

- **`executeFollowUp()`** — Already fully self-contained. No modifications needed.
- **`api-handler.ts`** — The `/api/processes/:id/chat` endpoint already updates the original process to `running` status and appends the user turn before enqueuing. No changes needed.
- **`executeByType()` chat-followup branch (lines 756-767)** — Becomes dead code for queued tasks since `execute()` now returns before reaching `executeByType()`. Still reachable if `executeByType()` is called directly (defensive, no removal needed). Can be cleaned up in a follow-up commit.
- **SPA dashboard** — No UI changes required. Removing the ghost process means the queue panel naturally shows only the original process.
- **`extractPrompt()` chat-followup branch (line 685-687)** — Also becomes unreachable for the short-circuited path, but harmless to keep.

### Import requirements

`ChatFollowUpPayload` must be imported from `@plusplusoneplusplus/coc-server`. Check if it is already imported; if not, add it to the existing import block (lines 20-33). Currently only `isChatFollowUpPayload` is imported — the type `ChatFollowUpPayload` needs to be added.

### Precise line references (current state)

| Line(s) | Content | Relevance |
|----------|---------|-----------|
| 25 | `isChatFollowUpPayload,` | Type guard — already imported |
| 62 | `import { ImageBlobStore } from './image-blob-store';` | Blob store — already imported |
| 164 | `async execute(task: QueuedTask)` | Method entry point |
| 170-174 | Cancellation check | Insert point is immediately after this block |
| 176-226 | Generic process creation block | This is what we skip |
| 200-204 | Image rehydration | Must be replicated in the short-circuit path |
| 229 | `task.processId = processId;` | Overridden by our `task.processId = payload.processId` |
| 340-346 | finally block (persist output) | No-op for follow-ups — skipped entirely |
| 420-599 | `executeFollowUp()` | Delegated to — unchanged |
| 757-767 | `executeByType` chat-followup branch | Becomes dead code for queued path |

## Tests
- (covered in commit 003)

## Acceptance Criteria
- [ ] `chat-followup` tasks no longer create a `queue_<taskId>` process in the store
- [ ] `task.processId` is set to `payload.processId` (the original chat process ID)
- [ ] Image blobs are rehydrated from `ImageBlobStore` before `executeFollowUp` is called
- [ ] `imageTempDir` is cleaned up in the finally block on both success and failure
- [ ] `executeFollowUp()` is called with the correct `processId`, `content`, and `attachments`
- [ ] The return value conforms to `TaskExecutionResult` shape (`{ success, durationMs, error? }`)
- [ ] Existing non-follow-up task types are unaffected (the generic process-creation path is unchanged)
- [ ] TypeScript compiles without errors (`npm run build`)

## Dependencies
- Depends on: None

## Assumed Prior State
None (first commit)
