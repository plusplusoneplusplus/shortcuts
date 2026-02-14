---
status: pending
---

# 005: Topic Analysis Executor

## Summary
Create a module that runs deep analysis for each planned sub-article in the topic outline, plus a cross-cutting analysis for the index page.

## Motivation
Each sub-article needs focused analysis of its specific code area. The existing `analysis/analysis-executor.ts` handles per-module analysis, but topic analysis is different — it's per-article (which may span multiple modules) and includes a cross-cutting synthesis for the overview. This commit adds the topic-specific analysis prompts and executor.

## Changes

### Files to Create
- `packages/deep-wiki/src/topic/topic-analysis.ts` — Topic analysis executor
- `packages/deep-wiki/src/topic/analysis-prompts.ts` — Prompts for topic-focused analysis
- `packages/deep-wiki/test/topic/topic-analysis.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/topic/index.ts` — Add exports

## Implementation Notes

### `topic-analysis.ts` Structure

```typescript
import { TopicOutline, TopicAnalysis, TopicArticlePlan } from '../types';
import { EnrichedProbeResult } from './topic-probe';
import { ModuleAnalysis } from '../types';

export interface TopicAnalysisOptions {
    repoPath: string;
    outline: TopicOutline;
    probeResult: EnrichedProbeResult;
    existingAnalyses?: ModuleAnalysis[];  // reuse cached module analyses
    model?: string;
    timeout?: number;
    concurrency?: number;
    depth: 'shallow' | 'normal' | 'deep';
}

/**
 * Run analysis for the entire topic:
 * 1. For each sub-article in the outline → run per-article analysis
 *    (scoped to that article's covered modules and files)
 * 2. Run cross-cutting analysis for the index page
 *    (synthesizes how all modules collaborate for this feature)
 * 
 * Reuses existing ModuleAnalysis from cache when available.
 * Runs per-article analyses in parallel (respects concurrency).
 */
export async function runTopicAnalysis(
    options: TopicAnalysisOptions
): Promise<TopicAnalysis>;

/**
 * Analyze a single sub-article's scope.
 * Uses AI with read-only tools (view, grep) to examine the covered files
 * and produce keyConcepts, dataFlow, codeExamples, internalDetails.
 */
export async function analyzeArticleScope(
    repoPath: string,
    article: TopicArticlePlan,
    topicContext: string,
    options: { model?: string; timeout?: number; depth: string }
): Promise<TopicArticleAnalysis>;

/**
 * Generate cross-cutting analysis for the index page.
 * Takes all per-article analyses and synthesizes:
 * - Architecture overview (how modules collaborate)
 * - End-to-end data flow
 * - Mermaid diagram
 * - Configuration/tuning section
 * - Related topics
 */
export async function analyzeCrossCutting(
    repoPath: string,
    outline: TopicOutline,
    articleAnalyses: TopicArticleAnalysis[],
    options: { model?: string; timeout?: number }
): Promise<TopicCrossCuttingAnalysis>;
```

### Analysis Strategy
- **Per-article analysis**: Each article gets an AI session with `view` and `grep` tools scoped to its `coveredFiles`. The prompt asks for key concepts, data flow within this aspect, and code examples.
- **Cross-cutting analysis**: Receives summaries of all per-article analyses. Produces the holistic view: architecture diagram, end-to-end flow, configuration knobs.
- **Reuse**: If `existingAnalyses` includes a module analysis for a covered module, include that context in the prompt (saves token cost).

### Prompt Design
- Per-article prompt includes: topic name, article title/description, list of files to examine, depth setting
- Cross-cutting prompt includes: topic name, all article summaries, module dependency graph
- Both return JSON with schema validation

## Tests
- **Per-article analysis (mocked AI)**: Verify correct prompt construction, file scoping
- **Cross-cutting analysis (mocked)**: Verify synthesis from article analyses
- **Full runTopicAnalysis**: Mock both phases, verify TopicAnalysis structure
- **Concurrency**: Verify parallel execution respects concurrency limit
- **Reuse cached analyses**: Provide existingAnalyses, verify they're included in context
- **Empty outline**: Single-article topic → skip cross-cutting, return simplified analysis
- **AI failure**: Graceful degradation when individual article analysis fails

## Acceptance Criteria
- [ ] `runTopicAnalysis` produces complete `TopicAnalysis` for multi-article topics
- [ ] Per-article analyses run in parallel with concurrency control
- [ ] Cross-cutting analysis synthesizes all article results
- [ ] Existing `ModuleAnalysis` cache entries are reused when available
- [ ] Single-article topics produce simplified analysis (no cross-cutting)
- [ ] All tests pass

## Dependencies
- Depends on: 001 (types), 003 (EnrichedProbeResult), 004 (TopicOutline)
- Uses (existing, unchanged): AI service from pipeline-core
