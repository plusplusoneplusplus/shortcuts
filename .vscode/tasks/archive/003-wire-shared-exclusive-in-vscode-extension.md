---
status: done
---

# 003: Wire Shared/Exclusive Concurrency in VS Code Extension

## Summary

Pass an `isExclusive` policy and dual-limiter concurrency values when `AIQueueService` creates its `QueueExecutor`, and update `onConfigurationChanged` so the VS Code extension classifies `ai-clarification`, `code-review`, and `task-generation` as shared tasks — matching the coc-server convention.

## Motivation

The VS Code extension has its own `QueueExecutor` instance (created in `AIQueueService`), entirely separate from coc-server's. Commit 1 added dual-limiter support to `QueueExecutor` in pipeline-core; commit 2 wired it in coc-server. This commit completes the feature by applying the same shared/exclusive policy to the extension's queue, so that lightweight read-only tasks (clarifications, code reviews) don't block and aren't blocked by heavy exclusive tasks (follow-prompt, run-pipeline).

## Changes

### Files to Create

- none

### Files to Modify

- **`src/shortcuts/ai-service/ai-queue-service.ts`** — Add `SHARED_TASK_TYPES` set, pass `isExclusive` / `sharedConcurrency` / `exclusiveConcurrency` to `createQueueExecutor`, update `onConfigurationChanged` to call `setSharedConcurrency` / `setExclusiveConcurrency`.
- **`src/test/suite/ai-queue-service.test.ts`** — Add tests verifying the isExclusive policy is applied and configuration changes propagate to both limiters.

### Files to Delete

- none

## Implementation Notes

### 1. Define shared task types (`ai-queue-service.ts`)

Add a constant after the configuration key block (around line 48):

```ts
/**
 * Task types that use the shared (read-only) concurrency pool.
 * These are lightweight tasks that don't need exclusive access to the AI session.
 * Must stay in sync with coc-server's SHARED_TASK_TYPES.
 */
const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
    'task-generation',
    'ai-clarification',
    'code-review',
]);
```

This mirrors the classification from commit 2 (coc-server). The remaining types (`follow-prompt`, `resolve-comments`, `run-pipeline`, `custom`) are exclusive — they perform heavy writes or long-running tool sessions.

### 2. Add configuration constants

Add two new config keys alongside the existing ones:

```ts
const CONFIG_SHARED_CONCURRENCY = 'sharedConcurrency';
const CONFIG_EXCLUSIVE_CONCURRENCY = 'exclusiveConcurrency';
```

### 3. Add getter methods for the new settings

Add alongside `getMaxConcurrency()`:

```ts
/**
 * Get the shared (read-only) concurrency limit from settings
 */
getSharedConcurrency(): number {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<number>(CONFIG_SHARED_CONCURRENCY, 5);
}

/**
 * Get the exclusive (write) concurrency limit from settings
 */
getExclusiveConcurrency(): number {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<number>(CONFIG_EXCLUSIVE_CONCURRENCY, 1);
}
```

Defaults: shared = 5 (lightweight tasks can fan out), exclusive = 1 (heavy tasks serialize). These match the `DEFAULT_EXECUTOR_OPTIONS` from commit 1.

### 4. Update `createQueueExecutor` call in constructor (line 402)

Replace:

```ts
this.executor = createQueueExecutor(this.queueManager, taskExecutor, {
    maxConcurrency: this.getMaxConcurrency(),
    autoStart: this.isEnabled(),
});
```

With:

```ts
this.executor = createQueueExecutor(this.queueManager, taskExecutor, {
    maxConcurrency: this.getMaxConcurrency(),
    sharedConcurrency: this.getSharedConcurrency(),
    exclusiveConcurrency: this.getExclusiveConcurrency(),
    isExclusive: (task) => !SHARED_TASK_TYPES.has(task.type),
    autoStart: this.isEnabled(),
});
```

