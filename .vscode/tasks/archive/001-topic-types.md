---
status: pending
---

# 001: Add Topic-Related Type Definitions

## Summary
Define all TypeScript types and interfaces needed for the topic generation feature in `packages/deep-wiki/src/types.ts`.

## Motivation
Types are the foundation that all subsequent commits depend on. Defining them first ensures a shared vocabulary across probe, analysis, writing, caching, and CLI modules. This commit is purely additive — no existing code changes.

## Changes

### Files to Modify
- `packages/deep-wiki/src/types.ts` — Add new type definitions at the end of the file, following existing patterns (JSDoc comments, exported interfaces)

### New Types to Add

```typescript
/** User-provided topic request */
export interface TopicRequest {
    topic: string;           // kebab-case ID (e.g., "compaction")
    description?: string;    // User-provided description for better discovery
    hints?: string[];        // Optional search hints (grep terms)
}

/** Result of checking topic coverage in existing wiki */
export interface TopicCoverageCheck {
    status: 'new' | 'partial' | 'exists';
    existingArticlePath?: string;
    relatedModules: TopicRelatedModule[];
}

export interface TopicRelatedModule {
    moduleId: string;
    articlePath: string;
    relevance: 'high' | 'medium' | 'low';
    matchReason: string;
}

/** AI-generated outline for how to decompose the topic into articles */
export interface TopicOutline {
    topicId: string;
    title: string;
    layout: 'single' | 'area';
    articles: TopicArticlePlan[];
    involvedModules: TopicInvolvedModule[];
}

export interface TopicArticlePlan {
    slug: string;
    title: string;
    description: string;
    isIndex: boolean;
    coveredModuleIds: string[];
    coveredFiles: string[];
}

export interface TopicInvolvedModule {
    moduleId: string;
    role: string;
    keyFiles: string[];
}

/** Cross-cutting topic analysis result */
export interface TopicAnalysis {
    topicId: string;
    overview: string;
    perArticle: TopicArticleAnalysis[];
    crossCutting: TopicCrossCuttingAnalysis;
}

export interface TopicArticleAnalysis {
    slug: string;
    keyConcepts: { name: string; description: string; codeRef?: string }[];
    dataFlow: string;
    codeExamples: { title: string; code: string; file: string }[];
    internalDetails: string;
}

export interface TopicCrossCuttingAnalysis {
    architecture: string;
    dataFlow: string;
    suggestedDiagram: string;
    configuration?: string;
    relatedTopics?: string[];
}

/** Generated topic article (individual file within the area) */
export interface TopicArticle {
    type: 'topic-index' | 'topic-article';
    slug: string;
    title: string;
    content: string;
    topicId: string;
    coveredModuleIds: string[];
}

/** Topic area metadata stored in module-graph.json */
export interface TopicAreaMeta {
    id: string;
    title: string;
    description: string;
    layout: 'single' | 'area';
    articles: { slug: string; title: string; path: string }[];
    involvedModuleIds: string[];
    directoryPath: string;
    generatedAt: number;
    gitHash?: string;
}

/** CLI options for the topic command */
export interface TopicCommandOptions {
    topic: string;
    description?: string;
    wiki: string;            // path to existing wiki directory
    force: boolean;
    check: boolean;
    list: boolean;
    model?: string;
    depth: 'shallow' | 'normal' | 'deep';
    timeout: number;
    concurrency: number;
    noCrossLink: boolean;
    noWebsite: boolean;
    interactive: boolean;
    verbose: boolean;
}
```

### Extend ModuleGraph (optional `topics` field)
```typescript
// Add to existing ModuleGraph interface:
export interface ModuleGraph {
    // ... existing fields ...
    /** Topic area metadata (populated by topic command) */
    topics?: TopicAreaMeta[];
}
```

## Implementation Notes
- Follow existing JSDoc pattern in types.ts (every interface gets a `/** */` comment)
- Export all types (they'll be consumed across multiple modules)
- The `TopicAreaMeta` type mirrors the structure stored in `module-graph.json`
- `TopicCommandOptions` follows the same pattern as `GenerateCommandOptions`
- Adding `topics?: TopicAreaMeta[]` to `ModuleGraph` is backward-compatible (optional field)

## Tests
- `packages/deep-wiki/test/types.test.ts` — Add type validation tests (if the file has runtime checks)
- Mostly compile-time validation; TypeScript compiler ensures correctness

## Acceptance Criteria
- [ ] All new types compile without errors (`npm run build` in packages/deep-wiki)
- [ ] `ModuleGraph` now has optional `topics` field
- [ ] Existing tests still pass
- [ ] Types are exported from the package barrel (if applicable)

## Dependencies
- Depends on: None
