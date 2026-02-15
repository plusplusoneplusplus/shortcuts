---
status: pending
---

# 008: Add timeout enforcement and hang detection to AI process manager

## Summary

Add timeout enforcement, periodic hang detection sweeps, graceful child process termination with SIGTERM→SIGKILL escalation, and capped in-memory process history to `AIProcessManager`. This prevents hung processes from leaking memory and child process resources indefinitely.

## Motivation

`AIProcessManager` currently has no timeout enforcement. Once a process is registered as `running`, it stays in that state forever if the underlying AI call hangs or the child process becomes unresponsive. This causes:

1. **Memory leaks** — The `processes` Map grows without bound; completed process history is never trimmed.
2. **Child process resource leaks** — Orphaned `ChildProcess` handles remain open, consuming OS resources (PIDs, file descriptors).
3. **Misleading UI** — The AI Processes tree view shows perpetually "running" processes that will never complete.
4. **No observability** — `getProcessCounts()` returns `{ queued, running, completed, failed, cancelled }` but has no `timedOut` counter, making it impossible to distinguish genuine failures from hangs.

The existing `ProcessMonitor` (in `process-monitor.ts`) handles PID-level liveness checks for SDK sessions but does not enforce age-based timeouts on tracked `AIProcess` entries in the manager's Map.

## Changes

### Files to Create

- **`src/test/suite/ai-process-timeout.test.ts`** — Unit tests for timeout detection, history trimming, graceful kill escalation, sweep lifecycle, and `getProcessStats()`.

### Files to Modify

- **`src/shortcuts/ai-service/ai-process-manager.ts`**
  1. Add constants: `DEFAULT_PIPELINE_TIMEOUT_MS` (45 min), `DEFAULT_STANDARD_TIMEOUT_MS` (10 min), `SWEEP_INTERVAL_MS` (2 min), `MAX_COMPLETED_HISTORY` (200), `SIGKILL_DELAY_MS` (5 sec).
  2. Add private fields: `sweepTimer: NodeJS.Timeout | undefined`, `maxProcessAge: { pipeline: number; standard: number }`, `maxCompletedHistory: number`.
  3. In `initialize()`: start the sweep interval via `setInterval(this.sweepHungProcesses.bind(this), SWEEP_INTERVAL_MS)`.
  4. Add private `sweepHungProcesses()` method that iterates `processes` Map, checks `Date.now() - startTime > maxProcessAge` for each running process, and calls `timeoutProcess(id)` for expired ones.
  5. Add private `timeoutProcess(id: string)` method: marks process as `failed` with error `'Process timed out after X minutes'`, calls `gracefulKillChild()` if `childProcess` exists, aborts SDK session if `sdkSessionId` exists.
  6. Add private `gracefulKillChild(childProcess: ChildProcess)` method: sends `SIGTERM`, waits 5 seconds via `setTimeout`, then sends `SIGKILL` if the process is still alive (checking `childProcess.exitCode === null`).
  7. Add `trimProcessHistory()` private method: sorts non-running processes by `endTime` descending, keeps most recent `maxCompletedHistory`, deletes the rest from the Map. Called at end of `updateProcess()`, `completeProcessGroup()`, `completeCodeReviewGroup()`, `completeDiscoveryProcess()`, `completeCodeReviewProcess()`.
  8. Add `getProcessStats()` public method returning `{ running: number, completed: number, failed: number, timedOut: number }` — `timedOut` counts processes with `status === 'failed'` and `error` containing `'timed out'`.
  9. In `dispose()`: clear `sweepTimer` via `clearInterval`.
  10. Expose `maxProcessAge` and `maxCompletedHistory` as constructor/config options for testability.

- **`src/shortcuts/ai-service/types.ts`**
  1. Add `getProcessStats()` method signature to `IAIProcessManager` interface returning `ProcessStats`.
  2. Add `ProcessStats` type: `{ running: number; completed: number; failed: number; timedOut: number }`.

