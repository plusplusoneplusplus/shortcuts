---
status: pending
---

# 001: Pipeline Phase Types & ProcessOutputEvent Extension

## Summary

Extend the `ProcessOutputEvent` discriminated union with two new event types (`pipeline-phase` and `pipeline-progress`) and introduce pipeline phase tracking types in the pipeline types module, establishing the type foundation for DAG visualization of pipeline execution.

## Motivation

This is the first commit in a 6-commit series for the Pipeline DAG Visualization feature. All subsequent commits (SSE streaming, dashboard UI, DAG rendering, interactivity, and polish) depend on a stable, well-designed type foundation. Isolating the types into their own commit ensures the interfaces can be reviewed and agreed upon before any runtime behavior changes, and keeps the diff minimal and focused.

## Changes

### Files to Create

- `packages/pipeline-core/test/pipeline-phase-types.test.ts` — Type construction and type-guard tests for the new interfaces and event types. Follows the existing Vitest pattern seen in `file-process-store.test.ts` (line 7: `import { describe, it, expect } from 'vitest'`).

### Files to Modify

- **`packages/pipeline-core/src/process-store.ts`** (lines 16–44)
  - Extend the `ProcessOutputEvent.type` union from `'chunk' | 'complete' | 'tool-start' | 'tool-complete' | 'tool-failed' | 'permission-request'` to also include `'pipeline-phase' | 'pipeline-progress'`.
  - Add two new optional fields to `ProcessOutputEvent`:
    - `pipelinePhase?: PipelinePhaseEvent` — populated when `type === 'pipeline-phase'`
    - `pipelineProgress?: PipelineProgressEvent` — populated when `type === 'pipeline-progress'`
  - Import the new types from `./pipeline/types` (or re-export path — see Implementation Notes).

- **`packages/pipeline-core/src/pipeline/types.ts`** (after line 437, after `FilterResult`)
  - Add `PipelinePhase` type alias: `'input' | 'filter' | 'map' | 'reduce' | 'job'`. This mirrors the existing inline union in `executor.ts` line 52 (`PipelineExecutionError.phase`).
  - Add `PipelinePhaseStatus` type alias: `'started' | 'completed' | 'failed'`.
  - Add `PipelinePhaseEvent` interface:
    ```ts
    interface PipelinePhaseEvent {
      phase: PipelinePhase;
      status: PipelinePhaseStatus;
      timestamp: string;         // ISO 8601
      durationMs?: number;       // present when status is 'completed' or 'failed'
      error?: string;            // present when status is 'failed'
      itemCount?: number;        // items entering this phase
    }
    ```
  - Add `PipelineProgressEvent` interface:
    ```ts
    interface PipelineProgressEvent {
      phase: PipelinePhase;
      totalItems: number;
      completedItems: number;
      failedItems: number;
      percentage: number;        // 0-100, mirrors JobProgress (map-reduce/types.ts line 224)
      message?: string;
    }
    ```
    This intentionally mirrors the shape of `JobProgress` (map-reduce/types.ts lines 214–227) but is scoped to the pipeline level rather than the map-reduce executor.
  - Add `PipelinePhaseInfo` interface (for post-execution metadata on completed processes):
    ```ts
    interface PipelinePhaseInfo {
      phase: PipelinePhase;
      status: PipelinePhaseStatus;
      startedAt: string;         // ISO 8601
      completedAt?: string;      // ISO 8601
      durationMs?: number;
      itemCount?: number;
      error?: string;
    }
    ```
  - Add `PipelineProcessMetadata` interface (attached to completed process records):
    ```ts
    interface PipelineProcessMetadata {
      pipelinePhases: PipelinePhaseInfo[];
      phaseTimings: Record<PipelinePhase, number>;  // phase → durationMs
      inputItemCount?: number;
      filterStats?: FilterStats;                    // re-use existing FilterStats (line 414)
    }
    ```

- **`packages/pipeline-core/src/pipeline/index.ts`** (lines 9–43)
  - Add the new types to the `export type { ... } from './types'` block:
    - `PipelinePhase`
    - `PipelinePhaseStatus`
    - `PipelinePhaseEvent`
    - `PipelineProgressEvent`
    - `PipelinePhaseInfo`
    - `PipelineProcessMetadata`

- **`packages/pipeline-core/src/index.ts`**
  - Ensure the new types are re-exported through the main barrel. The pipeline types are already re-exported via `packages/pipeline-core/src/pipeline/index.ts`, which chains to `src/index.ts`. Verify the existing `export { ... } from './pipeline'` block includes the new type names, or add them.

### Files to Delete

(none)

## Implementation Notes

