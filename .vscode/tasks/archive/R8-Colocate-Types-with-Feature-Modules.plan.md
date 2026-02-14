# R8: Colocate Types with Feature Modules

## Problem

`packages/deep-wiki/src/types.ts` is 860 lines containing 26+ interfaces and type aliases. Many types are only used within a single feature module, yet they're all in the central file — making it hard to understand which types belong to which feature.

## Approach

Move feature-specific types to their owning modules. Keep cross-phase contracts (types used by 3+ modules) in the central `types.ts`. Re-export moved types from `types.ts` for backward compatibility.

## Analysis: Which Types Can Move

### ✅ Safe to move (used by ≤2 modules):

**Cache types → `cache/types.ts`:**
- `CacheMetadata` (lines 726-735)
- `CachedGraph` (lines 740-745)
- `AnalysisCacheMetadata` (lines 750-759)
- `CachedAnalysis` (lines 764-771)
- `CachedArticle` (lines 776-783)
- `CachedConsolidation` (lines 796-805)
- `CachedProbeResult` (lines 814-821)
- `CachedSeeds` (lines 826-833)
- `CachedStructuralScan` (lines 838-845)
- `CachedAreaGraph` (lines 850-857)
- `DiscoveryProgressMetadata` (lines 862-881)
Total: 11 interfaces, ~160 lines

**Analysis detail types → `analysis/types.ts`:**
- `KeyConcept` (lines 274-281)
- `PublicAPIEntry` (lines 286-293)
- `CodeExample` (lines 298-307)
- `InternalDependency` (lines 312-317)
- `ExternalDependency` (lines 322-327)
Total: 5 interfaces, ~55 lines (only used in `analysis/response-parser.ts`)

**Consolidation types → `consolidation/types.ts`:**
- `ConsolidationOptions` (lines 890-899)
- `ConsolidationResult` (lines 904-915)
- `ClusterGroup` (lines 920-929) — only used in `ai-consolidator.ts`
Total: 3 interfaces, ~45 lines

**Iterative discovery types → `discovery/iterative/types.ts`:**
- `TopicProbeResult` (lines 596-607)
- `ProbeFoundModule` (lines 612-627)
- `DiscoveredTopic` (lines 632-641)
- `IterativeDiscoveryOptions` (lines 646-671)
- `MergeResult` (lines 676-687)
Total: 5 interfaces, ~90 lines

**Server types → `server/types.ts`:**
- `ServeCommandOptions` (lines 696-717)
Total: 1 interface, ~22 lines

### ❌ Keep in `types.ts` (cross-phase contracts):

- `ProjectInfo`, `ModuleInfo`, `CategoryInfo`, `AreaInfo` — used across discovery, analysis, writing, consolidation
- `ModuleGraph` — used everywhere
- `ModuleAnalysis` — used in analysis, writing, cache, commands
- `GeneratedArticle`, `WikiOutput` — used in writing, cache, commands
- `WritingOptions`, `AnalysisOptions`, `DiscoveryOptions` — phase entry points
- `DeepWikiConfig`, `DeepWikiConfigFile` — CLI config
- `GenerateCommandOptions`, `DiscoverCommandOptions`, `SeedsCommandOptions` — command options
- `TopicSeed`, `SeedsOutput` — used across seeds + iterative discovery + commands
- `TopLevelArea`, `StructuralScanResult` — used in discovery + cache
- Phase types (`PhaseName`, `PhaseConfig`, etc.)
- Website types (`WebsiteTheme`, `WebsiteOptions`)
- Article type alias (`ArticleType`)

Remaining: ~540 lines (down from 860)

## File Changes

### 1. Create `cache/types.ts` (~160 lines)

Move all 11 `Cached*` and `*Metadata` interfaces. Import shared types they reference:
```typescript
import type { ModuleGraph, ModuleAnalysis, GeneratedArticle, TopicSeed, TopicProbeResult, StructuralScanResult } from '../types';
```

### 2. Create `analysis/types.ts` (~55 lines)

Move `KeyConcept`, `PublicAPIEntry`, `CodeExample`, `InternalDependency`, `ExternalDependency`.

### 3. Create `consolidation/types.ts` (~45 lines)

Move `ConsolidationOptions`, `ConsolidationResult`, `ClusterGroup`.

### 4. Create `discovery/iterative/types.ts` (~90 lines)

Move `TopicProbeResult`, `ProbeFoundModule`, `DiscoveredTopic`, `IterativeDiscoveryOptions`, `MergeResult`.

**Caveat:** `TopicProbeResult` is also used by `cache/discovery-cache.ts`. It would need to be imported from `discovery/iterative/types.ts` there, or stay in central `types.ts`. Evaluate during implementation — if it creates awkward cross-module imports, keep it central.

### 5. Create `server/types.ts` (~22 lines)

Move `ServeCommandOptions`.

### 6. Update `types.ts` — Add re-exports

For backward compatibility, re-export all moved types:
```typescript
export type { CacheMetadata, CachedGraph, /* ... */ } from './cache/types';
export type { KeyConcept, PublicAPIEntry, /* ... */ } from './analysis/types';
export type { ConsolidationOptions, ConsolidationResult, ClusterGroup } from './consolidation/types';
export type { TopicProbeResult, ProbeFoundModule, /* ... */ } from './discovery/iterative/types';
export type { ServeCommandOptions } from './server/types';
```

This ensures **zero consumer changes** are needed.

### 7. Update feature module files

Update direct consumers to import from their local `types.ts` instead of `../../types` (optional — the re-exports make this unnecessary, but it's cleaner):

- `cache/index.ts`, `cache/discovery-cache.ts` → import from `./types`
- `analysis/response-parser.ts` → import from `./types`
- `consolidation/ai-consolidator.ts`, `consolidation/consolidator.ts` → import from `./types`

## Tests

### All 59 test files must pass unchanged.

Tests import types from `../../src/types` — the re-exports ensure this continues to work. No test changes needed.

## Validation

```bash
cd packages/deep-wiki && npm run build && npm run test:run
```

## Notes

- This is the highest-risk structural refactoring due to the number of import paths affected. The re-export strategy mitigates this.
- Do this last among all refactorings to minimize merge conflicts.
- The `TopicProbeResult` placement needs evaluation — it's used in both `discovery/iterative/` and `cache/discovery-cache.ts`. If cross-module imports feel wrong, keep it central.
- Consider running `tsc --noEmit` after each file move to catch import errors incrementally.
