---
status: pending
---

# 004: Topic Outline Generator

## Summary
Create an AI-driven module that takes probe results and decomposes a topic into a structured outline of articles — deciding whether the topic warrants a single article or a multi-article area.

## Motivation
This is the "planning brain" of the feature. Before generating articles, we need to know how many articles to generate and what each one covers. The AI examines the probe results (found modules, key files, complexity) and produces a `TopicOutline` that guides all subsequent phases. This is a separate commit because it's a self-contained AI interaction with its own prompt engineering.

## Changes

### Files to Create
- `packages/deep-wiki/src/topic/outline-generator.ts` — Outline generation logic
- `packages/deep-wiki/src/topic/outline-prompts.ts` — Prompt templates for outline generation
- `packages/deep-wiki/test/topic/outline-generator.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/topic/index.ts` — Add exports

## Implementation Notes

### `outline-generator.ts` Structure

```typescript
import { TopicOutline, TopicRequest } from '../types';
import { EnrichedProbeResult } from './topic-probe';

export interface OutlineGeneratorOptions {
    repoPath: string;
    topic: TopicRequest;
    probeResult: EnrichedProbeResult;
    depth: 'shallow' | 'normal' | 'deep';
    model?: string;
    timeout?: number;
}

/**
 * Generate a TopicOutline by asking AI to decompose the topic into articles.
 * 
 * Decision logic (AI-guided with heuristic fallbacks):
 * - 1-2 modules found → single article layout
 * - 3-6 modules found → area with index + per-aspect articles
 * - 7+ modules found → deep area (may include sub-sections)
 * 
 * The AI prompt includes:
 * - Topic name and description
 * - List of discovered modules with purposes and key files
 * - Instruction to group related modules into coherent articles
 * - Constraints: each article should be focused, self-contained, ~1000-3000 words
 */
export async function generateTopicOutline(
    options: OutlineGeneratorOptions
): Promise<TopicOutline>;

/**
 * Fallback: build outline without AI (for when AI is unavailable or for testing).
 * Uses module count heuristics to determine layout.
 */
export function buildFallbackOutline(
    topic: TopicRequest,
    probeResult: EnrichedProbeResult
): TopicOutline;
```

### `outline-prompts.ts` Structure

```typescript
/**
 * Build the prompt for topic decomposition.
 * 
 * Input context:
 * - Topic name, description, hints
 * - Found modules: id, name, purpose, keyFiles, evidence
 * - Depth setting (affects article count and granularity)
 * 
 * Expected JSON output:
 * {
 *   "title": "Compaction",
 *   "layout": "area",
 *   "articles": [
 *     { "slug": "index", "title": "...", "description": "...", "isIndex": true,
 *       "coveredModuleIds": [...], "coveredFiles": [...] },
 *     { "slug": "compaction-styles", ... },
 *     ...
 *   ]
 * }
 */
export function buildOutlinePrompt(
    topic: TopicRequest,
    probeResult: EnrichedProbeResult,
    depth: 'shallow' | 'normal' | 'deep'
): string;
```

### AI Interaction
- Uses direct SDK session (not pool) since this is a one-off call
- No tools needed (all context provided in prompt) — or optionally `view` for key files
- JSON output format with schema validation
- Timeout: 60s default (outline is a planning task, not deep analysis)

### Depth Influence
- `shallow`: Prefer fewer articles, broader scope per article
- `normal`: Balanced decomposition (default)
- `deep`: More articles, finer granularity, include tuning/internals articles

## Tests
- **Small topic (1-2 modules)**: Mock AI returns single-article layout → verify `layout: 'single'`
- **Medium topic (3-6 modules)**: Mock AI returns area layout → verify index + sub-articles
- **Large topic (7+ modules)**: Verify deep area with more articles
- **Fallback outline**: When AI fails, verify heuristic-based outline generation
- **Prompt construction**: Verify prompt includes all module info, respects depth setting
- **JSON parsing**: Verify robust parsing of AI response (handle malformed JSON)
- **Depth variations**: shallow produces fewer articles, deep produces more

## Acceptance Criteria
- [ ] `generateTopicOutline` returns valid `TopicOutline` for small/medium/large topics
- [ ] `buildFallbackOutline` works without AI (pure heuristics)
- [ ] Prompt includes all relevant context from probe results
- [ ] Depth setting influences article count
- [ ] JSON response parsing handles edge cases
- [ ] All tests pass

## Dependencies
- Depends on: 001 (types), 003 (probe result types)
