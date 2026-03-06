---
status: done
---

# 002: Wire Shared/Exclusive Concurrency in coc-server

## Summary

Plumb the dual-limiter `QueueExecutor` options (`sharedConcurrency`, `exclusiveConcurrency`, `isExclusive`) through `QueueExecutorBridgeOptions` → `createQueueExecutorBridge()` → `MultiRepoQueueExecutorBridge` → `createExecutionServer()`, and define the default task-type classification policy so that lightweight tasks (code-review, ai-clarification, task-generation) run concurrently while heavyweight tasks (follow-prompt, resolve-comments, run-pipeline, custom) remain serialised.

## Motivation

Commit 1 added the mechanical dual-limiter to `QueueExecutor` in pipeline-core but left the existing coc-server call-sites passing only `maxConcurrency: 1`. This commit is the integration seam — the place where the **policy** ("which task types are shared vs exclusive") is defined, defaults are chosen, and the new options are threaded through every layer that constructs an executor. Keeping it as a separate commit isolates the policy decision from the mechanism, making both independently reviewable and revertable.

## Changes

### Files to Create

- none

### Files to Modify

- **`packages/coc/src/server/queue-executor-bridge.ts`**
  - Import `QueuedTask` (already imported at line 26).
  - Add three optional fields to `QueueExecutorBridgeOptions` (after line 72):
    - `sharedConcurrency?: number` — concurrent limit for shared tasks (default 5)
    - `exclusiveConcurrency?: number` — concurrent limit for exclusive tasks (default 1)
    - `isExclusive?: (task: QueuedTask) => boolean` — task classification callback
  - Define the default policy constant and function just above `createQueueExecutorBridge()` (~line 1035):
    ```ts
    const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
        'task-generation',
        'ai-clarification',
        'code-review',
    ]);

    export function defaultIsExclusive(task: QueuedTask): boolean {
        return !SHARED_TASK_TYPES.has(task.type);
    }
    ```
    Export `defaultIsExclusive` so tests can import it directly.
  - Update the `createQueueExecutor` call at line 1050 to pass the new options:
    ```ts
    const executor = createQueueExecutor(queueManager, taskExecutor, {
        sharedConcurrency: options.sharedConcurrency ?? 5,
        exclusiveConcurrency: options.exclusiveConcurrency ?? 1,
        isExclusive: options.isExclusive ?? defaultIsExclusive,
        autoStart: options.autoStart !== false,
    });
    ```
    Remove the old `maxConcurrency` line — it is superseded by the two new limits.

- **`packages/coc/src/server/index.ts`**
  - Remove `maxConcurrency: 1` from the bridge options at line 166.
  - No new lines needed — the defaults in `createQueueExecutorBridge` (shared=5, exclusive=1) apply automatically. The option bag at lines 165-172 becomes:
    ```ts
    const bridge = new MultiRepoQueueExecutorBridge(registry, store, {
        autoStart: true,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
        defaultTimeoutMs,
    });
    ```

- **`packages/coc/src/server/multi-repo-executor-bridge.ts`**
  - No code change required. `defaultOptions` is already passed through verbatim at line 87 to `createQueueExecutorBridge()`. The new fields flow through the existing `QueueExecutorBridgeOptions` type automatically.

### Files to Delete

- none

## Implementation Notes

1. **Default classification rationale.**
   - *Shared* (`task-generation`, `ai-clarification`, `code-review`): stateless, read-only, short-lived, no file writes — safe to overlap.
   - *Exclusive* (`follow-prompt`, `resolve-comments`, `run-pipeline`, `custom`): write to the working tree, invoke tools, or run arbitrary pipelines — must serialise to avoid conflicts.

2. **`maxConcurrency` deprecation path.** After this commit, `maxConcurrency` is no longer referenced in coc-server. If commit 1 kept `maxConcurrency` as a backward-compat alias in `QueueExecutorOptions`, it can remain — but the bridge never sets it. Confirm that `QueueExecutor` falls back gracefully when only `sharedConcurrency`/`exclusiveConcurrency` are provided (no `maxConcurrency`).

3. **`defaultIsExclusive` is exported** so:
   - Tests can verify the classification table directly.
   - Future callers (e.g., VS Code extension AI queue) can reuse or override it.

