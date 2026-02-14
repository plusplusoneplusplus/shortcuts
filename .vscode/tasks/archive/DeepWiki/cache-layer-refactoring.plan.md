# Refactor Deep-Wiki Cache Layer — Extract Shared Utilities

## Problem

The deep-wiki cache layer (`packages/deep-wiki/src/cache/`) has 60 exported functions across two files (`index.ts` at ~1400 lines, `discovery-cache.ts` at ~520 lines) with extensive code duplication. Every phase reimplements the same read-parse-validate-write patterns from scratch with only the type cast and field checks varying.

### Duplication Inventory

| Pattern | Occurrences | What Varies |
|---------|-------------|-------------|
| Read file → parse JSON → validate structure → return null on error | ~15 functions | Type cast, field name checks |
| `getCachedX` / `getCachedXAny` pairs (hash vs no-hash) | 6 pairs (12 functions) | Single `gitHash ===` condition |
| `scanX` / `scanXAny` loop pairs | 3 pairs (6 functions) | Single `gitHash ===` condition in inner loop |
| `mkdirSync` + `writeFileSync(JSON.stringify(...))` | 8 save functions | Path and wrapper type |
| `existsSync` → `unlinkSync`/`rmSync` → return bool | 4 clear functions | Path and single-file vs directory |
| Path getters (`path.join(cacheDir, CONSTANT)`) | 12 functions | Directory/file constants |

The `discovery-cache.ts` file already has a `safeReadJSON<T>` helper but it is **not shared** with `index.ts`.

## Proposed Approach

Extract shared primitives into a new `cache-utils.ts` module, then refactor all cache functions to use them. No public API changes — every existing export keeps its signature.

### New Module: `packages/deep-wiki/src/cache/cache-utils.ts`

```typescript
// ── Read Primitives ──

/** Read and parse a JSON cache file. Returns null on missing/corrupted file. */
function readCacheFile<T>(cachePath: string): T | null

/** Read a cache file and validate with a custom predicate. */
function readCacheFileIf<T>(
    cachePath: string,
    validate: (data: T) => boolean
): T | null

// ── Write Primitives ──

/** Write a JSON cache file, creating parent directories as needed. */
function writeCacheFile<T>(cachePath: string, data: T): void

// ── Clear Primitives ──

/** Delete a single cache file. Returns true if deleted. */
function clearCacheFile(cachePath: string): boolean

/** Delete a cache directory recursively. Returns true if deleted. */
function clearCacheDir(dirPath: string): boolean

// ── Scan Primitives ──

/**
 * Scan for individually cached items by ID.
 *
 * Generic scanner that covers all scan/scanAny variants:
 * - Resolves each ID to a file path via `pathResolver`
 * - Reads and validates via `validator`
 * - Extracts the inner data via `extractor`
 *
 * Returns { found: T[], missing: string[] }
 */
function scanCacheItems<TCache, TResult>(
    ids: string[],
    pathResolver: (id: string) => string | null,
    validator: (cached: TCache) => boolean,
    extractor: (cached: TCache) => TResult
): { found: TResult[]; missing: string[] }

// ── Git Hash Helpers ──

/**
 * Validate git hash matches current HEAD.
 * Returns true if hash matches, false otherwise.
 */
async function validateGitHash(
    repoPath: string,
    cachedHash: string
): Promise<boolean>
```

## Refactoring Tasks

### Task 1: Create `cache-utils.ts` with shared primitives [x]

Create `packages/deep-wiki/src/cache/cache-utils.ts` with the 7 functions above. These are internal-only (not exported from the package).

**Acceptance criteria:**
- All functions are well-typed with generics
- `readCacheFile` handles `!existsSync`, parse errors, and returns null
- `writeCacheFile` calls `mkdirSync({ recursive: true })` on parent dir
- `scanCacheItems` is generic enough to replace all 6 scan variants
- Unit tests for each primitive in `test/cache/cache-utils.test.ts`

