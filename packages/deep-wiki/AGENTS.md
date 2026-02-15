# Deep Wiki Generator - Developer Reference

CLI tool that auto-generates comprehensive wikis for any codebase using a six-phase AI pipeline.

## Package Structure

```
packages/deep-wiki/
├── src/
│   ├── index.ts              # CLI entry point (#!/usr/bin/env node)
│   ├── cli.ts                # Commander program setup, command routing, exit codes
│   ├── types.ts              # All shared interfaces (ComponentGraph, ComponentAnalysis, GeneratedArticle, etc.)
│   ├── schemas.ts            # JSON schema strings embedded in AI prompts
│   ├── ai-invoker.ts         # AIInvoker factory: analysis (with MCP tools) and writing (no tools)
│   ├── logger.ts             # Colored terminal output, spinners, verbosity control
│   ├── usage-tracker.ts      # Token usage accumulator per phase, CLI display and JSON export
│   ├── commands/
│   │   ├── seeds.ts          # `seeds` command: Generate theme seeds for breadth-first discovery
│   │   ├── discover.ts       # `discover` command: Phase 1 only, outputs ComponentGraph JSON
│   │   ├── generate.ts       # `generate` command: Full pipeline (Seeds → Discovery → Consolidation → Analysis → Writing → Website)
│   │   └── serve.ts          # `serve` command: Interactive server with AI Q&A
│   ├── seeds/
│   │   ├── index.ts          # Exports: generateThemeSeeds(), parseSeedFile()
│   │   ├── seeds-session.ts  # SDK session orchestration for theme seed generation
│   │   ├── prompts.ts        # Seeds prompt templates
│   │   ├── response-parser.ts    # Parse AI response into ThemeSeed[]
│   │   ├── seed-file-parser.ts   # Parse JSON/CSV seed files into ThemeSeed[]
│   │   └── heuristic-fallback.ts # Directory-name-based fallback when AI under-generates
│   ├── discovery/
│   │   ├── index.ts          # Exports: discoverComponentGraph()
│   │   ├── discovery-session.ts  # SDK session orchestration for component graph discovery
│   │   ├── prompts.ts        # Discovery prompt templates
│   │   ├── response-parser.ts    # Parse AI response into ComponentGraph
│   │   ├── large-repo-handler.ts # Multi-round discovery for 3000+ file repos
│   │   └── iterative/        # Breadth-first iterative discovery using topic seeds
│   │       ├── index.ts          # Exports: runIterativeDiscovery(), probe/merge functions
│   │       ├── iterative-discovery.ts  # Iterative discovery orchestration
│   │       ├── probe-session.ts  # Per-theme probe SDK session
│   │       ├── probe-prompts.ts  # Probe prompt templates
│   │       ├── probe-response-parser.ts  # Parse probe responses
│   │       ├── merge-session.ts  # Merge SDK session to combine probe results
│   │       ├── merge-prompts.ts  # Merge prompt templates
│   │       └── merge-response-parser.ts  # Parse merge responses
│   ├── consolidation/
│   │   ├── index.ts          # Exports: consolidateComponents()
│   │   ├── consolidator.ts   # Hybrid consolidation orchestration (rule-based + AI clustering)
│   │   ├── rule-based-consolidator.ts  # Directory-based component merging
│   │   └── ai-consolidator.ts         # AI-assisted semantic clustering
│   ├── analysis/
│   │   ├── index.ts          # Exports: analyzeComponents(), parseAnalysisResponse()
│   │   ├── analysis-executor.ts  # Per-component AI analysis with concurrency control
│   │   ├── prompts.ts        # Analysis prompt templates (per-component deep dive)
│   │   └── response-parser.ts    # Parse analysis response into ComponentAnalysis
│   ├── writing/
│   │   ├── index.ts          # Exports: generateArticles(), writeWikiOutput(), generateWebsite()
│   │   ├── article-executor.ts   # Per-component article generation with concurrency
│   │   ├── file-writer.ts    # Write articles and index files to disk
│   │   ├── prompts.ts        # Article writing prompt templates
│   │   ├── reduce-prompts.ts # Reduce/synthesis prompts for overview articles
│   │   └── website-generator.ts  # Static HTML website generation with themes
│   ├── rendering/
│   │   └── mermaid-zoom.ts   # Shared Mermaid diagram zoom/pan CSS, HTML, JS for SPA and static website
│   ├── server/
│   │   ├── index.ts          # Server creation, wiki data loading, context builder
│   │   ├── router.ts         # HTTP request routing (API, static files, SPA fallback)
│   │   ├── api-handlers.ts   # REST API dispatch (/api/graph, /api/components, /api/ask, /api/explore)
│   │   ├── ask-handler.ts    # AI Q&A with SSE streaming (POST /api/ask)
│   │   ├── explore-handler.ts # Component deep-dive with SSE streaming (POST /api/explore/:id)
│   │   ├── context-builder.ts # TF-IDF context retrieval for AI question-answering
│   │   ├── conversation-session-manager.ts # Multi-turn conversation session management with auto-cleanup
│   │   ├── spa-template.ts   # Single-page application HTML/CSS/JS generation
│   │   ├── wiki-data.ts      # Wiki data loading and querying
│   │   ├── websocket.ts      # WebSocket server for watch mode live reload
│   │   └── file-watcher.ts   # File system watcher for watch mode
│   └── cache/
│       ├── index.ts          # All cache operations: save/load/invalidate for each phase
│       ├── cache-utils.ts    # Low-level atomic read/write/scan primitives shared by all cache modules
│       ├── discovery-cache.ts # Intermediate discovery artifact caching (seeds, probes, structural scans)
│       └── git-utils.ts      # Git HEAD hash for cache invalidation
├── test/                     # 78 Vitest test files (mirrors src/ structure)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Six-Phase Pipeline

### Phase 0: Seeds (Optional)

Generates theme seeds for breadth-first discovery:
- AI session with MCP tools scans the repo to identify key themes/domains
- Heuristic fallback: uses top-level directory names when AI under-generates
- Output: `ThemeSeed[]` with theme, description, and hints
- Supports JSON and CSV seed file formats
- Can be run standalone (`seeds` command) or auto-generated during discovery (`--seeds auto`)

### Phase 1: Discovery

Produces a `ComponentGraph` JSON describing the project's structure:
- Uses a single AI session with MCP tools (grep, glob, view) to explore the repo
- Large repo support: multi-round discovery for 3000+ files (structural scan → per-domain drill-down → merge)
- Iterative discovery mode: breadth-first using theme seeds (probe per theme → merge results)
- Output: `ComponentGraph` with `ProjectInfo`, `ComponentInfo[]`, `CategoryInfo[]`, optional `DomainInfo[]`
- Intermediate results cached in `.wiki-cache/discovery/` for crash recovery

### Phase 2: Consolidation

Consolidates and refines the component graph from Phase 1 before analysis:
- Rule-based consolidation: merges components in the same directory
- AI-assisted clustering: semantic grouping of related components
- Can be skipped with `--no-cluster`

### Phase 3: Analysis

Per-component deep analysis using AI with MCP tools:
- Each component is analyzed independently with concurrency control
- AI has access to MCP tools to read source files and investigate dependencies
- Produces `ComponentAnalysis[]` with API surface, patterns, integration points
- Incremental: only re-analyzes components whose files changed (git hash-based caching)

### Phase 4: Writing

Generates wiki articles from analysis results:
- Per-component article generation from analysis results
- Reduce/synthesis step for overview and cross-cutting articles
- File writer outputs markdown articles organized by domain/category

### Phase 5: Website

Creates optional static HTML website:
- Website generator creates static HTML with navigation, themes (light/dark/auto)
- Shared Mermaid zoom/pan controls via `rendering/mermaid-zoom.ts`

## CLI Commands

### `deep-wiki seeds <repo-path>`

Generate theme seeds for breadth-first discovery (Phase 0).

```bash
deep-wiki seeds ./my-project --output seeds.json --max-themes 50
```

Options: `--output`, `--max-themes`, `--model`, `--verbose`, `--no-color`

### `deep-wiki discover <repo-path>`

Phase 1 only. Outputs `ComponentGraph` JSON.

```bash
deep-wiki discover ./my-project --output ./wiki --verbose
deep-wiki discover ./my-project --seeds seeds.json   # Use pre-generated seeds
deep-wiki discover ./my-project --seeds auto          # Auto-generate seeds
```

Options: `--output`, `--model`, `--timeout`, `--focus`, `--seeds`, `--force`, `--use-cache`, `--verbose`, `--no-color`

### `deep-wiki generate <repo-path>`

Full six-phase pipeline.

```bash
deep-wiki generate ./my-project --output ./wiki --concurrency 3 --depth normal
```

Options: `--output`, `--model`, `--concurrency`, `--timeout`, `--focus`, `--seeds`, `--depth` (shallow/normal/deep), `--force`, `--use-cache`, `--phase` (start from phase N: 1, 2, 3, or 4), `--skip-website`, `--no-cluster`, `--no-strict`, `--theme` (light/dark/auto), `--title`, `--verbose`, `--no-color`

### `deep-wiki serve <wiki-dir>`

Interactive server mode — serves the generated wiki with AI Q&A and component exploration.

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
# Test deep-dive exploration for a specific component
curl -s -N -X POST http://localhost:3000/api/explore/component-id \
  -H 'Content-Type: application/json' \
  -d '{"question":"How does this component handle errors?","depth":"deep"}'
```

