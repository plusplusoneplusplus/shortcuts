---
status: pending
---

# 003: Update Schedule Manager Dispatch by `targetType`

## Summary
Update `executeRun()` in `ScheduleManager` to branch on `schedule.targetType`: enqueue a `run-script` task when `targetType === 'script'`, and keep the existing `follow-prompt` path for `'prompt'` (or undefined) schedules. Bump `CURRENT_VERSION` in `schedule-persistence.ts` from `1` to `2` and add a forward migration that back-fills `targetType: 'prompt'` on all v1 entries.

## Motivation
`executeRun()` is the single dispatch point that maps a schedule definition to a queue task type. Branching here — rather than in the API layer — is the minimal, focused change needed to support script schedules. Keeping it isolated to this commit means prompt schedules are guaranteed unchanged and the diff is easy to review.

## Changes

### Files to Create
_(none)_

### Files to Modify

#### `packages/coc/src/server/schedule-manager.ts`
- Inside `executeRun()`, replace the hardcoded `type: 'follow-prompt'` enqueue block (currently lines 460-473) with a branch:

  ```ts
  if (!schedule.targetType || schedule.targetType === 'prompt') {
      // existing path — zero behavioral change
      const taskId = this.queueManager.enqueue({
          type: 'follow-prompt',
          priority: 'normal',
          payload: {
              promptFilePath: schedule.target,
              workingDirectory: '',
              scheduleId: schedule.id,
              scheduleParams: schedule.params,
          },
          config: {},
          displayName: `[Schedule] ${schedule.name}`,
          repoId,
      });
      run.processId = `queue_${taskId}`;
  } else if (schedule.targetType === 'script') {
      const taskId = this.queueManager.enqueue({
          type: 'run-script',
          priority: 'normal',
          payload: {
              kind: 'run-script',
              script: schedule.target,
              workingDirectory: schedule.params?.workingDirectory ?? '',
              scheduleId: schedule.id,
          },
          config: {},
          displayName: `[Schedule:script] ${schedule.name}`,
          repoId,
      });
      run.processId = `queue_${taskId}`;
  }
  ```

#### `packages/coc/src/server/schedule-persistence.ts`
- Bump `CURRENT_VERSION` from `1` to `2`.
- In `loadAll()`, replace the hard skip on unknown version with a migration path:
  - If `state.version === 1`: back-fill `targetType: 'prompt'` on every `ScheduleEntry` that lacks it, then treat the result as valid v2 data (continue processing instead of `continue`-skipping).
  - If `state.version` is anything else (i.e., truly unknown/future): keep the existing skip behaviour.

  ```ts
  if (state.version === 1) {
      // forward migration: all existing schedules were prompt-based
      for (const s of state.schedules) {
          if (!s.targetType) {
              (s as ScheduleEntry).targetType = 'prompt';
          }
      }
      // fall through — treat as current
  } else if (state.version !== CURRENT_VERSION) {
      process.stderr.write(
          `[SchedulePersistence] Unknown version ${state.version} in ${file} — skipping\n`
      );
      continue;
  }
  ```

### Files to Delete
_(none)_

## Implementation Notes
- `workingDirectory` for script schedules comes from `schedule.params?.workingDirectory`. If the field is absent or `undefined`, fall back to `''` (empty string) — matching the existing prompt path.
- The `follow-prompt` enqueue block must remain **bit-for-bit identical** to what it is today; no refactoring of that path in this commit.
- `RunScriptPayload` and `isRunScriptPayload` (introduced in 001) are the canonical types for the `run-script` task payload.
- The migration in `loadAll()` does **not** rewrite the file to disk; that happens lazily the next time `saveRepo()` is called for that repo, at which point `CURRENT_VERSION = 2` is written.

## Tests

### `packages/coc/test/schedule-manager.test.ts`
- Add test: when `executeRun()` is called with a schedule where `targetType === 'script'`, `queueManager.enqueue` is called with `type: 'run-script'` and the payload contains `{ kind: 'run-script', script: <target>, workingDirectory: <params.workingDirectory> }`.
- Add test: `displayName` for a script schedule is `[Schedule:script] <name>`.
- Existing tests for `follow-prompt` must continue to pass unchanged.

### `packages/coc/test/schedule-persistence.test.ts`
- Add test: loading a file with `version: 1` succeeds and every returned `ScheduleEntry` has `targetType === 'prompt'`.
- Add test: loading a file with `version: 2` (no migration needed) works as before.
- Add test: loading a file with an unknown future version (e.g., `version: 99`) still logs and skips.

## Acceptance Criteria
1. A schedule with `targetType: 'prompt'` (or no `targetType`) enqueues exactly a `follow-prompt` task — identical to current behaviour.
2. A schedule with `targetType: 'script'` enqueues a `run-script` task with `kind`, `script`, `workingDirectory`, and `scheduleId` in the payload.
3. `displayName` for script schedules is `[Schedule:script] <name>`; for prompt schedules it remains `[Schedule] <name>`.
4. Persisted v1 data loads without error and all entries have `targetType: 'prompt'` after load.
5. All existing schedule-manager and schedule-persistence tests pass.

## Dependencies
- **001** — `TargetType` union type, `RunScriptPayload`, and `isRunScriptPayload` must be defined and exported.
- **002** — `run-script` executor registered with the queue so enqueued tasks can actually execute.

## Assumed Prior State
- `ScheduleEntry` already has a `targetType?: TargetType` field (from 001).
- `RunScriptPayload` (shape: `{ kind: 'run-script'; script: string; workingDirectory: string; scheduleId: string }`) is importable from 001.
- The `run-script` task type is a recognised queue task type (from 002).
- `CURRENT_VERSION` in `schedule-persistence.ts` is currently `1` (confirmed in source).
