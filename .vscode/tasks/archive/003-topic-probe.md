---
status: pending
---

# 003: Topic Probe Adapter

## Summary
Create an adapter that wraps the existing `runTopicProbe()` from `discovery/iterative/probe-session.ts` to perform targeted discovery for a single user-requested topic.

## Motivation
The iterative discovery system already has battle-tested probe machinery — it sends a `TopicSeed` to an AI session with read-only tools and gets back `TopicProbeResult` (found modules, key files, dependencies). We don't need to rebuild this; we just need a thin adapter that:
1. Converts a `TopicRequest` → `TopicSeed`
2. Runs a single probe (not the full iterative loop)
3. Cross-references results with existing `ModuleGraph` (if available)
4. Returns enriched results ready for the outline phase

## Changes

### Files to Create
- `packages/deep-wiki/src/topic/topic-probe.ts` — Probe adapter
- `packages/deep-wiki/test/topic/topic-probe.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/topic/index.ts` — Add export

## Implementation Notes

### `topic-probe.ts` Structure

```typescript
import { TopicRequest, ModuleGraph } from '../types';
import { TopicSeed, TopicProbeResult } from '../discovery/iterative/types';
import { runTopicProbe } from '../discovery/iterative/probe-session';

export interface TopicProbeOptions {
    repoPath: string;
    topic: TopicRequest;
    existingGraph?: ModuleGraph;   // from wiki, if available
    model?: string;
    timeout?: number;              // default: 120s
}

export interface EnrichedProbeResult {
    probeResult: TopicProbeResult;
    /** Modules from probe that already have articles in the wiki */
    existingModuleIds: string[];
    /** Modules from probe that are new (no existing article) */
    newModuleIds: string[];
    /** All discovered key files across found modules */
    allKeyFiles: string[];
}

/**
 * Convert TopicRequest to TopicSeed for the probe session.
 * If no description provided, generates a basic one from the topic name.
 * If no hints provided, derives hints from the topic name (split on hyphens, 
 * add common variations).
 */
export function buildTopicSeed(topic: TopicRequest): TopicSeed;

/**
 * Run a single topic probe and enrich results with existing wiki context.
 */
export async function runSingleTopicProbe(
    options: TopicProbeOptions
): Promise<EnrichedProbeResult>;
```

### Cross-referencing with Existing Graph
- After probe returns `foundModules`, check each module ID against `existingGraph.modules`
- Match by ID (exact) and by path overlap (fuzzy — same directory = likely same module)
- Split into `existingModuleIds` (already documented) and `newModuleIds` (need analysis)

### Hint Generation
- Split topic name on hyphens: "compaction" → ["compaction", "compact"]
- Add common suffixes: ["compactor", "compacting"]
- If description provided, extract key nouns

## Tests
- **buildTopicSeed**: Verify conversion from TopicRequest → TopicSeed with generated hints
- **runSingleTopicProbe (mocked)**: Mock `runTopicProbe` to return probe result, verify enrichment
- **Cross-referencing**: Provide existing graph with 3 modules, probe finds 5 → verify 3 existing, 2 new
- **No existing graph**: Probe without wiki → all modules are "new"
- **Empty probe result**: AI finds nothing → empty enriched result
- **Hint generation**: Topic "wal-recovery" → hints include ["wal", "recovery", "write-ahead", "log"]

## Acceptance Criteria
- [ ] `buildTopicSeed` generates reasonable seeds from minimal input
- [ ] `runSingleTopicProbe` calls underlying probe machinery correctly
- [ ] Cross-referencing correctly partitions modules into existing/new
- [ ] Works with and without an existing ModuleGraph
- [ ] All tests pass with mocked AI service

## Dependencies
- Depends on: 001 (types)
- Uses (existing, unchanged): `discovery/iterative/probe-session.ts`, `discovery/iterative/types.ts`
