---
status: pending
---

# 006: Topic Article Generator

## Summary
Create a module that generates markdown articles for each item in the topic outline, using the map-reduce pattern: map generates per-sub-article content, reduce synthesizes the index page.

## Motivation
This is the core writing phase — turning analysis into readable documentation. It follows the existing article-executor pattern (map phase for individual articles, reduce for synthesis) but adapts it for topic-centric content. Each sub-article is self-contained but cross-references its siblings. The index page provides the holistic overview with architecture diagram and navigation.

## Changes

### Files to Create
- `packages/deep-wiki/src/topic/article-generator.ts` — Article generation logic
- `packages/deep-wiki/src/topic/article-prompts.ts` — Writing prompts for topic articles
- `packages/deep-wiki/test/topic/article-generator.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/topic/index.ts` — Add exports

## Implementation Notes

### `article-generator.ts` Structure

```typescript
import { TopicOutline, TopicAnalysis, TopicArticle } from '../types';

export interface TopicArticleGenOptions {
    topicId: string;
    outline: TopicOutline;
    analysis: TopicAnalysis;
    depth: 'shallow' | 'normal' | 'deep';
    model?: string;
    timeout?: number;
    concurrency?: number;
    onArticleComplete?: (article: TopicArticle) => void;  // incremental callback
}

export interface TopicArticleGenResult {
    articles: TopicArticle[];
    duration: number;
    failedSlugs?: string[];
}

/**
 * Generate all articles for a topic area:
 * 
 * 1. MAP phase: Generate sub-articles in parallel
 *    - Each article gets its specific analysis context
 *    - Prompt includes sibling article titles (for cross-references)
 *    - Output: markdown content with proper headings, code blocks, links
 * 
 * 2. REDUCE phase: Generate index page
 *    - Receives all sub-article summaries
 *    - Produces overview, architecture diagram, navigation links
 *    - Cross-module data flow summary
 */
export async function generateTopicArticles(
    options: TopicArticleGenOptions
): Promise<TopicArticleGenResult>;
```

### `article-prompts.ts` Structure

```typescript
/**
 * Build prompt for a single sub-article.
 * 
 * Context includes:
 * - Topic name and overall description
 * - This article's title, description, and covered files
 * - Analysis results (keyConcepts, dataFlow, codeExamples)
 * - Sibling article titles (for "See also" cross-references)
 * - Depth setting influences length and detail
 * 
 * Output: raw markdown (not JSON) — heading, prose, code blocks, diagrams
 */
export function buildSubArticlePrompt(
    topicTitle: string,
    article: TopicArticlePlan,
    analysis: TopicArticleAnalysis,
    siblingTitles: { slug: string; title: string }[],
    depth: 'shallow' | 'normal' | 'deep'
): string;

/**
 * Build prompt for the index/overview page (reduce).
 * 
 * Context includes:
 * - Topic name and description
 * - Summaries of all sub-articles (first 200 words each)
 * - Cross-cutting analysis (architecture, data flow, diagram)
 * - Links to each sub-article
 * 
 * Output: markdown with:
 * - Overview section
 * - Architecture diagram (mermaid)
 * - Table of contents linking to sub-articles
 * - Cross-module data flow
 * - Related modules section (links to wiki module articles)
 */
export function buildIndexPagePrompt(
    topicTitle: string,
    outline: TopicOutline,
    crossCutting: TopicCrossCuttingAnalysis,
    articleSummaries: { slug: string; title: string; summary: string }[]
): string;
```

### Article Structure Conventions
- Sub-articles: `# {Article Title}\n\n> Part of the [{Topic Title}](./index.md) topic area.\n\n...`
- Index page: `# {Topic Title}\n\n{overview}\n\n## Architecture\n\n{mermaid}\n\n## Articles\n\n{links}...`
- Cross-references use relative links: `[Compaction Styles](./compaction-styles.md)`
- Code examples use fenced blocks with language tags

### Map-Reduce Execution
- MAP: Use existing `runParallel` utility from pipeline-core for sub-article generation
- REDUCE: Single AI call for index page, after all sub-articles complete
- `onArticleComplete` callback enables incremental caching (commit 007)

## Tests
- **Single article generation**: Topic with `layout: 'single'` → 1 article, no reduce
- **Multi-article generation**: Topic with `layout: 'area'` → sub-articles + index
- **Prompt construction**: Verify sub-article prompt includes correct analysis context
- **Index prompt**: Verify index prompt includes summaries and cross-cutting analysis
- **Cross-references**: Generated articles contain relative links to siblings
- **onArticleComplete callback**: Verify called for each article
- **Partial failure**: One sub-article fails → others succeed, failedSlugs populated
- **Depth influence**: shallow → shorter content, deep → longer with more detail

## Acceptance Criteria
- [ ] `generateTopicArticles` produces correct articles for single and area layouts
- [ ] Sub-articles include cross-references to siblings
- [ ] Index page includes architecture diagram, ToC, and data flow
- [ ] `onArticleComplete` fires incrementally
- [ ] Partial failures don't block other articles
- [ ] All tests pass

## Dependencies
- Depends on: 001 (types), 004 (outline), 005 (analysis)
