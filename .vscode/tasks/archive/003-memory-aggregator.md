---
status: pending
---

# 003: MemoryAggregator — batch consolidation of raw observations

## Summary

Service that checks if raw observations have accumulated past a threshold, and if so, consolidates them via an AI call into updated `consolidated.md`. Lives in `pipeline-core` with no VS Code dependencies.

## Motivation

Raw observations pile up in `raw/` after each memory-enabled pipeline run. Without periodic consolidation, prompt injection would need to load every raw file individually, growing unboundedly. The aggregator compresses N raw observations into a single `consolidated.md` via an AI call that deduplicates, resolves conflicts, and categorises facts. This is step 3 of the memory lifecycle (Capture → Retrieve → **Aggregate**) defined in `docs/designs/coc-memory.md`.

## Changes

### Files to Create

- `packages/pipeline-core/src/memory/memory-aggregator.ts` — `MemoryAggregator` class implementation.
- `packages/pipeline-core/test/memory/memory-aggregator.test.ts` — Vitest tests with mock `MemoryStore` and `AIInvoker`.

### Files to Modify

- `packages/pipeline-core/src/memory/index.ts` — Add `export { MemoryAggregator } from './memory-aggregator';`

### Files to Delete

(none)

## Implementation Notes

### Class API

```typescript
import { MemoryStore, MemoryLevel, RawObservation } from './types';
import { AIInvoker } from '../map-reduce/types';

export interface AggregatorOptions {
    /** Minimum raw file count before automatic aggregation triggers. Default: 5 */
    batchThreshold?: number;
}

export class MemoryAggregator {
    private readonly store: MemoryStore;
    private readonly batchThreshold: number;

    constructor(store: MemoryStore, options?: AggregatorOptions) {
        this.store = store;
        this.batchThreshold = options?.batchThreshold ?? 5;
    }

    /**
     * Check raw count against threshold and aggregate if needed.
     * Returns true if aggregation ran, false if skipped.
     */
    async aggregateIfNeeded(
        aiInvoker: AIInvoker,
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<boolean>;

    /**
     * Force aggregation regardless of threshold.
     * No-op if there are zero raw files.
     */
    async aggregate(
        aiInvoker: AIInvoker,
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<void>;
}
```

### `aggregateIfNeeded` logic

```
if level === 'both':
    ranSystem = aggregateIfNeeded(aiInvoker, 'system')
    ranRepo   = aggregateIfNeeded(aiInvoker, 'repo', repoHash)
    return ranSystem || ranRepo

filenames = store.listRaw(level, repoHash)
if filenames.length < batchThreshold:
    return false
else:
    await aggregate(aiInvoker, level, repoHash)
    return true
```

### `aggregate` flow

```
if level === 'both':
    await aggregate(aiInvoker, 'system')
    await aggregate(aiInvoker, 'repo', repoHash)
    return

1. filenames = store.listRaw(level, repoHash)
   If empty → return (no-op).

2. observations: RawObservation[] = await Promise.all(
       filenames.map(f => store.readRaw(level, repoHash, f))
   )
   Filter out undefined results.

3. existing = await store.readConsolidated(level, repoHash)

4. Build consolidation prompt (see below).

5. result = await aiInvoker(prompt)
   If !result.success → throw (do NOT proceed to delete).

6. await store.writeConsolidated(level, result.response!, repoHash)

7. await store.updateIndex(level, repoHash, {
       lastAggregation: new Date().toISOString(),
       rawCount: 0,
       factCount: countFacts(result.response!),
   })

8. for (const filename of filenames) {
       await store.deleteRaw(level, repoHash, filename)
   }
```

**Critical safety invariant:** Steps 6-7 (write) MUST succeed before step 8 (delete). If the AI call in step 5 fails, raw files are preserved intact.

### Consolidation prompt

Built verbatim from `docs/designs/coc-memory.md` § "3. Aggregate":