1. **Discriminated union pattern:** `ProcessOutputEvent` (process-store.ts:16–44) uses a flat discriminated union on `type` with optional fields per variant. The new `pipeline-phase` and `pipeline-progress` events follow this same pattern — new optional fields (`pipelinePhase`, `pipelineProgress`) that are present only for the corresponding `type` values. This keeps backward compatibility since existing consumers only switch on types they know.

2. **Reuse of existing phase union:** The phase values `'input' | 'filter' | 'map' | 'reduce' | 'job'` already appear as an inline union in `executor.ts` line 52 (`PipelineExecutionError.phase`). The new `PipelinePhase` type alias should be extracted so that `PipelineExecutionError` can reference it too. However, to keep this commit minimal, do NOT refactor `PipelineExecutionError` yet — just ensure the type alias values match exactly.

3. **Import direction:** `process-store.ts` currently has zero imports from `./pipeline/`. Adding an import would create a new dependency edge from the store layer to the pipeline layer. To avoid circular dependencies, the new `PipelinePhaseEvent` and `PipelineProgressEvent` types used by `ProcessOutputEvent` should be defined in `pipeline/types.ts` and imported as `import type` (type-only import) in `process-store.ts`. Since `process-store.ts` is a pure interface file with no runtime code from pipeline, `import type` keeps the boundary clean.

4. **Mirror of `JobProgress`:** The new `PipelineProgressEvent` mirrors `JobProgress` (map-reduce/types.ts:214–227) which has `phase: 'splitting' | 'mapping' | 'reducing' | 'complete'`, `totalItems`, `completedItems`, `failedItems`, `percentage`, `message`. The pipeline-level progress uses `PipelinePhase` instead of the map-reduce phase values, and is emitted as a `ProcessOutputEvent` (streamed via SSE) rather than via callback.

5. **`ExecutionStats` alignment:** The existing `ExecutionStats` interface (map-reduce/types.ts:252–265) tracks `mapPhaseTimeMs` and `reducePhaseTimeMs`. The new `PipelineProcessMetadata.phaseTimings` is a superset covering all five phases. Commit 2 will wire up the emission; this commit only defines the shape.

6. **`FilterStats` reuse:** `PipelineProcessMetadata.filterStats` directly reuses the existing `FilterStats` interface (pipeline/types.ts:414–425) — no new type needed.

7. **No runtime changes in this commit.** Only type definitions and exports. No executor logic, no SSE changes, no dashboard code.

## Tests

- **`packages/pipeline-core/test/pipeline-phase-types.test.ts`**:
  - **ProcessOutputEvent construction with `'pipeline-phase'` type:** Verify an object with `type: 'pipeline-phase'` and a populated `pipelinePhase` field satisfies the `ProcessOutputEvent` type and has expected field values.
  - **ProcessOutputEvent construction with `'pipeline-progress'` type:** Same for `type: 'pipeline-progress'` with a populated `pipelineProgress` field.
  - **PipelinePhaseEvent construction:** Create a `PipelinePhaseEvent` with each `PipelinePhase` value (`'input'`, `'filter'`, `'map'`, `'reduce'`, `'job'`) and each `PipelinePhaseStatus` value (`'started'`, `'completed'`, `'failed'`).
  - **PipelineProgressEvent construction:** Create with boundary values (0%, 100%, partial).
  - **PipelineProcessMetadata construction:** Create with a realistic `pipelinePhases` array and `phaseTimings` record, including optional `filterStats`.
  - **Backward compatibility:** Verify existing `ProcessOutputEvent` types (`'chunk'`, `'complete'`, `'tool-start'`, etc.) still construct without the new optional fields.

## Acceptance Criteria

- [ ] `ProcessOutputEvent.type` union includes `'pipeline-phase'` and `'pipeline-progress'`
- [ ] `ProcessOutputEvent` has optional `pipelinePhase` and `pipelineProgress` fields
- [ ] `PipelinePhase` type alias exported from `pipeline/types.ts` with values `'input' | 'filter' | 'map' | 'reduce' | 'job'`
- [ ] `PipelinePhaseStatus` type alias exported with values `'started' | 'completed' | 'failed'`
- [ ] `PipelinePhaseEvent` interface exported with `phase`, `status`, `timestamp`, optional `durationMs`, `error`, `itemCount`
- [ ] `PipelineProgressEvent` interface exported with `phase`, `totalItems`, `completedItems`, `failedItems`, `percentage`, optional `message`
- [ ] `PipelinePhaseInfo` interface exported for post-execution metadata
- [ ] `PipelineProcessMetadata` interface exported with `pipelinePhases`, `phaseTimings`, optional `inputItemCount`, `filterStats`
- [ ] All new types re-exported through `pipeline/index.ts` and `src/index.ts`
- [ ] All existing tests still pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] New type construction tests pass
- [ ] No circular dependency introduced (verified by successful build)

## Dependencies

- Depends on: None

## Assumed Prior State

None — this is the first commit.
