# Fix: WorkflowDetailView Shows "No pipeline data available"

## Problem

When navigating to `#repos/{id}/workflow/{processId}` for a `queue-run-pipeline` process,
`WorkflowDetailView` renders the message "No pipeline data available." instead of the DAG chart.

**Root cause:** `buildDAGData` reads `process.metadata.executionStats` and
`process.metadata.pipelinePhases` to determine pipeline shape. For processes executed via the
queue (`queue-run-pipeline` type), neither field is ever written — the server stores execution
stats only inside `process.result` (as a JSON-encoded string `{ response, pipelineName, stats }`).
The client-side `buildDAGData` never parses `process.result`, so it always returns `null` for
these processes.

**Also:** `process.metadata.pipelineConfig` is never set for queue-run-pipeline processes either,
so the `WorkflowDetailView` header also cannot show map concurrency or other config details.

---

## Data Flow (current vs desired)

| Field | Written by | Where stored | Read by buildDAGData |
|---|---|---|---|
| `metadata.executionStats` | `coc run` CLI only | `metadata` | ✅ yes |
| `metadata.pipelinePhases` | nobody | — | ✅ yes |
| `result` (JSON string) | `queue-executor-bridge.ts:363` | `result` | ❌ never |

**After fix:**

`queue-executor-bridge.ts` writes `metadata.executionStats` and `metadata.pipelineConfig` at
completion, so `buildDAGData` finds them in the standard location — zero changes to the client.

---

## Approach: Fix the Write Side (server), not the Read Side (client)

The cleanest fix is in `queue-executor-bridge.ts` → `executeRunPipeline()`:
after `executePipeline()` resolves, call `updateProcess` with the enriched metadata fields
**before** returning. This keeps all existing client logic untouched.

A secondary client-side fallback in `buildDAGData` is added as belt-and-suspenders for
**already-stored processes** (data that was persisted before this fix is deployed).

---

## Changes

### 1. `packages/coc/src/server/queue-executor-bridge.ts` — write metadata on completion

In `executeRunPipeline()`, after `executePipeline()` resolves and before `return`, add a
`updateProcess` call that persists the stats and config into metadata:

```ts
// After line 1217 (executePipeline returns)
// Persist execution stats and pipeline config into metadata so WorkflowDetailView can render
await this.store.updateProcess(processId, {
    metadata: {
        // spread existing fields (type, queueTaskId, pipelineName, etc.)
        ...((await this.store.getProcess(processId))?.metadata ?? {}),
        executionStats: result.executionStats,
        pipelineConfig: config,                // full parsed PipelineConfig
        pipelinePhases: result.phaseTimeline,  // if available from PipelineExecutionResult
    },
}).catch(() => {});
```

Check whether `PipelineExecutionResult` already exposes `phaseTimeline`; if not, skip that field
for now (stats alone is sufficient for the DAG to render).

**Important:** This `updateProcess` fires concurrently with the `groupMetadata` update at line
1220 — keep them separate to avoid races. Use `.catch(() => {})` so it's non-fatal.

---

### 2. `packages/coc/src/server/spa/client/react/processes/dag/buildDAGData.ts` — client fallback

For processes stored before the server fix, parse `process.result` as a fallback:

```ts
// After line 80 (const metadata = process?.metadata)
// Fallback: queue-run-pipeline stores stats in result JSON when metadata lacks them
let stats = metadata?.executionStats;
if (!stats && process?.result) {
    try {
        const parsed = typeof process.result === 'string'
            ? JSON.parse(process.result)
            : process.result;
        if (parsed?.stats) stats = parsed.stats;
    } catch { /* ignore */ }
}
```

Then replace the `const stats = metadata.executionStats` at line 81 with the `let stats` above,
and use the `stats` variable throughout the rest of the function (no other changes needed — the
variable name is the same).

---

### 3. `packages/coc/test/spa/react/dag/buildDAGData.test.ts` — new test cases

Add tests for the fallback path:

```ts
it('returns DAG data when stats are in process.result JSON string (queue-run-pipeline)', () => {
    const proc = {
        id: 'queue_123',
        type: 'queue-run-pipeline',
        status: 'completed',
        durationMs: 13191,
        metadata: { type: 'queue-run-pipeline', pipelineName: 'git-fetch' },
        result: JSON.stringify({
            response: '`git fetch` completed successfully',
            pipelineName: 'git-fetch',
            stats: {
                totalItems: 1,
                successfulMaps: 1,
                failedMaps: 0,
                mapPhaseTimeMs: 13191,
                reducePhaseTimeMs: 0,
                maxConcurrency: 1,
            },
        }),
    };
    const result = buildDAGData(proc);
    expect(result).not.toBeNull();
    expect(result!.nodes.map(n => n.phase)).toContain('map');
});

it('returns null when result JSON has no stats field', () => {
    const proc = {
        id: 'queue_456',
        status: 'completed',
        metadata: { type: 'queue-run-pipeline' },
        result: JSON.stringify({ response: 'hello' }),
    };
    expect(buildDAGData(proc)).toBeNull();
});

it('returns null when result is malformed JSON', () => {
    const proc = {
        id: 'queue_789',
        status: 'completed',
        metadata: {},
        result: 'not-json',
    };
    expect(buildDAGData(proc)).toBeNull();
});
```

---

### 4. `packages/coc/test/server/queue-executor-bridge.test.ts` — verify metadata is written

Add a test that verifies `executeRunPipeline` writes `executionStats` into metadata:

```ts
it('persists executionStats to process metadata after pipeline execution', async () => {
    // Setup: mock executePipeline to return a result with executionStats
    mockExecutePipeline.mockResolvedValueOnce({
        success: true,
        output: { formattedOutput: 'done' },
        executionStats: { totalItems: 3, successfulMaps: 3, failedMaps: 0, mapPhaseTimeMs: 5000 },
        itemProcessIds: [],
    });
    // ... run a queue task of type run-pipeline ...
    // Assert: store.updateProcess was called with metadata containing executionStats
    expect(mockStore.updateProcess).toHaveBeenCalledWith(
        expect.stringContaining('queue_'),
        expect.objectContaining({
            metadata: expect.objectContaining({
                executionStats: expect.objectContaining({ totalItems: 3 }),
            }),
        })
    );
});
```

---

## Files to Change

| File | Change type |
|---|---|
| `packages/coc/src/server/queue-executor-bridge.ts` | Add `updateProcess` call writing `executionStats` + `pipelineConfig` to metadata |
| `packages/coc/src/server/spa/client/react/processes/dag/buildDAGData.ts` | Add `process.result` fallback for `stats` |
| `packages/coc/test/spa/react/dag/buildDAGData.test.ts` | Add 3 new test cases |
| `packages/coc/test/server/queue-executor-bridge.test.ts` | Add 1 new test case |

---

## Todos

1. Inspect `PipelineExecutionResult` type in pipeline-core — check if `phaseTimeline` or similar field exists to populate `metadata.pipelinePhases`
2. Implement server-side fix in `queue-executor-bridge.ts`
3. Implement client-side fallback in `buildDAGData.ts`
4. Add unit tests for the fallback in `buildDAGData.test.ts`
5. Add integration test in `queue-executor-bridge.test.ts`
6. Build and run `npm run test` to verify

---

## Notes

- The `git-fetch` pipeline is a **job-type** pipeline (single AI call, no map/reduce), so the
  DAG will show `[input] → [job]` nodes, not `[input] → [map] → [reduce]`.
  The `buildDAGData` logic already handles job-type via `hasJob` detection — it will work
  correctly once `stats` is available.
- The server-side `updateProcess` for metadata must do a deep merge (spread existing metadata
  fields) to avoid wiping `pipelineName`, `queueTaskId`, etc. Read the current process first
  or pass only the new fields as a partial merge (check how the store merges metadata).
- No changes needed in the React routing — the URL deep-link and `WorkflowDetailView` rendering
  are both correct.