The `maxConcurrency` is kept for backward compat (it's the legacy knob, commit 1 uses it as fallback). The `isExclusive` callback classifies tasks by their `type` field, not the optional `concurrencyMode` property — this keeps it simple since the VS Code extension already knows all its task types.

### 5. Update `onConfigurationChanged()` (line 634)

The current method only calls `setMaxConcurrency`. Add granular updates:

```ts
private onConfigurationChanged(): void {
    const logger = getExtensionLogger();

    // Update concurrency — legacy maxConcurrency + granular shared/exclusive
    const newConcurrency = this.getMaxConcurrency();
    this.executor.setMaxConcurrency(newConcurrency);

    const newShared = this.getSharedConcurrency();
    this.executor.setSharedConcurrency(newShared);

    const newExclusive = this.getExclusiveConcurrency();
    this.executor.setExclusiveConcurrency(newExclusive);

    logger.info(
        LogCategory.AI,
        `Queue concurrency updated — max: ${newConcurrency}, shared: ${newShared}, exclusive: ${newExclusive}`
    );

    // Handle enabled/disabled
    if (this.isEnabled() && !this.executor.isRunning()) {
        this.executor.start();
        logger.info(LogCategory.AI, 'Queue executor started');
    } else if (!this.isEnabled() && this.executor.isRunning()) {
        this.executor.stop();
        logger.info(LogCategory.AI, 'Queue executor stopped');
    }
}
```

**Order matters:** `setMaxConcurrency` (from commit 1) resets both limiters as a blunt backward-compat hammer. Calling `setSharedConcurrency` / `setExclusiveConcurrency` afterward overrides with the precise values. This ensures that if a user only configures `maxConcurrency` (legacy), both pools get that value. If they configure the granular settings, those take precedence.

### 6. No VS Code settings contribution needed (optional enhancement)

The `getSharedConcurrency()` and `getExclusiveConcurrency()` methods read from VS Code config with sensible defaults (5 and 1). Adding `contributes.configuration` entries in `package.json` would provide IntelliSense and settings UI, but is **not required** for this commit — it can be a follow-up. The defaults work without any user configuration.

### 7. Import changes

No new imports needed from pipeline-core — `createQueueExecutor`, `QueueExecutor`, and `QueuedTask` are already imported. The `isExclusive` callback uses `QueuedTask` which is already in the import list (line 20).

### 8. Gotchas

- **`setMaxConcurrency` creates new limiter instances** (see commit 1 notes) — calling `setSharedConcurrency` immediately after is safe because it also creates a new limiter, replacing the one `setMaxConcurrency` just made.
- **`SHARED_TASK_TYPES` must use the raw `TaskType` string values**, not some enum. The `task.type` field on `QueuedTask` is typed as `TaskType` (a string union), so `Set<string>.has()` works fine.
- **The VS Code extension uses `'follow-prompt'` and `'ai-clarification'` most heavily.** With the new policy, `ai-clarification` goes shared and `follow-prompt` goes exclusive. This means clarification requests won't queue behind a long-running follow-prompt task.

## Tests

All in `src/test/suite/ai-queue-service.test.ts`, add a new `suite('Shared/Exclusive Concurrency')` block:

- **`SHARED_TASK_TYPES` classification** — Export `SHARED_TASK_TYPES` (or expose via a helper) and verify `ai-clarification`, `code-review`, `task-generation` are in the set, while `follow-prompt`, `resolve-comments`, `run-pipeline`, `custom` are not.
- **Executor receives isExclusive callback** — Initialize service, queue a `follow-prompt` task and an `ai-clarification` task, verify both are queued successfully (smoke test that the executor was created with the callback without throwing).
- **Shared task types are queued correctly** — Queue each shared task type (`ai-clarification`, `code-review`, `task-generation`), verify each is accepted and appears in `getQueuedTasks()`.
- **Exclusive task types are queued correctly** — Queue each exclusive task type (`follow-prompt`, `custom`), verify they appear in queued tasks.
- **getSharedConcurrency returns default** — Verify `service.getSharedConcurrency()` returns 5 when no VS Code setting is configured.
- **getExclusiveConcurrency returns default** — Verify `service.getExclusiveConcurrency()` returns 1 when no VS Code setting is configured.

> **Note:** Testing actual concurrent execution behavior (shared tasks running in parallel while exclusive serialize) is covered by commit 1's pipeline-core tests. The VS Code extension tests focus on wiring: correct options passed, correct classification, correct config propagation. Mocha tests in `src/test/suite/` run in the VS Code test host and can't easily test concurrency timing.

## Acceptance Criteria

- [x] `SHARED_TASK_TYPES` constant defined with `task-generation`, `ai-clarification`, `code-review`
- [x] `createQueueExecutor` call includes `isExclusive`, `sharedConcurrency`, `exclusiveConcurrency` options
- [x] `isExclusive` callback returns `false` for shared types, `true` for all others
- [x] `getSharedConcurrency()` reads from `workspaceShortcuts.queue.sharedConcurrency` with default 5
- [x] `getExclusiveConcurrency()` reads from `workspaceShortcuts.queue.exclusiveConcurrency` with default 1
- [x] `onConfigurationChanged()` calls `setSharedConcurrency` and `setExclusiveConcurrency`
- [x] New tests cover SHARED_TASK_TYPES classification, config defaults, and task queuing for both shared and exclusive types
- [x] All existing `ai-queue-service.test.ts` tests pass unchanged
- [x] `npm run build` succeeds
- [x] `npm run test` passes

## Dependencies

- Depends on: 001, 002

## Assumed Prior State

From commits 1-2:
- `QueueExecutorOptions` has `sharedConcurrency`, `exclusiveConcurrency`, and `isExclusive` fields
- `QueueExecutor` creates dual `ConcurrencyLimiter` instances (shared + exclusive)
- `QueueExecutor` has `setSharedConcurrency(n)` and `setExclusiveConcurrency(n)` methods
- `setMaxConcurrency(n)` resets both limiters (backward compat)
- Default `isExclusive: () => true` preserves serial behavior when no callback is provided
- coc-server defines `SHARED_TASK_TYPES = new Set(['task-generation', 'ai-clarification', 'code-review'])` and passes `isExclusive: (task) => !SHARED_TASK_TYPES.has(task.type)` in `createQueueExecutorBridge`