4. **Config extensibility (deferred).** `sharedConcurrency` / `exclusiveConcurrency` could later be surfaced in `~/.coc/config.yaml` (keys `serve.sharedConcurrency`, `serve.exclusiveConcurrency`) and the `coc serve` CLI flags. For this commit, hard-coded defaults are sufficient; the options bag already supports overrides.

5. **Multi-repo bridge is a pass-through.** `MultiRepoQueueExecutorBridge` stores `defaultOptions: QueueExecutorBridgeOptions` and forwards it unchanged to `createQueueExecutorBridge` at line 84-88. No change needed there — TypeScript's structural typing means the new optional fields are already valid.

## Tests

Add to **`packages/coc/test/server/queue-executor-bridge.test.ts`**:

- **`defaultIsExclusive` classification table** — import `defaultIsExclusive` and assert:
  - `'follow-prompt'` → `true` (exclusive)
  - `'resolve-comments'` → `true` (exclusive)
  - `'run-pipeline'` → `true` (exclusive)
  - `'custom'` → `true` (exclusive)
  - `'task-generation'` → `false` (shared)
  - `'ai-clarification'` → `false` (shared)
  - `'code-review'` → `false` (shared)
  Use `it.each` for concision.

- **`createQueueExecutorBridge` passes dual-limiter options** — create a bridge with explicit `{ sharedConcurrency: 3, exclusiveConcurrency: 2, isExclusive: () => true }`, then verify those values reached the `QueueExecutor`. This may require either:
  - Spying on the `createQueueExecutor` import, or
  - Inspecting the executor's public state (if commit 1 exposes getters).

- **`createQueueExecutorBridge` uses defaults when no options given** — create a bridge with `{}`, verify the executor received `sharedConcurrency: 5`, `exclusiveConcurrency: 1`, and `isExclusive === defaultIsExclusive`.

- **Integration: shared task starts while exclusive is running** — enqueue an exclusive task (e.g., `follow-prompt`) that takes 200 ms, then immediately enqueue a shared task (e.g., `code-review`). Assert the shared task's `startedAt` is before the exclusive task's `completedAt` — proving it did not wait.

- **Integration: two exclusive tasks serialise** — enqueue two `follow-prompt` tasks. Assert the second task's `startedAt` ≥ first task's `completedAt`.

## Acceptance Criteria

- [ ] `QueueExecutorBridgeOptions` has `sharedConcurrency`, `exclusiveConcurrency`, and `isExclusive` fields
- [ ] `createQueueExecutorBridge()` passes dual-limiter options to `createQueueExecutor()` instead of `maxConcurrency`
- [ ] `defaultIsExclusive` correctly classifies all 7 task types
- [ ] `createExecutionServer()` no longer passes `maxConcurrency: 1`; dual-limiter defaults (5/1) apply
- [ ] All existing tests in `queue-executor-bridge.test.ts` and `multi-repo-executor-bridge.test.ts` still pass
- [ ] New unit tests for the classification table pass
- [ ] New integration tests for shared-concurrent / exclusive-serial behaviour pass
- [ ] `npm run build` succeeds
- [ ] `npm run test:run` in `packages/coc` succeeds

## Dependencies

- Depends on: 001 (Dual-Limiter Queue Executor in pipeline-core)

## Assumed Prior State

From commit 1:
- `QueueExecutorOptions` (in `packages/pipeline-core/src/queue/types.ts`) has new optional fields: `sharedConcurrency?: number`, `exclusiveConcurrency?: number`, `isExclusive?: (task: QueuedTask) => boolean`
- `QueueExecutor` internally maintains two `ConcurrencyLimiter` instances and routes tasks through `isExclusive` to decide which limiter to use
- `DEFAULT_EXECUTOR_OPTIONS` includes `sharedConcurrency: 1, exclusiveConcurrency: 1, isExclusive: () => true` (all-exclusive by default)
- `maxConcurrency` may still exist as a backward-compat alias (maps to `exclusiveConcurrency`)
- `createQueueExecutor()` accepts the expanded `QueueExecutorOptions`
- All pipeline-core tests pass with the new dual-limiter logic