```typescript
private buildPrompt(
    existing: string | null,
    observations: RawObservation[],
): string {
    const existingSection = existing ?? 'No existing memory';
    const rawSection = observations
        .map(o => o.content)
        .join('\n\n');

    return [
        '## Existing Memory',
        existingSection,
        '',
        `## New Observations (${observations.length} sessions)`,
        rawSection,
        '',
        'Produce an updated memory document following these rules:',
        '- Deduplicate: merge similar or redundant facts',
        '- Resolve conflicts: newer observations override older ones',
        '- Prune: drop facts that appear no longer relevant',
        '- Categorize: group by topic (conventions, architecture, patterns, tools, gotchas)',
        '- Keep it concise: target <100 facts total',
        '- Use markdown with clear section headers',
    ].join('\n');
}
```

### `countFacts` helper

Counts lines starting with `- ` (markdown bullet items) in the consolidated output:

```typescript
function countFacts(content: string): number {
    return content.split('\n').filter(line => line.startsWith('- ')).length;
}
```

Exported as a named function for testability (or kept private and tested through aggregate behaviour — tests verify the index update contains the correct count).

### Export change

In `packages/pipeline-core/src/memory/index.ts`, add:

```typescript
export { MemoryAggregator } from './memory-aggregator';
export type { AggregatorOptions } from './memory-aggregator';
```

## Tests

Test file: `packages/pipeline-core/test/memory/memory-aggregator.test.ts`

All tests use a mock `MemoryStore` (plain object satisfying the interface via `vi.fn()`) and a mock `AIInvoker` function. No file-system I/O.

### `aggregateIfNeeded` tests

1. **returns false when raw count < threshold** — `listRaw` returns 3 files, threshold is 5 → returns `false`, no AI call made.
2. **returns true and runs aggregation when count >= threshold** — `listRaw` returns 5 files → returns `true`, AI called, consolidated written, index updated, raw files deleted.
3. **custom batchThreshold respected** — construct with `{ batchThreshold: 2 }`, provide 2 raw files → aggregation runs.

### `aggregate` tests

4. **reads all raw files and concatenates into prompt** — verify `readRaw` called for each filename, prompt contains all observation contents.
5. **includes existing consolidated in prompt** — `readConsolidated` returns existing content → prompt `## Existing Memory` section contains it.
6. **uses "No existing memory" when no consolidated exists** — `readConsolidated` returns `null` → prompt contains `No existing memory`.
7. **writes AI response as new consolidated.md** — `aiInvoker` returns `{ success: true, response: '...' }` → `writeConsolidated` called with that response.
8. **updates index with correct metadata** — after successful aggregation, `updateIndex` called with `{ lastAggregation: <iso string>, rawCount: 0, factCount: <correct count> }`.
9. **deletes raw files after successful write** — `deleteRaw` called for each filename.
10. **does NOT delete raw files if AI call fails** — `aiInvoker` returns `{ success: false, error: 'fail' }` → `deleteRaw` never called, error thrown.
11. **empty raw list is a no-op** — `listRaw` returns `[]` → no AI call, no writes, no deletes.

### `level='both'` tests

12. **level='both' runs aggregation at system and repo levels independently** — verify `listRaw` called once with `'system'` and once with `'repo'`, each level gets its own AI call, consolidated write, and index update.

### `countFacts` tests

13. **counts bullet lines correctly** — input with 3 `- ` lines and 2 non-bullet lines → `factCount` is 3 in the index update. Also test: zero bullets → 0, nested `  - ` not counted (only top-level).

## Acceptance Criteria

- [ ] `MemoryAggregator` class exported from `packages/pipeline-core/src/memory/index.ts`
- [ ] `aggregateIfNeeded` returns `false` below threshold, `true` and runs above
- [ ] `aggregate` builds the exact consolidation prompt from the design doc
- [ ] AI failure does not delete raw files (safety invariant)
- [ ] `level='both'` independently aggregates system and repo levels
- [ ] `countFacts` correctly counts top-level `- ` bullet lines
- [ ] All tests pass: `cd packages/pipeline-core && npx vitest run test/memory/memory-aggregator.test.ts`
- [ ] Existing memory tests still pass: `cd packages/pipeline-core && npx vitest run test/memory/`
- [ ] No new dependencies added
- [ ] No changes to existing function signatures or behaviour

## Commit

```
MemoryAggregator — batch consolidation of raw observations

Service that checks if raw observations have accumulated past a threshold,
and if so, consolidates them via an AI call into updated consolidated.md.
```

## Dependencies

- Depends on: `MemoryStore` interface (`types.ts`), `FileMemoryStore` (`memory-store.ts`), `AIInvoker` type (`map-reduce/types.ts`)

## Assumed Prior State

- `MemoryStore` interface and `FileMemoryStore` implementation exist and are fully functional (committed in earlier tasks).
- `AIInvoker` type is available from `packages/pipeline-core/src/map-reduce/types.ts`.