### Server Architecture

The serve mode uses a custom HTTP server (no Express dependency):

- **`src/commands/serve.ts`** — CLI command handler, AI service initialization
- **`src/server/index.ts`** — Server creation, wiki data loading, context builder setup
- **`src/server/router.ts`** — HTTP request routing (API routes, static files, SPA fallback)
- **`src/server/api-handlers.ts`** — REST API route dispatch (`/api/graph`, `/api/components`, `/api/ask`, `/api/explore`)
- **`src/server/ask-handler.ts`** — AI Q&A with SSE streaming (`POST /api/ask`)
- **`src/server/explore-handler.ts`** — Component deep-dive with SSE streaming (`POST /api/explore/:id`)
- **`src/server/context-builder.ts`** — TF-IDF based context retrieval for question-answering
- **`src/server/conversation-session-manager.ts`** — Multi-turn conversation session management with auto-cleanup and concurrency control
- **`src/server/spa-template.ts`** — Single-page application HTML/CSS/JS generation
- **`src/server/wiki-data.ts`** — Wiki data loading and querying
- **`src/server/websocket.ts`** — WebSocket server for watch mode live reload
- **`src/server/file-watcher.ts`** — File system watcher for watch mode

### SSE Streaming Flow

1. Browser sends `POST /api/ask` with `{question, conversationHistory}`
2. Server retrieves relevant component context via TF-IDF (`ContextBuilder.retrieve()`)
3. Server builds AI prompt with context + conversation history
4. Server calls Copilot SDK with `onStreamingChunk` callback
5. Each chunk is emitted as an SSE event: `data: {"type":"chunk","content":"..."}`
6. When complete: `data: {"type":"done","fullResponse":"..."}`
7. Browser parses SSE events and renders markdown in real-time

