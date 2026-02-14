---
status: pending
---

# Queue Fail-Fast: Cancel Remaining Items on Failure/Timeout

## Problem Statement

When a task in the pipeline queue fails or times out, the remaining items in the queue continue to execute. This is undesirable for pipelines where item ordering matters or where a failure in one item renders subsequent items meaningless (e.g., sequential data processing, cron-scheduled pipelines where partial results are worse than no results).

**Current behavior:**
- `MapReduceExecutor`: Failed map items are counted but execution continues for all remaining items. The final result includes both successful and failed items.
- `QueueExecutor`: Failed tasks are retried (if configured) or moved to history, but the processing loop continues pulling and executing new tasks.
- `ConcurrencyLimiter.all()`: Uses `Promise.all()` which starts all tasks and only supports user-initiated cancellation via `isCancelled`.

**Desired behavior:**
- A new `stopOnFailure` option (default: `false` for backward compatibility)
- When enabled, the first failure/timeout (after retries exhausted) triggers cancellation of all remaining queued/pending items
- Already-running items are allowed to complete (or cancelled if the executor supports it)
- Cancelled items are marked with a distinct status/error message (e.g., `"Cancelled: prior item failed"`)
- Exposed in `pipeline.yaml` via an `onFailure: stop` configuration option

## Scope & Dependency Graph

```
┌──────────────────────────────────┐
│ 001: Map-Reduce Types            │ ← No dependencies
│     (MapReduceOptions.stopOn...) │
└───────────────┬──────────────────┘
                │
┌───────────────▼──────────────────┐
│ 002: Map-Reduce Executor         │ ← Depends on 001
│     (fail-fast in executeMap...) │
└───────────────┬──────────────────┘
                │
┌───────────────▼──────────────────┐
│ 003: Queue Executor Fail-Fast    │ ← Depends on 001 (uses same pattern)
│     (stopOnFailure in QueueExe.) │
└───────────────┬──────────────────┘
                │
┌───────────────▼──────────────────┐
│ 004: Pipeline YAML Schema +      │ ← Depends on 002
│      Wiring (onFailure config)   │
└──────────────────────────────────┘
```

---

## Commits

### 001: Add `stopOnFailure` to map-reduce types and implement in executor

**Files to modify:**
- `packages/pipeline-core/src/map-reduce/types.ts` — Add `stopOnFailure?: boolean` to `MapReduceOptions`
- `packages/pipeline-core/src/map-reduce/executor.ts` — Implement fail-fast logic in `executeMapPhase()`:
  - Track a `failureDetected` flag alongside existing `cancelled` flag
  - In the `.then()` handler after each item completes, if `result.success === false` and `stopOnFailure` is enabled, set `failureDetected = true`
  - In the task factory (line 262), check `failureDetected` before starting new items — return cancelled result immediately
  - This leverages the existing cancellation pattern already in place (lines 264-273)
- `packages/pipeline-core/test/map-reduce/executor.test.ts` — Add tests:
  - `stopOnFailure: false` (default) continues processing all items even when some fail
  - `stopOnFailure: true` cancels remaining items after first failure
  - `stopOnFailure: true` with timeout — remaining items cancelled after timeout
  - `stopOnFailure: true` with retry — only cancels after retries exhausted
  - Already-running concurrent items are allowed to complete
  - Cancelled items have error message `"Cancelled: prior item failed"`
  - Progress callback reports correct counts

**Implementation notes:**
- The key insight is that `executeMapPhase` already has a `cancelled` flag pattern. We add a parallel `failureDetected` flag that gets set in the `.then()` result handler (line 286-292). The task factory closure (line 262) already checks `cancelled` — we extend this to also check `failureDetected` when `stopOnFailure` is enabled.
- Default value for `stopOnFailure` should be `false` in `DEFAULT_MAP_REDUCE_OPTIONS` for backward compatibility.
- The `ConcurrencyLimiter` does NOT need changes — cancellation of not-yet-started items happens at the task factory level, before the limiter even executes them.

**Acceptance Criteria:**
- [ ] `MapReduceOptions` interface has `stopOnFailure?: boolean` field
- [ ] `DEFAULT_MAP_REDUCE_OPTIONS` has `stopOnFailure: false`
- [ ] When `stopOnFailure: true`, first failure cancels remaining pending items
- [ ] When `stopOnFailure: false`, behavior is unchanged (all items processed)
- [ ] Concurrent in-flight items are allowed to complete
- [ ] All existing tests pass unchanged
- [ ] New tests cover the scenarios listed above

---

### 002: Add `stopOnFailure` to queue executor types and implement fail-fast

**Files to modify:**
- `packages/pipeline-core/src/queue/types.ts` — Add `stopOnFailure?: boolean` to `QueueExecutorOptions` and `DEFAULT_EXECUTOR_OPTIONS`
- `packages/pipeline-core/src/queue/queue-executor.ts` — Implement fail-fast in `handleTaskFailure()`:
  - After a task fails (retries exhausted), if `stopOnFailure` is enabled:
    1. Cancel all remaining queued tasks via `this.queueManager.clear()` (which already marks them as cancelled and moves to history)
    2. Stop the processing loop via `this.stop()`
    3. Emit a new `'queueFailFast'` event with the failed task and error
  - The `processLoop` already checks `this.running && !this.stopRequested`, so calling `stop()` will naturally halt processing
