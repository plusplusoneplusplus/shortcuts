---
status: done
---

# 001: Dual-Limiter Queue Executor

## Summary

Add a reader-writer style dual-limiter concurrency model to `QueueExecutor` so that tasks classified as **shared** (read-only) run on one concurrency pool and **exclusive** (write) tasks run on another, completely independent pool. Shared tasks never block or are blocked by exclusive tasks.

## Motivation

This is commit 1 of 3 and must land first because the remaining commits (queue-level policy integration and VS Code UI surfacing) depend on `QueueExecutor` understanding the two concurrency modes. Keeping it separate makes review easier and ensures the core mechanism is independently testable with full backward compatibility.

## Changes

### Files to Create

- none

### Files to Modify

- **`packages/pipeline-core/src/queue/types.ts`** — Add `concurrencyMode` to `QueuedTask`, extend `QueueExecutorOptions` with dual-limiter fields, update `DEFAULT_EXECUTOR_OPTIONS`.
- **`packages/pipeline-core/src/queue/queue-executor.ts`** — Replace single `limiter` with `sharedLimiter` + `exclusiveLimiter`, route tasks through the correct limiter based on `isExclusive` policy.
- **`packages/pipeline-core/test/queue/queue-executor.test.ts`** — Add new test group for shared/exclusive concurrency behavior.

### Files to Delete

- none

## Implementation Notes

### 1. Type changes in `types.ts`

**`QueuedTask` interface (line 247):**
Add optional field after `retryCount` (line 287):

```ts
/** Concurrency mode: 'shared' tasks run in the shared pool, 'exclusive' tasks in the exclusive pool */
concurrencyMode?: 'shared' | 'exclusive';
```

`CreateTaskInput` is `Omit<QueuedTask, 'id' | 'createdAt' | 'status' | ...>` (line 292) — it does NOT omit `concurrencyMode`, so the field is automatically inherited. No change needed there.

`TaskUpdate` (line 300) does NOT pick `concurrencyMode` — correct, concurrency mode should be immutable after creation.

**`QueueExecutorOptions` interface (line 422):**
Add three new optional fields:

```ts
export interface QueueExecutorOptions {
    maxConcurrency?: number;       // existing — backward compat alias
    autoStart?: boolean;           // existing
    /** Concurrency limit for shared (read-only) tasks (default: 5) */
    sharedConcurrency?: number;
    /** Concurrency limit for exclusive (write) tasks (default: 1) */
    exclusiveConcurrency?: number;
    /**
     * Policy callback to classify a task as exclusive.
     * Returns true for exclusive tasks, false for shared.
     * Default: () => true (all exclusive — preserves current serial behavior).
     */
    isExclusive?: (task: QueuedTask) => boolean;
}
```

**`DEFAULT_EXECUTOR_OPTIONS` (line 432):**
Update to:

```ts
export const DEFAULT_EXECUTOR_OPTIONS: Required<Omit<QueueExecutorOptions, 'isExclusive'>> & { isExclusive: (task: QueuedTask) => boolean } = {
    maxConcurrency: 1,
    autoStart: true,
    sharedConcurrency: 5,
    exclusiveConcurrency: 1,
    isExclusive: () => true,
};
```

> **Note:** `Required<QueueExecutorOptions>` won't work cleanly because `isExclusive` is a function type. Use a type intersection or make the default type explicit. Alternatively, keep the type as `Required<QueueExecutorOptions>` and provide the default function — TypeScript is fine with that since `Required` just removes `?`.

### 2. Executor changes in `queue-executor.ts`

**Constructor (line 43–61):**
- Replace `private limiter: ConcurrencyLimiter` (line 31) with two fields:
  ```ts
  private sharedLimiter: ConcurrencyLimiter;
  private exclusiveLimiter: ConcurrencyLimiter;
  private readonly isExclusive: (task: QueuedTask) => boolean;
  ```