### Common Issues

- **Port already in use**: Use `--port <number>` to specify a different port
- **AI features unavailable**: Ensure `@github/copilot-sdk` is installed and Copilot is authenticated; use `--no-ai` to start without AI
- **No streaming chunks**: The SDK may send `assistant.message` instead of `assistant.message_delta` events; pipeline-core handles this by emitting the final message as a single chunk

## Core Concepts: Domain, Component, and Theme

The wiki generator organizes codebases using three concepts:

| Concept | Level | Description |
|---------|-------|-------------|
| **Component** | Smallest unit | A code directory/unit with a specific purpose. Every repo has these. Code type: `ComponentInfo`. |
| **Domain** | Structural grouping | Top-level directory regions. **Only exists for large repos (3000+ files)**. Each domain contains multiple components. Code type: `DomainInfo`. |
| **Theme** | Cross-cutting grouping | User-defined business/architectural concerns that span multiple components (e.g., "Authentication" touching auth, middleware, and config components). Code type: `ThemeMeta`. |

> **Note:** The conceptual hierarchy is "Domain → Module → Component" but the current code
> has no explicit "Module" mid-tier entity. "Module" is reserved for a future grouping
> level between Domain and Component.

### Hierarchy

```
ComponentGraph
├── components: ComponentInfo[]            ← always present
│   └── domain?: string                    ← links to a domain (large repos only)
├── domains?: DomainInfo[]                 ← large repos only
│   └── components: string[]               ← IDs of components in this domain
└── themes?: ThemeAreaMeta[]               ← user-created cross-cutting themes
    └── involvedComponentIds: string[]     ← components involved
```

### Relationships

- **Component vs Domain** — Structural containment. A domain is a top-level directory that *contains* components. Domains are discovered automatically during Phase 1 for repos with 3000+ files via multi-round discovery (structural scan → per-domain drill-down → merge).
- **Component vs Theme** — Logical/semantic grouping. A theme *references* components across different domains. A single component can belong to multiple themes. Themes capture *what things do together*, not *where they live*.
- **Domain vs Theme** — Domains are discovered automatically from repo structure; themes are defined to capture cross-cutting concerns that don't align with directory layout.

