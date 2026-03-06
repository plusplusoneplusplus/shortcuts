---
status: done
---

# 002: Pipeline Executor Phase Emission

## Summary

Instrument the pipeline executor to emit structured phase-change events (`PipelinePhaseEvent`) and progress events (`PipelineProgressEvent`) at every phase boundary — input, filter, map, reduce, and completion — so downstream consumers (the CoC server, the DAG visualization UI) can render real-time pipeline state.

## Motivation

Commit 001 defined the event types (`PipelinePhaseEvent`, `PipelineProgressEvent`, `PipelineProcessMetadata`) but nothing emits them yet. This commit wires the actual call-sites so every pipeline execution broadcasts its lifecycle. It is a separate commit because the emission logic touches four files across two packages and is the bridge between the type definitions (001) and the server/UI consumers (003+).

## Changes

### Files to Create

- `packages/pipeline-core/test/pipeline/executor-phase-events.test.ts` — Dedicated test file for phase emission behavior

### Files to Modify

- `packages/pipeline-core/src/pipeline/types.ts` — Add `onPhaseChange` callback to `ExecutePipelineOptions` (re-exported from `../map-reduce`)
- `packages/pipeline-core/src/pipeline/executor.ts` — Call `onPhaseChange` at every phase transition in `executePipeline()`, `executeWithItems()`, `executeBatchMode()`, and `executeSingleJob()`
- `packages/pipeline-core/src/map-reduce/executor.ts` — Forward phase events through `reportProgress()` to a new `onPhaseChange` option in `ExecutorOptions`
- `packages/coc/src/server/queue-executor-bridge.ts` — In `executeRunPipeline()`, pass an `onPhaseChange` callback that calls `store.emitProcessEvent()` with a `pipeline-phase` typed `ProcessOutputEvent`

### Files to Delete

(none)

## Implementation Notes

### 1. `ExecutePipelineOptions` — add callback (types.ts / executor.ts)

The `ExecutePipelineOptions` interface is defined at **executor.ts:79–99**. Add:

```ts
/** Callback invoked at each pipeline phase transition (input/filter/map/reduce/complete) */
onPhaseChange?: (event: PipelinePhaseEvent) => void;
```

This mirrors the existing `onProgress?: (progress: JobProgress) => void` pattern at line 96.

### 2. `executePipeline()` — input phase events (executor.ts:124–150)

The entry point at line 124 calls `loadInputItems()` (line 143) then `prepareItems()` (line 146). Insert phase events around these:

- **Before line 143** (`loadInputItems`): emit `{ phase: 'input', status: 'started', timestamp }`.
- **After line 143** (successful return): emit `{ phase: 'input', status: 'completed', timestamp, stats: { totalItems: items.length } }`.
- **Catch block around loadInputItems**: emit `{ phase: 'input', status: 'failed', timestamp, error }` then re-throw.

Also applies to `executePipelineWithItems()` at line 426, which skips `loadInputItems()` but still calls `prepareItems()` — emit input-completed with the provided items count.

### 3. `executeWithItems()` — filter + routing (executor.ts:666–725)

This function orchestrates filter → batch-or-standard routing.

**Filter phase** (lines 676–713):
- **Before line 678** (`executeFilter()` call): emit `{ phase: 'filter', status: 'started', timestamp, stats: { totalItems: processItems.length } }`.
- **After line 693** (successful filter): emit `{ phase: 'filter', status: 'completed', timestamp, stats: { totalItems: filterResult.stats.totalItems, includedItems: filterResult.stats.includedCount, excludedItems: filterResult.stats.excludedCount, executionTimeMs: filterResult.stats.executionTimeMs } }`.
- **Catch at line 704**: emit `{ phase: 'filter', status: 'failed', timestamp, error }` before re-throwing.

### 4. `executeStandardMode()` — delegate to map-reduce executor (executor.ts:730–787)

In standard mode, map/reduce phases are handled by `MapReduceExecutor.execute()` (line 779). The map-reduce executor already calls `reportProgress()` with `phase: 'splitting' | 'mapping' | 'reducing' | 'complete'` (see map-reduce/executor.ts lines 75, 105, 139, 206, 294).

Two approaches (prefer option A for minimal diff):

**Option A — Translate `onProgress` into `onPhaseChange`**: Wrap the existing `options.onProgress` to detect phase transitions. When `JobProgress.phase` changes from one value to another, emit the corresponding `PipelinePhaseEvent`. Specifically:
- `'splitting'` → emit `{ phase: 'map', status: 'started' }` (first time only)
- `'mapping'` with percentage changes → emit `PipelineProgressEvent` via `onProgress` (already handled)
- `'reducing'` → emit `{ phase: 'map', status: 'completed' }` then `{ phase: 'reduce', status: 'started' }`
- `'complete'` → emit `{ phase: 'reduce', status: 'completed' }`