- In the constructor body, resolve concurrency values with backward compat:
  ```ts
  const opts = { ...DEFAULT_EXECUTOR_OPTIONS, ...options };
  // If only maxConcurrency was provided (no explicit shared/exclusive), use it for exclusive
  // and default sharedConcurrency
  if (options.maxConcurrency !== undefined && options.exclusiveConcurrency === undefined) {
      opts.exclusiveConcurrency = options.maxConcurrency;
  }
  if (options.maxConcurrency !== undefined && options.sharedConcurrency === undefined) {
      opts.sharedConcurrency = options.maxConcurrency;
  }
  this.sharedLimiter = new ConcurrencyLimiter(opts.sharedConcurrency);
  this.exclusiveLimiter = new ConcurrencyLimiter(opts.exclusiveConcurrency);
  this.isExclusive = opts.isExclusive;
  ```
- Keep `this.options.maxConcurrency` in sync for `getMaxConcurrency()` backward compat — set it to `opts.exclusiveConcurrency`.

**`processLoop()` (line 240–271):**
The busy-wait capacity check on line 249 currently checks:
```ts
if (this.limiter.runningCount >= this.limiter.limit) {
```
This must be replaced with a check against the **correct** limiter for the next task:
```ts
const nextTask = this.queueManager.peek();
if (!nextTask) {
    await this.delay(100);
    continue;
}

const limiter = this.isExclusive(nextTask) ? this.exclusiveLimiter : this.sharedLimiter;
if (limiter.runningCount >= limiter.limit) {
    await this.delay(50);
    continue;
}
```
> **Key refactor:** The existing code peeks AFTER the capacity check (line 255). We must reorder: peek first, then check the correct limiter's capacity. This is safe because `peek()` is a read-only operation (returns `this.queue[0]`, line 128-129 of task-queue-manager.ts). Merge the two blocks into one: peek → if null sleep → if no capacity sleep → execute.

**`executeTask()` (line 276–325):**
Line 298 currently calls `this.limiter.run(...)`. Replace with:
```ts
const limiter = this.isExclusive(startedTask) ? this.exclusiveLimiter : this.sharedLimiter;
const result = await limiter.run(
    () => this.executeWithTimeout(startedTask),
    isCancelled
);
```

**`setMaxConcurrency()` (line 191–197):**
For backward compat, update both limiters:
```ts
setMaxConcurrency(n: number): void {
    if (n < 1) {
        throw new Error('maxConcurrency must be at least 1');
    }
    this.options.maxConcurrency = n;
    this.exclusiveLimiter = new ConcurrencyLimiter(n);
    this.sharedLimiter = new ConcurrencyLimiter(n);
}
```
Also add granular setters:
```ts
setSharedConcurrency(n: number): void {
    if (n < 1) throw new Error('sharedConcurrency must be at least 1');
    this.options.sharedConcurrency = n;
    this.sharedLimiter = new ConcurrencyLimiter(n);
}

setExclusiveConcurrency(n: number): void {
    if (n < 1) throw new Error('exclusiveConcurrency must be at least 1');
    this.options.exclusiveConcurrency = n;
    this.exclusiveLimiter = new ConcurrencyLimiter(n);
}
```

**`getMaxConcurrency()` (line 202):** Keep returning `this.options.maxConcurrency` for backward compat. Add:
```ts
getSharedConcurrency(): number { return this.options.sharedConcurrency; }
getExclusiveConcurrency(): number { return this.options.exclusiveConcurrency; }
```

### 3. Backward Compatibility Contract

- **Default behavior is identical:** `isExclusive` defaults to `() => true`, `exclusiveConcurrency` defaults to `1`. All tasks route through `exclusiveLimiter(1)` = serial execution. `sharedLimiter` is created but never used.
- **`maxConcurrency` alone still works:** `new QueueExecutor(qm, te, { maxConcurrency: 3 })` sets both limiters to 3. All tasks go through `exclusiveLimiter(3)` since default `isExclusive` returns true.
- **`setMaxConcurrency(n)` resets both limiters** to `n` — any in-flight tasks on old limiters complete naturally since `ConcurrencyLimiter` manages its own slot queue.

### 4. Gotchas

