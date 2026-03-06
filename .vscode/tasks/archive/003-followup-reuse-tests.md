---
status: pending
---

# 003: Add tests for follow-up queue reuse path

## Summary

Add targeted tests for the `execute()` short-circuit introduced in commit 001, which bypasses `store.addProcess()` for `chat-followup` tasks and reuses the original process entry. Also cover the cancellation-guard revert from commit 002 and cleanup of `imageTempDir` on both success and failure paths.

## Motivation

Commits 001 and 002 changed core queue-execution plumbing — `execute()` now early-returns for `chat-followup` payloads instead of creating a new process, and the cancellation guard reverts the original process to `completed`. These paths have no dedicated unit coverage; the existing `chat-followup tasks` describe block (lines 452-508 of `queue-executor-bridge.test.ts`) only tests the happy-path dispatch and the "parent process not found" case, both going through the *old* `executeByType()` code path. The new short-circuit in `execute()` needs its own test surface.

## Changes

### Files to Create

- `packages/coc/test/server/queue-executor-bridge-followup.test.ts`
  New test file dedicated to the `execute()` short-circuit for `chat-followup` tasks. A separate file is preferred over appending to the 252 KB existing file for maintainability.

### Files to Modify

- (none)

### Files to Delete

- (none)

## Implementation Notes

### Test file structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession }
    from '../helpers/mock-process-store';
```

Reuse the same `vi.mock(...)` blocks for `@plusplusoneplusplus/pipeline-core`, `../../src/ai-invoker`, and `../../src/server/image-blob-store` that the main test file uses — copy them verbatim to keep the module graph consistent.

### Task fixture factory

Create a local helper to reduce repetition:

```typescript
function followUpTask(overrides: Partial<QueuedTask> & { processId: string; content: string }): QueuedTask {
    return {
        id: overrides.id ?? 'fu-task-1',
        type: 'chat-followup',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat-followup',
            processId: overrides.processId,
            content: overrides.content,
            attachments: (overrides as any).attachments,
            imageTempDir: (overrides as any).imageTempDir,
        },
        config: {},
        displayName: overrides.displayName ?? overrides.content,
        ...overrides,
    };
}
```

### Mocking `cleanupTempDir`

`cleanupTempDir` is imported from `@plusplusoneplusplus/coc-server`. Add a `vi.mock('@plusplusoneplusplus/coc-server', ...)` that exposes a `mockCleanupTempDir = vi.fn()` for assertions in tests 5 and 6.

### Spying on `executeFollowUp`

For test 2, spy on the prototype method:

```typescript
const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');
```

Reset in `beforeEach`. This avoids needing to subclass or refactor.

### `beforeEach` setup

Follow the existing pattern:

```typescript
let store: ReturnType<typeof createMockProcessStore>;
const sdkMocks = createMockSDKService();

