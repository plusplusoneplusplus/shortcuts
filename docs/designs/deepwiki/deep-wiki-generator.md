# Deep Wiki Generator

## Overview

A standalone CLI tool that auto-generates a comprehensive, browsable wiki for any codebase. Inspired by Cognition's [DeepWiki](https://deepwiki.com/), but runs locally via the Copilot SDK — no code leaves the machine.

**Output:** Markdown files in a folder, ready for conversion to a static site (e.g., via MkDocs, Docusaurus, or similar).

**Status:** All three phases are implemented and functional. 451 tests passing across 21 test files.

## Goals

1. **Any repo size** — scales from 10-file projects to 5000+ file monorepos
2. **Standalone CLI** — no VS Code dependency, uses `pipeline-core` package
3. **High quality** — AI has live tool access (grep, glob, view) to investigate code during generation
4. **Incremental** — cache analysis results, only regenerate changed modules
5. **Customizable** — control depth, focus areas, writing style

## Architecture

### Three-Phase Pipeline

The generator uses three sequential phases. Each phase builds on the output of the previous one.

```
Phase 1: DISCOVER          Phase 2: ANALYZE           Phase 3: WRITE
─────────────────          ──────────────────         ──────────────

Repo (local clone)         Module list + graph        Wiki articles
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────┐           ┌──────────────┐           ┌──────────────┐
│  AI + Tools  │           │  Map-Reduce  │           │  Map-Reduce  │
│  (1 session) │──────▶    │  (parallel)  │──────▶    │  (parallel)  │──▶ Markdown
│              │           │              │           │              │    files
│  grep, glob, │  Module   │  1 session   │  Deep     │  1 session   │
│  view        │  Graph    │  per module  │  Analysis │  per topic   │
└──────────────┘           └──────────────┘           └──────────────┘

   Not parallel               Parallel (N)              Parallel (N)
   ~1-3 minutes               ~2-10 minutes              ~2-5 minutes
```

### Why Three Phases

| Phase | Purpose | Why separate |
|-------|---------|--------------|
| Discovery | Build holistic understanding of repo structure | Cannot be parallelized — needs global view |
| Analysis | Deep-dive into each module's internals | Parallelizable, structured output for reuse |
| Writing | Generate polished prose articles | Parallelizable, can be re-run with different styles without re-analyzing |

Separating analysis from writing also enables **caching**: re-run Phase 3 with a different audience or style without repeating the expensive Phase 2.

## Phase 1: Discovery

**Input:** Path to local git clone
**Output:** Module graph (JSON)
**Parallelism:** None — single AI session

A single long-running AI session with MCP tool access (`grep`, `glob`, `view`). The AI:

1. Scans directory structure via `glob`
2. Reads key files: README, package.json/Cargo.toml/go.mod, entry points, configs
3. Identifies modules, packages, and major directories
4. Maps dependencies and relationships between modules
5. Determines the "story" of the codebase — what it does, how it's organized

### Output Schema

```json
{
  "project": {
    "name": "my-project",
    "description": "Brief description inferred from README/config",
    "language": "TypeScript",
    "buildSystem": "npm + webpack",
    "entryPoints": ["src/index.ts"]
  },
  "modules": [
    {
      "id": "auth",
      "name": "Authentication Module",
      "path": "src/auth/",
      "purpose": "Handles user authentication and session management",
      "keyFiles": ["src/auth/index.ts", "src/auth/jwt.ts", "src/auth/middleware.ts"],
      "dependencies": ["database", "config"],
      "dependents": ["api", "web"],
      "complexity": "medium",
      "category": "core",
      "area": "packages-core"
    }
  ],
  "categories": [
    { "name": "core", "description": "Core business logic" },
    { "name": "infra", "description": "Infrastructure and utilities" }
  ],
  "areas": [
    {
      "id": "packages-core",
      "name": "Core Packages",
      "path": "packages/core",
      "description": "Core business logic packages",
      "modules": ["auth", "database", "config"]
    }
  ],
  "architectureNotes": "Layered architecture with dependency injection..."
}
```

The `area` field on modules and the top-level `areas` array are only present for large repos (3000+ files) where multi-round discovery identifies top-level areas. For small repos, these fields are absent and the output remains flat.

### Scaling for Large Repos