### Task 2: Refactor `index.ts` — Graph & Consolidation cache [x]

Refactor these 10 functions to use cache-utils primitives:

| Function | Before (lines) | After (approx) | Primitive Used |
|----------|----------------|-----------------|----------------|
| `getCachedGraph` | 30 | ~10 | `readCacheFileIf` + `validateGitHash` |
| `getCachedGraphAny` | 20 | ~5 | `readCacheFileIf` |
| `saveGraph` | 15 | ~8 | `writeCacheFile` |
| `clearCache` | 7 | ~1 | `clearCacheFile` |
| `hasCachedGraph` | 3 | 3 | (delegates to getCachedGraph, no change) |
| `getCachedConsolidation` | 35 | ~10 | `readCacheFileIf` + `validateGitHash` |
| `getCachedConsolidationAny` | 25 | ~8 | `readCacheFileIf` |
| `saveConsolidation` | 15 | ~8 | `writeCacheFile` |
| `clearConsolidationCache` | 7 | ~1 | `clearCacheFile` |

**Estimated line reduction:** ~70 lines

**Acceptance criteria:**
- All existing tests pass unchanged
- No public API changes (same function signatures, same exports)

### Task 3: Refactor `index.ts` — Analysis cache [x]

Refactor these 9 functions:

| Function | Primitive Used |
|----------|----------------|
| `getCachedAnalysis` | `readCacheFileIf` |
| `getCachedAnalyses` | `readCacheFile` for metadata + dir scan loop |
| `getAnalysesCacheMetadata` | `readCacheFile` |
| `saveAnalysis` | `writeCacheFile` |
| `saveAllAnalyses` | `writeCacheFile` (loop) |
| `scanIndividualAnalysesCache` | `scanCacheItems` |
| `scanIndividualAnalysesCacheAny` | `scanCacheItems` |
| `clearAnalysesCache` | `clearCacheDir` |
| `getModulesNeedingReanalysis` | Uses `getAnalysesCacheMetadata` (indirect benefit) |

**Estimated line reduction:** ~80 lines

**Acceptance criteria:**
- All existing analysis cache tests pass unchanged
- Scan functions produce identical `{ found, missing }` results

### Task 4: Refactor `index.ts` — Article & Reduce cache [x]

Refactor these 13 functions:

| Function | Primitive Used |
|----------|----------------|
| `getCachedArticle` | `readCacheFileIf` (with multi-path fallback) |
| `getCachedArticles` | `readCacheFile` for metadata + dir scan |
| `getArticlesCacheMetadata` | `readCacheFile` |
| `getReduceCacheMetadata` | `readCacheFile` |
| `getCachedReduceArticles` | `readCacheFile` + filtered dir scan |
| `saveArticle` | `writeCacheFile` |
| `saveAllArticles` | `writeCacheFile` (loop) |
| `saveReduceArticles` | `writeCacheFile` (loop) |
| `scanIndividualArticlesCache` | `scanCacheItems` (with `findArticleCachePath`) |
| `scanIndividualArticlesCacheAny` | `scanCacheItems` |
| `clearArticlesCache` | `clearCacheDir` |

**Note:** `getCachedArticle` has a multi-path lookup (area-scoped + flat). This can use `readCacheFileIf` in a loop over candidate paths — the unique lookup logic stays, but the read-parse-validate boilerplate goes.

**Estimated line reduction:** ~100 lines

**Acceptance criteria:**
- All article/reduce cache tests pass unchanged
- Area-scoped article lookup behavior preserved

### Task 5: Refactor `discovery-cache.ts` [x]

Refactor these 16 functions to use cache-utils:

