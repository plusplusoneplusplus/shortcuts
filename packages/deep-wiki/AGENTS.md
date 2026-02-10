# Deep Wiki Generator - Developer Reference

CLI tool that auto-generates comprehensive wikis for any codebase using a five-phase AI pipeline.

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
│   │   ├── generate.ts       # `generate` command: Full 5-phase pipeline (Discovery → Consolidation → Analysis → Writing → Website)
│   │   └── serve.ts          # `serve` command: Interactive server with AI Q&A
│   ├── discovery/
│   │   ├── index.ts          # Exports: discoverModuleGraph()
│   │   ├── discovery-session.ts  # SDK session orchestration for module graph discovery
│   │   ├── prompts.ts        # Discovery prompt templates
│   │   ├── response-parser.ts    # Parse AI response into ModuleGraph
│   │   └── large-repo-handler.ts # Multi-round discovery for 3000+ file repos
│   ├── consolidation/
│   │   ├── index.ts          # Exports: consolidateModules()
│   │   ├── consolidator.ts   # Hybrid consolidation orchestration (rule-based + AI clustering)
│   │   ├── rule-based-consolidator.ts  # Directory-based module merging
│   │   └── ai-consolidator.ts         # AI-assisted semantic clustering
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
│   ├── server/
│   │   ├── index.ts          # Server creation, wiki data loading, context builder
│   │   ├── router.ts         # HTTP request routing (API, static files, SPA fallback)
│   │   ├── api-handlers.ts   # REST API dispatch (/api/graph, /api/modules, /api/ask, /api/explore)
│   │   ├── ask-handler.ts    # AI Q&A with SSE streaming (POST /api/ask)
│   │   ├── explore-handler.ts # Module deep-dive with SSE streaming (POST /api/explore/:id)
│   │   ├── context-builder.ts # TF-IDF context retrieval for AI question-answering
│   │   ├── spa-template.ts   # Single-page application HTML/CSS/JS generation
│   │   ├── wiki-data.ts      # Wiki data loading and querying
│   │   ├── websocket.ts      # WebSocket server for watch mode live reload
│   │   └── file-watcher.ts   # File system watcher for watch mode
│   └── cache/
│       ├── index.ts          # All cache operations: save/load/invalidate for each phase
│       └── git-utils.ts      # Git HEAD hash for cache invalidation
├── test/                     # 23 Vitest test files (mirrors src/ structure)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Five-Phase Pipeline

### Phase 1: Discovery

Produces a `ModuleGraph` JSON describing the project's structure:
- Uses a single AI session with MCP tools (grep, glob, view) to explore the repo
- Large repo support: multi-round discovery for 3000+ files (structural scan → per-area drill-down → merge)
- Output: `ModuleGraph` with `ProjectInfo`, `ModuleInfo[]`, `CategoryInfo[]`, optional `AreaInfo[]`

### Phase 2: Consolidation

Consolidates and refines the module graph from Phase 1 before analysis.

### Phase 3: Analysis

Per-module deep analysis using AI with MCP tools:
- Each module is analyzed independently with concurrency control
- AI has access to MCP tools to read source files and investigate dependencies
- Produces `ModuleAnalysis[]` with API surface, patterns, integration points
- Incremental: only re-analyzes modules whose files changed (git hash-based caching)

### Phase 4: Writing

Generates wiki articles from analysis results:
- Per-module article generation from analysis results
- Reduce/synthesis step for overview and cross-cutting articles
- File writer outputs markdown articles organized by area/category

### Phase 5: Website

Creates optional static HTML website:
- Website generator creates static HTML with navigation, themes (light/dark/auto)

## CLI Commands

### `deep-wiki discover <repo-path>`

Phase 1 only. Outputs `ModuleGraph` JSON.

```bash
deep-wiki discover ./my-project --output ./wiki --verbose
```

Options: `--output`, `--model`, `--timeout`, `--focus`, `--force`, `--use-cache`, `--verbose`, `--no-color`

### `deep-wiki generate <repo-path>`

Full five-phase pipeline.

```bash
deep-wiki generate ./my-project --output ./wiki --concurrency 3 --depth normal
```

Options: `--output`, `--model`, `--concurrency`, `--timeout`, `--focus`, `--depth` (shallow/normal/deep), `--force`, `--use-cache`, `--phase` (start from phase N: 1, 2, 3, or 4), `--skip-website`, `--theme` (light/dark/auto), `--title`, `--verbose`, `--no-color`

