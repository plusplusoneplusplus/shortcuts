---
status: done
---

# 002: Per-Item Child Process Creation in Pipeline Executor

## Summary
Extend the pipeline executor to create a child `AIProcess` record for each map item (or batch), linking it to the parent pipeline run via `parentProcessId`. Add an `onItemProcessCreated` callback to `ExecutePipelineOptions` and enrich `PipelineExecutionResult` with child process IDs.

## Motivation
Today the map phase tracks only aggregate counts (totalItems, successfulMaps, failedMaps). Individual item results — including the AI conversation, errors, and output — are lost after execution. By giving each item its own `AIProcess` with `parentProcessId`, we create the data foundation for the workflow detail view where users can drill into individual nodes and resume conversations.

## Changes

### Files to Modify

#### `packages/pipeline-core/src/pipeline/executor.ts`

1. **Add `onItemProcessCreated` to `ExecutePipelineOptions`** (after line 102, inside the interface at lines 81–103):
   ```ts
   /** Callback invoked when a child process is created for an individual map/batch item */
   onItemProcessCreated?: (event: ItemProcessEvent) => void;
   ```

2. **Define `ItemProcessEvent` type** (new type, co-located near `PipelineExecutionResult` around line 156):
   ```ts
   export interface ItemProcessEvent {
       /** Zero-based index of the item in the original input array */
       itemIndex: number;
       /** Generated child process ID */
       processId: string;
       /** The input item being processed */
       item: PromptItem;
       /** Batch index (only present in batch mode) */
       batchIndex?: number;
       /** Which pipeline phase produced this child */
       phase: 'map' | 'job' | 'filter-ai' | 'reduce-ai';
       /** Whether the item succeeded */
       success: boolean;
       /** Error message if the item failed */
       error?: string;
       /** SDK session ID from the AI response (for session resume) */
       sessionId?: string;
   }
   ```

3. **Add `itemProcessIds` to `PipelineExecutionResult`** (extend interface at line 153):
   ```ts
   export interface PipelineExecutionResult extends MapReduceResult<PromptMapResult, PromptMapOutput> {
       filterResult?: FilterResult;
       /** Child process IDs created for individual map/batch items */
       itemProcessIds?: string[];
   }
   ```

4. **Hook into `executeStandardMode`** (lines 798–856):
   - The standard mode delegates to `MapReduceExecutor.execute()` via `createExecutor()` (line 821) which internally calls `executeMapPhase` → `executeMapItem` (MR executor lines 249–315).
   - The MR executor already supports `onItemComplete` callback (MR `types.ts` line 420, invoked at MR `executor.ts` lines 304–310) which fires after each map item with the `WorkItem` and `MapResult` (including `processId` from the process tracker at MR `executor.ts` line 402).
   - **Integration point**: Pass an `onItemComplete` callback in `executorOptions` (line 808) that:
     1. Generates a child process ID: `${config.name}-m${itemIndex}` (using `result.workItemId` to extract the index, or the `WorkItem` index).
     2. Calls `options.onItemProcessCreated` with an `ItemProcessEvent`.
     3. Collects the process ID into a local `itemProcessIds` array.
   - The MR executor's `MapResult` already carries a `processId` from the process tracker (MR `types.ts` line 54), so we can reuse that directly instead of generating our own ID.
   - **Concrete change**: Between lines 818–819 (after `isCancelled` and before closing brace of `executorOptions`), add:
     ```ts
     onItemComplete: (workItem, result) => {
         if (options.onItemProcessCreated && result.processId) {
             const itemIndex = parseInt(workItem.id.replace(/\D/g, ''), 10) || 0;
             options.onItemProcessCreated({
                 itemIndex,
                 processId: result.processId,
                 item: workItem.data as PromptItem,
                 phase: 'map',
                 success: result.success,
                 error: result.error,
                 sessionId: (result.output as any)?.sessionId,
             });
         }
     },
     ```
   - After `executor.execute(job, jobInput)` returns (line 847), attach `itemProcessIds` to the result by collecting them from the `onItemComplete` calls.

5. **Hook into `executeBatchMode`** (lines 901–1223):
   - Batch mode has its own `processBatch` inner function (line 942–1064) that calls `parseBatchResponse` (line 991) to split AI output into per-item `PromptMapResult[]`.
   - **Integration point #1 — after successful `parseBatchResponse`** (line 991–997): iterate `batchResults` and for each item, fire `onItemProcessCreated`. The process ID from the tracker is already available in the local `processId` variable (line 954). Generate per-item IDs as `${processId}-i${indexInBatch}`.
   - **Integration point #2 — after failed AI call** (lines 975–987): the batch maps each item to a failed `PromptMapResult`. Fire `onItemProcessCreated` for each failed item with `success: false`.
   - **Integration point #3 — after retry success** (lines 1027–1046): same pattern as #1.
   - **Integration point #4 — after catch-all failure** (lines 1057–1063): same pattern as #2.
   - Add a closure-scoped `itemProcessIds: string[]` array at the top of `executeBatchMode` (around line 937). Each `onItemProcessCreated` call pushes the ID. At the end (line 1192–1206), spread `itemProcessIds` into the returned `PipelineExecutionResult`.