This translation can be done inline in `executeStandardMode()` at lines 740–751 where `ExecutorOptions` is constructed.

**Option B — Add `onPhaseChange` to `ExecutorOptions`**: Add an optional `onPhaseChange` callback to the map-reduce `ExecutorOptions` (types.ts:404) and call it from `MapReduceExecutor.execute()` at the same spots `reportProgress()` is called. This is cleaner but touches more files.

**Recommendation: Option A.** It keeps the map-reduce executor unaware of pipeline-specific concerns. Create a helper function `createPhaseTrackingProgress()` that wraps the original `onProgress` and detects phase transitions:

```ts
function createPhaseTrackingProgress(
    options: ExecutePipelineOptions,
    totalItems: number
): (progress: JobProgress) => void {
    let lastPhase: string | undefined;
    return (progress: JobProgress) => {
        // Forward original progress
        options.onProgress?.(progress);
        // Detect phase transitions
        if (progress.phase !== lastPhase) {
            const prev = lastPhase;
            lastPhase = progress.phase;
            // Map MR phases to pipeline phases
            if (progress.phase === 'mapping' && prev === 'splitting') {
                options.onPhaseChange?.({ phase: 'map', status: 'started', timestamp: Date.now(), stats: { totalItems } });
            } else if (progress.phase === 'reducing') {
                options.onPhaseChange?.({ phase: 'map', status: 'completed', timestamp: Date.now(), stats: { ... } });
                options.onPhaseChange?.({ phase: 'reduce', status: 'started', timestamp: Date.now() });
            } else if (progress.phase === 'complete') {
                options.onPhaseChange?.({ phase: 'reduce', status: 'completed', timestamp: Date.now() });
            }
        }
    };
}
```

Then use it at line 747: `onProgress: createPhaseTrackingProgress(options, processItems.length)`.

### 5. `executeBatchMode()` — direct phase emission (executor.ts:832–1140)

Batch mode manages its own map/reduce loop without the map-reduce executor. It already calls `options.onProgress` at lines 856, 1019, 1053, 1100. Add direct `onPhaseChange` calls:

- **Before line 856** (initial progress): emit `{ phase: 'map', status: 'started', timestamp, stats: { totalItems: processItems.length, totalBatches } }`.
- **After line 1044** (`Promise.all(batchPromises)` completes): emit `{ phase: 'map', status: 'completed', timestamp, stats: { successfulMaps, failedMaps, mapPhaseTimeMs } }`.
- **Before line 1068** (`executeReducePhase`): emit `{ phase: 'reduce', status: 'started', timestamp }`.
- **After line 1077** (reduce complete): emit `{ phase: 'reduce', status: 'completed', timestamp, stats: { reducePhaseTimeMs } }`.
- **At line 1100** (complete progress): emit `{ phase: 'complete', status: 'completed', timestamp, stats: executionStats }` — or use a dedicated `onPhaseChange` emission rather than piggy-backing on `onProgress`.

### 6. `executeSingleJob()` — job mode phase events (executor.ts:155–413)

The single-job path skips input/filter/map/reduce phases but should still emit:
- `{ phase: 'map', status: 'started' }` before the AI call at line 221.
- `{ phase: 'map', status: 'completed' }` or `{ phase: 'map', status: 'failed' }` based on the result.
- No filter/reduce phases for job mode.

### 7. Error wrapping

Wrap every phase in a try/catch that emits `{ status: 'failed', error: message }` before re-throwing. The `PipelineExecutionError` at line 50 already carries `phase` (line 52), so use that to determine which phase event to emit in catch blocks.

### 8. `queue-executor-bridge.ts` — wire to process store (lines 733–786)

The `executeRunPipeline()` method at line 733 calls `executePipeline()` at line 775. Currently it only passes `aiInvoker`, `pipelineDirectory`, and `workspaceRoot`. Add:

```ts
const processId = `queue_${task.id}`;
const result = await executePipeline(config, {
    aiInvoker,
    pipelineDirectory: payload.pipelinePath,
    workspaceRoot: payload.workingDirectory,
    onPhaseChange: (event) => {
        try {
            this.store.emitProcessEvent(processId, {
                type: 'pipeline-phase',
                phase: event.phase,
                status: event.status,
                stats: event.stats,
                error: event.error,
                timestamp: event.timestamp,
            });
        } catch {
            // Non-fatal: store may be a stub
        }
    },
    onProgress: (progress) => {
        try {
            this.store.emitProcessEvent(processId, {
                type: 'pipeline-progress',
                phase: progress.phase,
                totalItems: progress.totalItems,
                completedItems: progress.completedItems,
                failedItems: progress.failedItems,
                percentage: progress.percentage,
                message: progress.message,
            });
        } catch {
            // Non-fatal
        }
    },
});
```

This follows the exact same `try/catch { // Non-fatal }` pattern used for `onStreamingChunk` at line 624 and `onToolEvent` at line 655.