The AI doesn't read every file. It uses tools strategically:

- `glob("**/*.ts")` to understand file distribution
- `view` on entry points and index files
- `grep` for import/export patterns to map dependencies
- Hierarchical discovery for monorepos: scan top-level first, then drill into packages

For very large repos (5000+ files), Phase 1 may do **multi-round discovery**: first pass identifies top-level structure, second pass explores each top-level area.

### SDK Usage

```typescript
const result = await sdkService.sendMessage({
  prompt: discoveryPrompt,
  workingDirectory: repoPath,
  availableTools: ['view', 'grep', 'glob'],
  onPermissionRequest: (req) =>
    req.kind === 'read' ? { kind: 'approved' } : { kind: 'denied-by-rules' },
  usePool: false,  // Direct session for MCP tool access
  timeoutMs: 300000,  // 5 minutes
});
```

## Phase 2: Deep Analysis

**Status:** Implemented
**Input:** Module graph from Phase 1
**Output:** Structured `ModuleAnalysis` per module (JSON)
**Parallelism:** Configurable (default 5) concurrent direct sessions via `MapReduceExecutor`

For each module in the graph, a direct AI session is created with read-only MCP tool access (`view`, `grep`, `glob`). The session pool is **not** used for Phase 2 — MCP tools require direct sessions (`usePool: false`). Each session:

1. Reads the module's key files
2. Analyzes public API, exports, types
3. Traces internal control flow and data flow
4. Identifies patterns, conventions, error handling strategies
5. Extracts code examples worth highlighting
6. Maps internal and external dependencies
7. Suggests a Mermaid diagram for the module's internal structure

### Three Depth Variants

| Depth | Investigation | Output Detail | Use Case |
|-------|---------------|---------------|----------|
| `shallow` | Read entry files, identify public API | Brief overview, 1 code example max | Large repos, quick surveys |
| `normal` | 7-step investigation (read, trace, identify patterns, etc.) | Full analysis, 2-3 code examples | Default for most projects |
| `deep` | 10-step exhaustive investigation including performance & edge cases | Comprehensive, 3-5 code examples | Critical modules, small repos |

### Map-Reduce Configuration

Uses `createPromptMapJob()` from pipeline-core:

```
Splitter:  PromptMapSplitter (one module = one PromptItem work item)
Mapper:    PromptMapMapper with analysis invoker (direct session + MCP tools)
Reducer:   PromptMapReducer with outputFormat: 'json' (deterministic collect)
Parallel:  Configurable (default 5)
```

`ModuleInfo` is flattened to a `PromptItem` (flat string key-values) for template substitution:

```typescript
function moduleToPromptItem(module: ModuleInfo, graph: ModuleGraph): PromptItem {
    return {
        moduleId: module.id,
        moduleName: module.name,
        modulePath: module.path,
        purpose: module.purpose,
        keyFiles: module.keyFiles.join(', '),
        dependencies: module.dependencies.join(', ') || 'none',
        dependents: module.dependents.join(', ') || 'none',
        complexity: module.complexity,
        category: module.category,
        projectName: graph.project.name,
        architectureNotes: graph.architectureNotes || 'No architecture notes available.',
    };
}
```

### Output Schema (Per Module)

```json
{
  "moduleId": "auth",
  "overview": "The auth module provides JWT-based authentication...",
  "keyConcepts": [
    { "name": "Session Token", "description": "...", "codeRef": "src/auth/jwt.ts:45" }
  ],
  "publicAPI": [
    { "name": "authenticate()", "signature": "...", "description": "..." }
  ],
  "internalArchitecture": "Uses middleware pattern with...",
  "dataFlow": "Request → middleware → JWT validation → session lookup → ...",
  "patterns": ["Middleware chain", "Factory pattern for token providers"],
  "errorHandling": "Throws AuthError subclasses, caught by global handler",
  "codeExamples": [
    { "title": "Basic authentication", "code": "...", "file": "src/auth/index.ts", "lines": [10, 25] }
  ],
  "dependencies": {
    "internal": [{ "module": "database", "usage": "Session storage" }],
    "external": [{ "package": "jsonwebtoken", "usage": "JWT signing/verification" }]
  },
  "suggestedDiagram": "sequenceDiagram\n  Client->>Middleware: Request with token\n  ..."
}
```