| Function | Primitive Used |
|----------|----------------|
| `saveSeedsCache` | `writeCacheFile` |
| `getCachedSeeds` | `readCacheFileIf` (hash check) |
| `getCachedSeedsAny` | `readCacheFileIf` (no hash check) |
| `saveProbeResult` | `writeCacheFile` |
| `getCachedProbeResult` | `readCacheFileIf` |
| `scanCachedProbes` | `scanCacheItems` |
| `scanCachedProbesAny` | `scanCacheItems` |
| `saveStructuralScan` | `writeCacheFile` |
| `getCachedStructuralScan` | `readCacheFileIf` |
| `getCachedStructuralScanAny` | `readCacheFileIf` |
| `saveAreaSubGraph` | `writeCacheFile` |
| `getCachedAreaSubGraph` | `readCacheFileIf` |
| `scanCachedAreas` | `scanCacheItems` |
| `scanCachedAreasAny` | `scanCacheItems` |
| `saveDiscoveryMetadata` | `writeCacheFile` |
| `getDiscoveryMetadata` | `readCacheFile` |

Remove the local `safeReadJSON` and `atomicWriteFileSync` helpers — replace with shared `readCacheFile` and `writeCacheFile`.

**Decision needed:** `discovery-cache.ts` currently uses `atomicWriteFileSync` (write to `.tmp` then rename). Should `writeCacheFile` adopt this for all phases? It's safer for crash recovery but adds complexity. Recommendation: adopt it — the cost is ~5 extra lines in one place and all phases benefit.

**Estimated line reduction:** ~90 lines

**Acceptance criteria:**
- All discovery cache tests pass unchanged
- `clearDiscoveryCache` still works (it uses `rmSync` on the discovery dir)

### Task 6: Collapse `getCachedX` / `getCachedXAny` duplication [skipped — not justified]

After Tasks 2–5, the `getCachedX` and `getCachedXAny` pairs will already be shorter. But we can go further by extracting a shared pattern:

```typescript
// In each phase, replace two functions with one + wrapper:
function getCachedConsolidationImpl(
    outputDir: string,
    inputModuleCount: number,
    gitHashValidator?: (hash: string) => Promise<boolean>
): Promise<CachedConsolidation | null> | CachedConsolidation | null
```

However, this may over-abstract and hurt readability. **This task is optional** — evaluate after Tasks 2–5 whether the remaining duplication justifies it.

## Execution Order

```
Task 1 (cache-utils.ts)
  ├── Task 2 (graph + consolidation)
  ├── Task 3 (analysis)
  ├── Task 4 (article + reduce)
  └── Task 5 (discovery-cache)
       └── Task 6 (optional: collapse X/XAny pairs)
```

Tasks 2–5 are independent of each other (can be done in any order after Task 1). Task 6 depends on all of them.

## Expected Outcome

| Metric | Before | After |
|--------|--------|-------|
| `index.ts` lines | ~1400 | ~1050 |
| `discovery-cache.ts` lines | ~520 | ~380 |
| New `cache-utils.ts` lines | 0 | ~100 |
| **Net line reduction** | — | **~390 lines (~20%)** |
| Duplicated read-parse-validate blocks | ~15 | 0 |
| Duplicated write blocks | ~8 | 0 |
| Duplicated scan loops | ~6 | 0 |

## Risks & Mitigations

1. **Risk: Subtle behavioral differences between phases.** Some functions have unique validation logic (e.g., article's multi-path lookup, analysis's `moduleId` check vs article's `slug` check). **Mitigation:** The `validate` predicate in `readCacheFileIf` keeps phase-specific validation inline — only the boilerplate is shared.

2. **Risk: Breaking existing tests.** 7 test files with ~200 cache tests. **Mitigation:** Zero public API changes. Run full suite after each task.

3. **Risk: Atomic writes (discovery) vs plain writes (index).** **Mitigation:** Adopt atomic writes in `writeCacheFile` for all phases — strictly better behavior, no downside.

4. **Risk: Over-abstraction.** Task 6 could make code harder to understand. **Mitigation:** Task 6 is explicitly optional. Evaluate after the concrete wins from Tasks 1–5.
