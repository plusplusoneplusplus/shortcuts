---
status: pending
---

# 002: Implement `run-script` Queue Executor

## Summary

Add a `run-script` task type handler to `QueueExecutorBridge.executeByType()` that spawns a child process, captures stdout/stderr/exit code, and surfaces the output in the task result. Includes timeout support via `task.config.timeoutMs` and correct cross-platform shell invocation.

## Motivation

Separating the executor from the type definitions (commit 001) and from the schedule wiring keeps each commit atomic and independently testable. Commit 001 established the payload shape and type guard; this commit wires the actual execution logic into the queue so that a `run-script` task enqueued via the API can run a shell command and return structured output.

## Changes

### Files to Create

_None._

### Files to Modify

- **`packages/coc/src/server/queue-executor-bridge.ts`**
  1. Add import at the top:
     ```ts
     import { spawn } from 'child_process';
     import { isRunScriptPayload } from '../tasks/run-script-payload'; // path from commit 001
     ```
  2. In `executeByType()`, add a new branch **before** the final no-op fallback:
     ```ts
     // Run script: spawn a child process and capture stdout/stderr
     if (isRunScriptPayload(task.payload)) {
         return this.executeRunScript(task);
     }
     ```
  3. Add a new private method `executeRunScript`:
     ```ts
     private async executeRunScript(task: QueuedTask): Promise<unknown> {
         const payload = task.payload as RunScriptPayload;
         const startTime = Date.now();

         return new Promise((resolve, reject) => {
             const child = spawn(payload.script, [], {
                 shell: true,
                 cwd: payload.workingDirectory,
             });

             let stdout = '';
             let stderr = '';
             let timedOut = false;

             const timeoutMs = (task.config as any)?.timeoutMs;
             let timer: NodeJS.Timeout | undefined;
             if (timeoutMs != null && timeoutMs > 0) {
                 timer = setTimeout(() => {
                     timedOut = true;
                     child.kill();
                 }, timeoutMs);
             }

             child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
             child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

             child.on('error', (err) => {
                 if (timer) clearTimeout(timer);
                 reject(err);
             });

             child.on('close', (exitCode) => {
                 if (timer) clearTimeout(timer);
                 const durationMs = Date.now() - startTime;
                 resolve({
                     success: !timedOut && exitCode === 0,
                     result: { stdout, stderr, exitCode: timedOut ? null : exitCode },
                     durationMs,
                     timedOut,
                 });
             });
         });
     }
     ```
  4. `'run-script'` must **not** be added to `SHARED_TASK_TYPES` (scripts are exclusive by default via `defaultIsExclusive`).

### Files to Delete

_None._

## Implementation Notes

- Use `spawn` (not `exec`) to avoid the 200 KB buffer cap that `exec` imposes — scripts may produce large output.
- Pass `{ shell: true }` so bare command strings like `echo "abc"` work on Windows without wrapping in `cmd /c`.
- `payload.workingDirectory` is optional in the type from commit 001; fall back to `process.cwd()` if undefined.
- On timeout, call `child.kill()` (sends SIGTERM on POSIX, terminates on Windows). Mark `timedOut: true` in the result so the caller can distinguish timeout from non-zero exit.
- `exitCode` is `null` when the process is killed before it exits; surface this faithfully rather than coercing to `-1`.
- Store the full `{ stdout, stderr, exitCode, timedOut }` object in the returned result so the process store can display it in the dashboard UI.
- `task.config` is typed as a generic object in the current codebase — cast with `(task.config as any)?.timeoutMs` until a typed config shape is introduced.

## Tests

File: `packages/coc/test/server/queue-executor-bridge.test.ts` (create if absent, otherwise extend).

Test cases:

1. **Happy path** — mock `spawn` returning exit code 0, stdout `"hello\n"`, no stderr. Assert resolved value has `success: true`, `result.stdout === 'hello\n'`, `result.exitCode === 0`.
2. **Non-zero exit** — mock exit code 1. Assert `success: false`, `result.exitCode === 1`.
3. **Timeout kill** — set `task.config.timeoutMs = 50`, mock a process that never closes until killed. Assert resolved value has `timedOut: true`, `success: false`, `result.exitCode === null`.
4. **Spawn error** — mock `child.on('error', ...)` firing. Assert the promise rejects (task is marked failed by the executor harness).
5. **Non-`run-script` task** — confirm `executeByType` still reaches the AI path when given an AI clarification payload (regression guard).

## Acceptance Criteria

- A `run-script` task enqueued through the queue API executes the specified shell command.
- The task result stored in the process store contains `stdout`, `stderr`, and `exitCode`.
- A non-zero exit code causes the task to be marked as failed.
- A task with `config.timeoutMs` set is killed after the timeout and marked failed with `timedOut: true`.
- `run-script` tasks are serialised (exclusive concurrency); they do not appear in `SHARED_TASK_TYPES`.
- All existing queue-executor tests continue to pass.

## Dependencies

- **Depends on commit 001** (`001-define-run-script-payload-type.md`): `RunScriptPayload`, `isRunScriptPayload`, and the `'run-script'` `TargetType` literal must exist before this commit can compile.

## Assumed Prior State

- `RunScriptPayload` interface and `isRunScriptPayload` type guard are exported from the path imported above (established in commit 001).
- `'run-script'` is already registered as a valid `TargetType` union member (commit 001); no further type changes are needed here.
- `QueueExecutorBridge`, `executeByType`, `SHARED_TASK_TYPES`, and `defaultIsExclusive` are in their current form in `packages/coc/src/server/queue-executor-bridge.ts`.
