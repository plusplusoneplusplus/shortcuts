# Deep Wiki Generator - Developer Reference

CLI tool that auto-generates comprehensive wikis for any codebase using a three-phase AI pipeline.

## Package Structure

```
packages/deep-wiki/
├── src/
│   ├── index.ts              # CLI entry point (#!/usr/bin/env node)
│   ├── cli.ts                # Commander program setup, command routing, exit codes
│   ├── types.ts              # All shared interfaces (ModuleGraph, ModuleAnalysis, GeneratedArticle, etc.)
│   ├── schemas.ts            # JSON schema strings embedded in AI prompts
│   ├── ai-invoker.ts         # AIInvoker factory: analysis (with MCP tools) and writing (no tools)
│   ├── logger.ts             # Colored terminal output, spinners, verbosity control
│   ├── commands/
│   │   ├── discover.ts       # `discover` command: Phase 1 only, outputs ModuleGraph JSON
│   │   └── generate.ts       # `generate` command: Full 3-phase pipeline (Discovery → Analysis → Writing)
│   ├── discovery/
│   │   ├── index.ts          # Exports: discoverModuleGraph()
│   │   ├── discovery-session.ts  # SDK session orchestration for module graph discovery
│   │   ├── prompts.ts        # Discovery prompt templates
│   │   ├── response-parser.ts    # Parse AI response into ModuleGraph
│   │   └── large-repo-handler.ts # Multi-round discovery for 3000+ file repos
│   ├── analysis/
│   │   ├── index.ts          # Exports: analyzeModules(), parseAnalysisResponse()
│   │   ├── analysis-executor.ts  # Per-module AI analysis with concurrency control
│   │   ├── prompts.ts        # Analysis prompt templates (per-module deep dive)
│   │   └── response-parser.ts    # Parse analysis response into ModuleAnalysis
│   ├── writing/
│   │   ├── index.ts          # Exports: generateArticles(), writeWikiOutput(), generateWebsite()
│   │   ├── article-executor.ts   # Per-module article generation with concurrency
│   │   ├── file-writer.ts    # Write articles and index files to disk
│   │   ├── prompts.ts        # Article writing prompt templates
│   │   ├── reduce-prompts.ts # Reduce/synthesis prompts for overview articles
│   │   └── website-generator.ts  # Static HTML website generation with themes
│   └── cache/
│       ├── index.ts          # All cache operations: save/load/invalidate for each phase
│       └── git-utils.ts      # Git HEAD hash for cache invalidation
├── test/                     # 23 Vitest test files (mirrors src/ structure)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Three-Phase Pipeline

### Phase 1: Discovery

Produces a `ModuleGraph` JSON describing the project's structure:
- Uses a single AI session with MCP tools (grep, glob, view) to explore the repo
- Large repo support: multi-round discovery for 3000+ files (structural scan → per-area drill-down → merge)
- Output: `ModuleGraph` with `ProjectInfo`, `ModuleInfo[]`, `CategoryInfo[]`, optional `AreaInfo[]`

### Phase 2: Analysis

Per-module deep analysis using AI with MCP tools:
- Each module is analyzed independently with concurrency control
- AI has access to MCP tools to read source files and investigate dependencies
- Produces `ModuleAnalysis[]` with API surface, patterns, integration points
- Incremental: only re-analyzes modules whose files changed (git hash-based caching)

### Phase 3: Writing

Generates wiki articles and optional static website:
- Per-module article generation from analysis results
- Reduce/synthesis step for overview and cross-cutting articles
- File writer outputs markdown articles organized by area/category
- Website generator creates static HTML with navigation, themes (light/dark/auto)

## CLI Commands

### `deep-wiki discover <repo-path>`

Phase 1 only. Outputs `ModuleGraph` JSON.

```bash
deep-wiki discover ./my-project --output ./wiki --verbose
```

Options: `--output`, `--model`, `--timeout`, `--focus`, `--force`, `--use-cache`, `--verbose`, `--no-color`

### `deep-wiki generate <repo-path>`

Full three-phase pipeline.

```bash
deep-wiki generate ./my-project --output ./wiki --concurrency 3 --depth normal
```

Options: `--output`, `--model`, `--concurrency`, `--timeout`, `--focus`, `--depth` (shallow/normal/deep), `--force`, `--use-cache`, `--phase` (start from phase N), `--skip-website`, `--theme` (light/dark/auto), `--title`, `--verbose`, `--no-color`

## Key Types

```typescript
// Phase 1 output
interface ModuleGraph {
    project: ProjectInfo;
    modules: ModuleInfo[];
    categories: CategoryInfo[];
    areas?: AreaInfo[];
}

// Phase 2 output
interface ModuleAnalysis {
    moduleId: string;
    summary: string;
    publicAPI: APIEntry[];
    internalPatterns: string[];
    integrationPoints: IntegrationPoint[];
    gotchas: string[];
}

// Phase 3 output
interface GeneratedArticle {
    moduleId: string;
    title: string;
    content: string;
    area?: string;
}
```

## Caching

- Git HEAD hash-based invalidation: cache is invalidated when the commit hash changes
- Per-phase caching: discovery graph, analysis results, and articles are cached independently
- Incremental re-analysis: only modules with changed files are re-analyzed
- `--force` flag bypasses all caches; `--use-cache` uses existing cache regardless of git hash
- `--phase N` skips earlier phases using cached results

## Dependencies

- `@plusplusoneplusplus/pipeline-core` - AI SDK service, session management, `extractJSON` utility
- `commander` - CLI argument parsing
- `js-yaml` - YAML parsing (for project config detection)

## Testing

23 Vitest test files covering:
- Discovery: prompt templates, response parsing, large repo handler, area tagging
- Analysis: executor, prompts, response parsing
- Writing: article executor, file writer, prompts, website generator, hierarchical structure
- Cache: discovery, analysis, article, reduce-article caches, git utilities
- Commands: discover and generate integration tests
- CLI argument parsing, AI invoker, type validation

Run with `npm run test:run` in `packages/deep-wiki/` directory.

## See Also

- `packages/pipeline-core/AGENTS.md` - AI SDK and pipeline engine
- `packages/pipeline-cli/AGENTS.md` - YAML pipeline CLI (sibling package)