### Response Parsing

The response parser (`analysis/response-parser.ts`) handles:

- **JSON extraction** from multiple formats: direct JSON, `json` code blocks, generic code blocks, bracket matching
- **Field normalization** with defaults for missing optional fields (empty arrays, empty strings)
- **Mermaid diagram validation** — strips markdown wrappers, validates diagram starts with known keyword
- **File path normalization** — removes `./` and `/` prefixes, converts backslashes to forward slashes (Windows)
- **Code example line number validation** — rejects invalid ranges (end < start, negative values)

### AIInvoker Configuration (Analysis)

```typescript
const invoker = createAnalysisInvoker({
    repoPath: '/path/to/repo',
    model: 'claude-sonnet',     // Optional
    timeoutMs: 180_000,         // Default: 3 minutes per module
});

// Under the hood:
service.sendMessage({
    prompt,
    workingDirectory: repoPath,
    availableTools: ['view', 'grep', 'glob'],
    onPermissionRequest: (req) =>
        req.kind === 'read' ? { kind: 'approved' } : { kind: 'denied-by-rules' },
    usePool: false,              // Direct session — MCP tools require it
    loadDefaultMcpConfig: false, // Don't load user's MCP config
});
```

## Phase 3: Article Generation

**Status:** Implemented
**Input:** Module graph (Phase 1) + deep analyses (Phase 2)
**Output:** Markdown files on disk
**Parallelism:** Configurable (default 10) concurrent sessions via session pool (`usePool: true`)

### Article Types

| Article | Source | Description |
|---------|--------|-------------|
| `index.md` | Reduce phase | Categorized table of contents, project overview, module summaries |
| `architecture.md` | Reduce phase | High-level Mermaid component diagram, layer descriptions |
| `getting-started.md` | Reduce phase | Prerequisites, setup, build, run instructions |
| `modules/{slug}.md` | Map phase (1 per module) | Detailed module documentation |
| `areas/{id}/index.md` | Area reduce (hierarchical only) | Area-level index with links to its modules |
| `areas/{id}/architecture.md` | Area reduce (hierarchical only) | Area-level architecture diagram |

### Map Phase: Module Articles (Text Mode)

Uses **text mode** (`outputFields: []`) — the AI returns raw markdown, not structured JSON.

Each session receives a `PromptItem` with:
- `{{analysis}}` — full `ModuleAnalysis` JSON for the module
- `{{moduleGraph}}` — simplified graph (id, name, path, category only) for cross-linking
- `{{moduleName}}` — human-readable module name
- Depth-dependent style guide (shallow: 500-800 words, normal: 800-1500, deep: 1500-3000)

Cross-links use relative paths and are area-aware:
- **Flat layout**: `[Module Name](./modules/module-id.md)`
- **Hierarchical layout (within same area)**: `[Module Name](./module-id.md)`
- **Hierarchical layout (cross-area)**: `[Module Name](../../other-area-id/modules/module-id.md)`

### Reduce Phase: Index & Architecture (AI Reduce)

#### Flat Layout (Small Repos)

Uses `outputFormat: 'ai'` with `aiReducePrompt` and `aiReduceOutput: ['index', 'architecture', 'gettingStarted']`.

The reducer receives **module summaries** (name + overview, not full articles — too large for context) and project info template variables (`{{projectName}}`, `{{projectDescription}}`, `{{buildSystem}}`, `{{language}}`).

Returns structured JSON with three fields, each containing full markdown content.

**Fallback:** If AI reduce fails, static index and architecture pages are generated deterministically from the module graph (categorized TOC, basic architecture placeholder).

#### Hierarchical Layout (Large Repos — 2-Tier Reduce)

For repos with `areas`, the reduce uses a 2-tier approach to keep AI context windows manageable:

**Tier 1: Per-Area Reduce** — For each area, gathers module summaries belonging to that area and runs an AI reduce to generate:
- `areas/{id}/index.md` — Area index with module listing and overview
- `areas/{id}/architecture.md` — Area-level architecture diagram

Uses `buildAreaReducePromptTemplate()` with area-specific parameters (`areaName`, `areaDescription`, `areaPath`, `projectName`). Returns `['index', 'architecture']` fields.

