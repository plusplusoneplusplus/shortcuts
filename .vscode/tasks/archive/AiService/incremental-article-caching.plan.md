# Fix: Incremental Per-Article Caching for Phase 3 (Article Generation)

## Description

Phase 3 (Article Generation) uses the same `MapReduceExecutor` as Phase 2 but has **no caching at all**. If the process crashes at article 30/44, all generated articles are lost. Phase 3 can take 2-8 minutes for medium repos, making this a real pain point.

Phase 2 now has robust incremental caching via `onItemComplete` + `saveAnalysis()` + `scanIndividualAnalysesCache()`. Phase 3 should reuse this same infrastructure pattern, extending the `.wiki-cache/` structure with an `articles/` subdirectory.

## Current Behavior

```
Phase 3: Generating articles for 44 modules...
  Article 1/44 ✓  (in memory only)
  ...
  Article 30/44 ✓  (in memory only)
  💥 CRASH
  → All 30 articles lost, re-run regenerates everything
  → Reduce phase (index, architecture, getting-started) also lost
```

## Desired Behavior

```
Phase 3: Generating articles for 44 modules...
  Article 1/44 ✓  → saved to .wiki-cache/articles/auth.json
  ...
  Article 30/44 ✓ → saved to .wiki-cache/articles/database.json
  💥 CRASH
  → Re-run detects 30 cached articles, only generates remaining 14
  → Reduce phase re-runs (it's fast and depends on all articles)
```

## Target Cache Structure

Extend the existing `.wiki-cache/` directory:

```
.wiki-cache/
├── module-graph.json              # Phase 1 (existing)
├── analyses/                      # Phase 2 (existing)
│   ├── _metadata.json
│   ├── auth.json
│   └── ...
└── articles/                      # Phase 3 (NEW)
    ├── _metadata.json             # git hash + timestamp + module count
    ├── auth.json                  # per-module article cache
    ├── database.json
    └── ...
    (index/architecture/getting-started NOT cached — reduce is fast
     and depends on all articles, so it should always re-run)
```

## Reuse from Phase 2 Infrastructure

The goal is to share as much of the existing cache layer as possible:

| Phase 2 Component | Phase 3 Reuse |
|---|---|
| `saveAnalysis(moduleId, data, outputDir, gitHash)` | Generalize to `saveCacheItem(type, id, data, outputDir, gitHash)` or create parallel `saveArticle()` following same pattern |
| `scanIndividualAnalysesCache()` | Create `scanIndividualArticlesCache()` using same logic |
| `getModulesNeedingReanalysis()` | Reuse — same git-diff logic determines which articles are stale |
| `_metadata.json` format (`AnalysisCacheMetadata`) | Reuse same type for articles metadata |
| `onItemComplete` callback on executor | Already available — just wire it in `runPhase3` |

### Option A: Generalize cache functions (Recommended)

Extract common cache logic into generic helpers that both Phase 2 and Phase 3 use:

```typescript
// Generic cache item save/load — parameterized by subdirectory
function saveCacheItem(subdir: string, itemId: string, data: unknown, outputDir: string, gitHash: string): void
function getCachedItem<T>(subdir: string, itemId: string, outputDir: string): T | null
function scanIndividualCache(subdir: string, outputDir: string, gitHash: string): { found: Map<string, T>, missing: string[] }
function saveCacheMetadata(subdir: string, outputDir: string, gitHash: string, count: number): void
```

Phase 2 calls: `saveCacheItem('analyses', moduleId, analysis, ...)`
Phase 3 calls: `saveCacheItem('articles', moduleId, article, ...)`

### Option B: Parallel functions for articles

Create `saveArticle`, `getCachedArticle`, `scanIndividualArticlesCache` etc. following the exact same pattern as the analysis functions. More duplication but simpler to implement.

## Affected Files

| File | Change |
|------|--------|
| `packages/deep-wiki/src/cache/index.ts` | Add article cache functions (or generalize existing) |
| `packages/deep-wiki/src/commands/generate.ts` | Wire `onItemComplete` in `runPhase3`, add cache load/skip logic |
| `packages/deep-wiki/src/writing/article-executor.ts` | Thread `onItemComplete` callback through to executor |
| `packages/deep-wiki/src/writing/index.ts` | Accept `onItemComplete` in `generateArticles()` |
| `packages/deep-wiki/src/types.ts` | Add `CachedArticle` type if needed |