Note: The `processId` variable must be derived from `task.id` using the same `queue_${task.id}` convention used in `executeWithAI()` at line 580. Currently `executeRunPipeline()` does not compute a `processId` — this is the gap identified in the task description.

### 9. `ProcessOutputEvent` extension (process-store.ts:16)

The `ProcessOutputEvent` type union at line 17 needs the `'pipeline-phase' | 'pipeline-progress'` types added (done in commit 001). Verify the additional fields (`phase`, `status`, `stats`, `timestamp`, `percentage`, `totalItems`, `completedItems`, `failedItems`) are present on the interface. If commit 001 only added the type discriminants without the fields, add them as optional fields in this commit.

### 10. Metadata population (optional, can defer to commit 003)

After pipeline completion in `executeRunPipeline()`, populate `PipelineProcessMetadata` on the process record via `store.updateProcess(processId, { metadata: { ... } })`. This includes:
- `phaseTimings`: collected from `onPhaseChange` timestamps
- `pipelinePhases`: the ordered list of phases executed
- `inputItemCount`: from input phase stats
- `filterStats`: from filter phase stats

Implementation: accumulate phase events in a local array within `executeRunPipeline()`, then compute metadata from them after `executePipeline()` returns. This can be deferred to commit 003 if the process store `updateProcess` API needs metadata field additions.

## Tests

### Unit tests (`executor-phase-events.test.ts`)

- **`executePipeline emits input started/completed events`**: Mock `aiInvoker`, provide inline items, assert `onPhaseChange` is called with `{ phase: 'input', status: 'started' }` then `{ phase: 'input', status: 'completed', stats: { totalItems: N } }`.
- **`executePipeline emits filter started/completed events when filter configured`**: Provide a rule-based filter config, assert filter phase events with correct `includedItems`/`excludedItems` stats.
- **`executePipeline emits map started/completed events in standard mode`**: Verify map phase events bracket the map execution with correct `totalItems`.
- **`executePipeline emits reduce started/completed events`**: Verify reduce phase events bracket the reduce execution.
- **`executePipeline emits complete event on success`**: Verify the terminal `complete` event is emitted.
- **`executePipeline emits failed event on error`**: Force an error (e.g., invalid CSV path) and verify `{ status: 'failed' }` is emitted for the correct phase.
- **`executeBatchMode emits phase events`**: Use `batchSize > 1` config, verify map/reduce phase events.
- **`executeSingleJob emits map started/completed events`**: Job mode should emit map phase events.
- **`onProgress receives pipeline-progress events during map phase`**: Verify `onProgress` is called with incremental progress during mapping.
- **`phase events have monotonically increasing timestamps`**: Collect all emitted events, verify timestamps are non-decreasing.
- **`no onPhaseChange callback = no errors`**: Verify pipeline executes normally when `onPhaseChange` is undefined.

### Integration test (in existing executor test file)

- **`queue-executor-bridge emits pipeline-phase events to store`**: Mock the process store, execute a pipeline through the bridge, assert `emitProcessEvent` was called with `type: 'pipeline-phase'` events.

## Acceptance Criteria

- [ ] `ExecutePipelineOptions.onPhaseChange` callback is defined and optional
- [ ] `executePipeline()` emits input started/completed phase events around `loadInputItems()`
- [ ] `executeWithItems()` emits filter started/completed phase events around `executeFilter()` when a filter is configured
- [ ] `executeStandardMode()` emits map/reduce phase events via the `onProgress` → `onPhaseChange` translation layer
- [ ] `executeBatchMode()` emits map started/completed and reduce started/completed phase events directly
- [ ] `executeSingleJob()` emits map started/completed or failed events
- [ ] Every phase emits a `failed` event on error before re-throwing
- [ ] `queue-executor-bridge.ts` `executeRunPipeline()` wires `onPhaseChange` to `store.emitProcessEvent()` with `type: 'pipeline-phase'`
- [ ] `queue-executor-bridge.ts` `executeRunPipeline()` wires `onProgress` to `store.emitProcessEvent()` with `type: 'pipeline-progress'`
- [ ] All existing tests continue to pass (no regressions)
- [ ] New tests cover all phase transitions for standard mode, batch mode, job mode, and error scenarios
- [ ] Phase events include accurate timestamps and statistics

## Dependencies

- Depends on: 001 (type definitions for `PipelinePhaseEvent`, `PipelineProgressEvent`, `PipelineProcessMetadata`, and `ProcessOutputEvent` extended with `'pipeline-phase' | 'pipeline-progress'`)

## Assumed Prior State

`ProcessOutputEvent` at `process-store.ts:16` has been extended with `'pipeline-phase' | 'pipeline-progress'` type discriminants and corresponding optional fields. `PipelinePhaseEvent`, `PipelineProgressEvent`, and `PipelineProcessMetadata` types are defined in `pipeline-core/src/pipeline/types.ts` and exported from `pipeline-core/src/index.ts`.