**Tier 2: Project-Level Reduce** — Receives **area summaries** (not individual module summaries) and generates:
- `index.md` — Project-level index linking to each area
- `architecture.md` — Project-level architecture
- `getting-started.md` — Project-level getting started

Uses `buildHierarchicalReducePromptTemplate()` with area summaries as `{{RESULTS}}`.

**Fallback:** If either tier's AI reduce fails, static fallback pages are generated via `generateStaticAreaPages()` (tier 1) or `generateStaticHierarchicalIndexPages()` (tier 2).

### AIInvoker Configuration (Writing)

```typescript
const invoker = createWritingInvoker({
    model: 'claude-sonnet',     // Optional
    timeoutMs: 120_000,         // Default: 2 minutes per article
});

// Under the hood:
service.sendMessage({
    prompt,
    usePool: true,               // Session pool — no tools needed
    // No availableTools, no onPermissionRequest
});
```

### File Writer

`writeWikiOutput()` writes all articles to disk with:
- **Flat layout:** `wiki/` root + `wiki/modules/` subdirectory
- **Hierarchical layout:** `wiki/` root + `wiki/areas/{area-id}/modules/` subdirectories, plus area-level `index.md` and `architecture.md`
- Slug-based filenames: `normalizeModuleId()` for module slugs
- UTF-8 encoding, LF line endings (CRLF/CR normalized)
- Overwrites existing files on re-generation
- Automatically creates all area subdirectories before writing files

## Output Structure

### Flat Layout (Small Repos)

```
wiki/
├── index.md                    # Project overview + table of contents
├── architecture.md             # High-level architecture + diagrams
├── getting-started.md          # Setup and build instructions
├── module-graph.json           # Phase 1 discovery output (raw JSON)
├── modules/
│   ├── auth.md                 # Authentication module
│   ├── database.md             # Database layer
│   ├── api.md                  # API endpoints
│   └── ...
└── .wiki-cache/                # Cached Phase 1+2+3 results for incremental rebuilds
    ├── module-graph.json       # Phase 1 cache (with metadata)
    ├── analyses/               # Phase 2 per-module cache
    │   ├── _metadata.json      # { gitHash, timestamp, version, moduleCount }
    │   ├── auth.json           # { analysis: ModuleAnalysis, gitHash, timestamp }
    │   └── ...
    └── articles/               # Phase 3 per-module article cache
        ├── auth.json
        └── ...
```

### Hierarchical Layout (Large Repos with Areas)

```
wiki/
├── index.md                    # Project-level overview (links to areas)
├── architecture.md             # Project-level architecture
├── getting-started.md          # Project-level getting started
├── module-graph.json           # Phase 1 discovery output (with areas)
├── areas/
│   ├── packages-core/
│   │   ├── index.md            # Area index (links to its modules)
│   │   ├── architecture.md     # Area-level architecture diagram
│   │   └── modules/
│   │       ├── auth.md
│   │       ├── database.md
│   │       └── ...
│   ├── packages-api/
│   │   ├── index.md
│   │   ├── architecture.md
│   │   └── modules/
│   │       ├── routes.md
│   │       └── ...
│   └── ...
└── .wiki-cache/
    ├── module-graph.json
    ├── analyses/
    │   ├── _metadata.json
    │   ├── auth.json
    │   └── ...
    └── articles/               # Area-scoped article cache
        ├── packages-core/      # Articles cached per area
        │   ├── auth.json
        │   └── database.json
        ├── packages-api/
        │   └── routes.json
        └── ...
```

The hierarchical layout is activated automatically when Phase 1 discovers top-level areas (repos with 3000+ files). No additional CLI flags required.

## Incremental Rebuilds

**Status:** Implemented

After the initial generation, subsequent runs are faster:

1. **Detect changes** — `git diff --name-only <cached-hash> HEAD` to find changed files
2. **Map to modules** — for each module, check if any changed file falls under `module.path` or matches `module.keyFiles`
3. **Re-run Phase 2** — only for affected modules; unchanged modules loaded from per-module cache
4. **Re-run Phase 3** — always re-runs (cheap to regenerate, cross-links may need updating)

### Cache Structure

