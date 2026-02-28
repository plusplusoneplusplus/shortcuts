# Incremental Git-Hash Cache

**Category:** Configuration & Persistence

## Overview

The Incremental Git-Hash Cache is a multi-layer persistence system in the `deep-wiki` package that avoids redundant AI processing on re-runs. Each cacheable artifact — component graph, consolidation graph, per-component analyses, per-component articles, reduce-phase synthesis articles, discovery intermediates (seeds, probes, domain sub-graphs, structural scan), and theme artifacts — is serialized to JSON under a `.wiki-cache/` directory and stamped with the current git HEAD hash. On subsequent runs the cached value is returned immediately when the hash still matches, and only the subset of components affected by file changes is re-processed.

---

## Architecture

```
deep-wiki generate <repo>
        │
        ├─ Phase 1  Discovery  ──► graph-cache / discovery-cache
        ├─ Phase 2  Consolidation ► consolidation-cache
        ├─ Phase 3  Analysis   ──► analysis-cache  (per-component)
        ├─ Phase 4  Writing    ──► article-cache   (per-component + reduce)
        └─ Phase 5  Website        (no cache – fast HTML generation)

Each phase reads its cache first.  On a hit the phase is skipped entirely
(or only the affected subset is re-run).  On a miss the output is written
back to cache before the next phase begins.
```

**Source files:**

| File | Role |
|---|---|
| `packages/deep-wiki/src/cache/types.ts` | All `CachedXxx` wrapper interfaces |
| `packages/deep-wiki/src/cache/cache-constants.ts` | Directory/file name constants + `getCacheDir()` |
| `packages/deep-wiki/src/cache/cache-utils.ts` | Generic read / write / clear / scan primitives |
| `packages/deep-wiki/src/cache/git-utils.ts` | Git hash detection + scoped change detection |
| `packages/deep-wiki/src/cache/graph-cache.ts` | Phase 1 component graph |
| `packages/deep-wiki/src/cache/consolidation-cache.ts` | Phase 2 consolidated graph |
| `packages/deep-wiki/src/cache/analysis-cache.ts` | Phase 3 per-component analyses |
| `packages/deep-wiki/src/cache/article-cache.ts` | Phase 4 articles + reduce synthesis |
| `packages/deep-wiki/src/cache/discovery-cache.ts` | Iterative discovery intermediates |
| `packages/deep-wiki/src/cache/theme-cache.ts` | Theme probe / outline / analysis / article |
| `packages/deep-wiki/src/cache/index.ts` | Barrel re-export + cross-domain helpers |

---

## Cache Directory Layout

```
{outputDir}/.wiki-cache/
├── component-graph.json              ← Phase 1 ComponentGraph
├── consolidated-graph.json           ← Phase 2 merged ComponentGraph
├── analyses/
│   ├── _metadata.json                ← { gitHash, componentCount, timestamp }
│   └── {componentId}.json            ← CachedAnalysis per module
├── articles/
│   ├── _metadata.json                ← { gitHash, componentCount, timestamp }
│   ├── _reduce-metadata.json         ← gitHash for the reduce-phase articles
│   ├── _reduce-index.json            ← synthesis: top-level index article
│   ├── _reduce-architecture.json     ← synthesis: architecture overview
│   ├── _reduce-getting-started.json  ← synthesis: getting-started guide
│   ├── _reduce-domain-{id}-index.json← synthesis: per-domain index
│   └── {componentId}.json            ← per-module GeneratedArticle
├── themes/
│   └── {themeId}/
│       ├── probe-result.json         ← CachedThemeProbe
│       ├── outline.json              ← CachedThemeOutline
│       ├── analysis.json             ← CachedThemeAnalysis
│       └── articles/
│           └── {slug}.json           ← CachedThemeArticle
└── discovery/
    ├── _metadata.json                ← DiscoveryProgressMetadata (round resumption)
    ├── seeds.yaml                    ← CachedSeeds
    ├── structural-scan.json          ← CachedStructuralScan (large-repo)
    ├── probes/
    │   └── {theme-slug}.json         ← CachedProbeResult
    └── domains/
        └── {domain-slug}.json        ← CachedDomainGraph
```

---

## Key Concepts

### Universal cache wrapper

Every cached artifact carries the same invalidation fields:

```typescript
// graph-cache uses a full CacheMetadata object
interface CacheMetadata {
    gitHash: string;    // git HEAD hash when cached
    timestamp: number;  // Date.now()
    version: string;    // CACHE_VERSION = '1.0.0'
    focus?: string;     // optional --focus argument
}

// all other caches use inline fields
interface CachedAnalysis {
    analysis: ComponentAnalysis;
    gitHash: string;
    timestamp: number;
}

interface CachedArticle {
    article: GeneratedArticle;
    gitHash: string;
    timestamp: number;
}
```

### Git hash scoping (`git-utils.ts`)

Three levels of hash granularity:

```typescript
// Whole-repo HEAD hash
getRepoHeadHash(repoPath): Promise<string>
// → git rev-parse HEAD

// Subfolder-scoped hash (avoids busting cache for unrelated package changes)
getFolderHeadHash(repoPath): Promise<string>
// → if repoPath === gitRoot: getRepoHeadHash()
//   else: git log -1 --format=%H -- "<relativePath>"
//         falls back to HEAD if no commits touch the subfolder

// File-level change detection
getChangedFiles(repoPath, sinceHash, scopePath?): Promise<string[]>
// → git diff --name-only <sinceHash> HEAD
//   optionally filtered to scopePath
```

`getFolderHeadHash` is used for every cache read and write so that a commit in an unrelated monorepo package does not invalidate an otherwise-unchanged wiki.

### Cache invalidation rules

