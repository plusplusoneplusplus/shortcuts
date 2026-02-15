---
status: pending
dependencies:
  - 003
  - 004
---

# 007 — Output File Cleanup Alongside Process Pruning

## Problem

When `FileProcessStore.pruneIfNeeded()` removes old processes (500 max retention),
their corresponding output files in `~/.coc/outputs/` become orphaned. The same
happens when `removeProcess()` or `clearProcesses()` is called. Over time this
causes unbounded disk growth.

## Context

### Pruning logic (`packages/pipeline-core/src/file-process-store.ts`)

`pruneIfNeeded()` (line 288) is called inside `addProcess()`. It separates entries
into non-terminal (`running`/`queued`) and terminal, sorts terminal by `startTime`
ascending, and keeps only the newest terminal entries that fit within `maxProcesses`
minus non-terminal count. The pruned entries are silently discarded — no hook or
event is emitted for the removed processes.

`removeProcess()` (line 142) splices one entry and emits `process-removed`.
`clearProcesses()` (line 157) removes matching entries and emits
`processes-cleared`.

Neither method references output files on disk.

### Output file creation (`packages/coc/src/server/queue-executor-bridge.ts`)

`CLITaskExecutor.execute()` creates an `AIProcess` with id `queue-{task.id}`.
After task 003, each process stores its raw stdout at a `rawStdoutFilePath`
inside `~/.coc/outputs/`. These files are written during streaming via
`onStreamingChunk` and finalised on completion. Nothing currently deletes them.

## Approach

### Option A — `OutputPruner` utility in CoC (recommended)

Create `packages/coc/src/server/output-pruner.ts`:

1. **Startup cleanup** — On server boot, scan `~/.coc/outputs/` and compare file
   names against process IDs in the store. Delete files whose process no longer
   exists.
2. **Event-driven cleanup** — Subscribe to `ProcessStore.onProcessChange`. On
   `process-removed` and `processes-cleared` events, delete the associated output
   file(s) using the `rawStdoutFilePath` from the removed process.
3. **Prune hook** — Wrap or extend `FileProcessStore.addProcess()` so that after
   `pruneIfNeeded()` runs, the IDs of pruned entries are collected and their output
   files deleted. This can be done by:
   - Subclassing `FileProcessStore` in CoC to override `addProcess()`, diffing
     entries before/after prune to identify removed IDs.
   - Or adding an optional `onPrune` callback to `FileProcessStore` (preferred if
     pipeline-core changes are acceptable).
4. **Queue file cleanup** — Also purge `~/.coc/queue.json` entries whose process
   ID no longer exists in the store.
5. **Periodic sweep** — Optionally run the orphan scan on a timer (e.g. every
   60 minutes) as a safety net.

### Option B — Extend `FileProcessStore` in pipeline-core

Add output file deletion directly into `removeProcess()`, `clearProcesses()`, and
`pruneIfNeeded()`. Simpler but couples pipeline-core to CoC's output directory
convention. Only choose this if the `rawStdoutFilePath` field is added to
`AIProcess` metadata in pipeline-core.

### Recommendation

Option A keeps pipeline-core generic and puts CoC-specific disk management in CoC.

## Changes

### New file: `packages/coc/src/server/output-pruner.ts`

```
export class OutputPruner {
  constructor(store: FileProcessStore, outputDir: string)

  /** Scan outputDir, delete files not matching any process ID in store */
  async cleanupOrphans(): Promise<number>

  /** Delete the output file for a single process ID */
  async deleteOutputFile(processId: string): Promise<void>

  /** Subscribe to store events for automatic cleanup */
  startListening(): void

  /** Unsubscribe */
  stopListening(): void
}
```

### Modified: `packages/pipeline-core/src/file-process-store.ts`

- Add optional `onPrune?: (prunedEntries: StoredProcessEntry[]) => void` to
  `FileProcessStoreOptions`.
- In `pruneIfNeeded()`, compute the removed entries (diff between input and
  output arrays) and call `this.onPrune?.(removed)`.
- This is a non-breaking, additive change.

### Modified: `packages/coc/src/server/serve.ts` (or equivalent startup)

- Instantiate `OutputPruner` during server startup.
- Call `cleanupOrphans()` once on boot.
- Call `startListening()` to wire event-driven cleanup.

### Modified: `packages/coc/src/server/queue-executor-bridge.ts`

- No direct changes required — output files are created by task 003.
- Ensure `rawStdoutFilePath` is stored in `AIProcess.metadata` so `OutputPruner`
  can locate it.

## Tests

### `packages/coc/test/output-pruner.test.ts`

| # | Test | Assertion |
|---|------|-----------|
| 1 | Remove process deletes output file | After `removeProcess(id)`, file at `outputs/{id}.txt` no longer exists |
| 2 | Orphan cleanup on startup | Create output files for IDs not in store → `cleanupOrphans()` deletes them |
| 3 | Active process files preserved | Output files for running/queued processes are NOT deleted during cleanup |
| 4 | Prune cascade deletes output files | Add >500 processes → verify pruned process output files are deleted |
| 5 | `clearProcesses()` cleans output files | After filtered clear, matching output files are removed |
| 6 | Queue.json stale entries removed | Entries in `queue.json` referencing non-existent processes are purged |
| 7 | Missing output file is no-op | Deleting output for a process with no file does not throw |

### `packages/pipeline-core/test/file-process-store-prune-hook.test.ts`

| # | Test | Assertion |
|---|------|-----------|
| 1 | `onPrune` callback fires with pruned entries | Add 510 entries (max 500), callback receives 10 oldest terminal entries |
| 2 | `onPrune` not called when under limit | Add 100 entries, callback never fires |
| 3 | Non-terminal entries never pruned | 500 running + 10 terminal → only terminal pruned |

## Acceptance Criteria

- [ ] Output files deleted when parent process is removed via `removeProcess()`
- [ ] Output files deleted when processes are cleared via `clearProcesses()`
- [ ] Pruned processes' output files are deleted during `pruneIfNeeded()`
- [ ] Orphaned output files cleaned up on server startup
- [ ] No unbounded disk growth in `~/.coc/outputs/`
- [ ] Active/running process output files are never deleted during cleanup
- [ ] Stale `queue.json` entries cleaned up
- [ ] All tests pass on Linux, macOS, and Windows