```
.wiki-cache/
├── module-graph.json           # Phase 1 (git hash validated)
├── analyses/                   # Phase 2 (per-module, git hash tracked)
│   ├── _metadata.json          # { gitHash, timestamp, version, moduleCount }
│   ├── auth.json               # { analysis: ModuleAnalysis, gitHash, timestamp }
│   ├── database.json
│   └── ...
└── articles/                   # Phase 3 (per-module article cache)
    ├── auth.json               # Flat layout articles
    ├── database.json
    ├── packages-core/          # Area-scoped articles (hierarchical layout)
    │   └── auth.json
    └── ...
```

Article cache lookup checks both area-scoped paths (`articles/{area-id}/{module-id}.json`) and flat paths (`articles/{module-id}.json`) for backward compatibility.

### Incremental Rebuild Algorithm

```typescript
// getModulesNeedingReanalysis():
// 1. Read _metadata.json → cached git hash
// 2. If same hash → return [] (nothing changed)
// 3. getChangedFiles(repoPath, cachedHash) → ['src/auth/jwt.ts', 'src/api/routes.ts']
// 4. For each module:
//    - Does any changed file start with module.path? → affected
//    - Does any changed file match module.keyFiles? → affected
// 5. Return affected module IDs

// Result: re-analyze only 2 modules, reuse 8 cached
```

### Cache Invalidation

- **Phase 1 cache** — invalidated when git HEAD hash changes
- **Phase 2 cache** — incremental per-module invalidation based on file paths
- **`--force`** — bypasses all caches, regenerates everything
- **Corrupted cache** — silently skipped (cleared entries, re-analyze)

## CLI Interface

```bash
# Full wiki generation (all 3 phases)
deep-wiki generate /path/to/repo --output ./wiki

# With options
deep-wiki generate /path/to/repo \
  --output ./wiki \
  --concurrency 5 \            # Parallel AI sessions
  --model claude-sonnet \      # Model for all phases
  --focus "src/" \             # Focus discovery on a specific subtree
  --depth normal \             # Article detail level: shallow, normal, deep
  --force \                    # Ignore all caches, regenerate everything
  --phase 2 \                 # Resume from phase N (uses cached prior phases)
  --timeout 300 \              # Timeout in seconds per phase
  --verbose                    # Verbose logging

# Resume from Phase 2 (use cached discovery)
deep-wiki generate /path/to/repo --output ./wiki --phase 2

# Resume from Phase 3 (use cached discovery + analysis)
deep-wiki generate /path/to/repo --output ./wiki --phase 3

# Force full regeneration
deep-wiki generate /path/to/repo --output ./wiki --force

# Discovery only (Phase 1)
deep-wiki discover /path/to/repo --output ./wiki --verbose
```

## SDK Components Used

| Component | Usage |
|-----------|-------|
| `CopilotSDKService` | All AI interactions (via `getCopilotSDKService()`) |
| `sendMessage()` with MCP tools | Phase 1 discovery, Phase 2 analysis (`usePool: false`) |
| `sendMessage()` via session pool | Phase 3 writing (`usePool: true`) |
| `MapReduceExecutor` / `createExecutor()` | Phase 2 (analysis) and Phase 3 (writing) |
| `createPromptMapJob()` | Job factory for both phases |
| `PromptMapSplitter` | One module/analysis = one `PromptItem` work item |
| `PromptMapMapper` | Template substitution + AI invocation per item |
| `PromptMapReducer` with `outputFormat: 'ai'` | Phase 3 AI reduce for index pages |
| `ConcurrencyLimiter` | Configurable parallel session count |
| `isCancelled()` | Graceful SIGINT cancellation across all phases |
| `JobProgress` callbacks | Per-phase spinner/progress reporting |

### AIInvoker Architecture

The `MapReduceExecutor` calls `AIInvoker(prompt, options?)` for each work item. MCP tool access is baked into the invoker at creation time — the executor has no concept of tools or permissions.

| Phase | Invoker | Session Type | Tools | Default Timeout |
|-------|---------|-------------|-------|-----------------|
| Phase 2 | `createAnalysisInvoker()` | Direct (`usePool: false`) | view, grep, glob | 180s |
| Phase 3 | `createWritingInvoker()` | Pool (`usePool: true`) | None | 120s |

## Implementation Details

All three phases are fully implemented in `packages/deep-wiki/`. 451 tests across 21 test files.

### Package Structure