- **`ConcurrencyLimiter` is `readonly maxConcurrency`** (line 36 of concurrency-limiter.ts) — it cannot be mutated after construction. That's why `setMaxConcurrency` creates a **new** limiter instance. The existing code already does this (line 196). The dual-limiter approach must do the same for both.
- **processLoop reorder is critical:** If we check capacity before peeking, we don't know which limiter to check. The reorder (peek → classify → check capacity) is the correct sequence.
- **Fire-and-forget in processLoop:** `executeTask` is called without await (line 263). The limiter's internal `acquire()` will block inside `executeTask` if the limiter is full, but since `executeTask` is fire-and-forget, the `processLoop` continues. The capacity check at the top of the loop prevents spawning excess fire-and-forget calls. This pattern is unchanged.
- **Task classification uses `isExclusive` callback, not `task.concurrencyMode` directly:** The callback gives callers flexibility (e.g., classify by `task.type`). The default implementation should check `task.concurrencyMode !== 'shared'` — wait, the spec says default `isExclusive: () => true`. This means without any configuration, all tasks are exclusive regardless of their `concurrencyMode` field. This preserves backward compat. Callers who want mode-based routing pass `isExclusive: (t) => t.concurrencyMode !== 'shared'`.

## Tests

All in `packages/pipeline-core/test/queue/queue-executor.test.ts`, new `describe('shared/exclusive concurrency')` block:

- **Shared tasks run concurrently up to sharedConcurrency limit** — enqueue 3 shared tasks with `sharedConcurrency: 2`, verify first two start before either finishes, third waits.
- **Exclusive tasks serialize against each other** — enqueue 2 exclusive tasks with `exclusiveConcurrency: 1`, verify sequential `start-A end-A start-B end-B` order.
- **Shared and exclusive tasks run simultaneously** — enqueue 1 shared + 1 exclusive task concurrently, both with artificial delay, verify both start before either finishes (they use independent pools).
- **`isExclusive` callback is respected** — pass custom `isExclusive: (t) => t.type === 'resolve-comments'`, enqueue a `resolve-comments` task and a `follow-prompt` task, verify they route to different pools.
- **`concurrencyMode` field on QueuedTask** — create a task with `concurrencyMode: 'shared'`, verify the field is preserved on the queued task object.
- **Default concurrencyMode is undefined (exclusive by default)** — create a task without `concurrencyMode`, verify `isExclusive` returns true for it.
- **`setMaxConcurrency` backward compat** — call `setMaxConcurrency(3)`, verify `getMaxConcurrency()` returns 3, `getSharedConcurrency()` returns 3, `getExclusiveConcurrency()` returns 3.
- **`setSharedConcurrency` / `setExclusiveConcurrency`** — verify granular setters update only their respective limiter.
- **Existing tests pass unchanged** — no modifications to existing test cases; the default `isExclusive: () => true` preserves serial-by-default behavior.

Use the existing test patterns: `createSimpleTaskExecutor` with `executionOrder` arrays and `delay()`, `waitFor()` for async assertions, `createTestTask()` helper with overrides.

For tests that need the dual-limiter active, construct the executor with:
```ts
executor = new QueueExecutor(queueManager, taskExecutor, {
    sharedConcurrency: 3,
    exclusiveConcurrency: 1,
    isExclusive: (task) => task.concurrencyMode !== 'shared',
    autoStart: true,
});
```

## Acceptance Criteria

- [ ] `QueuedTask` has optional `concurrencyMode?: 'shared' | 'exclusive'` field
- [ ] `QueueExecutorOptions` has `sharedConcurrency`, `exclusiveConcurrency`, and `isExclusive` fields
- [ ] `DEFAULT_EXECUTOR_OPTIONS` includes `sharedConcurrency: 5`, `exclusiveConcurrency: 1`, `isExclusive: () => true`
- [ ] `QueueExecutor` creates two `ConcurrencyLimiter` instances (shared + exclusive)
- [ ] `processLoop` peeks task first, then checks correct limiter's capacity
- [ ] `executeTask` routes to correct limiter via `isExclusive`
- [ ] `setMaxConcurrency` updates both limiters (backward compat)
- [ ] `setSharedConcurrency` and `setExclusiveConcurrency` methods exist
- [ ] All existing tests pass without modification
- [ ] New tests cover: shared concurrency, exclusive serialization, independent pools, isExclusive callback, setMaxConcurrency compat
- [ ] `npm run build` succeeds
- [ ] `cd packages/pipeline-core && npm run test:run` passes

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit. The codebase has a single-limiter `QueueExecutor` with `ConcurrencyLimiter` as described in the current architecture section.
