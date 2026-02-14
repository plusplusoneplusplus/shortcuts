# R1: Split `cache/index.ts` (991 lines) into Domain-Specific Cache Files

## Problem

`packages/deep-wiki/src/cache/index.ts` is a 991-line monolithic file containing 48 exported functions covering 4 distinct cache domains (graph, consolidation, analysis, articles). The domains share duplicated read/validate/save patterns.

## Approach

Split into domain-specific files while extracting shared patterns into `cache-utils.ts`. Keep `index.ts` as a re-export barrel.

## File Changes

### 1. Enhance `cache/cache-utils.ts` — Add generic helpers

Add these reusable patterns that are currently duplicated:

```typescript
/**
 * Read a cache file, validate it matches the expected git hash, and return the data.
 * Returns undefined if cache miss, hash mismatch, or read error.
 */
export async function readCacheWithHashValidation<T>(
    cachePath: string,
    expectedHash: string,
    validator?: (data: T) => boolean
): Promise<T | undefined>;

/**
 * Read a cache file without hash validation (for --use-cache mode).
 */
export async function readCacheAny<T>(
    cachePath: string,
    validator?: (data: T) => boolean
): Promise<T | undefined>;

/**
 * Save data to a cache file with git hash metadata.
 */
export async function writeCacheWithHash<T>(
    cachePath: string,
    data: T,
    gitHash: string
): Promise<void>;
```

### 2. Create `cache/graph-cache.ts` (~80 lines)

Move these functions from `index.ts`:
- `getGraphCachePath()` (line 112)
- `getCachedGraph()` (line 148)
- `getCachedGraphAny()` (line 175)
- `saveGraph()` (line 194)

### 3. Create `cache/consolidation-cache.ts` (~120 lines)

Move these functions:
- `getConsolidatedGraphCachePath()` (line 226)
- `getCachedConsolidation()` (line 246)
- `getCachedConsolidationAny()` (line 281)
- `saveConsolidation()` (line 303)
- `clearConsolidationCache()` (line 332)

### 4. Create `cache/analysis-cache.ts` (~180 lines)

Move these functions:
- `getAnalysesCacheDir()` (line 119)
- `getAnalysisCachePath()` (line 126)
- `getAnalysesMetadataPath()` (line 133)
- `getCachedAnalysis()` (line 347)
- `getCachedAnalyses()` (line 361)
- `getAnalysesCacheMetadata()` (line 399)
- `saveAnalysis()` (line 415)
- `saveAllAnalyses()` (line 435)
- `scanIndividualAnalysesCache()` (line 472)
- `scanIndividualAnalysesCacheAny()` (line 492)
- `clearAnalysesCache()` (line 514)

### 5. Create `cache/article-cache.ts` (~490 lines)

Move these functions:
- `getArticlesCacheDir()` (line 525)
- `getArticleCachePath()` (line 534)
- `getArticlesMetadataPath()` (line 544)
- `getReduceMetadataPath()` (line 555)
- `getReduceArticleCachePath()` (line 574)
- `getCachedArticle()` (line 598)
- `getCachedArticles()` (line 624)
- `getArticlesCacheMetadata()` (line 679)
- `getReduceCacheMetadata()` (line 690)
- `getCachedReduceArticles()` (line 705)
- `saveArticle()` (line 767)
- `saveAllArticles()` (line 787)
- `saveReduceArticles()` (line 829)
- `scanIndividualArticlesCache()` (line 906)
- `scanIndividualArticlesCacheAny()` (line 928)
- `restampArticles()` (line 957)
- `clearArticlesCache()` (line 1003)

### 6. Keep in `cache/index.ts` — Shared + re-exports

Keep:
- `getCacheDir()` (line 102) — used by all domains
- `getModulesNeedingReanalysis()` (line 1024) — crosses analysis + article domains
- `clearCache()` (line 1100) — calls clear on all domains
- `hasCachedGraph()` (line 1111)
- Constants (lines 61-91)

Re-export everything:
```typescript
export * from './cache-utils';
export * from './graph-cache';
export * from './consolidation-cache';
export * from './analysis-cache';
export * from './article-cache';
export * from './discovery-cache';  // already separate
export * from './git-utils';        // already separate
```

## Consumers to Verify

These files import from `cache/` or `cache/index` — all imports must continue to resolve:
- `commands/generate.ts` (27 imports)
- `commands/discover.ts` (8 imports)
- `discovery/large-repo-handler.ts` (5 imports)
- `discovery/iterative/iterative-discovery.ts` (5 imports)

Since all functions are re-exported through `index.ts`, **no consumer changes are needed**.

## Tests

### Existing cache tests (11 files) must pass unchanged:

- `test/cache/article-cache.test.ts`
- `test/cache/git-utils.test.ts`
- `test/cache/discovery-cache.test.ts`
- `test/cache/analysis-cache.test.ts`
- `test/cache/consolidation-cache.test.ts`
- And others

Since tests import from the barrel `cache/` or `cache/index`, they'll resolve through re-exports.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- Start by moving functions without refactoring them. Get tests green.
- Then, in a follow-up, refactor the moved functions to use the new generic helpers from cache-utils.
- The `discovery-cache.ts` and `git-utils.ts` already exist as separate files — this refactoring brings consistency to the remaining domains.