```
packages/deep-wiki/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                         # Shebang + CLI entry
│   ├── cli.ts                           # Commander program (discover + generate)
│   ├── types.ts                         # All shared types (Phase 1+2+3)
│   ├── schemas.ts                       # JSON schemas + validation helpers
│   ├── logger.ts                        # CLI logger (spinner, colors)
│   ├── ai-invoker.ts                    # Analysis + writing invoker factories
│   ├── commands/
│   │   ├── discover.ts                  # deep-wiki discover <repo>
│   │   └── generate.ts                  # deep-wiki generate <repo> (3-phase)
│   ├── discovery/
│   │   ├── index.ts                     # discoverModuleGraph()
│   │   ├── prompts.ts                   # Discovery prompt templates
│   │   ├── discovery-session.ts         # SDK session orchestration
│   │   ├── response-parser.ts           # JSON extraction + validation
│   │   └── large-repo-handler.ts        # Multi-round for big repos
│   ├── analysis/
│   │   ├── index.ts                     # analyzeModules() public API
│   │   ├── prompts.ts                   # Analysis prompt templates (3 depths)
│   │   ├── analysis-executor.ts         # MapReduceExecutor orchestration
│   │   └── response-parser.ts           # ModuleAnalysis JSON parsing
│   ├── writing/
│   │   ├── index.ts                     # generateArticles() public API
│   │   ├── prompts.ts                   # Module article prompt templates + area-aware cross-links
│   │   ├── reduce-prompts.ts            # Flat, area-level, and hierarchical reduce prompts
│   │   ├── article-executor.ts          # Flat + hierarchical article executor orchestration
│   │   └── file-writer.ts              # Write markdown to disk (flat + hierarchical layouts)
│   └── cache/
│       ├── index.ts                     # Cache manager (graph + analyses + area-scoped articles)
│       └── git-utils.ts                 # Git hash + change detection
└── test/                                # 451 tests across 21 files
    ├── types.test.ts                    # (42 tests — includes AreaInfo, extended ModuleGraph)
    ├── cli.test.ts                      # (17 tests)
    ├── ai-invoker.test.ts               # (22 tests)
    ├── commands/
    │   ├── discover.test.ts             # (14 tests)
    │   └── generate.test.ts             # (17 tests)
    ├── discovery/
    │   ├── response-parser.test.ts      # (34 tests)
    │   ├── prompts.test.ts              # (21 tests)
    │   ├── large-repo-handler.test.ts   # (13 tests)
    │   └── area-tagging.test.ts         # (8 tests — mergeSubGraphs area tagging)
    ├── analysis/
    │   ├── response-parser.test.ts      # (25 tests)
    │   ├── prompts.test.ts              # (11 tests)
    │   └── analysis-executor.test.ts    # (11 tests)
    ├── writing/
    │   ├── prompts.test.ts              # (14 tests)
    │   ├── article-executor.test.ts     # (13 tests)
    │   ├── file-writer.test.ts          # (24 tests)
    │   └── hierarchical.test.ts         # (42 tests — cross-links, file paths, static fallbacks)
    └── cache/
        ├── index.test.ts               # (26 tests)
        ├── git-utils.test.ts            # (12 tests)
        ├── analysis-cache.test.ts       # (29 tests)
        ├── article-cache.test.ts        # (37 tests)
        └── area-article-cache.test.ts   # (19 tests — area-scoped article caching)
```

### Key Implementation Decisions

**Phase 1 (Discovery):**
1. **Large repo threshold set to 3000 files** — triggers multi-round discovery (structural scan → per-area drill-down → merge)
2. **Read-only permissions only** — discovery sessions allow `read` permissions, deny `write`/`shell`/`mcp`/`url`
3. **Response parser uses `extractJSON` from pipeline-core** — handles JSON in markdown code blocks, bracket matching, repair
4. **Cache uses git HEAD hash** — `git rev-parse HEAD` for invalidation, stored in `<output>/.wiki-cache/module-graph.json`
5. **Module IDs normalized to kebab-case** — invalid IDs auto-corrected with warnings
6. **Dependencies validated against module set** — references to non-existent modules are stripped with warnings

