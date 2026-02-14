---
status: pending
---

# 004: Implement DAG Executor Engine

## Summary
Build the core DAG execution engine that orchestrates task instances through the dependency graph — evaluating trigger rules, respecting concurrency limits, managing state transitions, and persisting progress.

## Motivation
This is the central piece that replaces the linear Map→Reduce execution with true DAG orchestration. It coordinates task scheduling based on dependency resolution, handles parallel branches, and integrates with the state machine and persistence layer from previous commits.

## Changes

### Files to Create
- `packages/pipeline-core/src/dag/executor.ts` — `DAGExecutor` class:
  - `constructor(config: DAGConfig, options: DAGExecutorOptions)`
  - `execute(conf?: Record<string, unknown>)` → `Promise<DAGRun>`:
    - Creates DAGRun + TaskInstances in store
    - Enters event loop:
      1. Find tasks in 'queued' state whose trigger rules are satisfied
      2. Submit ready tasks to concurrency-limited runner
      3. On task completion: update state, store XCom, emit events
      4. Evaluate downstream tasks (trigger rules)
      5. Repeat until all tasks terminal or DAG cancelled
    - Compute final DAGRun state from task states
  - `cancel()` → cancels running tasks, marks remaining as cancelled
  - `retry(taskId)` → re-queues a failed task (clear downstream too)
  - `getStatus()` → current DAGRun with all TaskInstance states
- `packages/pipeline-core/src/dag/task-runner.ts` — `TaskRunner`:
  - Resolves task type to handler:
    - `pipeline` → wraps existing `executePipeline()` from pipeline-core
    - `ai_prompt` → direct AI invocation via `AIInvoker`
    - `shell` → executes shell command (with timeout)
    - `python` → executes Python script (with timeout)
    - `noop` → placeholder/passthrough
  - Wraps execution with `runWithPolicy()` (timeout + retry + cancellation)
  - Returns `TaskExecutionResult` with output for XCom storage
- `packages/pipeline-core/src/dag/task-handlers/` — Handler registry:
  - `handler-registry.ts` — `TaskHandlerRegistry` (register/get handlers by type)
  - `pipeline-handler.ts` — Wraps `executePipeline` as a DAG task
  - `ai-prompt-handler.ts` — Direct AI prompt execution
  - `shell-handler.ts` — Shell command execution with output capture
  - `noop-handler.ts` — Pass-through handler
  - `types.ts` — `TaskHandler` interface: `execute(node, context) → TaskResult`
- `packages/pipeline-core/src/dag/executor-options.ts` — Configuration:
  - `DAGExecutorOptions`: persistenceProvider, aiInvoker, maxConcurrency, defaultTimeout, isCancelled, onTaskStateChange, onRunStateChange, eventEmitter, logger

### Files to Modify
- `packages/pipeline-core/src/dag/types.ts` — Add `DAGNode.taskType` field, `TaskResult` type, `DAGExecutorOptions` reference
- `packages/pipeline-core/src/dag/index.ts` — Re-export executor, task-runner, handlers

## Implementation Notes
- The executor event loop is `async` and uses `setImmediate`/`setTimeout(0)` to yield between evaluation cycles (prevents blocking)
- Concurrency is managed by existing `ConcurrencyLimiter` from map-reduce
- XCom values from a completed task are stored in the TaskInstance and accessible to downstream tasks via `context.xcom.get(taskId, key)`
- The `pipeline` task handler wraps the existing `executePipeline()` — this means existing YAML pipelines can become nodes in a DAG without rewriting them
- `shell` handler uses `execAsync` from existing `utils/exec-utils.ts`
- Task retry respects `maxTries` on the DAGNode config — increments `tryNumber` on TaskInstance
- When a task fails and has retries left, state goes to `up_for_retry` → `queued` automatically
- DAG-level `max_active_runs` is NOT enforced here (comes with scheduler in 008)

## Tests
- `packages/pipeline-core/test/dag/executor.test.ts`:
  - Linear chain (A → B → C) executes in order
  - Diamond DAG (A → [B, C] → D): B and C run in parallel, D waits for both
  - Task failure propagates `upstream_failed` to downstream
  - `one_success` trigger rule: D runs if either B or C succeeds
  - `all_done` trigger rule: D runs even if upstream failed
  - Cancellation stops running tasks and marks remaining as cancelled
  - Retry re-queues failed task and clears downstream states
  - XCom passing: task A stores value, task B reads it
  - Concurrency limit respected (max 2 → only 2 tasks run simultaneously)
  - Pipeline handler wraps executePipeline correctly
  - Shell handler captures stdout/stderr
  - Noop handler passes through
- `packages/pipeline-core/test/dag/task-runner.test.ts`:
  - Handler registry resolves correct handler by type
  - Timeout triggers retry
  - Max retries exceeded → failed state
  - Unknown task type → clear error

## Acceptance Criteria
- [ ] DAG executor correctly resolves dependencies via topological order
- [ ] Parallel branches execute concurrently within concurrency limits
- [ ] Trigger rules determine task readiness accurately
- [ ] State transitions flow through the state machine (no invalid transitions)
- [ ] XCom values pass between tasks
- [ ] Existing `executePipeline` works as a DAG task handler
- [ ] Cancellation and retry work correctly
- [ ] All state changes are persisted via the store
- [ ] Existing pipeline-core tests pass unchanged

## Dependencies
- Depends on: 001, 002, 003
