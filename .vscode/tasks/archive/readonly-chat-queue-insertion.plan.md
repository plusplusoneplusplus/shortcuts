# Plan: Insert `readonly-chat` Before First Exclusive Job in Queue

## Problem

When a `readonly-chat` task is enqueued it is placed at the end of its priority band using the
standard FIFO + priority ordering (`insertByPriority`). The `QueueExecutor.processLoop` peeks only
at the **head** of the queue. If the head is an exclusive task and the exclusive limiter is
saturated, the loop waits — even though the shared limiter still has free capacity and the
`readonly-chat` task is sitting behind the exclusive backlog, ready to run.

Because `readonly-chat` is truly read-only (it runs under the shared limiter and does not mutate
any workspace state), it is safe to run concurrently with any currently-running task, whether
exclusive or shared. Therefore there is no correctness reason to make it wait behind exclusive
jobs.

## Proposed Solution

When a `readonly-chat` task is enqueued, instead of appending it at the end of the priority band,
insert it **immediately before the first exclusive task** in the queue. If no exclusive tasks are
present, fall back to the normal `insertByPriority` logic.

This gives `readonly-chat` the best possible queue position without disturbing currently-running
jobs, priority tiers, or mutual-exclusion guarantees.

## Why This Is Safe

- `readonly-chat` → `SHARED_TASK_TYPES` → runs via `sharedLimiter` (concurrency 5).
- Moving it before exclusive tasks does not cause it to preempt anything; it simply avoids the
  exclusive-limiter bottleneck.
- Exclusive tasks already in front of it still execute in their original relative order.
- Other shared tasks already in front of it still execute before the new `readonly-chat`.

## Affected Files

| File | Change |
|------|--------|
| `packages/pipeline-core/src/queue/types.ts` | Add optional `isExclusive` to `TaskQueueManagerOptions` |
| `packages/pipeline-core/src/queue/task-queue-manager.ts` | Add `insertBeforeFirstExclusive()` method; call it from `enqueue()` when the task is non-exclusive |
| `packages/coc/src/server/queue-executor-bridge.ts` | Pass `defaultIsExclusive` to `TaskQueueManager` options when creating per-repo queue instances |
| `packages/pipeline-core/src/queue/tests/` | Add unit tests for the new insertion behaviour |

## Implementation Tasks

### 1 · `types.ts` — Extend `TaskQueueManagerOptions`

Add an optional callback:

```ts
isExclusive?: (task: QueuedTask) => boolean;
```

No breaking change — defaults to `undefined` (old behaviour preserved).

### 2 · `task-queue-manager.ts` — New insertion method

```ts
/**
 * Insert a non-exclusive task right before the first exclusive task in the
 * queue so it is not blocked behind the exclusive-limiter backlog.
 * Falls back to insertByPriority if there are no exclusive tasks ahead.
 */
private insertBeforeFirstExclusive(task: QueuedTask): void {
    if (!this.options.isExclusive) {
        this.insertByPriority(task);
        return;
    }
    const idx = this.queue.findIndex(t => this.options.isExclusive!(t));
    if (idx === -1) {
        // No exclusive tasks — standard priority insertion
        this.insertByPriority(task);
    } else {
        this.queue.splice(idx, 0, task);
    }
}
```

Update `enqueue()`:

```ts
if (this.options.isExclusive && !this.options.isExclusive(task)) {
    this.insertBeforeFirstExclusive(task);
} else {
    this.insertByPriority(task);
}
```

### 3 · `queue-executor-bridge.ts` — Wire up `isExclusive`

Locate where per-repo `TaskQueueManager` instances are constructed and pass the function:

```ts
new TaskQueueManager({
    ...existingOptions,
    isExclusive: defaultIsExclusive,   // already defined in this file
});
```

### 4 · Tests

Add cases in the `TaskQueueManager` test suite covering:

- `readonly-chat` inserted before the first exclusive task when exclusive tasks exist.
- `readonly-chat` falls back to priority order when no exclusive tasks are present.
- Multiple `readonly-chat` tasks queued in sequence maintain FIFO order relative to each other
  (each inserts at the same "before first exclusive" anchor).
- Existing exclusive tasks' relative ordering is preserved.
- `markRetry` re-insertion continues to use `insertByPriority` (no change).

## Considerations & Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Queue is empty | Falls back to `insertByPriority` (appends) |
| All queued tasks are shared | Falls back to `insertByPriority` |
| Multiple `readonly-chat` tasks enqueued back-to-back | Each is inserted before the current first exclusive task; they accumulate as a FIFO block in front of the exclusive backlog |
| A `readonly-chat` task with `priority: 'low'` arrives when high-priority exclusive tasks are queued | It jumps to position before the first exclusive, ahead of the high-priority exclusive tasks. This is intentional — read-only tasks truly don't block anything. If this turns out to be undesirable in practice, we can add a constraint to stay within the same priority band. |
| `isExclusive` not provided to `TaskQueueManager` | Old behaviour unchanged (standard priority insert) |

## Out of Scope

- Changing `processLoop` to skip-ahead for shared tasks (separate concern — queue order fix is
  sufficient for the immediate problem).
- Adding priority-band-aware insertion for the non-exclusive case (can be a follow-up if the
  priority jump noted above proves problematic).