6. **Hook into `executeSingleJob`** (lines 213–380):
   - Single job mode makes one AI call (line 281). After successful result (line 362), fire `onItemProcessCreated` once with `phase: 'job'`, `itemIndex: 0`.
   - After failed result (line 297), fire with `success: false`.

#### `packages/pipeline-core/src/pipeline/types.ts`

1. **Export `ItemProcessEvent`** — add to the re-exports or define here:
   ```ts
   export type { ItemProcessEvent } from './executor';
   ```
   (Or if we want to keep types in `types.ts`, move the interface definition here and import it in `executor.ts`.)

#### `packages/pipeline-core/src/map-reduce/types.ts` (no changes needed)
   - `MapResult` already has `processId?: string` (line 54).
   - `ItemCompleteCallback` already exists (lines 398–401).
   - `ExecutorOptions.onItemComplete` already exists (line 420).
   - No modifications required in the MR layer.

### Process ID Strategy

| Mode | ID Format | Source |
|------|-----------|--------|
| Standard (1:1) | Reuse `MapResult.processId` from MR executor | `processTracker.registerProcess()` in MR `executeMapItem` (line 355) |
| Batch (N:1) | `${batchProcessId}-i${indexInBatch}` | Derived from batch tracker process (line 956) |
| Job (single) | `${pipelineName}-job-${timestamp}` | Generated in `executeSingleJob` |

For standard mode, the MR executor's `executeMapItem` (MR `executor.ts` lines 352–358) already calls `processTracker.registerProcess()` per item, producing a unique `processId` that flows into `MapResult.processId` (line 402). We simply forward this existing ID through the `onItemProcessCreated` callback — no new process registration needed.

For batch mode, the batch-level `processId` is registered at pipeline `executor.ts` line 956. We derive per-item IDs by appending an item index suffix, since `parseBatchResponse` (line 1332) iterates with `batch.map((item, index) => ...)`.

## Implementation Notes

- The `onItemProcessCreated` callback is fire-and-forget (synchronous call, not awaited) to avoid slowing down the pipeline. The MR executor already wraps `onItemComplete` in a try/catch that swallows errors (MR `executor.ts` lines 307–309), so a throwing callback won't break execution.
- For batch mode: one callback per result item (not per batch), so the consumer always sees item-level granularity. A batch of 10 items produces 10 `ItemProcessEvent` calls.
- The executor itself does NOT persist processes — it just fires the callback. Persistence is the caller's responsibility (Commit 3).
- The `sessionId` from `PromptMapResult.sessionId` (prompt-map-job.ts line 84) or `aiResult.sessionId` is forwarded through the event for session resume support.
- For standard mode, the `onItemComplete` callback in the MR executor receives `WorkItem<PromptMapInput>` where `data` contains the prompt item. The `PromptMapInput` wraps items via `createPromptMapInput()`.

## Tests

- **Unit test**: `executeBatchMode` with 6 items, `batchSize=2` → `onItemProcessCreated` called 6 times with correct `itemIndex` values 0–5 and `batchIndex` values 0, 0, 1, 1, 2, 2.
- **Unit test**: `executeStandardMode` with 3 items → `onItemProcessCreated` called 3 times with `itemIndex` 0, 1, 2.
- **Unit test**: failed items still trigger `onItemProcessCreated` with `success: false` and populated `error`.
- **Unit test**: `PipelineExecutionResult.itemProcessIds` contains all generated IDs matching the count of input items.
- **Unit test**: `onItemProcessCreated` not provided (undefined) → no errors, execution proceeds normally.
- **Unit test**: `executeSingleJob` fires `onItemProcessCreated` once with `phase: 'job'`.
- **Unit test**: `onItemProcessCreated` not called for non-AI phases (input loading, rule-based filter).

## Acceptance Criteria

- [ ] `ExecutePipelineOptions.onItemProcessCreated` callback fires per map item
- [ ] `ItemProcessEvent` includes itemIndex, processId, item reference, phase, success, and error
- [ ] Works in both standard and batch execution modes
- [ ] Works in single-job mode
- [ ] Failed items also trigger the callback (with `success: false` and `error`)
- [ ] `PipelineExecutionResult` includes `itemProcessIds` array
- [ ] No performance regression (callback is synchronous and non-blocking)
- [ ] Existing tests continue to pass (callback is optional)
- [ ] Tests pass on Linux, macOS, Windows

## Dependencies

- Depends on: 001

## Assumed Prior State

- `ProcessFilter` has `parentProcessId` field (from Commit 1)
- `FileProcessStore.getAllProcesses({ parentProcessId })` filters at index level (from Commit 1)
- `AIProcess.parentProcessId` already exists (process-types.ts line 379)
- `AIProcessType` already includes `'pipeline-item'` (process-types.ts line 25)
- `MapResult.processId` already exists in MR types (MR types.ts line 54)
- `ExecutorOptions.onItemComplete` callback already exists (MR types.ts line 420)