beforeEach(() => {
    store = createMockProcessStore();
    sdkMocks.resetAll();
    sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    sdkMocks.mockSendFollowUp.mockResolvedValue({
        success: true,
        response: 'Follow-up response',
        sessionId: 'sess-fu',
    });
});
```

### Cancellation test (test 7) sequence

After commit 002, `execute()` checks `this.cancelledTasks` before the short-circuit and, for `chat-followup` payloads, also reverts the original process from `running` back to `completed`. The test must:

1. Seed store with a process whose `status` is `running` (simulate what the queue sets before `execute()` runs).
2. Call `executor.cancel(task.id)`.
3. Call `executor.execute(task)`.
4. Assert `store.updateProcess` was called with `(originalProcessId, { status: 'completed' })`.
5. Assert result is `{ success: false, error: 'Task cancelled', durationMs: 0 }`.

### Ghost-process test (test 8) approach

Seed the in-memory store with exactly one process via `store.addProcess()`. Execute the chat-followup task. Then call `store.getProcess` for both the original ID and the would-be `queue_<task.id>` — the latter must return `undefined`. Alternatively, if the mock store exposes the internal `Map`, assert `map.size === 1`.

## Tests

All tests live inside a single `describe('execute() short-circuit for chat-followup tasks', () => { ... })` block:

### 1. `should NOT call store.addProcess for chat-followup tasks`

- **Arrange:** `createCompletedProcessWithSession('proc-1', 'sess-1')` → `store.addProcess(proc)`. Build `followUpTask({ processId: 'proc-1', content: 'follow up' })`.
- **Act:** `await executor.execute(task)`.
- **Assert:**
  - `store.addProcess` called exactly **once** (only the seeding call, not from `execute()`). Alternatively, reset `store.addProcess.mockClear()` after seeding, then assert `.not.toHaveBeenCalled()`.
  - `task.processId === 'proc-1'` (reused original, not `queue_fu-task-1`).

### 2. `should call executeFollowUp with correct arguments`

- **Arrange:** Seed store. Spy on `executeFollowUp`. Build task with `attachments: [{ type: 'file', path: '/a.ts' }]`.
- **Act:** `await executor.execute(task)`.
- **Assert:** `spy.toHaveBeenCalledWith('proc-1', 'follow up', [{ type: 'file', path: '/a.ts' }])`.

### 3. `should return success result on follow-up completion`

- **Arrange:** Seed store. `sendFollowUp` resolves normally (default mock).
- **Act:** `const result = await executor.execute(task)`.
- **Assert:** `result.success === true`, `typeof result.durationMs === 'number'`, `result.durationMs >= 0`.

### 4. `should return failure result on follow-up error`

- **Arrange:** Seed store. Spy on `executeFollowUp` and mock it to reject with `new Error('boom')`.
- **Act:** `const result = await executor.execute(task)`.
- **Assert:** `result.success === false`, `result.error` is an `Error` with message containing `'boom'`, `typeof result.durationMs === 'number'`.

### 5. `should clean up imageTempDir on follow-up completion`

- **Arrange:** Seed store. Build task with `imageTempDir: '/tmp/img-123'`.
- **Act:** `await executor.execute(task)`.
- **Assert:** `mockCleanupTempDir` called with `'/tmp/img-123'`.

### 6. `should clean up imageTempDir on follow-up failure`

- **Arrange:** Seed store. Spy on `executeFollowUp` → reject. Build task with `imageTempDir: '/tmp/img-456'`.
- **Act:** `await executor.execute(task)`.
- **Assert:** `mockCleanupTempDir` called with `'/tmp/img-456'` (cleanup happens in `finally`).

### 7. `should revert original process to completed when follow-up task is cancelled`

- **Arrange:** Seed store with process `status: 'running'`. Build task.
- **Act:** `executor.cancel(task.id)` then `await executor.execute(task)`.
- **Assert:**
  - `store.updateProcess` called with `('proc-1', expect.objectContaining({ status: 'completed' }))`.
  - Result: `{ success: false, error: expect.any(Error), durationMs: 0 }`, where `error.message` is `'Task cancelled'`.

### 8. `should NOT create ghost process entry for follow-up tasks`

- **Arrange:** Seed store with one process `proc-1`.
- **Act:** `store.addProcess.mockClear()`. Execute chat-followup task.
- **Assert:**
  - `store.addProcess` not called.
  - `await store.getProcess('queue_fu-task-1')` returns `undefined` (no ghost entry).
  - `await store.getProcess('proc-1')` returns the original process (still exists).

## Acceptance Criteria

- [ ] New test file `packages/coc/test/server/queue-executor-bridge-followup.test.ts` exists
- [ ] All 8 tests pass with `npm run test:run` in `packages/coc/`
- [ ] No modifications to production code
- [ ] Tests use `createMockProcessStore` and `createMockSDKService` from existing helpers
- [ ] Tests validate the short-circuit path (commit 001): no `addProcess`, correct `task.processId`, delegation to `executeFollowUp`
- [ ] Tests validate the cancellation guard (commit 002): revert to `completed`, correct error result
- [ ] Tests validate `imageTempDir` cleanup on both success and failure
- [ ] Tests validate no ghost process entry is created in the store
- [ ] Test file follows existing patterns: same `vi.mock()` blocks, same `beforeEach` reset idiom, same `QueuedTask` shape

## Dependencies

- Depends on: 001, 002

## Assumed Prior State

Commits 001 and 002 applied. Specifically:
- `execute()` in `queue-executor-bridge.ts` contains the `isChatFollowUpPayload` guard **before** `store.addProcess()`, setting `task.processId = payload.processId` and delegating directly to `executeFollowUp()` with `imageTempDir` cleanup in `finally`.
- The cancellation check (`this.cancelledTasks.has(task.id)`) for `chat-followup` tasks also calls `store.updateProcess(payload.processId, { status: 'completed' })` to revert the original process before returning the failure result.