- `packages/pipeline-core/test/queue/queue-executor.test.ts` — Add tests:
  - `stopOnFailure: false` (default) continues processing after failure
  - `stopOnFailure: true` stops queue and cancels remaining tasks after failure
  - `stopOnFailure: true` with retry — only triggers after retries exhausted
  - `queueFailFast` event is emitted with correct task and error
  - Already-running tasks complete before queue stops

**Implementation notes:**
- `TaskQueueManager.clear()` already cancels all queued tasks and moves them to history with `status: 'cancelled'`. This is exactly what we need.
- The `QueueExecutor.stop()` method sets `stopRequested = true` and `running = false`, which the `processLoop` checks at every iteration. Currently-executing tasks will complete because they're already running in the `limiter.run()` call.
- We should NOT call `cancelTask()` on running tasks since the user didn't request cancellation of in-flight work — just prevention of new work starting.

**Acceptance Criteria:**
- [ ] `QueueExecutorOptions` interface has `stopOnFailure?: boolean` field
- [ ] `DEFAULT_EXECUTOR_OPTIONS` has `stopOnFailure: false`
- [ ] When `stopOnFailure: true` and a task fails, remaining queued tasks are cancelled
- [ ] When `stopOnFailure: false`, behavior is unchanged
- [ ] `queueFailFast` event emitted on fail-fast trigger
- [ ] All existing tests pass unchanged
- [ ] New tests cover the scenarios listed above

---

### 003: Add `onFailure` config to pipeline YAML schema and wire through executor

**Files to modify:**
- `packages/pipeline-core/src/pipeline/types.ts` — Add optional `onFailure` field to `PipelineConfig`:
  ```typescript
  /** Failure handling strategy (default: 'continue') */
  onFailure?: 'continue' | 'stop';
  ```
  Also add to `MapConfig` for per-phase granularity (optional, can be top-level only for V1).
- `packages/pipeline-core/src/pipeline/executor.ts` — Wire `config.onFailure` to `executorOptions.stopOnFailure`:
  - In `executeStandardMode()` (line 450-461): set `stopOnFailure: config.onFailure === 'stop'`
  - In `executeBatchMode()` (line 542+): same wiring for batch processing
- `packages/pipeline-core/src/pipeline/validator.ts` (if exists) — Validate `onFailure` values
- `packages/pipeline-core/test/pipeline/executor.test.ts` (or relevant test file) — Add tests:
  - Pipeline with `onFailure: 'stop'` stops on first map item failure
  - Pipeline with `onFailure: 'continue'` (or omitted) processes all items
  - Pipeline YAML with invalid `onFailure` value is rejected by validation

**Pipeline YAML example:**
```yaml
name: "Sequential Analysis"
onFailure: stop    # New field

input:
  type: csv
  path: "input.csv"

map:
  prompt: "Analyze: {{title}}"
  output:
    - severity
    - category
  parallel: 5

reduce:
  type: json
```

**Implementation notes:**
- Top-level `onFailure` applies to the map phase (the primary execution phase where items are processed)
- `'continue'` is the default, matching current behavior
- `'stop'` maps to `stopOnFailure: true` in the executor options
- For batch mode, the same flag should be passed down. Batch mode has its own concurrency logic but we can set the cancellation flag similarly.
- The filter phase is excluded from fail-fast since it's a pre-processing step and failing to filter one item shouldn't stop filtering others.

**Acceptance Criteria:**
- [ ] `PipelineConfig` interface has `onFailure?: 'continue' | 'stop'` field
- [ ] `executeStandardMode()` passes `stopOnFailure` based on `config.onFailure`
- [ ] `executeBatchMode()` passes `stopOnFailure` based on `config.onFailure`
- [ ] Default behavior is unchanged when `onFailure` is omitted
- [ ] Validation rejects invalid `onFailure` values
- [ ] New tests verify end-to-end behavior
- [ ] CLAUDE.md / README updated with `onFailure` documentation

---

## Risks & Open Questions

1. **Batch mode complexity**: In batch mode, a "failure" is per-batch not per-item. If one batch fails, should remaining batches be cancelled? → **Yes**, same semantics apply at the batch granularity.

2. **Concurrency edge case**: With `parallel: 5` and `stopOnFailure: true`, up to 5 items could be in-flight when a failure is detected. Items 2-5 will complete (or fail independently). Only items 6+ will be cancelled. This is the expected behavior — we don't abort in-flight AI calls.

3. **Retry interaction**: `stopOnFailure` should only trigger AFTER retries are exhausted for the failing item. If `retryOnFailure: true` with `retryAttempts: 2`, the item gets 3 total attempts before fail-fast kicks in. Currently `retryOnFailure` is hardcoded to `false` in the pipeline executor, but the map-reduce executor supports it.

4. **Cron scheduling context**: For cron-scheduled pipelines, `onFailure: stop` will be the recommended default since partial results from a scheduled run are typically less useful than a clear failure signal.

5. **Filter phase**: The filter phase is explicitly excluded from fail-fast semantics since filtering is a pre-processing step. A failed AI filter on one item shouldn't prevent filtering the rest.

## Testing Strategy

- **Unit tests**: Per-commit as described above, using Vitest (pipeline-core's test framework)
- **Mocking**: Use mock AI invokers that fail deterministically on specific items
- **Concurrency tests**: Verify that with `parallel > 1`, in-flight items complete while pending items are cancelled
- **Backward compatibility**: All existing tests must pass without modification
