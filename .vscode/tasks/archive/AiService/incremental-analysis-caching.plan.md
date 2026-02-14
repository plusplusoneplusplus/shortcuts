# Fix: Incremental Per-Module Analysis Caching in Deep Wiki

## Description

During Phase 2 (Deep Analysis), `deep-wiki generate` analyzes all modules via AI but only saves results to cache **after all modules complete** (`saveAllAnalyses` at line 411 in `generate.ts`). If the process crashes, times out, or is interrupted mid-way (e.g., at module 28/44), **all progress is lost** and must be re-run from scratch.

The cache infrastructure (`saveAnalysis` per-module function) already exists in `packages/deep-wiki/src/cache/index.ts` but is never called during the analysis loop — only the bulk `saveAllAnalyses` is called at the end.

## Current Behavior

```
Phase 2: Analyzing 44 modules (5 parallel)
  Module 1/44 ✓  (not saved to disk)
  Module 2/44 ✓  (not saved to disk)
  ...
  Module 28/44 ✓  (not saved to disk)
  💥 CRASH / timeout / Ctrl+C
  → All 28 completed analyses lost
  → Re-run starts from 0/44
```

## Desired Behavior

```
Phase 2: Analyzing 44 modules (5 parallel)
  Module 1/44 ✓  → saved to .wiki-cache/analyses/module1.json
  Module 2/44 ✓  → saved to .wiki-cache/analyses/module2.json
  ...
  Module 28/44 ✓ → saved to .wiki-cache/analyses/module28.json
  💥 CRASH / timeout / Ctrl+C
  → Re-run detects 28 cached, only analyzes remaining 16
```

## Affected Files

| File | Change |
|------|--------|
| `packages/deep-wiki/src/commands/generate.ts` | Add per-module save in progress callback or post-map hook |
| `packages/deep-wiki/src/analysis/analysis-executor.ts` | Expose per-item completion results (option A or B below) |
| `packages/deep-wiki/src/cache/index.ts` | Possibly add `saveAnalysisIfNew` or partial metadata update |

## Implementation Options

### Option A: Hook into `onProgress` callback (Minimal change)

The `onProgress` callback fires after each module completes during the mapping phase. However, it only receives aggregate counts (`completedItems`, `failedItems`), not the individual result.

**Approach:** Add an `onItemComplete` callback to `ExecutorOptions` in pipeline-core that passes the individual `MapResult` after each item completes. Then in `generate.ts`, use this callback to save each module analysis to cache immediately.

**Pros:** Clean separation, reusable for other pipelines
**Cons:** Requires a small change to `pipeline-core`

### Option B: Wrap the AI invoker (No pipeline-core change)

Wrap the analysis invoker to intercept results and save to cache before returning.

```typescript
const wrappingInvoker = async (prompt: string, options: any) => {
    const result = await analysisInvoker(prompt, options);
    // Parse module ID from prompt/result and save to cache
    saveAnalysis(moduleId, parsedAnalysis, outputDir, gitHash);
    return result;
};
```

**Pros:** No changes to pipeline-core
**Cons:** Fragile — requires parsing module ID from prompt/result; mixing concerns

### Option C: Post-process in generate.ts with partial save (Recommended)

Modify `runPhase2` in `generate.ts` to:
1. Before calling `analyzeModules`, write a partial metadata file marking analysis as "in-progress"
2. After `analyzeModules` returns, save results as before
3. On re-run, check for individually cached analyses even without complete metadata
4. Load any existing per-module cache files and exclude those modules from re-analysis

This approach works because `getModulesNeedingReanalysis` currently returns `null` (full rebuild) when there's no metadata. We can change it to also check for individual analysis files.

**Pros:** Minimal change, no pipeline-core modification needed
**Cons:** Doesn't save during execution — only helps if analyzeModules returns partial results (which it does for timeouts/failures)

### Option D: Add `onItemComplete` to executor + save per module (Cleanest)

1. Add `onItemComplete?: (item: WorkItem, result: MapResult) => void` to `ExecutorOptions` in pipeline-core
2. Call it in executor.ts after each map item completes (alongside progress reporting)
3. In `analysis-executor.ts`, pass through the callback
4. In `generate.ts`, provide callback that parses and saves each module analysis

**Pros:** Clean, reusable, saves immediately on completion
**Cons:** Small change to pipeline-core types

## Recommended Approach: Option D

Option D is the cleanest and most robust. The changes are small and well-contained:

## Work Plan

- [x] **1. Add `onItemComplete` callback to pipeline-core executor**
  - Add `onItemComplete` to `ExecutorOptions` in `packages/pipeline-core/src/map-reduce/types.ts`
  - Call it in `executor.ts` after each map item completes (in the `.then()` block around line 294)
  - Export the new type

- [x] **2. Thread callback through analysis executor**
  - Update `analysis-executor.ts` to accept and pass `onItemComplete` to the executor
  - Update `analyzeModules` in `analysis/index.ts` to accept the callback

- [x] **3. Implement per-module save in generate.ts**
  - In `runPhase2`, provide `onItemComplete` callback that:
    - Parses the map result into `ModuleAnalysis`
    - Calls `saveAnalysis(moduleId, analysis, outputDir, gitHash)`
  - Remove or keep `saveAllAnalyses` at the end (to write metadata)

- [x] **4. Improve resume logic in generate.ts**
  - Before analysis, scan `.wiki-cache/analyses/` for existing per-module files
  - Exclude already-cached modules from `modulesToAnalyze` (even without metadata)
  - Handle edge case: cached module from different git hash (invalidate)

- [x] **5. Add tests**
  - Test: crash recovery loads partial cache
  - Test: re-run skips already-cached modules
  - Test: cache invalidation on git change still works
  - Test: `onItemComplete` callback is called for each item

- [x] **6. Build and verify**
  - `npm run build` in deep-wiki package
  - Manual test: run generate, interrupt mid-way, re-run and verify resume

## Notes

- The `saveAnalysis` function in `cache/index.ts` is already implemented and handles directory creation — no changes needed there
- Git hash should be obtained once at the start of Phase 2 and reused for all per-module saves
- Metadata file (`_metadata.json`) should still be written at the end to mark the cache as "complete"
- Consider adding a `partial: true` flag to metadata when saving during execution vs after completion
