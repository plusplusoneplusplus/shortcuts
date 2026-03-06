---
status: pending
---

# 001: Add `targetType` to Shared Types

## Summary
Introduce `TargetType = 'prompt' | 'script'` as a discriminator union in `task-types.ts`. Add a `RunScriptPayload` interface (with `kind: 'run-script'`, `script`, `workingDirectory?`, `scheduleId?` fields) and an `isRunScriptPayload` type guard. Register `'run-script'` in the `TaskType` union. Add optional `targetType?: TargetType` to `ScheduleEntry` in `schedule-manager.ts`.

## Motivation
Types must come first because every downstream commit in this feature branch depends on `TargetType` and `RunScriptPayload` being importable. Isolating type changes to a single commit keeps all later commits free of type noise and makes them individually reviewable.

## Changes

### Files to Create
_(none)_

### Files to Modify

- **`packages/coc-server/src/task-types.ts`**
  - Add `TargetType` union: `export type TargetType = 'prompt' | 'script';`
  - Add `'run-script'` to the `TaskType` union (alongside `'custom'`, etc.)
  - Add `RunScriptPayload` interface:
    ```ts
    export interface RunScriptPayload {
        readonly kind: 'run-script';
        script: string;
        workingDirectory?: string;
        scheduleId?: string;
    }
    ```
  - Add `RunScriptPayload` to the `TaskPayload` union
  - Add type guard:
    ```ts
    export function isRunScriptPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & RunScriptPayload {
        return (payload as any).kind === 'run-script';
    }
    ```

- **`packages/coc/src/server/schedule-manager.ts`**
  - Import `TargetType` from `@plusplusoneplusplus/coc-server` (or the relative path `../../../coc-server/src/task-types` depending on build setup)
  - Add optional field to `ScheduleEntry`:
    ```ts
    targetType?: TargetType;   // defaults to 'prompt' when absent
    ```
  - No behavioral change — this is a purely additive type addition.

### Files to Delete
_(none)_

## Implementation Notes

- `targetType` is intentionally **optional** on `ScheduleEntry` so existing persisted schedules with no `targetType` field are treated as `'prompt'` without any migration.
- The `RunScriptPayload.kind` discriminator (`'run-script'`) mirrors the pattern used by `ChatPayload` (`kind: 'chat'`) and `RunPipelinePayload` (`kind: 'run-pipeline'`), making `isRunScriptPayload` reliable and consistent.
- Import path for `TargetType` in `schedule-manager.ts`: prefer the package-level import (`@plusplusoneplusplus/coc-server`) if the package is already a dependency; otherwise use a relative path.
- Do **not** change any runtime logic in this commit — no queue dispatch, no cron triggers, no API routes.

## Tests

- In `packages/coc/test/schedule-manager.test.ts`: add cases that verify a `ScheduleEntry` created without `targetType` remains valid (i.e., `targetType` is `undefined`, treated as `'prompt'` by callers).
- If a test file for `task-types.ts` exists (e.g., `packages/coc-server/test/task-types.test.ts`), add unit tests for `isRunScriptPayload`:
  - returns `true` for `{ kind: 'run-script', script: '...' }`
  - returns `false` for `{ kind: 'chat', prompt: '...' }`
  - returns `false` for payloads with no `kind` field

## Acceptance Criteria

- `TargetType` is exported from `packages/coc-server/src/task-types.ts`
- `RunScriptPayload` interface is exported and includes `kind`, `script`, `workingDirectory?`, `scheduleId?`
- `isRunScriptPayload` returns `true` only when `payload.kind === 'run-script'`
- `'run-script'` is present in the `TaskType` union
- `ScheduleEntry.targetType` is optional (`TargetType | undefined`)
- All existing tests in both packages continue to pass without modification

## Dependencies
None — this is the first commit in the feature sequence.

## Assumed Prior State
The repository is in its current baseline state: `ScheduleEntry` has no `targetType` field, `task-types.ts` has no `RunScriptPayload` or `TargetType`, and `'run-script'` is absent from `TaskType`.
