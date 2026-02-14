---
status: pending
---

# 002: Topic Coverage Checker

## Summary
Create a module that loads an existing wiki and determines whether a requested topic is already covered, partially covered, or entirely new.

## Motivation
Before spending AI tokens on discovery and generation, we need to detect duplicates. This is the "guard" that prevents regenerating content that already exists. It's a self-contained module with no AI calls — it uses string matching and keyword analysis against existing articles and module-graph.json.

## Changes

### Files to Create
- `packages/deep-wiki/src/topic/coverage-checker.ts` — Core coverage checking logic
- `packages/deep-wiki/test/topic/coverage-checker.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/topic/index.ts` — Barrel export (create if topic/ dir is new)

## Implementation Notes

### `coverage-checker.ts` Structure

```typescript
import { ModuleGraph, TopicRequest, TopicCoverageCheck, TopicAreaMeta } from '../types';

/**
 * Load module-graph.json from the wiki directory.
 * Returns null if wiki doesn't exist or has no module-graph.json.
 */
export function loadWikiGraph(wikiDir: string): ModuleGraph | null;

/**
 * List existing topic areas from the wiki directory.
 * Reads module-graph.json topics[] array + scans topics/ directory.
 */
export function listTopicAreas(wikiDir: string): TopicAreaMeta[];

/**
 * Check whether a topic is already covered in the wiki.
 * 
 * Detection strategy (no AI needed):
 * 1. Exact match: topic.id matches existing TopicAreaMeta.id
 * 2. Partial overlap: keyword matching against module names, purposes, 
 *    and article content (TF-IDF style scoring)
 * 3. New: no significant overlap found
 * 
 * Returns TopicCoverageCheck with status and related modules.
 */
export function checkTopicCoverage(
    topic: TopicRequest,
    graph: ModuleGraph,
    wikiDir: string
): TopicCoverageCheck;
```

### Keyword Matching Strategy
- Tokenize topic name and description into keywords
- Score each existing module: `name` match (high), `purpose` substring match (medium), article content grep (low)
- Score existing topic areas similarly
- Thresholds: ≥1 exact topic match → `exists`, ≥2 high-relevance modules → `partial`, else → `new`

### Edge Cases
- Wiki directory doesn't exist → return `{ status: 'new', relatedModules: [] }`
- module-graph.json missing or malformed → warn and return `new`
- Topic name is very generic (e.g., "code") → still proceed, let the user decide

## Tests
- **Exact match**: Provide graph with `topics: [{ id: "compaction" }]`, request "compaction" → `exists`
- **Partial overlap**: Graph has modules "compaction-picker", "compaction-job" → `partial` with 2 related modules
- **New topic**: Request "bloom-filters" against graph with no bloom-related modules → `new`
- **No wiki**: wikiDir doesn't exist → `new`
- **Malformed graph**: Invalid JSON → `new` with warning
- **List topics**: Verify listTopicAreas reads from both graph and filesystem

## Acceptance Criteria
- [ ] `checkTopicCoverage` returns correct status for all three states
- [ ] `listTopicAreas` reads from module-graph.json and topics/ directory
- [ ] `loadWikiGraph` handles missing/malformed files gracefully
- [ ] All tests pass
- [ ] No AI service dependencies (pure local logic)

## Dependencies
- Depends on: 001 (topic types)