### How Each Phase Uses These Concepts

| Phase | Components | Domains | Themes |
|-------|------------|---------|--------|
| **Phase 0: Seeds** | — | — | Seeds hint at potential themes |
| **Phase 1: Discovery** | Discovered from repo | Created for 3000+ file repos | — |
| **Phase 2: Consolidation** | Merged/clustered | Preserved | — |
| **Phase 3: Analysis** | Each analyzed independently | — | — |
| **Phase 4: Writing** | Component articles generated | Domain-index & domain-architecture articles generated | Theme articles generated |
| **Phase 5: Website** | Rendered as pages | Rendered as sections | Rendered as sections |

## Key Types

```typescript
// Phase 0 output
interface ThemeSeed {
    theme: string;
    description: string;
    hints?: string[];
}

// Phase 1 output
interface ComponentGraph {
    project: ProjectInfo;
    components: ComponentInfo[];
    categories: CategoryInfo[];
    domains?: DomainInfo[];          // Only for large repos (3000+ files)
    themes?: ThemeAreaMeta[];        // Populated by theme command
}

interface ComponentInfo {
    id: string;                  // kebab-case ID
    name: string;
    path: string;                // Relative to repo root
    purpose: string;
    keyFiles: string[];
    dependencies: string[];      // IDs of other components
    dependents: string[];
    complexity: 'low' | 'medium' | 'high';
    category: string;
    domain?: string;             // Domain slug (large repos only)
    mergedFrom?: string[];       // Set by consolidation phase
}

interface DomainInfo {
    id: string;                  // kebab-case from path
    name: string;
    path: string;                // Relative to repo root
    description: string;
    components: string[];        // IDs of components in this domain
}

interface ThemeAreaMeta {
    id: string;
    title: string;
    description: string;
    layout: 'single' | 'domain';
    articles: { slug: string; title: string; path: string }[];
    involvedComponentIds: string[];  // Components involved in this theme
    directoryPath: string;
}

// Phase 3 output
interface ComponentAnalysis {
    componentId: string;
    summary: string;
    publicAPI: APIEntry[];
    internalPatterns: string[];
    integrationPoints: IntegrationPoint[];
    gotchas: string[];
}

// Phase 4 output
interface GeneratedArticle {
    componentId: string;
    title: string;
    content: string;
    domain?: string;
}
```

## Caching

- Git HEAD hash-based invalidation: cache is invalidated when the commit hash changes
- Per-phase caching: discovery graph, consolidation, analysis results, and articles are cached independently
- Discovery-level caching: seeds, probe results, structural scans, and round progress metadata cached in `.wiki-cache/discovery/`
- Shared cache utilities (`cache-utils.ts`): atomic writes (temp file + rename), generic read with validation, batch scan
- Incremental re-analysis: only components with changed files are re-analyzed
- `--force` flag bypasses all caches; `--use-cache` uses existing cache regardless of git hash
- `--phase N` skips earlier phases using cached results

## Dependencies

- `@plusplusoneplusplus/pipeline-core` - AI SDK service, session management, `extractJSON` utility
- `commander` - CLI argument parsing
- `js-yaml` - YAML parsing (for project config detection)

## Testing

78 Vitest test files covering:
- Seeds: prompt templates, response parsing, seed file parsing, heuristic fallback
- Discovery: prompt templates, response parsing, large repo handler, domain tagging, logging, iterative discovery (probes, merges, caching)
- Consolidation: consolidator orchestration, rule-based consolidator, AI consolidator
- Analysis: executor, prompts, response parsing
- Writing: article executor, file writer, prompts, website generator, hierarchical structure
- Rendering: mermaid zoom/pan module
- Cache: discovery, analysis, article, reduce-article, consolidation, domain-article caches, cache utilities, git utilities, index
- Commands: seeds, discover, generate, and serve integration tests
- Server: ask-handler, ask-panel, ask-api-integration, explore-handler, deep-dive-ui, api-handlers, context-builder, conversation-session-manager, dependency-graph, spa-template, websocket, file-watcher, wiki-data, index
- CLI argument parsing, AI invoker, type validation, usage tracker

Run with `npm run test:run` in `packages/deep-wiki/` directory.

## See Also

- `packages/pipeline-core/AGENTS.md` - AI SDK and pipeline engine
- `packages/coc/AGENTS.md` - CoC CLI (sibling package)