- **`src/shortcuts/ai-service/mock-ai-process-manager.ts`**
  1. Add stub `getProcessStats()` implementation to satisfy the updated `IAIProcessManager` interface.

### Files to Delete

None.

## Implementation Notes

- **Timeout categorization by process type**: Pipeline processes (`type` containing `'pipeline'`) use the 45-minute timeout; all others use 10 minutes. This is determined at sweep time from the process's `type` field, not at registration time, to avoid adding a new field to `AIProcess`.
- **SIGTERM→SIGKILL escalation**: The `gracefulKillChild` method sends `SIGTERM` first, then schedules a `SIGKILL` after 5 seconds. The `setTimeout` handle for the SIGKILL must be tracked and cleared in `dispose()` to prevent dangling timers.
- **History trimming boundary**: Only non-running, non-queued processes count against `maxCompletedHistory`. Running and queued processes are never trimmed.
- **Sweep interval efficiency**: The 2-minute sweep iterates the Map (O(n) where n is total processes). With the 200-entry cap, this is trivially fast.
- **No new VS Code settings**: The timeouts and history cap are internal defaults with constructor overrides for testing. VS Code settings can be added in a future commit if user configurability is needed.
- **Backward compatibility**: `getProcessCounts()` remains unchanged. `getProcessStats()` is additive. The sweep and trimming are purely internal behaviors.
- **`cancelProcess` already handles child kill**: The existing `cancelProcess()` calls `childProcess.kill()` (which sends SIGTERM). The new `gracefulKillChild` adds the SIGKILL escalation that `cancelProcess` lacks — consider updating `cancelProcess` to use `gracefulKillChild` too.

## Tests

Tests in `src/test/suite/ai-process-timeout.test.ts`:

1. **Sweep detects hung standard process** — Register a process, set `startTime` to 11 minutes ago, invoke `sweepHungProcesses()`, assert status is `failed` and error contains `'timed out'`.
2. **Sweep detects hung pipeline process at 45 min** — Register a pipeline-type process, set `startTime` to 46 minutes ago, invoke sweep, assert timed out.
3. **Sweep does not timeout young processes** — Register a process 5 minutes ago, invoke sweep, assert still `running`.
4. **SIGTERM→SIGKILL escalation** — Register a process with a mock `ChildProcess`, trigger timeout, assert `SIGTERM` sent, advance timer 5s, assert `SIGKILL` sent.
5. **SDK session abort on timeout** — Register a process with `sdkSessionId`, trigger timeout, assert `abortSession()` called.
6. **History trimming keeps last N** — Register and complete 250 processes, assert Map size ≤ 200 + (running count).
7. **trimProcessHistory preserves running processes** — Register 10 running + 250 completed, trim, assert all 10 running remain.
8. **getProcessStats returns correct counts** — Register mix of running, completed, failed, timed-out processes, assert stats object.
9. **Sweep timer cleaned up on dispose** — Initialize, dispose, assert `clearInterval` was called (or use a spy).
10. **Multiple sweeps do not double-timeout** — Timeout a process, run sweep again, assert only one `failProcess` call.

## Acceptance Criteria

- [ ] Processes running longer than `maxProcessAge` are automatically marked as `failed` with a descriptive timeout error message.
- [ ] Child processes receive SIGTERM first, then SIGKILL after 5 seconds if still alive.
- [ ] SDK sessions are aborted when their tracked process times out.
- [ ] Completed process history is capped at 200 (configurable) entries; oldest are evicted.
- [ ] `getProcessStats()` returns accurate counts including `timedOut`.
- [ ] Sweep timer is started on `initialize()` and cleared on `dispose()`.
- [ ] All existing tests continue to pass (no regression).
- [ ] New tests cover timeout detection, kill escalation, history trimming, and stats.
- [ ] `MockAIProcessManager` satisfies the updated `IAIProcessManager` interface.

## Dependencies

- Depends on: None