| Condition | Result |
|---|---|
| Stored `gitHash` ≠ current `getFolderHeadHash()` | Cache miss — artifact regenerated |
| Stored `gitHash` matches | Cache hit — artifact returned immediately |
| Consolidation: same hash but different `inputComponentCount` | Cache miss — consolidation re-run |
| Corrupt / partial JSON (predicate fails) | Silently treated as cache miss |

### Atomic writes

Every write goes through a `.tmp` → `rename` sequence:

```typescript
writeCacheFile<T>(cachePath: string, data: T): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath + '.tmp', JSON.stringify(data, null, 2));
    renameSync(cachePath + '.tmp', cachePath);
}
```

A process killed mid-write never leaves a corrupt JSON file.

### Fine-grained incremental re-analysis

Instead of re-running all analyses when git HEAD changes, the pipeline identifies only the affected components:

```typescript
getComponentsNeedingReanalysis(
    components: ComponentAnalysis[],
    repoPath: string,
    outputDir: string
): Promise<string[]>
// 1. Read analyses/_metadata.json to get the cached gitHash
// 2. git diff --name-only <cachedHash> HEAD (scoped to repoPath)
// 3. For each component: does any changed file fall under component.path
//    or match component.keyFiles?
// 4. Return only the affected componentIds
```

Components whose source files have not changed since the last run are returned from cache without re-calling the AI.

### Re-stamping unchanged articles

After identifying unchanged components in Phase 4, their cached articles are re-stamped with the new git hash rather than regenerated:

```typescript
restampArticles(
    unchangedComponentIds: string[],
    outputDir: string,
    newGitHash: string
): Promise<void>
// Reads each CachedArticle, writes back with gitHash = newGitHash
// (same content, updated hash — keeps them valid for the next run)
```

### `--use-cache` bypass mode

Every cache reader has a companion `*Any` variant that skips git hash validation and relies on structural validity alone:

```typescript
getCachedGraph(outputDir, repoPath)     // hash-validated
getCachedGraphAny(outputDir)            // structural-only (--use-cache)

getCachedAnalysis(id, outputDir, repoPath)
getCachedAnalysisAny(id, outputDir)
```

Pass `--use-cache` on the CLI to force all phases to load from disk regardless of whether the repository has changed.

### Stale artifact pruning

After Phase 2 consolidation reduces the component count (e.g. 120 → 40), orphaned `{oldComponentId}.json` files from the analyses directory are removed:

```typescript
pruneStaleAnalyses(activeComponentIds: string[], outputDir: string): void
```

---

## Cache Primitives (`cache-utils.ts`)

```typescript
// Read
readCacheFile<T>(cachePath): T | null
readCacheFileIf<T>(cachePath, validate: (data: T) => boolean): T | null

// Write (atomic)
writeCacheFile<T>(cachePath, data): void

// Clear
clearCacheFile(cachePath): void
clearCacheDir(dirPath): void    // rmSync recursive

// Batch scan — returns found results and list of missing IDs
scanCacheItems<TCache, TResult>(
    ids, pathResolver, validator, extractor
): { found: TResult[], missing: string[] }

scanCacheItemsMap<TCache, TResult>(
    ids, pathResolver, validator, extractor
): Map<string, TResult>
```

---

## What Each Phase Caches

| Phase | Module | Key artifacts |
|---|---|---|
| 1 – Discovery | `graph-cache` | `component-graph.json` (full `ComponentGraph`) |
| 1b – Iterative | `discovery-cache` | seeds, per-theme probes, structural scan, domain sub-graphs, round progress metadata |
| 2 – Consolidation | `consolidation-cache` | `consolidated-graph.json` + `inputComponentCount` guard |
| 3 – Analysis | `analysis-cache` | per-module `ComponentAnalysis` + `_metadata.json` |
| 4 – Articles | `article-cache` | per-module `GeneratedArticle`, reduce-phase synthesis articles, `_metadata.json` |
| Theme generation | `theme-cache` | per-theme probe, outline, analysis, and incremental per-article writes |

---

## CLI flags

| Flag | Effect |
|---|---|
| *(default)* | Hash-validated cache; only changed components are re-processed |
| `--use-cache` | Skip hash validation; load all artifacts from disk as-is |
| `--force` | Ignore all cached artifacts; full re-run from scratch |
| `--phase <n>` | Start from a specific phase (earlier phase caches are still respected) |

---

## Testing

Cache tests live in `packages/deep-wiki/test/cache/`:

| Test file | Coverage |
|---|---|
| `discovery-cache.test.ts` | Seeds, probes, structural scan, domain graphs, progress metadata |
| `analysis-cache.test.ts` | Per-component read/write/invalidation, batch scan, stale pruning |
| `article-cache.test.ts` | Per-component and reduce-article read/write/re-stamp |
| `reduce-article-cache.test.ts` | Reduce-phase synthesis article caching |
| `git-utils.test.ts` | Hash detection, subfolder scoping, change detection |

Run with:

```bash
cd packages/deep-wiki
npm run test:run
```

---

## Design Notes

- **Subfolder scoping** — using `git log -1 -- <path>` instead of `git rev-parse HEAD` means wikis for a sub-package inside a large monorepo are only invalidated by commits that actually touch that sub-package.
- **No merge on conflict** — cache is always written by a single process; concurrent runs in the same output directory are not supported and can corrupt the `.tmp` staging files.
- **Structural validation as defense-in-depth** — even when the hash matches, each cache hit runs a predicate (e.g. `!!d.analysis?.componentId`). This catches truncated files left by an earlier crashed run before the atomic-write pattern was adopted.
- **`inputComponentCount` guard on consolidation** — discovery is non-deterministic for large repos; the same git HEAD can produce a different graph on re-discovery. The count guard ensures consolidation is re-run if the input graph has changed shape even though the hash has not.
