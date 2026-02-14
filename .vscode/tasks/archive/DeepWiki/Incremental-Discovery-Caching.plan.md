# Incremental Discovery Caching

## Problem

During the discovery phase, each AI call (probe, structural scan, area drill-down, seeds generation) is performed in-memory with no intermediate persistence. If the process crashes, times out, or a single probe fails mid-round, **all prior AI work is lost** and must be re-run from scratch.

This contrasts with Phase 2 (analysis) and Phase 3 (articles), which both save results per-module via `saveAnalysis()` / `saveArticle()` callbacks, enabling crash recovery and incremental rebuilds.

### Current Gaps

| Step | Cached? | Impact |
|------|---------|--------|
| Seeds generation (AI call) | ❌ | Re-generated every run |
| Iterative probe results | ❌ | All probes re-run if any round fails |
| Iterative merge results (per-round graph) | ❌ | Intermediate graphs discarded |
| Large-repo structural scan | ❌ | Repeated on retry |
| Large-repo area sub-graphs | ❌ | Areas 1–3 lost if area 4 fails |

## Proposed Approach

Extend the existing cache layer pattern (`saveAnalysis` / `scanIndividualAnalysesCache`) to discovery sub-steps. Each intermediate AI result gets its own cache file under `.wiki-cache/discovery/`, keyed by git hash.

### Cache Directory Layout

```
.wiki-cache/
├── module-graph.json              # (existing) Final merged graph
├── discovery/                     # (new) Intermediate discovery artifacts
│   ├── _metadata.json             # Round progress, convergence state
│   ├── seeds.json                 # Cached generated seeds
│   ├── structural-scan.json       # Large-repo structural scan result
│   ├── probes/                    # Per-topic probe results
│   │   ├── auth.json
│   │   ├── database.json
│   │   └── ...
│   └── areas/                     # Per-area sub-graphs (large repo)
│       ├── frontend.json
│       ├── backend.json
│       └── ...
```

Each file wraps its payload with `{ data, gitHash, timestamp }` for invalidation.

## Acceptance Criteria

- [x] Generated seeds are cached and reused on subsequent runs (unless `--force`)
- [x] Each iterative probe result is saved to `.wiki-cache/discovery/probes/{topic}.json` as it completes
- [x] On restart, completed probes are loaded from cache and skipped; only missing/failed probes re-run
- [x] Per-round merged graphs are saved to `_metadata.json` so a crashed round can resume
- [x] Large-repo structural scan is cached and reused
- [x] Large-repo area sub-graphs are cached individually; only failed areas re-run on retry
- [x] All caches validate against current git hash (stale entries skipped unless `--use-cache`)
- [x] `--force` bypasses all discovery caches
- [x] Tests cover: probe cache hit/miss, round resumption, area recovery, seeds cache, git-hash invalidation

## Workplan

### Phase 1: Cache Infrastructure

- [x] **1.1 Create discovery cache module** (`packages/deep-wiki/src/cache/discovery-cache.ts`)
  - `getDiscoveryCacheDir(outputDir: string): string` → `.wiki-cache/discovery/`
  - `saveProbeResult(topic: string, result: TopicProbeResult, outputDir: string, gitHash: string): void`
  - `getCachedProbeResult(topic: string, outputDir: string, gitHash: string): TopicProbeResult | null`
  - `scanCachedProbes(topics: string[], outputDir: string, gitHash: string): { found: Map<string, TopicProbeResult>, missing: string[] }`
  - `saveSeedsCache(seeds: TopicSeed[], outputDir: string, gitHash: string): void`
  - `getCachedSeeds(outputDir: string, gitHash: string): TopicSeed[] | null`
  - `saveStructuralScan(scan: StructuralScanResult, outputDir: string, gitHash: string): void`
  - `getCachedStructuralScan(outputDir: string, gitHash: string): StructuralScanResult | null`
  - `saveAreaSubGraph(areaId: string, graph: ModuleGraph, outputDir: string, gitHash: string): void`
  - `getCachedAreaSubGraph(areaId: string, outputDir: string, gitHash: string): ModuleGraph | null`
  - `scanCachedAreas(areaIds: string[], outputDir: string, gitHash: string): { found: Map<string, ModuleGraph>, missing: string[] }`
  - `saveDiscoveryMetadata(metadata: DiscoveryProgressMetadata, outputDir: string): void`
  - `getDiscoveryMetadata(outputDir: string): DiscoveryProgressMetadata | null`
  - `clearDiscoveryCache(outputDir: string): void`
  - Follow the same `{ data, gitHash, timestamp }` wrapper pattern used by `saveAnalysis()`

- [x] **1.2 Export from cache index** (`packages/deep-wiki/src/cache/index.ts`)
  - Re-export all new discovery cache functions

- [x] **1.3 Tests for discovery cache** (`packages/deep-wiki/test/cache/discovery-cache.test.ts`)
  - Save/load round-trip for each artifact type
  - Git hash mismatch → returns null
  - Scan with partial cache (some hits, some misses)
  - Clear cache removes all discovery artifacts
  - Edge cases: malformed JSON, missing directory