## Work Plan

- [x] **1. Extend cache layer for articles**
  - Option A: Generalize `saveAnalysis`/`getCachedAnalysis`/`scanIndividualAnalysesCache` into generic cache helpers parameterized by subdirectory (`analyses` vs `articles`)
  - Option B: Create parallel `saveArticle`, `getCachedArticle`, `scanIndividualArticlesCache`, `saveAllArticles`, `getArticlesCacheMetadata` functions following the same pattern
  - Add `CachedArticle` type to `types.ts` (mirrors `CachedAnalysis`: `{ article: GeneratedArticle, gitHash: string, timestamp: number }`)
  - Add constants: `ARTICLES_DIR = 'articles'`

- [x] **2. Wire `onItemComplete` in article executor**
  - `generateArticles()` in `writing/index.ts`: accept `onItemComplete` callback parameter
  - `runArticleExecutor()` in `writing/article-executor.ts`: pass `onItemComplete` to `createExecutor()`
  - Callback receives the completed `GeneratedArticle` (parsed from map result)

- [x] **3. Add cache load + skip logic in `runPhase3`**
  - Before calling `generateArticles()`, scan `.wiki-cache/articles/` for existing per-module article files
  - Filter out already-cached modules from the articles to generate
  - Validate git hash on cached articles (same approach as Phase 2's `scanIndividualAnalysesCache`)
  - If all articles cached and git hash matches, skip map phase entirely

- [x] **4. Provide `onItemComplete` callback in `runPhase3`**
  - In `generate.ts` `runPhase3`, provide callback that:
    - Extracts `GeneratedArticle` from map result
    - Calls `saveArticle(article.moduleId, article, outputDir, gitHash)`
  - Obtain git hash once at start of Phase 3 (reuse from Phase 2 or call `getRepoHeadHash`)

- [x] **5. Always re-run reduce phase**
  - Reduce generates index.md, architecture.md, getting-started.md
  - These depend on ALL articles, so always re-run reduce even if map articles are cached
  - Reduce is fast (single AI call) so caching it isn't worth the complexity

- [x] **6. Merge cached + fresh articles before reduce**
  - After map phase, merge: `[...cachedArticles, ...freshArticles]`
  - Pass merged set to reduce phase
  - After reduce, `writeWikiOutput()` writes everything to disk as before

- [x] **7. Write metadata at the end**
  - After successful map+reduce, write `articles/_metadata.json`
  - Metadata marks the cache as "complete" (same pattern as Phase 2)

- [x] **8. Handle `--force` flag**
  - When `--force` is set, skip all article cache loading (same as Phase 2)

- [x] **9. Add tests**
  - Test: article cache save/load round-trip
  - Test: partial cache recovery (simulate crash after N articles)
  - Test: cache invalidation when git hash changes
  - Test: `--force` ignores article cache
  - Test: reduce always re-runs even with full article cache

- [x] **10. Build and verify**
  - `npm run build` in deep-wiki package
  - Manual test: generate, interrupt mid-Phase 3, re-run and verify resume

## Design Decisions

1. **Don't cache reduce output** — The reduce phase (index/architecture/getting-started) is a single AI call that depends on all articles. It's fast and should always reflect the latest full set of articles. Caching it would add complexity for minimal benefit.

2. **Reuse git-diff invalidation** — The same `getModulesNeedingReanalysis()` logic can identify which modules' articles are stale. If a module's source files changed, both its analysis AND article should be regenerated.

3. **Article cache keyed by moduleId** — Same as analysis cache. The `slug` field is derived from `moduleId`, so no mapping needed.

4. **Prefer Option A (generalize)** if Phase 2's cache functions are straightforward to parameterize. Fall back to Option B if generalization would require too many type gymnastics.

## Notes

- Phase 3 uses `concurrency * 2` (up to 20) for article generation vs Phase 2's base concurrency — article prompts are simpler/faster than analysis prompts
- Articles use **text mode** (raw markdown) not structured JSON, so the cached content is the markdown string itself
- The `GeneratedArticle` type includes `type`, `slug`, `title`, `content`, and optional `moduleId` — all serializable to JSON
- `writeWikiOutput()` in `file-writer.ts` doesn't need changes — it operates on the final `WikiOutput` regardless of cache source