**Phase 2 (Analysis):**
7. **Direct sessions for MCP tools** — `usePool: false` required for tool access; session pool cannot provide MCP tools
8. **Default MCP config disabled** — `loadDefaultMcpConfig: false` prevents user's custom MCP servers from interfering
9. **Analysis response parser is separate from discovery** — handles `ModuleAnalysis` schema with Mermaid validation, code example normalization
10. **Per-module cache** — each module's analysis stored as individual JSON file for granular incremental invalidation
11. **Incremental rebuild via git diff** — `git diff --name-only <cached-hash> HEAD` maps changed files to affected modules

**Phase 3 (Writing):**
12. **Text mode for article map** — `outputFields: []` means AI returns raw markdown, not structured JSON
13. **AI reduce for index pages** — `outputFormat: 'ai'` with `aiReduceOutput: ['index', 'architecture', 'gettingStarted']`
14. **Simplified graph in prompts** — only id/name/path/category sent to article writer (not full analysis) for token efficiency
15. **Static fallback** — if AI reduce fails, generates deterministic TOC and architecture placeholder from module graph
16. **LF line endings** — CRLF/CR normalized to LF for cross-platform consistency
17. **Area-aware cross-links** — module article prompts include dynamic cross-linking rules based on whether the module belongs to an area (hierarchical) or not (flat)
18. **2-tier reduce for large repos** — per-area reduce generates area index/architecture from module summaries; project-level reduce receives area summaries (not 200+ module summaries) to stay within context limits
19. **Automatic layout detection** — `runArticleExecutor()` dispatches to `runHierarchicalArticleExecutor()` or `runFlatArticleExecutor()` based on presence of `graph.areas`

**Generate Command:**
20. **Three-phase orchestration** — Phase 1→2→3 with `--phase N` to resume from cached prior phases
21. **SIGINT graceful cancellation** — `isCancelled()` propagated to MapReduceExecutor; second SIGINT force-exits
22. **Phase 3 always re-runs** — article cross-links may need updating even when analyses are cached
23. **Area-scoped article caching** — `onItemComplete` passes `areaId` so articles are cached under `articles/{area-id}/{module-id}.json`

### Error Handling

| Error | Phase | Handling |
|-------|-------|----------|
| SDK unavailable | Any | Exit 3, print setup instructions |
| Module analysis timeout | 2 | Mark failed, continue others, warn in summary |
| Analysis parse failure | 2 | Try fallback parsing from structured output, then mark failed |
| All analyses failed | 2 | Exit 1, suggest checking SDK or reducing scope |
| Article generation timeout | 3 | Mark failed, continue others |
| Reduce failure | 3 | Fallback: generate static TOC without AI |
| Area reduce failure | 3 | Fallback: static area index/architecture via `generateStaticAreaPages()` |
| Hierarchical reduce failure | 3 | Fallback: static project index/architecture via `generateStaticHierarchicalIndexPages()` |
| Disk write failure | 3 | Exit 1, print path and error |
| Partial cache corruption | 2 | Skip corrupted entries, re-analyze |
| Missing cache + --phase N | Any | Exit 2, explain which phase needs to run first |

## Open Questions

1. **Monorepo support** — should each package get its own wiki, or one unified wiki? *(Current: unified wiki with `--focus` to limit scope)*
2. **Language-specific analyzers** — should Phase 1 have language-specific heuristics (e.g., know about `go.mod`, `Cargo.toml`, `pyproject.toml`)? *(Current: AI discovers language-specific patterns via tools)*
3. **Diagram generation** — Mermaid only, or also support other formats? *(Current: Mermaid only, validated with keyword detection)*
4. **Static site integration** — bundle a default MkDocs/Docusaurus config, or just output raw markdown? *(Current: raw markdown only)*
5. **Interactive Q&A** — after generation, allow follow-up questions against the wiki as context?
6. **Cost control** — should there be a `--budget` flag to limit total API calls?
7. **Phase 3 incremental** — ~~currently Phase 3 always re-runs~~ Phase 3 now caches per-module articles (including area-scoped) and reuses them on incremental rebuilds; index/architecture pages are always regenerated
8. **Token usage tracking** — `AnalysisResult.tokenUsage` and `DiscoveryResult.tokenUsage` are typed but not yet populated by the SDK
9. **Custom writing templates** — allow users to provide their own article prompt templates (e.g., for different audiences or styles)
10. **Multi-model support** — use different models for different phases (e.g., larger model for discovery, faster model for writing)