### Phase 2: Integrate Caching into Discovery Flows

- [x] **2.1 Cache seeds in discover/generate commands** (`commands/discover.ts`, `commands/generate.ts`)
  - After `generateTopicSeeds()` succeeds, call `saveSeedsCache()`
  - Before generating seeds, check `getCachedSeeds()` — skip AI call if cached
  - `parseSeedFile()` (file-based seeds) does not need caching (already on disk)
  - Log: `ℹ Using cached seeds (N topics)`

- [x] **2.2 Cache probes in iterative discovery** (`discovery/iterative/iterative-discovery.ts`)
  - Accept `outputDir` and `gitHash` as new options in `IterativeDiscoveryOptions`
  - Before each round, call `scanCachedProbes()` to find already-completed probes
  - Only run `runTopicProbe()` for missing topics
  - After each probe completes, call `saveProbeResult()`
  - Save round progress to `_metadata.json` after each merge
  - Log: `ℹ Loaded N cached probes, M remaining`

- [x] **2.3 Cache structural scan and area sub-graphs** (`discovery/large-repo-handler.ts`)
  - Accept `outputDir` and `gitHash` in options
  - Before structural scan, check `getCachedStructuralScan()`
  - After scan, call `saveStructuralScan()`
  - Before each area drill-down, check `getCachedAreaSubGraph()`
  - After each area completes, call `saveAreaSubGraph()`
  - Log: `ℹ Using cached structural scan (N areas)`
  - Log: `ℹ Area "frontend" loaded from cache (12 modules)`

- [x] **2.4 Pass outputDir through discovery options** (`types.ts`, `discovery/index.ts`)
  - Add `outputDir?: string` to `DiscoveryOptions` and `IterativeDiscoveryOptions`
  - Thread it from `executeDiscover()` / `runPhase1()` through to the session functions

- [x] **2.5 Tests for integrated caching** (`test/discovery/iterative/iterative-discovery-cache.test.ts`)
  - Probes loaded from cache skip AI call
  - Partial cache: cached probes used, missing probes run
  - Round resumption from metadata
  - Git hash change invalidates probe cache
  - `--force` ignores probe cache

### Phase 3: Logging & UX

- [x] **3.1 Add cache-hit logging to discovery flows**
  - Seeds: `ℹ Using N cached seeds` / `ℹ Generating topic seeds...`
  - Probes: `ℹ Loaded N/M probes from cache, running M remaining`
  - Areas: `ℹ Area "X" loaded from cache (N modules)`
  - Structural scan: `ℹ Using cached structural scan`

- [x] **3.2 Add `--force` behavior documentation**
  - Update help text to mention that `--force` clears discovery cache too
  - Call `clearDiscoveryCache()` when `--force` is used

## File Changes Summary

| File | Change |
|------|--------|
| `src/cache/discovery-cache.ts` | **New** — all discovery cache functions |
| `src/cache/index.ts` | Re-export discovery cache functions |
| `src/types.ts` | Add `outputDir?` to discovery option types |
| `src/discovery/index.ts` | Pass `outputDir` through |
| `src/discovery/iterative/iterative-discovery.ts` | Integrate probe caching + round resumption |
| `src/discovery/large-repo-handler.ts` | Integrate scan + area caching |
| `src/commands/discover.ts` | Integrate seeds caching, pass `outputDir` |
| `src/commands/generate.ts` | Integrate seeds caching, pass `outputDir` |
| `test/cache/discovery-cache.test.ts` | **New** — cache unit tests |
| `test/discovery/iterative/iterative-discovery-cache.test.ts` | **New** — integration tests |

## Design Decisions

1. **Same pattern as analysis/article caching** — Reuse the `{ data, gitHash, timestamp }` wrapper and `scan*Cache()` recovery pattern. Developers already know this pattern.
2. **Topic string as probe cache key** — Probe files named by topic slug (`normalizeModuleId(topic)`). Simple, human-readable, and collision-free since topics are already unique within a seed set.
3. **Round metadata for resumption** — `_metadata.json` stores `{ currentRound, completedTopics[], pendingTopics[], gitHash }` so a crashed round picks up where it left off.
4. **No cache for single-pass standard discovery** — Standard discovery is a single AI call that produces the full graph. Caching intermediate state isn't meaningful for a single call; the final graph cache already handles this.
5. **`outputDir` threading** — Discovery options gain an optional `outputDir` field. When not provided (e.g., library usage), caching is silently skipped. CLI always provides it.

## Notes

- Seeds from a file (`--seeds path/to/seeds.json`) don't need caching — the file is the cache
- Only auto-generated seeds (`--seeds auto`) benefit from caching
- The discovery cache is separate from the final graph cache; `clearDiscoveryCache()` does not affect `module-graph.json`
- This plan is complementary to `Incremental-Seed-Update-for-Auto-Generated-Discovery.md` — that plan addresses merge/incremental workflows; this plan addresses crash recovery and avoiding redundant AI calls