### `deep-wiki serve <wiki-dir>`

Interactive server mode — serves the generated wiki with AI Q&A and module exploration.

```bash
deep-wiki serve ./wiki --port 3000 --open
```

Options: `--port` (default: 3000), `--host` (default: localhost), `--generate <repo-path>`, `--watch`, `--no-ai`, `--model`, `--open`, `--theme`, `--title`, `--verbose`, `--no-color`

## Debugging Serve Mode

### Build and Start the Server

```bash
# Build pipeline-core and deep-wiki, then link the CLI globally
cd packages/deep-wiki && npm run build && npm link && cd ../..

# Start the server (assumes wiki was previously generated at ./.wiki)
deep-wiki serve ./.wiki

# Start on a custom port
deep-wiki serve ./.wiki --port 4000

# Start without AI features (faster startup, no Copilot SDK needed)
deep-wiki serve ./.wiki --no-ai

# Generate wiki and serve in one step
deep-wiki serve ./.wiki --generate ./path/to/repo
```

### Testing the Ask AI Endpoint

```bash
# Test the /api/ask endpoint directly with curl
curl -s -N -X POST http://localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is this project?"}' 

# Expected SSE output:
# data: {"type":"context","moduleIds":["mod1","mod2",...]}
# data: {"type":"chunk","content":"...streaming content..."}
# data: {"type":"done","fullResponse":"...full answer..."}
```

### Testing the Explore Endpoint

```bash
# Test deep-dive exploration for a specific module
curl -s -N -X POST http://localhost:3000/api/explore/module-id \
  -H 'Content-Type: application/json' \
  -d '{"question":"How does this module handle errors?","depth":"deep"}'
```

### Server Architecture

The serve mode uses a custom HTTP server (no Express dependency):

- **`src/commands/serve.ts`** — CLI command handler, AI service initialization
- **`src/server/index.ts`** — Server creation, wiki data loading, context builder setup
- **`src/server/router.ts`** — HTTP request routing (API routes, static files, SPA fallback)
- **`src/server/api-handlers.ts`** — REST API route dispatch (`/api/graph`, `/api/modules`, `/api/ask`, `/api/explore`)
- **`src/server/ask-handler.ts`** — AI Q&A with SSE streaming (`POST /api/ask`)
- **`src/server/explore-handler.ts`** — Module deep-dive with SSE streaming (`POST /api/explore/:id`)
- **`src/server/context-builder.ts`** — TF-IDF based context retrieval for question-answering
- **`src/server/spa-template.ts`** — Single-page application HTML/CSS/JS generation
- **`src/server/wiki-data.ts`** — Wiki data loading and querying
- **`src/server/websocket.ts`** — WebSocket server for watch mode live reload
- **`src/server/file-watcher.ts`** — File system watcher for watch mode

### SSE Streaming Flow

1. Browser sends `POST /api/ask` with `{question, conversationHistory}`
2. Server retrieves relevant module context via TF-IDF (`ContextBuilder.retrieve()`)
3. Server builds AI prompt with context + conversation history
4. Server calls Copilot SDK with `onStreamingChunk` callback
5. Each chunk is emitted as an SSE event: `data: {"type":"chunk","content":"..."}`
6. When complete: `data: {"type":"done","fullResponse":"..."}`
7. Browser parses SSE events and renders markdown in real-time

### Common Issues

- **Port already in use**: Use `--port <number>` to specify a different port
- **AI features unavailable**: Ensure `@github/copilot-sdk` is installed and Copilot is authenticated; use `--no-ai` to start without AI
- **No streaming chunks**: The SDK may send `assistant.message` instead of `assistant.message_delta` events; pipeline-core handles this by emitting the final message as a single chunk

## Key Types

```typescript
// Phase 1 output
interface ModuleGraph {
    project: ProjectInfo;
    modules: ModuleInfo[];
    categories: CategoryInfo[];
    areas?: AreaInfo[];
}

// Phase 3 output
interface ModuleAnalysis {
    moduleId: string;
    summary: string;
    publicAPI: APIEntry[];
    internalPatterns: string[];
    integrationPoints: IntegrationPoint[];
    gotchas: string[];
}

// Phase 4 output
interface GeneratedArticle {
    moduleId: string;
    title: string;
    content: string;
    area?: string;
}
```

## Caching

- Git HEAD hash-based invalidation: cache is invalidated when the commit hash changes
- Per-phase caching: discovery graph, consolidation, analysis results, and articles are cached independently
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
