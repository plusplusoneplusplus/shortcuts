---
status: pending
---

# 007: Topic Cache Module

## Summary
Create a caching layer for topic generation artifacts: probe results, outlines, analyses, and articles. Follows the per-item incremental caching pattern from `cache/analysis-cache.ts`.

## Motivation
Topic generation involves multiple AI calls (probe, outline, per-article analysis, per-article writing). If the process is interrupted or the user re-runs for the same topic, we should reuse cached results. Git-hash-based invalidation ensures cache freshness. Incremental per-article writes protect against crashes during long-running generation.

## Changes

### Files to Create
- `packages/deep-wiki/src/cache/topic-cache.ts` — Topic-specific cache operations
- `packages/deep-wiki/test/cache/topic-cache.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/cache/index.ts` — Add topic cache exports
- `packages/deep-wiki/src/cache/types.ts` — Add topic cache types

## Implementation Notes

### Cache Directory Structure

```
.wiki-cache/
└── topics/
    ├── metadata.json                    # Global topic cache metadata
    └── compaction/                      # Per-topic directory
        ├── probe-result.json            # Cached probe result
        ├── outline.json                 # Cached topic outline
        ├── analysis.json                # Cached topic analysis
        └── articles/                    # Per-article cache
            ├── index.json
            ├── compaction-styles.json
            ├── compaction-picker.json
            └── ...
```

### `topic-cache.ts` API

```typescript
import { TopicOutline, TopicAnalysis, TopicArticle } from '../types';
import { EnrichedProbeResult } from '../topic/topic-probe';
import { CacheMetadata } from './types';

// --- Probe Cache ---
export function getCachedTopicProbe(topicId: string, outputDir: string): EnrichedProbeResult | null;
export function saveTopicProbe(topicId: string, result: EnrichedProbeResult, outputDir: string, gitHash: string): void;

// --- Outline Cache ---
export function getCachedTopicOutline(topicId: string, outputDir: string): TopicOutline | null;
export function saveTopicOutline(topicId: string, outline: TopicOutline, outputDir: string, gitHash: string): void;

// --- Analysis Cache ---
export function getCachedTopicAnalysis(topicId: string, outputDir: string): TopicAnalysis | null;
export function saveTopicAnalysis(topicId: string, analysis: TopicAnalysis, outputDir: string, gitHash: string): void;

// --- Article Cache (per-article incremental) ---
export function getCachedTopicArticle(topicId: string, slug: string, outputDir: string): TopicArticle | null;
export function saveTopicArticle(topicId: string, article: TopicArticle, outputDir: string, gitHash: string): void;
export function getCachedTopicArticles(topicId: string, outputDir: string): TopicArticle[] | null;

// --- Bulk Operations ---
export function clearTopicCache(topicId: string, outputDir: string): void;
export function clearAllTopicsCache(outputDir: string): void;

// --- Validation ---
export function isTopicCacheValid(topicId: string, outputDir: string, currentGitHash: string): boolean;
```

### Cache Types to Add (in `cache/types.ts`)

```typescript
export interface CachedTopicProbe {
    metadata: CacheMetadata;
    result: EnrichedProbeResult;
}

export interface CachedTopicOutline {
    metadata: CacheMetadata;
    outline: TopicOutline;
}

export interface CachedTopicArticle {
    metadata: CacheMetadata;
    article: TopicArticle;
}
```

### Invalidation Strategy
- Each cached item stores `gitHash` in metadata
- `isTopicCacheValid()` compares stored hash with current `getFolderHeadHash()`
- `--force` flag bypasses cache entirely
- `--use-cache` uses cache regardless of git hash
- Per-article incremental saves via `onArticleComplete` callback in article generator

## Tests
- **Save and retrieve probe result**: Round-trip test
- **Save and retrieve outline**: Round-trip test
- **Save and retrieve article**: Single article round-trip
- **Incremental article saves**: Save 3 articles one at a time, retrieve all
- **Cache invalidation**: Save with hash A, validate with hash B → invalid
- **Force clear**: clearTopicCache removes all topic artifacts
- **Missing cache**: getCached* returns null for non-existent cache
- **Corrupted JSON**: Graceful handling of malformed cache files

## Acceptance Criteria
- [ ] All cache operations (save/get/clear) work correctly
- [ ] Git-hash validation correctly detects stale cache
- [ ] Incremental article saves work (crash recovery scenario)
- [ ] Corrupted/missing cache files handled gracefully (return null, don't throw)
- [ ] Cache directory structure matches specification
- [ ] All tests pass

## Dependencies
- Depends on: 001 (types), 003 (EnrichedProbeResult type)
- Uses (existing, unchanged): `cache/git-utils.ts` for hash operations
